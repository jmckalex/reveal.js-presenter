/*
 * reveal.js-presenter — the laptop's side of the tablet's Drive, and of the
 * ink the tablet shows.
 *
 * An ES module, imported by presenter-master.js only when the deck is opened
 * with ?master=<secret> and audience questions are on (the relay sends Drive's
 * strokes from, and the ink to, a tablet holding the questions key), unless
 * PresenterConfig.drive is false.  No other copy of the deck loads it: not
 * the published one, and not the tablet's own copies, which only show what
 * this sends.
 *
 * Driven from the tablet (presenter-driver.js there): its Pencil writes with
 * the deck's pen, on the slide, or on its chalkboard (which it scrolls), and
 * it steps back and forward.  The relay passes on only what the chalkboard
 * plugin's own messages may say (see its driverOp), and each stroke is handed
 * to the plugin as one of those ('received'), so the plugin draws, keeps and
 * replays it exactly as one made here.  A batch drawn on a slide this deck
 * has since left is not drawn (it would land on another slide), and one sent
 * again (the tablet heard no reply) is applied once.  The strokes need the
 * chalkboard plugin as client/vendor/chalkboard has it (rajgoel's, changed
 * for this); without the plugin, the steps still work and strokes are counted
 * as dropped.
 *
 * Ink, to the tablet: what is drawn here, so that the tablet's copy of the
 * slide shows what this screen does.  The chalkboard plugin announces each
 * thing drawn ('broadcast': a stroke, a sweep of the sponge, a canvas wiped,
 * the board opened, closed, scrolled, made white, ruled or not), which goes on
 * through the relay ('ink') to the tablet in a batch every 50 ms, each
 * numbered, with the slide it was drawn on (as this deck has it, with its own
 * steps, which the tablet's copy has too); so does what the tablet's Drive
 * draws here, marked as that page's (for any other tablet).  When the
 * tablet's copy arrives on a slide, or the tablet loads, it asks for the
 * slide's drawings so far ('ink-want'), which go in parts ('ink-slide': the
 * relay takes 64 KB a message at most) with the last number given, so that it
 * can tell what it already has; they go too when this page loads (it may have
 * none of what the tablet has, from before) or reconnects (what was drawn
 * meanwhile is lost), and when the plugin replaces every drawing ('init').
 * The numbers start again when this page loads, so each load has an id of its
 * own (run).  The slide's drawings so far need the plugin's slideDrawings();
 * with an older plugin, the tablet shows only what is drawn while it watches.
 */
