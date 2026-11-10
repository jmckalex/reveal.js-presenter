// The laptop side (presenter-master.js and its modules), against a local relay and a local
// copy of the project: the plain deck and a ?presenter copy contact no relay;
// the plain deck loads no presenter module and leaves the custom elements
// alone; a ?presenter copy is a mirror (presenterMirror, the code, a versions
// chart, the screen); the ?master deck sends slides and screen with its
// position, and takes Drive's steps and strokes, sending the strokes on as ink.
//   node tools/laptop-test.js        (needs the internet, for reveal.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { fork } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const results = [];
const check = (ok, name, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   [' + JSON.stringify(detail) + ']' : ''}`); results.push(ok); };

(async () => {
	const secret = crypto.randomBytes(16).toString('hex');
	const channel = crypto.createHash('sha256').update(secret).digest('hex');
	const key = 'TEST-' + crypto.randomBytes(6).toString('hex');
	const keyHash = crypto.createHash('sha256').update(key).digest('hex');
	const relayPort = await freePort();
	const relay = fork(path.join(ROOT, 'server', 'relay.js'), [], { env: { ...process.env, PORT: relayPort, HOST: '127.0.0.1' }, silent: true });
	const RELAY = `http://127.0.0.1:${relayPort}`;
	for (let i = 0; i < 50; i++) { try { if ((await fetch(RELAY + '/')).ok) break; } catch (e) { } await sleep(100); }
	const sitePort = await freePort();
	const SITE = `http://127.0.0.1:${sitePort}`;
	const config = 'window.PresenterConfig = ' + JSON.stringify({ relay: RELAY, channel, questionsKey: keyHash, askUrl: SITE + '/client/ask.html' }) + ';';
	const site = http.createServer((req, res) => {
		const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (pathname === '/client/presenter-config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return res.end(config); }
		if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }		// no favicon, and no 404 counted as an error
		const file = path.join(ROOT, path.normalize(pathname));
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		res.end(fs.readFileSync(file));
	});
	await new Promise(r => site.listen(sitePort, '127.0.0.1', r));
	const browser = await puppeteer.launch();
	const DECK = SITE + '/example/index.html';
	const open = async url => {
		const page = await browser.newPage();
		page.requests = []; page.errors = [];
		page.on('request', r => page.requests.push(r.url()));
		page.on('pageerror', e => page.errors.push(e.message));
		page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') page.errors.push(m.type() + ': ' + m.text()); });
		page.on('response', r => { if (r.status() >= 400) page.errors.push('http ' + r.status() + ' ' + r.url()); });
		await page.goto(url);
		await page.waitForFunction(() => window.Reveal && Reveal.isReady && Reveal.isReady(), { polling: 200, timeout: 60000 });
		await sleep(1500);
		return page;
	};

	// The plain deck.
	const plain = await open(DECK);
	check(!plain.requests.some(u => u.startsWith(RELAY)), 'the plain deck contacts no relay');
	check(!plain.requests.some(u => /presenter-(polls|drive)/.test(u)), 'the plain deck loads no presenter module');
	check(await plain.evaluate(() => !document.querySelector('live-poll.poll, poll-results.poll-results') && !window.presenterMirror), 'the plain deck leaves the custom elements alone');
	check(!plain.errors.length, 'no errors on the plain deck', plain.errors);

	// A tablet's copy.
	const copy = await open(DECK + '?presenter');
	check(!copy.requests.some(u => u.startsWith(RELAY)), 'a ?presenter copy contacts no relay');
	check(copy.requests.some(u => /presenter-polls\.js/.test(u)) && !copy.requests.some(u => /presenter-drive/.test(u)), 'a ?presenter copy loads the poll module, not Drive');
	const mirror = await copy.evaluate(async () => {
		const m = window.presenterMirror;
		if (!m) return null;
		const asked = [];
		m.want = ids => asked.push(...ids);
		m.code('4321');
		m.tally({ id: 'chairman', total: 4, counts: [2, 1, 1, 0], dealt: [3, 1] });
		m.screen({ qrHidden: true, pen: false });
		Reveal.slide([...document.querySelectorAll('.reveal .slides > section')].indexOf(document.getElementById('poll-versions')));
		await new Promise(r => setTimeout(r, 1500));
		return {
			methods: Object.keys(m).sort().join(','),
			converted: !!document.querySelector('live-poll.poll[data-poll="chairman"]') && !!document.querySelector('poll-results.poll-results[data-poll="chairman"]'),
			code: [...document.querySelectorAll('.question-code')].map(e => e.textContent).join(','),
			qr: !!document.querySelector('.question-qr svg'),
			qrHidden: document.body.classList.contains('question-qr-hidden'),
			shares: [...document.querySelectorAll('#poll-versions .version .share')].map(e => e.textContent).join(','),
			summary: (document.querySelector('#poll-versions .poll-results .summary') || {}).textContent,
			asked: asked.join(','),
			pill: document.querySelector('.poll-pill') ? !document.querySelector('.poll-pill').hidden : null
		};
	});
	check(mirror && mirror.methods === 'board,code,reaction,reset,screen,sync,tally,want', 'presenterMirror has the course\'s methods', mirror && mirror.methods);
	check(mirror && mirror.converted, 'the custom elements become the older markup in a copy');
	check(mirror && mirror.code === '4321' && mirror.qr, 'the code handed it shows, in the QR code too', mirror);
	check(mirror && mirror.qrHidden, 'screen hides the QR code');
	check(mirror && mirror.shares === '67%,100%' && /dealt Harm 3, Help 1/.test(mirror.summary), 'a versions chart draws a column per version', mirror);
	check(mirror && mirror.asked.includes('chairman') && mirror.pill, 'on the poll\'s slide it wants the poll\'s tally and shows the pill', mirror);
	check(!copy.errors.filter(e => !/^warning/.test(e)).length, 'no errors in the copy', copy.errors);

	// The laptop, with a "tablet" socket listening with the key.
	const tablet = await browser.newPage();
	await tablet.goto(RELAY + '/');
	await tablet.addScriptTag({ url: RELAY + '/socket.io/socket.io.js' });
	await tablet.evaluate((RELAY, channel, key) => new Promise(resolve => {
		window.got = { positions: [], ink: [] };
		window.s = io(RELAY);
		s.on(channel, m => got.positions.push(m));
		s.on('ink', m => got.ink.push(m));
		s.on('connect', () => s.emit('questions-listen', { channel, key }, res => { window.listening = res; resolve(); }));
	}), RELAY, channel, key);
	const laptop = await open(DECK + '?master=' + secret);
	await sleep(3500);
	// Now that the laptop has opened questions, the key is accepted.
	const listened = await tablet.evaluate((channel, key) => new Promise(resolve => s.emit('questions-listen', { channel, key }, res => resolve(res))), channel, key);
	check(listened && listened.ok, 'the tablet\'s key is accepted', listened);
	check(laptop.requests.some(u => /presenter-drive\.js/.test(u)), 'the ?master deck loads presenter-drive.js');
	const position = await tablet.evaluate(() => got.positions[got.positions.length - 1]);
	check(position && position.slides > 5 && position.screen && typeof position.screen.qrHidden === 'boolean' && position.screen.pen === false
		&& position.chalkboard === 'chalkboard' && position.chalkboardGrid === true, 'the position carries slides, chalkboard, chalkboardGrid and screen', position && { slides: position.slides, screen: position.screen, chalkboard: position.chalkboard, grid: position.chalkboardGrid });
	const step = await tablet.evaluate((channel, key) => new Promise(resolve =>
		s.emit('driver', { channel, key, from: 'ab12cd34', seq: 1, at: { h: 0, v: 0, f: -1 }, ops: [{ type: 'next' }] }, res => resolve(res))), channel, key);
	await sleep(1500);
	const h = await laptop.evaluate(() => Reveal.getState().indexh);
	check(step && step.ok && h === 1, 'Drive\'s ▶ moves the laptop', { step, h });
	const stroke = await tablet.evaluate((channel, key) => new Promise(resolve =>
		s.emit('driver', { channel, key, from: 'ab12cd34', seq: 2, at: { h: 1, v: 0, f: -1 },
			ops: [{ type: 'draw', mode: 0, board: 0, color: 0, fromX: 100, fromY: 100, toX: 300, toY: 200 }] }, res => resolve(res))), channel, key);
	await sleep(1500);
	const drawn = await laptop.evaluate(() => RevealChalkboard.slideDrawings().notes.events.filter(e => e.type === 'draw').length);
	const ink = await tablet.evaluate(() => got.ink.flatMap(m => m.ops).filter(o => o.type === 'draw' && o.from === 'ab12cd34').length);
	check(stroke && stroke.ok && stroke.dropped === 0 && drawn === 1 && ink === 1, 'a stroke from Drive is drawn by the plugin and sent on as ink', { stroke, drawn, ink });
	const stale = await tablet.evaluate((channel, key) => new Promise(resolve =>
		s.emit('driver', { channel, key, from: 'ab12cd34', seq: 3, at: { h: 4, v: 0, f: -1 },
			ops: [{ type: 'draw', mode: 0, board: 0, color: 0, fromX: 1, fromY: 1, toX: 2, toY: 2 }] }, res => resolve(res))), channel, key);
	check(stale && stale.dropped === 1, 'a stroke for another slide is dropped', stale);
	// The new polls open on the relay as the laptop defines them (a phone joins and is sent each).
	const phone = await browser.newPage();
	await phone.goto(RELAY + '/');
	await phone.addScriptTag({ url: RELAY + '/socket.io/socket.io.js' });
	const code = listened && listened.code;
	await phone.evaluate((RELAY, channel, code) => new Promise(resolve => {
		window.polls = [];
		window.p = io(RELAY);
		p.on('poll', poll => polls.push(poll));
		p.on('connect', () => p.emit('audience-join', { channel, code, voter: 'v1234567890' }, () => resolve()));
	}), RELAY, channel, code);
	for (const id of ['poll-picks', 'poll-versions']) {
		await laptop.evaluate(id => Reveal.slide([...document.querySelectorAll('.reveal .slides > section')].indexOf(document.getElementById(id))), id);
		await sleep(1500);
	}
	const sent = await phone.evaluate(() => polls.filter(Boolean).map(q => ({ id: q.id, picks: q.picks, exclusive: q.exclusive, options: q.options, prompt: q.prompt, story: typeof q.story === 'string' && q.story.length > 100 })));
	const picks = sent.find(q => q.id === 'reading'), chairman = sent.find(q => q.id === 'chairman');
	check(picks && picks.picks === 3 && picks.exclusive === 3, 'exclusive: the relay takes "None of them" as the option alone, "all" as the other three', picks);
	check(chairman && /^Did the chairman (harm|help) the environment intentionally\?$/.test(chairman.prompt) && chairman.story, 'versions: a phone is dealt one story', chairman);
	check(!laptop.errors.some(e => /refused/.test(e)), 'the relay refused no poll', laptop.errors);
	// The question button is not added under webdriver, and there is no #customcontrols anyway.
	check(!await laptop.evaluate(() => document.getElementById('question-qr-button')), 'no question button under puppeteer');
	check(!laptop.errors.filter(e => !/^warning/.test(e)).length, 'no errors on the laptop', laptop.errors);
	console.log('warnings seen:', JSON.stringify([...plain.errors, ...copy.errors, ...laptop.errors].filter(e => /^warning/.test(e))));

	await browser.close();
	site.close();
	relay.kill();
	console.log(results.every(Boolean) ? 'All checks passed.' : results.filter(r => !r).length + ' FAILED');
	process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
