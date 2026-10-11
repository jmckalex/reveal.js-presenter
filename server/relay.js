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
 * the open poll and counted.
 *
 * Unlike questions, polls keep something: the tally, in memory, so that a
 * laptop that reloads gets it back and results can be shown on a later slide.
 * That is anonymous counts, plus each phone's current answer under a random id
 * the phone made up, so that it can change its answer but not answer twice.
 * Nothing is written anywhere or logged, the tally goes only to connections
 * that proved the secret ('poll-tally', 'poll-results'), and a poll is
 * forgotten POLL_TTL_MS after it was last opened.
 */
const POLL_TTL_MS = 3 * 3600 * 1000;
const MAX_POLLS = 50;						// per channel; the oldest go first
const MAX_OPTIONS = 12;
const MAX_NUMBER_RANGE = 1000;				// max - min of a number poll
const MAX_VOTERS = 10000;					// per poll
const PER_SOCKET_ANSWER_MS = 1000;			// one answer per page per second
const ANSWERS_PER_CHANNEL_PER_MIN = 2000;	// a large hall, all at once
const ANSWERS_PER_ADDRESS_PER_MIN = 1000;	// a hall behind one public address
const TALLY_EVERY_MS = 300;					// at most this often to the laptop

const polls = new Map();	// channel id -> { current: poll id or null, byId: Map(poll id -> poll) }

const oneLine = (value, max) => typeof value === 'string'
	? [...value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()].slice(0, max).join('') : '';

// The laptop's definition of a poll, checked and reduced to what the phones are
// sent; null if it is not a valid poll.
function pollDefinition(p) {
	if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id)) return null;
	const prompt = oneLine(p.prompt, 300);
	if (p.kind === 'choice') {
		if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > MAX_OPTIONS) return null;
		const options = p.options.map(o => oneLine(o, 80));
		return options.every(Boolean) ? { id: p.id, kind: 'choice', prompt, options } : null;
	}
	if (p.kind === 'number') {
		const { min, max } = p;
		if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > MAX_NUMBER_RANGE) return null;
		return { id: p.id, kind: 'number', prompt, min, max, unit: oneLine(p.unit, 20) };
	}
	return null;
}

// What the laptop is sent: counts per option, or per value from min to max.
const tallyOf = poll => ({ id: poll.def.id, counts: [...poll.counts], total: poll.answers.size });

function authenticated(data) {
	return !!data && typeof data.secret === 'string' && typeof data.socketId === 'string'
		&& !!data.secret && sha256(data.secret) === data.socketId;
}

// Send a poll's tally to the laptop, at most every TALLY_EVERY_MS.
function sendTally(channel, poll) {
	if (poll.tallyTimer) return;
	const wait = Math.max(0, (poll.lastTally || 0) + TALLY_EVERY_MS - Date.now());
	poll.tallyTimer = setTimeout(() => {
		poll.tallyTimer = null;
		poll.lastTally = Date.now();
		io.to('results:' + channel).emit('poll-tally', tallyOf(poll));
	}, wait);
}

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
	// reconnect) keeps its tally, unless its definition has changed.
	socket.on('poll-open', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		if (!authenticated(data)) return reply({ ok: false, reason: 'secret' });
		const def = pollDefinition(data.poll);
		if (!def) return reply({ ok: false, reason: 'invalid' });
		const channel = data.socketId;
		if (!polls.has(channel)) polls.set(channel, { current: null, byId: new Map() });
		const state = polls.get(channel);
		const key = JSON.stringify(def);
		let poll = state.byId.get(def.id);
		if (!poll || poll.key !== key) {
			const size = def.kind === 'choice' ? def.options.length : def.max - def.min + 1;
			poll = { def, key, counts: new Array(size).fill(0), answers: new Map() };
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
		reply({ ok: true, tally: tallyOf(poll) });
	});

	socket.on('poll-close', data => {
		if (!authenticated(data)) return;
		const state = polls.get(data.socketId);
		if (!state || state.current === null) return;
		state.current = null;
		io.to('audience:' + data.socketId).emit('poll', null);
	});

	// The laptop asks for a poll's tally: results on a later slide, say.  It
	// then also receives that poll's updates.
	socket.on('poll-results', (data, ack) => {
		if (typeof ack !== 'function') return;
		if (!authenticated(data)) return ack({ ok: false, reason: 'secret' });
		socket.join('results:' + data.socketId);
		const poll = polls.get(data.socketId)?.byId.get(data.id);
		ack(poll ? { ok: true, tally: tallyOf(poll) } : { ok: false, reason: 'unknown' });
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
		const index = typeof data.value !== 'number' ? NaN : poll.def.kind === 'choice' ? data.value : data.value - poll.def.min;
		if (!Number.isInteger(index) || index < 0 || index >= poll.counts.length) return ack({ ok: false, reason: 'invalid' });
		if (Date.now() - lastAnswer < PER_SOCKET_ANSWER_MS) return ack({ ok: false, reason: 'slow' });
		const voter = typeof data.voter === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(data.voter) ? 'v:' + data.voter : 's:' + socket.id;
		const previous = poll.answers.get(voter);
		if (previous === undefined && poll.answers.size >= MAX_VOTERS) return ack({ ok: false, reason: 'busy' });
		if (!withinLimit('pa:' + addressOf(socket), ANSWERS_PER_ADDRESS_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		if (!withinLimit('pc:' + data.channel, ANSWERS_PER_CHANNEL_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		lastAnswer = Date.now();
		if (previous !== undefined) poll.counts[previous]--;
		poll.answers.set(voter, index);
		poll.counts[index]++;
		sendTally(data.channel, poll);
		ack({ ok: true });
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
