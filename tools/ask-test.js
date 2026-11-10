// The ask page on two phone-sized pages, against a local relay driven
// at the socket level (a "laptop" and a "tablet" in a page of their own):
// versions (each phone its own story, the same after a reload), rounds (a
// reset forgets the answer shown), exclusive picks, points sliders that stop
// at the total, words split as typed, and no page errors.
//   node tools/ask-test.js           (needs the internet, for Web Awesome)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
const { fork } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let failures = 0;
const check = (ok, what, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail !== undefined ? '   [' + JSON.stringify(detail) + ']' : ''}`); };
const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { polling: 200, timeout }, arg).then(() => true, () => false);

(async () => {
	const port = await freePort();
	const relay = fork(path.join(ROOT, 'server', 'relay.js'), [], { env: { ...process.env, PORT: port, HOST: '127.0.0.1' }, silent: true });
	const RELAY = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 50; i++) { try { if ((await fetch(RELAY + '/socket.io/?EIO=4&transport=polling')).ok) break; } catch (e) {} await sleep(100); }
	const secret = crypto.randomBytes(16).toString('hex');
	const channel = crypto.createHash('sha256').update(secret).digest('hex');
	const key = 'T-' + crypto.randomBytes(6).toString('hex');
	const keyHash = crypto.createHash('sha256').update(key).digest('hex');
	const CODE = '4321';

	const sitePort = await freePort();
	const SITE = `http://127.0.0.1:${sitePort}`;
	const config = 'window.PresenterConfig = ' + JSON.stringify({ relay: RELAY, channel, questionsKey: keyHash }) + ';';
	const site = http.createServer((req, res) => {
		const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (p === '/client/presenter-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(config); }
		const file = path.join(ROOT, path.normalize(p));
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
		res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' });
		res.end(fs.readFileSync(file));
	});
	await new Promise(r => site.listen(sitePort, '127.0.0.1', r));

	const browser = await puppeteer.launch();
	const errors = [];
	// The laptop and the tablet, as sockets in one page.
	const ctl = await browser.newPage();
	await ctl.goto(RELAY + '/');
	await ctl.addScriptTag({ url: RELAY + '/socket.io/socket.io.js' });
	await ctl.evaluate(async (RELAY, secret, channel, key, keyHash, CODE) => {
		const connect = () => new Promise(r => { const s = io(RELAY, { forceNew: true }); s.on('connect', () => r(s)); });
		window.call = (s, e, d) => new Promise(r => s.emit(e, d, r));
		window.laptop = await connect();
		window.tablet = await connect();
		window.tally = null;
		laptop.on('poll-tally', t => { window.tally = t; });
		await call(laptop, 'questions-open', { socketId: channel, secret, code: CODE, keyHash, audience: { reactions: [], pace: false } });
		await call(tablet, 'questions-listen', { channel, key });
		window.open_ = poll => call(laptop, 'poll-open', { socketId: channel, secret, poll });
		window.reset_ = () => call(tablet, 'reset', { channel, key });
		window.tallyOf = id => call(laptop, 'poll-results', { socketId: channel, secret, id });
	}, RELAY, secret, channel, key, keyHash, CODE);
	const open = poll => ctl.evaluate(p => open_(p), poll);

	const phone = async () => {
		const context = await browser.createBrowserContext();
		const page = await context.newPage();
		await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
		page.on('pageerror', e => errors.push(e.message));
		page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(m.text()); });
		page.on('response', r => { if (r.status() === 404 && !/\/favicon\.ico$/.test(r.url())) errors.push('404 ' + r.url()); });
		await page.goto(SITE + '/client/ask.html?code=' + CODE);
		return page;
	};

	// ---- Versions
	check((await open({ id: 'chairman', kind: 'choice', options: ['Yes', 'No'], prompt: 'Neutral prompt',
		versions: [{ name: 'Harm', prompt: 'Harm intentionally?', story: 'The harm story.' }, { name: 'Help', prompt: 'Help intentionally?', story: 'The help story.' }] })).ok, 'a poll in versions opens');
	const p1 = await phone(), p2 = await phone();
	const shows = page => page.evaluate(() => ({ story: document.getElementById('poll-story').textContent, storyShown: !document.getElementById('poll-story').hidden, prompt: document.getElementById('poll-prompt').textContent }));
	await until(p1, () => !document.getElementById('poll').hidden && document.getElementById('poll-story').textContent);
	await until(p2, () => !document.getElementById('poll').hidden && document.getElementById('poll-story').textContent);
	const s1 = await shows(p1), s2 = await shows(p2);
	check(s1.storyShown && s2.storyShown && s1.story !== s2.story, 'each phone shows its own story', [s1, s2]);
	check(/intentionally\?$/.test(s1.prompt) && s1.prompt !== s2.prompt, 'each phone shows its own version\'s question', [s1.prompt, s2.prompt]);
	await p1.reload();
	await until(p1, () => !document.getElementById('poll').hidden && document.getElementById('poll-story').textContent);
	check((await shows(p1)).story === s1.story, 'a reload brings back the same version', (await shows(p1)).story);
	await p1.evaluate(() => document.querySelector('#poll-options button').click());
	check(await until(p1, () => /Thanks/.test(document.getElementById('poll-status').textContent)), 'an answer to a version goes in');
	check(await p1.evaluate(() => document.querySelector('#poll-options button').getAttribute('aria-pressed') === 'true'), 'the answer shows as given');

	// ---- Rounds: a reset forgets the answer, and the phone must not show it as given
	check((await ctl.evaluate(() => reset_())).ok, 'the tablet resets the channel');
	await sleep(800);
	check(await until(p1, () => [...document.querySelectorAll('#poll-options button')].every(b => b.getAttribute('aria-pressed') !== 'true')),
		'after the reset the phone shows no answer as given (a new round)');
	await p1.reload();
	await until(p1, () => !document.getElementById('poll').hidden && document.querySelector('#poll-options button'));
	await sleep(500);
	check(await p1.evaluate(() => [...document.querySelectorAll('#poll-options button')].every(b => b.getAttribute('aria-pressed') !== 'true')),
		'nor after a reload in the new round');

	// ---- Exclusive picks
	check((await open({ id: 'reading', kind: 'choice', options: ['A novel', 'A newspaper', 'A blog', 'None of them'], picks: 4, exclusive: 3, prompt: 'Read this week?' })).ok, 'a picks poll with an exclusive option opens');
	await until(p1, () => document.querySelectorAll('#poll-checks wa-checkbox').length === 4);
	await sleep(1500);		// Web Awesome defined
	const lead = await p1.evaluate(() => document.getElementById('lead').textContent);
	check(/“None of them” on its own/.test(lead), 'the instructions name the exclusive option', lead);
	const tick = k => p1.evaluate(k => { const b = document.querySelectorAll('#poll-checks wa-checkbox')[k]; b.checked = !b.checked; b.dispatchEvent(new Event('change', { bubbles: true })); }, k);
	const ticked = () => p1.evaluate(() => [...document.querySelectorAll('#poll-checks wa-checkbox')].map(b => b.checked));
	await tick(0); await tick(1);
	const before = await ticked();
	await tick(3);
	const afterNone = await ticked();
	check(JSON.stringify(before) === '[true,true,false,false]' && JSON.stringify(afterNone) === '[false,false,false,true]', 'ticking "None of them" unticks the rest', [before, afterNone]);
	await tick(2);
	const afterBlog = await ticked();
	check(JSON.stringify(afterBlog) === '[false,false,true,false]', 'ticking another unticks "None of them"', afterBlog);
	await tick(3);
	await p1.evaluate(() => document.getElementById('poll-submit').click());
	check(await until(p1, () => /Thanks/.test(document.getElementById('poll-status').textContent)), '"None of them" alone is accepted');
	const t1 = await ctl.evaluate(() => tallyOf('reading'));
	check(t1.ok && t1.tally.answers.some(a => JSON.stringify(a[1]) === '[3]'), 'the relay has [3]', t1.tally && t1.tally.answers);

	// ---- Points: sliders stop at the total
	check((await open({ id: 'pts', kind: 'points', options: ['Orwell', 'Huxley', 'Neither'], total: 100, prompt: 'Credence?' })).ok, 'a points poll opens');
	await until(p1, () => document.querySelectorAll('#poll-body wa-slider').length === 3);
	await sleep(1000);
	const slide = (k, v) => p1.evaluate((k, v) => { const s = document.querySelectorAll('#poll-body wa-slider')[k]; s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); return s.value; }, k, v);
	const got = [await slide(0, 80), await slide(1, 50), await slide(2, 30)];
	check(JSON.stringify(got.map(Number)) === '[80,20,0]', 'each slider stops where the total would be passed', got);
	const outs = await p1.evaluate(() => [...document.querySelectorAll('#poll-body output')].map(o => o.textContent));
	check(JSON.stringify(outs) === '["80%","20%","0%"]', 'the shown values follow', outs);
	check(await p1.evaluate(() => !document.getElementById('poll-submit').disabled), 'Send is enabled at exactly the total');
	await p1.evaluate(() => document.getElementById('poll-submit').click());
	check(await until(p1, () => /Thanks/.test(document.getElementById('poll-status').textContent)), 'the points answer goes in');
	// Lower one, then the last dragged all the way gives exactly what is left.
	await slide(0, 60);
	const last = await slide(2, 100);
	check(Number(last) === 20, 'dragged all the way, the last slider gives exactly what is left', last);
	// A short answer is scaled by "Make it add up".
	await slide(1, 0); await slide(2, 0);
	await p1.evaluate(() => [...document.querySelectorAll('#poll-body button')].find(b => /add up/i.test(b.textContent)).click());
	const scaled = await p1.evaluate(() => [...document.querySelectorAll('#poll-body output')].map(o => o.textContent));
	check(scaled[0] === '100%', '"Make it add up" still scales a short answer up', scaled);

	// ---- Words: a tag per word, split as typed
	check((await open({ id: 'words', kind: 'words', entries: 3, moderated: false, prompt: 'Three words' })).ok, 'a word cloud opens');
	await until(p1, () => document.getElementById('poll-tags'));
	await sleep(1500);
	const hint = await p1.evaluate(() => document.getElementById('poll-tags').getAttribute('hint'));
	check(hint === 'Up to 3 words, 30 characters each.', 'the hint gives the limit in words', hint);
	const input = await p1.$('wa-tag-input >>> input');
	await input.type('action intention aim');
	await p1.keyboard.press('Enter');
	await sleep(1500);
	const tags = await p1.evaluate(() => [...document.getElementById('poll-tags').value]);
	check(JSON.stringify(tags) === '["action","intention","aim"]', 'typing "action intention aim" makes three tags', tags);
	check(await until(p1, () => /on the screen|waiting/.test(document.getElementById('poll-status').textContent)), 'the words are sent', await p1.evaluate(() => document.getElementById('poll-status').textContent));
	const tw = await ctl.evaluate(() => tallyOf('words'));
	check(tw.ok && tw.tally.words && tw.tally.words.length === 3, 'the relay has the three words, shown at once', tw.tally && tw.tally.words);

	// ---- The connection check: the page joins again while in view
	const lead2 = await p2.evaluate(() => document.getElementById('heading').textContent);
	check(lead2 === 'Live poll', 'the second phone follows the polls', lead2);

	check(errors.length === 0, 'no errors on the phones', errors);
	await browser.close();
	site.close();
	relay.kill();
	console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
	process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
