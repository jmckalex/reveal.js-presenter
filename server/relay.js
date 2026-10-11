'use strict';
/*
 * reveal.js-presenter — the relay.
 *
 * Wire-compatible with reveal/multiplex: a master emits 'multiplex-statechanged'
 * with { socketId, secret, ... }, and if sha256(secret) === socketId the message,
 * minus the secret, is re-emitted to every other connection under the event
 * name socketId.  So decks and presenter pages work against either server.
 *
 * Two deliberate differences from reveal/multiplex's index.js:
 *
 *  - It serves nothing but Socket.IO (including /socket.io/socket.io.js, which
 *    both sides load).  The original also serves its working directory as
 *    static files, which publishes anything kept there: a secrets file, .git/.
 *
 *  - It keeps the last message per channel and replays it to a connection that
 *    emits 'presenter-hello' with the channel id, so a presenter view that
 *    wakes up or reconnects catches up at once instead of at the laptop's next
 *    heartbeat.
 *
 * It also carries audience questions and polls; see the rest of this file.
 *
 * Environment: PORT (default 1948), HOST (default 127.0.0.1, i.e. behind a
 * reverse proxy), ALLOWED_ORIGINS (comma-separated; default: any origin, which
 * is safe because only a holder of the secret can broadcast).
 */
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 1948;
const HOST = process.env.HOST || '127.0.0.1';
const ORIGINS = process.env.ALLOWED_ORIGINS
	? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
	: true;
const MAX_CHANNELS = 1000;

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
const latest = new Map();	// channel id -> last message; insertion order drives eviction

