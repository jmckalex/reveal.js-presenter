/*
 * reveal.js-presenter — what only the laptop's deck draws, on the tablet.
 *
 * presenter-master.js draws, on the laptop alone, the question QR code, the
 * poll pill, the charts, the board of shared questions and reactions.  This
 * draws them on presenter.html's copies too, so that the current slide shows
 * what the laptop's screen does, and the next one what it will.
 *
 * Each copy is loaded with ?presenter, so presenter-master.js runs there as a
 * mirror: it sends nothing, holds no secret, and draws exactly as on the
 * laptop from what this hands it, through window.presenterMirror in the copy:
 *
 *   tally(t)      a poll's tally, as the relay sends 'poll-tally'
 *   board(b)      the board, as 'board' ({ items })
 *   reaction(r)   a reaction, as 'reaction' ({ emoji }), the current slide only
 *   reset()       the tablet's Reset (the relay's 'reset')
 *   code(c)       the question code (four digits), which the relay gave this
 *                 page with the key, for the QR code
 *   screen(s)     what the laptop says its screen shows besides:
 *                 { qrHidden, pen } (pen to the current slide alone)
 *   sync()        draw again from all of that
 *   want          set by this file: want(ids) asks for the tallies of the
 *                 polls on the copy's slide
 *
 * The tallies come from the relay to the tablet holding the questions key as
 * they go to the laptop ('poll-tally'); a copy asks for those it lacks
 * ('poll-results', with the key).  With no presenterMirror in a copy (an
 * older presenter-master.js, or questions off), this does nothing for it.
 */
(function () {
	'use strict';
	const view = window.PresenterView;
	if (!view || !document.body.classList.contains('questions-on')) return;	// it needs the questions key

	const tallies = new Map();		// poll id -> its latest tally
	let board = null;

	// The copies running presenter-master.js as a mirror, each with its
	// window.  What is handed one is copied into that window first, so that
	// it is the copy's own (an array from here is not an Array there).
	function copies() {
		return ['current', 'upcoming'].map(id => {
			try {
				const w = document.getElementById(id).contentWindow;
				return w && w.presenterMirror ? { id, w, mirror: w.presenterMirror } : null;
			} catch (e) { return null; }		// reloading
		}).filter(Boolean);
	}
	const own = (copy, data) => copy.w.JSON.parse(JSON.stringify(data));
	const each = (fn, only) => copies().filter(c => !only || c.id === only).forEach(c => { try { fn(c); } catch (e) { console.warn('[presenter] mirror', e); } });

	// Tallies.
	const asked = new Map();		// poll id -> when last asked
	function want(ids) {
		const socket = view.socket;
		if (!socket || !socket.connected || !view.key) return;
		for (const id of ids) {
			if (typeof id !== 'string' || tallies.has(id) || Date.now() - (asked.get(id) || 0) < 2000) continue;
			asked.set(id, Date.now());
			socket.emit('poll-results', { channel: view.channel, key: view.key, id }, res => { if (res && res.ok) gotTally(res.tally); });
		}
	}
	function gotTally(tally) {
		if (!tally || typeof tally.id !== 'string') return;
		tallies.set(tally.id, tally);
		each(c => c.mirror.tally(own(c, tally)));
	}

	// What the laptop's screen shows besides: to both copies, but the pen to
	// the current slide alone.
	function screen(copy) {
		const s = view.screen;
		if (!s) return;
		copy.mirror.screen(own(copy, { qrHidden: s.qrHidden, pen: copy.id === 'current' ? s.pen : undefined }));
	}

	// A copy just ready: everything known so far, and its own polls' tallies.
	function prime(copy) {
		copy.mirror.want = ids => want([...ids]);
		if (view.code) copy.mirror.code(view.code);
		if (board) copy.mirror.board(own(copy, board));
		for (const tally of tallies.values()) copy.mirror.tally(own(copy, tally));
		screen(copy);
		copy.mirror.sync();
	}
	// presenter-master.js loads its poll code as a module, which may arrive
	// after the copy's reveal.js is ready: so wait a while for the copy's
	// presenterMirror, then render again (a mirror takes the laptop's own
	// fragment index: see render() in presenter.html).
	const priming = { current: null, upcoming: null };
	function primeWhenReady(id) {
		clearTimeout(priming[id]);
		const started = Date.now();
		(function look() {
			priming[id] = null;
			const copy = copies().find(c => c.id === id);
			if (copy) {
				try { prime(copy); } catch (e) { console.warn('[presenter] mirror', e); }
				if (typeof view.refresh === 'function') view.refresh();
			}
			else if (Date.now() - started < 15000) priming[id] = setTimeout(look, 200);
		})();
	}
	document.addEventListener('presenter-frame', e => { if (e.detail in priming) primeWhenReady(e.detail); });
	document.addEventListener('presenter-state', () => each(screen));
	// The key accepted (again, after a reconnect, say): the code, and the
	// tallies afresh, since answers may have come meanwhile.
	document.addEventListener('presenter-listening', () => {
		tallies.clear();
		asked.clear();
		each(c => { if (view.code) c.mirror.code(view.code); c.mirror.sync(); });
	});

	let hooked = false;
	function hook() {
		const socket = view.socket;
		if (!socket || hooked) return;
		hooked = true;
		socket.on('poll-tally', gotTally);
		socket.on('poll-count', c => { if (c && typeof c.id === 'string' && !tallies.has(c.id)) want([c.id]); });	// a poll just opened
		socket.on('reset', () => { tallies.clear(); asked.clear(); each(c => { c.mirror.reset(); c.mirror.sync(); }); });
		socket.on('board', b => { if (b && Array.isArray(b.items)) { board = b; each(c => c.mirror.board(own(c, b))); } });
		socket.on('reaction', r => each(c => c.mirror.reaction(own(c, r)), 'current'));
	}
	document.addEventListener('presenter-socket', hook);
	hook();
})();
