#!/usr/bin/env node
'use strict';
/*
 * End-to-end test: a "laptop" page running example/index.html?master=<secret>
 * and a "tablet" page running client/presenter.html, joined through a relay.
 * It runs in landscape and in portrait, since portrait is where the next-slide
 * pane gets narrow enough to trip reveal.js 5's scroll view.
 *
 *   npm --prefix server install          # once, for the relay
 *   node tools/e2e-test.js
 *
 * Environment:
 *   RELAY_URL        test against an existing relay instead of starting server/relay.js
 *   REVEAL_VERSION   make the example deck load another reveal.js version (e.g. 6.0.2)
 *   PUPPETEER_PATH   where to require puppeteer from, if require('puppeteer') fails
 *   SCREENSHOTS      directory to save a screenshot of the tablet per orientation
 *
 * Note for anyone extending this: page.waitForFunction() polls on animation
 * frames by default, and a background tab gets none, so it times out however
 * correct the page is.  Everything here polls on a timer instead.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { fork } = require('child_process');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');

const ROOT = path.resolve(__dirname, '..');
const DECK = '/example/index.html';
const VIEWPORTS = [[1180, 820], [820, 1180]];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Click from inside the page.  page.click() needs the page to render a frame
// (it scrolls the element into view first), and in some headless setups none
// arrives: seen with Chrome 148, where the call hangs until the protocol
// times out though the page is fine.  element.click() runs the same handlers,
// including a form's submit.
const clickIn = (page, selector) => page.$eval(selector, e => e.click());
const freePort = () => new Promise(resolve => {
	const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
async function waitForHttp(url) {
	for (let i = 0; i < 50; i++) {
		try { if ((await fetch(url)).ok) return; } catch (e) { /* not up yet */ }
		await sleep(100);
	}
	throw new Error('relay did not start at ' + url);
}

const failures = [];
function check(ok, name, detail) {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   [' + detail + ']' : ''}`);
	if (!ok) failures.push(name);
}

