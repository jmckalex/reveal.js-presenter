#!/usr/bin/env node
'use strict';
/*
 * The chalkboard plugin as changed for the presenter (client/vendor/chalkboard:
 * rajgoel's plugin, changed on 2026-10-22; its README says how): writing
 * belongs to a slide, not to each fragment step; the chalkboard scrolls down
 * without end; it can be a whiteboard, with or without its grid; and every
 * chalkboard of a deck can be saved as one PDF.  Drives example/index.html
 * with the mouse and keys, as the laptop's user would, and reads the
 * plugin's canvases.  No relay is needed.
 *
 *   node tools/chalkboard-test.js
 *
 * The deck is given the slide size of the lectures this was written for
 * (1024 x 576), so the distances below are theirs.  The PDF it saves is left
 * in the system's temporary directory as chalkboard-test.pdf.
 *
 * Environment:
 *   PUPPETEER_PATH   where to require puppeteer from, if require('puppeteer') fails
 *
 * reveal.js and Font Awesome come from CDNs, so this needs the internet.
 * Clicks on the board's handle need a headless Chrome that renders frames
 * (see e2e-test.js).
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');

const ROOT = path.resolve(__dirname, '..');
const DECK = '/example/index.html';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const WIDTH = 1024, HEIGHT = 576;		// the slide's size, in the deck's own units

const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(resolve => {
	const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const failures = [];
function check(ok, name, detail) {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   [' + JSON.stringify(detail).slice(0, 300) + ']' : ''}`);
	if (!ok) failures.push(name);
}

// Open the deck at the lectures' slide size; with perFragment, as a deck that
// asks for the plugin's old behaviour.
async function open(browser, site, perFragment) {
	const page = await browser.newPage();
	await page.setViewport({ width: 1440, height: 900 });
	page.errors = [];
	page.on('pageerror', e => page.errors.push(e.message));
	await page.evaluateOnNewDocument((width, height, perFragment) => {
		let reveal;
		Object.defineProperty(window, 'Reveal', { configurable: true, get: () => reveal, set: value => {
			const initialize = value.initialize;
			value.initialize = config => {
				config = Object.assign({}, config, { width, height });
				if (perFragment) config.chalkboard = Object.assign({}, config.chalkboard, { perFragment: true });
				return initialize.call(value, config);
			};
			reveal = value;
		} });
	}, WIDTH, HEIGHT, !!perFragment);
	await page.goto(site + DECK, { waitUntil: 'load' });
	await page.waitForFunction(() => window.Reveal && Reveal.isReady() && window.RevealChalkboard && RevealChalkboard.exportPDF, { polling: 300, timeout: 30000 });
	await sleep(300);
	return page;
}

const stroke = async (page, x1, y1, x2, y2) => {
	await page.mouse.move(x1, y1); await page.mouse.down();
	await page.mouse.move(x2, y2, { steps: 15 }); await page.mouse.up();
};
// The ink (alpha) of a canvas around a point on the screen.
const inkAt = (page, id, x, y) => page.evaluate((id, x, y) => {
	const c = document.querySelector(`#${id} canvas`), d = c.getContext('2d').getImageData(x - 3, y - 3, 7, 7).data;
	let ink = 0; for (let i = 3; i < d.length; i += 4) ink = Math.max(ink, d[i]); return ink;
}, id, x, y);
// The chalkboard's pixels, read from a copy: Chrome moves a canvas whose own
// pixels are read off the GPU, which smooths edges a shade differently.
const BOARD_PIXELS = `(x, y, w, h) => {
	const board = document.querySelector('#chalkboard canvas'), copy = document.createElement('canvas');
	copy.width = w; copy.height = h;
	const context = copy.getContext('2d', { willReadFrequently: true });
	context.drawImage(board, x, y, w, h, 0, 0, w, h);
	return context.getImageData(0, 0, w, h).data;
}`;
// White chalk around a point on the chalkboard (not its grid, which is dark).
const chalkAt = (page, x, y) => page.evaluate((read, x, y) => {
	const d = eval(read)(x - 3, y - 3, 7, 7);
	let white = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) white = Math.max(white, Math.min(d[i], d[i + 1], d[i + 2])); return white > 200;
}, BOARD_PIXELS, x, y);
const boardPixels = page => page.evaluate(read => Array.from(eval(read)(0, 0, innerWidth, innerHeight)), BOARD_PIXELS);
const differing = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++; return n; };
const redraw = page => page.evaluate(() => window.dispatchEvent(new Event('resize'))).then(() => sleep(300));
const goTo = (page, h, f) => page.evaluate((h, f) => Reveal.slide(h, 0, f), h, f);
// The demo's slide of fragments, and its last step.
const fragments = page => page.evaluate(() => {
	const slide = [...document.querySelectorAll('.slides > section')].find(s => s.querySelectorAll('.fragment').length >= 3);
	return { h: Reveal.getIndices(slide).h, last: slide.querySelectorAll('.fragment').length - 1 };
});
const scale = page => page.evaluate(() => Math.min(innerWidth / Reveal.getConfig().width, innerHeight / Reveal.getConfig().height));

(async () => {
	// Serve the package, with an empty presenter-config.js: the presenter itself
	// stays inert without ?master.
	const sitePort = await freePort();
	const SITE = `http://127.0.0.1:${sitePort}`;
	const site = http.createServer((req, res) => {
		const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (pathname === '/client/presenter-config.js') {
			res.writeHead(200, { 'Content-Type': MIME['.js'] });
			return res.end('window.PresenterConfig = {};');
		}
		const file = path.join(ROOT, path.normalize(pathname));
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			return res.end();
		}
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		res.end(fs.readFileSync(file));
	});
	await new Promise(r => site.listen(sitePort, '127.0.0.1', r));

	const browser = await puppeteer.launch();
	const page = await open(browser, SITE);
	const k = await scale(page);
	const yOffset = (900 - HEIGHT * k) / 2, xOffset = (1440 - WIDTH * k) / 2;

	check(await page.evaluate(() => RevealChalkboard.exportPDF({ download: false })) === null, 'nothing to save before anything is drawn');

	// ---- The pen: writing belongs to the slide ------------------------------
	const { h, last } = await fragments(page);
	await goTo(page, h, -1); await sleep(400);
	await page.evaluate(() => RevealChalkboard.toggleNotesCanvas());
	await stroke(page, 300, 640, 600, 640);
	check(await inkAt(page, 'notescanvas', 450, 640) > 0, 'the pen writes on the slide');
	const recorded = await page.evaluate(() => JSON.parse(RevealChalkboard.getData())[0].data.flatMap(d => d.events).find(e => e.type === 'draw'));
	check(Math.abs(recorded.x1 - (300 - xOffset) / k) < 2 && Math.abs(recorded.y1 - (640 - yOffset) / k) < 2,
		'it is recorded in the slide’s units from the start, not the window’s pixels', recorded);
	await page.evaluate(() => Reveal.next()); await sleep(400);
	check(await inkAt(page, 'notescanvas', 450, 640) > 0, 'the writing stays as the slide’s next fragment appears');
	await page.evaluate(() => Reveal.prev()); await sleep(400);
	check(await inkAt(page, 'notescanvas', 450, 640) > 0, 'and as it is hidden again');
	await goTo(page, h + 1, 0); await sleep(400);
	check(await inkAt(page, 'notescanvas', 450, 640) === 0, 'the next slide has none of it');
	await goTo(page, h, last); await sleep(400);
	check(await inkAt(page, 'notescanvas', 450, 640) > 0, 'back on the slide, at another step, the writing is there again');
	await page.evaluate(() => RevealChalkboard.toggleNotesCanvas());

	// ---- The chalkboard scrolls -------------------------------------------
	await goTo(page, 0, 0); await sleep(400);
	await page.evaluate(() => RevealChalkboard.toggleChalkboard()); await sleep(400);
	const first = await boardPixels(page);
	await redraw(page);
	check(differing(first, await boardPixels(page)) === 0, '(the test can compare drawings of the chalkboard pixel for pixel)');
	await stroke(page, 400, 300, 800, 330);
	check(await chalkAt(page, 600, 315), 'the chalkboard writes');
	await page.keyboard.press('ArrowDown'); await sleep(500);
	const quarter = await page.evaluate(() => RevealChalkboard.boardScroll());
	check(quarter === HEIGHT / 4, '↓ scrolls the chalkboard down a quarter of the slide’s height', quarter);
	const moved = Math.round(quarter * k);
	check(await chalkAt(page, 600, 315 - moved) && !await chalkAt(page, 600, 315), 'what is written moves up with it', moved);
	check(await page.evaluate(() => Reveal.getIndices().h) === 0, '↓ moves the chalkboard, not the presentation');
	await page.mouse.move(1000, 600);
	await page.mouse.wheel({ deltaY: 400 }); await sleep(300);
	const wheeled = await page.evaluate(() => RevealChalkboard.boardScroll());
	check(wheeled > quarter, 'a trackpad or mouse wheel scrolls it too', wheeled);
	await stroke(page, 400, 500, 800, 520);
	const lower = await page.evaluate(() => JSON.parse(RevealChalkboard.getData())[1].data.flatMap(d => d.events).filter(e => e.type === 'draw').pop());
	check(Math.abs(lower.y2 - ((520 - yOffset) / k + wheeled)) < 2, 'writing further down is recorded further down the board', { y: lower.y2, scrolled: wheeled });
	await page.click('#scrollboarddown'); await sleep(500);
	check(await page.evaluate(() => RevealChalkboard.boardScroll()) === wheeled + HEIGHT / 2, 'the handle’s ↓ scrolls half a screen');
	await stroke(page, 300, 700, 900, 760);
	await page.click('#scrollboardup'); await sleep(500);
	check(await page.evaluate(() => RevealChalkboard.boardScroll()) === wheeled, 'and its ↑ back');
	await sleep(200);
	const scrolled = await boardPixels(page);
	await redraw(page);
	// (A stroke drawn lower on the screen can differ in a pixel or two at its
	// edge, rounding differently; a seam would be a row of them.)
	const differ = differing(scrolled, await boardPixels(page));
	check(differ <= 20, 'a board scrolled bit by bit is the board drawn afresh (the chalk’s grain, the grid, every stroke)', { pixelsDiffering: differ });

	await goTo(page, 1, 0); await sleep(400);
	check(await page.evaluate(() => getComputedStyle(document.getElementById('chalkboard')).visibility) === 'hidden', 'a new slide closes the chalkboard');
	await goTo(page, 0, 0); await sleep(400);
	await page.evaluate(() => RevealChalkboard.toggleChalkboard()); await sleep(400);
	check(await page.evaluate(() => RevealChalkboard.boardScroll()) === wheeled, 'returning to the slide, the chalkboard opens where it was left');
	check(await chalkAt(page, 600, 510), 'with its writing');

	await page.evaluate(() => RevealChalkboard.clear()); await sleep(200);
	check(await page.evaluate(() => RevealChalkboard.boardScroll()) === 0 && !await chalkAt(page, 600, 510),
		'Clear empties the chalkboard and takes it back to the top');
	// A derivation on the cleared board: lines down two and a half screens.
	for (let line = 0; line < 9; line++) {
		await stroke(page, 300, 250 + line * 60, 700 + (line % 3) * 80, 255 + line * 60);
		if (line % 3 === 2) { await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await sleep(500); }
	}
	await page.evaluate(() => RevealChalkboard.toggleChalkboard());

	// ---- Saving as a PDF ----------------------------------------------------
	const pdf = await page.evaluate(async () => {
		const blob = await RevealChalkboard.exportPDF({ download: false });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
		return s;
	});
	const pages = (pdf.match(/\/Type \/Page /g) || []).length;
	const startxref = +pdf.match(/startxref\n(\d+)/)[1];
	const xref = pdf.slice(startxref).match(/^xref\n0 (\d+)\n([\s\S]*?)trailer/);
	const offsets = xref[2].trim().split('\n').slice(1).map(l => +l.slice(0, 10));
	check(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'), 'the PDF has a PDF’s head and tail');
	check(offsets.every((o, i) => pdf.startsWith(`${i + 1} 0 obj`, o)), 'every object is where the cross-reference table says', offsets.length);
	check((pdf.match(/\/Filter \/DCTDecode/g) || []).length === pages && pdf.includes('\xFF\xD8\xFF'), 'each page is a JPEG picture of the board');
	// The board before Clear: strokes at about 180, 1050 and 1500 (the
	// slide's units, a screen being 576): 3 pages.  After Clear: nine lines
	// down to about 1060: 2 pages.  The pen's writing on the slide of
	// fragments is not a chalkboard.
	check(pages === 5, 'a page for each screenful of each board, the board before Clear kept, the pen’s writing left out', pages);
	fs.writeFileSync(path.join(os.tmpdir(), 'chalkboard-test.pdf'), Buffer.from(pdf, 'latin1'));

	const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'chalkboard-'));
	await (await page.target().createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
	await page.keyboard.press('e');
	let saved = [];
	for (let i = 0; i < 40 && !saved.some(f => f.endsWith('.pdf')); i++) { await sleep(250); saved = fs.readdirSync(downloads); }
	check(saved.some(f => / - chalkboards \d{4}-\d\d-\d\d\.pdf$/.test(f)), 'E saves the PDF as a file, named for the presentation and the day', saved);
	check(page.errors.length === 0, 'no errors in the page', page.errors);

	// ---- The whiteboard: W, or the button on the board's handle -------------
	const darkAt = (x, y) => page.evaluate((read, x, y) => {
		const d = eval(read)(x - 3, y - 3, 7, 7);
		for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.max(d[i], d[i + 1], d[i + 2]) < 140) return true;
		return false;
	}, BOARD_PIXELS, x, y);
	const darkest = (x, y) => page.evaluate((read, x, y) => {
		const d = eval(read)(x - 3, y - 3, 7, 7); let least = 255;
		for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) least = Math.min(least, Math.max(d[i], d[i + 1], d[i + 2]));
		return least;
	}, BOARD_PIXELS, x, y);
	// How much of the board's canvas, in a corner with no writing, is painted
	// (its grid, if shown).
	const painted = () => page.evaluate(read => { const d = eval(read)(1000, 80, 200, 200); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; }, BOARD_PIXELS);
	await goTo(page, 2, 0); await sleep(400);
	await page.evaluate(() => { window.themesSent = []; document.addEventListener('broadcast', e => { if (e.content && e.content.type === 'theme') themesSent.push(e.content.theme); }); });
	await page.evaluate(() => RevealChalkboard.toggleChalkboard()); await sleep(400);
	check(await page.evaluate(() => RevealChalkboard.theme()) === 'chalkboard', 'a chalkboard to begin with (the deck’s own theme)');
	await stroke(page, 400, 450, 800, 450);
	check(await chalkAt(page, 600, 450), 'white chalk on it');
	await page.keyboard.press('w'); await sleep(400);
	const white = await page.evaluate(() => {
		const c = document.getElementById('chalkboard');
		const texture = c.querySelector('.chalkboard-texture');
		return { theme: RevealChalkboard.theme(), texture: getComputedStyle(texture).backgroundImage.slice(0, 40),
			palette: getComputedStyle(c.querySelector('.palette li[data-color="0"]')).color, stored: localStorage.getItem('reveal-chalkboard-theme'), sent: themesSent };
	});
	check(white.theme === 'whiteboard' && /data:image\/png/.test(white.texture), 'W makes it a whiteboard', white);
	const whiteness = await page.evaluate(async () => {		// the texture's one pixel
		const url = getComputedStyle(document.querySelector('.chalkboard-texture')).backgroundImage.slice(5, -2);
		const image = await createImageBitmap(await (await fetch(url)).blob());
		const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(image, 0, 0);
		return Array.from(x.getImageData(0, 0, 1, 1).data).join();
	});
	check(whiteness === '255,255,255,255', 'and it is white, not grey', whiteness);
	const ink = await darkest(600, 450);
	check(ink < 30 && !await chalkAt(page, 600, 450), 'what is written on it is drawn again in board marker: white chalk as black ink, not grey', ink);
	check(white.palette === 'rgb(0, 0, 0)', 'its colours are the board markers’, black first', white.palette);
	check(white.stored === 'whiteboard' && white.sent.join() === 'whiteboard', 'the choice is remembered in the browser, and sent to anyone following', white);
	await stroke(page, 400, 520, 800, 520);
	check(await darkAt(600, 520), 'new writing is in board marker');
	const brightness = await page.evaluate(async () => {
		const bytes = new Uint8Array(await (await RevealChalkboard.exportPDF({ download: false })).arrayBuffer());
		let text = ''; for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
		const m = /\/DCTDecode \/Length (\d+) >>\nstream\n/.exec(text);
		const image = await createImageBitmap(new Blob([bytes.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1]))], { type: 'image/jpeg' }));
		const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
		const x = c.getContext('2d'); x.drawImage(image, 0, 0);
		const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0;
		for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
		return Math.round(sum / (d.length / 4));
	});
	check(brightness > 240, 'a whiteboard saves as white pages', brightness);

	// ---- The grid: R, or the button on the board's handle --------------------
	const withGrid = await painted();
	await page.keyboard.press('r'); await sleep(300);
	const without = await painted();
	check(withGrid > 0 && without === 0 && await page.evaluate(() => !RevealChalkboard.gridShown()), 'R hides the grid', { withGrid, without });
	check(await darkAt(600, 450), 'leaving the writing');
	await page.keyboard.press('r'); await sleep(300);
	check(await painted() === withGrid, 'and R shows it again');
	await page.keyboard.press('r'); await sleep(300);
	check(await page.evaluate(() => localStorage.getItem('reveal-chalkboard-grid')) === 'off', 'hidden, it is remembered as hidden');
	await page.reload({ waitUntil: 'load' });
	await page.waitForFunction(() => window.Reveal && Reveal.isReady() && window.RevealChalkboard, { polling: 300, timeout: 30000 });
	check(await page.evaluate(() => RevealChalkboard.theme()) === 'whiteboard', 'and is a whiteboard still after a reload');
	await page.evaluate(() => RevealChalkboard.toggleChalkboard()); await sleep(400);
	check(await page.evaluate(() => !RevealChalkboard.gridShown()) && await painted() === 0, 'with its grid still hidden');
	await page.click('#toggleboardgrid'); await sleep(300);
	check(await page.evaluate(() => RevealChalkboard.gridShown()) && await painted() > 0, 'the button on its handle shows the grid again');
	await page.click('#toggleboardtheme'); await sleep(300);
	check(await page.evaluate(() => RevealChalkboard.theme() === 'chalkboard' && localStorage.getItem('reveal-chalkboard-theme') === 'chalkboard'),
		'the button on its handle makes it a chalkboard again');
	check(page.errors.length === 0, 'no errors with the whiteboard', page.errors);

	// ---- perFragment: true keeps the plugin's old behaviour -----------------
	const old = await open(browser, SITE, true);
	await goTo(old, h, -1); await sleep(400);
	await old.evaluate(() => RevealChalkboard.toggleNotesCanvas());
	await stroke(old, 300, 640, 600, 640);
	await old.evaluate(() => Reveal.next()); await sleep(400);
	check(await inkAt(old, 'notescanvas', 450, 640) === 0, 'with perFragment: true, the next fragment step has a fresh canvas, as before');
	await old.evaluate(() => Reveal.prev()); await sleep(400);
	check(await inkAt(old, 'notescanvas', 450, 640) > 0, 'and the writing comes back with its step');

	await browser.close();
	site.close();
	console.log(failures.length ? `\n${failures.length} FAILED:\n  ` + failures.join('\n  ') : '\nAll checks passed.');
	process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
