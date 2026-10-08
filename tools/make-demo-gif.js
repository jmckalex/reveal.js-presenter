/*
 * Make docs/demo.gif: the example deck on a "laptop" (with ?master) and the
 * presenter view on a "tablet", side by side, as the laptop steps through the
 * deck and a student sends a question.  Rebuild it after changing the look
 * of presenter.html or the example deck.
 *
 *   npm --prefix server install          # once, for the relay
 *   node tools/make-demo-gif.js
 *
 * Needs ImageMagick 7 (`magick`) for composing the frames.
 *
 * Environment:
 *   PUPPETEER_PATH   require puppeteer from here instead of the package's own.
 *                    Screenshots need a headless Chrome that renders frames;
 *                    if this hangs on the first screenshot, try another build.
 *   OUT              where to write the GIF (default docs/demo.gif)
 *
 * Like the end-to-end test, this polls on a timer and clicks from inside the
 * page; see the notes at the top of e2e-test.js for why.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { fork, execFileSync } = require('child_process');

const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');

const ROOT = path.resolve(__dirname, '..');
const DECK = '/example/index.html';
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs', 'demo.gif'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(resolve => {
	const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const clickIn = (page, selector) => page.$eval(selector, e => e.click());

(async () => {
	const secret = crypto.randomBytes(16).toString('hex');
	const channel = crypto.createHash('sha256').update(secret).digest('hex');
	const questionsKey = 'DEMO-' + crypto.randomBytes(4).toString('hex').toUpperCase();
	const questionsKeyHash = crypto.createHash('sha256').update(questionsKey).digest('hex');

	// The relay, on a free port.
	const relayPort = await freePort();
	const relay = fork(path.join(ROOT, 'server', 'relay.js'), [], { env: { ...process.env, PORT: relayPort, HOST: '127.0.0.1' }, silent: true });
	const relayUrl = `http://127.0.0.1:${relayPort}`;
	for (let i = 0; i < 50; i++) {
		try { if ((await fetch(relayUrl + '/')).ok) break; } catch (e) { /* not up yet */ }
		await sleep(100);
	}

	// The package, served with a presenter-config.js made for this run.
	let config = '';
	const site = http.createServer((req, res) => {
		const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (pathname === '/client/presenter-config.js') {
			res.writeHead(200, { 'Content-Type': MIME['.js'] });
			return res.end(config);
		}
		const file = path.join(ROOT, path.normalize(pathname));
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			return res.end();
		}
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		res.end(fs.readFileSync(file));
	});
	const sitePort = await freePort();
	await new Promise(r => site.listen(sitePort, '127.0.0.1', r));
	const SITE = `http://127.0.0.1:${sitePort}`;
	config = `window.PresenterConfig = { relay: ${JSON.stringify(relayUrl)}, channel: '${channel}', `
		+ `questionsKey: '${questionsKeyHash}', askUrl: '${SITE}/client/ask.html' };`;

	const browser = await puppeteer.launch();
	const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'presenter-demo-'));
	try {
		const laptop = await browser.newPage();
		await laptop.setViewport({ width: 1280, height: 800 });
		await laptop.goto(SITE + DECK + '?master=' + secret, { waitUntil: 'networkidle2' });
		await laptop.waitForFunction(() => window.Reveal && Reveal.isReady(), { polling: 200, timeout: 60000 });

		const tablet = await browser.newPage();
		await tablet.setViewport({ width: 1180, height: 820 });
		await tablet.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
		await clickIn(tablet, '#start-button');
		await tablet.waitForSelector('#q-keyform:not([hidden])', { timeout: 15000 });
		await tablet.type('#q-key', questionsKey);
		await clickIn(tablet, '#q-keyform button');

		// The tablet has followed once its current frame shows the laptop's state.
		const follows = async () => {
			const want = await laptop.evaluate(() => JSON.stringify(Reveal.getState()));
			await tablet.waitForFunction(w => {
				try {
					const s = document.getElementById('current').contentWindow.Reveal.getState();
					const t = JSON.parse(w);
					return s.indexh === t.indexh && s.indexv === t.indexv && (s.indexf ?? -1) === (t.indexf ?? -1);
				} catch (e) { return false; }
			}, { polling: 200, timeout: 15000 }, want);
			await sleep(700);
		};

		let n = 0;
		const frame = async (caption, hold = 1) => {
			const shot = async (page, name) => {
				await page.bringToFront();
				const file = path.join(frames, `${name}.png`);
				await page.screenshot({ path: file });
				return file;
			};
			const l = await shot(laptop, 'laptop');
			const t = await shot(tablet, 'tablet');
			const file = path.join(frames, `frame-${String(n++).padStart(2, '0')}.png`);
			// Laptop and tablet side by side, each labelled, with a caption below.
			execFileSync('magick', [
				'(', l, '-resize', '600x', '-gravity', 'north', '-background', '#f2f2f2', '-splice', '0x34',
					'-font', 'Helvetica', '-pointsize', '18', '-fill', '#444', '-annotate', '+0+8', 'Laptop: deck.html?master', ')',
				'(', t, '-resize', '600x', '-gravity', 'north', '-background', '#f2f2f2', '-splice', '0x34',
					'-font', 'Helvetica', '-pointsize', '18', '-fill', '#444', '-annotate', '+0+8', 'Tablet: presenter.html', ')',
				'-background', '#f2f2f2', '-gravity', 'north', '+smush', '16',
				'-bordercolor', '#f2f2f2', '-border', '12',
				'-gravity', 'south', '-splice', '0x40', '-pointsize', '20', '-fill', '#222', '-annotate', '+0+12', caption,
				file
			]);
			for (let i = 1; i < hold; i++) fs.copyFileSync(file, path.join(frames, `frame-${String(n++).padStart(2, '0')}.png`));
		};

		await follows();
		await frame('The tablet follows the laptop: current slide, next slide, notes, clock and timer', 2);
		for (const caption of ['Next: the following fragment, not just the following slide',
			'Each fragment the laptop shows moves the tablet too',
			'Fragments, vertical stacks and custom orders all work']) {
			await laptop.evaluate(() => Reveal.next());
			await follows();
			await frame(caption);
		}
		await laptop.evaluate(() => Reveal.slide(2, 0));
		await follows();
		await frame('Down a vertical stack');

		// The "Questions?" slide: only the laptop's copy shows the day's code and
		// a QR code for the ask page with that code filled in.
		await laptop.evaluate(() => Reveal.slide(Reveal.getIndices(document.getElementById('questions')).h, 0));
		await follows();
		await laptop.waitForFunction(() => document.querySelector('.question-qr svg'), { polling: 200, timeout: 15000 });
		await frame('Only the laptop shows the day’s code, and a QR code for the ask page', 2);

		// A student scans it and sends a question; it appears on the tablet.
		const code = await laptop.evaluate(() => document.querySelector('.question-code').textContent);
		const phone = await browser.newPage();
		await phone.setViewport({ width: 390, height: 760 });
		await phone.goto(SITE + '/client/ask.html?code=' + code, { waitUntil: 'domcontentloaded' });
		await phone.waitForFunction(() => !document.getElementById('send').disabled || document.getElementById('text'), { polling: 200, timeout: 15000 });
		await phone.type('#text', 'Does the next pane cope with fragments in a custom order?');
		await phone.waitForFunction(() => !document.getElementById('send').disabled, { polling: 200, timeout: 15000 });
		await clickIn(phone, '#send');
		await tablet.waitForFunction(() => document.querySelectorAll('#q-list li').length > 0, { polling: 200, timeout: 15000 });
		await sleep(500);
		await frame('A student scans the QR code and asks a question; only the tablet sees it', 3);

		fs.mkdirSync(path.dirname(OUT), { recursive: true });
		execFileSync('magick', ['-delay', '220', '-loop', '0', path.join(frames, 'frame-*.png'),
			'-layers', 'Optimize', '-colors', '128', OUT]);
		console.log(`wrote ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB, ${n} frames)`);
	}
	finally {
		await browser.close();
		site.close();
		relay.kill();
		fs.rmSync(frames, { recursive: true, force: true });
	}
})().catch(e => { console.error(e); process.exit(1); });