(async () => {
	const secret = crypto.randomBytes(16).toString('hex');
	const channel = crypto.createHash('sha256').update(secret).digest('hex');
	const questionsKey = 'TEST-' + crypto.randomBytes(6).toString('hex').toUpperCase();
	const questionsKeyHash = crypto.createHash('sha256').update(questionsKey).digest('hex');

	let relayUrl = process.env.RELAY_URL;
	let relayProc = null;
	let relayLog = '';
	if (!relayUrl) {
		const port = await freePort();
		relayProc = fork(path.join(ROOT, 'server', 'relay.js'), [], { env: { ...process.env, PORT: port, HOST: '127.0.0.1' }, silent: true });
		relayProc.stdout.on('data', d => { relayLog += d; });
		relayProc.stderr.on('data', d => { relayLog += d; });
		relayUrl = `http://127.0.0.1:${port}`;
		await waitForHttp(relayUrl + '/');
	}
	const ownRelay = !process.env.RELAY_URL;

	// Serve the package, with a presenter-config.js generated for this run.
	// 127.0.0.1 is a secure context, so the laptop script's secret check runs.
	let config = `window.PresenterConfig = { relay: ${JSON.stringify(relayUrl)}, channel: '${channel}', questionsKey: '${questionsKeyHash}' };`;
	const site = http.createServer((req, res) => {
		const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (pathname === '/client/presenter-config.js') {
			res.writeHead(200, { 'Content-Type': MIME['.js'] });
			return res.end(config);
		}
		// No favicon, and no 404 for it either, which a page would log as an error.
		if (pathname === '/favicon.ico') {
			res.writeHead(204);
			return res.end();
		}
		const file = path.join(ROOT, path.normalize(pathname));
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			return res.end();
		}
		let body = fs.readFileSync(file);
		if (process.env.REVEAL_VERSION && pathname === DECK) {
			const version = process.env.REVEAL_VERSION;
			body = body.toString().replace(/reveal\.js@[\d.]+/g, 'reveal.js@' + version);
			// reveal.js 6 moved its plugins from plugin/<name>/<name>.js to dist/plugin/<name>.js.
			if (parseInt(version, 10) >= 6) body = body.replace(/\/plugin\/(\w+)\/\1\.js/g, '/dist/plugin/$1.js');
		}
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		res.end(body);
	});
	const sitePort = await freePort();
	await new Promise(r => site.listen(sitePort, '127.0.0.1', r));
	const SITE = `http://127.0.0.1:${sitePort}`;
	config = config.replace(' };', `, askUrl: '${SITE}/client/ask.html' };`);
	console.log(`relay ${relayUrl}${ownRelay ? ' (server/relay.js)' : ''}; reveal.js ${process.env.REVEAL_VERSION || 'as in example/'}`);

	const browser = await puppeteer.launch();
	const ready = page => page.waitForFunction(() => window.Reveal && Reveal.isReady && Reveal.isReady(), { polling: 200, timeout: 60000 });
	const pos = s => s.indexh + '/' + s.indexv + '/' + s.indexf;

	// A deck opened normally must not touch the relay at all.
	const plain = await browser.newPage();
	const relayRequests = [];
	plain.on('request', r => { if (r.url().startsWith(relayUrl)) relayRequests.push(r.url()); });
	await plain.goto(SITE + DECK, { waitUntil: 'networkidle2' });
	await ready(plain);
	await sleep(1000);
	check(relayRequests.length === 0 && await plain.evaluate(() => typeof io === 'undefined'),
		'a deck without ?master never contacts the relay', relayRequests.length + ' requests');

	// The same plain page then serves as an oracle for what "next" should be.
	const expectedNext = state => plain.evaluate(s => { Reveal.setState(s); Reveal.next(); return Reveal.getState(); }, state);
	const notesFor = state => plain.evaluate(s => { Reveal.setState(s); return (Reveal.getSlideNotes() || '').trim(); }, state);

	const laptop = await browser.newPage();
	await laptop.setViewport({ width: 1280, height: 800 });
	const laptopErrors = [];
	laptop.on('console', m => { if (m.type() === 'error') laptopErrors.push(m.text()); });
	laptop.on('pageerror', e => laptopErrors.push(e.message));

	for (const [W, H] of VIEWPORTS) {
		const orientation = W > H ? 'landscape' : 'portrait';
		console.log(`\n--- tablet ${W}x${H} (${orientation})`);

		const openTablet = async () => {
			const t = await browser.newPage();
			await t.setViewport({ width: W, height: H });
			t.errors = [];
			t.on('pageerror', e => t.errors.push(e.message));
			await t.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
			await clickIn(t, '#start-button');
			return t;
		};
		const view = t => t.evaluate(() => {
			const p = id => { try { const s = document.getElementById(id).contentWindow.Reveal.getState(); return s.indexh + '/' + s.indexv + '/' + s.indexf; } catch (e) { return null; } };
			const el = id => document.getElementById(id);
			return { cur: p('current'), up: p('upcoming'), status: el('status-text').textContent, counter: el('counter').textContent,
				notes: el('notes').innerText.replace(/\s+/g, ' ').trim(),
				badge: el('badge').hidden ? '' : el('badge').textContent, end: !el('end').hidden };
		});
		// The tablet has caught up once its current frame matches the laptop AND
		// its slide counter does.  The frame alone is not enough: a freshly
		// loaded frame sits on the first slide before the presenter has
		// positioned anything, which would "match" a laptop on that slide.
		async function follows(t, timeout = 6000) {
			const { want, counter } = await laptop.evaluate(() => {
				const s = Reveal.getState();
				return { want: s.indexh + '/' + s.indexv + '/' + s.indexf,
					counter: 'Slide ' + (Reveal.getSlidePastCount() + 1) + ' of ' + Reveal.getTotalSlides() };
			});
			const t0 = Date.now();
			let v;
			do {
				v = await view(t);
				if (v.cur === want && v.counter === counter) return { v, ms: Date.now() - t0, want };
				await sleep(100);
			} while (Date.now() - t0 < timeout);
			return { v, ms: null, want };
		}

		let tablet = await openTablet();
		if (orientation === 'landscape') {
			await sleep(1500);
			check((await view(tablet)).status === 'Waiting for the laptop', 'tablet waits before any laptop has spoken');
			await laptop.goto(SITE + DECK + '?master=' + secret, { waitUntil: 'networkidle2' });
			await ready(laptop);
		}

		const steps = [
			['title slide', () => Reveal.slide(0, 0)],
			['fragment slide', () => Reveal.slide(1, 0)],
			['next fragment', () => Reveal.next()],
			['next fragment', () => Reveal.next()],
			['jump into the middle of the fragments', () => Reveal.slide(1, 0, 1)],
			['vertical stack', () => Reveal.slide(2, 0)],
			['down (data-notes)', () => Reveal.down()],
			['slide without notes', () => Reveal.slide(3, 0)],
		];
		for (const [label, step] of steps) {
			await laptop.evaluate(step);
			const { v, ms, want } = await follows(tablet);
			const state = await laptop.evaluate(() => Reveal.getState());
			const next = pos(await expectedNext(state));
			const notes = (await notesFor(state)).replace(/\s+/g, ' ').trim().replace(/<[^>]+>/g, '');
			const notesOk = notes ? v.notes.includes(notes) : v.notes === 'No notes for this slide.';
			check(ms !== null && v.up === next && notesOk,
				`${label}: current ${want}, next ${next}, notes`,
				ms === null ? `tablet stuck at ${v.cur}` : `current ${v.cur}, next ${v.up}, ${ms} ms`);
		}

		await laptop.evaluate(() => Reveal.togglePause(true));
		await sleep(1200);
		check((await view(tablet)).badge.includes('Screen blanked'), 'blanking the screen shows a badge');
		await laptop.evaluate(() => Reveal.togglePause(false));

		await laptop.evaluate(() => Reveal.slide(Reveal.getHorizontalSlides().length - 1, 0));
		await follows(tablet);
		check((await view(tablet)).end, 'last slide shows "End of presentation"');

		if (process.env.SCREENSHOTS) {
			await laptop.evaluate(() => Reveal.slide(1, 0, 0));
			await follows(tablet);
			await sleep(800);
			await tablet.screenshot({ path: path.join(process.env.SCREENSHOTS, `presenter-${orientation}.png`) });
		}

		// A tablet that wakes up or joins late: no input from the laptop at all.
		await laptop.evaluate(() => Reveal.slide(1, 0, 1));
		await follows(tablet);
		check(tablet.errors.length === 0, 'no errors on the tablet page', tablet.errors.join('; '));
		await tablet.close();
		tablet = await openTablet();
		const late = await follows(tablet, 8000);
		const limit = ownRelay ? 2500 : 4500;	// replayed at once by relay.js; else the 3 s heartbeat
		check(late.ms !== null && late.ms < limit, 'a late-joining tablet catches up without the laptop moving',
			late.ms === null ? 'never caught up' : late.ms + ' ms after the page opened');
		check(tablet.errors.length === 0, 'no errors on the late tablet page', tablet.errors.join('; '));
		await tablet.close();
	}

	// A laptop with the wrong secret: it should complain locally, and the relay
	// should ignore it.
	console.log('\n--- wrong secret');
	const tablet = await browser.newPage();
	await tablet.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
	await laptop.evaluate(() => Reveal.slide(1, 0, 1));
	await sleep(1500);
	const impostor = await browser.newPage();
	const impostorErrors = [];
	impostor.on('console', m => { if (m.type() === 'error') impostorErrors.push(m.text()); });
	await impostor.goto(SITE + DECK + '?master=' + 'f'.repeat(32), { waitUntil: 'networkidle2' });
	await ready(impostor);
	await impostor.evaluate(() => Reveal.slide(3, 0));
	await sleep(2000);
	check(impostorErrors.some(e => e.includes('does not match')), 'a wrong secret is reported in the laptop console');
	const v = await tablet.evaluate(() => { const s = document.getElementById('current').contentWindow.Reveal.getState(); return s.indexh + '/' + s.indexv + '/' + s.indexf; });
	check(v === '1/0/1', 'the relay ignores a deck with the wrong secret', 'tablet at ' + v);
	check(laptopErrors.length === 0, 'no errors on the laptop page', laptopErrors.join('; '));

	// Audience questions need server/relay.js; a plain reveal/multiplex relay has none.
	if (ownRelay) {
		console.log('\n--- audience questions');
		await tablet.close();
		await impostor.close();

		const code = await laptop.evaluate(() => document.querySelector('.question-code').textContent);
		check(/^\d{4}$/.test(code), 'the laptop deck shows a 4-digit question code', code);
		const elsewhere = await plain.evaluate(() => document.querySelector('.question-code').textContent);
		check(elsewhere === '····', 'a deck without ?master does not show the code', elsewhere);

		// The laptop's QR code: decode it with a real QR reader, and follow it as a phone would.
		await laptop.bringToFront();
		await laptop.waitForFunction(() => document.querySelector('.question-qr svg'), { polling: 200, timeout: 15000 }).catch(() => {});
		const qrSvg = await laptop.evaluate(() => { const s = document.querySelector('.question-qr svg'); return s ? s.outerHTML : null; });
		check(!!qrSvg, 'the laptop deck draws a QR code');
		const qrElsewhere = await plain.evaluate(() => document.querySelector('.question-qr').innerHTML.trim());
		check(!qrElsewhere, 'a deck without ?master draws no QR code');
		let jsQR = null;
		try { jsQR = require.resolve('jsqr/dist/jsQR.js'); } catch (e) { /* not installed */ }
		if (!jsQR) console.log('SKIP  decoding the QR code: run npm install in the package root to get jsqr');
		else if (qrSvg) {
			const decoder = await browser.newPage();
			await decoder.addScriptTag({ path: jsQR });
			const decoded = await decoder.evaluate(svg => new Promise((resolve, reject) => {
				const img = new Image();
				img.onload = () => {
					const c = document.createElement('canvas');
					c.width = c.height = 600;
					const g = c.getContext('2d');
					g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 600); g.drawImage(img, 0, 0, 600, 600);
					const r = jsQR(g.getImageData(0, 0, 600, 600).data, 600, 600);
					resolve(r ? r.data : null);
				};
				img.onerror = () => reject(new Error('the QR SVG would not load as an image'));
				img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg', '<svg width="600" height="600"'));
			}), qrSvg);
			const expected = SITE + '/client/ask.html?code=' + code;
			check(decoded === expected, 'the QR code decodes to the ask page with today’s code', decoded);
			await decoder.close();
			if (decoded) {
				const scanned = await browser.newPage();
				await scanned.goto(decoded, { waitUntil: 'domcontentloaded' });
				const prefilled = await scanned.$eval('#code', e => e.value);
				check(prefilled === code, 'following it opens the ask page with the code filled in', prefilled);
				await scanned.close();
			}
		}

		// The presenter's tablet: a wrong key is refused, the right one accepted.
		const ipad = await browser.newPage();
		await ipad.setViewport({ width: 1180, height: 820 });
		ipad.errors = [];
		ipad.on('pageerror', e => ipad.errors.push(e.message));
		await ipad.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
		await clickIn(ipad, '#start-button');
		const qStatus = p => p.$eval('#q-status', e => e.textContent);
		const enterKey = async key => {
			await ipad.waitForSelector('#q-keyform:not([hidden])', { timeout: 15000 });
			await ipad.type('#q-key', key);
			await clickIn(ipad, '#q-keyform button');
		};
		await enterKey('WRONG-KEY');
		await ipad.waitForFunction(() => document.getElementById('q-status').textContent.includes('not accepted'), { polling: 200, timeout: 15000 });
		check(true, 'the tablet refuses a wrong questions key');
		await enterKey(questionsKey);
		await ipad.waitForFunction(() => document.getElementById('q-status').textContent.startsWith('Questions on'), { polling: 200, timeout: 15000 });
		const ipadStatus = await qStatus(ipad);
		check(ipadStatus === 'Questions on · code ' + code, 'the tablet accepts the right key, and shows the day’s code', ipadStatus);

		// Someone who knows the (public) channel but not the key.
		const stranger = await (await browser.createBrowserContext()).newPage();
		await stranger.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
		await sleep(1500);

		const student = await browser.newPage();
		await student.goto(SITE + '/client/ask.html', { waitUntil: 'domcontentloaded' });
		const ask = async (page, c, text) => {
			await page.bringToFront();	// Chrome may freeze a background page, and calls into it then hang
			await page.$eval('#status', e => { e.textContent = ''; });
			await page.$eval('#code', e => { e.value = ''; });
			await page.$eval('#text', e => { e.value = ''; });
			await page.type('#code', c);
			await page.type('#text', text);
			await page.waitForFunction(() => !document.getElementById('send').disabled, { polling: 100, timeout: 15000 });
			await clickIn(page, '#send');
			await page.waitForFunction(() => { const s = document.getElementById('status').textContent; return s && s !== 'Sending…'; }, { polling: 100, timeout: 15000 });
			return page.$eval('#status', e => e.textContent);
		};

		const wrong = String((Number(code) + 1) % 10000).padStart(4, '0');
		const r1 = await ask(student, wrong, 'Is this the right room?');
		check(r1.includes('doesn’t match'), 'a wrong slide code is refused', r1);

		const QUESTION = '<img src=x onerror="window.pwned=1">Why does Postman prefer Huxley to Orwell?';
		const r2 = await ask(student, code, QUESTION);
		check(r2.startsWith('Sent'), 'a question with the right code is accepted', r2);
		await ipad.waitForFunction(() => document.querySelectorAll('#q-list li').length === 1, { polling: 200, timeout: 10000 }).catch(() => {});
		const shown = await ipad.evaluate(() => ({
			text: (document.querySelector('#q-list li p') || {}).textContent,
			images: document.querySelectorAll('#q-list img').length,
			pwned: window.pwned === 1
		}));
		check(shown.text === QUESTION && shown.images === 0 && !shown.pwned,
			'it reaches the tablet verbatim, as text, with no HTML injected', JSON.stringify(shown));
		await stranger.bringToFront();
		const overheard = await stranger.evaluate(() => document.querySelectorAll('#q-list li').length);
		check(overheard === 0, 'a page without the key receives nothing', overheard + ' question(s) overheard');

		// An optional name, straight to the relay (ask.html sends none): it is
		// forwarded on one line, '' when absent, and refused when too long.
		const viaRelay = payload => student.evaluate((payload, channel, key) => new Promise(resolve => {
			const listener = io(window.PresenterConfig.relay, { forceNew: true });
			const sender = io(window.PresenterConfig.relay, { forceNew: true });
			let ack = null, got = null;
			const done = () => {
				if (!ack || (ack.ok && !got)) return;
				listener.close(); sender.close();
				resolve({ ack, got });
			};
			listener.emit('questions-listen', { channel, key }, () => {
				listener.on('question', q => { if (q.text === payload.text) { got = q; done(); } });
				sender.emit('question', Object.assign({ channel }, payload), a => { ack = a; done(); });
			});
			setTimeout(() => resolve({ ack, got, timedOut: true }), 8000);
		}), payload, channel, questionsKey);
		const named = await viaRelay({ code, text: 'A named question', name: '  Ada\n  Lovelace ' });
		check(named.got && named.got.name === 'Ada Lovelace', 'a name is forwarded with the question, on one line', JSON.stringify(named));
		const unnamed = await viaRelay({ code, text: 'An unnamed question' });
		check(unnamed.got && unnamed.got.name === '', 'with no name, the name is empty', JSON.stringify(unnamed));
		const longName = await viaRelay({ code, text: 'A question with a long name', name: 'x'.repeat(41) });
		check(longName.ack && longName.ack.reason === 'invalid' && !longName.got, 'a name over 40 characters is refused', JSON.stringify(longName));

		// Polls, straight to the relay (tools/polls-test.js drives them through the pages).
		console.log('\n--- polls');
		const P = await student.evaluate(async (secret, channel, code, wrong) => {
			const sleep = ms => new Promise(r => setTimeout(r, ms));
			const connect = () => new Promise(r => { const s = io(window.PresenterConfig.relay, { forceNew: true }); s.on('connect', () => r(s)); });
			const call = (s, event, data) => new Promise(r => s.emit(event, data, r));
			const out = {};
			const laptop = await connect();
			const tallies = [];
			laptop.on('poll-tally', t => tallies.push(t));
			out.forged = await call(laptop, 'poll-open', { socketId: channel, secret: 'not-the-secret', poll: { id: 'x', kind: 'choice', options: ['a', 'b'] } });
			const phones = await Promise.all([connect(), connect(), connect()]);
			const seen = phones.map(() => []);
			let phoneTallies = 0;
			phones.forEach((p, k) => { p.on('poll', d => seen[k].push(d)); p.on('poll-tally', () => phoneTallies++); });
			out.join = await call(phones[0], 'audience-join', { channel, code });
			await call(phones[1], 'audience-join', { channel, code });
			await call(phones[2], 'audience-join', { channel, code });
			out.joinWrong = await call(await connect(), 'audience-join', { channel, code: wrong });

			const choice = { id: 'colour', kind: 'choice', prompt: 'Which?', options: ['Red', 'Green', 'Blue'] };
			out.open = await call(laptop, 'poll-open', { socketId: channel, secret, poll: choice });
			await sleep(300);
			out.sent = seen.map(s => s.length ? s[s.length - 1].id : null);
			out.answers = [
				await call(phones[0], 'poll-answer', { channel, code, id: 'colour', value: 1, voter: 'voter-aaaa1111' }),
				await call(phones[1], 'poll-answer', { channel, code, id: 'colour', value: 1, voter: 'voter-bbbb2222' }),
				await call(phones[2], 'poll-answer', { channel, code, id: 'colour', value: 0, voter: 'voter-cccc3333' })
			];
			await sleep(1100);		// one answer per page per second
			out.change = await call(phones[2], 'poll-answer', { channel, code, id: 'colour', value: 2, voter: 'voter-cccc3333' });
			out.outOfRange = await call(phones[0], 'poll-answer', { channel, code, id: 'colour', value: 7, voter: 'voter-aaaa1111' });
			out.wrongCode = await call(phones[1], 'poll-answer', { channel, code: wrong, id: 'colour', value: 0 });
			await sleep(500);
			out.tally = tallies[tallies.length - 1];

			const hours = { id: 'hours', kind: 'number', prompt: 'How many hours?', instructions: 'Tap\none.', min: 0, max: 8, unit: 'h' };
			out.openNumber = await call(laptop, 'poll-open', { socketId: channel, secret, poll: hours });
			await sleep(300);
			out.sentNumber = seen[0][seen[0].length - 1];
			await sleep(800);
			out.number = await call(phones[0], 'poll-answer', { channel, code, id: 'hours', value: 3, voter: 'voter-aaaa1111' });
			out.numberOutOfRange = await call(phones[1], 'poll-answer', { channel, code, id: 'hours', value: 9, voter: 'voter-bbbb2222' });
			out.oldPoll = await call(phones[2], 'poll-answer', { channel, code, id: 'colour', value: 0, voter: 'voter-cccc3333' });

			laptop.emit('poll-close', { socketId: channel, secret });
			await sleep(300);
			out.closedSeen = seen[1][seen[1].length - 1];
			await sleep(800);
			out.afterClose = await call(phones[1], 'poll-answer', { channel, code, id: 'hours', value: 2, voter: 'voter-bbbb2222' });
			out.results = await call(laptop, 'poll-results', { socketId: channel, secret, id: 'colour' });
			out.reopen = await call(laptop, 'poll-open', { socketId: channel, secret, poll: choice });
			const late = await connect();
			out.lateJoin = await call(late, 'audience-join', { channel, code });
			laptop.emit('poll-close', { socketId: channel, secret });
			await sleep(300);
			out.phoneTallies = phoneTallies;
			[laptop, late, ...phones].forEach(s => s.close());
			return out;
		}, secret, channel, code, wrong);
		const J = x => JSON.stringify(x);
		check(P.forged && P.forged.reason === 'secret', 'only the secret can open a poll', J(P.forged));
		check(P.join && P.join.ok && P.join.poll === null && P.joinWrong.reason === 'code', 'phones join the audience with the day’s code, and only with it', J([P.join, P.joinWrong]));
		check(P.open.ok && J(P.open.tally.counts) === '[0,0,0]' && P.sent.every(id => id === 'colour'), 'opening a poll sends it to every phone', J(P.sent));
		check(P.answers.every(a => a.ok) && P.change.ok, 'answers are accepted, and a phone may change its answer', J([...P.answers, P.change]));
		check(P.outOfRange.reason === 'invalid' && P.wrongCode.reason === 'code', 'an impossible answer or a wrong code is refused', J([P.outOfRange, P.wrongCode]));
		check(P.tally && J(P.tally.counts) === '[0,2,1]' && P.tally.total === 3, 'the laptop gets the tally, one answer per phone', J(P.tally));
		check(P.openNumber.ok && P.sentNumber && P.sentNumber.id === 'hours' && P.sentNumber.max === 8 && P.sentNumber.instructions === 'Tap one.' && !('counts' in P.sentNumber), 'a number poll replaces it on the phones, without any tally', J(P.sentNumber));
		check(P.number.ok && P.numberOutOfRange.reason === 'invalid' && P.oldPoll.reason === 'closed', 'numbers are checked against the range; a replaced poll takes no answers', J([P.number, P.numberOutOfRange, P.oldPoll]));
		check(P.closedSeen === null && P.afterClose.reason === 'closed', 'closing a poll tells the phones, and refuses answers', J([P.closedSeen, P.afterClose]));
		check(P.results.ok && J(P.results.tally.counts) === '[0,2,1]' && J(P.reopen.tally.counts) === '[0,2,1]', 'the tally survives closing and reopening', J([P.results, P.reopen]));
		check(P.lateJoin.ok && P.lateJoin.poll && P.lateJoin.poll.id === 'colour', 'a phone joining late is sent the open poll', J(P.lateJoin));
		check(P.phoneTallies === 0, 'phones never receive the tally', P.phoneTallies);


		if (process.env.SCREENSHOTS) {
			const other = await browser.newPage();
			await other.setViewport({ width: 390, height: 760 });
			await other.goto(SITE + '/client/ask.html', { waitUntil: 'domcontentloaded' });
			await ask(other, code, 'Is Merrin saying there is no such thing as truth, or only that we no longer agree on it?');
			await other.screenshot({ path: path.join(process.env.SCREENSHOTS, 'ask-phone.png') });
			await other.close();
			await laptop.evaluate(() => Reveal.slide(1, 0, 1));
			await sleep(1500);
			await ipad.screenshot({ path: path.join(process.env.SCREENSHOTS, 'presenter-questions.png') });
			await ipad.setViewport({ width: 820, height: 1180 });
			await sleep(800);
			await ipad.screenshot({ path: path.join(process.env.SCREENSHOTS, 'presenter-questions-portrait.png') });
			await ipad.setViewport({ width: 1180, height: 820 });
		}
		const r3 = await ask(student, code, 'And a second question straight away');
		check(r3.includes('wait a few seconds'), 'a second question within 10 s is held back', r3);

		// The other kinds, and a word cloud's moderation by the tablet.
		console.log('\n--- poll kinds');
		const K = await student.evaluate(async (secret, channel, code, key) => {
			const sleep = ms => new Promise(r => setTimeout(r, ms));
			const connect = () => new Promise(r => { const s = io(window.PresenterConfig.relay, { forceNew: true }); s.on('connect', () => r(s)); });
			const call = (s, event, data) => new Promise(r => s.emit(event, data, r));
			const out = {};
			const laptop = await connect();
			let tally = null;
			laptop.on('poll-tally', t => { tally = t; });
			const open = poll => call(laptop, 'poll-open', { socketId: channel, secret, poll });
			const phones = await Promise.all([connect(), connect(), connect()]);
			const ids = ['voter-kind0001', 'voter-kind0002', 'voter-kind0003'];
			let phoneWords = 0, phoneTallies = 0;
			phones.forEach(p => { p.on('poll-words', () => phoneWords++); p.on('poll-tally', () => phoneTallies++); });
			for (const p of phones) await call(p, 'audience-join', { channel, code });
			const answer = (k, id, value) => call(phones[k], 'poll-answer', { channel, code, id, value, voter: ids[k] });
			const round = async (id, values) => { const r = []; for (let k = 0; k < values.length; k++) r.push(await answer(k, id, values[k])); await sleep(1100); return r; };
			const latest = async () => { await sleep(400); return tally; };

			out.bogus = await open({ id: 'bogus', kind: 'bogus' });
			out.badScale = await open({ id: 'bad', kind: 'scale', statements: ['S'], min: 0, max: 20 });

			out.multiOpen = await open({ id: 'multi', kind: 'choice', options: ['A', 'B', 'C', 'D'], picks: 2 });
			out.multi = await round('multi', [[2, 0], [2], [1, 3]]);
			out.multiBad = [await answer(0, 'multi', [0, 1, 2]), await answer(0, 'multi', [1, 1]), await answer(0, 'multi', 2)];
			out.multiTally = await latest();

			await open({ id: 'scale', kind: 'scale', statements: ['S1', 'S2'], min: 1, max: 5, labels: ['Disagree', 'Agree'] });
			out.scale = await round('scale', [[1, 5], [3, 4]]);
			out.scaleBad = [await answer(2, 'scale', [6, 1]), await answer(2, 'scale', [1])];
			out.scaleTally = await latest();

			out.premisesOpen = await open({ id: 'premises', kind: 'premises', statements: ['p', 'q', 'p and q'] });
			out.premises = await round('premises', [[1, 1, 1], [1, 0, 0], [0, 1, 0]]);
			out.premisesBad = await answer(0, 'premises', [1, 2, 1]);
			out.premisesTally = await latest();

			await open({ id: 'rank', kind: 'ranking', options: ['A', 'B', 'C'] });
			out.rank = await round('rank', [[2, 0, 1], [0, 1, 2], [1, 2, 0]]);
			out.rankBad = [await answer(0, 'rank', [0, 0, 1]), await answer(0, 'rank', [0, 1])];
			out.rankTally = await latest();

			// A word cloud, held for the tablet.
			const tablet = await connect();
			const seen = [];
			tablet.on('poll-words', m => seen.push(m));
			out.listen = await call(tablet, 'questions-listen', { channel, key });
			await open({ id: 'cloud', kind: 'words', entries: 2, prompt: 'One word for it' });
			await sleep(300);
			out.cloudOpened = seen[seen.length - 1];
			out.cloud = await round('cloud', [['Truth', 'trust'], ['truth!'], ['Lies']]);
			out.cloudBad = [await answer(0, 'cloud', ['a', 'b', 'c']), await answer(0, 'cloud', ['x'.repeat(31)]), await answer(0, 'cloud', [7])];
			await sleep(400);
			out.pending = seen[seen.length - 1];
			out.beforeTally = await latest();
			const moderate = data => call(tablet, 'poll-moderate', { channel, key, id: 'cloud', ...data });
			out.wrongKey = await call(tablet, 'poll-moderate', { channel, key: 'NOT-THE-KEY', id: 'cloud', word: 'truth', status: 'shown' });
			out.showOne = await moderate({ word: 'truth', status: 'shown' });
			out.afterOne = await latest();
			out.hideOne = await moderate({ word: 'lies', status: 'hidden' });
			out.showAll = await moderate({ all: true, status: 'shown' });
			out.afterAll = await latest();
			out.withdraw = await answer(2, 'cloud', []);
			out.afterWithdraw = await latest();
			const rejoined = await connect();
			const again = [];
			rejoined.on('poll-words', m => again.push(m));
			await call(rejoined, 'questions-listen', { channel, key });
			await sleep(300);
			out.rejoined = again[0];

			await open({ id: 'free', kind: 'words', moderated: false });
			await round('free', [['Open']]);
			out.free = await latest();
			out.phoneWords = phoneWords;
			out.phoneTallies = phoneTallies;
			laptop.emit('poll-close', { socketId: channel, secret });
			[laptop, tablet, rejoined, ...phones].forEach(s => s.close());
			return out;
		}, secret, channel, code, questionsKey);
		const aliasesOf = t => t ? t.answers.map(a => a[0]) : [];
		check(K.bogus.reason === 'invalid' && K.badScale.reason === 'invalid', 'an unknown kind, or an impossible definition, is refused', J([K.bogus, K.badScale]));
		check(K.multiOpen.ok && K.multi.every(a => a.ok) && K.multiBad.every(a => a.reason === 'invalid'), 'several picks: up to the limit, no repeats, as a list', J([K.multi, K.multiBad]));
		check(K.multiTally && J(K.multiTally.counts) === '[1,1,2,1]' && K.multiTally.total === 3 && J(K.multiTally.answers.map(a => a[1])) === '[[0,2],[2],[1,3]]', 'several picks: counts per option, and each answer sorted', J(K.multiTally));
		check(K.scale.every(a => a.ok) && K.scaleBad.every(a => a.reason === 'invalid') && J(K.scaleTally.answers.map(a => a[1])) === '[[1,5],[3,4]]' && !('counts' in K.scaleTally), 'a scale: one rating per statement, in range', J(K.scaleTally));
		check(K.premisesOpen.ok && K.premises.every(a => a.ok) && K.premisesBad.reason === 'invalid' && K.premisesTally.answers.length === 3, 'premises: accept or reject each statement', J(K.premisesTally));
		check(K.rank.every(a => a.ok) && K.rankBad.every(a => a.reason === 'invalid') && J(K.rankTally.answers.map(a => a[1])) === '[[2,0,1],[0,1,2],[1,2,0]]', 'a ranking: every option once', J(K.rankTally));
		const a1 = aliasesOf(K.multiTally), a2 = aliasesOf(K.rankTally);
		check(a1.length === 3 && new Set(a1).size === 3 && J(a1) === J(a2) && a1.every(a => /^[0-9a-f]{12}$/.test(a) && !a.includes('kind')), 'each phone has the same alias in every poll, and not its own id', J([a1, a2]));
		check(K.listen.ok && K.cloudOpened && K.cloudOpened.id === 'cloud' && K.cloudOpened.open && K.cloudOpened.moderated && K.cloudOpened.prompt === 'One word for it', 'opening a word cloud tells the tablet', J(K.cloudOpened));
		check(K.cloud.every(a => a.ok) && K.cloudBad.every(a => a.reason === 'invalid'), 'words: up to the limit, 30 characters each, text only', J([K.cloud, K.cloudBad]));
		check(K.pending && J(K.pending.words.map(w => [w.key, w.n, w.status])) === '[["truth",2,"pending"],["lies",1,"pending"],["trust",1,"pending"]]', 'the tablet gets every word, grouped, as pending', J(K.pending && K.pending.words));
		check(K.beforeTally && J(K.beforeTally.words) === '[]' && !('answers' in K.beforeTally) && K.beforeTally.total === 3, 'the laptop gets no words until they are shown, and never who gave them', J(K.beforeTally));
		check(K.wrongKey.reason === 'key' && K.showOne.ok && J(K.afterOne.words) === '[{"word":"Truth","n":2}]', 'only the key can show a word; a shown word reaches the laptop', J([K.wrongKey, K.afterOne]));
		check(K.hideOne.ok && K.showAll.ok && J(K.afterAll.words) === '[{"word":"Truth","n":2},{"word":"trust","n":1}]', '“show all” shows the pending words, not the hidden ones', J(K.afterAll));
		check(K.withdraw.ok && K.afterWithdraw.total === 2, 'an empty list withdraws a phone’s words', J(K.afterWithdraw));
		check(K.rejoined && K.rejoined.id === 'cloud' && K.rejoined.words.length === 2, 'a tablet that rejoins is sent the word cloud (as given now: withdrawn words go)', J(K.rejoined));
		check(K.free && J(K.free.words) === '[{"word":"Open","n":1}]', 'an unmoderated word cloud shows every word at once', J(K.free));
		check(K.phoneWords === 0 && K.phoneTallies === 0, 'phones never receive words or tallies', J([K.phoneWords, K.phoneTallies]));

		const closed = await student.evaluate(() => new Promise(resolve => {
			const s = io(window.PresenterConfig.relay, { forceNew: true });
			s.emit('question', { channel: '0'.repeat(64), code: '1234', text: 'Hello?' }, resolve);
		}));
		check(closed && closed.reason === 'closed', 'a channel nobody has opened refuses questions', JSON.stringify(closed));

		await ipad.close();
		const late = await browser.newPage();
		await late.goto(SITE + '/client/ask.html', { waitUntil: 'domcontentloaded' });
		const r4 = await ask(late, code, 'Is anyone there?');
		check(r4.includes('wasn’t delivered'), 'with the tablet gone, the student is told it was not delivered', r4);

		check(!relayLog.includes('Postman prefer') && !relayLog.includes('anyone there') && !relayLog.includes('Lovelace') && !relayLog.includes('voter-') && !relayLog.includes('Truth'), 'the relay never logs question text, names or poll answers');
		check(ipad.errors.length === 0, 'no errors on the tablet page', ipad.errors.join('; '));
	}

	await browser.close();
	site.close();
	if (relayProc) relayProc.kill();
	console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed.');
	process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(2); });
