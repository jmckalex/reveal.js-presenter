/*
 * reveal.js-presenter — live polls, the board of shared questions and floating
 * reactions, on the laptop.
 *
 * An ES module, imported by presenter-master.js only when the deck is opened
 * with ?master=<secret> and audience questions are on, together with
 * presenter-polls.css.  The published deck never loads it, so there a .poll
 * is an empty element and a .poll-results an empty box.  presenter-master.js
 * hands the module what it needs (the relay socket, the secret, the deck);
 * see loadPolls() there.
 *
 * The tablet's own copies of the deck (?presenter) load it too, as a mirror,
 * so that they show what the laptop's screen does: it draws there everything
 * it draws on the laptop (the pill, the charts, the board, reactions), from
 * what the tablet page hands it through window.presenterMirror (see
 * presenter-master.js), and it connects to nothing and sends nothing.
 *
 * A slide asks a poll with, for instance,
 *     <live-poll name="sleep" kind="number" min="0" max="12" unit="hr|hrs"
 *                prompt="How long did you sleep?"></live-poll>
 * which presenter-master.js has already turned into the older markup this
 * module works on, and which still works too:
 *     <div class="poll" data-poll="sleep" data-kind="number" data-min="0"
 *          data-max="12" data-unit="hr|hrs" data-prompt="How long did you sleep?"></div>
 * (The comments below give options by those data-* names.)  Or
 * data-kind="choice" data-options="Yes|No|Not sure" (2 to 12 options;
 * data-picks="2" or "all" for several, and with them data-exclusive="None of
 * them", an option that stands alone; or, with one pick, a <template> per
 * version inside the <live-poll>: see pollDefinition()), "scale", "premises", "ranking",
 * "words", "self-others", "points", "grid" or "pin": README.md lists their
 * attributes, and drawScale() and the others below draw their charts.
 * data-repeat="<another poll>" asks that poll's question again, as a poll of
 * its own: with data-before on its results, the two are compared.
 * data-unit is a unit ("h", "%"), or a singular and plural ("hr|hrs"); it is
 * shown on the phones' buttons, the chart's labels and its median and mean.
 * data-instructions="Round to the nearest hour." (optional) is shown on the
 * phones under the "Live poll" title.
 *
 * While that slide is showing -- and, if the .poll is a fragment or inside
 * one, once it is visible -- the poll is open: the audience's ask pages show
 * it in place of the question form, and a pill at the foot of the screen
 * shows how many have answered (data-pill: see showPollStates()).  Leaving
 * the slide closes it.  <poll-results poll="sleep"></poll-results> on any
 * slide (the same one, or a later one; a fragment, to reveal it on a click)
 * draws the answers live.  Add overlay (class "overlay") for a card over the slide
 * instead, which comes up as a step of its own where it stands among the
 * slide's fragments, and exists only in this copy of the deck: other copies
 * of the slide are as written.  The relay keeps the tally, so a reload, or a
 * return to the slide, loses nothing.
 *
 * Every text from the deck or the audience is set with textContent, never
 * innerHTML.
 */
