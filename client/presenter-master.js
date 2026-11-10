/*
 * reveal.js-presenter — the laptop side.
 *
 * Include this on every deck, after presenter-config.js.  Opened normally, the
 * deck is unaffected: the script does nothing, but for a question button in
 * the lecturer's own browser (see questionButton()).  Opened with
 * ?master=<secret>, the deck broadcasts its position, and its own path (so the
 * presenter page knows which deck to load), through the relay on every change
 * and again every few seconds.
 *
 * The heartbeat matters.  A reveal/multiplex relay keeps no state, so a
 * presenter view that has just woken up or reconnected learns where the talk
 * is only from the next message; without the heartbeat it would show a stale
 * slide until the next click.
 *
 * With audience questions on (PresenterConfig.questionsKey), a ?master deck
 * also loads presenter-polls.js and presenter-polls.css from beside this file
 * (live polls, the board of shared questions and floating reactions), and
 * presenter-drive.js (the tablet's Drive, and the laptop's ink sent to the
 * tablet).  Nothing of that is loaded, or done, without ?master.
 *
 * The tablet's own copies of the deck (presenter.html loads them with
 * ?presenter) run this too, as a mirror, so that they show what the laptop's
 * screen does: with the questions key on the tablet, they load
 * presenter-polls.js and draw there what it draws on the laptop (the question
 * QR code, the poll pill, the charts, the board, reactions), from what the
 * tablet page hands them through window.presenterMirror (below).  A mirror
 * connects to nothing, sends nothing, and gets neither the secret nor the
 * day's code: the tablet has the code from the relay, with its key.
 *
 * A deck writes its interactive parts as custom elements, which say what they
 * are and take plain attributes:
 *     <question-qr code="4326" short-url="example.org/ask"></question-qr>
 *     <live-poll name="sleep" kind="number" min="0" max="12" …></live-poll>
 *     <poll-results poll="sleep" overlay></poll-results>
 *     <qa-board top="5"></qa-board>, <question-code></question-code>
 * always with the closing tag, since <live-poll … /> would not end the
 * element.  The laptop's copy (and a mirror) first turns each into the older
 * markup the rest works on, which still works too: <div class="poll"
 * data-poll="…" data-kind="…">, and so on.  Elsewhere they are left empty,
 * and inline.
 */