const server = http.createServer((req, res) => {
	const ok = req.url === '/';
	res.writeHead(ok ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end(ok ? 'reveal.js-presenter relay\n' : 'Not found\n');
});

const io = new Server(server, {
	cors: { origin: ORIGINS },
	allowEIO3: true,		// Socket.IO 2 clients, as loaded by older reveal/multiplex setups
	maxHttpBufferSize: 64 * 1024
});

/*
 * Audience questions.
 *
 * Nothing about a question is stored or logged: it is handed to the presenter's
 * open connections and forgotten.  If none is open, it is refused, and the sender
 * is told so.  All the relay keeps, in memory only, is each channel's slide code
 * and the key it accepts, plus the timestamps the rate limits need.
 *
 *  - The laptop deck opens questions for its channel: 'questions-open' with the
 *    presenter secret (proving it owns the channel), the day's 4-digit code
 *    shown on a slide, and sha256 of the key the presenter's tablet will use.
 *  - The tablet listens: 'questions-listen' with the channel and that key.
 *  - Anyone may send: 'question' with the channel, the code and the text, and
 *    optionally a name to show with it (unchecked: whatever the sender typed).
 */
const CODE_TTL_MS = 3 * 3600 * 1000;		// questions close this long after the laptop's last refresh
const MAX_LENGTH = 280;						// characters
const MAX_NAME_LENGTH = 40;					// characters
const PER_SOCKET_MS = 10 * 1000;			// one question per page per 10 s
const PER_CHANNEL_PER_MIN = 20;				// caps a flood from many pages at once
const PER_ADDRESS_PER_MIN = 60;				// generous: a lecture hall may share a few public addresses

const open = new Map();		// channel id -> { code, keyHash, expires }
const recent = new Map();	// 'c:' + channel or 'a:' + address -> times of recent questions

function withinLimit(bucket, limit) {
	const now = Date.now();
	const times = (recent.get(bucket) || []).filter(t => now - t < 60 * 1000);
	if (times.length >= limit) { recent.set(bucket, times); return false; }
	times.push(now);
	recent.set(bucket, times);
	return true;
}

// Behind nginx every connection comes from 127.0.0.1, so trust its X-Real-IP;
// the relay listens on localhost only, so nothing else can set the header.
const addressOf = socket => socket.handshake.headers['x-real-ip'] || socket.handshake.address;

function clean(text) {
	if (typeof text !== 'string') return '';
	const chars = [...text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim()];
	return chars.length > MAX_LENGTH ? '' : chars.join('');
}

// A name is one line.  null if it is too long; '' if there is none.
function cleanName(name) {
	if (typeof name !== 'string') return '';
	const chars = [...name.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()];
	return chars.length > MAX_NAME_LENGTH ? null : chars.join('');
}

/*
 * Polls.
 *
 * The laptop deck opens a poll when its slide (or fragment) is shown:
 * 'poll-open' with the presenter secret and the poll's definition.  It closes
 * it, 'poll-close', when the slide is left.  Phones on the ask page join the
 * channel's audience with the day's code ('audience-join', the same code the
 * questions use, so questions must be open), and are sent each poll as it opens
 * and null as it closes ('poll').  An answer ('poll-answer') is checked against
 * the open poll's kind and kept, one per phone, replacing any earlier one.
 *
 * Kinds, and the answer each takes:
 *   choice    an option's index; with picks > 1, a list of up to picks indices
 *   number    an integer from min to max
 *   scale     a list: for each statement, an integer from min to max
 *   premises  a list: for each statement, 1 (accepted) or 0 (rejected)
 *   ranking   a list: every option's index, first choice first
 *   words     a list of up to entries short texts (an empty list withdraws)
 *
 * Unlike questions, polls keep something: each phone's current answer, in
 * memory, under a random id the phone made up, so that it can change its
 * answer but not answer twice, and so that a laptop that reloads gets the
 * results back.  The laptop ('poll-tally', 'poll-results', for connections
 * that proved the secret) is sent counts for choice and number polls, and,
 * for every kind but words, each answer under an alias: the same for a phone
 * across the channel's polls, so that answers can be compared, but not its id.
 * A word cloud's words are free text, so they go first to the tablet that
 * holds the questions key ('poll-words'), which shows or hides each
 * ('poll-moderate'); the laptop is sent only the shown words and their counts.
 * A poll can opt out of that (moderated: false), when every word is shown.
 * Nothing is written anywhere or logged, and a poll is forgotten POLL_TTL_MS
 * after it was last opened.
 */
const POLL_TTL_MS = 3 * 3600 * 1000;
const MAX_POLLS = 50;						// per channel; the oldest go first
const MAX_OPTIONS = 12;						// in a choice poll
const MAX_RANKED = 10;						// options in a ranking poll
const MAX_STATEMENTS = 12;					// in a scale or premises poll
const MAX_SCALE_RANGE = 10;					// max - min of a scale
const MAX_NUMBER_RANGE = 1000;				// max - min of a number poll
const MAX_ENTRIES = 5;						// words per phone in a word cloud
const MAX_WORD_LENGTH = 30;					// characters
const MAX_WORDS = 500;						// different words in one word cloud
const MAX_VOTERS = 10000;					// per poll
const PER_SOCKET_ANSWER_MS = 1000;			// one answer per page per second
const ANSWERS_PER_CHANNEL_PER_MIN = 2000;	// a large hall, all at once
const ANSWERS_PER_ADDRESS_PER_MIN = 1000;	// a hall behind one public address
const TALLY_EVERY_MS = 300;					// at most this often to the laptop, and to the tablet

const polls = new Map();	// channel id -> { current: poll id or null, words: the latest word cloud's id, byId: Map(poll id -> poll) }
const ALIAS_SALT = crypto.randomBytes(16).toString('hex');	// a fresh one each run: aliases can't be traced to phones

const oneLine = (value, max) => typeof value === 'string'
	? [...value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()].slice(0, max).join('') : '';
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// The laptop's definition of a poll, checked and reduced to what the phones are
// sent; null if it is not a valid poll.  A single-pick choice poll, and a
// number poll, are as they were before the other kinds, for older pages.
function pollDefinition(p) {
	if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id)) return null;
	const base = { id: p.id, kind: p.kind, prompt: oneLine(p.prompt, 300), instructions: oneLine(p.instructions, 300) };
	// A list of short texts, each non-empty, or null.
	const texts = (list, min, max, length) => {
		if (!Array.isArray(list) || list.length < min || list.length > max) return null;
		const out = list.map(o => oneLine(o, length));
		return out.every(Boolean) ? out : null;
	};
	switch (p.kind) {
	case 'choice': {
		const options = texts(p.options, 2, MAX_OPTIONS, 80);
		const picks = p.picks ?? 1;
		if (!options || !isInt(picks, 1, options.length)) return null;
		return picks === 1 ? { ...base, options } : { ...base, options, picks };
	}
	case 'number': {
		const { min, max } = p;
		if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > MAX_NUMBER_RANGE) return null;
		return { ...base, min, max, unit: oneLine(p.unit, 20) };
	}
	case 'scale': {
		const statements = texts(p.statements, 1, MAX_STATEMENTS, 200);
		const { min, max } = p;
		if (!statements || !Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > MAX_SCALE_RANGE) return null;
		const ends = Array.isArray(p.labels) && p.labels.length === 2 ? p.labels.map(l => oneLine(l, 40)) : ['', ''];
		return { ...base, statements, min, max, labels: ends };
	}
	case 'premises': {
		const statements = texts(p.statements, 2, MAX_STATEMENTS, 200);
		if (!statements) return null;
		const conclusion = p.conclusion ?? statements.length - 1;
		const labels = p.labels === undefined ? ['Accept', 'Reject'] : texts(p.labels, 2, 2, 20);
		if (!isInt(conclusion, 0, statements.length - 1) || !labels) return null;
		return { ...base, statements, conclusion, labels };
	}
	case 'ranking': {
		const options = texts(p.options, 2, MAX_RANKED, 80);
		return options ? { ...base, options } : null;
	}
	case 'words': {
		const entries = p.entries ?? 1;
		if (!isInt(entries, 1, MAX_ENTRIES)) return null;
		return { ...base, entries, moderated: p.moderated !== false };
	}
	}
	return null;
}

