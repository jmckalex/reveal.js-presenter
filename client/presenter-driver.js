/*
 * reveal.js-presenter — driving the laptop's deck from the tablet
 * (presenter.html's Drive button).
 *
 * The Apple Pencil writes on the slide with the deck's pen (the chalkboard
 * plugin's "notes canvas") or on its chalkboard, which a finger drags up and
 * down; ◀ ▶ step back and forward through the talk; and the deck's own
 * controls, which the tablet's copy shows as the laptop's does (reveal's
 * arrows, a toolbar, the chalkboard's handle and palettes), do there what
 * they do on the laptop: all on the laptop's copy (?master), so on the
 * projector.  (What the laptop draws itself comes here through
 * presenter-ink.js.)  The writing needs the chalkboard plugin in
 * vendor/chalkboard in the deck; without it, Drive still steps through the
 * talk and presses the deck's controls, and says why it has no pen.
 *
 * Each stroke is drawn at once on this page's copy of the slide, and sent in
 * batches, through the relay with the questions key ('driver'), to the
 * laptop, which hands it to the same plugin as one of the plugin's own
 * messages.  So the writing behaves there exactly as writing done with the
 * mouse: it belongs to the slide it was made on, staying as the slide's
 * fragments appear, gone on the next slide and back on returning.  A batch
 * goes only once the one before has been answered, and is sent again until
 * it is, so that nothing is lost or doubled on a connection that dies; one
 * made on a slide the laptop has since left is not drawn there.  (With
 * rajgoel's unchanged plugin, or a deck that sets perFragment, writing
 * belongs to a step, and "slide" above means a step.)  The board opened or
 * closed on the laptop itself (presenter-ink.js says so) is opened or closed
 * here too.
 *
 * The Pencil alone writes once it has touched the screen, so that a resting
 * palm never does; until then a finger writes on the slide (a tablet without
 * a Pencil), and a mouse always does (trying it on a laptop).  On the
 * chalkboard a finger moves the board instead, a flick carrying it on.  A
 * touch begun while the Pencil is down, or just after, is taken for a palm,
 * and so is one moving the board when the Pencil comes down: none of them
 * moves the board or presses an arrow.
 */
