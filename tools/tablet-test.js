// The tablet page, against a fake laptop (a socket proving the
// secret), so that it tests presenter.html, presenter-driver.js and
// presenter-ink.js alone: ?presenter copies, controls in the current copy
// only, the slide-count strip, Drive (Pencil, palm, steps, board drag,
// controls, overview goto), a deck without the chalkboard, ink and
// ink-slide, Reset and Reload.  In landscape and portrait.
//   node tools/tablet-test.js        (needs the internet, for reveal.js)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
const { fork } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let failures = 0;
const check = (ok, what, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail !== undefined ? '   [' + JSON.stringify(detail).slice(0, 300) + ']' : ''}`); };
async function until(fn, ms = 8000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(100); } return v; }

(async () => {
	const rport = await freePort();
	const relay = fork(path.join(ROOT, 'server', 'relay.js'), [], { env: { ...process.env, PORT: rport, HOST: '127.0.0.1' }, silent: true });
	const RELAY = `http://127.0.0.1:${rport}`;
	for (let i = 0; i < 50; i++) { try { if ((await fetch(RELAY + '/socket.io/?EIO=4&transport=polling')).ok) break; } catch (e) {} await sleep(100); }
	const secret = crypto.randomBytes(16).toString('hex');
	const channel = crypto.createHash('sha256').update(secret).digest('hex');
	const key = 'K-' + crypto.randomBytes(4).toString('hex').toUpperCase();
	const keyHash = crypto.createHash('sha256').update(key).digest('hex');
	const config = `window.PresenterConfig = { relay: ${JSON.stringify(RELAY)}, channel: '${channel}', questionsKey: '${keyHash}' };`;
	// The example deck, and a copy of it without the chalkboard plugin.
	const example = fs.readFileSync(path.join(ROOT, 'example/index.html'), 'utf8');
	const plain = example.replace(/<script src="\.\.\/client\/vendor\/chalkboard\/plugin\.js"><\/script>/, '')
		.replace('plugins: [RevealNotes, RevealChalkboard]', 'plugins: [RevealNotes]');
	const site = http.createServer((req, res) => {
		const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (p === '/client/presenter-config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return res.end(config); }
		if (p === '/example/plain.html') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(plain); }
		if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
		const file = path.join(ROOT, path.normalize(p));
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		res.end(fs.readFileSync(file));
	});
	const sport = await freePort();
	await new Promise(r => site.listen(sport, '127.0.0.1', r));
	const SITE = `http://127.0.0.1:${sport}`;
	const browser = await puppeteer.launch();

	// The fake laptop: proves the secret with positions, opens questions,
	// answers 'driver' and records it, records 'ink-want', sends ink.
	const laptop = await browser.newPage();
	await laptop.goto(RELAY + '/');
	await laptop.addScriptTag({ url: RELAY + '/socket.io/socket.io.js' });
	await laptop.evaluate(async (RELAY, secret, channel, keyHash) => {
		const s = io(RELAY, { transports: ['websocket'] });
		await new Promise(r => s.on('connect', r));
		window.got = { driver: [], want: [] };
		window.answer = { ok: true, dropped: 0 };
		s.on('driver', (b, ack) => { got.driver.push(b); ack(answer); });
		s.on('ink-want', w => got.want.push(w));
		window.position = { deck: '/example/index.html', state: { indexh: 0, indexv: 0, indexf: 0, paused: false, overview: false }, slides: null, chalkboard: 'chalkboard', chalkboardGrid: true, screen: null };
		window.send = () => s.emit('multiplex-statechanged', Object.assign({ socketId: channel, secret }, position));
		window.ink = (run, at, ops) => s.emit('ink', { socketId: channel, run, at, ops });
		window.inkSlide = d => s.emit('ink-slide', Object.assign({ socketId: channel }, d));
		await new Promise(r => s.emit('questions-open', { socketId: channel, secret, code: '1234', keyHash }, r));
		send();
		setInterval(send, 1000);
		setInterval(() => s.emit('questions-open', { socketId: channel, secret, code: '1234', keyHash }, () => {}), 20000);
	}, RELAY, secret, channel, keyHash);
	const setLaptop = (change) => laptop.evaluate(c => { Object.assign(position, c); if (c.state) position.state = Object.assign({ paused: false, overview: false }, c.state); send(); }, change);
	const driverOps = () => laptop.evaluate(() => got.driver.flatMap(b => b.ops));
	const clearDriver = () => laptop.evaluate(() => { got.driver = []; got.want = []; });

	for (const [W, H] of [[1180, 820], [820, 1180]]) {
		console.log(`\n--- tablet ${W}x${H}`);
		await setLaptop({ deck: '/example/index.html', state: { indexh: 0, indexv: 0, indexf: 0 }, slides: null, screen: null });
		const tablet = await browser.newPage();
		await tablet.setViewport({ width: W, height: H });
		const errors = [];
		tablet.on('pageerror', e => errors.push(e.message));
		await tablet.evaluateOnNewDocument(k => { try { localStorage.setItem('presenter-questions-key', k); } catch (e) {} }, key);
		await tablet.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
		await tablet.$eval('#start-button', b => b.click());
		const ready = await until(() => tablet.evaluate(() => {
			try { return document.getElementById('current').contentWindow.Reveal.isReady() && document.getElementById('upcoming').contentWindow.Reveal.isReady()
				&& document.getElementById('status-text').textContent === 'Following' && /Questions on/.test(document.getElementById('q-status').textContent); } catch (e) { return false; }
		}), 20000);
		check(!!ready, 'the tablet follows, with questions on');
		const srcs = await tablet.evaluate(() => ['current', 'upcoming'].map(id => document.getElementById(id).getAttribute('src')));
		check(srcs.every(s => s === '/example/index.html?presenter'), 'both copies are loaded with ?presenter', srcs);
		check(await tablet.evaluate(() => localStorage.getItem('presenter-lecturer') === '1'), 'the key marks this browser as the lecturer’s');

		const look = await tablet.evaluate(() => {
			const vis = (id, sel) => { const e = document.getElementById(id).contentDocument.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
			return { curControls: vis('current', '.reveal .controls .navigate-right'), upControls: vis('upcoming', '.reveal .controls .navigate-right'),
				curProgress: vis('current', '.reveal .progress'), upProgress: vis('upcoming', '.reveal .progress'),
				curHandle: !!document.getElementById('current').contentDocument.querySelector('div.boardhandle'),
				upHandleShown: vis('upcoming', 'div.boardhandle') };
		});
		check(look.curControls && look.curProgress && !look.upControls && !look.upProgress && look.curHandle && !look.upHandleShown,
			'the current copy shows reveal’s controls and progress bar, the next copy none (nor the chalkboard’s handle)', look);

		// The slide count.
		const total = await tablet.evaluate(() => document.getElementById('current').contentWindow.Reveal.getTotalSlides());
		await setLaptop({ slides: total + 1 });
		const differ = await until(() => tablet.evaluate(() => !document.getElementById('mismatch').hidden && document.getElementById('status-text').textContent));
		check(differ === 'Following, but the copies differ', 'another slide count: the red strip and the status', differ);
		await setLaptop({ slides: total });
		check(await until(() => tablet.evaluate(() => document.getElementById('mismatch').hidden && document.getElementById('status-text').textContent === 'Following')), 'the same count: the strip goes');

		// Overview and blank: the current copy shows them, the next does not.
		await setLaptop({ state: { indexh: 1, indexv: 0, indexf: 0, overview: true } });
		const ov = await until(() => tablet.evaluate(() => {
			const c = document.getElementById('current').contentWindow.Reveal, u = document.getElementById('upcoming').contentWindow.Reveal;
			return c.isOverview() && !u.isOverview() ? { badge: document.getElementById('badge').textContent } : null;
		}));
		check(!!ov && ov.badge.includes('Overview open'), 'the overview: shown on the current copy, with a badge; not on the next', ov);

		// Drive.
		await tablet.$eval('#drive', b => b.click());
		check(await tablet.evaluate(() => document.body.classList.contains('driving') && !document.getElementById('drive-bar').hidden && !document.getElementById('drive-surface').hidden), 'Drive: the bar and the surface');
		await clearDriver();
		// In the overview, a slide tapped is a goto.
		const tapAt = (selector, type = 'touch') => tablet.evaluate((selector, type) => {
			const f = document.getElementById('current'), fr = f.getBoundingClientRect(), k = fr.width / 1280;
			const control = f.contentDocument.querySelector(selector);
			if (!control) return false;
			const r = control.getBoundingClientRect();
			const o = { pointerId: 31, pointerType: type, isPrimary: true, clientX: fr.left + (r.left + r.width / 2) * k, clientY: fr.top + (r.top + r.height / 2) * k, bubbles: true, cancelable: true };
			const s = document.getElementById('drive-surface');
			s.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ buttons: 1 }, o)));
			s.dispatchEvent(new PointerEvent('pointerup', Object.assign({ buttons: 0 }, o)));
			return true;
		}, selector, type);
		await tapAt('.reveal .slides > section:nth-child(4)');
		const goto = await until(async () => (await driverOps()).find(o => o.type === 'goto'));
		check(goto && goto.h === 3, 'a slide tapped in the overview: goto', goto);
		await setLaptop({ state: { indexh: 1, indexv: 0, indexf: 0 } });
		await until(() => tablet.evaluate(() => !document.getElementById('current').contentWindow.Reveal.isOverview()));
		await sleep(400);		// the plugin's settling time

		// A Pencil stroke: drawn here, and sent.
		await clearDriver();
		const stroke = (from, to, type = 'pen', id = 7) => tablet.evaluate((from, to, type, id) => {
			const f = document.getElementById('current'), fr = f.getBoundingClientRect(), k = fr.width / 1280;
			const sl = f.contentDocument.querySelector('.reveal .slides').getBoundingClientRect();
			const s = document.getElementById('drive-surface');
			const ev = (name, rx, ry, buttons) => s.dispatchEvent(new PointerEvent(name, { pointerId: id, pointerType: type, isPrimary: true,
				clientX: fr.left + (sl.left + rx * sl.width) * k, clientY: fr.top + (sl.top + ry * sl.height) * k, buttons, pressure: buttons ? 0.5 : 0, bubbles: true, cancelable: true }));
			ev('pointerdown', from[0], from[1], 1);
			for (let i = 1; i <= 20; i++) ev('pointermove', from[0] + (to[0] - from[0]) * i / 20, from[1] + (to[1] - from[1]) * i / 20, 1);
			ev('pointerup', to[0], to[1], 0);
		}, from, to, type, id);
		await stroke([0.2, 0.5], [0.6, 0.55]);
		const draws = await until(async () => { const ops = await driverOps(); return ops.filter(o => o.type === 'draw').length >= 10 ? ops : null; });
		check(!!draws && draws.every(o => o.type !== 'draw' || (o.mode === 0 && o.fromX > 100 && o.toX < 700)), 'a Pencil stroke reaches the laptop, in the deck’s units', draws && draws.slice(0, 2));
		const here = await tablet.evaluate(() => document.getElementById('current').contentWindow.RevealChalkboard.slideDrawings().notes.events.filter(e => e.type === 'draw').length);
		check(here >= 10, 'and is drawn on the copy at once', here);

		// A palm: a touch while the Pencil is down writes nothing.
		await clearDriver();
		await tablet.evaluate(() => {
			const s = document.getElementById('drive-surface'), r = s.getBoundingClientRect();
			const ev = (name, id, type, x, y, buttons) => s.dispatchEvent(new PointerEvent(name, { pointerId: id, pointerType: type, isPrimary: type === 'pen', clientX: r.left + x * r.width, clientY: r.top + y * r.height, buttons, bubbles: true, cancelable: true }));
			ev('pointerdown', 99, 'pen', 0.1, 0.1, 1);
			ev('pointerdown', 50, 'touch', 0.7, 0.7, 1);
			for (let i = 1; i <= 10; i++) ev('pointermove', 50, 'touch', 0.7 + i * 0.01, 0.7, 1);
			ev('pointerup', 50, 'touch', 0.8, 0.7, 0);
			ev('pointerup', 99, 'pen', 0.1, 0.1, 0);
		});
		await sleep(800);
		check((await driverOps()).filter(o => o.type === 'draw').length === 0, 'a palm while the Pencil is down writes nothing');

		// ◀ ▶ and reveal's arrow, as controls.
		await clearDriver();
		await tablet.$eval('#d-next', b => b.click());
		await tablet.$eval('#d-prev', b => b.click());
		const tapped = await tapAt('.reveal .controls .navigate-right');
		const steps = await until(async () => { const t = (await driverOps()).map(o => o.type); return t.length >= 3 ? t : null; });
		check(tapped && JSON.stringify(steps) === '["next","prev","right"]', '◀ ▶, and reveal’s arrow tapped in the copy', steps);

		// The board: opened, and dragged by a finger.
		await clearDriver();
		await tablet.$eval('#d-board', b => b.click());
		await sleep(300);
		await tablet.evaluate(() => {
			const s = document.getElementById('drive-surface'), r = s.getBoundingClientRect();
			const ev = (name, y, buttons) => s.dispatchEvent(new PointerEvent(name, { pointerId: 60, pointerType: 'touch', isPrimary: false, clientX: r.left + r.width / 2, clientY: r.top + y * r.height, buttons, bubbles: true, cancelable: true }));
			ev('pointerdown', 0.8, 1);
			for (let i = 1; i <= 10; i++) ev('pointermove', 0.8 - i * 0.04, 1);
			ev('pointerup', 0.4, 0);
		});
		const board = await until(async () => { const ops = await driverOps(); return ops.some(o => o.type === 'scroll') ? ops : null; });
		check(!!board && board[0].type === 'showChalkboard' && board.some(o => o.type === 'scroll' && o.y > 0), 'Board opens the chalkboard, and a finger scrolls it', board && board.map(o => o.type));
		const boardHere = await tablet.evaluate(() => document.getElementById('current').contentWindow.RevealChalkboard.boardOpen());
		check(boardHere === true, 'the copy’s board is open too');
		await tablet.$eval('#d-pen', b => b.click());
		await sleep(300);

		// Ink: something drawn on the laptop reaches the copy; ink-want on arriving.
		const before = await tablet.evaluate(() => document.getElementById('current').contentWindow.RevealChalkboard.slideDrawings().notes.events.length);
		const run = crypto.randomBytes(6).toString('hex');
		await laptop.evaluate((run) => ink(run, { h: 1, v: 0, f: 0 }, [1, 2, 3].map(n => ({ n, type: 'draw', mode: 0, board: 0, color: 1, fromX: 100 + n * 10, fromY: 300, toX: 110 + n * 10, toY: 310 }))), run);
		const after = await until(() => tablet.evaluate(b => { const n = document.getElementById('current').contentWindow.RevealChalkboard.slideDrawings().notes.events.length; return n >= b + 3 ? n : null; }, before));
		check(!!after, 'the laptop’s ink is drawn on the current copy', { before, after });
		await clearDriver();
		await setLaptop({ state: { indexh: 3, indexv: 0, indexf: 0 } });
		const want = await until(() => laptop.evaluate(() => got.want.length ? got.want[0] : null));
		check(!!want && want.at && want.at.h === 3, 'arriving on a slide asks for its drawings (ink-want)', want);
		// ink-slide replaces the slide's drawings.
		await sleep(400);
		await laptop.evaluate((run) => inkSlide({ run, at: { h: 3, v: 0, f: 0 }, n: 10, part: 0, parts: 1, slide: { h: 3, v: 0 }, mode: 0, durations: [5000, 0],
			notes: [{ type: 'draw', color: 2, x1: 100, y1: 100, x2: 300, y2: 300, time: 10, board: 0 }, { type: 'draw', color: 2, x1: 300, y1: 300, x2: 500, y2: 100, time: 20, board: 0 }], board: [] }), run);
		const slideInk = await until(() => tablet.evaluate(() => { const d = document.getElementById('current').contentWindow.RevealChalkboard.slideDrawings(); return d.notes.events.length === 2 ? d.notes.events.length : null; }));
		check(slideInk === 2, 'a slide’s drawings (ink-slide) put in place on the copy', slideInk);

		// Done; Reset.
		await tablet.$eval('#d-done', b => b.click());
		check(await tablet.evaluate(() => !document.body.classList.contains('driving') && document.getElementById('drive-surface').hidden), 'Done ends Drive');
		await tablet.$eval('#q-reset', b => b.click());
		const armed = await tablet.evaluate(() => document.getElementById('q-reset').textContent);
		await tablet.$eval('#q-reset', b => b.click());
		const reset = await until(() => tablet.evaluate(() => /Reset done|Not reset/.test(document.getElementById('q-reset').textContent) && document.getElementById('q-reset').textContent));
		check(armed === 'Tap again' && reset === 'Reset done', 'Reset: two taps, and the relay resets', [armed, reset]);

		// Reload: two taps, the files fetched afresh, the timer resumed.
		await tablet.evaluate(() => {
			const original = window.fetch;
			window.fetch = (url, init) => {
				if (init && init.cache === 'reload') {
					const list = JSON.parse(sessionStorage.getItem('refetched') || '[]');
					list.push(new URL(url, location.href).pathname);
					sessionStorage.setItem('refetched', JSON.stringify(list));
				}
				return original(url, init);
			};
		});
		await tablet.$eval('#reload', b => b.click());
		const nav = tablet.waitForNavigation({ timeout: 30000 }).catch(() => null);
		await tablet.$eval('#reload', b => b.click());
		await nav;
		const resumed = await until(() => tablet.evaluate(() => document.getElementById('start-button').textContent), 10000);
		const files = await tablet.evaluate(() => JSON.parse(sessionStorage.getItem('refetched') || '[]'));
		check(files.some(u => u.startsWith('/client/presenter-driver.js')) && files.some(u => u.startsWith('/client/vendor/chalkboard/plugin.js'))
			&& !files.some(u => u.includes('/socket.io/')), 'Reload fetches the site’s files afresh (the page’s, and its copies’)', files.length + ' files: ' + files.slice(0, 8).join(' '));
		check(resumed === 'Resume', 'after Reload, Start reads Resume', resumed);
		await tablet.$eval('#start-button', b => b.click());
		const t = await until(() => tablet.evaluate(() => { const s = document.getElementById('timer').textContent; return s !== '0:00' ? s : null; }), 3000);
		check(!!t, 'and the timer carries on', t);

		// A deck without the chalkboard plugin: Drive steps, and has no pen.
		await setLaptop({ deck: '/example/plain.html', state: { indexh: 1, indexv: 0, indexf: 0 }, slides: null });
		await until(() => tablet.evaluate(() => { try { return document.getElementById('current').getAttribute('src').startsWith('/example/plain.html') && document.getElementById('current').contentWindow.Reveal.isReady(); } catch (e) { return false; } }), 20000);
		await sleep(500);
		await tablet.$eval('#drive', b => b.click());
		await clearDriver();
		await tablet.$eval('#d-next', b => b.click());
		const plainStep = await until(async () => (await driverOps()).find(o => o.type === 'next'));
		const tools = await tablet.evaluate(() => ({ pen: document.getElementById('d-pen').hidden, status: document.getElementById('d-status').textContent }));
		check(!!plainStep && tools.pen && /no chalkboard plugin/.test(tools.status), 'a deck without the chalkboard: ◀ ▶ work, and the pen is hidden, saying why', tools);
		await stroke([0.2, 0.5], [0.6, 0.55]);
		await sleep(500);
		check(!(await driverOps()).some(o => o.type === 'draw'), 'and a stroke there sends nothing');
		await tablet.$eval('#d-done', b => b.click());

		check(errors.length === 0, 'no errors on the tablet page', errors);
		await tablet.close();
	}
	await browser.close();
	site.close();
	relay.kill();
	console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
	process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