// A word cloud's words are grouped case- and punctuation-blind.
const wordKey = w => w.normalize('NFKC').toLocaleLowerCase('en')
	.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '').replace(/\s+/g, ' ');

// A phone's answer, checked against the poll's kind and put in a standard
// form; undefined if it is not a possible answer.
function answerTo(def, value) {
	const list = n => Array.isArray(value) && value.length === n;
	switch (def.kind) {
	case 'choice': {
		const last = def.options.length - 1;
		if (!def.picks) return isInt(value, 0, last) ? value : undefined;
		if (!Array.isArray(value) || value.length < 1 || value.length > def.picks || !value.every(v => isInt(v, 0, last))) return undefined;
		return new Set(value).size === value.length ? [...value].sort((a, b) => a - b) : undefined;
	}
	case 'number':
		return isInt(value, def.min, def.max) ? value : undefined;
	case 'scale':
		return list(def.statements.length) && value.every(v => isInt(v, def.min, def.max)) ? [...value] : undefined;
	case 'premises':
		return list(def.statements.length) && value.every(v => v === 0 || v === 1) ? [...value] : undefined;
	case 'ranking':
		return list(def.options.length) && value.every(v => isInt(v, 0, def.options.length - 1)) && new Set(value).size === value.length
			? [...value] : undefined;
	case 'words': {
		if (!Array.isArray(value) || value.length > def.entries) return undefined;
		const words = [], keys = new Set();
		for (const v of value) {
			const w = oneLine(v, MAX_WORD_LENGTH + 1);
			if (!w || [...w].length > MAX_WORD_LENGTH || !wordKey(w)) return undefined;
			if (!keys.has(wordKey(w))) { keys.add(wordKey(w)); words.push(w); }
		}
		return words;
	}
	}
	return undefined;
}

const aliasOf = (channel, voter) => sha256(ALIAS_SALT + ':' + channel + ':' + voter).slice(0, 12);

