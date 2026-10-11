// The relay's later additions at the socket level: the wide number poll,
// self-others, points, grid and pin polls, the tablet's poll counts, the word
// filter, the board (upvoted questions), reactions and the pace signal.
// Starts a local relay; RELAY_URL tests a running one on a throwaway channel.
//   node tools/relay-test.js
const puppeteer = require('puppeteer');
const crypto = require('crypto'), net = require('net'), path = require('path');
const { fork } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
let failures = 0;
const check = (ok, what, detail) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail !== undefined ? '   [' + JSON.stringify(detail) + ']' : ''}`); };
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
  await page.goto(RELAY + '/');		// same origin as the script: newer Chrome blocks about:blank fetching localhost
  await page.addScriptTag({ url: RELAY + '/socket.io/socket.io.js' });
  const out = await page.evaluate(async (RELAY, secret, channel, key, keyHash) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const connect = () => new Promise(r => { const s = io(RELAY, { forceNew: true }); s.on('connect', () => r(s)); });
    const call = (s, e, d) => new Promise(r => s.emit(e, d, r));
    const laptop = await connect(), p1 = await connect(), p2 = await connect(), p3 = await connect(), tablet = await connect(), stranger = await connect();
    const seen = { tally: null, words: null, count: [], board: {}, reactions: { laptop: [], tablet: [], phone: [] }, pace: [], audience: [] };
    laptop.on('poll-tally', t => { seen.tally = t; });
    laptop.on('board', b => { seen.board.laptop = b; });
    laptop.on('reaction', r => seen.reactions.laptop.push(r.emoji));
    tablet.on('poll-words', m => { seen.words = m; });
    tablet.on('poll-count', m => seen.count.push(m));
    tablet.on('board', b => { seen.board.tablet = b; });
    tablet.on('reaction', r => seen.reactions.tablet.push(r.emoji));
    tablet.on('pace', m => seen.pace.push(m));
    p1.on('board', b => { seen.board.phone = b; });
    p1.on('reaction', r => seen.reactions.phone.push(r.emoji));
    p1.on('audience', a => seen.audience.push(a));
    const out = {};
    const CODE = '4321';
    // An older laptop: questions-open without audience or ack.
    laptop.emit('questions-open', { socketId: channel, secret, code: CODE, keyHash });
    await sleep(300);
    out.listen = await call(tablet, 'questions-listen', { channel, key });
    out.join1 = await call(p1, 'audience-join', { channel, code: CODE });
    await call(p2, 'audience-join', { channel, code: CODE }); await call(p3, 'audience-join', { channel, code: CODE });
    out.reactionOff = await call(p1, 'reaction', { channel, code: CODE, emoji: '👍' });
    out.paceOff = await call(p1, 'pace', { channel, code: CODE, voter: 'voter-0001', lost: true });
    // A newer laptop turns reactions and pace on.
    out.openAck = await call(laptop, 'questions-open', { socketId: channel, secret, code: CODE, keyHash, audience: { reactions: ['👍', '😂', '<b>', '👍', 'way too long a reaction'], pace: true } });
    out.badOpen = await call(stranger, 'questions-open', { socketId: channel, secret: 'nope', code: CODE, keyHash });
    await sleep(300);
    const open = poll => call(laptop, 'poll-open', { socketId: channel, secret, poll });
    const answer = (p, id, value, v) => call(p, 'poll-answer', { channel, code: CODE, id, value, voter: 'voter-000' + v });
    // number: wide range, no counts; counts for a narrow one
    out.wide = (await open({ id: 'n-wide', kind: 'number', min: 0, max: 5000, prompt: 'Weight of the ox?' })).ok;
    out.wideAns = [(await answer(p1, 'n-wide', 1198, 1)).ok, (await answer(p2, 'n-wide', 1500, 2)).ok, (await answer(p3, 'n-wide', 5001, 3)).reason];
    await sleep(500); out.wideTally = seen.tally;
    out.tooWide = (await open({ id: 'n-x', kind: 'number', min: 0, max: 2000000 })).reason;
    await sleep(1100);
    // self-others
    out.self = (await open({ id: 'so', kind: 'self-others', prompt: 'Do you read the news daily?', others: 'What share of the room do?' })).ok;
    out.selfAns = [(await answer(p1, 'so', [0, 70], 1)).ok, (await answer(p2, 'so', [1, 40], 2)).ok, (await answer(p3, 'so', [2, 40], 3)).reason, (await answer(p3, 'so', [1, 101], 3)).reason];
    await sleep(500); out.selfTally = seen.tally && seen.tally.answers.map(a => a[1]);
    await sleep(1100);
    // points
    out.points = (await open({ id: 'pts', kind: 'points', options: ['Orwell', 'Huxley', 'Neither'], prompt: 'Credence?' })).ok;
    out.pointsAns = [(await answer(p1, 'pts', [50, 30, 20], 1)).ok, (await answer(p2, 'pts', [50, 30, 10], 2)).reason, (await answer(p3, 'pts', [100, 0, 0], 3)).ok];
    await sleep(1100);
    // grid
    out.grid = (await open({ id: 'g', kind: 'grid', items: ['Television', 'Twitter'], x: ['Slow', 'Fast'], y: ['Shallow', 'Deep'] })).ok;
    out.gridAns = [(await answer(p1, 'g', [[2, 8], [9, 1]], 1)).ok, (await answer(p2, 'g', [[2, 8]], 2)).reason, (await answer(p3, 'g', [[2, 11], [0, 0]], 3)).reason];
    await sleep(1100);
    // pin
    out.pinBad = (await open({ id: 'pin', kind: 'pin', image: 'http://example.org/x.png' })).reason;
    out.pin = (await open({ id: 'pin', kind: 'pin', image: 'https://jmckalex.org/x.webp', alt: 'A map' })).ok;
    out.pinAns = [(await answer(p1, 'pin', [500, 250], 1)).ok, (await answer(p2, 'pin', [1001, 2], 2)).reason];
    await sleep(500); out.pinTally = seen.tally && seen.tally.answers.map(a => a[1]);
    out.countsSeen = seen.count.map(c => `${c.id}:${c.total}:${c.open}`).slice(-3);
    await sleep(1100);
    // choice count on the tablet
    out.choice = (await open({ id: 'ch', kind: 'choice', options: ['Orwell', 'Huxley'], prompt: 'Who?' })).ok;
    await answer(p1, 'ch', 1, 1); await answer(p2, 'ch', 1, 2); await answer(p3, 'ch', 0, 3);
    await sleep(600);
    out.choiceCount = seen.count[seen.count.length - 1];
    laptop.emit('poll-close', { socketId: channel, secret });
    await sleep(400);
    out.closedCount = seen.count[seen.count.length - 1];
    await sleep(1100);
    // the word filter, in an unmoderated cloud
    out.cloud = (await open({ id: 'w', kind: 'words', entries: 3, moderated: false, prompt: 'One word' })).ok;
    out.cloudAns = [await answer(p1, 'w', ['Spectacle', 'sh1t show'], 1), await answer(p2, 'w', ['f u c k', 'push it', 'Scunthorpe'], 2)];
    await sleep(500);
    out.cloudTablet = seen.words && seen.words.words.map(w => `${w.word}:${w.status}${w.caught ? ':caught' : ''}`);
    out.cloudLaptop = seen.tally && seen.tally.words.map(w => w.word);
    await sleep(1100);
    out.noFilter = (await open({ id: 'w2', kind: 'words', moderated: false, filter: false })).ok;
    await answer(p1, 'w2', ['sh1t'], 1); await sleep(500);
    out.noFilterLaptop = seen.tally && seen.tally.words.map(w => w.word);
    // the board
    out.shareStranger = await call(stranger, 'board-share', { channel, key: 'wrong', text: 'Hi' });
    out.share1 = await call(tablet, 'board-share', { channel, key, text: 'Is Postman nostalgic?' });
    out.share2 = await call(tablet, 'board-share', { channel, key, text: 'What would Nguyen say about podcasts?' });
    out.shareAgain = await call(tablet, 'board-share', { channel, key, text: 'Is Postman nostalgic?' });
    await sleep(400);
    out.vote = [await call(p1, 'board-vote', { channel, code: CODE, id: out.share2.id, voter: 'voter-0001', up: true }),
      await call(p2, 'board-vote', { channel, code: CODE, id: out.share2.id, voter: 'voter-0002', up: true }),
      await call(p3, 'board-vote', { channel, code: CODE, id: out.share2.id, voter: 'voter-0002', up: true }),
      await call(p1, 'board-vote', { channel, code: '0000', id: out.share1.id, voter: 'voter-0001', up: true })];
    await sleep(400);
    out.boardPhone = seen.board.phone && seen.board.phone.items.map(i => `${i.text}:${i.votes}`);
    out.boardLaptop = seen.board.laptop && seen.board.laptop.items.length;
    out.boardTablet = seen.board.tablet && seen.board.tablet.items.length;
    out.unvote = await call(p2, 'board-vote', { channel, code: CODE, id: out.share2.id, voter: 'voter-0002', up: false });
    out.remove = await call(tablet, 'board-remove', { channel, key, id: out.share1.id });
    await sleep(400);
    out.boardAfter = seen.board.phone && seen.board.phone.items.map(i => `${i.text}:${i.votes}`);
    out.join2 = await call(p2, 'audience-join', { channel, code: CODE });
    // reactions
    out.reactions = [await call(p1, 'reaction', { channel, code: CODE, emoji: '👍' }), await call(p1, 'reaction', { channel, code: CODE, emoji: '😂' }),
      await call(p2, 'reaction', { channel, code: CODE, emoji: '🤡' }), await call(p2, 'reaction', { channel, code: '9999', emoji: '👍' })];
    await sleep(900);
    out.reactions.push(await call(p1, 'reaction', { channel, code: CODE, emoji: '😂' }));
    await sleep(300);
    out.reactionsSeen = seen.reactions;
    // pace
    out.paceOn = [await call(p1, 'pace', { channel, code: CODE, voter: 'voter-0001', lost: true }), await call(p2, 'pace', { channel, code: CODE, voter: 'voter-0002', lost: true })];
    await sleep(500);
    out.pace1 = seen.pace[seen.pace.length - 1];
    await sleep(700);
    out.paceOff2 = await call(p1, 'pace', { channel, code: CODE, voter: 'voter-0001', lost: false });
    await sleep(500);
    out.pace2 = seen.pace[seen.pace.length - 1];
    out.audienceEvents = seen.audience;
    // The laptop's ack on a re-open carries the board.
    out.reopen = await call(laptop, 'questions-open', { socketId: channel, secret, code: CODE, keyHash, audience: { reactions: ['👍', '😂'], pace: true } });
    await sleep(200);
    out.audienceEventsAfterSame = seen.audience.length;
    return out;
  }, RELAY, secret, channel, key, keyHash);

  check(out.listen.ok && JSON.stringify(out.listen.audience) === '{"reactions":[],"pace":false}', 'an older laptop: questions open, audience options off', out.listen);
  check(out.join1.ok && out.join1.board && Array.isArray(out.join1.board.items) && out.join1.audience && out.join1.audience.pace === false, 'audience-join carries the board and the options', out.join1);
  check(out.reactionOff.reason === 'invalid' && out.paceOff.reason === 'closed', 'reactions and pace refused while off', [out.reactionOff, out.paceOff]);
  check(out.openAck && out.openAck.ok && Array.isArray(out.openAck.board.items), 'questions-open answers an ack with the board', out.openAck);
  check(out.badOpen && out.badOpen.reason === 'secret', 'questions-open refuses a wrong secret', out.badOpen);
  check(JSON.stringify(out.audienceEvents[0]) === JSON.stringify({ reactions: ['👍', '😂'], pace: true }), 'phones are told the options, cleaned (no markup, no duplicates, nothing long)', out.audienceEvents);
  check(out.audienceEventsAfterSame === 1, 'the same options again are not re-sent', out.audienceEventsAfterSame);
  check(out.wide && out.wideAns[0] && out.wideAns[1] && out.wideAns[2] === 'invalid', 'a number poll up to 5000: answers inside, one outside refused', out.wideAns);
  check(out.wideTally && !out.wideTally.counts && out.wideTally.answers.map(a => a[1]).sort().join() === '1198,1500', 'a wide number poll sends answers, not counts', out.wideTally);
  check(out.tooWide === 'invalid', 'a range over a million is refused', out.tooWide);
  check(out.self && out.selfAns.join() === 'true,true,invalid,invalid', 'self-others: [option, percentage], each checked', out.selfAns);
  check(JSON.stringify(out.selfTally) === '[[0,70],[1,40]]', 'self-others: the answers reach the laptop', out.selfTally);
  check(out.points && out.pointsAns.join() === 'true,invalid,true', 'points: must add up to the total', out.pointsAns);
  check(out.grid && out.gridAns.join() === 'true,invalid,invalid', 'grid: a point per item, inside the axes', out.gridAns);
  check(out.pinBad === 'invalid' && out.pin && out.pinAns.join() === 'true,invalid', 'pin: https images only; points from 0 to 1000', [out.pinBad, out.pinAns]);
  check(JSON.stringify(out.pinTally) === '[[500,250]]', 'pin: the point reaches the laptop', out.pinTally);
  check(out.choice && out.choiceCount && out.choiceCount.id === 'ch' && out.choiceCount.counts.join() === '1,2' && out.choiceCount.total === 3 && out.choiceCount.open === true, 'the tablet hears a choice poll’s counts', out.choiceCount);
  check(out.closedCount && out.closedCount.id === 'ch' && out.closedCount.open === false, 'and that it has closed', out.closedCount);
  check(out.cloud && out.cloudAns[0].ok && out.cloudAns[0].held === 1 && out.cloudAns[1].held === 1, 'filter: a phone is told how many of its words wait', out.cloudAns);
  check(JSON.stringify((out.cloudTablet || []).sort()) === JSON.stringify(['Scunthorpe:shown', 'Spectacle:shown', 'f u c k:pending:caught', 'push it:shown', 'sh1t show:pending:caught']), 'filter: caught words wait on the tablet, flagged; the rest are shown', out.cloudTablet);
  check(JSON.stringify((out.cloudLaptop || []).sort()) === JSON.stringify(['Scunthorpe', 'Spectacle', 'push it']), 'filter: the laptop gets only the shown words', out.cloudLaptop);
  check(out.noFilter && JSON.stringify(out.noFilterLaptop) === '["sh1t"]', 'filter: false shows everything', out.noFilterLaptop);
  check(out.shareStranger.reason === 'key' && out.share1.ok && out.share2.ok && out.shareAgain.id === out.share1.id, 'board: only the tablet shares; sharing twice gives the same item', [out.shareStranger, out.shareAgain.id === out.share1.id]);
  check(out.vote.map(v => v.ok ? v.votes : v.reason).join() === '1,2,2,code', 'board: one vote per phone; a wrong code refused', out.vote);
  check(JSON.stringify(out.boardPhone) === JSON.stringify(['What would Nguyen say about podcasts?:2', 'Is Postman nostalgic?:0']) && out.boardLaptop === 2 && out.boardTablet === 2, 'board: phones, laptop and tablet see it, most votes first', out.boardPhone);
  check(out.unvote.ok && out.unvote.votes === 1 && out.remove.ok && JSON.stringify(out.boardAfter) === JSON.stringify(['What would Nguyen say about podcasts?:1']), 'board: votes taken back; questions taken down', out.boardAfter);
  check(out.join2.board.items.length === 1, 'a phone joining late gets the board', out.join2.board);
  check(out.reactions.map(r => r.ok || r.reason).join() === 'true,slow,invalid,code,true', 'reactions: from the deck’s set, one a moment per phone, with the code', out.reactions);
  check(out.reactionsSeen.laptop.join() === '👍,😂' && out.reactionsSeen.tablet.join() === '👍,😂' && out.reactionsSeen.phone.length === 0, 'reactions reach the laptop and the tablet, not other phones', out.reactionsSeen);
  check(out.paceOn.every(p => p.ok) && out.pace1 && out.pace1.lost === 2 && out.pace1.audience === 3, 'pace: the tablet hears 2 lost out of 3', out.pace1);
  check(out.paceOff2.ok && out.pace2 && out.pace2.lost === 1, 'pace: and 1 when one takes it back', out.pace2);
  check(out.reopen.ok && out.reopen.board.items.length === 1, 'questions-open’s ack carries the board', out.reopen.board);
  await browser.close();
  if (relay) relay.kill();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})();
