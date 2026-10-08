/*
 * reveal.js-presenter — the laptop side.
 *
 * Include this on every deck, after presenter-config.js.  Opened normally, the
 * deck is unaffected: the script returns at once.  Opened with
 * ?master=<secret>, the deck broadcasts its position, and its own path (so the
 * presenter page knows which deck to load), through the relay on every change
 * and again every few seconds.
 *
 * The heartbeat matters.  A reveal/multiplex relay keeps no state, so a
 * presenter view that has just woken up or reconnected learns where the talk
 * is only from the next message; without the heartbeat it would show a stale
 * slide until the next click.
 */
(function () {
	'use strict';

	const params = new URLSearchParams(location.search);
	if (!params.has('master')) return;

	const config = window.PresenterConfig || {};
	const secret = params.get('master') || config.secret;
	if (!config.relay || !config.channel || !secret) {
		console.warn('[presenter] ?master given, but PresenterConfig.relay, PresenterConfig.channel or the secret is missing');
		return;
	}
	const RELAY = config.relay.replace(/\/+$/, '');
	const HEARTBEAT_MS = config.heartbeatMs || 3000;
	// Where this script was loaded from, for finding vendor/qr-studio.js.  Only
	// available now, while the script first runs.
	const SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;

	// Announce the deck's path without ?master, so the presenter's own copies of
	// the deck never try to broadcast.
	params.delete('master');
	const query = params.toString();
	const DECK_PATH = location.pathname + (query ? '?' + query : '');

	// PresenterConfig.deck lets an ES-module setup, which has no global Reveal,
	// hand over its instance.  It is read lazily, so it can be set after this runs.
	const deck = () => config.deck || window.Reveal;

	let ready = false;
	let socket = null;

	function isReady() {
		if (!ready) {
			try { ready = deck().isReady() === true; } catch (e) { /* not initialised */ }
		}
		return ready;
	}

	function broadcast() {
		if (!socket || !socket.connected || !isReady()) return;
		socket.emit('multiplex-statechanged', {
			socketId: config.channel,
			secret: secret,
			deck: DECK_PATH,
			state: deck().getState()
		});
	}

	// Listen on the .reveal element rather than through Reveal.on(): this script
	// may run before Reveal.initialize(), and reveal's events bubble from there.
	function listen() {
		const root = document.querySelector('.reveal');
		if (!root) return false;
		root.addEventListener('ready', () => { ready = true; broadcast(); });
		['slidechanged', 'fragmentshown', 'fragmenthidden', 'overviewshown',
		 'overviewhidden', 'paused', 'resumed'].forEach(type => root.addEventListener(type, broadcast));
		return true;
	}
	if (!listen()) document.addEventListener('DOMContentLoaded', listen);
	setInterval(broadcast, HEARTBEAT_MS);

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

	// Audience questions (optional; see ask.html).  This copy, the only one that
	// knows the secret, derives a 4-digit code that changes daily, shows it in any
	// element with class "question-code", and opens questions on the relay for
	// this channel, naming the key the presenter's tablet will use.
	const QUESTIONS = /^[0-9a-f]{64}$/.test(config.questionsKey || '');
	let questionCode = null;

	async function deriveCode() {
		const d = new Date();
		const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
		const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret + ':questions:' + day));
		return String(new DataView(buffer).getUint32(0) % 10000).padStart(4, '0');
	}

	function openQuestions() {
		if (!questionCode || !socket || !socket.connected) return;
		socket.emit('questions-open', { socketId: config.channel, secret: secret, code: questionCode, keyHash: config.questionsKey });
	}

	// A QR code for the ask page with today's code already filled in, drawn into
	// any element with class "question-qr", so students need only scan and type.
	// It must point at the public ask page (askUrl), never at this page's own
	// address: the laptop may well be serving the deck from localhost.
	async function drawQR(code) {
		const targets = document.querySelectorAll('.question-qr');
		if (!targets.length || !config.askUrl) return;
		const url = new URL(config.askUrl);
		url.searchParams.set('code', code);
		try {
			const lib = await import(config.qrStudio || new URL('vendor/qr-studio.js', SCRIPT_URL).href);
			const svg = (lib.default || lib).toString(url.href,
				Object.assign({ moduleStyle: 'smooth', background: null }, config.qrOptions));
			targets.forEach(el => {
				el.innerHTML = svg;
				el.firstElementChild.style.cssText = 'width: 100%; height: auto; display: block;';
				el.dataset.url = url.href;
				el.setAttribute('role', 'img');
				el.setAttribute('aria-label', 'QR code for ' + url.href);
			});
		}
		catch (e) { console.warn('[presenter] could not draw the question QR code', e); }
	}

	if (QUESTIONS) {
		if (window.crypto && crypto.subtle) {
			deriveCode().then(code => {
				questionCode = code;
				const show = () => {
					document.querySelectorAll('.question-code').forEach(e => { e.textContent = code; });
					drawQR(code);
				};
				if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
				else show();
				openQuestions();
			});
			setInterval(openQuestions, 60 * 1000);	// keeps the code from lapsing on the relay
		}
		else console.warn('[presenter] questions need a secure context (https or localhost) to derive the code');
	}

	// Load the Socket.IO client from the relay asynchronously, so that an
	// unreachable relay can never hold up the presentation itself.
	const script = document.createElement('script');
	script.src = RELAY + '/socket.io/socket.io.js';
	script.onload = () => {
		socket = io(RELAY);
		socket.on('connect', () => { console.log('[presenter] broadcasting ' + DECK_PATH); broadcast(); openQuestions(); });
		socket.on('disconnect', () => console.warn('[presenter] relay disconnected; reconnecting'));
	};
	script.onerror = () => console.warn('[presenter] relay unreachable at ' + RELAY + '; the presenter view will not follow');
	document.head.appendChild(script);
})();
