// The laptop's ink, to the tablet ('ink', 'ink-slide', 'ink-want'), at the
// socket level: only from the laptop's connections (those that proved the
// secret with a position), only to the questions key's room, each thing drawn
// rebuilt from what the plugin's messages may say, a slide's drawings rebuilt
// event by event, the tablet's asking passed to the laptop only with the key,
// and the limits.  Also what the tablet's copies of the deck need to draw
// the laptop's charts (the tallies, sent to it too, and asked for with the
// key), and its 'question' and 'goto' steps.  Starts a local relay;
// RELAY_URL tests a running one on a throwaway channel.
//   node tools/ink-test.js
const puppeteer = require('puppeteer');
const crypto = require('crypto'), net = require('net'), path = require('path');
const { fork } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let failures = 0;
const check = (ok, what, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail !== undefined ? '   [' + JSON.stringify(detail).slice(0, 400) + ']' : ''}`); };
(async () => {
  let relay = null, RELAY = process.env.RELAY_URL;
  if (!RELAY) {
    const port = await freePort();
    relay = fork(path.join(__dirname, '..', 'server', 'relay.js'), [], { env: { ...process.env, PORT: port, HOST: '127.0.0.1' }, silent: true });
    RELAY = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(RELAY + '/socket.io/?EIO=4&transport=polling')).ok) break; } catch (e) {} await sleep(100); }
  }
  const secret = crypto.randomBytes(16).toString('hex');
  const channel = crypto.createHash('sha256').update(secret).digest('hex');
  const key = 'T-' + crypto.randomBytes(6).toString('hex');
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(RELAY + '/');
  await page.addScriptTag({ url: RELAY + '/socket.io/socket.io.js' });
  const out = await page.evaluate(async (RELAY, secret, channel, key, keyHash) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const connect = () => new Promise(r => { const s = io(RELAY, { forceNew: true, transports: ['websocket'] }); s.on('connect', () => r(s)); });
    const ask = (s, event, data, ms = 8000) => new Promise(r => s.timeout(ms).emit(event, data, (err, res) => r(err ? { error: String(err) } : res)));
    const r = {};
    const laptop = await connect(), tablet = await connect(), phone = await connect(), stranger = await connect();
    const got = {};
    for (const [name, s] of Object.entries({ laptop, tablet, phone, stranger })) {
      got[name] = { ink: [], slide: [], want: [], tally: [] };
      s.on('poll-tally', d => got[name].tally.push(d));
      s.on('ink', d => got[name].ink.push(d));
      s.on('ink-slide', d => got[name].slide.push(d));
      s.on('ink-want', d => got[name].want.push(d));
    }
    const run = '0011223344556677';
    const at = { h: 3, v: 0, f: -1 };
    const line = n => ({ n, type: 'draw', mode: 0, board: 0, color: 1, fromX: 10, fromY: 20, toX: 30, toY: 40 });
    const reset = () => { for (const g of Object.values(got)) { g.ink.length = g.slide.length = g.want.length = 0; } };

    await ask(laptop, 'questions-open', { socketId: channel, secret, code: '1234', keyHash });
    // Not yet the laptop to the relay (no position), and the tablet not yet listening.
    laptop.emit('ink', { socketId: channel, run, at, ops: [line(1)] });
    await sleep(200);
    r.beforePosition = got.tablet.ink.length;
    r.listen = await ask(tablet, 'questions-listen', { channel, key });
    laptop.emit('ink', { socketId: channel, run, at, ops: [line(2)] });
    await sleep(200);
    r.stillBeforePosition = got.tablet.ink.length;
    laptop.emit('multiplex-statechanged', { socketId: channel, secret, deck: 'demo', state: { indexh: 3, indexv: 0 } });
    stranger.emit('multiplex-statechanged', { socketId: channel, secret: 'not-the-secret', state: {} });
    phone.emit('audience-join', { channel, code: '1234', voter: 'v-1' }, () => {});
    await sleep(300);

    // A batch of every kind, with things that must not pass.
    reset();
    const ops = [
      Object.assign(line(3), { evil: '<script>' }),
      { n: 4, type: 'erase', mode: 0, board: 0, x: 15, y: 25, from: '0123456789abcdef' },
      { n: 5, type: 'clear', mode: 1, board: 0, from: 'not hex!' },
      { n: 6, type: 'showChalkboard', mode: 1, board: 0 },
      { n: 7, type: 'scroll', mode: 1, board: 0, y: 1500 },
      { n: 8, type: 'theme', mode: 1, board: 0, theme: 'whiteboard' },
      { n: 9, type: 'grid', mode: 1, board: 0, grid: false },
      { n: 10, type: 'closeChalkboard', mode: 0, board: 0 },
      { n: 11, type: 'resetSlide', mode: 0, board: 0, evil: 1 },
      { n: 12, type: 'init', storage: [], mode: 0, board: 0 },
      { n: 13, type: 'next' },
      { type: 'clear', mode: 0, board: 0 },
      { n: 0, type: 'clear', mode: 0, board: 0 },
      { n: 14, type: 'draw', mode: 0, board: 0, color: 1, fromX: NaN, fromY: 0, toX: 1, toY: 1 },
      { n: 15, type: 'theme', mode: 1, board: 0, theme: '<b>' }
    ];
    laptop.emit('ink', { socketId: channel, run, at, ops, evil: 1 });
    await sleep(300);
    r.batch = got.tablet.ink[0];
    r.others = { laptop: got.laptop.ink.length, phone: got.phone.ink.length, stranger: got.stranger.ink.length };

    // Not from the laptop's connections, or malformed: nothing goes.
    reset();
    stranger.emit('ink', { socketId: channel, run, at, ops: [line(20)] });
    tablet.emit('ink', { socketId: channel, run, at, ops: [line(21)] });
    laptop.emit('ink', { socketId: channel, at, ops: [line(22)] });
    laptop.emit('ink', { socketId: channel, run: 'XYZ', at, ops: [line(23)] });
    laptop.emit('ink', { socketId: channel, run, at: { h: 'x', v: 0, f: 0 }, ops: [line(24)] });
    laptop.emit('ink', { socketId: channel, run, at, ops: [] });
    laptop.emit('ink', { socketId: channel, run, at, ops: Array.from({ length: 201 }, (_, i) => line(30 + i)) });
    laptop.emit('ink', { socketId: channel, run, at, ops: [{ n: 25, type: 'init', storage: [] }] });
    await sleep(300);
    r.refused = got.tablet.ink.length;

    // The tablet asks for the slide's drawings: only with the key, and only the laptop hears.
    reset();
    tablet.emit('ink-want', { channel, key, at, evil: 1 });
    tablet.emit('ink-want', { channel, key: 'WRONG', at });
    stranger.emit('ink-want', { channel, at });
    await sleep(300);
    r.wants = { laptop: got.laptop.want.slice(), tablet: got.tablet.want.length, phone: got.phone.want.length, stranger: got.stranger.want.length };
    reset();
    await sleep(1100);		// a second of its own
    for (let i = 0; i < 12; i++) tablet.emit('ink-want', { channel, key, at });
    await sleep(300);
    r.manyWants = got.laptop.want.length;

    // A slide's drawings, in two parts.
    reset();
    const ev = (i, extra) => Object.assign({ type: 'draw', color: 0, x1: i, y1: 1, x2: i + 1, y2: 2, time: 1000 + i, board: 0 }, extra);
    const part = (p, extra) => Object.assign({ socketId: channel, run, at, n: 15, slide: { h: 3, v: 0 }, part: p, parts: 2, mode: 1, durations: [2000, 3000],
      notes: [ev(p), ev(p + 10, { evil: '<script>' }), { type: 'draw', color: 'x', x1: 0, y1: 0, x2: 1, y2: 1, time: 1 }, { type: 'mystery', time: 1 }],
      board: [{ type: 'scroll', y: 300, time: 1500 }, { type: 'open', time: 1400 }, { type: 'erase', x: 5, y: 6, time: 1600, board: 0 }] }, extra);
    laptop.emit('ink-slide', part(0));
    laptop.emit('ink-slide', part(1));
    await sleep(300);
    r.slide = got.tablet.slide.slice();
    r.slideOthers = { phone: got.phone.slide.length, stranger: got.stranger.slide.length };
    reset();
    stranger.emit('ink-slide', part(0));
    laptop.emit('ink-slide', part(0, { run: undefined }));
    laptop.emit('ink-slide', part(2));
    laptop.emit('ink-slide', part(0, { parts: 501 }));
    laptop.emit('ink-slide', part(0, { slide: { h: 'x', v: 0 } }));
    laptop.emit('ink-slide', part(0, { durations: [1] }));
    laptop.emit('ink-slide', part(0, { notes: Array.from({ length: 401 }, (_, i) => ev(i)), board: [] }));
    await sleep(300);
    r.slideRefused = got.tablet.slide.length;
    reset();
    laptop.emit('ink-slide', part(0, { slide: { h: 3, v: 0, f: 2 }, parts: 1 }));
    await sleep(200);
    r.slideWithStep = got.tablet.slide[0] && got.tablet.slide[0].slide;

    // The tablet's question step reaches the laptop.
    let batch = null;
    laptop.on('driver', (b, ack) => { batch = b; ack({ ok: true, dropped: 0 }); });
    r.question = await ask(tablet, 'driver', { channel, key, from: '0123456789abcdef', seq: 1, at, ops: [{ type: 'question' }] });
    r.questionOps = batch && batch.ops;
    // A slide chosen in the overview, and ones that may not be.
    r.goto = await ask(tablet, 'driver', { channel, key, from: '0123456789abcdef', seq: 2, at, ops: [{ type: 'goto', h: 5, v: 1, evil: 1 }] });
    r.gotoOps = batch && batch.ops;
    await ask(tablet, 'driver', { channel, key, from: '0123456789abcdef', seq: 3, at, ops: [{ type: 'goto', h: -1, v: 0 }, { type: 'goto', h: 2, v: 'x' }, { type: 'goto', h: 1e6, v: 0 }, { type: 'next' }] });
    r.badGotoOps = batch && batch.ops;

    // The tallies: to the laptop and the tablet as answers arrive, and to the
    // tablet when it asks with the key.
    await sleep(1100);
    r.pollOpen = await ask(laptop, 'poll-open', { socketId: channel, secret, poll: { id: 'p1', kind: 'choice', options: ['A', 'B'], prompt: 'Which?' } });
    r.answer = await ask(phone, 'poll-answer', { channel, code: '1234', id: 'p1', value: 1, voter: 'v-1' });
    await sleep(600);
    r.tallies = { laptop: got.laptop.tally.slice(-1)[0], tablet: got.tablet.tally.slice(-1)[0], phone: got.phone.tally.length, stranger: got.stranger.tally.length };
    r.asked = await ask(tablet, 'poll-results', { channel, key, id: 'p1' });
    r.askedWrong = await ask(tablet, 'poll-results', { channel, key: 'WRONG', id: 'p1' });
    r.askedNothing = await ask(stranger, 'poll-results', { channel, id: 'p1' });
    r.askedUnknown = await ask(tablet, 'poll-results', { channel, key, id: 'nope' });
    return r;
  }, RELAY, secret, channel, key, keyHash);

  check(out.beforePosition === 0 && out.listen && out.listen.ok && out.stillBeforePosition === 0,
    'nothing goes before the laptop has proved the secret with a position', out);
  const ops = out.batch && out.batch.ops;
  check(out.batch && out.batch.run === '0011223344556677' && JSON.stringify(out.batch.at) === JSON.stringify({ h: 3, v: 0, f: -1 }) && !('socketId' in out.batch) && !('evil' in out.batch),
    'the tablet gets the laptop page’s id and the slide, and nothing else of the batch', out.batch && Object.keys(out.batch));
  check(Array.isArray(ops) && ops.length === 9 && ops.map(o => o.n).join() === '3,4,5,6,7,8,9,10,11',
    'only the things drawn that may be (9 of 15), numbered', ops && ops.map(o => o.type + o.n));
  check(ops && JSON.stringify(ops[0]) === JSON.stringify({ type: 'draw', mode: 0, board: 0, color: 1, fromX: 10, fromY: 20, toX: 30, toY: 40, n: 3 }),
    'a stroke is rebuilt, without anything added', ops && ops[0]);
  check(ops && ops[1].from === '0123456789abcdef' && !('from' in ops[2]), 'an iPad page’s mark passes (hex), and nothing else as one', ops && ops.slice(1, 3));
  check(ops && JSON.stringify(ops[8]) === JSON.stringify({ type: 'resetSlide', mode: 0, board: 0, n: 11 }), 'the plugin’s reset of a slide passes', ops && ops[8]);
  check(ops && !ops.some(o => o.type === 'init' || o.type === 'next'), 'the plugin’s "init", and steps, never pass');
  check(out.others.laptop === 0 && out.others.phone === 0 && out.others.stranger === 0, 'only the questions key’s room gets it: not a phone, the laptop, or a wrong secret', out.others);
  check(out.refused === 0, 'nothing from another connection, without the page’s id, for a malformed slide, empty, too many, or only "init"', out.refused);
  check(out.wants.laptop.length === 1 && JSON.stringify(out.wants.laptop[0]) === JSON.stringify({ at: { h: 3, v: 0, f: -1 } })
    && out.wants.tablet === 0 && out.wants.phone === 0 && out.wants.stranger === 0,
    'the tablet’s asking reaches the laptop alone, only with the key, as the slide alone', out.wants);
  check(out.manyWants === 5, 'five askings a second at most', out.manyWants);
  const [p0, p1] = out.slide || [];
  check(out.slide.length === 2 && p0.part === 0 && p1.part === 1 && p0.parts === 2 && p0.n === 15 && p0.run === '0011223344556677' && p0.mode === 1
    && JSON.stringify(p0.slide) === JSON.stringify({ h: 3, v: 0 }) && JSON.stringify(p0.durations) === '[2000,3000]' && !('socketId' in p0),
    'a slide’s drawings reach the tablet in their parts', out.slide.map(p => Object.keys(p)));
  check(p0 && p0.notes.length === 2 && JSON.stringify(p0.notes[1]) === JSON.stringify({ type: 'draw', color: 0, x1: 10, y1: 1, x2: 11, y2: 2, time: 1010, board: 0 }),
    'each event rebuilt, without anything added, and those that may not be left out', p0 && p0.notes);
  check(p0 && p0.board.length === 3 && p0.board.map(e => e.type).join() === 'scroll,open,erase', 'the chalkboard’s events too: scrolled, opened, erased', p0 && p0.board);
  check(out.slideOthers.phone === 0 && out.slideOthers.stranger === 0, 'and to no one else', out.slideOthers);
  check(out.slideRefused === 0, 'nothing from another connection, without the page’s id, a part out of range, too many parts, a malformed slide or times, or too many events', out.slideRefused);
  check(JSON.stringify(out.slideWithStep) === JSON.stringify({ h: 3, v: 0, f: 2 }), 'a slide’s step (a plugin keeping drawings by step) passes', out.slideWithStep);
  check(out.question && out.question.ok && JSON.stringify(out.questionOps) === JSON.stringify([{ type: 'question' }]), 'the tablet’s question step reaches the laptop', out.questionOps);
  check(out.goto && out.goto.ok && JSON.stringify(out.gotoOps) === JSON.stringify([{ type: 'goto', h: 5, v: 1 }]), 'a slide chosen in the overview reaches the laptop, rebuilt', out.gotoOps);
  check(JSON.stringify(out.badGotoOps) === JSON.stringify([{ type: 'next' }]), 'and none outside the deck’s indices', out.badGotoOps);
  const t = out.tallies;
  check(out.pollOpen && out.pollOpen.ok && out.answer && out.answer.ok && t.laptop && t.laptop.total === 1 && JSON.stringify(t.tablet) === JSON.stringify(t.laptop),
    'a poll’s tally goes to the tablet too, the same as to the laptop', t);
  check(t.phone === 0 && t.stranger === 0, 'and to no phone, or anyone else', t);
  check(out.asked && out.asked.ok && JSON.stringify(out.asked.tally) === JSON.stringify(t.laptop), 'the tablet may ask for a poll’s tally with the key', out.asked);
  check(out.askedWrong && out.askedWrong.reason === 'key' && out.askedNothing && out.askedNothing.reason === 'secret' && out.askedUnknown && out.askedUnknown.reason === 'unknown',
    'not with a wrong key or none; an unknown poll is unknown', [out.askedWrong, out.askedNothing, out.askedUnknown]);

  await browser.close();
  if (relay) relay.kill();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
