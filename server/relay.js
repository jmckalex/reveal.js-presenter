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
 * It also carries audience questions; see the second half of this file.
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
 *  - Anyone may send: 'question' with the channel, the code and the text.
 */
const CODE_TTL_MS = 3 * 3600 * 1000;		// questions close this long after the laptop's last refresh
const MAX_LENGTH = 280;						// characters
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
		if (!text) return ack({ ok: false, reason: 'invalid' });
		if (Date.now() - lastQuestion < PER_SOCKET_MS) return ack({ ok: false, reason: 'slow' });
		const room = 'q:' + data.channel;
		const listeners = io.sockets.adapter.rooms.get(room);
		if (!listeners || !listeners.size) return ack({ ok: false, reason: 'offline' });
		if (!withinLimit('a:' + addressOf(socket), PER_ADDRESS_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		if (!withinLimit('c:' + data.channel, PER_CHANNEL_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		lastQuestion = Date.now();
		io.to(room).emit('question', { id: crypto.randomUUID(), text, at: Date.now() });
		ack({ ok: true });
	});
});

// Forget lapsed channels and old timestamps.
setInterval(() => {
	const now = Date.now();
	for (const [channel, entry] of open) if (entry.expires < now) open.delete(channel);
	for (const [bucket, times] of recent) if (!times.some(t => now - t < 60 * 1000)) recent.delete(bucket);
}, 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => console.log(`reveal.js-presenter relay listening on ${HOST}:${PORT}`));