(function () {
	'use strict';

	const params = new URLSearchParams(location.search);
	const config = window.PresenterConfig || {};
	const MASTER = params.has('master');
	const MIRROR = !MASTER && params.has('presenter');
	// Where this script was loaded from, for finding vendor/qr-studio.js and
	// the modules.  Only available now, while the script first runs.
	const SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
	const onDom = fn => {
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
		else fn();
	};
	const LECTURER = 'presenter-lecturer';		// see questionButton()
	const storage = (fn, fallback) => { try { return fn(localStorage); } catch (e) { return fallback; } };
	// The question button's icon: a speech bubble with a question mark.
	const QUESTION_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
		+ ' stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-4 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>'
		+ '<path d="M9.8 8.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .7-1 1.4v.3"/><circle cx="12" cy="14.9" r=".4" fill="currentColor"/></svg>';

	// PresenterConfig.deck lets an ES-module setup, which has no global Reveal,
	// hand over its instance.  It is read lazily, so it can be set after this runs.
	const deck = () => config.deck || window.Reveal;
	let ready = false;
	function isReady() {
		if (!ready) {
			try { ready = deck().isReady() === true; } catch (e) { /* not initialised */ }
		}
		return ready;
	}
	// fn once reveal.js is ready (at once, if it is).  reveal's events bubble
	// from .reveal, so listen there rather than through Reveal.on(): this
	// script may run before Reveal.initialize().
	function whenReady(fn) {
		onDom(() => {
			if (isReady()) return fn();
			const root = document.querySelector('.reveal');
			if (root) root.addEventListener('ready', () => { ready = true; fn(); }, { once: true });
		});
	}

	questionButton();
	if (!MASTER && !MIRROR) return;

	const QUESTIONS = /^[0-9a-f]{64}$/.test(config.questionsKey || '');
	// A mirror draws only what rides on the questions (the tablet hands it
	// everything with its key), so without them there is nothing to mirror.
	if (MIRROR && !QUESTIONS) return;

	let secret = null;
	if (MASTER) {
		secret = params.get('master') || config.secret;
		if (!config.relay || !config.channel || !secret) {
			console.warn('[presenter] ?master given, but PresenterConfig.relay, PresenterConfig.channel or the secret is missing');
			return;
		}
	}
	const RELAY = MASTER ? config.relay.replace(/\/+$/, '') : '';
	const HEARTBEAT_MS = config.heartbeatMs || 3000;
	const REPLY_MS = 5000;		// see the quiet-death check, below

	// Announce the deck's path without ?master, so the presenter's own copies of
	// the deck never try to broadcast.
	params.delete('master');
	const query = params.toString();
	const DECK_PATH = location.pathname + (query ? '?' + query : '');

	// ---- The custom elements (see above), given the older markup's class,
	// and their attributes again as data-*: a live-poll's name is its
	// data-poll, and a poll-results' overlay is a class.
	const CUSTOM_ELEMENTS = { 'question-qr': 'question-qr', 'live-poll': 'poll', 'poll-results': 'poll-results', 'qa-board': 'qa-board', 'question-code': 'question-code' };
	const NOT_OPTIONS = new Set(['id', 'class', 'style', 'title', 'hidden', 'lang', 'dir', 'role', 'tabindex']);
	function convertElements() {
		document.querySelectorAll(Object.keys(CUSTOM_ELEMENTS).join(', ')).forEach(el => {
			const tag = el.localName;
			el.classList.add(CUSTOM_ELEMENTS[tag]);
			for (const { name, value } of [...el.attributes]) {
				if (NOT_OPTIONS.has(name) || name.startsWith('data-') || name.startsWith('aria-')) continue;
				if (tag === 'poll-results' && name === 'overlay') { el.classList.add('overlay'); continue; }
				const key = tag === 'live-poll' && name === 'name' ? 'data-poll' : 'data-' + name;
				if (!el.hasAttribute(key)) el.setAttribute(key, value);
			}
			// (A <live-poll>'s <template>s are its versions: see presenter-polls.js.)
			if ([...el.children].some(c => c.localName !== 'template')) console.warn(`[presenter] <${tag}> has content: is its closing tag missing?`);
		});
	}

	// What only these copies show: the QR code, hidden when the question
	// button (or the laptop, for a mirror) says so.
	const style = document.createElement('style');
	style.textContent = 'body.question-qr-hidden .reveal .question-qr { display: none; }';
	document.head.appendChild(style);

	// ---- The position, and what goes with it.
	let socket = null;
	const socketWaiters = [];		// called with the socket once it exists (the modules)
	// The poll module may change the position sent to the tablet: an overlay
	// chart is a step only in this copy of the deck, so it is left out.
	let stateFilter = state => state;

	// With the position goes how many slides this copy has, so that the
	// tablet can tell when its own copy is another version of the deck
	// (edited here and not yet uploaded, say), whose slides would not line up
	// with these; overlay steps are fragments, not slides, so the count is the
	// same in every copy of one version.  And, with the chalkboard plugin,
	// whether its board is a chalkboard or a whiteboard, and shows its grid,
	// so that the tablet's copy shows it the same (sent again at once when
	// either changes).  And what else is on this screen, for the tablet's
	// copies (see presenterMirror): the fragment index with this deck's own
	// steps, whether the question code is hidden, and whether the pen is in
	// use (the plugin's C: its palette shown).
	const penShown = () => { const c = document.getElementById('notescanvas'); return !!c && c.style.pointerEvents === 'auto'; };
	const qrHidden = () => document.body.classList.contains('question-qr-hidden');
	function broadcast() {
		if (!MASTER || !socket || !socket.connected || !isReady()) return;
		const d = deck(), board = window.RevealChalkboard;
		const state = d.getState();
		socket.emit('multiplex-statechanged', {
			socketId: config.channel,
			secret: secret,
			deck: DECK_PATH,
			state: stateFilter(state),
			slides: d.getTotalSlides(),
			chalkboard: board && typeof board.theme === 'function' ? board.theme() : undefined,
			chalkboardGrid: board && typeof board.gridShown === 'function' ? board.gridShown() : undefined,
			screen: { indexf: state.indexf, qrHidden: qrHidden(), pen: penShown() }
		});
	}

	if (MASTER) {
		onDom(() => {
			const root = document.querySelector('.reveal');
			if (!root) return;
			['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden', 'overviewshown',
			 'overviewhidden', 'paused', 'resumed'].forEach(type => root.addEventListener(type, () => { if (type === 'ready') ready = true; broadcast(); }));
		});
		setInterval(broadcast, HEARTBEAT_MS);
		// The board made white or ruled (the plugin's own messages), and the
		// question code hidden or shown, or the pen taken up or put down: sent
		// again at once.
		document.addEventListener('broadcast', e => {
			if (e.content && e.content.sender === 'chalkboard-plugin' && (e.content.type === 'theme' || e.content.type === 'grid')) broadcast();
		});
		const looks = () => qrHidden() + ' ' + penShown();
		let looked = null;
		const looking = new MutationObserver(() => { if (looks() !== looked) { looked = looks(); broadcast(); } });
		whenReady(() => {
			looked = looks();
			looking.observe(document.body, { attributes: true, attributeFilter: ['class'] });
			const notes = document.getElementById('notescanvas');		// (the plugin's, made as it starts)
			if (notes) looking.observe(notes, { attributes: true, attributeFilter: ['style'] });
		});

		// Check the secret here, so a typo shows up in the console rather than as a
		// presenter view that silently never moves.  crypto.subtle exists only in
		// secure contexts (https, localhost), so elsewhere this check is skipped.
		if (window.crypto && crypto.subtle) {
			crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)).then(buffer => {
				const hex = Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
				if (hex !== config.channel) {
					console.error('[presenter] the ?master secret does not match PresenterConfig.channel; the relay will ignore this deck');
				}
			});
		}
	}

	// ---- Audience questions (optional; see ask.html).  This copy, the only
	// one that knows the secret, derives a 4-digit code that changes daily,
	// unless the deck fixes one with <question-qr code="1234">: that code
	// stays the same from talk to talk and year to year, so that a short link
	// (short-url) can carry it.  It shows the code in any <question-code>, and
	// opens questions on the relay for this channel, naming the key the
	// presenter's tablet will use.  A mirror shows the code the tablet hands
	// it.
	let CODE = '';
	let FIXED_CODE = '';

	// What the ask page offers besides questions, sent with them: the deck's
	// reactions (PresenterConfig.reactions: a list of emoji, or one string of
	// them separated by spaces; none by default) and the "Lost?" toggle
	// (PresenterConfig.pace: off unless true).
	const reactions = Array.isArray(config.reactions) ? config.reactions.map(String)
		: typeof config.reactions === 'string' ? config.reactions.trim().split(/\s+/).filter(Boolean) : [];
	const AUDIENCE = { reactions: reactions.slice(0, 8), pace: config.pace === true };

	async function deriveCode() {
		const d = new Date();
		const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
		const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret + ':questions:' + day));
		return String(new DataView(buffer).getUint32(0) % 10000).padStart(4, '0');
	}

	// The relay's reply to questions-open carries the board of shared
	// questions, which the poll module shows; kept for a module that loads late.
	let opened = null;
	const openedListeners = [];
	function openQuestions() {
		if (!MASTER || !CODE || !socket || !socket.connected) return;
		socket.emit('questions-open', { socketId: config.channel, secret: secret, code: CODE, keyHash: config.questionsKey,
			audience: AUDIENCE }, res => {
			if (!res || !res.ok) return;
			opened = res;
			openedListeners.forEach(fn => fn(res));
		});
	}

	function setCode(code) {
		CODE = code;
		document.querySelectorAll('.question-code').forEach(e => { e.textContent = code; });
		drawQR(code);
		openQuestions();
	}

	// A QR code for the ask page with the code already filled in, drawn into
	// any <question-qr>, so students need only scan.  It must point at the
	// public ask page (askUrl), never at this page's own address: the laptop
	// may well be serving the deck from localhost.  The caption under it is
	// its short-url, if it has one (a short link to the ask page with its
	// code, for anyone who would rather type than scan); otherwise its text,
	// or "Ask a question"; text="" for none.  text-size sets the caption's
	// size, in the code's own units (the code is 1000 wide; the default is
	// 80), or as a percentage of the default ("150%").  The caption is set on
	// one line, so one too long for its size is set smaller, to fit.
	const QR_FONT = '"Helvetica Neue", Arial, sans-serif';
	const qrFont = size => `600 ${size}px ${QR_FONT}`;
	function qrTextSize(e) {
		const v = (e.dataset.textSize || '').trim(), n = parseFloat(v);
		return !(n > 0) ? 80 : v.endsWith('%') ? 80 * n / 100 : n;
	}
	function qrFontSize(text, size) {
		const ctx = document.createElement('canvas').getContext('2d');
		ctx.font = qrFont(size);
		const width = ctx.measureText(text).width;
		return width > 940 ? Math.floor(size * 940 / width) : size;
	}
	let qrLibrary = null;
	async function drawQR(code) {
		const targets = document.querySelectorAll('.question-qr');
		if (!targets.length || !config.askUrl) return;
		const url = new URL(config.askUrl, location.href);
		url.searchParams.set('code', code);
		try {
			qrLibrary = qrLibrary || import(config.qrStudio || new URL('vendor/qr-studio.js', SCRIPT_URL).href);
			const lib = await qrLibrary;
			if (code !== CODE) return;		// another has come meanwhile
			targets.forEach(el => {
				const title = (el.dataset.shortUrl || '').trim() || (el.dataset.text ?? 'Ask a question').trim();
				const options = { moduleStyle: 'smooth', background: null, captionBackground: null, captionPosition: 'bottom' };
				if (title) Object.assign(options, { title, titleFont: qrFont(qrFontSize(title, qrTextSize(el))) });
				Object.assign(options, config.qrOptions);
				if (title && config.qrOptions && config.qrOptions.foreground && !config.qrOptions.titleColor) options.titleColor = config.qrOptions.foreground;
				// The library's own output, which escapes the caption.
				el.innerHTML = (lib.default || lib).toString(url.href, options);
				el.firstElementChild.style.cssText = 'width: 100%; height: auto; display: block;';
				el.dataset.url = url.href;
				el.setAttribute('role', 'img');
				el.setAttribute('aria-label', 'QR code for ' + url.href);
			});
		}
		catch (e) { console.warn('[presenter] could not draw the question QR code', e); }
	}

	onDom(() => {
		convertElements();
		FIXED_CODE = [...document.querySelectorAll('.question-qr[data-code]')]
			.map(e => e.dataset.code.trim()).find(c => /^\d{4}$/.test(c)) || '';
		if (!FIXED_CODE && document.querySelector('.question-qr[data-code]')) console.warn('[presenter] a <question-qr>\'s code must be 4 digits; using the day\'s code');
		if (!FIXED_CODE && document.querySelector('.question-qr[data-short-url]')) console.warn('[presenter] a <question-qr>\'s short-url needs the code its link carries');
		if (!QUESTIONS) return;
		if (FIXED_CODE) setCode(FIXED_CODE);
		else if (MIRROR) { if (CODE) setCode(CODE); }		// (handed one already)
		else if (window.crypto && crypto.subtle) deriveCode().then(setCode);
		else console.warn('[presenter] questions need a secure context (https or localhost) to derive the code');
	});
	if (MASTER && QUESTIONS) setInterval(openQuestions, 60 * 1000);	// keeps the code from lapsing on the relay

	// ---- A connection can die without a word (Safari's did, every minute or
	// so, on a university network), and Socket.IO's own heartbeat notices only
	// after 45 s; until then, whatever is sent is lost, a poll opening among
	// it.  So every few seconds ask the relay for a reply (the tally of no
	// poll), and if none comes, start a new connection at once: its 'connect'
	// sends the position and the slide's poll again.  Only with questions on,
	// since only server/relay.js replies; and only with a Socket.IO 4 client,
	// which has timeout().
	let checking = false;
	function reconnect(why) {
		if (!socket || !socket.connected) return;		// Socket.IO is already reconnecting
		console.warn('[presenter] no reply from the relay (' + why + '): reconnecting');
		socket.disconnect().connect();
	}
	if (MASTER && QUESTIONS) setInterval(() => {
		if (!socket || !socket.connected || checking || typeof socket.timeout !== 'function') return;
		checking = true;
		socket.timeout(REPLY_MS).emit('poll-results', { socketId: config.channel, secret: secret, id: '' }, err => {
			checking = false;
			if (err) reconnect('check');
		});
	}, REPLY_MS);

	// ---- A mirror (one of the tablet's copies): what the laptop's page is
	// sent, handed to this one by the tablet page (presenter-mirror.js), which
	// also says what the laptop's screen shows besides; and it asks the
	// tablet page for the tallies of the polls on its slide (want, which that
	// page sets).  The poll module arrives late (an import), so what comes
	// before it is kept for it, but for reactions, which are of the moment.
	let mirrorReady = () => {};
	if (MIRROR) {
		let handlers = null;
		const waiting = [];
		const later = name => (...args) => {
			if (handlers) handlers[name](...args);
			else if (name !== 'reaction') waiting.push([name, args]);
		};
		mirrorReady = h => { handlers = h; waiting.splice(0).forEach(([name, args]) => h[name](...args)); };
		window.presenterMirror = {
			want: () => {},
			code: c => { if (!FIXED_CODE && /^\d{4}$/.test(c) && c !== CODE) setCode(c); },
			tally: later('tally'),
			reset: later('reset'),
			board: later('board'),
			reaction: later('reaction'),
			sync: later('sync'),
			// The question code hidden or shown, and the pen in use or not: its
			// palette, and the slide's tint, as the chalkboard plugin shows them
			// (not by its toggle, which would also make the pen's canvas take
			// every touch, which in Drive the deck's controls beneath it need).
			screen: s => {
				if (!s) return;
				if (typeof s.qrHidden === 'boolean') document.body.classList.toggle('question-qr-hidden', s.qrHidden);
				const notes = document.getElementById('notescanvas');
				if (typeof s.pen !== 'boolean' || !notes) return;
				const palette = notes.querySelector('.palette');
				if (palette) palette.style.visibility = s.pen ? 'visible' : 'hidden';
				let background = '';
				try { background = ((deck().getConfig().chalkboard || {}).background || [])[0] || ''; } catch (e) { /* not initialised */ }
				notes.style.background = s.pen ? background : 'rgba(0,0,0,0)';
			}
		};
	}

	// ---- The modules: polls, the board and reactions (presenter-polls.js),
	// which ride on the questions (phones join with the code); and, on the
	// laptop only, the tablet's Drive and the laptop's ink
	// (presenter-drive.js), which need the questions key too (the relay sends
	// both only to a tablet holding it).  Each is loaded from beside this
	// script, or from PresenterConfig.pollsScript, pollsStyle and
	// driveScript; PresenterConfig.polls = false and drive = false leave them
	// out.  Each is handed what it needs, below, and nothing is put on window
	// (but a mirror's presenterMirror).
	const api = {
		config: config,
		mirror: MIRROR,
		secret: secret,
		channel: config.channel,
		audience: AUDIENCE,
		replyMs: REPLY_MS,
		deck: deck,
		isReady: isReady,
		broadcast: broadcast,
		setStateFilter: fn => { stateFilter = fn; },
		// The position as the tablet is sent it (without this copy's own steps).
		sharedState: () => stateFilter(deck().getState()),
		// fn(socket), once the Socket.IO client has loaded and connected (or
		// at once, if it already has).  Never, in a mirror.
		onSocket: fn => { if (MIRROR) return; if (socket) fn(socket); else socketWaiters.push(fn); },
		// fn(reply) for each accepted questions-open: { ok, board }.
		onQuestionsOpened: fn => { openedListeners.push(fn); if (opened) fn(opened); },
		// No reply where one was due: start a new connection.
		reconnect: reconnect,
		// A mirror's: the tallies of these polls, please (from the tablet page).
		want: ids => { if (window.presenterMirror) window.presenterMirror.want(ids); },
		// A mirror's: the poll module is ready for what the tablet hands it.
		mirrorReady: h => mirrorReady(h)
	};
	function loadPolls() {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = config.pollsStyle || new URL('presenter-polls.css', SCRIPT_URL).href;
		const styled = new Promise(resolve => { link.onload = link.onerror = resolve; });
		document.head.appendChild(link);
		Promise.all([import(config.pollsScript || new URL('presenter-polls.js', SCRIPT_URL).href), styled])
			.then(([module]) => onDom(() => module.default(api)))
			.catch(e => console.warn('[presenter] could not load the poll support (presenter-polls.js)', e));
	}
	function loadDrive() {
		import(config.driveScript || new URL('presenter-drive.js', SCRIPT_URL).href)
			.then(module => onDom(() => module.default(api)))
			.catch(e => console.warn('[presenter] could not load Drive and ink (presenter-drive.js)', e));
	}
	if (QUESTIONS && config.polls !== false) loadPolls();
	else if (MIRROR) mirrorReady({ tally() {}, reset() {}, board() {}, reaction() {}, sync() {} });		// nothing to draw them
	if (MASTER && QUESTIONS && config.drive !== false) loadDrive();
	if (MIRROR) return;		// a mirror connects to nothing

	// Load the Socket.IO client from the relay asynchronously, so that an
	// unreachable relay can never hold up the presentation itself.
	const script = document.createElement('script');
	script.src = RELAY + '/socket.io/socket.io.js';
	script.onload = () => {
		// With a Socket.IO 4 client (server/relay.js), a WebSocket first, which
		// is always a new connection: Socket.IO's default starts with HTTP
		// requests, which reuse the browser's last connection to the relay,
		// dead if the WebSocket's was.  Plain HTTP if a WebSocket can't be had.
		// (An older relay's client, Socket.IO 2, keeps its own default.)
		const modern = typeof io.protocol === 'number' && io.protocol >= 5;
		socket = modern ? io(RELAY, { transports: ['websocket', 'polling'], tryAllTransports: true }) : io(RELAY);
		socket.on('connect', () => { console.log('[presenter] broadcasting ' + DECK_PATH); broadcast(); openQuestions(); });
		socket.on('disconnect', () => console.warn('[presenter] relay disconnected; reconnecting'));
		socketWaiters.splice(0).forEach(fn => fn(socket));
	};
	script.onerror = () => console.warn('[presenter] relay unreachable at ' + RELAY + '; the presenter view will not follow');
	document.head.appendChild(script);

	// ---- The question button: a button in the deck's bottom bar (the
	// customcontrols plugin's #customcontrols, if the deck has one; otherwise
	// none) for the deck's QR code.  With ?master, it hides and shows the
	// code.  Opened plainly, a deck can't show the code, which only a ?master
	// copy knows; so if the secret is in the config (the server-side variant:
	// see CLAUDE.md), the button reloads the deck with ?master, which also
	// starts the broadcast, and otherwise there is no button there.  In the
	// tablet's copies, the button is marked as the laptop's is (the tablet
	// sets the copy's question-qr-hidden as the laptop's), and a tap on it
	// does nothing there (in Drive, the tablet sends it to the laptop).
	//
	// A student's ?master would take over the tablet's view, so the button
	// appears only on localhost and in browsers that have opened a deck with
	// ?master before (remembered in localStorage, as does a tablet holding
	// the questions key), and never in automated ones (navigator.webdriver).
	// PresenterConfig.questionButton = false leaves it out;
	// questionButtonIcon is its icon, as HTML (a speech bubble by default).
	function questionButton() {
		if (config.questionButton === false) return;
		if (MASTER) storage(s => s.setItem(LECTURER, '1'));
		const lecturer = MASTER || location.hostname === 'localhost' || storage(s => s.getItem(LECTURER) === '1', false);
		if (!lecturer || navigator.webdriver) return;
		if (!MASTER && !MIRROR && !config.secret) return;		// no way to show the code from here
		const update = li => {
			const shown = (MASTER || MIRROR) && !document.body.classList.contains('question-qr-hidden');
			li.classList.toggle('active', shown);
			li.querySelector('button').title = !MASTER && !MIRROR ? 'Show the question QR code (reopens with ?master, which also starts the presenter broadcast)'
				: shown ? 'Hide the question QR code' : 'Show the question QR code';
		};
		const clicked = li => {
			if (MIRROR) return;
			if (MASTER) {
				document.body.classList.toggle('question-qr-hidden');
				update(li);
				li.querySelector('button').blur();
			} else {
				const url = new URL(location.href);
				url.searchParams.set('master', '');
				location.href = url.href;
			}
		};
		// After every other 'ready' handler, so that this lands after any other
		// buttons a deck adds.
		whenReady(() => setTimeout(() => {
			if (!document.querySelector('question-qr, .question-qr')) return;
			const list = document.querySelector('#customcontrols > ul');
			if (!list || document.getElementById('question-qr-button')) return;
			const css = document.createElement('style');
			// The underline is an inset shadow, not a border, which would make
			// the button taller and the bar jump.
			css.textContent = '#question-qr-button button svg { width: 1em; height: 1em; vertical-align: -0.125em; }'
				+ ' #customcontrols li#question-qr-button.active button { box-shadow: inset 0 -2px 0 var(--r-link-color, currentColor); }';
			document.head.appendChild(css);
			const li = document.createElement('li');
			li.id = 'question-qr-button';
			const button = document.createElement('button');
			button.innerHTML = typeof config.questionButtonIcon === 'string' ? config.questionButtonIcon : QUESTION_ICON;	// the site's own config
			button.addEventListener('click', () => clicked(li));
			li.append(button);
			list.appendChild(li);
			update(li);
			if (MIRROR) new MutationObserver(() => update(li)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
		}));
	}
})();