export default function start(api) {
	'use strict';
	const ID = api.channel;
	const R = () => api.deck();
	const board = () => window.RevealChalkboard;
	const reveal = document.querySelector('.reveal');
	if (!reveal) return console.warn('[presenter] Drive: no .reveal element');
	let socket = null;

	// ---- Drive.
	const DRIVEN = new Set(['draw', 'erase', 'clear', 'scroll', 'theme', 'grid', 'showChalkboard', 'closeChalkboard']);
	const driven = new Map();		// a tablet page's id -> the last batch applied
	const stepOf = s => ({ h: s.indexh, v: s.indexv, f: Number.isInteger(s.indexf) ? s.indexf : -1 });
	// Whether the plugin keeps writing for the whole slide, through its
	// fragments, as client/vendor/chalkboard's does (it has boardScroll),
	// unless a deck sets perFragment; otherwise for each step.
	const chalkboardConfig = () => R().getConfig().chalkboard || {};
	const bySlide = () => !!board() && typeof board().boardScroll === 'function' && !chalkboardConfig().perFragment;
	// A moment after arriving on a slide (its "transition", 800 ms unless the
	// deck sets it), the plugin clears it and redraws what it has kept from
	// before, losing anything drawn in between: a batch arriving then waits
	// for that.  (After a fragment step too, if it keeps writing for each step.)
	let steppedAt = 0;
	reveal.addEventListener('slidechanged', () => { steppedAt = Date.now(); });
	['fragmentshown', 'fragmenthidden'].forEach(type => reveal.addEventListener(type, () => { if (!bySlide()) steppedAt = Date.now(); }));
	const settling = () => steppedAt + (chalkboardConfig().transition ?? 800) + 50 - Date.now();
	// A stroke is kept at the time on the slide's clock, as one drawn here
	// now (an older plugin has no clock to ask).
	const slideTime = () => Math.round(typeof board().slideTime === 'function' ? board().slideTime() : performance.now());
	// The steps: ◀ ▶, the four arrows as reveal's own controls take them (in
	// its 'linear' navigation mode, left and right are back and forward), the
	// overview, and the question button (or, in a deck without one, what it
	// does: the question code hidden or shown); and a slide chosen in the
	// overview, which closes it, as a click on one does.
	const linear = () => R().getConfig().navigationMode === 'linear';
	const STEPS = {
		next: () => R().next(), prev: () => R().prev(),
		left: () => linear() ? R().prev() : R().left(), right: () => linear() ? R().next() : R().right(),
		up: () => R().up(), down: () => R().down(), overview: () => R().toggleOverview(),
		question: () => {
			const b = document.querySelector('#question-qr-button button');
			if (b) b.click();
			else if (document.querySelector('.reveal .question-qr')) document.body.classList.toggle('question-qr-hidden');
		},
		goto: op => { if (R().isOverview()) R().toggleOverview(false); R().slide(op.h, op.v); }
	};
	function drive(batch, ack) {
		const reply = typeof ack === 'function' ? ack : () => {};
		if (!api.isReady() || !batch || !Array.isArray(batch.ops) || !batch.at
			|| typeof batch.from !== 'string' || !Number.isInteger(batch.seq)) return reply({ ok: false, reason: 'not-ready' });
		const wait = board() ? settling() : 0;
		if (wait > 0) return void setTimeout(() => drive(batch, ack), wait);
		if ((driven.get(batch.from) || 0) >= batch.seq) return reply({ ok: true, dropped: 0 });
		driven.set(batch.from, batch.seq);
		const here = stepOf(api.sharedState());
		const inPlace = !!board() && !R().isOverview() && here.h === batch.at.h && here.v === batch.at.v && (bySlide() || here.f === batch.at.f);
		let dropped = 0;
		for (const op of batch.ops) {		// a step, if any, comes last
			if (!op || typeof op.type !== 'string') continue;
			if (Object.hasOwn(STEPS, op.type)) STEPS[op.type](op);
			else if (!DRIVEN.has(op.type)) continue;
			else if (!inPlace) dropped++;
			else {
				const message = new CustomEvent('received');
				message.content = Object.assign({}, op, { sender: 'chalkboard-plugin', timestamp: slideTime() });
				document.dispatchEvent(message);
				queueInk(op, batch.from);
			}
		}
		reply({ ok: true, dropped });
		if (batch.ops.some(op => op && (op.type === 'theme' || op.type === 'grid'))) api.broadcast();		// the board's look, at once
	}

	// An older chalkboard plugin kept a stroke in the deck's own units (its
	// width by its height, letterboxed in the window) only after the window's
	// first resize; until then, in the window's pixels.  A resize puts it in
	// the deck's units at once, as the tablet's copy is, so that a stroke from
	// the tablet lands where it was drawn.  Nothing on the screen changes.
	// (After reveal's own 'ready' handlers, among them the plugin's, which
	// starts listening for resizes.)  client/vendor/chalkboard does this
	// itself.
	const nudge = () => setTimeout(() => {
		if (board() && typeof board().slideDrawings !== 'function') window.dispatchEvent(new Event('resize'));
	});
	if (api.isReady()) nudge();
	else reveal.addEventListener('ready', nudge, { once: true });

	// ---- Ink.
	const INK = new Set(['draw', 'erase', 'clear', 'scroll', 'theme', 'grid', 'showChalkboard', 'closeChalkboard', 'resetSlide']);
	const INK_RUN = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
	const INK_FIELDS = ['type', 'mode', 'board', 'color', 'fromX', 'fromY', 'toX', 'toY', 'x', 'y', 'theme', 'grid'];
	const INK_PART = 400;			// events in a part of a slide's drawings
	let inkNumber = 0, inkOut = [], inkTimer = null;
	const inkRound = v => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
	function queueInk(op, from) {
		if (!INK.has(op.type)) return;
		const ink = { n: ++inkNumber, at: stepOf(R().getState()) };
		INK_FIELDS.forEach(k => { if (op[k] !== undefined) ink[k] = inkRound(op[k]); });
		if (from) ink.from = from;
		inkOut.push(ink);
		if (!inkTimer) inkTimer = setTimeout(sendInk, 50);
	}
	document.addEventListener('broadcast', e => {
		if (!e.content || e.content.sender !== 'chalkboard-plugin') return;
		if (e.content.type === 'init') setTimeout(sendSlideInk);
		else queueInk(e.content);
	});
	function sendInk() {
		inkTimer = null;
		if (!socket || !socket.connected) { inkOut = []; return; }
		const at = inkOut[0].at, key = JSON.stringify(at);
		let k = 0;
		while (k < inkOut.length && k < 200 && JSON.stringify(inkOut[k].at) === key) k++;
		const ops = inkOut.splice(0, k).map(({ at, ...op }) => op);
		socket.emit('ink', { socketId: ID, run: INK_RUN, at, ops });
		if (inkOut.length) inkTimer = setTimeout(sendInk, 50);
	}
	function sendSlideInk() {
		if (!api.isReady() || !socket || !socket.connected || !board() || typeof board().slideDrawings !== 'function') return;
		const drawings = board().slideDrawings(), at = stepOf(R().getState());
		const compact = e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, inkRound(v)]));
		const all = drawings.notes.events.map(e => [0, compact(e)]).concat(drawings.board.events.map(e => [1, compact(e)]));
		const parts = Math.max(1, Math.ceil(all.length / INK_PART));
		for (let part = 0; part < parts; part++) {
			const chunk = all.slice(part * INK_PART, (part + 1) * INK_PART);
			socket.emit('ink-slide', {
				socketId: ID, run: INK_RUN, at, n: inkNumber, slide: drawings.slide, part, parts, mode: drawings.mode,
				durations: [drawings.notes.duration, drawings.board.duration],
				notes: chunk.filter(c => c[0] === 0).map(c => c[1]), board: chunk.filter(c => c[0] === 1).map(c => c[1])
			});
		}
	}
	// After the plugin's own 'ready', which makes its drawings.
	if (!api.isReady()) reveal.addEventListener('ready', () => setTimeout(sendSlideInk), { once: true });

	api.onSocket(s => {
		socket = s;
		// After the position (presenter-master.js sends it on 'connect' first),
		// which makes this the laptop to the relay.
		s.on('connect', () => setTimeout(sendSlideInk));
		s.on('driver', drive);
		s.on('ink-want', sendSlideInk);
		if (s.connected) setTimeout(sendSlideInk);
	});
}