(function () {
	'use strict';
	const view = window.PresenterView;
	if (!view || !document.body.classList.contains('questions-on')) return;	// it needs the questions key
	const $ = id => document.getElementById(id);
	const FRAME_WIDTH = 1280;		// the frame's own width (see presenter.html)
	const SEND_EVERY_MS = 40;
	const REPLY_MS = 6000;			// the relay waits up to 3 s for the laptop
	const RETRY_MS = 1000;
	const GIVE_UP_STEP_MS = 5000;	// a step back or forward not delivered by then is dropped
	const GIVE_UP_MS = 30000;		// and writing
	const MAX_BATCH = 300;			// operations (the relay takes up to 400)
	const MAX_QUEUE = 20000;
	const MIN_MOVE = 0.5;			// deck units between two points of a stroke
	const ERASE_MOVE = 4;			// and between two dabs of the sponge
	const PALM_MS = 600;			// a touch begun this soon after the Pencil lifts is a palm
	const DRAG_FROM = 8;			// pixels a finger moves before the board moves with it
	const GLIDE_FRICTION = 0.997;	// a flicked board's speed kept each millisecond
	const FROM = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
	view.driveId = FROM;			// so that presenter-ink.js knows this page's writing when it comes back

	let driving = false;
	let mode = 0;					// 0: the pen, on the slide; 1: the chalkboard
	let erasing = false;
	const colour = [0, 0];			// the colour chosen for each, numbered as the plugin does
	let penSeen = false;
	let stroke = null;				// the pointer writing now: { id, last }
	const queue = [];				// operations waiting: { at, op }
	let inflight = null;			// the batch sent and not yet answered
	let seq = 0;
	let lastSent = 0;
	let timer = null;
	let trouble = false;
	let statusTimer = null;
	let penDown = false;			// the Pencil on the screen
	let penLifted = 0;				// when it last left it
	let drag = null;				// the finger moving the board: { id, startY, startScroll, moved, samples }
	const palms = new Set();		// touches taken for a palm, ignored until they end
	let glide = null;				// the board still moving after a flick

	const STEPS = new Set(['next', 'prev', 'left', 'right', 'up', 'down', 'overview', 'question', 'goto']);
	const isStep = op => STEPS.has(op.type);
	const stepOf = s => s ? { h: s.indexh, v: s.indexv, f: Number.isInteger(s.indexf) ? s.indexf : -1 } : null;
	const sameStep = (a, b) => !!a && !!b && a.h === b.h && a.v === b.v && a.f === b.f;
	// Whether the plugin keeps writing for the whole slide (vendor/chalkboard,
	// unless the deck sets perFragment), and so whether two positions are the
	// same place to write.
	const bySlide = w => !!w && !!w.RevealChalkboard && typeof w.RevealChalkboard.boardScroll === 'function'
		&& !(w.Reveal.getConfig().chalkboard || {}).perFragment;
	const samePlace = (a, b) => !!a && !!b && a.h === b.h && a.v === b.v && (a.f === b.f || bySlide(frameDeck()));
	const round = n => Math.round(n * 100) / 100;
	// The time on the slide's clock (the plugin keeps a slide's drawings in
	// its order), or, from rajgoel's unchanged plugin, the page's.
	const stamp = w => Math.round(typeof w.RevealChalkboard.slideTime === 'function' ? w.RevealChalkboard.slideTime() : w.performance.now());
	// An operation drawn on this page's copy, as one of the plugin's own messages.
	function drawHere(w, op) {
		const message = new w.CustomEvent('received');
		message.content = Object.assign({}, op, { sender: 'chalkboard-plugin', timestamp: stamp(w) });
		w.document.dispatchEvent(message);
	}

	function status(text, lasting) {
		$('d-status').textContent = text || '';
		clearTimeout(statusTimer);
		if (text && !lasting) statusTimer = setTimeout(() => { $('d-status').textContent = ''; }, 4000);
	}

	// This page's copy of the current slide, once its reveal.js is ready.
	function frameReveal() {
		if (!view.ready) return null;
		try {
			const w = view.frame.contentWindow;
			return w.Reveal && w.Reveal.isReady() ? w : null;
		} catch (e) { return null; }		// reloading
	}
	// The same, ready to write on: with the chalkboard plugin, keeping strokes
	// in the deck's own units (a resize, once per copy loaded, for rajgoel's
	// unchanged plugin, which uses the window's pixels until the window first
	// resizes), and its steps timed (see settling()).
	let steppedAt = 0;
	function frameDeck() {
		const w = frameReveal();
		if (!w || !w.RevealChalkboard) return null;
		if (!w.presenterDriverUnits) {
			w.presenterDriverUnits = true;
			w.dispatchEvent(new w.Event('resize'));
			w.Reveal.on('slidechanged', () => { steppedAt = Date.now(); });
			['fragmentshown', 'fragmenthidden'].forEach(type => w.Reveal.on(type, () => { if (!bySlide(w)) steppedAt = Date.now(); }));
		}
		return w;
	}
	const NO_PEN = 'This deck has no chalkboard plugin, so there is nothing to write with: ◀ ▶ and its controls work';

	// A moment after arriving on a slide (its "transition", 800 ms unless the
	// deck sets it), the plugin clears it and redraws what it has kept from
	// before, losing anything drawn in between.  Writing begun in that moment
	// waits for it, here as on the laptop.
	const settling = w => steppedAt + ((w.Reveal.getConfig().chalkboard || {}).transition ?? 800) + 50 - Date.now();

	// How far down the chalkboard is scrolled, in the deck's units.
	const boardScroll = w => typeof w.RevealChalkboard.boardScroll === 'function' ? w.RevealChalkboard.boardScroll() : 0;

	// A point on the screen in the deck's own units, as the plugin keeps it:
	// its width by its height, letterboxed in the frame's window, and on the
	// chalkboard, as far down the board as it is scrolled.
	function toDeck(e, w) {
		const rect = view.frame.getBoundingClientRect();
		const k = rect.width / FRAME_WIDTH;
		const fx = (e.clientX - rect.left) / k, fy = (e.clientY - rect.top) / k;
		const { width, height } = w.Reveal.getConfig();
		const W = w.innerWidth, H = w.innerHeight;
		const s = Math.min(W / width, H / height);
		return { x: round((fx - (W - width * s) / 2) / s), y: round((fy - (H - height * s) / 2) / s + (mode === 1 ? boardScroll(w) : 0)) };
	}

	// An operation, as the plugin's own messages have it, drawn here and sent;
	// or held, in order, while the slide settles (see settling()).
	const held = [];
	let holding = null;
	function emit(op) {
		const at = stepOf(view.state);
		if (!at) return status('Waiting for the laptop');
		if (!isStep(op)) {
			const w = frameDeck();
			if (!w) return status(frameReveal() ? NO_PEN : 'Waiting for the deck');
			if (view.state.overview) return status('The laptop is showing the overview: choose a slide');		// (it would not draw it)
			op.board = 0;
			if (!('mode' in op)) op.mode = mode;
		}
		held.push({ at, op });
		release();
	}
	function release() {
		clearTimeout(holding);
		holding = null;
		const w = frameDeck();
		const wait = w ? settling(w) : 0;
		if (wait > 0) { holding = setTimeout(release, wait); return; }
		const now = stepOf(view.state);
		for (const { at, op } of held.splice(0)) {
			if (!isStep(op)) {
				if (!w || !samePlace(at, now)) continue;		// made on a slide since left
				drawHere(w, op);
			}
			queue.push({ at, op });
		}
		if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
		pump();
	}

	// ---- Sending: one batch at a time, each answered before the next.

	function pump() {
		const socket = view.socket;
		if (inflight || !queue.length || !socket || !socket.connected || !view.key) return;
		const wait = lastSent + SEND_EVERY_MS - Date.now();
		if (wait > 0) { clearTimeout(timer); timer = setTimeout(pump, wait); return; }
		const at = queue[0].at;
		const ops = [];
		while (queue.length && ops.length < MAX_BATCH && sameStep(queue[0].at, at)) {
			const { op } = queue.shift();
			ops.push(op);
			if (isStep(op)) break;		// the laptop moves: what follows was made after
		}
		inflight = { seq: ++seq, at, ops, since: Date.now() };
		send();
	}

	function send() {
		const socket = view.socket;
		const batch = inflight;
		if (!batch || !socket || !socket.connected) return;
		lastSent = Date.now();
		const data = { channel: view.channel, key: view.key, from: FROM, seq: batch.seq, at: batch.at, ops: batch.ops };
		view.emitTimed(socket, REPLY_MS, 'driver', data, (err, res) => {
			if (batch !== inflight) return;
			if (err) {
				// No word from the relay: the connection has died without saying so.
				// A new one sends this batch again (see 'connect' below).
				trouble = true;
				status('Not reaching the relay: reconnecting…', true);
				if (socket.connected) socket.disconnect().connect();
				return;
			}
			if (res && res.ok) {
				inflight = null;
				if (res.dropped) status('The laptop had moved on, so that writing is not on its screen');
				else if (trouble) status('');
				trouble = false;
				return pump();
			}
			const reason = res && res.reason;
			if (reason === 'key' || reason === 'invalid') {
				inflight = null;
				status(reason === 'key' ? 'The questions key was not accepted' : 'The relay refused that', true);
				return pump();
			}
			// No laptop listening, or none answering, or questions not open (yet):
			// try again while it would still mean the same.
			trouble = true;
			status(reason === 'no-laptop' || reason === 'closed' ? 'The laptop isn’t listening' : 'The laptop isn’t answering', true);
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (batch !== inflight) return;
				const stepping = batch.ops.some(isStep);
				const stale = Date.now() - batch.since > (stepping ? GIVE_UP_STEP_MS : GIVE_UP_MS)
					|| (!stepping && !samePlace(batch.at, stepOf(view.state)));
				if (!stale) return send();
				inflight = null;
				trouble = false;
				status(stepping ? 'The laptop didn’t move: it wasn’t there' : 'The laptop was away, so that writing is not on its screen');
				pump();
			}, RETRY_MS);
		});
	}

	let hooked = false;
	function hook() {
		const socket = view.socket;
		if (!socket || hooked) return;
		hooked = true;
		socket.on('connect', () => { if (inflight) send(); else pump(); });
	}
	document.addEventListener('presenter-socket', hook);
	hook();

	// The laptop has moved: the plugin closes its chalkboard at every step,
	// there and here, and writing waiting for a slide it has left would not
	// be drawn there.
	let lastStep = null;
	document.addEventListener('presenter-state', () => {
		const now = stepOf(view.state);
		if (sameStep(now, lastStep)) return;
		const moved = !samePlace(now, lastStep);
		lastStep = now;
		if (moved) {
			steppedAt = Date.now();
			stroke = null;
			for (let i = queue.length - 1; i >= 0; i--) if (!isStep(queue[i].op) && !samePlace(queue[i].at, now)) queue.splice(i, 1);
		}
		stopGlide();
		forgetScroll();
		drag = null;
		if (mode === 1) { mode = 0; showTools(); }
	});

	// The board opened or closed on the laptop itself, and so in this page's
	// copy (presenter-ink.js): the tools follow, unless a change made here is
	// still on its way there, which the laptop will soon follow instead.
	const toggles = op => op.type === 'showChalkboard' || op.type === 'closeChalkboard';
	document.addEventListener('presenter-board', e => {
		const open = e.detail && e.detail.open;
		if (typeof open !== 'boolean' || (open ? 1 : 0) === mode) return;
		if (held.some(x => toggles(x.op)) || queue.some(x => toggles(x.op)) || (inflight && inflight.ops.some(toggles))) return;
		mode = open ? 1 : 0;
		erasing = false;
		stopGlide();
		forgetScroll();
		drag = null;
		stroke = null;
		showTools();
	});

	// The slide's drawings, just put in place in the copy from the laptop's
	// (presenter-ink.js), lack what was drawn here and has not reached the
	// laptop yet: drawn again.
	document.addEventListener('presenter-ink', () => {
		const w = frameDeck(), now = stepOf(view.state);
		if (!w) return;
		const waiting = (inflight ? inflight.ops.map(op => ({ at: inflight.at, op })) : []).concat(queue);
		for (const { at, op } of waiting) if (!isStep(op) && samePlace(at, now)) drawHere(w, op);
	});

	// A new copy of the deck: the tools as it has them (its colours; whether
	// it has a pen at all).
	document.addEventListener('presenter-frame', e => { if (e.detail === 'current' && driving) showTools(); });

	// This page's copies show the chalkboard as the laptop does, a chalkboard
	// or a whiteboard, with its grid or without: whenever the laptop's
	// changes, and in a copy just loaded.  (Not at every position the laptop
	// sends: one changed here is sent on, and the laptop's next positions may
	// not yet say so.)
	let laptopLook = null, laptopGrid = null;
	document.addEventListener('presenter-state', () => {
		const look = view.chalkboard, grid = view.chalkboardGrid;
		const lookChanged = !!look && look !== laptopLook, gridChanged = typeof grid === 'boolean' && grid !== laptopGrid;
		if (look) laptopLook = look;
		if (typeof grid === 'boolean') laptopGrid = grid;
		for (const id of ['current', 'upcoming']) {
			let w;
			try { w = document.getElementById(id).contentWindow; } catch (e) { continue; }
			let board;
			try { board = w && w.RevealChalkboard; } catch (e) { continue; }
			if (!board || typeof board.setTheme !== 'function') continue;
			const fresh = !w.presenterLook;
			w.presenterLook = true;
			if (look && (lookChanged || fresh)) board.setTheme(look);
			if (typeof grid === 'boolean' && typeof board.setGrid === 'function' && (gridChanged || fresh)) board.setGrid(grid);
			if (id === 'current' && driving && (lookChanged || fresh)) showTools();
		}
	});

	// ---- Moving the chalkboard, with a finger (or a mouse's wheel)

	const canScroll = w => !!w && !!w.RevealChalkboard && typeof w.RevealChalkboard.scrollBoard === 'function';
	// The screen's pixels to one of the deck's units, on this page.
	function pxPerUnit(w) {
		const k = view.frame.getBoundingClientRect().width / FRAME_WIDTH;
		const { width, height } = w.Reveal.getConfig();
		return k * Math.min(w.innerWidth / width, w.innerHeight / height);
	}
	// The board to a height: drawn here once a frame at most (a finger reports
	// moving more often than the screen is drawn, and drawing the board at
	// each report left it trailing the finger), and sent to the laptop, which
	// needs only the latest of the heights still waiting to go.
	let wanted = null;				// the height the board is to be drawn at next
	let painting = null;			// the frame (or, out of sight, the timer) that will
	function scrollTo(w, y) {
		wanted = round(Math.max(0, y));
		if (!painting) painting = { frame: requestAnimationFrame(paintScroll), timer: setTimeout(paintScroll, 50) };
	}
	function paintScroll() {
		if (!painting) return;
		cancelAnimationFrame(painting.frame);
		clearTimeout(painting.timer);
		painting = null;
		const w = frameDeck(), y = wanted;
		wanted = null;
		if (y === null || !driving || mode !== 1 || !canScroll(w)) return;
		w.RevealChalkboard.scrollBoard(y, false);
		const at = stepOf(view.state);
		if (!at) return;
		const waiting = queue[queue.length - 1];
		if (waiting && waiting.op.type === 'scroll' && sameStep(waiting.at, at)) waiting.op.y = y;
		else queue.push({ at, op: { type: 'scroll', mode: 1, board: 0, y } });
		pump();
	}
	// Where the board is going: the height waiting to be drawn, if any.
	const scrolledTo = w => wanted !== null ? wanted : w.RevealChalkboard.boardScroll();
	// A height waiting to be drawn is forgotten when the board closes.
	function forgetScroll() {
		wanted = null;
		if (painting) { cancelAnimationFrame(painting.frame); clearTimeout(painting.timer); painting = null; }
	}
	function stopGlide() {
		if (glide) cancelAnimationFrame(glide);
		glide = null;
	}
	// A flick (v: units a millisecond) carries the board on, slowing.
	function startGlide(v) {
		const w = frameDeck();
		if (!canScroll(w)) return;
		let y = scrolledTo(w), then = performance.now();
		const step = now => {
			const dt = Math.min(now - then, 50);
			then = now;
			y = Math.max(0, y + v * dt);
			v *= Math.pow(GLIDE_FRICTION, dt);
			scrollTo(w, y);
			glide = Math.abs(v) > 0.02 && y > 0 ? requestAnimationFrame(step) : null;
		};
		glide = requestAnimationFrame(step);
	}
	const isPalm = e => e.pointerType === 'touch' && (penDown || Date.now() - penLifted < PALM_MS);

	// ---- Writing, with the Pencil (or a finger before the Pencil, or a mouse)

	const surface = $('drive-surface');
	function accepts(e) {
		if (e.pointerType === 'pen') { penSeen = true; return true; }
		return e.pointerType === 'mouse' || !penSeen;
	}
	surface.addEventListener('pointerdown', e => {
		if (!driving) return;
		if (e.pointerType === 'pen') {
			penDown = true;
			stopGlide();
			if (drag) { palms.add(drag.id); drag = null; }		// that finger was a palm
		}
		const control = controlAt(e);
		if (control) {
			e.preventDefault();
			tapping = isPalm(e) ? null : { id: e.pointerId, control, x: e.clientX, y: e.clientY, t: Date.now() };
			return;
		}
		if (isPalm(e)) { palms.add(e.pointerId); return; }
		if (e.pointerType === 'touch' && mode === 1) {
			e.preventDefault();
			const w = frameDeck();
			if (drag || !canScroll(w)) return;
			stopGlide();
			try { surface.setPointerCapture(e.pointerId); } catch (err) { /* already up */ }
			drag = { id: e.pointerId, startY: e.clientY, startScroll: scrolledTo(w), moved: false, samples: [] };
			return;
		}
		if (stroke || !accepts(e)) return;
		e.preventDefault();
		const w = frameDeck();
		if (!w) return status(frameReveal() ? NO_PEN : 'Waiting for the deck');
		try { surface.setPointerCapture(e.pointerId); } catch (err) { /* already up */ }
		const p = toDeck(e, w);
		stroke = { id: e.pointerId, last: p };
		if (erasing) emit({ type: 'erase', x: p.x, y: p.y });
	});
	surface.addEventListener('pointermove', e => {
		if (drag && e.pointerId === drag.id) {
			e.preventDefault();
			const dy = e.clientY - drag.startY;
			if (!drag.moved && Math.abs(dy) < DRAG_FROM) return;
			drag.moved = true;
			const w = frameDeck();
			if (!canScroll(w)) return;
			const y = Math.max(0, drag.startScroll - dy / pxPerUnit(w)), now = performance.now();
			drag.samples.push([now, y]);
			while (drag.samples.length > 2 && now - drag.samples[0][0] > 100) drag.samples.shift();
			scrollTo(w, y);
			return;
		}
		if (!stroke || e.pointerId !== stroke.id) return;
		e.preventDefault();
		const w = frameDeck();
		if (!w) return;
		const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
		for (const sample of samples.length ? samples : [e]) {
			const p = toDeck(sample, w), last = stroke.last;
			if (Math.hypot(p.x - last.x, p.y - last.y) < (erasing ? ERASE_MOVE : MIN_MOVE)) continue;
			if (erasing) emit({ type: 'erase', x: p.x, y: p.y });
			else emit({ type: 'draw', color: colour[mode], fromX: last.x, fromY: last.y, toX: p.x, toY: p.y });
			stroke.last = p;
		}
	});
	const lift = e => {
		if (e.pointerType === 'pen' && e.type !== 'lostpointercapture') { penDown = false; penLifted = Date.now(); }
		if (tapping && e.pointerId === tapping.id) {
			const t = tapping;
			tapping = null;
			if (e.type === 'pointerup' && Date.now() - t.t < 600 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12) pressControl(t.control);
			return;
		}
		if (palms.delete(e.pointerId)) return;
		if (stroke && e.pointerId === stroke.id) stroke = null;
		if (drag && e.pointerId === drag.id) {
			const s = drag.samples, moved = drag.moved;
			drag = null;
			// A flick: the speed of its last tenth of a second.
			const v = s.length > 1 ? Math.max(-4, Math.min(4, (s[s.length - 1][1] - s[0][1]) / Math.max(1, s[s.length - 1][0] - s[0][0]))) : 0;
			if (moved && e.type === 'pointerup' && Math.abs(v) > 0.3 && performance.now() - s[s.length - 1][0] < 60) startGlide(v);
		}
	};
	['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => surface.addEventListener(type, lift));
	surface.addEventListener('wheel', e => {
		const w = frameDeck();
		if (!driving || mode !== 1 || !canScroll(w)) return;
		e.preventDefault();
		stopGlide();
		scrollTo(w, scrolledTo(w) + e.deltaY / pxPerUnit(w));
	}, { passive: false });

	// ---- The tools

	function setMode(m) {
		erasing = false;
		if (m !== mode) {
			mode = m;
			stopGlide();
			forgetScroll();
			drag = null;
			emit(m === 1 ? { type: 'showChalkboard', mode: 1 } : { type: 'closeChalkboard', mode: 0 });
		}
		showTools();
	}

	// The deck's own colours: its pen's (boardmarkers) or its chalks; and,
	// for a deck with no chalkboard plugin, no writing tools at all.
	function showTools() {
		const w = frameDeck();
		const writable = !!w || !frameReveal();		// (until the copy is ready, as if it can)
		['d-pen', 'd-board', 'd-eraser', 'd-colours', 'd-clear'].forEach(id => { $(id).hidden = !writable; });
		if (!writable) status(NO_PEN, true);
		else if ($('d-status').textContent === NO_PEN) status('');
		$('d-pen').classList.toggle('on', mode === 0);
		$('d-board').classList.toggle('on', mode === 1);
		$('d-eraser').classList.toggle('on', erasing);
		const config = (w && w.Reveal.getConfig().chalkboard) || {};
		// (the board's own, as its palette shows them: chalks, or a whiteboard's markers)
		const palette = mode === 1 && w ? w.document.querySelector('div.palette[data-mode="1"]') : null;
		const colours = palette ? [...palette.querySelectorAll('li[data-color]')].map(li => ({ color: li.style.color }))
			: ((mode === 0 ? config.boardmarkers : config.chalks) || []);
		$('d-colours').replaceChildren(...colours.map((c, i) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'swatch' + (!erasing && colour[mode] === i ? ' on' : '');
			b.style.background = String(c.color).replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]*\)/, 'rgb($1,$2,$3)');
			b.setAttribute('aria-label', 'Colour ' + (i + 1));
			b.addEventListener('click', () => { colour[mode] = i; erasing = false; showTools(); });
			return b;
		}));
	}

	$('d-pen').addEventListener('click', () => setMode(0));
	$('d-board').addEventListener('click', () => setMode(1));
	$('d-eraser').addEventListener('click', () => { erasing = !erasing; showTools(); });
	$('d-clear').addEventListener('click', () => emit({ type: 'clear' }));
	$('d-prev').addEventListener('click', () => emit({ type: 'prev' }));
	$('d-next').addEventListener('click', () => emit({ type: 'next' }));

	// ---- The deck's own controls, which the tablet's copy shows as the
	// laptop does (see prepare() in presenter.html): reveal's arrows, a
	// customcontrols toolbar, the menu's button, and the chalkboard's handle
	// and colours.  A tap on one (found under the surface, which covers the
	// copy) does what it does on the laptop: the arrows and the overview move
	// the laptop, the question button shows or hides its code, a toolbar
	// button that toggles the chalkboard or the pen chooses Board or Pen, the
	// handle's arrows scroll the board and the colours are chosen; the menu,
	// full screen, printing and the PDF are the laptop's alone; in the
	// overview, which the copy shows when the laptop does, a slide goes to
	// that slide.  Only a tap counts, so that a palm resting on one, or a
	// touch just after the Pencil, presses nothing.  (Out of Drive a tap
	// reaches none of them: the copies have pointer-events: none.)
	const CONTROLS = '.controls button, #customcontrols li, #customcontrols > button, .slide-menu-button, div.boardhandle a, div.palette li, .reveal.overview .slides section';
	function controlAt(e) {
		const w = frameReveal();
		if (!w) return null;
		const rect = view.frame.getBoundingClientRect(), k = rect.width / FRAME_WIDTH;
		const hit = w.document.elementFromPoint((e.clientX - rect.left) / k, (e.clientY - rect.top) / k);
		return hit && hit.closest(CONTROLS);
	}
	// What a customcontrols button does, from its onclick (the plugin's
	// `action`), for a toolbar whose buttons have ids of their own choosing.
	const actionOf = control => ((control.matches('button') ? control : control.querySelector('button')) || control).getAttribute('onclick') || '';
	function pressControl(control) {
		const w = frameReveal();
		if (!w) return;
		if (control.matches('.reveal.overview .slides section')) {
			const i = w.Reveal.getIndices(control);
			return emit({ type: 'goto', h: i.h, v: i.v || 0 });
		}
		const direction = ['left', 'right', 'up', 'down'].find(d => control.classList.contains('navigate-' + d));
		if (direction) {
			if (!control.disabled) emit({ type: direction });
			return;
		}
		if (control.matches('div.palette li')) {
			if (control.hasAttribute('data-eraser')) erasing = true;
			else { colour[mode] = Number(control.dataset.color); erasing = false; }
			return showTools();
		}
		const half = w.Reveal.getConfig().height / 2;
		const action = actionOf(control);
		if (control.id === 'toggle-overview' || /toggleOverview\s*\(/.test(action)) return emit({ type: 'overview' });
		if (control.id === 'question-qr-button') return emit({ type: 'question' });
		if (control.id === 'blackboard-button' || /toggleChalkboard\s*\(/.test(action)) return setMode(mode === 1 ? 0 : 1);
		if (control.id === 'canvas-button' || /toggleNotesCanvas\s*\(/.test(action)) return setMode(0);
		switch (control.id) {
		case 'scrollboardup': return scrollTo(w, scrolledTo(w) - half);
		case 'scrollboarddown': return scrollTo(w, scrolledTo(w) + half);
		case 'toggleboardtheme':
			if (!w.RevealChalkboard || typeof w.RevealChalkboard.theme !== 'function') return;
			laptopLook = w.RevealChalkboard.theme() === 'whiteboard' ? 'chalkboard' : 'whiteboard';	// as the laptop will have it
			emit({ type: 'theme', theme: laptopLook });
			return showTools();
		case 'toggleboardgrid':
			if (!w.RevealChalkboard || typeof w.RevealChalkboard.gridShown !== 'function') return;
			laptopGrid = !w.RevealChalkboard.gridShown();		// as the laptop will have it
			return emit({ type: 'grid', grid: laptopGrid });
		}
		status('That one works on the laptop itself');
	}
	let tapping = null;				// a control touched: { id, control, x, y, t }

	function setDriving(on) {
		if (on && !view.key) {
			$('q-status').textContent = 'Enter the questions key to drive';
			return;
		}
		driving = on;
		stroke = null;
		drag = null;
		stopGlide();
		forgetScroll();
		document.body.classList.toggle('driving', on);
		$('drive-bar').hidden = !on;
		surface.hidden = !on;
		$('drive').classList.toggle('on', on);
		const w = frameDeck();
		if (on && w && typeof w.RevealChalkboard.boardOpen === 'function') mode = w.RevealChalkboard.boardOpen() ? 1 : 0;
		if (on) showTools();
	}
	$('drive').hidden = false;
	$('drive').addEventListener('click', () => setDriving(!driving));
	$('d-done').addEventListener('click', () => setDriving(false));

	// The timer, which the toolbar covers.
	const clock = $('timer');
	const showTimer = () => { $('d-timer').textContent = clock.textContent; };
	new MutationObserver(showTimer).observe(clock, { childList: true, characterData: true, subtree: true });
	showTimer();
})();
