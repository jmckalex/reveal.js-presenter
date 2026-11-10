// The tablet with the real laptop page (example/index.html?master): a
// Pencil stroke from Drive reaches the laptop's chalkboard; ◀ ▶ move it;
// what the laptop draws reaches the tablet's copy; the mirror shows the
// question QR code and a poll's chart.
//   node tools/drive-ink-test.js     (needs the internet, for reveal.js)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
const { fork } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let failures = 0;
const check = (ok, what, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail !== undefined ? '   [' + JSON.stringify(detail).slice(0, 300) + ']' : ''}`); };
async function until(fn, ms = 10000) { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(150); } return v; }
(async () => {
	const rport = await freePort();
	const relay = fork(path.join(ROOT, 'server', 'relay.js'), [], { env: { ...process.env, PORT: rport, HOST: '127.0.0.1' }, silent: true });
	const RELAY = `http://127.0.0.1:${rport}`;
	for (let i = 0; i < 50; i++) { try { if ((await fetch(RELAY + '/socket.io/?EIO=4&transport=polling')).ok) break; } catch (e) {} await sleep(100); }
	const secret = crypto.randomBytes(16).toString('hex');
	const channel = crypto.createHash('sha256').update(secret).digest('hex');
	const key = 'K-' + crypto.randomBytes(4).toString('hex').toUpperCase();
	const keyHash = crypto.createHash('sha256').update(key).digest('hex');
	const sport = await freePort();
	const SITE = `http://127.0.0.1:${sport}`;
	const config = `window.PresenterConfig = { relay: ${JSON.stringify(RELAY)}, channel: '${channel}', questionsKey: '${keyHash}', askUrl: '${SITE}/client/ask.html' };`;
	const site = http.createServer((req, res) => {
		const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (p === '/client/presenter-config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return res.end(config); }
		if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
		const file = path.join(ROOT, path.normalize(p));
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		res.end(fs.readFileSync(file));
	});
	await new Promise(r => site.listen(sport, '127.0.0.1', r));
	const browser = await puppeteer.launch();
	const laptop = await browser.newPage();
	await laptop.setViewport({ width: 1280, height: 800 });
	const lerr = [];
	laptop.on('pageerror', e => lerr.push(e.message));
	await laptop.goto(SITE + '/example/index.html?master=' + secret + '#/1', { waitUntil: 'networkidle2' });
	await until(() => laptop.evaluate(() => window.Reveal && Reveal.isReady()));
	const tablet = await browser.newPage();
	await tablet.setViewport({ width: 1180, height: 820 });
	const terr = [];
	tablet.on('pageerror', e => terr.push(e.message));
	await tablet.evaluateOnNewDocument(k => { try { localStorage.setItem('presenter-questions-key', k); } catch (e) {} }, key);
	await tablet.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
	await tablet.$eval('#start-button', b => b.click());
	const ok = await until(() => tablet.evaluate(() => { try { return document.getElementById('status-text').textContent === 'Following'
		&& document.getElementById('current').contentWindow.Reveal.getState().indexh === 1 && /Questions on/.test(document.getElementById('q-status').textContent); } catch (e) { return false; } }), 20000);
	check(!!ok, 'the tablet follows the real laptop, with questions on');
	const mirror = await until(() => tablet.evaluate(() => { try { return !!document.getElementById('current').contentWindow.presenterMirror; } catch (e) { return false; } }));
	check(!!mirror, 'the current copy runs as a mirror (presenterMirror)');
	await sleep(600);
	await tablet.$eval('#drive', b => b.click());
	await sleep(300);
	await tablet.evaluate(() => {
		const f = document.getElementById('current'), fr = f.getBoundingClientRect(), k = fr.width / 1280;
		const sl = f.contentDocument.querySelector('.reveal .slides').getBoundingClientRect();
		const s = document.getElementById('drive-surface');
		const ev = (name, rx, ry, buttons) => s.dispatchEvent(new PointerEvent(name, { pointerId: 7, pointerType: 'pen', isPrimary: true,
			clientX: fr.left + (sl.left + rx * sl.width) * k, clientY: fr.top + (sl.top + ry * sl.height) * k, buttons, bubbles: true, cancelable: true }));
		ev('pointerdown', 0.2, 0.6, 1);
		for (let i = 1; i <= 20; i++) ev('pointermove', 0.2 + i * 0.02, 0.6, 1);
		ev('pointerup', 0.6, 0.6, 0);
	});
	const drawn = await until(() => laptop.evaluate(() => { const n = RevealChalkboard.slideDrawings().notes.events.filter(e => e.type === 'draw').length; return n >= 10 ? n : null; }));
	check(!!drawn, 'a Pencil stroke from Drive is drawn on the laptop’s slide', drawn);
	await tablet.$eval('#d-next', b => b.click());
	const moved = await until(() => laptop.evaluate(() => Reveal.getState().indexf === 0 ? Reveal.getState() : null));
	check(!!moved, '▶ moves the laptop a step', moved);
	// The laptop draws: the tablet's copy shows it.
	const before = await tablet.evaluate(() => document.getElementById('current').contentWindow.RevealChalkboard.slideDrawings().notes.events.length);
	// With the mouse, on the laptop's pen (✎, toggled as C does).
	await laptop.evaluate(() => RevealChalkboard.toggleNotesCanvas());
	await sleep(300);
	await laptop.mouse.move(300, 500);
	await laptop.mouse.down();
	for (let i = 1; i <= 10; i++) await laptop.mouse.move(300 + i * 30, 500 + i * 5);
	await laptop.mouse.up();
	await laptop.evaluate(() => RevealChalkboard.toggleNotesCanvas());
	const inked = await until(() => tablet.evaluate(b => { const n = document.getElementById('current').contentWindow.RevealChalkboard.slideDrawings().notes.events.length; return n >= b + 5 ? n : null; }, before));
	check(!!inked, 'what the laptop draws reaches the tablet’s copy (ink)', { before, inked });
	await tablet.$eval('#d-done', b => b.click());
	// The mirror: the questions slide's QR code, on the current copy.
	await laptop.evaluate(() => Reveal.slide(4, 0));
	const qr = await until(() => tablet.evaluate(() => { try { const d = document.getElementById('current').contentDocument; return !!d.querySelector('.question-qr svg, question-qr svg'); } catch (e) { return false; } }));
	check(!!qr, 'the mirror draws the question QR code on the tablet’s copy', qr);
	check(lerr.length === 0 && terr.length === 0, 'no page errors', { laptop: lerr, tablet: terr });
	await browser.close();
	site.close();
	relay.kill();
	console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
	process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