// A word cloud's words, with how many phones gave each, and each one's status:
// 'pending' (waiting for the tablet), 'shown' or 'hidden'.
function wordsOf(poll) {
	const counts = new Map();
	for (const list of poll.answers.values()) for (const w of list) counts.set(wordKey(w), (counts.get(wordKey(w)) || 0) + 1);
	return [...counts].map(([key, n]) => ({ key, word: poll.words.get(key).word, n, status: poll.words.get(key).status }))
		.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

// What the laptop is sent: see the comment above.
function tallyOf(channel, poll) {
	const def = poll.def;
	const tally = { id: def.id, total: poll.answers.size };
	if (def.kind === 'choice' || def.kind === 'number') {
		const counts = new Array(def.kind === 'choice' ? def.options.length : def.max - def.min + 1).fill(0);
		for (const a of poll.answers.values()) {
			if (Array.isArray(a)) a.forEach(k => counts[k]++);
			else counts[def.kind === 'choice' ? a : a - def.min]++;
		}
		tally.counts = counts;
	}
	if (def.kind === 'words') tally.words = wordsOf(poll).filter(w => w.status === 'shown').map(({ word, n }) => ({ word, n }));
	else tally.answers = [...poll.answers].map(([voter, a]) => [aliasOf(channel, voter), a]);
	return tally;
}

// What the tablet is sent of a word cloud.
const wordsMessage = (channel, poll) => ({
	id: poll.def.id, prompt: poll.def.prompt, moderated: poll.def.moderated,
	open: polls.get(channel)?.current === poll.def.id, total: poll.answers.size, words: wordsOf(poll)
});

function authenticated(data) {
	return !!data && typeof data.secret === 'string' && typeof data.socketId === 'string'
		&& !!data.secret && sha256(data.secret) === data.socketId;
}

// Send a poll's tally to the laptop, and a word cloud's words to the tablet,
// each at most every TALLY_EVERY_MS.
function throttled(poll, name, send) {
	if (poll[name + 'Timer']) return;
	const wait = Math.max(0, (poll[name + 'Last'] || 0) + TALLY_EVERY_MS - Date.now());
	poll[name + 'Timer'] = setTimeout(() => {
		poll[name + 'Timer'] = null;
		poll[name + 'Last'] = Date.now();
		send();
	}, wait);
}
const sendTally = (channel, poll) => throttled(poll, 'tally', () => io.to('results:' + channel).emit('poll-tally', tallyOf(channel, poll)));
const sendWords = (channel, poll) => throttled(poll, 'words', () => io.to('q:' + channel).emit('poll-words', wordsMessage(channel, poll)));

io.on('connection', socket => {
	socket.on('multiplex-statechanged', data => {
		if (!data || typeof data.socketId !== 'string' || typeof data.secret !== 'string' || !data.secret) return;
		if (sha256(data.secret) !== data.socketId) return;
		const message = Object.assign({}, data, { secret: null });
		latest.delete(data.socketId);
		latest.set(data.socketId, message);
		if (latest.size > MAX_CHANNELS) latest.delete(latest.keys().next().value);
		socket.broadcast.emit(data.socketId, message);
	});

	socket.on('presenter-hello', channel => {
		if (typeof channel === 'string' && latest.has(channel)) socket.emit(channel, latest.get(channel));
	});

	socket.on('questions-open', data => {
		if (!data || typeof data.secret !== 'string' || typeof data.socketId !== 'string') return;
		if (sha256(data.secret) !== data.socketId) return;
		if (!/^\d{4}$/.test(data.code) || !HEX64.test(data.keyHash)) return;
		const room = 'q:' + data.socketId;
		const previous = open.get(data.socketId);
		if (previous && previous.keyHash !== data.keyHash) io.in(room).socketsLeave(room);	// key changed: re-authenticate
		open.set(data.socketId, { code: data.code, keyHash: data.keyHash, expires: Date.now() + CODE_TTL_MS });
	});

	socket.on('questions-listen', (data, ack) => {
		if (typeof ack !== 'function') return;
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return ack({ ok: false, reason: 'closed' });
		if (typeof data.key !== 'string' || sha256(data.key) !== entry.keyHash) return ack({ ok: false, reason: 'key' });
		socket.join('q:' + data.channel);
		ack({ ok: true, code: entry.code });	// so the presenter can read it out if the slide isn't showing
		const state = polls.get(data.channel);
		const cloud = state && state.words !== null ? state.byId.get(state.words) : null;
		if (cloud) socket.emit('poll-words', wordsMessage(data.channel, cloud));
	});

	let lastQuestion = 0;
	socket.on('question', (data, ack) => {
		if (typeof ack !== 'function') return;
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return ack({ ok: false, reason: 'closed' });
		if (data.code !== entry.code) return ack({ ok: false, reason: 'code' });
		const text = clean(data.text);
		const name = cleanName(data.name);
		if (!text || name === null) return ack({ ok: false, reason: 'invalid' });
		if (Date.now() - lastQuestion < PER_SOCKET_MS) return ack({ ok: false, reason: 'slow' });
		const room = 'q:' + data.channel;
		const listeners = io.sockets.adapter.rooms.get(room);
		if (!listeners || !listeners.size) return ack({ ok: false, reason: 'offline' });
		if (!withinLimit('a:' + addressOf(socket), PER_ADDRESS_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		if (!withinLimit('c:' + data.channel, PER_CHANNEL_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		lastQuestion = Date.now();
		io.to(room).emit('question', { id: crypto.randomUUID(), text, name, at: Date.now() });
		ack({ ok: true });
	});

	// The laptop opens a poll.  Reopening one (back to its slide, or after a
	// reconnect) keeps its answers, unless its definition has changed.
	socket.on('poll-open', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		if (!authenticated(data)) return reply({ ok: false, reason: 'secret' });
		const def = pollDefinition(data.poll);
		if (!def) return reply({ ok: false, reason: 'invalid' });
		const channel = data.socketId;
		if (!polls.has(channel)) polls.set(channel, { current: null, words: null, byId: new Map() });
		const state = polls.get(channel);
		const key = JSON.stringify(def);
		let poll = state.byId.get(def.id);
		if (!poll || poll.key !== key) {
			poll = { def, key, answers: new Map(), words: new Map() };
			state.byId.delete(def.id);
			state.byId.set(def.id, poll);
			if (state.byId.size > MAX_POLLS) state.byId.delete(state.byId.keys().next().value);
		}
		poll.expires = Date.now() + POLL_TTL_MS;
		socket.join('results:' + channel);
		if (state.current !== def.id) {
			state.current = def.id;
			io.to('audience:' + channel).emit('poll', def);
		}
		if (def.kind === 'words') {
			state.words = def.id;
			io.to('q:' + channel).emit('poll-words', wordsMessage(channel, poll));
		}
		reply({ ok: true, tally: tallyOf(channel, poll) });
	});

	socket.on('poll-close', data => {
		if (!authenticated(data)) return;
		const state = polls.get(data.socketId);
		if (!state || state.current === null) return;
		const closed = state.byId.get(state.current);
		state.current = null;
		io.to('audience:' + data.socketId).emit('poll', null);
		if (closed && closed.def.kind === 'words') io.to('q:' + data.socketId).emit('poll-words', wordsMessage(data.socketId, closed));
	});

	// The laptop asks for a poll's tally: results on a later slide, say.  It
	// then also receives that poll's updates.
	socket.on('poll-results', (data, ack) => {
		if (typeof ack !== 'function') return;
		if (!authenticated(data)) return ack({ ok: false, reason: 'secret' });
		socket.join('results:' + data.socketId);
		const poll = polls.get(data.socketId)?.byId.get(data.id);
		ack(poll ? { ok: true, tally: tallyOf(data.socketId, poll) } : { ok: false, reason: 'unknown' });
	});

	// A phone joins the audience with the day's code; the ack carries the poll
	// open now, if any.
	socket.on('audience-join', (data, ack) => {
		if (typeof ack !== 'function') return;
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return ack({ ok: false, reason: 'closed' });
		if (data.code !== entry.code) return ack({ ok: false, reason: 'code' });
		socket.join('audience:' + data.channel);
		const state = polls.get(data.channel);
		const poll = state && state.current !== null ? state.byId.get(state.current) : null;
		ack({ ok: true, poll: poll ? poll.def : null });
	});

	let lastAnswer = 0;
	socket.on('poll-answer', (data, ack) => {
		if (typeof ack !== 'function') return;
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return ack({ ok: false, reason: 'closed' });
		if (data.code !== entry.code) return ack({ ok: false, reason: 'code' });
		const state = polls.get(data.channel);
		const poll = state && typeof data.id === 'string' && state.current === data.id ? state.byId.get(data.id) : null;
		if (!poll) return ack({ ok: false, reason: 'closed' });
		const value = answerTo(poll.def, data.value);
		if (value === undefined) return ack({ ok: false, reason: 'invalid' });
		if (Date.now() - lastAnswer < PER_SOCKET_ANSWER_MS) return ack({ ok: false, reason: 'slow' });
		const voter = typeof data.voter === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(data.voter) ? 'v:' + data.voter : 's:' + socket.id;
		const previous = poll.answers.get(voter);
		if (previous === undefined && poll.answers.size >= MAX_VOTERS) return ack({ ok: false, reason: 'busy' });
		const words = poll.def.kind === 'words';
		if (words && poll.words.size + new Set(value.map(wordKey).filter(k => !poll.words.has(k))).size > MAX_WORDS) return ack({ ok: false, reason: 'busy' });
		if (!withinLimit('pa:' + addressOf(socket), ANSWERS_PER_ADDRESS_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		if (!withinLimit('pc:' + data.channel, ANSWERS_PER_CHANNEL_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		lastAnswer = Date.now();
		if (words) {
			for (const w of value) if (!poll.words.has(wordKey(w))) poll.words.set(wordKey(w), { word: w, status: poll.def.moderated ? 'pending' : 'shown' });
			if (value.length) poll.answers.set(voter, value);
			else poll.answers.delete(voter);
			sendWords(data.channel, poll);
		}
		else poll.answers.set(voter, value);
		sendTally(data.channel, poll);
		ack({ ok: true });
	});

	// The tablet (with the questions key) shows or hides a word cloud's words:
	// one, by its key, or every word still pending (all: true).
	socket.on('poll-moderate', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return reply({ ok: false, reason: 'closed' });
		if (typeof data.key !== 'string' || sha256(data.key) !== entry.keyHash) return reply({ ok: false, reason: 'key' });
		const poll = polls.get(data.channel)?.byId.get(data.id);
		if (!poll || poll.def.kind !== 'words') return reply({ ok: false, reason: 'unknown' });
		if (data.status !== 'shown' && data.status !== 'hidden') return reply({ ok: false, reason: 'invalid' });
		const targets = data.all === true ? [...poll.words.values()].filter(e => e.status === 'pending')
			: typeof data.word === 'string' && poll.words.has(data.word) ? [poll.words.get(data.word)] : null;
		if (!targets) return reply({ ok: false, reason: 'invalid' });
		targets.forEach(e => { e.status = data.status; });
		sendWords(data.channel, poll);
		sendTally(data.channel, poll);
		reply({ ok: true });
	});
});

// Forget lapsed channels, old timestamps and lapsed polls.
setInterval(() => {
	const now = Date.now();
	for (const [channel, entry] of open) if (entry.expires < now) open.delete(channel);
	for (const [bucket, times] of recent) if (!times.some(t => now - t < 60 * 1000)) recent.delete(bucket);
	for (const [channel, state] of polls) {
		for (const [id, poll] of state.byId) {
			if (poll.expires >= now) continue;
			state.byId.delete(id);
			if (state.current === id) { state.current = null; io.to('audience:' + channel).emit('poll', null); }
		}
		if (!state.byId.size) polls.delete(channel);
	}
}, 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => console.log(`reveal.js-presenter relay listening on ${HOST}:${PORT}`));
