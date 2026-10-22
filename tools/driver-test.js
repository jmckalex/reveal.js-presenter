// The tablet driving the laptop's deck ('driver'), at the socket level: the
// questions key, the laptop's room (only a connection that proved the secret
// with a position), the operations allowed and their numbers, the laptop's
// answer passed back, its absence, and the limits.  Starts a local relay;
// RELAY_URL tests a running one on a throwaway channel.
//   node tools/driver-test.js
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
    const got = { laptop: [], tablet: [], phone: [], stranger: [] };
    let answer = { ok: true, dropped: 0 }, silent = false;
    laptop.on('driver', (batch, ack) => { got.laptop.push(batch); if (!silent) ack(answer); });
    tablet.on('driver', b => got.tablet.push(b));
    phone.on('driver', b => got.phone.push(b));
    stranger.on('driver', b => got.stranger.push(b));
    const base = { channel, key, from: '0123456789abcdef', at: { h: 3, v: 0, f: -1 } };
    let seq = 0;
    const batch = (ops, extra = {}) => Object.assign({}, base, { seq: ++seq, ops }, extra);

    // Before questions are open on the channel.
    r.closed = await ask(tablet, 'driver', batch([{ type: 'next' }]));
    await ask(laptop, 'questions-open', { socketId: channel, secret, code: '1234', keyHash });
    r.wrongKey = await ask(tablet, 'driver', batch([{ type: 'next' }], { key: 'WRONG' }));
    // Questions open, but the laptop has sent no position: not in the room yet.
    r.noLaptop = await ask(tablet, 'driver', batch([{ type: 'next' }]));
    // A position with the wrong secret joins nothing.
    stranger.emit('multiplex-statechanged', { socketId: channel, secret: 'not-the-secret', state: {} });
    await sleep(200);
    r.noLaptopStill = await ask(tablet, 'driver', batch([{ type: 'next' }]));
    laptop.emit('multiplex-statechanged', { socketId: channel, secret, deck: 'demo', state: { indexh: 3, indexv: 0 } });
    phone.emit('audience-join', { channel, code: '1234', voter: 'v-1' }, () => {});
    await sleep(300);

    // A batch of every kind, with things that must not pass.
    const ops = [
      { type: 'draw', mode: 0, board: 0, color: 2, fromX: 10, fromY: 20.5, toX: 30, toY: 40, evil: '<script>' },
      { type: 'erase', mode: 0, board: 0, x: 15, y: 25 },
      { type: 'clear', mode: 1, board: 0 },
      { type: 'showChalkboard', mode: 0 },
      { type: 'closeChalkboard', mode: 1, board: 0 },
      { type: 'init', storage: [], mode: 0, board: 0 },
      { type: 'draw', mode: 0, board: 0, color: 1, fromX: NaN, fromY: 0, toX: 1, toY: 1 },
      { type: 'draw', mode: 0, board: 0, color: 'x', fromX: 0, fromY: 0, toX: 1, toY: 1 },
      { type: 'draw', mode: 2, board: 0, color: 1, fromX: 0, fromY: 0, toX: 1, toY: 1 },
      { type: 'draw', mode: 0, board: 0, color: 1, fromX: 0, fromY: 0, toX: 1e9, toY: 1 },
      { type: 'scroll', mode: 1, board: 0, y: 1500, evil: 1 },
      { type: 'scroll', mode: 0, board: 0, y: 10 },
      { type: 'scroll', mode: 1, board: 0, y: -5 },
      { type: 'theme', mode: 1, board: 0, theme: 'whiteboard', evil: 1 },
      { type: 'theme', mode: 1, board: 0, theme: '<b>bold</b>' },
      { type: 'grid', mode: 1, board: 0, grid: false, evil: 1 },
      { type: 'grid', mode: 1, board: 0, grid: 'no' },
      { type: 'down', evil: 1 },
      { type: 'overview' },
      { type: 'sideways' },
      { type: 'next' }
    ];
    answer = { ok: true, dropped: 2 };
    r.applied = await ask(tablet, 'driver', batch(ops));
    r.laptopGot = got.laptop.slice(-1)[0];

    answer = { ok: false, reason: 'not-ready' };
    r.notReady = await ask(tablet, 'driver', batch([{ type: 'prev' }]));
    answer = { ok: true };

    r.invalid = [
      await ask(tablet, 'driver', batch([])),
      await ask(tablet, 'driver', batch(Array.from({ length: 401 }, () => ({ type: 'clear', mode: 0 })))),
      await ask(tablet, 'driver', batch([{ type: 'next' }], { at: { h: 'x', v: 0, f: 0 } })),
      await ask(tablet, 'driver', batch([{ type: 'next' }], { from: 'not hex!' })),
      await ask(tablet, 'driver', batch([{ type: 'next' }], { seq: 0 })),
      await ask(tablet, 'driver', batch([{ type: 'init', storage: [] }]))
    ];

    // The laptop stops answering.
    silent = true;
    const t0 = Date.now();
    r.timeout = await ask(tablet, 'driver', batch([{ type: 'next' }]));
    r.timeoutMs = Date.now() - t0;
    silent = false;

    // Too many at once.
    await sleep(1100);
    const many = await Promise.all(Array.from({ length: 60 }, () => ask(tablet, 'driver', batch([{ type: 'clear', mode: 0 }]))));
    r.busy = many.filter(x => x && x.reason === 'busy').length;
    r.manyOk = many.filter(x => x && x.ok).length;

    await sleep(300);
    r.got = { tablet: got.tablet.length, phone: got.phone.length, stranger: got.stranger.length, laptop: got.laptop.length };
    return r;
  }, RELAY, secret, channel, key, keyHash);

  check(out.closed && out.closed.reason === 'closed', 'refused before questions are open', out.closed);
  check(out.wrongKey && out.wrongKey.reason === 'key', 'refused with the wrong key', out.wrongKey);
  check(out.noLaptop && out.noLaptop.reason === 'no-laptop', '"no-laptop" until the laptop has sent a position', out.noLaptop);
  check(out.noLaptopStill && out.noLaptopStill.reason === 'no-laptop', 'a position with the wrong secret joins no room', out.noLaptopStill);
  check(out.applied && out.applied.ok === true && out.applied.dropped === 2, 'the laptop’s answer comes back to the tablet', out.applied);
  const ops = out.laptopGot && out.laptopGot.ops;
  check(Array.isArray(ops) && ops.length === 11, 'the laptop gets only the allowed operations (11 of 21)', ops && ops.map(o => o.type));
  check(ops && JSON.stringify(ops[0]) === JSON.stringify({ type: 'draw', mode: 0, board: 0, color: 2, fromX: 10, fromY: 20.5, toX: 30, toY: 40 }), 'a stroke is rebuilt, without anything added', ops && ops[0]);
  check(ops && ops[3].type === 'showChalkboard' && ops[3].mode === 1 && ops[4].mode === 0, 'opening the chalkboard is mode 1, closing it mode 0', ops && ops.slice(3, 5));
  check(ops && !ops.some(o => o.type === 'init'), 'the plugin’s "init" (replacing every drawing) never passes');
  check(ops && JSON.stringify(ops[5]) === JSON.stringify({ type: 'scroll', mode: 1, board: 0, y: 1500 }),
    'scrolling the chalkboard passes (on the chalkboard, downwards of its top: not the pen’s, nor above it)', ops && ops[5]);
  check(ops && JSON.stringify(ops[6]) === JSON.stringify({ type: 'theme', mode: 1, board: 0, theme: 'whiteboard' }),
    'a chalkboard or whiteboard passes, and nothing else as its theme', ops && ops[6]);
  check(ops && JSON.stringify(ops[7]) === JSON.stringify({ type: 'grid', mode: 1, board: 0, grid: false }),
    'the grid shown or hidden passes (yes or no, and nothing else)', ops && ops[7]);
  check(ops && JSON.stringify(ops[8]) === JSON.stringify({ type: 'down' }) && ops[9].type === 'overview' && ops[10].type === 'next',
    'steps pass, the four directions and the overview among them, and nothing made up', ops && ops.slice(8));
  check(out.laptopGot && out.laptopGot.from === '0123456789abcdef' && out.laptopGot.seq > 0 && out.laptopGot.at.h === 3 && !('key' in out.laptopGot) && !('channel' in out.laptopGot),
    'the laptop gets the page id, number and step, not the key', out.laptopGot && Object.keys(out.laptopGot));
  check(out.notReady && out.notReady.ok === false && out.notReady.reason === 'not-ready', 'the laptop’s refusal comes back with its reason', out.notReady);
  check(out.invalid.every(x => x && x.reason === 'invalid'), 'malformed batches are refused', out.invalid);
  check(out.timeout && out.timeout.reason === 'timeout' && out.timeoutMs >= 2900 && out.timeoutMs < 5000, '"timeout" when the laptop does not answer, after 3 s', out);
  check(out.busy > 0 && out.manyOk <= 40, 'more than 40 batches a second are refused as "busy"', { busy: out.busy, ok: out.manyOk });
  check(out.got.tablet === 0 && out.got.phone === 0 && out.got.stranger === 0, 'only the laptop receives batches: not the tablet, a phone, or a wrong secret', out.got);

  await browser.close();
  if (relay) relay.kill();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
