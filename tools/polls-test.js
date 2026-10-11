#!/usr/bin/env node
'use strict';
/*
 * Live polls through the pages: example/index.html on a "laptop" with
 * ?master=<secret>, client/presenter.html on a "tablet", and three "phones"
 * on client/ask.html, each in a browser context of its own (so each has its
 * own random voter id), joined through a local relay.  It checks that the
 * polls open on the phones, that answers reach the laptop's charts and the
 * tablet's count, that a word cloud's words wait for the tablet, that before
 * and after counts a changed mind, the ranking's voting rules, the beauty
 * contest, the overlay step (left out of the position the tablet is sent),
 * the board, reactions and "Lost?"; and that the deck opened without
 * ?master loads none of it, contacts no relay and draws nothing.
 *
 *   npm --prefix server install          # once, for the relay
 *   node tools/polls-test.js
 *
 * Environment:
 *   RELAY_URL        test against an existing relay instead of starting server/relay.js
 *   REVEAL_VERSION   make the example deck load another reveal.js version (e.g. 6.0.2)
 *   PUPPETEER_PATH   where to require puppeteer from, if require('puppeteer') fails
 *   SCREENSHOTS      directory to save screenshots of the laptop's charts and a phone
 *
 * The phones load Web Awesome, and the laptop d3-cloud and reveal.js, from
 * jsDelivr, so this needs the internet.  Everything waits with
 * waitForFunction(..., { polling: 200 }): the default polls on animation
 * frames, which a background tab never gets.
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const REACTIONS = ['👍', '🤯', '😂'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Click from inside the page: page.click() needs rendered frames (see e2e-test.js).
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
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   [' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + ']' : ''}`);
	if (!ok) failures.push(name);
}
// Wait for a condition in a page; false (not an exception) if it never holds.
const until = (page, fn, arg, timeout = 15000) =>
	page.waitForFunction(fn, { polling: 200, timeout }, arg).then(() => true, () => false);

(async () => {
	const secret = crypto.randomBytes(16).toString('hex');
	const channel = crypto.createHash('sha256').update(secret).digest('hex');
	const questionsKey = 'TEST-' + crypto.randomBytes(6).toString('hex').toUpperCase();
	const questionsKeyHash = crypto.createHash('sha256').update(questionsKey).digest('hex');

	let relayUrl = process.env.RELAY_URL;
	let relayProc = null;
	if (!relayUrl) {
		const port = await freePort();
		relayProc = fork(path.join(ROOT, 'server', 'relay.js'), [], { env: { ...process.env, PORT: port, HOST: '127.0.0.1' }, silent: true });
		relayUrl = `http://127.0.0.1:${port}`;
		await waitForHttp(relayUrl + '/');
	}

	// Serve the package, with a presenter-config.js generated for this run.
	const sitePort = await freePort();
	const SITE = `http://127.0.0.1:${sitePort}`;
	const config = 'window.PresenterConfig = ' + JSON.stringify({
		relay: relayUrl, channel, questionsKey: questionsKeyHash, askUrl: SITE + '/client/ask.html', reactions: REACTIONS
	}) + ';';
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
	await new Promise(r => site.listen(sitePort, '127.0.0.1', r));
	console.log(`relay ${relayUrl}${relayProc ? ' (server/relay.js)' : ''}; reveal.js ${process.env.REVEAL_VERSION || 'as in example/'}`);

	const browser = await puppeteer.launch();
	const ready = page => page.waitForFunction(() => window.Reveal && Reveal.isReady && Reveal.isReady(), { polling: 200, timeout: 60000 });
	// Script errors, console errors, and failed loads by address (Chrome's own
	// console message for those has none).  The favicon, which nothing here
	// serves, does not count.
	const errorsOf = page => {
		page.errors = [];
		page.on('pageerror', e => page.errors.push(e.message));
		page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) page.errors.push(m.text()); });
		page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) page.errors.push(r.status() + ' ' + r.url()); });
		page.on('requestfailed', r => page.errors.push('failed ' + r.url()));
		return page;
	};
	const J = x => JSON.stringify(x);

	// ---- The deck without ?master: an ordinary deck.
	console.log('\n--- the deck without ?master');
	const plain = errorsOf(await browser.newPage());
	const plainRequests = [];
	plain.on('request', r => plainRequests.push(r.url()));
	await plain.goto(SITE + DECK, { waitUntil: 'networkidle2' });
	await ready(plain);
	// Visit every slide and every fragment.
	await plain.evaluate(async () => {
		Reveal.slide(0, 0);
		for (let i = 0; i < 60 && !Reveal.isLastSlide(); i++) { Reveal.next(); await new Promise(r => setTimeout(r, 50)); }
	});
	await sleep(1500);
	const plainView = await plain.evaluate(() => ({
		io: typeof io !== 'undefined',
		drawn: [...document.querySelectorAll('.poll, .poll-results, .qa-board')].filter(e => e.childNodes.length).length,
		pill: !!document.querySelector('.poll-pill, .reaction-float'),
		overlayStep: !!document.querySelector('.poll-results.overlay.fragment'),
		stylesheet: !!document.querySelector('link[href*="presenter-polls"]')
	}));
	check(!plainRequests.some(u => u.startsWith(relayUrl)) && !plainView.io, 'the deck without ?master never contacts the relay',
		plainRequests.filter(u => u.startsWith(relayUrl)).length + ' requests');
	check(!plainRequests.some(u => /presenter-polls|d3-cloud|webawesome/.test(u)) && !plainView.stylesheet,
		'it loads neither the poll module, its stylesheet, nor d3-cloud', plainRequests.filter(u => /presenter-polls|d3-cloud|webawesome/.test(u)));
	check(plainView.drawn === 0 && !plainView.pill && !plainView.overlayStep, 'it draws nothing: polls, charts and the board stay empty, no pill, no extra step', plainView);

	// ---- The laptop, the tablet and three phones.
	console.log('\n--- the laptop, the tablet and three phones');
	const laptop = errorsOf(await browser.newPage());
	await laptop.setViewport({ width: 1280, height: 800 });
	await laptop.goto(SITE + DECK + '?master=' + secret, { waitUntil: 'networkidle2' });
	await ready(laptop);
	check(await until(laptop, () => document.querySelector('.reveal .poll-pill') && /^\d{4}$/.test(document.querySelector('.question-code').textContent)),
		'the laptop loads the poll module and shows the day’s code');
	const code = await laptop.evaluate(() => document.querySelector('.question-code').textContent);

	const tablet = errorsOf(await browser.newPage());
	await tablet.setViewport({ width: 1180, height: 820 });
	await tablet.goto(SITE + '/client/presenter.html', { waitUntil: 'domcontentloaded' });
	await clickIn(tablet, '#start-button');
	await tablet.waitForSelector('#q-keyform:not([hidden])', { timeout: 15000 });
	await tablet.$eval('#q-key', (e, key) => { e.value = key; }, questionsKey);
	await clickIn(tablet, '#q-keyform button');
	check(await until(tablet, () => document.getElementById('q-status').textContent.startsWith('Questions on')), 'the tablet listens with the key');

	const phones = [];
	for (let k = 0; k < 3; k++) {
		const context = await browser.createBrowserContext();
		const phone = errorsOf(await context.newPage());
		await phone.setViewport({ width: 390, height: 760 });
		await phone.goto(SITE + '/client/ask.html?code=' + code, { waitUntil: 'domcontentloaded' });
		phones.push(phone);
	}
	// Joined: the reactions and "Lost?" bar appears only with the relay's reply to audience-join.
	const joined = await Promise.all(phones.map(p => until(p, () => !document.getElementById('live').hidden, undefined, 20000)));
	const bar = await phones[0].evaluate(() => ({
		reactions: [...document.querySelectorAll('#reactions button')].map(b => b.textContent),
		pace: !document.getElementById('pace').hidden,
		codeField: document.getElementById('code-field').hidden
	}));
	check(joined.every(Boolean) && J(bar.reactions) === J(REACTIONS) && bar.pace && bar.codeField,
		'the phones join with the code from the link (its field hidden), and offer the deck’s reactions and “Lost?”', bar);

	// Helpers.
	const goTo = async (id, steps = 0) => {
		await laptop.bringToFront();
		await laptop.evaluate((id, steps) => {
			const i = Reveal.getIndices(document.getElementById(id));
			Reveal.slide(i.h, i.v, -1);		// the slide with none of its fragments shown, then steps clicks
			for (let k = 0; k < steps; k++) Reveal.next();
		}, id, steps);
	};
	const pollOnPhones = prompt => Promise.all(phones.map(p => until(p, prompt =>
		!document.getElementById('poll').hidden && document.getElementById('poll-prompt').textContent === prompt, prompt)));
	const tap = async (phone, selector) => { await phone.bringToFront(); await clickIn(phone, selector); };
	const pollStatus = phone => phone.$eval('#poll-status', e => e.textContent);
	const answeredAll = () => Promise.all(phones.map(p => until(p, () => document.getElementById('poll-status').textContent.startsWith('Thanks'))));
	const shot = async (page, name) => {
		if (!process.env.SCREENSHOTS) return;
		await page.bringToFront();
		await sleep(800);
		await page.screenshot({ path: path.join(process.env.SCREENSHOTS, name + '.png') });
	};

	// ---- A choice poll, with an overlay chart.
	console.log('\n--- a choice poll, with an overlay');
	await goTo('poll-choice');
	const choiceShown = await pollOnPhones('Tea or coffee?');
	const phoneView = await phones[0].evaluate(() => ({
		title: document.getElementById('heading').textContent,
		options: [...document.querySelectorAll('#poll-options button')].map(b => b.textContent),
		form: document.getElementById('form').hidden
	}));
	check(choiceShown.every(Boolean) && phoneView.title === 'Live poll' && J(phoneView.options) === J(['Tea', 'Coffee', 'Neither']) && phoneView.form,
		'opening the slide puts the poll on every phone, in place of the question form', phoneView);
	await tap(phones[0], '#poll-options button[data-value="0"]');
	await tap(phones[1], '#poll-options button[data-value="1"]');
	await tap(phones[2], '#poll-options button[data-value="1"]');
	check((await answeredAll()).every(Boolean), 'each phone is thanked for its answer', await pollStatus(phones[0]));
	check(await until(laptop, () => /3 answers$/.test(document.querySelector('.poll-pill').textContent) && !document.querySelector('.poll-pill').hidden),
		'the pill on the laptop counts the answers', await laptop.$eval('.poll-pill', e => e.textContent));
	check(await until(tablet, () => document.getElementById('p-detail').textContent === 'Tea 1 · Coffee 2 · Neither 0'),
		'the tablet shows the poll’s count', await tablet.$eval('#p-panel', e => e.innerText.replace(/\s+/g, ' ')));
	// Two clicks: the slide's own fragment, then the overlay, a step only on the laptop.
	await goTo('poll-choice', 2);
	const overlay = await laptop.evaluate(() => {
		const box = document.querySelector('#poll-choice .poll-results.overlay');
		return { current: box.classList.contains('current-fragment'), counts: [...box.querySelectorAll('.count')].map(e => e.textContent),
			prompt: (box.querySelector('.prompt') || {}).textContent, indexf: Reveal.getState().indexf, pillHidden: document.querySelector('.poll-pill').hidden };
	});
	check(overlay.current && J(overlay.counts) === '["1","2","0"]' && overlay.prompt === 'Tea or coffee?' && overlay.pillHidden,
		'the overlay comes up as a step of its own, with the prompt and the counts, and the pill gives way', overlay);
	// The tablet's copy has no such step: it is sent the position without it.
	const h = await laptop.evaluate(() => Reveal.getIndices(document.getElementById('poll-choice')).h);
	const tabletPosition = () => tablet.evaluate(() => {
		const s = f => { try { const t = document.getElementById(f).contentWindow.Reveal.getState(); return t.indexh + '/' + t.indexf; } catch (e) { return null; } };
		return s('current') + ' next ' + s('upcoming');
	});
	const tabletAt = want => until(tablet, want => {
		try {
			const s = f => { const t = document.getElementById(f).contentWindow.Reveal.getState(); return t.indexh + '/' + t.indexf; };
			return s('current') + ' next ' + s('upcoming') === want;
		} catch (e) { return false; }
	}, want);
	check(overlay.indexf === 1 && await tabletAt(`${h}/0 next ${h}/1`), 'with the overlay up, the tablet shows the line before it, and the line after it as next',
		await tabletPosition());
	await goTo('poll-choice', 3);
	const afterOverlay = await laptop.evaluate(() => ({
		overlay: document.querySelector('#poll-choice .poll-results.overlay').classList.contains('current-fragment'),
		indexf: Reveal.getState().indexf
	}));
	check(!afterOverlay.overlay && afterOverlay.indexf === 2 && await tabletAt(`${h}/1 next ${h + 1}/undefined`),
		'the next click takes the overlay away; the tablet shows the last line', [afterOverlay, await tabletPosition()]);
	await goTo('poll-choice', 2);
	await shot(laptop, 'laptop-choice-overlay');

	// ---- A number poll.
	console.log('\n--- a number poll');
	await goTo('poll-number');
	const numberShown = await pollOnPhones('How many hours did you sleep last night?');
	const numberView = await phones[1].evaluate(() => ({
		buttons: document.querySelectorAll('#poll-options button').length, first: document.querySelector('#poll-options button').textContent,
		lead: document.getElementById('lead').textContent, closed: document.getElementById('poll-status').textContent
	}));
	check(numberShown.every(Boolean) && numberView.buttons === 13 && numberView.first === '0 hrs' && numberView.lead === 'Round to the nearest hour.',
		'a number poll: a button per value, with its unit, and the slide’s instructions', numberView);
	await tap(phones[0], '#poll-options button[data-value="7"]');
	await tap(phones[1], '#poll-options button[data-value="8"]');
	await tap(phones[2], '#poll-options button[data-value="8"]');
	await answeredAll();
	check(await until(laptop, () => (document.querySelector('#poll-number .poll-results .summary') || {}).textContent === '3 answers · median 8 hrs · mean 7.7 hrs'),
		'the laptop’s chart gives the median and mean, with the unit', await laptop.$eval('#poll-number .poll-results', e => e.innerText.replace(/\s+/g, ' ')));
	const columns = await laptop.$$eval('#poll-number .poll-results .count', es => es.map(e => e.textContent).join(','));
	check(columns === ',,,,,,,1,2,,,,', 'a column per value, counted', columns);
	check(await until(tablet, () => document.getElementById('p-detail').textContent === 'median 8 hrs · mean 7.7 hrs'),
		'the tablet shows the median and mean', await tablet.$eval('#p-detail', e => e.textContent));
	await shot(laptop, 'laptop-number');

	// ---- A word cloud, held for the tablet.
	console.log('\n--- a word cloud');
	await goTo('poll-words');
	const wordsShown = await pollOnPhones('One or two words for this talk so far');
	const tagged = await Promise.all(phones.map(p => until(p, () => customElements.get('wa-tag-input') && document.querySelector('#poll-tags'))));
	check(wordsShown.every(Boolean) && tagged.every(Boolean), 'a word cloud: each phone gets a tag input (Web Awesome)');
	const typeWords = async (phone, words) => {
		await phone.bringToFront();
		for (const w of words) {
			const input = await phone.$('wa-tag-input >>> input');
			await input.type(w);
			await phone.keyboard.press('Enter');
			await sleep(1200);			// one answer a second per phone
		}
	};
	await typeWords(phones[0], ['Clear', 'Fun']);
	await typeWords(phones[1], ['clear!']);
	await typeWords(phones[2], ['Long']);
	const waiting = await Promise.all(phones.map(p => until(p, () => /waiting|approved/.test(document.getElementById('poll-status').textContent))));
	check(waiting.every(Boolean), 'the phones are told their words wait for the presenter', await pollStatus(phones[0]));
	check(await until(tablet, () => [...document.querySelectorAll('#w-words button.pending')].length === 3),
		'the tablet gets the words, grouped, as pending', await tablet.$$eval('#w-words button', bs => bs.map(b => b.textContent + ':' + b.className)));
	const beforeApproval = await laptop.evaluate(() => ({
		words: document.querySelectorAll('#poll-words svg text').length,
		empty: (document.querySelector('#poll-words .empty') || {}).textContent
	}));
	check(beforeApproval.words === 0 && /approved/.test(beforeApproval.empty || ''), 'the laptop shows no word before the tablet approves it', beforeApproval);
	await tablet.bringToFront();
	await clickIn(tablet, '#w-all');
	check(await until(laptop, () => document.querySelectorAll('#poll-words svg text').length === 3
		&& document.querySelector('#poll-words .chart').dataset.placed === '3', undefined, 30000),
		'once approved, the words reach the laptop’s cloud, laid out by d3-cloud',
		await laptop.evaluate(() => [...document.querySelectorAll('#poll-words svg text')].map(t => t.firstChild.textContent)));
	const cloudWords = await laptop.evaluate(() => [...document.querySelectorAll('#poll-words svg text')].map(t => t.firstChild.textContent).sort());
	check(J(cloudWords) === J(['Clear', 'Fun', 'Long']), 'the cloud groups words case- and punctuation-blind', cloudWords);
	await shot(laptop, 'laptop-words');

	// ---- A ranking, counted by four voting rules.
	console.log('\n--- a ranking, by voting rule');
	await goTo('poll-ranking');
	await pollOnPhones('Rank these for a group lunch, your favourite first');
	const rank = async (phone, order) => {
		await phone.bringToFront();
		for (const k of order) await clickIn(phone, `.poll-rank button[data-value="${k}"]`);
		await clickIn(phone, '#poll-submit');
	};
	await rank(phones[0], [0, 1, 2, 3]);	// Pizza > Curry > Salad > Sushi
	await rank(phones[1], [1, 0, 3, 2]);	// Curry > Pizza > Sushi > Salad
	await rank(phones[2], [2, 1, 0, 3]);	// Salad > Curry > Pizza > Sushi
	await answeredAll();
	check(await until(laptop, () => /^3 ballots/.test((document.querySelector('#poll-ranking .summary') || {}).textContent)), 'the laptop counts the ballots');
	const rules = await laptop.evaluate(() => {
		const cells = [...document.querySelectorAll('#poll-ranking .rules .winner')].map(e => e.textContent);
		return { plurality: cells[0], borda: cells[1], condorcet: cells[2], runoff: cells[3], summary: document.querySelector('#poll-ranking .summary').textContent };
	});
	check(rules.plurality === 'Pizza = Curry = Salad (tie)' && rules.borda === 'Curry' && rules.condorcet === 'Curry'
		&& rules.runoff === 'Pizza = Curry = Salad (tie)' && rules.summary === '3 ballots · the rules disagree',
		'the rules: plurality and instant runoff tie, Borda and Condorcet pick Curry', rules);
	await shot(laptop, 'laptop-ranking');

	// ---- Before and after.
	console.log('\n--- before and after');
	await goTo('poll-before');
	await pollOnPhones('Should the voting age be lowered to 16?');
	await tap(phones[0], '#poll-options button[data-value="0"]');		// Yes
	await tap(phones[1], '#poll-options button[data-value="1"]');		// No
	await tap(phones[2], '#poll-options button[data-value="2"]');		// Not sure
	await answeredAll();
	await until(laptop, () => /^3 answers/.test((document.querySelector('#poll-before .summary') || {}).textContent));
	await goTo('poll-after');
	// The repeat has the same prompt, under its own id: wait for the new buttons.
	const repeated = await Promise.all(phones.map(p => until(p, () => document.getElementById('poll-status').textContent === ''
		&& !document.querySelector('#poll-options button[aria-pressed="true"]') && document.querySelectorAll('#poll-options button').length === 3)));
	check(repeated.every(Boolean), 'the repeat asks the same question again, unanswered');
	await tap(phones[0], '#poll-options button[data-value="0"]');		// Yes, still
	await tap(phones[1], '#poll-options button[data-value="0"]');		// No → Yes
	await tap(phones[2], '#poll-options button[data-value="1"]');		// Not sure → No
	await answeredAll();
	const compareSummary = () => (document.querySelector('#poll-after .poll-results .summary') || {}).textContent || '';
	check(await until(laptop, s => (document.querySelector('#poll-after .poll-results .summary') || {}).textContent
		=== '3 people answered both · 2 changed their minds: 1 No → Yes, 1 Not sure → No.'),
		'before and after: matched by phone, it counts the changed minds', await laptop.evaluate(compareSummary));
	const bands = await laptop.$$eval('#poll-after .flow svg path', ps => ps.length);
	check(bands === 3, 'the flow has a band for each pair of answers', bands);
	await shot(laptop, 'laptop-before-after');

	// ---- The beauty contest.
	console.log('\n--- the beauty contest');
	await goTo('poll-beauty');
	await pollOnPhones('Guess a whole number from 0 to 100. The guess closest to two-thirds of the average wins.');
	const guess = async (phone, value) => {
		await phone.bringToFront();
		await until(phone, () => !document.getElementById('poll-slider').hidden && customElements.get('wa-slider'));
		await phone.evaluate(v => {
			const slider = document.getElementById('poll-range');
			slider.value = v;
			slider.dispatchEvent(new Event('input', { bubbles: true }));
		}, value);
		await clickIn(phone, '#poll-send');
	};
	await guess(phones[0], 30);
	await guess(phones[1], 40);
	await guess(phones[2], 50);
	await answeredAll();
	await goTo('poll-beauty', 1);		// the results, a fragment
	await until(laptop, () => /^3 answers/.test((document.querySelector('#poll-beauty .summary') || {}).textContent));
	check(await until(laptop, () => [...document.querySelectorAll('#poll-beauty .extra')].some(e => e.textContent
		=== 'The average guess was 40, so the target was 26.7.  Winning guess: 30 (1 person).')),
		'the beauty contest: average, target and winner', await laptop.$$eval('#poll-beauty .extra, #poll-beauty .summary', es => es.map(e => e.textContent)));
	const beauty = await laptop.evaluate(() => ({
		marks: [...document.querySelectorAll('#poll-beauty .mark span')].map(e => e.textContent),
		visible: document.querySelector('#poll-beauty .poll-results').classList.contains('visible')
	}));
	check(beauty.visible && ['Average', '⅔ of it', 'L1'].every(m => beauty.marks.includes(m)), 'its chart marks the average, the target and the levels of reasoning', beauty);
	await shot(laptop, 'laptop-beauty');

	// ---- The board.
	console.log('\n--- the board, reactions and “Lost?”');
	await goTo('board-slide');
	const backToQuestions = await Promise.all(phones.map(p => until(p, () => document.getElementById('poll').hidden && !document.getElementById('form').hidden
		&& document.getElementById('heading').textContent === 'Ask a question')));
	check(backToQuestions.every(Boolean), 'leaving the poll slides closes the poll: the phones show the question form again');
	await phones[0].bringToFront();
	await phones[0].type('#text', 'Is the beauty contest rigged?');
	await until(phones[0], () => !document.getElementById('send').disabled);
	await clickIn(phones[0], '#send');
	check(await until(tablet, () => [...document.querySelectorAll('#q-list li p')].some(p => p.textContent === 'Is the beauty contest rigged?')), 'a question reaches the tablet');
	await tablet.bringToFront();
	await clickIn(tablet, '#q-list li .share');
	check(await until(tablet, () => document.querySelector('#q-list li .share').textContent === 'Shared' && !document.getElementById('b-panel').hidden),
		'the tablet shares it with the room');
	const onBoard = await Promise.all(phones.map(p => until(p, () => [...document.querySelectorAll('#board-list li .text')].some(e => e.textContent === 'Is the beauty contest rigged?'))));
	check(onBoard.every(Boolean), 'it appears on every phone, to vote on');
	await tap(phones[1], '#board-list li button.vote');
	await tap(phones[2], '#board-list li button.vote');
	check(await until(laptop, () => {
		const li = document.querySelector('#board-slide .qa-board li');
		return li && li.querySelector('.votes').textContent === '▲ 2' && li.querySelector('.text').textContent === 'Is the beauty contest rigged?';
	}), 'votes reach the laptop’s board', await laptop.$eval('#board-slide .qa-board', e => e.innerText.replace(/\s+/g, ' ')));
	check(await until(tablet, () => (document.querySelector('#b-list .votes') || {}).textContent === '▲ 2'), 'and the tablet’s');
	await tablet.bringToFront();
	await clickIn(tablet, '#b-list li button');
	check(await until(phones[0], () => document.getElementById('board').hidden), '“Answered” on the tablet takes it off the board');

	// ---- Reactions and "Lost?".
	await tap(phones[1], '#reactions button');
	check(await until(laptop, () => [...document.querySelectorAll('.reveal .reaction-float')].some(e => e.textContent === '👍'), undefined, 3500),
		'a reaction floats up the laptop’s screen');
	check(await until(tablet, () => document.getElementById('reacts').textContent === '👍 1'), 'and is tallied on the tablet', await tablet.$eval('#reacts', e => e.textContent));
	await tap(phones[2], '#pace');
	check(await until(tablet, () => document.getElementById('pace-badge').textContent === 'Lost: 1 of 3' && !document.getElementById('pace-badge').hidden),
		'“Lost?” reaches the tablet alone, as a count', await tablet.$eval('#pace-badge', e => e.textContent));
	check(await until(phones[2], () => document.getElementById('pace').getAttribute('aria-pressed') === 'true'), 'the phone shows it was told');
	if (process.env.SCREENSHOTS) {
		await shot(tablet, 'tablet');
		await goTo('poll-number');
		await pollOnPhones('How many hours did you sleep last night?');
		await shot(phones[0], 'phone-number');
	}

	// ---- No errors anywhere, and the plain deck still untouched.
	console.log('\n--- afterwards');
	check(laptop.errors.length === 0, 'no errors on the laptop page', laptop.errors.join('; '));
	check(tablet.errors.length === 0, 'no errors on the tablet page', tablet.errors.join('; '));
	const phoneErrors = phones.flatMap(p => p.errors);
	check(phoneErrors.length === 0, 'no errors on the phones', phoneErrors.join('; '));
	const plainAfter = await plain.evaluate(() => [...document.querySelectorAll('.poll, .poll-results, .qa-board')].filter(e => e.childNodes.length).length);
	check(plainAfter === 0 && !plainRequests.some(u => u.startsWith(relayUrl)) && plain.errors.length === 0,
		'the deck without ?master is still untouched after all that', { drawn: plainAfter, errors: plain.errors });

	await browser.close();
	site.close();
	if (relayProc) relayProc.kill();
	console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll checks passed.');
	process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(2); });