export default function start(api) {
	'use strict';
	const config = api.config;
	const MIRROR = api.mirror === true;		// a tablet's copy: see above
	const SECRET = api.secret;
	const ID = api.channel;
	const R = () => api.deck();
	const REPLY_MS = api.replyMs || 5000;		// no reply to poll-open in this long: a dead connection
	const PILL = typeof config.pollPill === 'string' ? config.pollPill : '';			// see showPollStates()
	const PILL_POSITION = typeof config.pollPillPosition === 'string' ? config.pollPillPosition : '';
	const REACTIONS = api.audience.reactions;											// see showReaction()
	const CLOUD_LIBRARY = config.d3Cloud || 'https://cdn.jsdelivr.net/npm/d3-cloud@1.2.9/build/d3.layout.cloud.js';
	// Where phones reach the site: a pin poll's picture must come from there,
	// even when this deck is served from localhost.
	const PUBLIC_ORIGIN = (() => { try { return new URL(config.askUrl).origin; } catch (e) { return location.origin; } })();
	const LOCALE = document.documentElement.lang || undefined;

	let socket = null;
	let reveal = null;

	function begin() {
		reveal = document.querySelector('.reveal');
		if (!reveal) return console.warn('[presenter] polls: no .reveal element');
		makeOverlaySteps();
		api.setStateFilter(sharedState);
		pill = document.createElement('div');
		pill.className = 'poll-pill';
		pill.hidden = true;
		pill.setAttribute('aria-live', 'polite');
		reveal.append(pill);

		const onReady = () => {
			document.querySelectorAll('.reveal .poll-results[data-poll]').forEach(box => { drawResults(box.dataset.poll); refit.observe(box); });
			placeOverlays(true);
			showBoard(board);
			// Fetch d3-cloud before the first word cloud needs it.
			if (document.querySelector('.reveal .poll[data-kind="words"]')) loadCloudLibrary().catch(e => console.warn('[presenter]', e.message));
			syncPolls();
			api.broadcast();
			// A mirror: from now on, what the tablet page hands it goes here
			// (presenter-master.js kept anything handed it before).
			if (MIRROR) api.mirrorReady({ tally: showTally, reset: resetPolls, board: showBoard, reaction: showReaction, sync: () => syncPolls() });
		};
		if (api.isReady()) onReady();
		else reveal.addEventListener('ready', onReady, { once: true });
		['slidechanged', 'fragmentshown', 'fragmenthidden'].forEach(type => reveal.addEventListener(type, syncPolls));
		['slidechanged', 'resize'].forEach(type => reveal.addEventListener(type, () => placeOverlays()));
		if (MIRROR) return;		// it connects to nothing

		api.onQuestionsOpened(res => { if (res && res.board) showBoard(res.board); });
		api.onSocket(s => {
			socket = s;
			s.on('connect', () => {
				openPoll = null;		// the relay may have restarted: reopen the slide's poll
				pollsUnsure = true;
				syncPolls();
			});
			s.on('poll-tally', showTally);
			s.on('reset', resetPolls);
			s.on('board', showBoard);
			s.on('reaction', showReaction);
			if (s.connected) { openPoll = null; pollsUnsure = true; syncPolls(); }
		});
	}

	// ---- Overlays: a .poll-results.overlay that is not a fragment becomes
	// one here, so in this deck alone it is a step of its own, where it stands
	// among the slide's fragments, gone again at the next step.  Every other
	// copy of the deck (the published one, the tablet's) lacks the step, so
	// the position sent to the tablet leaves it out (sharedState()).
	const MASTER_ONLY = 'data-master-only-step';
	const fragmentIndex = f => parseInt(f.getAttribute('data-fragment-index'), 10) || 0;
	function makeOverlaySteps() {
		const moved = [];
		document.querySelectorAll('.reveal .slides .poll-results.overlay:not(.fragment)').forEach(box => {
			const section = box.closest('section');
			const others = section ? [...section.querySelectorAll('.fragment')] : [];
			const numbered = others.filter(f => f.hasAttribute('data-fragment-index'));
			box.classList.add('fragment', 'fade-in-then-out');
			box.setAttribute(MASTER_ONLY, '');
			// Before reveal.js has started, its fragments are unnumbered, and it
			// numbers the new step in document order with the rest.  Once they
			// are numbered (reveal.js has started, or the deck numbers its own),
			// the step goes after the last fragment before it in the document,
			// and those numbered from there on move up one.
			if (!numbered.length) return;
			const before = numbered.filter(f => f.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING);
			const at = before.length ? Math.max(...before.map(fragmentIndex)) + 1 : 0;
			numbered.forEach(f => { if (fragmentIndex(f) >= at) f.setAttribute('data-fragment-index', fragmentIndex(f) + 1); });
			box.setAttribute('data-fragment-index', at);
			moved.push({ section, at });
		});
		// Opened part-way through such a slide (from its URL, say): show the
		// same fragments as before the renumbering.
		let deck = null;
		try { deck = R().isReady() ? R() : null; } catch (e) { /* not initialised */ }
		if (!deck) return;
		const state = deck.getState();
		const current = deck.getCurrentSlide();
		const shifts = moved.filter(m => m.section === current && typeof state.indexf === 'number' && m.at <= state.indexf).length;
		if (moved.some(m => m.section === current)) deck.slide(state.indexh, state.indexv, (state.indexf ?? -1) + shifts);
	}

	// The tablet's fragment index for this deck's: less the master-only steps
	// shown so far on this slide.
	function sharedState(state) {
		if (typeof state.indexf !== 'number') return state;
		const slide = R().getCurrentSlide();
		const ahead = [...(slide ? slide.querySelectorAll(`[${MASTER_ONLY}]`) : [])]
			.filter(f => fragmentIndex(f) <= state.indexf).length;
		return ahead ? Object.assign({}, state, { indexf: state.indexf - ahead }) : state;
	}

	// ---- Polls

	const warnedExclusive = new Set();
	function pollDefinition(el) {
		// A repeat takes the other poll's attributes, under its own id (and any
		// of its own that differ).
		const from = el.dataset.repeat ? byPoll('.poll', el.dataset.repeat)[0] : null;
		const d = from && from !== el ? { ...from.dataset, ...el.dataset } : el.dataset;
		const list = text => (text || '').split('|').map(x => x.trim()).filter(Boolean);
		const int = (text, fallback) => { const n = parseInt(text ?? '', 10); return Number.isInteger(n) ? n : fallback; };
		const base = { id: d.poll, kind: d.kind || 'choice', prompt: d.prompt || '', instructions: d.instructions || '' };
		switch (base.kind) {
		case 'number':
			return { ...base, min: int(d.min, 0), max: int(d.max, 10), unit: d.unit || '' };
		case 'scale': {
			const ends = (d.labels || '').split('|').map(x => x.trim());
			return { ...base, statements: list(d.statements), min: int(d.min, 1), max: int(d.max, 5), labels: [ends[0] || '', ends[1] || ''] };
		}
		case 'premises': {
			const statements = list(d.statements), labels = list(d.labels);
			return { ...base, statements, conclusion: int(d.conclusion, statements.length) - 1, labels: labels.length === 2 ? labels : ['Accept', 'Reject'] };
		}
		case 'ranking':
			return { ...base, options: list(d.options) };
		case 'words': {
			// Words go straight to the screen, but for any the relay's word
			// filter catches, which wait on the tablet; data-moderate="on"
			// holds every word for the tablet's approval.
			const vertical = parseFloat(d.vertical ?? '0.5');
			return { ...base, entries: int(d.entries, 1), moderated: d.moderate === 'on', filter: d.filter !== 'off',
				vertical: Number.isFinite(vertical) ? Math.min(1, Math.max(0, vertical)) : 0.5,
				colours: d.colours === 'shades' ? 'shades' : 'palette' };
		}
		case 'self-others': {
			const options = list(d.options);
			return { ...base, options: options.length ? options : ['Yes', 'No'], target: int(d.target, 1) - 1, others: d.others || '' };
		}
		case 'points':
			return { ...base, options: list(d.options), total: int(d.total, 100), unit: d.unit || '' };
		case 'grid': {
			const ends = text => { const e = (text || '').split('|').map(x => x.trim()); return [e[0] || '', e[1] || '']; };
			return { ...base, items: list(d.items), min: int(d.min, 0), max: int(d.max, 10), x: ends(d.x), y: ends(d.y) };
		}
		case 'pin': {
			// The phones load the image from the public site, even when this
			// deck is served from localhost; the laptop draws its own copy.
			const local = new URL(d.image || '', location.href);
			const image = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(local.hostname)
				? new URL(local.pathname + local.search, PUBLIC_ORIGIN) : local;		// (setting .host would keep the port)
			return { ...base, image: image.href, alt: d.alt || '', local: local.href };
		}
		default: {
			const options = list(d.options);
			// data-exclusive="None of them", with several picks: an option a
			// phone may choose only on its own (ticking it unticks the rest,
			// and the reverse), so "all" is all the others.
			const exclusive = d.exclusive === undefined ? -1 : options.indexOf(d.exclusive.trim());
			if (d.exclusive !== undefined && exclusive < 0 && !warnedExclusive.has(d.poll)) {
				warnedExclusive.add(d.poll);
				console.warn(`[presenter] poll "${d.poll}": exclusive="${d.exclusive}" is not one of its options`);
			}
			const most = exclusive < 0 ? options.length : options.length - 1;
			const picks = d.picks === 'all' ? most : Math.min(int(d.picks, 1), most);
			// Versions, for an experiment: the relay deals each phone one, in
			// turn, and sends it only that one's story and question.  Each is a
			// <template data-version="name" data-prompt="question"> inside the
			// <live-poll>, holding the story (as plain text).  Single pick only.
			const versions = [...el.querySelectorAll(':scope > template[data-version]')].map(t => ({
				name: t.dataset.version.trim(), prompt: (t.dataset.prompt || '').trim(), story: t.content.textContent.replace(/\s+/g, ' ').trim() }));
			if (versions.length >= 2 && picks === 1) return { ...base, kind: 'choice', options, versions };
			if (!(picks > 1)) return { ...base, kind: 'choice', options };
			return exclusive < 0 ? { ...base, kind: 'choice', options, picks } : { ...base, kind: 'choice', options, picks, exclusive };
		}
		}
	}
	// A number and its unit, in two parts, so that a chart label can wrap
	// between them: a unit starting with a letter stands apart ("3 hrs",
	// "1 hr"), any other hangs on the number ("42%").
	function unitParts(value, unit) {
		const [one, many = one] = (unit || '').split('|');
		const u = String(value) === '1' ? one : many;
		return !u ? [String(value), ''] : /^[A-Za-z]/.test(u) ? [String(value), u] : [value + u, ''];
	}
	const withUnit = (value, unit) => unitParts(value, unit).filter(Boolean).join(' ');
	const byPoll = (selector, id) => document.querySelectorAll(`.reveal ${selector}[data-poll="${CSS.escape(id)}"]`);
	const tallies = new Map();		// poll id -> its latest tally from the relay
	let openPoll = null;
	// After a reconnect the relay may have a poll open that this page has
	// since left (its poll-close lost with the dead connection), so the next
	// sync closes one even if this page thinks none is open.
	let pollsUnsure = true;

	// Open the poll on the current slide, if any, or close the open one; and
	// fetch the tallies of any results shown here for other polls.
	// (A mirror opens nothing: it shows the poll open that the laptop opens,
	// and asks the tablet page for the tallies.)
	function syncPolls() {
		if (!api.isReady() || (!MIRROR && (!socket || !socket.connected))) return;
		const slide = R().getCurrentSlide();
		const el = slide && [...slide.querySelectorAll('.poll[data-poll]')]
			.find(e => !e.closest('.fragment:not(.visible)'));
		if (MIRROR) openPoll = el ? el.dataset.poll : null;
		else if (el && el.dataset.poll !== openPoll) {
			openPoll = el.dataset.poll;
			const opened = (err, res) => {
				if (err) api.reconnect('poll-open');		// a new connection reopens the poll
				else if (res && res.ok) showTally(res.tally);
				else console.warn('[presenter] the relay refused poll "' + el.dataset.poll + '"', res);
			};
			const message = { socketId: ID, secret: SECRET, poll: pollDefinition(el) };
			// No reply means the connection is dead (see presenter-master.js).
			// (socket.timeout() is Socket.IO 4's; an older client just waits.)
			if (typeof socket.timeout === 'function') socket.timeout(REPLY_MS).emit('poll-open', message, opened);
			else socket.emit('poll-open', message, res => opened(null, res));
		}
		else if (!el && (openPoll !== null || pollsUnsure)) {
			openPoll = null;
			socket.emit('poll-close', { socketId: ID, secret: SECRET });
		}
		pollsUnsure = false;
		showPollStates();
		const wanted = new Set();
		for (const box of slide ? slide.querySelectorAll('.poll-results[data-poll]') : []) {
			wanted.add(box.dataset.poll);
			if (box.dataset.before) wanted.add(box.dataset.before);
		}
		if (MIRROR) {
			if (openPoll !== null) wanted.add(openPoll);
			return api.want([...wanted]);
		}
		for (const id of wanted) {
			if (id === openPoll) continue;
			socket.emit('poll-results', { socketId: ID, secret: SECRET, id }, res => {
				if (res && res.ok) showTally(res.tally);
			});
		}
	}

	function showTally(tally) {
		if (!tally || typeof tally.id !== 'string') return;
		tallies.set(tally.id, tally);
		drawResults(tally.id);
		showPollStates();
	}

	// The tablet's Reset: the relay has forgotten every poll, so every chart
	// starts empty again.  A poll open now stays open (the relay opened it
	// again), and its new, empty tally follows.
	function resetPolls() {
		tallies.clear();
		new Set([...document.querySelectorAll('.reveal .poll-results[data-poll]')].map(box => box.dataset.poll)).forEach(drawResults);
		showPollStates();
	}

	// While a poll is open, a pill at the foot of the screen says how many have
	// answered: off the slide, so that no slide's layout changes.  It gives
	// way to the poll's overlay, whose chart says the same.  What it says is
	// the poll's data-pill, or else PresenterConfig.pollPill: '' (the default)
	// for "Answer on your phone · 3 answers", 'icon' for the phone icon alone
	// (the full text on hover), 'none' for no pill, or any other text, in which
	// {n} is the number of answers and {answers} is "3 answers".  It sits at
	// the bottom centre, or where the poll's data-pill-position or
	// PresenterConfig.pollPillPosition says: bottom-left, bottom-right, top,
	// top-left or top-right.
	let pill = null;
	const showing = box => box.classList.contains('visible') && (!box.classList.contains('fade-in-then-out') || box.classList.contains('current-fragment'));
	function phoneIcon() {
		const svg = svgNode('svg');
		svg.setAttribute('viewBox', '0 0 16 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('class', 'poll-pill-icon');
		const body = svgNode('rect');
		Object.entries({ x: 1.5, y: 1.5, width: 13, height: 21, rx: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 })
			.forEach(([k, v]) => body.setAttribute(k, v));
		const button = svgNode('circle');
		Object.entries({ cx: 8, cy: 18.6, r: 1.3, fill: 'currentColor' }).forEach(([k, v]) => button.setAttribute(k, v));
		svg.append(body, button);
		return svg;
	}
	function showPollStates() {
		if (!pill || !api.isReady()) return;
		const slide = R().getCurrentSlide();
		const covered = !!slide && [...slide.querySelectorAll('.poll-results.overlay')].some(showing);
		const el = openPoll === null ? null
			: (slide && slide.querySelector(`.poll[data-poll="${CSS.escape(openPoll)}"]`)) || byPoll('.poll', openPoll)[0];
		const setting = (el && el.dataset.pill !== undefined ? el.dataset.pill : PILL).trim();
		const where = ((el && el.dataset.pillPosition) || PILL_POSITION || 'bottom').trim();
		pill.dataset.position = ['bottom-left', 'bottom-right', 'top', 'top-left', 'top-right'].includes(where) ? where : 'bottom';
		pill.hidden = openPoll === null || covered || setting === 'none';
		if (openPoll === null) return;
		const n = (tallies.get(openPoll) || {}).total || 0;
		const answers = `${n} answer${n === 1 ? '' : 's'}`;
		const full = `Answer on your phone · ${answers}`;
		const text = setting === 'icon' || setting === 'none' ? ''
			: setting ? setting.replaceAll('{n}', n).replaceAll('{answers}', answers) : full;
		pill.replaceChildren(phoneIcon(), text);			// the deck's own text: never innerHTML
		pill.classList.toggle('icon-only', !text);
		pill.title = text === full ? '' : full;
	}

	// Draw every .poll-results for a poll, from its definition (its .poll, on
	// whichever slide) and its tally; and every one comparing it, as the
	// earlier poll, with a later one (data-before).
	const KINDS = ['choice', 'number', 'scale', 'premises', 'ranking', 'words', 'self-others', 'points', 'grid', 'pin', 'compare', 'versions'];
	function drawResults(id) {
		const el = byPoll('.poll', id)[0];
		if (el) {
			const def = pollDefinition(el);
			const tally = tallies.get(id) || { total: 0 };
			const boxes = [...byPoll('.poll-results', id)];
			const draw = def.versions ? drawVersions : { choice: drawBars, number: drawBars, scale: drawScale, premises: drawPremises, ranking: drawRanking, words: drawWords,
				'self-others': drawSelfOthers, points: drawPoints, grid: drawGrid, pin: drawPin }[def.kind];
			if (draw) draw(def, tally, boxes.filter(b => !b.dataset.before));
			boxes.filter(b => b.dataset.before).forEach(drawCompare);
		}
		document.querySelectorAll(`.reveal .poll-results[data-before="${CSS.escape(id)}"]`).forEach(drawCompare);
	}

	// A number poll's answers, from the tally's answers (or, from an older
	// relay, its counts).
	function numberValues(def, tally) {
		if (Array.isArray(tally.answers)) return tally.answers.map(a => a[1]).filter(Number.isFinite);
		const out = [];
		(tally.counts || []).forEach((n, k) => { for (let i = 0; i < n; i++) out.push(def.min + k); });
		return out;
	}
	const median = sorted => sorted.length ? sorted[Math.ceil(sorted.length / 2) - 1] : null;
	const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
	// A number for a chart: grouped in thousands, with up to digits decimals,
	// or exactly one (a mean: "4.0").
	const fmt = (x, digits = 1) => Number.isInteger(x) ? x.toLocaleString(LOCALE) : x.toLocaleString(LOCALE, { maximumFractionDigits: digits });
	const fmtMean = x => x.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

	// A number poll's columns: one per value up to 25 values; otherwise about a
	// dozen, of a round width (1, 2 or 5 times a power of ten), across the
	// range, or, for a range of over 200 values (a guess at a quantity), across
	// the answers given and any value marked on the chart.
	function numberBins(def, values, marks) {
		if (def.max - def.min < 25) {
			const starts = [];
			for (let v = def.min; v <= def.max; v++) starts.push(v);
			return { width: 1, starts };
		}
		let lo = def.min, hi = def.max;
		const seen = values.concat(marks.filter(m => m >= def.min && m <= def.max));
		if (def.max - def.min >= 200 && seen.length) { lo = Math.min(...seen); hi = Math.max(...seen); }
		const raw = Math.max(1, (hi - lo + 1) / 12);
		const power = 10 ** Math.floor(Math.log10(raw));
		const width = [1, 2, 5, 10].map(m => m * power).find(w => w >= raw);
		const starts = [];
		for (let v = Math.floor(lo / width) * width; v <= hi; v += width) starts.push(v);
		return { width, starts };
	}
	// A fraction written "2/3" or "0.67".
	const fraction = text => { const [a, b] = String(text).split('/').map(Number); return b ? a / b : a; };

	// Choice and number polls: bars, built once and then only resized, so that
	// they grow smoothly as answers arrive.  A chart may also mark the right
	// answer (data-answer: an option, or the true value of a quantity), or
	// play a classroom game with the answers: data-display="beauty" (a guess
	// at two-thirds of the average: data-fraction), "coordination" (the most
	// common answer wins), or data-payoffs on a choice poll (a game against
	// the room: see payoffLines()).  See decorate().
	function drawBars(def, tally, boxes) {
		const count = k => (tally.counts || [])[k] || 0;
		const values = def.kind === 'number' ? numberValues(def, tally) : null;
		let summary = plural(tally.total, 'answer') + (def.picks ? ` · up to ${def.picks} picks each` : '');
		if (def.kind === 'number' && values.length) {
			const sorted = [...values].sort((a, b) => a - b);
			summary += ` · median ${withUnit(fmt(median(sorted)), def.unit)} · mean ${withUnit(fmtMean(mean(values)), def.unit)}`;
		}
		for (const box of boxes) {
			let bins;
			if (def.kind === 'choice') {
				bins = def.options.map((label, k) => ({ label, n: count(k), k }));
			}
			else {
				// Per chart, since a marked true value widens the span shown.
				const truth = parseFloat(box.dataset.answer);
				const { width, starts } = numberBins(def, values, Number.isFinite(truth) ? [truth] : []);
				bins = starts.map(v => {
					const lo = Math.max(v, def.min), hi = Math.min(v + width - 1, def.max);
					return { label: lo === hi ? String(lo) : `${lo}–${hi}`, lo, hi, n: values.filter(x => x >= lo && x <= hi).length };
				});
			}
			const most = Math.max(1, ...bins.map(b => b.n));
			const layout = def.kind + ':' + bins.map(b => b.label).join('|');
			if (box.dataset.layout !== layout) {
				box.dataset.layout = layout;
				box.classList.remove(...KINDS);
				box.classList.add(def.kind);
				const chart = node('div', 'chart');
				for (const b of bins) {
					const label = node('span', 'label'), bar = node('span', 'bar'), n = node('span', 'count');
					if (def.kind === 'choice') {
						label.textContent = b.label;
						chart.append(label, bar, n);
					}
					else {
						// A sign ("%") hangs on the number, with no space, but is a
						// span of its own too, so that fitLabels() can drop it from
						// labels too wide for their columns ("10–19%" under eleven).
						const [number, word] = unitParts(b.label, def.unit);
						const sign = !word && number !== b.label ? number.slice(b.label.length) : '';
						label.append(node('span', '', sign ? b.label : number));
						if (word) label.append(' ', node('span', 'word', word));
						else if (sign) label.append(node('span', 'word sign', sign));
						const col = node('div', 'col');
						col.append(n, bar);
						chart.append(col, label);
					}
				}
				box.replaceChildren(chart, node('div', 'summary'));
				if (box.classList.contains('overlay') && def.prompt) box.prepend(node('div', 'prompt', def.prompt));
				box.classList.toggle('long-labels', def.kind === 'number' && bins.some(b => b.label.length > 7));
				fitLabels(box);
			}
			box.querySelectorAll('.bar').forEach((bar, k) => bar.style.setProperty('--share', bins[k].n / most));
			box.querySelectorAll('.count').forEach((n, k) => { n.textContent = def.kind === 'number' && !bins[k].n ? '' : bins[k].n; });
			box.querySelector('.summary').textContent = summary;
			decorate(def, tally, box, bins, values);
		}
	}

	// What a chart adds to its bars: the right answer, or a game's outcome.
	// Marks and lines are drawn afresh each time.
	function decorate(def, tally, box, bins, values) {
		box.querySelectorAll('.mark, .extra').forEach(e => e.remove());
		box.querySelectorAll('.win').forEach(e => e.classList.remove('win'));
		const lines = [];
		const win = k => {			// highlight a column or row
			const bars = box.querySelectorAll('.bar'), labels = box.querySelectorAll('.label');
			if (bars[k]) bars[k].classList.add('win');
			if (labels[k]) labels[k].classList.add('win');
		};
		const binOf = v => bins.findIndex(b => v >= b.lo && v <= b.hi);
		const mark = (v, text, cls) => {			// a dashed line at v on a number chart, labelled
			const k = binOf(Math.round(v));
			const col = box.querySelectorAll('.col')[k];
			if (!col) return;
			const b = bins[k];
			const m = node('div', 'mark ' + (cls || ''));
			m.style.left = (100 * (v - b.lo + 0.5) / (b.hi - b.lo + 1)) + '%';
			if (text) m.append(node('span', '', text));
			col.append(m);
		};
		const n = tally.total || 0;
		const display = box.dataset.display || '';

		if (box.dataset.answer !== undefined && def.kind === 'choice') {
			// The right option, by its text or its number (from 1).
			const a = box.dataset.answer.trim();
			let k = def.options.findIndex(o => o.toLowerCase() === a.toLowerCase());
			if (k < 0 && /^\d+$/.test(a)) k = Number(a) - 1;
			if (k >= 0 && k < def.options.length) {
				win(k);
				const right = (tally.counts || [])[k] || 0;
				lines.push(`The answer: ${def.options[k]}.` + (n ? `  ${Math.round(100 * right / n)}% chose it.` : ''));
				const top = Math.max(...bins.map(b => b.n));
				if (n && !def.picks) lines.push(bins[k].n === top && bins.filter(b => b.n === top).length === 1
					? 'The most common answer was the right one.' : 'The most common answer was not the right one.');
			}
		}
		if (box.dataset.answer !== undefined && def.kind === 'number') {
			// A guess at a quantity: how the crowd did against the truth.
			const truth = parseFloat(box.dataset.answer);
			if (Number.isFinite(truth)) {
				mark(truth, 'True value', 'truth');
				const line = [`The true value: ${withUnit(fmt(truth), def.unit)}.`];
				if (values.length) {
					const mid = median([...values].sort((a, b) => a - b));
					const off = Math.abs(mid - truth);
					const beaten = values.filter(v => Math.abs(v - truth) > off).length;
					line.push(`The median guess, ${withUnit(fmt(mid), def.unit)}, was ${off ? 'off by ' + withUnit(fmt(off), def.unit) : 'exactly right'},`
						+ ` closer than ${Math.round(100 * beaten / values.length)}% of the guesses.`);
				}
				lines.push(line.join('  '));
			}
		}
		if (display === 'beauty' && def.kind === 'number' && values.length) {
			// Guess p of the average: the closest guess wins.  Level-k reasoning
			// gives 50p, 50p², ...: marked, faintly, when the range is 0 to 100.
			const p = fraction(box.dataset.fraction || '2/3');
			const average = mean(values), target = p * average;
			const best = Math.min(...values.map(v => Math.abs(v - target)));
			const winners = values.filter(v => Math.abs(v - target) === best);
			[...new Set(winners)].forEach(v => win(binOf(v)));
			if (def.min === 0 && def.max === 100) for (let k = 1, v = 50 * p; k <= 4 && v >= 1; k++, v *= p) mark(v, 'L' + k, 'level');
			mark(average, 'Average', 'average');
			mark(target, box.dataset.fraction ? `${box.dataset.fraction} of it` : '⅔ of it', 'target');
			const won = [...new Set(winners)];
			lines.push(`The average guess was ${fmt(average)}, so the target was ${fmt(target)}.`
				+ `  Winning guess${won.length > 1 ? 'es' : ''}: ${won.map(v => fmt(v)).join(' and ')} (${winners.length} ${winners.length === 1 ? 'person' : 'people'}).`);
		}
		if (display === 'coordination' && n) {
			// The most common answer wins: everyone who gave it coordinated.
			const top = Math.max(...bins.map(b => b.n));
			const modes = bins.map((b, k) => b.n === top ? k : -1).filter(k => k >= 0);
			modes.forEach(win);
			const names = modes.map(k => bins[k].label);
			lines.push(`Most common: ${names.join(' and ')}, chosen by ${top} of ${n} (${Math.round(100 * top / n)}%).`
				+ (modes.length > 1 ? '  A tie: no single point to coordinate on.' : '  Everyone who chose it coordinated.'));
		}
		if (box.dataset.payoffs && def.kind === 'choice' && !def.picks) lines.push(...payoffLines(def, tally, box, win));
		lines.forEach(text => box.insertBefore(node('div', 'extra', text), box.querySelector('.summary')));
	}

	// A symmetric game against the room: data-payoffs gives, for each option
	// (a row, separated by "|"), what it earns against each option the other
	// player might choose (numbers, by spaces or commas).  Each option's
	// expected payoff is what it earns against someone picked at random from
	// the rest of the room; the best reply to the room is highlighted.  For the
	// stag hunt, data-options="Stag|Hare" data-payoffs="4 0 | 3 3".
	function payoffLines(def, tally, box, win) {
		const rows = box.dataset.payoffs.split('|').map(r => r.trim().split(/[\s,]+/).map(Number));
		const m = def.options.length;
		if (rows.length !== m || rows.some(r => r.length !== m || r.some(x => !Number.isFinite(x)))) return ['(data-payoffs needs a row of numbers for each option.)'];
		const counts = def.options.map((_, k) => (tally.counts || [])[k] || 0);
		const n = counts.reduce((a, b) => a + b, 0);
		if (n < 2) return [];
		const expected = rows.map((row, i) => row.reduce((sum, x, j) => sum + x * (counts[j] - (i === j ? 1 : 0)), 0) / (n - 1));
		const best = Math.max(...expected);
		expected.forEach((e, k) => { if (e === best) win(k); });
		const average = counts.reduce((sum, c, k) => sum + c * expected[k], 0) / n;
		return [`Against someone picked at random from this room: ${def.options.map((o, k) => `${o} earns ${fmt(expected[k], 2)}`).join(', ')}.`,
			`The best reply to the room: ${def.options.filter((_, k) => expected[k] === best).join(' and ')}.  The room averaged ${fmt(average, 2)}.`];
	}

	const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const answersOf = tally => (tally.answers || []).map(a => a[1]);
	const node = (tag, cls, text) => {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;		// the deck's or the audience's text: never innerHTML
		return e;
	};
	const svgNode = tag => document.createElementNS('http://www.w3.org/2000/svg', tag);
	// Fill a box afresh: the prompt (on an overlay), the chart, and a summary.
	function fill(box, def, chart, ...summary) {
		delete box.dataset.layout;
		box.classList.remove(...KINDS);
		box.classList.add(def.kind);
		const parts = [];
		if (box.classList.contains('overlay') && def.prompt) parts.push(node('div', 'prompt', def.prompt));
		parts.push(chart, ...summary.filter(Boolean).map(line => node('div', 'summary', line)));
		box.replaceChildren(...parts);
	}
	// The palette (--poll-colour-1 … -8 in presenter-polls.css), by number from 0.
	const colour = k => `var(--poll-colour-${(k % 8) + 1})`;
	// Shades of the accent colour, from light (0) to full (1).
	const shade = t => `color-mix(in srgb, var(--poll-accent) ${Math.round(18 + 82 * t)}%, var(--poll-card))`;

	// A choice poll in versions (see pollDefinition()): a column per version,
	// the share of its answers choosing one option (data-share, an option's
	// text; the first by default), with how many that is of how many; and,
	// with data-reference ("82|23": a percentage per version), a dashed mark
	// on each column, labelled with data-reference-label ("Knobe: 82%").  The
	// summary says how many phones the relay dealt each version.  Built once
	// and then only resized, so that the columns grow as answers arrive.  (The
	// tally's counts are per version and option: version × options + option.)
	function drawVersions(def, tally, boxes) {
		const m = def.options.length, counts = tally.counts || [], dealt = tally.dealt || [];
		for (const box of boxes) {
			const wanted = (box.dataset.share || '').trim().toLowerCase();
			const t = Math.max(0, def.options.findIndex(o => o.toLowerCase() === wanted));
			const refs = (box.dataset.reference || '').split('|').map(parseFloat);
			const layout = ['versions', ...def.versions.map(v => v.name), t, box.dataset.reference || ''].join('|');
			if (box.dataset.layout !== layout) {
				const chart = node('div', 'chart');
				def.versions.forEach((v, k) => {
					const column = node('div', 'column');
					column.append(node('div', 'bar'));
					if (Number.isFinite(refs[k])) {
						const mark = node('div', 'reference');
						mark.style.setProperty('--at', Math.min(100, Math.max(0, refs[k])) / 100);
						mark.append(node('span', '', (box.dataset.referenceLabel ? box.dataset.referenceLabel + ': ' : '') + fmt(refs[k]) + '%'));
						column.append(mark);
					}
					const version = node('div', 'version');
					version.append(node('div', 'share'), column, node('div', 'name', v.name), node('div', 'count'));
					chart.append(version);
				});
				fill(box, { ...def, kind: 'versions' }, chart, ' ');
				box.dataset.layout = layout;
			}
			box.querySelectorAll('.version').forEach((e, k) => {
				const n = counts.slice(k * m, (k + 1) * m).reduce((a, b) => a + (b || 0), 0), chose = counts[k * m + t] || 0;
				e.querySelector('.share').textContent = n ? Math.round(100 * chose / n) + '%' : '–';
				e.querySelector('.bar').style.setProperty('--share', n ? chose / n : 0);
				e.querySelector('.count').textContent = `${chose} of ${n} said “${def.options[t]}”`;
			});
			box.querySelector('.summary').textContent = plural(tally.total || 0, 'answer')
				+ (dealt.length ? ' · dealt ' + def.versions.map((v, k) => `${v.name} ${dealt[k] || 0}`).join(', ') : '');
		}
	}

	// A scale: for each statement, a bar divided by rating, lightest for the
	// lowest, with the mean beside it, and a key below.
	function drawScale(def, tally, boxes) {
		const answers = answersOf(tally), n = answers.length;
		const steps = def.max - def.min;
		for (const box of boxes) {
			const chart = node('div', 'chart');
			def.statements.forEach((text, k) => {
				const stack = node('div', 'stack');
				let sum = 0;
				for (let v = def.min; v <= def.max; v++) {
					const c = answers.filter(a => a[k] === v).length;
					sum += c * v;
					if (!c) continue;
					const seg = node('span', 'seg', c / n >= 0.06 ? String(c) : '');
					seg.style.width = (100 * c / n) + '%';
					seg.style.background = shade((v - def.min) / steps);
					if ((v - def.min) / steps > 0.5) seg.classList.add('dark');
					stack.append(seg);
				}
				chart.append(node('div', 'statement', text), stack, node('div', 'mean', n ? (sum / n).toFixed(1) : '–'));
			});
			const key = node('div', 'key');
			key.append(node('span', 'end', def.labels[0]));
			for (let v = def.min; v <= def.max; v++) {
				const sw = node('span', 'swatch' + ((v - def.min) / steps > 0.5 ? ' dark' : ''), String(v));
				sw.style.background = shade((v - def.min) / steps);
				key.append(sw);
			}
			key.append(node('span', 'end', def.labels[1]));
			fill(box, def, chart, plural(n, 'answer') + ' · the number beside each bar is its mean');
			box.insertBefore(key, box.querySelector('.summary'));
		}
	}

	// Premises: how many accept each statement, against the halfway mark, and
	// what the answers taken together show.  The premise-by-premise majorities
	// and the majority on the conclusion can come apart: the discursive
	// dilemma.
	function drawPremises(def, tally, boxes) {
		const answers = answersOf(tally), n = answers.length;
		const premises = def.statements.map((_, k) => k).filter(k => k !== def.conclusion);
		const tag = k => k === def.conclusion ? 'C' : 'P' + (premises.indexOf(k) + 1);
		const yes = k => answers.filter(a => a[k] === 1).length;
		const verdict = k => 2 * yes(k) > n ? 'accept' : 2 * yes(k) < n ? 'reject' : 'tie';
		const lines = [];
		if (n) {
			const all = answers.filter(a => premises.every(k => a[k] === 1));
			const odd = all.filter(a => a[def.conclusion] === 0).length;
			lines.push(`${all.length} ${all.length === 1 ? 'person accepts' : 'people accept'} every premise` + (all.length ? `; ${odd} of them reject${odd === 1 ? 's' : ''} the conclusion.` : '.'));
			const doubters = answers.filter(a => a[def.conclusion] === 0);
			if (doubters.length) {
				const dropped = premises.map(k => [tag(k), doubters.filter(a => a[k] === 0).length]).filter(([, c]) => c);
				if (dropped.length) lines.push(`Those who reject the conclusion reject ${dropped.map(([t, c]) => `${t} (${c})`).join(', ')}.`);
			}
			if (premises.every(k => verdict(k) === 'accept') && verdict(def.conclusion) === 'reject')
				lines.push('A majority accepts every premise, yet a majority rejects the conclusion: the discursive dilemma.');
			else if (verdict(def.conclusion) === 'accept' && premises.some(k => verdict(k) === 'reject'))
				lines.push(`A majority accepts the conclusion, though a majority rejects ${premises.filter(k => verdict(k) === 'reject').map(tag).join(' and ')}.`);
		}
		for (const box of boxes) {
			const chart = node('div', 'chart');
			def.statements.forEach((text, k) => {
				const bar = node('div', 'track');
				const fillBar = node('span', 'bar');
				fillBar.style.width = n ? (100 * yes(k) / n) + '%' : '0%';
				bar.append(fillBar, node('span', 'half'));
				const v = n ? verdict(k) : '';
				chart.append(node('div', 'tag' + (k === def.conclusion ? ' conclusion' : ''), tag(k)), node('div', 'statement', text), bar,
					node('div', 'count', n ? `${yes(k)}/${n}` : ''), node('div', 'verdict ' + v, v === 'accept' ? '✓' : v === 'reject' ? '✗' : v === 'tie' ? '=' : ''));
			});
			fill(box, def, chart, `${plural(n, 'answer')} · bars show how many ${def.labels[0].toLowerCase()} each statement; the line marks half`, ...lines);
		}
	}

	// Rankings, as given by four voting rules applied to the same ballots.
	function votingRules(options, ballots) {
		const m = options.length, n = ballots.length;
		const order = scores => {			// "A > B = C > D", highest first
			const groups = [...new Set(scores)].sort((x, y) => y - x).map(sc => options.filter((_, k) => scores[k] === sc));
			return groups.map(g => g.join(' = ')).join(' > ');
		};
		const top = scores => { const best = Math.max(...scores); return options.filter((_, k) => scores[k] === best); };
		const first = options.map((_, k) => ballots.filter(b => b[0] === k).length);
		const borda = options.map((_, k) => ballots.reduce((sum, b) => sum + m - 1 - b.indexOf(k), 0));
		const position = ballots.map(b => { const p = []; b.forEach((o, i) => { p[o] = i; }); return p; });
		const prefer = (x, y) => position.filter(p => p[x] < p[y]).length;
		const wins = options.map((_, x) => options.filter((_, y) => y !== x && prefer(x, y) > prefer(y, x)).length);
		const condorcet = options.filter((_, x) => wins[x] === m - 1);
		// Instant runoff: drop the option(s) with fewest first choices among
		// those left, until one has a majority (or all left are tied).
		let left = options.map((_, k) => k), out = [], winners = [], last = [];
		while (left.length) {
			const votes = left.map(k => ballots.filter(b => b.find(o => left.includes(o)) === k).length);
			const best = Math.max(...votes), worst = Math.min(...votes);
			if (2 * best > n || best === worst) {
				winners = left.filter((_, i) => votes[i] === best);
				// The rest of the final round, by their votes in it.
				last = [...new Set(votes)].sort((x, y) => y - x).filter(v => v !== best).map(v => left.filter((_, i) => votes[i] === v));
				break;
			}
			const dropped = left.filter((_, i) => votes[i] === worst);
			out.push(dropped);
			left = left.filter(k => !dropped.includes(k));
		}
		const irvOrder = [winners, ...last, ...out.reverse()].map(g => g.map(k => options[k]).join(' = ')).join(' > ');
		return [
			{ rule: 'Plurality', note: 'first choices only', winners: top(first), order: order(first) },
			{ rule: 'Borda count', note: 'points for every position', winners: top(borda), order: order(borda) },
			{ rule: 'Condorcet', note: 'beats every other head to head', winners: condorcet, order: order(wins), none: 'None: no option beats all the others' },
			{ rule: 'Instant runoff', note: 'drop the last, recount', winners: winners.map(k => options[k]), order: irvOrder }
		];
	}

	// A ranking: the options by average position, or (data-display="rules")
	// the winner under each of four voting rules.
	function drawRanking(def, tally, boxes) {
		const ballots = answersOf(tally), n = ballots.length, m = def.options.length;
		for (const box of boxes) {
			if (box.dataset.display === 'rules') {
				const table = node('div', 'chart rules');
				table.append(node('div', 'head', 'Rule'), node('div', 'head', 'Winner'), node('div', 'head', 'Full order'));
				const results = n ? votingRules(def.options, ballots) : [];
				for (const r of results) {
					const rule = node('div', 'rule', r.rule);
					rule.append(node('span', 'note', r.note));
					table.append(rule, node('div', 'winner', r.winners.length ? r.winners.join(' = ') + (r.winners.length > 1 ? ' (tie)' : '') : r.none), node('div', 'order', r.order));
				}
				const agree = new Set(results.map(r => r.winners.join(' = '))).size === 1;
				fill(box, def, table, plural(n, 'ballot') + (n ? (agree ? ' · the rules agree' : ' · the rules disagree') : ''));
				box.classList.add('rules');
				continue;
			}
			const average = def.options.map((_, k) => n ? 1 + ballots.reduce((sum, b) => sum + b.indexOf(k), 0) / n : null);
			const chart = node('div', 'chart');
			def.options.map((label, k) => ({ label, k, mean: average[k] })).sort((x, y) => (x.mean ?? 0) - (y.mean ?? 0)).forEach(o => {
				const bar = node('span', 'bar');
				bar.style.setProperty('--share', o.mean === null || m < 2 ? 0 : (m - o.mean) / (m - 1));
				chart.append(node('span', 'label', o.label), bar, node('span', 'count', o.mean === null ? '' : o.mean.toFixed(1)));
			});
			fill(box, def, chart, plural(n, 'ballot') + ' · ordered by average position (1 is first)');
			box.classList.add('choice');
		}
	}

	// ---- Before and after: <poll-results poll="after" before="before">,
	// where "after" asks "before"'s question again
	// (data-repeat).  Phones are matched by their aliases (the same for a
	// phone across a session's polls), so the chart shows who changed their
	// mind, not just the totals.  A single-pick choice poll gives a flow from
	// each earlier answer to each later one; a number poll, a line per phone
	// from its first answer to its second; a scale, premises, points or
	// ranking poll, each row's average before and after.  The two polls need
	// not be one question asked twice: data-headings="Harm|Help" names the two
	// sides (otherwise "Before" and "After"), and the summary then says who
	// answered differently rather than who changed their minds.
	function drawCompare(box) {
		const afterEl = byPoll('.poll', box.dataset.poll)[0], beforeEl = byPoll('.poll', box.dataset.before)[0];
		if (!afterEl || !beforeEl) return;
		const after = pollDefinition(afterEl), before = pollDefinition(beforeEl);
		const first = new Map((tallies.get(before.id) || {}).answers || []);
		const second = new Map((tallies.get(after.id) || {}).answers || []);
		const both = [...second.keys()].filter(a => first.has(a));
		const pairs = both.map(a => [first.get(a), second.get(a)]);
		const changed = pairs.filter(([x, y]) => JSON.stringify(x) !== JSON.stringify(y)).length;
		const only = [first.size - both.length, second.size - both.length];
		const tail = only[0] || only[1] ? `  (Not counted: ${only[0]} who answered only before, ${only[1]} only after.)` : '';
		const head = `${both.length} ${both.length === 1 ? 'person' : 'people'} answered both`;
		const def = { ...after, kind: 'compare' };
		const same = after.kind === before.kind;
		const named = (box.dataset.headings || '').split('|').map(s => s.trim());
		const heads = named.length === 2 && named.every(Boolean) ? named : ['Before', 'After'];
		const moved = heads === named ? 'answered differently' : 'changed their minds';
		let chart, lines = [];
		if (same && after.kind === 'choice' && !after.picks && !before.picks && after.options.length === before.options.length) {
			chart = flowChart(before.options, pairs, heads);
			const moves = new Map();
			pairs.forEach(([x, y]) => { if (x !== y) moves.set(x + '>' + y, (moves.get(x + '>' + y) || 0) + 1); });
			const list = [...moves].sort((a, b) => b[1] - a[1]).map(([k, c]) => { const [x, y] = k.split('>').map(Number); return `${c} ${before.options[x]} → ${after.options[y]}`; });
			lines.push(`${head} · ${changed} ${moved}${list.length ? ': ' + list.join(', ') : ''}.` + tail);
		}
		else if (same && after.kind === 'number') {
			chart = slopeChart(after, pairs);
			const up = pairs.filter(([x, y]) => y > x).length, down = pairs.filter(([x, y]) => y < x).length;
			const m = [mean(pairs.map(p => p[0])), mean(pairs.map(p => p[1]))];
			lines.push(`${head} · ${up} went up, ${down} down, ${pairs.length - up - down} stayed`
				+ (pairs.length ? ` · mean ${withUnit(fmtMean(m[0]), after.unit)} → ${withUnit(fmtMean(m[1]), after.unit)}` : '') + '.' + tail);
		}
		else if (same && ['scale', 'premises', 'points', 'ranking'].includes(after.kind)) {
			const rows = after.kind === 'scale' || after.kind === 'premises' ? after.statements : after.options;
			const value = after.kind === 'ranking' ? (a, k) => a.indexOf(k) + 1 : (a, k) => a[k];
			const scaleOf = after.kind === 'premises' ? v => 100 * v : v => v;
			const unit = after.kind === 'premises' ? '%' : after.kind === 'points' ? (after.unit || '') : '';
			chart = node('div', 'chart rows');
			chart.append(node('div', 'head', ''), node('div', 'head', heads[0]), node('div', 'head', ''), node('div', 'head', heads[1]));
			rows.forEach((text, k) => {
				const m = [0, 1].map(i => pairs.length ? scaleOf(mean(pairs.map(p => value(p[i], k)))) : null);
				const arrow = m[0] === null ? '' : m[1] > m[0] + 0.05 ? '↗' : m[1] < m[0] - 0.05 ? '↘' : '→';
				chart.append(node('div', 'statement', text), node('div', 'value', m[0] === null ? '–' : fmt(m[0]) + unit),
					node('div', 'arrow', arrow), node('div', 'value', m[1] === null ? '–' : fmt(m[1]) + unit));
			});
			lines.push(`${head} · ${changed} changed their answers · ` + (after.kind === 'premises' ? 'the share accepting each statement'
				: after.kind === 'ranking' ? 'each option’s average position (1 is first)' : after.kind === 'points' ? 'the average points for each' : 'the average rating') + '.' + tail);
		}
		else {
			chart = node('div', 'chart');
			lines.push(`${head} · ${changed} changed their answers.` + tail);
		}
		fill(box, def, chart, ...lines);
	}

	// A flow from each earlier answer (left) to each later one (right): a
	// column of blocks either side, sized by how many gave that answer among
	// those who answered both, and a band for each change, coloured by the
	// earlier answer; bands for those who stayed are paler.
	function flowChart(options, pairs, heads) {
		const n = pairs.length, m = options.length, GAP = 2, EMPTY = 3;		// an option nobody gave still has a sliver, and its label
		const chart = node('div', 'chart flow');
		const usable = 100 - GAP * (m - 1);
		const sides = [0, 1].map(i => {
			let y = 0;
			const zeros = options.filter((_, k) => !pairs.some(p => p[i] === k)).length;
			return options.map((_, k) => {
				const c = pairs.filter(p => p[i] === k).length;
				const h = !n ? usable / m : c ? (usable - EMPTY * zeros) * c / n : EMPTY;
				const block = { y, h, c, used: 0 };
				y += h + GAP;
				return block;
			});
		});
		const columns = [0, 1].map(i => {
			const col = node('div', 'side side-' + i);
			col.append(node('div', 'flow-head', heads[i]));
			const track = node('div', 'track');
			options.forEach((label, k) => {
				const b = sides[i][k];
				const block = node('div', 'block');
				block.style.top = b.y + '%';
				block.style.height = b.h + '%';
				block.style.background = colour(k);
				if (!b.c) block.classList.add('empty');
				const name = node('div', 'name', label);
				name.append(node('span', 'n', ' ' + b.c));
				name.style.top = (b.y + b.h / 2) + '%';
				track.append(block, name);
			});
			col.append(track);
			return col;
		});
		const svg = svgNode('svg');
		svg.setAttribute('viewBox', '0 0 100 100');
		svg.setAttribute('preserveAspectRatio', 'none');
		svg.classList.add('bands');
		for (let x = 0; x < m; x++) for (let y = 0; y < m; y++) {
			const c = pairs.filter(p => p[0] === x && p[1] === y).length;
			if (!c) continue;
			const a = sides[0][x], b = sides[1][y];
			const h0 = a.h * c / a.c, h1 = b.h * c / b.c;		// its share of each block
			const y0 = a.y + a.used, y1 = b.y + b.used;
			a.used += h0; b.used += h1;
			const path = svgNode('path');
			path.setAttribute('d', `M0 ${y0} C50 ${y0} 50 ${y1} 100 ${y1} L100 ${y1 + h1} C50 ${y1 + h1} 50 ${y0 + h0} 0 ${y0 + h0} Z`);
			path.style.fill = colour(x);			// a style, not the fill attribute, which can't take var()
			path.setAttribute('fill-opacity', x === y ? 0.25 : 0.7);
			svg.append(path);
		}
		const middle = node('div', 'middle');
		middle.append(node('div', 'flow-head', ''), svg);
		chart.append(columns[0], middle, columns[1]);
		if (!n) chart.append(node('div', 'empty', 'Nobody has answered both yet.'));
		return chart;
	}

	// A line per phone, from its earlier answer (left axis) to its later one
	// (right axis): up, down or level, with the means in bold.
	function slopeChart(def, pairs) {
		const chart = node('div', 'chart slope');
		const values = pairs.flat();
		const lo = values.length ? Math.min(...values) : def.min, hi = values.length ? Math.max(...values) : def.max;
		const span = Math.max(1, hi - lo);
		const y = v => 92 - 84 * (v - lo) / span;
		const svg = svgNode('svg');
		svg.setAttribute('viewBox', '0 0 100 100');
		svg.setAttribute('preserveAspectRatio', 'none');
		const line = (x0, v0, x1, v1, cls) => {
			const l = svgNode('line');
			Object.entries({ x1: x0, y1: y(v0), x2: x1, y2: y(v1) }).forEach(([k, v]) => l.setAttribute(k, v));
			l.setAttribute('class', cls);
			svg.append(l);
		};
		line(10, hi, 10, lo, 'axis'); line(90, hi, 90, lo, 'axis');
		pairs.forEach(([a, b]) => line(10, a, 90, b, b > a ? 'up' : b < a ? 'down' : 'level'));
		if (pairs.length) line(10, mean(pairs.map(p => p[0])), 90, mean(pairs.map(p => p[1])), 'means');
		const labels = node('div', 'labels');
		const label = (text, left, v) => { const l = node('span', '', text); l.style.left = left + '%'; l.style.top = y(v) + '%'; labels.append(l); };
		label(withUnit(fmt(hi), def.unit), 3, hi); label(withUnit(fmt(lo), def.unit), 3, lo);
		label(withUnit(fmt(hi), def.unit), 97, hi); label(withUnit(fmt(lo), def.unit), 97, lo);
		const titles = node('div', 'titles');
		titles.append(node('span', '', 'Before'), node('span', '', 'After'));
		chart.append(titles, svg, labels);
		if (!pairs.length) chart.append(node('div', 'empty', 'Nobody has answered both yet.'));
		return chart;
	}

	// ---- Self versus others: each phone's own answer, and its guess at the
	// share of the room giving options[target] (data-target, from 1).  The
	// gap between the room's guess and the truth is pluralistic ignorance;
	// those who said yes guessing higher than the rest, the false consensus
	// effect.
	function drawSelfOthers(def, tally, boxes) {
		const answers = answersOf(tally), n = answers.length;
		const said = answers.filter(a => a[0] === def.target);
		const rest = answers.filter(a => a[0] !== def.target);
		const actual = n ? 100 * said.length / n : null;
		const guess = list => list.length ? mean(list.map(a => a[1])) : null;
		const option = def.options[def.target];
		const rows = [
			[`Said “${option}”`, actual, 'actual', null],
			['Guessed, on average', guess(answers), 'guess', answers.map(a => a[1])],
			[`Guessed by those who said “${option}”`, guess(said), 'group', null],
			['Guessed by the rest', guess(rest), 'group', null]
		];
		const lines = [];
		if (n) {
			// (Worded to fit either sort of question: what people would answer, or what they would do.)
			lines.push(`The room’s average guess was ${fmt(guess(answers), 0)}%; ${fmt(actual, 0)}% said “${option}”.`);
			if (said.length >= 2 && rest.length >= 2 && Math.abs(guess(said) - guess(rest)) >= 10)
				lines.push(guess(said) > guess(rest) ? `Those who said “${option}” guessed higher than the rest: each side thought the room more like itself.`
					: `Those who said “${option}” guessed lower than the rest.`);
		}
		for (const box of boxes) {
			const chart = node('div', 'chart rows-bars');
			rows.forEach(([label, value, cls, dots]) => {
				const track = node('div', 'track');
				const bar = node('span', 'bar ' + cls);
				bar.style.width = (value ?? 0) + '%';
				track.append(bar);
				if (dots) dots.forEach((p, i) => {
					const dot = node('span', 'dot');
					dot.style.left = p + '%';
					dot.style.top = (30 + 40 * ((wordHash(String(i)) % 100) / 100)) + '%';
					track.append(dot);
				});
				if (actual !== null && cls !== 'actual') {
					const line = node('span', 'truth-line');
					line.style.left = actual + '%';
					track.append(line);
				}
				chart.append(node('div', 'statement', label), track, node('div', 'count', value === null ? '–' : fmt(value, 0) + '%'));
			});
			fill(box, def, chart, `${plural(n, 'answer')} · the dashed line is the share who actually said “${option}”`, ...lines);
		}
	}

	// ---- Points (data-kind="points", data-total="100"): each option's
	// average share, with every phone's allocation as a dot.
	function drawPoints(def, tally, boxes) {
		const answers = answersOf(tally), n = answers.length;
		const means = def.options.map((_, k) => n ? mean(answers.map(a => a[k])) : null);
		const spread = def.options.map((_, k) => n ? [Math.min(...answers.map(a => a[k])), Math.max(...answers.map(a => a[k]))] : null);
		const unit = def.unit || (def.total === 100 ? '%' : '');
		const lines = [];
		if (n > 1) {
			const sd = def.options.map((_, k) => Math.sqrt(mean(answers.map(a => (a[k] - means[k]) ** 2))));
			const k = sd.indexOf(Math.max(...sd));
			lines.push(`The room is most divided over ${def.options[k]}: from ${fmt(spread[k][0])}${unit} to ${fmt(spread[k][1])}${unit}.`);
		}
		for (const box of boxes) {
			const chart = node('div', 'chart rows-bars');
			def.options.forEach((label, k) => {
				const track = node('div', 'track');
				const bar = node('span', 'bar');
				bar.style.width = (100 * (means[k] ?? 0) / def.total) + '%';
				track.append(bar);
				answers.forEach((a, i) => {
					const dot = node('span', 'dot');
					dot.style.left = (100 * a[k] / def.total) + '%';
					dot.style.top = (30 + 40 * ((wordHash(String(i)) % 100) / 100)) + '%';
					track.append(dot);
				});
				chart.append(node('div', 'statement', label), track, node('div', 'count', means[k] === null ? '–' : fmt(means[k]) + unit));
			});
			fill(box, def, chart, `${plural(n, 'answer')} · bars show the average${unit === '%' ? ' share' : ''} of ${def.total}; dots, each answer`, ...lines);
		}
	}

	// ---- A 2×2 grid (data-kind="grid"): each item placed on two axes by
	// every phone (faint dots), and its average position (a numbered disc).
	// The items take their own palette (--poll-grid-colour-1 … -8), of hues
	// far apart, since they are told apart by colour alone wherever two land
	// side by side; each item's number is drawn in the ink that reads on its
	// colour (--poll-grid-ink-1 … -8).
	const gridColour = k => `var(--poll-grid-colour-${k + 1})`;
	const gridInk = k => `var(--poll-grid-ink-${k + 1})`;
	function drawGrid(def, tally, boxes) {
		const answers = answersOf(tally), n = answers.length;
		const span = def.max - def.min;
		const px = v => 100 * (v - def.min) / span, py = v => 100 - 100 * (v - def.min) / span;
		for (const box of boxes) {
			const chart = node('div', 'chart grid2');
			const svg = svgNode('svg');
			svg.setAttribute('viewBox', '-9 -3 112 112');
			const add = (tag, attrs, text, fillColour) => {
				const e = svgNode(tag);
				Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
				if (fillColour) e.style.fill = fillColour;
				if (text !== undefined) e.textContent = text;
				svg.append(e);
				return e;
			};
			add('rect', { x: 0, y: 0, width: 100, height: 100, class: 'frame' });
			add('line', { x1: 50, y1: 0, x2: 50, y2: 100, class: 'mid' });
			add('line', { x1: 0, y1: 50, x2: 100, y2: 50, class: 'mid' });
			add('text', { x: 1, y: 106, class: 'axis' }, def.x[0]);
			add('text', { x: 99, y: 106, class: 'axis', 'text-anchor': 'end' }, def.x[1]);
			add('text', { x: -3, y: 99, class: 'axis', transform: 'rotate(-90 -3 99)' }, def.y[0]);
			add('text', { x: -3, y: 1, class: 'axis', 'text-anchor': 'end', transform: 'rotate(-90 -3 1)' }, def.y[1]);
			def.items.forEach((_, k) => answers.forEach(a => add('circle', { cx: px(a[k][0]), cy: py(a[k][1]), r: 1.1, class: 'one' }, undefined, gridColour(k))));
			const legend = node('ol', 'legend');
			def.items.forEach((item, k) => {
				if (n) {
					const x = mean(answers.map(a => a[k][0])), y = mean(answers.map(a => a[k][1]));
					add('circle', { cx: px(x), cy: py(y), r: 3.4, class: 'mean' }, undefined, gridColour(k));
					add('text', { x: px(x), y: py(y) + 1.4, class: 'num', 'text-anchor': 'middle' }, String(k + 1), gridInk(k));
				}
				// The legend's numbers are discs like the chart's, not numbers in
				// the item's colour, which would not read in the paler ones.
				const li = node('li');
				const key = node('span', 'key', String(k + 1));
				key.style.setProperty('--colour', gridColour(k));
				key.style.setProperty('--ink', gridInk(k));
				li.append(key, item);			// (append: the item's text as text)
				legend.append(li);
			});
			chart.append(svg, legend);
			fill(box, def, chart, `${plural(n, 'answer')} · discs mark each item’s average place; dots, each answer`);
		}
	}

	// ---- Pin on an image (data-kind="pin", data-image="pictures/map.png"):
	// where the phones tapped, as a heat map over the image, or as dots
	// (data-display="dots" on the .poll-results).
	const pins = new WeakMap();		// a box -> { wrap, img, canvas, def, points }
	function drawPin(def, tally, boxes) {
		const points = answersOf(tally);
		for (const box of boxes) {
			let state = pins.get(box);
			if (!state || !box.contains(state.wrap)) {
				const chart = node('div', 'chart pin');
				const wrap = node('div', 'pinwrap');
				const img = document.createElement('img');
				img.src = def.local;
				img.alt = def.alt || '';
				const canvas = document.createElement('canvas');
				wrap.append(img, canvas);
				chart.append(wrap);
				fill(box, def, chart, plural(points.length, 'answer'));
				state = { wrap, img, canvas };
				pins.set(box, state);
				img.addEventListener('load', () => paintPins(box));
			}
			state.def = def;
			state.points = points;
			box.querySelector('.summary').textContent = `${plural(points.length, 'answer')}` + (box.dataset.display === 'dots' ? ' · a dot for each' : ' · brighter where more tapped');
			paintPins(box);
		}
	}
	// A CSS colour (a custom property, a color-mix()) as one a canvas takes.
	function resolvedColour(box, css) {
		const probe = document.createElement('span');
		probe.style.color = css;
		box.append(probe);
		const value = getComputedStyle(probe).color;
		probe.remove();
		return value;
	}
	function paintPins(box) {
		const state = pins.get(box);
		if (!state || !state.img.naturalWidth) return;
		const chart = state.wrap.parentElement;
		const W = chart.clientWidth, H = chart.clientHeight;
		if (!W || !H) return;			// its slide isn't laid out yet: refit tries again
		const ratio = state.img.naturalWidth / state.img.naturalHeight;
		const w = Math.min(W, H * ratio), h = w / ratio;
		state.wrap.style.width = w + 'px';			// placed by hand, so the image never sizes the chart
		state.wrap.style.height = h + 'px';
		state.wrap.style.left = (W - w) / 2 + 'px';
		state.wrap.style.top = (H - h) / 2 + 'px';
		const scale = Math.min(2, window.devicePixelRatio || 1);
		const c = state.canvas;
		c.width = Math.round(w * scale);
		c.height = Math.round(h * scale);
		const ctx = c.getContext('2d');
		ctx.clearRect(0, 0, c.width, c.height);
		const at = p => [c.width * p[0] / 1000, c.height * p[1] / 1000];
		if (box.dataset.display === 'dots') {
			const r = Math.max(4, 0.012 * Math.min(c.width, c.height));
			ctx.fillStyle = resolvedColour(box, 'var(--poll-highlight)');
			ctx.globalAlpha = 0.8;
			for (const p of state.points) {
				const [x, y] = at(p);
				ctx.beginPath();
				ctx.arc(x, y, r, 0, 2 * Math.PI);
				ctx.fill();
				ctx.lineWidth = Math.max(1, r / 4);
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
			return;
		}
		// Heat: each tap a soft disc, added up in an offscreen canvas's alpha,
		// then coloured from yellow (few) through orange to deep red (many).
		const heat = document.createElement('canvas');
		heat.width = c.width; heat.height = c.height;
		const hx = heat.getContext('2d');
		const r = 0.07 * Math.min(c.width, c.height);
		const strength = Math.min(0.5, Math.max(0.12, 3 / Math.sqrt(Math.max(1, state.points.length))));
		for (const p of state.points) {
			const [x, y] = at(p);
			const g = hx.createRadialGradient(x, y, 0, x, y, r);
			g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
			g.addColorStop(1, 'rgba(0, 0, 0, 0)');
			hx.fillStyle = g;
			hx.fillRect(x - r, y - r, 2 * r, 2 * r);
		}
		const image = hx.getImageData(0, 0, heat.width, heat.height);
		const d = image.data;
		for (let i = 0; i < d.length; i += 4) {
			const a = d[i + 3] / 255;
			if (!a) continue;
			const t = Math.min(1, a * 1.3);
			d[i] = 255;									// yellow, orange, red ...
			d[i + 1] = Math.round(220 * (1 - t));
			d[i + 2] = Math.round(60 * (1 - t));
			d[i + 3] = Math.round(255 * Math.min(0.85, 0.25 + 0.75 * t));
		}
		ctx.putImageData(image, 0, 0);
	}

	// ---- The board: questions the tablet shared, most votes first.  Any
	// <qa-board top="5"></qa-board> on a slide shows the top few,
	// live.  Only this copy of the deck fills it.
	let board = { items: [] };
	function showBoard(b) {
		if (!b || !Array.isArray(b.items)) return;
		board = b;
		document.querySelectorAll('.reveal .qa-board').forEach(box => {
			const top = Math.max(1, parseInt(box.dataset.top || '5', 10) || 5);
			const list = node('ol', 'qa-list');
			b.items.slice(0, top).forEach(item => {
				const li = node('li', '');
				li.append(node('span', 'votes', '▲ ' + item.votes), node('span', 'text', item.text));
				list.append(li);
			});
			box.replaceChildren(b.items.length ? list : node('p', 'qa-empty', 'Questions shared from the presenter’s tablet appear here, for everyone to vote on.'));
			if (b.items.length > top) box.append(node('p', 'qa-more', `and ${b.items.length - top} more on your phones`));
		});
	}

	// ---- Reactions (PresenterConfig.reactions): each one floats up the right
	// of the screen and fades.  At most 40 at once; an animation, so a hidden
	// tab spends nothing, with a timer to remove it in any case.
	let floating = 0;
	function showReaction(r) {
		if (!r || !REACTIONS.includes(r.emoji) || floating >= 40 || !reveal) return;
		const e = node('span', 'reaction-float', r.emoji);
		e.style.right = (3 + 9 * Math.random()) + '%';
		e.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
		reveal.append(e);
		floating++;
		const done = () => { if (e.isConnected) { e.remove(); floating--; } };
		e.addEventListener('animationend', done);
		setTimeout(done, 4000);
	}

	// ---- Word clouds
	//
	// The shown words, packed as in Wordle: Jonathan Feinberg's algorithm, as
	// implemented by Jason Davies's d3-cloud (BSD-3; loaded from jsDelivr, or
	// PresenterConfig.d3Cloud, only by a deck with a word cloud).  Each word
	// is drawn into a pixel mask and placed at the first point along a spiral
	// out from the centre where its letters overlap no other word's, so small
	// words fill the gaps between large ones.  The result is drawn as SVG.
	//
	// A word's size grows with the square root of its count; the whole cloud
	// is then laid out at the largest scale at which every word fits, so a few
	// words grow to fill the card and many shrink to fit it.  The layout is
	// seeded, and each word's orientation and colour depend only on the word,
	// so the same words always give the same cloud.  The .poll's data-vertical
	// is the share of words on end (default 0.5; 0 for none; never the
	// largest), and data-colours="shades" colours by frequency instead of the
	// palette.  As answers arrive the cloud is laid out again at most once a
	// second, and the words glide to their new places.
	const MAX_CLOUD_WORDS = 150;
	let cloudLibrary = null;
	const loadCloudLibrary = () => cloudLibrary || (cloudLibrary = new Promise((resolve, reject) => {
		if (window.d3 && d3.layout && d3.layout.cloud) return resolve(d3.layout.cloud);
		const script = document.createElement('script');
		script.src = CLOUD_LIBRARY;
		script.onload = () => resolve(d3.layout.cloud);
		script.onerror = () => { cloudLibrary = null; reject(new Error('could not load ' + CLOUD_LIBRARY)); };
		document.head.appendChild(script);
	}));
	const wordHash = word => {			// FNV-1a: a stable number from the word alone
		let h = 0x811c9dc5;
		for (const c of word.toLowerCase()) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0;
		return h;
	};
	const seeded = seed => () => {		// mulberry32: the same layout every time
		seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const clouds = new WeakMap();		// a word cloud's box -> { chart, def, words, texts, ... }

	function drawWords(def, tally, boxes) {
		const words = (tally.words || []).slice().sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
		const shown = words.slice(0, MAX_CLOUD_WORDS);
		const summary = `${plural(tally.total, 'answer')} · ${plural(words.length, 'word')} shown`
			+ (shown.length < words.length ? ` (the ${shown.length} most given)` : '');
		for (const box of boxes) {
			let state = clouds.get(box);
			if (!state || !box.contains(state.chart)) {
				const chart = node('div', 'chart cloud');
				fill(box, def, chart, summary);
				state = { chart, texts: new Map() };
				clouds.set(box, state);
			}
			else box.querySelector('.summary').textContent = summary;
			state.def = def;
			state.words = shown;
			const empty = state.chart.querySelector('.empty');
			if (shown.length && empty) empty.remove();
			if (!shown.length && !empty) state.chart.append(node('span', 'empty', def.moderated ? 'Words appear here once approved on the presenter’s tablet.' : 'Words appear here as they arrive.'));
			scheduleCloud(box);
		}
	}

	// Lay a cloud out again, at most once a second, and never twice at once.
	function scheduleCloud(box) {
		const state = clouds.get(box);
		if (!state) return;
		if (state.busy) { state.dirty = true; return; }
		clearTimeout(state.timer);
		state.timer = setTimeout(() => layoutCloud(box), Math.max(0, (state.last || 0) + 1000 - Date.now()));
	}
	function refitCloud(box) {			// its card has changed size
		const state = clouds.get(box);
		if (!state) return;
		if (state.busy) state.dirty = true;
		else layoutCloud(box);
	}

	async function layoutCloud(box) {
		const state = clouds.get(box);
		if (!state || state.busy) return;
		const W = Math.round(state.chart.clientWidth), H = Math.round(state.chart.clientHeight);
		if (!W || !H) return;			// not laid out yet (its slide isn't shown): refit tries again
		if (!state.words.length) return renderCloud(state, null, W, H);
		state.busy = true;
		state.last = Date.now();
		try {
			const cloud = await loadCloudLibrary();
			await document.fonts.ready;
			renderCloud(state, await fitCloud(cloud, state, W, H), W, H);
		}
		catch (e) { console.warn('[presenter] word cloud:', e); }
		state.busy = false;
		if (state.dirty) { state.dirty = false; scheduleCloud(box); }
	}

	// One layout at a given scale, in the background (d3-cloud works in
	// slices of a few milliseconds, so the slide stays responsive).
	const runCloud = (cloud, items, W, H, scale, family) => new Promise(resolve => {
		cloud().size([W, H])
			.words(items.map(w => ({ text: w.word, key: w.key, n: w.n, rotate: w.rotate, size: Math.max(8, Math.round(scale * w.base)) })))
			.font(family).fontWeight('bold').fontSize(d => d.size).rotate(d => d.rotate)
			.padding(d => Math.max(2, Math.round(0.07 * d.size)))		// clear space round each word, in proportion: neighbours never run together
			.spiral('archimedean').random(seeded(7)).timeInterval(15)
			.on('end', (placed, bounds) => resolve({ placed, bounds, scale }))
			.start();
	});

	// The largest scale at which every word fits: from last time's (usually
	// close), up by half while all fit, down by 0.7 while some don't, then
	// halving the gap to within 8%.
	async function fitCloud(cloud, state, W, H) {
		const family = getComputedStyle(state.chart).fontFamily;
		const most = state.words[0].n;
		const share = state.def.vertical;
		const items = state.words.map((w, i) => ({
			word: w.word, key: w.word.toLowerCase(), n: w.n,
			base: 14 + 96 * Math.sqrt(w.n / most),
			rotate: i > 0 && (wordHash(w.word) % 1000) / 1000 < share ? -90 : 0
		}));
		let low = null, high = null, best = null, last = null, scale = state.scale || 1;
		for (let tries = 0; tries < 12; tries++) {
			last = await runCloud(cloud, items, W, H, scale, family);
			if (last.placed.length === items.length) { low = scale; best = last; }
			else high = scale;
			if (low !== null && high !== null && high / low < 1.08) break;
			scale = low === null ? scale * 0.7 : high === null ? scale * 1.5 : (low + high) / 2;
			if (scale < 0.04 || scale > 12) break;
		}
		if (best) state.scale = best.scale;
		return best || last;
	}

	// Draw a layout: each word an SVG <text>, kept from one layout to the
	// next, so that it moves (and fades in or out) rather than jumping; the
	// group around them scaled to fill the card.
	function renderCloud(state, result, W, H) {
		let svg = state.chart.querySelector('svg');
		if (!svg) {
			svg = svgNode('svg');
			svg.setAttribute('aria-hidden', 'true');
			const group = svgNode('g');
			group.setAttribute('class', 'fit');
			svg.append(group);
			state.chart.append(svg);
		}
		svg.setAttribute('viewBox', `${-W / 2} ${-H / 2} ${W} ${H}`);
		const group = svg.querySelector('g');
		const placed = result ? result.placed : [];
		const most = Math.max(1, ...placed.map(w => w.n));
		const kept = new Set();
		for (const w of placed) {
			kept.add(w.key);
			let text = state.texts.get(w.key);
			if (!text) {
				text = svgNode('text');
				text.setAttribute('class', 'word');
				text.setAttribute('text-anchor', 'middle');
				text.append(document.createTextNode(w.text), svgNode('title'));		// what someone typed: a text node, never markup
				text.classList.add('arriving');	// fades in (a CSS animation: it needs no animation frames)
				group.append(text);
				state.texts.set(w.key, text);
			}
			text.querySelector('title').textContent = plural(w.n, 'answer');
			text.style.fontSize = w.size + 'px';
			text.style.transform = `translate(${w.x}px, ${w.y}px) rotate(${w.rotate}deg)`;
			text.style.fill = state.def.colours === 'shades' ? shade(0.55 + 0.45 * Math.sqrt(w.n / most)) : colour(wordHash(w.text) % 6);
		}
		for (const [key, text] of state.texts) {
			if (kept.has(key)) continue;
			text.style.opacity = 0;
			state.texts.delete(key);
			setTimeout(() => text.remove(), 700);
		}
		if (result && result.bounds && placed.length) {
			const [a, b] = result.bounds;		// in d3-cloud's board, whose centre is the words' origin
			const x0 = a.x - W / 2, y0 = a.y - H / 2, x1 = b.x - W / 2, y1 = b.y - H / 2;
			const k = 0.97 * Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0));
			group.style.transform = `scale(${k}) translate(${-(x0 + x1) / 2}px, ${-(y0 + y1) / 2}px)`;
		}
		state.chart.dataset.placed = placed.length;		// for the tests
		state.chart.dataset.layouts = (Number(state.chart.dataset.layouts) || 0) + 1;
	}

	// A unit stays on a chart's labels only if every one fits its column; if
	// not ("hours" under 25 columns), the labels are the numbers alone, and the
	// unit is in the median and mean below.  If some units wrap below their
	// numbers, all do, to look even; but a sign ("%") is dropped rather than
	// put below.  Checked again whenever the chart is resized, which includes
	// its slide first being shown.
	function fitLabels(box) {
		box.classList.remove('bare', 'stacked');
		const labels = [...box.querySelectorAll('.label')].filter(l => l.querySelector('.word'));
		const wrapped = labels.filter(l => l.querySelector('.word').offsetTop > l.firstChild.offsetTop);
		if (labels.some(l => l.scrollWidth > l.clientWidth + 1) || wrapped.some(l => l.querySelector('.sign'))) box.classList.add('bare');
		else if (wrapped.length) box.classList.add('stacked');
	}
	const refit = new ResizeObserver(entries => entries.forEach(e => { fitLabels(e.target); refitCloud(e.target); paintPins(e.target); }));

	// An overlay covers its slide from the title's lower edge to the foot of
	// the slide (or of its content, if that runs over), in the slide's own
	// unscaled coordinates.  Every overlay is placed once all are laid out, and
	// again on its own slide (fonts can arrive late), so that it never moves
	// while shown.
	function placeOverlay(box) {
		const section = box.closest('section');
		const title = section.querySelector('h1, h2, h3');
		const top = title ? title.offsetTop + title.offsetHeight : 0;
		let sectionTop = 0;
		for (let e = section; e && e !== R().getSlidesElement(); e = e.offsetParent) sectionTop += e.offsetTop;
		const bottom = Math.max(R().getConfig().height - sectionTop, section.offsetHeight);
		box.style.setProperty('--overlay-top', top + 'px');
		box.style.setProperty('--overlay-height', Math.max(160, bottom - top) + 'px');
	}
	function placeOverlays(all) {
		if (!api.isReady()) return;
		const scope = all === true ? document : R().getCurrentSlide();
		if (scope) scope.querySelectorAll('.reveal .slides .poll-results.overlay').forEach(placeOverlay);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
	else begin();
}
