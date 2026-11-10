/*
 * reveal.js-presenter — the laptop's ink, on the tablet.
 *
 * What is drawn on the laptop's slide, with the chalkboard plugin's pen or on
 * its chalkboard, is drawn on presenter.html's copy of the current slide too,
 * so that it shows what the laptop's screen does: the board opening, closing
 * and scrolling, made white, ruled or not, a canvas wiped.  The laptop sends
 * each thing as it is drawn ('ink', through the relay, to the room of the
 * tablets holding the questions key), and this hands it to the copy's
 * chalkboard plugin as one of the plugin's own messages, as
 * presenter-driver.js does with the Pencil's; one drawn on a slide the copy
 * is not on is left out.
 *
 * Whenever the copy arrives on a slide, loads, or the relay accepts the key
 * (after a reconnect, say), it asks for the slide's drawings so far
 * ('ink-want'), which come in parts ('ink-slide') and replace what the copy
 * has, so that nothing missed in between stays missing.  They come with the
 * number of the last thing drawn before them, and anything numbered up to it
 * is already among them.  Whatever this page's Drive drew comes back too,
 * marked as this page's, and is left out: it is drawn here at once.
 *
 * Needs the chalkboard plugin in vendor/chalkboard (its slideDrawings,
 * setSlideDrawings, slideTime and boardOpen) in the deck; with rajgoel's
 * unchanged plugin, what is drawn shows as it is drawn, but nothing drawn
 * before the copy arrived on the slide.  A deck with no chalkboard plugin:
 * nothing to do.
 */
(function () {
	'use strict';
	const view = window.PresenterView;
	if (!view || !document.body.classList.contains('questions-on')) return;	// it needs the questions key
	const WANT_EVERY_MS = 1000;		// a request at most this often (the relay allows five a second)

	const stepOf = s => s ? { h: s.indexh, v: s.indexv, f: Number.isInteger(s.indexf) ? s.indexf : -1 } : null;
	// Whether the plugin keeps writing for the whole slide (vendor/chalkboard,
	// unless the deck sets perFragment), and so whether two positions are the
	// same place to write.
	const bySlide = w => typeof w.RevealChalkboard.boardScroll === 'function' && !(w.Reveal.getConfig().chalkboard || {}).perFragment;
	const samePlace = (w, a, b) => !!a && !!b && a.h === b.h && a.v === b.v && (a.f === b.f || bySlide(w));
	// The time on the slide's clock, as presenter-driver.js has it.
	const stamp = w => Math.round(typeof w.RevealChalkboard.slideTime === 'function' ? w.RevealChalkboard.slideTime() : w.performance.now());

	// The current slide's copy, with its plugin, once it is ready.
	function deck() {
		if (!view.ready) return null;
		try {
			const w = view.frame.contentWindow;
			return w.Reveal && w.Reveal.isReady() && w.RevealChalkboard ? w : null;
		} catch (e) { return null; }		// reloading
	}
	const placeOf = w => stepOf(w.Reveal.getState());

	// The laptop's page drawing (run), and the last thing it drew that the
	// copy has from its drawings so far (n).
	let since = { run: null, n: 0 };

	function draw(w, op) {
		const { n, from, ...content } = op;
		const message = new w.CustomEvent('received');
		message.content = Object.assign(content, { sender: 'chalkboard-plugin', timestamp: stamp(w) });
		w.document.dispatchEvent(message);
	}

	// The board's being open or closed, for presenter-driver.js's tools.
	function told(w, what) {
		const open = typeof w.RevealChalkboard.boardOpen === 'function' ? w.RevealChalkboard.boardOpen() : null;
		document.dispatchEvent(new CustomEvent(what, { detail: { open } }));
	}

	function onInk(data) {
		if (!data || !Array.isArray(data.ops) || typeof data.run !== 'string') return;
		if (since.run && data.run !== since.run) want();		// the laptop's page has loaded again
		const w = deck();
		if (!w || !samePlace(w, data.at, placeOf(w))) return;
		let drawn = 0;
		for (const op of data.ops) {
			if (!op || (data.run === since.run && op.n <= since.n)) continue;		// in the drawings already
			if (op.from && op.from === view.driveId) continue;					// drawn here
			draw(w, op);
			drawn++;
		}
		if (drawn) told(w, 'presenter-board');
	}

	// A slide's drawings, in parts.
	let parts = null;				// { key, got, count }
	function onSlide(data) {
		if (!data || !Number.isInteger(data.parts) || !Number.isInteger(data.part) || data.part < 0 || data.part >= data.parts) return;
		const key = [data.run, data.n, JSON.stringify(data.slide), data.parts].join(' ');
		if (!parts || parts.key !== key || data.part === 0) parts = { key, got: [], count: 0 };
		if (parts.got[data.part]) return;
		parts.got[data.part] = data;
		if (++parts.count < data.parts) return;
		const got = parts.got;
		parts = null;
		const w = deck();
		if (!w || typeof w.RevealChalkboard.setSlideDrawings !== 'function') return;
		const notes = got.flatMap(p => p.notes || []), board = got.flatMap(p => p.board || []);
		const durations = Array.isArray(data.durations) ? data.durations : [];
		w.RevealChalkboard.setSlideDrawings({
			slide: data.slide, mode: data.mode,
			notes: { events: notes, duration: durations[0] }, board: { events: board, duration: durations[1] }
		});
		// (Drawings of a slide the copy has since left are kept for it, but say
		// nothing of what has come since for the slide it is on.)
		if (samePlace(w, data.at, placeOf(w))) {
			since = { run: data.run, n: data.n };
			told(w, 'presenter-ink');
			told(w, 'presenter-board');
		}
	}

	// Asking for the slide's drawings: at once, or, if asked a moment ago,
	// once that moment has passed.
	let asked = 0, asking = null;
	function want() {
		if (asking) return;
		const wait = asked + WANT_EVERY_MS - Date.now();
		if (wait > 0) { asking = setTimeout(() => { asking = null; want(); }, wait); return; }
		const socket = view.socket, w = deck();
		if (!socket || !socket.connected || !view.key || !w) return;
		asked = Date.now();
		socket.emit('ink-want', { channel: view.channel, key: view.key, at: placeOf(w) });
	}

	// When the copy arrives on another slide, or a new copy is ready (the
	// current one, or the next one, the two being put in place together).
	let place = null;
	function arrived() {
		const w = deck();
		if (!w) return;
		const now = placeOf(w);
		if (samePlace(w, now, place)) return;
		place = now;
		want();
	}
	document.addEventListener('presenter-state', arrived);
	document.addEventListener('presenter-frame', e => {
		if (e.detail === 'current') place = null;
		arrived();
	});
	document.addEventListener('presenter-listening', want);

	let hooked = false;
	function hook() {
		const socket = view.socket;
		if (!socket || hooked) return;
		hooked = true;
		socket.on('ink', onInk);
		socket.on('ink-slide', onSlide);
	}
	document.addEventListener('presenter-socket', hook);
	hook();
})();
