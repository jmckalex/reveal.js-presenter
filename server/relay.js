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
 * It also carries audience questions and polls, lets the presenter's tablet
 * drive the laptop's deck, and sends the tablet what is drawn on the laptop's;
 * see the rest of this file.
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
 *   choice       an option's index; with picks > 1, a list of up to picks indices
 *   number       an integer from min to max
 *   scale        a list: for each statement, an integer from min to max
 *   premises     a list: for each statement, 1 (accepted) or 0 (rejected)
 *   ranking      a list: every option's index, first choice first
 *   words        a list of up to entries short texts (an empty list withdraws)
 *   self-others  [an option's index, a percentage]: the phone's own answer,
 *                and its guess at the share of the room giving options[target]
 *   points       a list: for each option, the points given it, adding up to total
 *   grid         a list: for each item, [x, y], each an integer from min to max
 *   pin          [x, y], each from 0 to 1000: a point on the image, in
 *                thousandths of its width and height
 *
 * Unlike questions, polls keep something: each phone's current answer, in
 * memory, under a random id the phone made up, so that it can change its
 * answer but not answer twice, and so that a laptop that reloads gets the
 * results back.  The laptop ('poll-tally', 'poll-results', for connections
 * that proved the secret) is sent counts for choice polls, and number polls
 * of up to MAX_COUNTED_RANGE values, and, for every kind but words, each
 * answer under an alias: the same for a phone across the channel's polls, so
 * that answers can be compared, but not its id.  So is the tablet that holds
 * the questions key (the same 'poll-tally', and 'poll-results' with the key),
 * whose copies of the deck draw the laptop's charts too.  A word cloud's words are
 * free text, so they go first to the tablet that holds the questions key
 * ('poll-words'), which shows or hides each ('poll-moderate'); the laptop is
 * sent only the shown words and their counts.  A poll can opt out of that
 * (moderated: false), when every word is shown at once, except those that
 * the word filter catches (unless filter: false), which wait for the tablet
 * as in a moderated poll.  The tablet also hears how many have answered the
 * latest poll ('poll-count').  Nothing is written anywhere or logged, and a
 * poll is forgotten POLL_TTL_MS after it was last opened.
 *
 * A single-pick choice poll may come in versions (2 to MAX_VERSIONS), each
 * with a name, its own prompt and a story to read first: an experiment, in
 * which each phone sees one version and the versions' answers are compared
 * (Knobe's two stories of the chairman, say).  The relay deals the versions
 * out in turn as each phone is first sent the poll (those already joined in
 * the order they joined, then the rest as they join), so that each version
 * is seen by as many phones as the others, give or take one; and it keeps
 * which phone has which, with the poll, so that a reload brings back the
 * same one.  A phone is sent only its own version, without the versions'
 * names.  It answers with an option's index; the relay keeps that as
 * version * options + index, which is what the laptop's counts and aliases
 * carry (its tally also says how many phones were dealt each version), and
 * the tablet's counts are labelled "name: option".
 *
 * Each poll has a round, a random token made when the relay starts keeping
 * it, which goes to the phones with the poll: an answer a phone remembers
 * under another round is one the relay has forgotten (by a restart, its
 * definition changing, POLL_TTL_MS, or a reset).  The tablet may reset the
 * channel ('reset'): its polls, board and pace signal are forgotten, as if
 * the relay had restarted for that channel alone, with questions still open.
 * A poll open at the time opens again empty, in a new round (its versions
 * dealt afresh), and the laptop and the tablet are told ('reset'), to clear
 * their charts and counts.
 */
const POLL_TTL_MS = 3 * 3600 * 1000;
const MAX_POLLS = 50;						// per channel; the oldest go first
const MAX_OPTIONS = 12;						// in a choice poll
const MAX_VERSIONS = 4;						// versions of a choice poll, each phone dealt one
const MAX_STORY_LENGTH = 1200;				// characters in a version's story
const MAX_RANKED = 10;						// options in a ranking poll
const MAX_STATEMENTS = 12;					// in a scale or premises poll
const MAX_SCALE_RANGE = 10;					// max - min of a scale
const MAX_NUMBER_RANGE = 1000000;			// max - min of a number poll (a guess at a quantity can be wide)
const MAX_COUNTED_RANGE = 1000;				// a number poll's counts per value are sent only up to this range
const MAX_SELF_OPTIONS = 6;					// in a self-others poll
const MAX_POINT_OPTIONS = 10;				// in a points poll
const MAX_POINTS = 1000;					// a points poll's total
const MAX_GRID_ITEMS = 8;					// in a grid poll
const MAX_GRID_RANGE = 100;					// max - min of a grid's axes
const PIN_SCALE = 1000;						// a pin's coordinates run from 0 to this
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

/*
 * Driving from the tablet.
 *
 * The tablet may drive the laptop's deck ('driver', with the questions key):
 * strokes for the deck's chalkboard plugin (its pen, on the slide, and its
 * chalkboard, which scrolls) and steps back and forward.  Each batch is
 * rebuilt from what is allowed (driverOp: a list of kinds, their numbers
 * checked) and sent to the laptop's connections alone: those that proved the
 * secret with a position ('master:' + channel).  The tablet is told whether
 * one of them applied it, or why not: 'no-laptop', 'timeout', or the
 * laptop's own reason.  Nothing is kept.
 */
const MAX_DRIVER_OPS = 400;					// operations in one batch
const DRIVER_ACK_MS = 3000;					// the laptop's reply, at most this long
const DRIVER_BATCHES_PER_SECOND = 40;		// per connection
// In the deck's own units (1024 by 576, say): the chalkboard scrolls down
// without end, so its writing may be far below the first screen.
const MAX_DRIVER_COORD = 1000000;

// One operation of a 'driver' batch, as the chalkboard plugin's own messages
// have it, or null if it is not one that may be sent.  The plugin's 'init',
// which would replace every drawing, is not among them.
function driverOp(op) {
	if (!op || typeof op !== 'object') return null;
	const coord = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_DRIVER_COORD;
	const index = v => Number.isInteger(v) && v >= 0 && v <= 99;
	const board = index(op.board) ? op.board : 0;
	switch (op.type) {
	case 'next': case 'prev': case 'left': case 'right': case 'up': case 'down': case 'overview': case 'question': return { type: op.type };
	case 'goto': return Number.isInteger(op.h) && op.h >= 0 && op.h < 100000 && Number.isInteger(op.v) && op.v >= 0 && op.v < 100000
		? { type: 'goto', h: op.h, v: op.v } : null;
	case 'showChalkboard': return { type: 'showChalkboard', mode: 1, board };
	case 'closeChalkboard': return { type: 'closeChalkboard', mode: 0, board };
	}
	const mode = op.mode;
	if (mode !== 0 && mode !== 1) return null;
	switch (op.type) {
	case 'draw': return index(op.color) && [op.fromX, op.fromY, op.toX, op.toY].every(coord)
		? { type: 'draw', mode, board, color: op.color, fromX: op.fromX, fromY: op.fromY, toX: op.toX, toY: op.toY } : null;
	case 'erase': return coord(op.x) && coord(op.y) ? { type: 'erase', mode, board, x: op.x, y: op.y } : null;
	case 'clear': return { type: 'clear', mode, board };
	case 'scroll': return mode === 1 && coord(op.y) && op.y >= 0 ? { type: 'scroll', mode, board, y: op.y } : null;
	case 'theme': return op.theme === 'chalkboard' || op.theme === 'whiteboard' ? { type: 'theme', mode, board, theme: op.theme } : null;
	case 'grid': return typeof op.grid === 'boolean' ? { type: 'grid', mode, board, grid: op.grid } : null;
	}
	return null;
}

/*
 * Ink, from the laptop to the tablet: what is drawn on the laptop's deck, so
 * that the tablet's copy shows what the laptop's screen does.  'ink' is each
 * thing as it is drawn (a batch of the chalkboard plugin's messages, each
 * numbered, as driverOp has them, and its reset of a slide), and 'ink-slide'
 * a slide's drawings so far, in parts, when the tablet asks ('ink-want', with
 * the questions key).  Both carry the laptop page's id (run), since its
 * numbers start again when it reloads.  Only from the laptop's connections
 * (those in 'master:' + channel), and only to the questions key's room.
 * Nothing is kept.
 */
const MAX_INK_OPS = 200;					// things drawn, in a batch
const MAX_INK_PART = 400;					// events, in a part of a slide's drawings
const MAX_INK_PARTS = 500;
const INK_BATCHES_PER_SECOND = 40;			// per connection
const INK_PARTS_PER_SECOND = 200;			// per connection: a slide's parts come at once
const INK_WANTS_PER_SECOND = 5;				// per connection
const INK_KINDS = new Set(['draw', 'erase', 'clear', 'scroll', 'theme', 'grid', 'showChalkboard', 'closeChalkboard', 'resetSlide']);
const inkRun = v => typeof v === 'string' && /^[0-9a-f]{8,32}$/.test(v) ? v : null;
const inkStep = v => Number.isInteger(v) && v >= -1 && v < 100000;
const inkAt = at => at && typeof at === 'object' && inkStep(at.h) && inkStep(at.v) && inkStep(at.f) ? { h: at.h, v: at.v, f: at.f } : null;

// One thing drawn, numbered, and marked as a tablet's page's if it came from one.
function inkOp(op) {
	if (!op || !INK_KINDS.has(op.type) || !Number.isInteger(op.n) || op.n < 1) return null;
	const ink = op.type === 'resetSlide' ? { type: 'resetSlide', mode: op.mode === 1 ? 1 : 0, board: 0 } : driverOp(op);
	if (!ink) return null;
	ink.n = op.n;
	if (inkRun(op.from)) ink.from = op.from;
	return ink;
}

// One event of a slide's drawings, as the chalkboard plugin keeps them.
function inkEvent(e) {
	if (!e || typeof e !== 'object' || typeof e.time !== 'number' || !Number.isFinite(e.time) || e.time < 0 || e.time > 1e13) return null;
	const coord = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_DRIVER_COORD;
	const index = v => Number.isInteger(v) && v >= 0 && v <= 99;
	const time = e.time, board = index(e.board) ? e.board : 0;
	switch (e.type) {
	case 'draw': return index(e.color) && [e.x1, e.y1, e.x2, e.y2].every(coord)
		? { type: 'draw', color: e.color, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, time, board } : null;
	case 'erase': return coord(e.x) && coord(e.y) ? { type: 'erase', x: e.x, y: e.y, time, board } : null;
	case 'scroll': return coord(e.y) && e.y >= 0 ? { type: 'scroll', y: e.y, time, board } : null;
	case 'clear': case 'selectboard': case 'open': case 'close': return { type: e.type, time, board };
	}
	return null;
}

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
		if (p.versions !== undefined) {
			// Versions (see above): single-pick only; each has a name and a
			// story, and may have a prompt of its own.
			if (picks !== 1 || !Array.isArray(p.versions) || p.versions.length < 2 || p.versions.length > MAX_VERSIONS) return null;
			const versions = p.versions.map(v => v && typeof v === 'object'
				? { name: oneLine(v.name, 40), prompt: oneLine(v.prompt, 300), story: oneLine(v.story, MAX_STORY_LENGTH) } : null);
			return versions.every(v => v && v.name && v.story) ? { ...base, options, versions } : null;
		}
		return picks === 1 ? { ...base, options } : { ...base, options, picks };
	}
	case 'number': {
		const { min, max } = p;
		if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > MAX_NUMBER_RANGE) return null;
		return { ...base, min, max, unit: oneLine(p.unit, 20) };
	}
	case 'self-others': {
		const options = p.options === undefined ? ['Yes', 'No'] : texts(p.options, 2, MAX_SELF_OPTIONS, 80);
		const target = p.target ?? 0;
		if (!options || !isInt(target, 0, options.length - 1)) return null;
		return { ...base, options, target, others: oneLine(p.others, 300) };
	}
	case 'points': {
		const options = texts(p.options, 2, MAX_POINT_OPTIONS, 80);
		const total = p.total ?? 100;
		if (!options || !isInt(total, 2, MAX_POINTS)) return null;
		return { ...base, options, total, unit: oneLine(p.unit, 20) };
	}
	case 'grid': {
		const items = texts(p.items, 1, MAX_GRID_ITEMS, 120);
		const min = p.min ?? 0, max = p.max ?? 10;
		if (!items || !Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > MAX_GRID_RANGE) return null;
		const ends = l => Array.isArray(l) && l.length === 2 ? l.map(e => oneLine(e, 40)) : ['', ''];
		return { ...base, items, min, max, x: ends(p.x), y: ends(p.y) };
	}
	case 'pin': {
		// The phones load the image, so it must be a public https address.
		const image = typeof p.image === 'string' && p.image.length <= 500 && /^https:\/\/[^\s"'<>\\]+$/.test(p.image) ? p.image : null;
		return image ? { ...base, image, alt: oneLine(p.alt, 200) } : null;
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
		return { ...base, entries, moderated: p.moderated !== false, filter: p.filter !== false };
	}
	}
	return null;
}

// The word filter: a word cloud's words that are never shown without the
// tablet's approval, even in a poll that otherwise shows every word at once.
// A caught word is only held, not refused, so a false alarm costs a tap on the
// tablet.  Every word of an entry is checked, as typed and with the common
// symbol-for-letter swaps undone ("sh1t") and doubled letters single, and an
// entry spelt out letter by letter ("f u c k") is also read run together.
// EXACT matches whole words; PREFIX, any word starting so; WITHIN, any word
// containing it.
const BLOCKED = {
	EXACT: new Set(['ass', 'arse', 'cock', 'cocks', 'dick', 'dicks', 'prick', 'pricks', 'tit', 'tits', 'titty', 'titties', 'boob', 'boobs',
		'cum', 'jizz', 'anal', 'anus', 'dildo', 'fag', 'fags', 'homo', 'dyke', 'dykes', 'kike', 'kikes', 'chink', 'chinks', 'gook', 'gooks',
		'paki', 'pakis', 'wog', 'wogs', 'spic', 'spics', 'coon', 'coons', 'tranny', 'trannies', 'bitch', 'bitches', 'slut', 'sluts',
		'whore', 'whores', 'piss', 'pussy', 'pussies', 'porn', 'porno', 'retard', 'retards', 'retarded', 'spaz', 'spastic', 'raghead',
		'towelhead', 'dickhead', 'dickheads', 'knob', 'knobhead', 'bellend', 'nonce', 'skank', 'hoe', 'hoes']),
	PREFIX: ['cunt', 'bastard', 'bollock', 'twat', 'arsehole', 'asshole', 'motherf', 'cocksuck', 'blowjob', 'handjob', 'wanker'],
	WITHIN: ['fuck', 'shit', 'nigger', 'nigga', 'faggot', 'wank']
};
const UNSWAP = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't' };
function caught(text) {
	const lower = text.normalize('NFKC').toLocaleLowerCase('en');
	const words = new Set();
	for (const form of [lower, lower.replace(/[0134578@$!|+]/g, c => UNSWAP[c])]) {
		const parts = form.split(/[^\p{L}]+/u).filter(Boolean);
		if (parts.length > 1 && parts.every(w => [...w].length === 1)) parts.push(parts.join(''));
		parts.forEach(w => { words.add(w); words.add(w.replace(/(\p{L})\1+/gu, '$1')); });
	}
	return [...words].some(w => BLOCKED.EXACT.has(w) || BLOCKED.PREFIX.some(p => w.startsWith(p)) || BLOCKED.WITHIN.some(p => w.includes(p)));
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
	case 'self-others':
		return list(2) && isInt(value[0], 0, def.options.length - 1) && isInt(value[1], 0, 100) ? [...value] : undefined;
	case 'points':
		return list(def.options.length) && value.every(v => isInt(v, 0, def.total)) && value.reduce((a, b) => a + b, 0) === def.total
			? [...value] : undefined;
	case 'grid':
		return list(def.items.length) && value.every(v => Array.isArray(v) && v.length === 2 && isInt(v[0], def.min, def.max) && isInt(v[1], def.min, def.max))
			? value.map(v => [...v]) : undefined;
	case 'pin':
		return list(2) && isInt(value[0], 0, PIN_SCALE) && isInt(value[1], 0, PIN_SCALE) ? [...value] : undefined;
	}
	return undefined;
}

const aliasOf = (channel, voter) => sha256(ALIAS_SALT + ':' + channel + ':' + voter).slice(0, 12);

// A phone's key, as its answers are kept: its own id, sent when it joined,
// or else its connection's.
const voterOf = socket => socket.data.voter || 's:' + socket.id;

// A poll in versions (see above): the version dealt to a phone, dealing it
// the next in turn if it has none yet; and the poll as that phone is sent it.
function versionOf(poll, voter) {
	const n = poll.def.versions.length;
	if (poll.dealt.has(voter)) return poll.dealt.get(voter);
	if (poll.dealt.size >= MAX_VOTERS) return poll.next++ % n;		// a flood: dealt, not kept
	poll.dealt.set(voter, poll.next++ % n);
	return poll.dealt.get(voter);
}
function pollFor(poll, voter) {
	const def = poll.def;
	if (!def.versions) return { ...def, round: poll.round };
	const v = def.versions[versionOf(poll, voter)];
	return { id: def.id, kind: def.kind, prompt: v.prompt || def.prompt, instructions: def.instructions, options: def.options, story: v.story, round: poll.round };
}

// A poll the relay starts keeping, in a round of its own (see above).
const newPoll = (def, key) => ({ def, key, round: crypto.randomBytes(6).toString('hex'), answers: new Map(), words: new Map(), dealt: new Map(), next: 0 });

// Send the poll now open (or null) to the channel's phones: the same to
// all, or, for a poll in versions, each its own, dealt in the order the
// phones joined.
function sendPoll(channel, poll) {
	if (!poll) return io.to('audience:' + channel).emit('poll', null);
	if (!poll.def.versions) return io.to('audience:' + channel).emit('poll', pollFor(poll));
	for (const id of io.sockets.adapter.rooms.get('audience:' + channel) || []) {
		const socket = io.sockets.sockets.get(id);
		if (socket) socket.emit('poll', pollFor(poll, voterOf(socket)));
	}
}

// A word cloud's words, with how many phones gave each, and each one's status:
// 'pending' (waiting for the tablet), 'shown' or 'hidden'; and whether the
// word filter caught it.
function wordsOf(poll) {
	const counts = new Map();
	for (const list of poll.answers.values()) for (const w of list) counts.set(wordKey(w), (counts.get(wordKey(w)) || 0) + 1);
	return [...counts].map(([key, n]) => {
		const e = poll.words.get(key);
		return e.caught ? { key, word: e.word, n, status: e.status, caught: true } : { key, word: e.word, n, status: e.status };
	}).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

const counted = def => def.kind === 'choice' || (def.kind === 'number' && def.max - def.min <= MAX_COUNTED_RANGE);

// What the laptop is sent: see the comment above.
function tallyOf(channel, poll) {
	const def = poll.def;
	const tally = { id: def.id, total: poll.answers.size };
	if (counted(def)) {
		const counts = new Array(def.kind === 'choice' ? def.options.length * (def.versions ? def.versions.length : 1) : def.max - def.min + 1).fill(0);
		for (const a of poll.answers.values()) {
			if (Array.isArray(a)) a.forEach(k => counts[k]++);
			else counts[def.kind === 'choice' ? a : a - def.min]++;
		}
		tally.counts = counts;
	}
	if (def.versions) {
		tally.dealt = def.versions.map(() => 0);
		for (const v of poll.dealt.values()) tally.dealt[v]++;
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

// What the tablet is sent of any poll: how many have answered, and for a
// choice poll how many chose each option, for a number poll the median and
// mean, so the lecturer can see how it is going without the screen.
function countOf(channel, poll) {
	const def = poll.def;
	const m = { id: def.id, kind: def.kind, prompt: def.prompt, open: polls.get(channel)?.current === def.id, total: poll.answers.size };
	if (def.kind === 'choice') {
		m.options = def.versions ? def.versions.flatMap(v => def.options.map(o => v.name + ': ' + o)) : def.options;
		m.counts = m.options.map(() => 0);
		for (const a of poll.answers.values()) (Array.isArray(a) ? a : [a]).forEach(k => m.counts[k]++);
	}
	if (def.kind === 'number' && poll.answers.size) {
		const values = [...poll.answers.values()].sort((a, b) => a - b);
		m.median = values[Math.ceil(values.length / 2) - 1];
		m.mean = Math.round(10 * values.reduce((a, b) => a + b, 0) / values.length) / 10;
		m.unit = def.unit;
	}
	return m;
}

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
const sendTally = (channel, poll) => throttled(poll, 'tally', () => io.to('results:' + channel).to('q:' + channel).emit('poll-tally', tallyOf(channel, poll)));
const sendWords = (channel, poll) => throttled(poll, 'words', () => io.to('q:' + channel).emit('poll-words', wordsMessage(channel, poll)));
const sendCount = (channel, poll) => throttled(poll, 'count', () => io.to('q:' + channel).emit('poll-count', countOf(channel, poll)));

/*
 * The board: questions the tablet chooses to share with the room, which
 * phones may then upvote (Slido's Q&A).  A question still reaches only the
 * tablet; only one the lecturer shares ('board-share', with the questions key)
 * is kept, in memory, without its sender's name, for BOARD_TTL_MS, until the
 * tablet takes it down ('board-remove').  Phones vote with 'board-vote' (one
 * vote per phone per question, which it can take back); the board, with each
 * question's votes, goes to the phones, the tablet and the laptop ('board').
 */
const BOARD_TTL_MS = 3 * 3600 * 1000;
const MAX_BOARD = 50;						// shared questions per channel
const PER_SOCKET_VOTE_MS = 250;
const VOTES_PER_ADDRESS_PER_MIN = 1000;
const boards = new Map();	// channel id -> { items: Map(id -> { id, text, votes: Set(voter), at, expires }), timer, last }

const boardMessage = channel => ({
	items: [...(boards.get(channel)?.items.values() || [])]
		.map(({ id, text, votes, at }) => ({ id, text, votes: votes.size, at }))
		.sort((a, b) => b.votes - a.votes || a.at - b.at)
});
const sendBoard = channel => {
	if (!boards.has(channel)) boards.set(channel, { items: new Map() });
	throttled(boards.get(channel), 'board', () => io.to('audience:' + channel).to('q:' + channel).to('results:' + channel).emit('board', boardMessage(channel)));
};

/*
 * Reactions and the pace signal, which the laptop switches on with
 * questions-open's audience: { reactions: [...], pace: true }.  A phone may
 * send one of the deck's reactions ('reaction') at any time; it goes to the
 * laptop, which floats it up the screen, and to the tablet, and is kept
 * nowhere.  A phone may also say it is lost ('pace', lost: true or false),
 * privately: the tablet alone is told how many phones have said so in the
 * last PACE_WINDOW_MS ('pace'), out of how many on the ask page.
 */
const MAX_REACTIONS = 8;
const PER_SOCKET_REACTION_MS = 800;
const REACTIONS_PER_CHANNEL_PER_MIN = 600;
const REACTIONS_PER_ADDRESS_PER_MIN = 300;
const PACE_WINDOW_MS = 2 * 60 * 1000;
const pace = new Map();		// channel id -> { lost: Map(voter -> time), timer, last, sent }

function audienceOptions(a) {
	const reactions = a && Array.isArray(a.reactions)
		? a.reactions.filter(r => typeof r === 'string' && r.length >= 1 && r.length <= 16 && !/[\s<>&"'\\]/.test(r)) : [];
	return { reactions: [...new Set(reactions)].slice(0, MAX_REACTIONS), pace: !!a && a.pace === true };
}
const NO_AUDIENCE = { reactions: [], pace: false };

function paceMessage(channel) {
	const state = pace.get(channel);
	const now = Date.now();
	if (state) for (const [voter, at] of state.lost) if (now - at >= PACE_WINDOW_MS) state.lost.delete(voter);
	const room = io.sockets.adapter.rooms.get('audience:' + channel);
	return { lost: state ? state.lost.size : 0, audience: room ? room.size : 0, window: PACE_WINDOW_MS };
}
const sendPace = channel => {
	if (!pace.has(channel)) pace.set(channel, { lost: new Map() });
	const state = pace.get(channel);
	throttled(state, 'pace', () => {
		const m = paceMessage(channel);
		state.sent = m.lost;
		io.to('q:' + channel).emit('pace', m);
	});
};

io.on('connection', socket => {
	socket.on('multiplex-statechanged', data => {
		if (!data || typeof data.socketId !== 'string' || typeof data.secret !== 'string' || !data.secret) return;
		if (sha256(data.secret) !== data.socketId) return;
		const message = Object.assign({}, data, { secret: null });
		socket.join('master:' + data.socketId);		// the laptop: where the tablet's 'driver' batches go
		latest.delete(data.socketId);
		latest.set(data.socketId, message);
		if (latest.size > MAX_CHANNELS) latest.delete(latest.keys().next().value);
		socket.broadcast.emit(data.socketId, message);
	});

	socket.on('presenter-hello', channel => {
		if (typeof channel === 'string' && latest.has(channel)) socket.emit(channel, latest.get(channel));
	});

	// The laptop opens questions; with them, the audience's reactions and pace
	// signal (data.audience; both off if absent).  It may pass an ack, which
	// carries the board.  It also joins the channel's results room, for the
	// board and reactions.
	socket.on('questions-open', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		if (!data || typeof data.secret !== 'string' || typeof data.socketId !== 'string') return reply({ ok: false, reason: 'secret' });
		if (sha256(data.secret) !== data.socketId) return reply({ ok: false, reason: 'secret' });
		if (!/^\d{4}$/.test(data.code) || !HEX64.test(data.keyHash)) return reply({ ok: false, reason: 'invalid' });
		const channel = data.socketId;
		const room = 'q:' + channel;
		const previous = open.get(channel);
		if (previous && previous.keyHash !== data.keyHash) io.in(room).socketsLeave(room);	// key changed: re-authenticate
		const audience = audienceOptions(data.audience);
		open.set(channel, { code: data.code, keyHash: data.keyHash, expires: Date.now() + CODE_TTL_MS, audience });
		if (JSON.stringify(audience) !== JSON.stringify(previous?.audience || NO_AUDIENCE)) io.to('audience:' + channel).emit('audience', audience);
		socket.join('results:' + channel);
		reply({ ok: true, board: boardMessage(channel) });
	});

	socket.on('questions-listen', (data, ack) => {
		if (typeof ack !== 'function') return;
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return ack({ ok: false, reason: 'closed' });
		if (typeof data.key !== 'string' || sha256(data.key) !== entry.keyHash) return ack({ ok: false, reason: 'key' });
		socket.join('q:' + data.channel);
		ack({ ok: true, code: entry.code, audience: entry.audience || NO_AUDIENCE });	// the code, so the presenter can read it out if the slide isn't showing
		const state = polls.get(data.channel);
		const cloud = state && state.words !== null ? state.byId.get(state.words) : null;
		if (cloud) socket.emit('poll-words', wordsMessage(data.channel, cloud));
		const latestPoll = state && state.last ? state.byId.get(state.last) : null;
		if (latestPoll) socket.emit('poll-count', countOf(data.channel, latestPoll));
		socket.emit('board', boardMessage(data.channel));
		socket.emit('pace', paceMessage(data.channel));
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
			poll = newPoll(def, key);
			state.byId.delete(def.id);
			state.byId.set(def.id, poll);
			if (state.byId.size > MAX_POLLS) state.byId.delete(state.byId.keys().next().value);
		}
		poll.expires = Date.now() + POLL_TTL_MS;
		socket.join('results:' + channel);
		if (state.current !== def.id) {
			state.current = def.id;
			sendPoll(channel, poll);
		}
		state.last = def.id;
		if (def.kind === 'words') {
			state.words = def.id;
			io.to('q:' + channel).emit('poll-words', wordsMessage(channel, poll));
		}
		io.to('q:' + channel).emit('poll-count', countOf(channel, poll));
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
		if (closed) io.to('q:' + data.socketId).emit('poll-count', countOf(data.socketId, closed));
	});

	// The laptop asks for a poll's tally: results on a later slide, say.  It
	// then also receives that poll's updates.  So may the tablet, with the
	// questions key ({ channel, key, id }), which has the updates already.
	socket.on('poll-results', (data, ack) => {
		if (typeof ack !== 'function') return;
		let channel;
		if (authenticated(data)) {
			channel = data.socketId;
			socket.join('results:' + channel);
		}
		else if (data && typeof data.key === 'string') {
			const refused = tablet(data);
			if (refused) return ack({ ok: false, reason: refused });
			channel = data.channel;
		}
		else return ack({ ok: false, reason: 'secret' });
		const poll = typeof data.id === 'string' ? polls.get(channel)?.byId.get(data.id) : null;
		ack(poll ? { ok: true, tally: tallyOf(channel, poll) } : { ok: false, reason: 'unknown' });
	});

	// A phone joins the audience with the day's code, and its id (voter, as
	// with its answers: a poll in versions deals by it); the ack carries the
	// poll open now, if any, the board, and the audience options (reactions,
	// pace).
	socket.on('audience-join', (data, ack) => {
		if (typeof ack !== 'function') return;
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return ack({ ok: false, reason: 'closed' });
		if (data.code !== entry.code) return ack({ ok: false, reason: 'code' });
		if (typeof data.voter === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(data.voter)) socket.data.voter = 'v:' + data.voter;
		socket.join('audience:' + data.channel);
		const state = polls.get(data.channel);
		const poll = state && state.current !== null ? state.byId.get(state.current) : null;
		ack({ ok: true, poll: poll ? pollFor(poll, voterOf(socket)) : null, board: boardMessage(data.channel), audience: entry.audience || NO_AUDIENCE });
		if (entry.audience?.pace) sendPace(data.channel);		// the tablet's "out of how many"
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
			for (const w of value) {
				if (poll.words.has(wordKey(w))) continue;
				const isCaught = poll.def.filter !== false && caught(w);
				poll.words.set(wordKey(w), isCaught ? { word: w, status: 'pending', caught: true } : { word: w, status: poll.def.moderated ? 'pending' : 'shown' });
			}
			if (value.length) poll.answers.set(voter, value);
			else poll.answers.delete(voter);
			sendWords(data.channel, poll);
		}
		// A poll in versions keeps the answer as version * options + index, by
		// the version this phone was dealt (under its id, or else, from a page
		// that joined without one, its connection's).
		else if (poll.def.versions) poll.answers.set(voter, versionOf(poll, poll.dealt.has(voter) ? voter : voterOf(socket)) * poll.def.options.length + value);
		else poll.answers.set(voter, value);
		sendTally(data.channel, poll);
		sendCount(data.channel, poll);
		// For a word cloud, how many of this phone's words are not on the screen
		// (waiting for the tablet, or hidden by it).
		ack(words ? { ok: true, held: value.filter(w => poll.words.get(wordKey(w)).status !== 'shown').length } : { ok: true });
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

	// The tablet's side of the board: share a question, or take one down.
	const tablet = data => {
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return 'closed';
		if (typeof data.key !== 'string' || sha256(data.key) !== entry.keyHash) return 'key';
		return null;
	};
	socket.on('board-share', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		const refused = tablet(data);
		if (refused) return reply({ ok: false, reason: refused });
		const text = clean(data.text);
		if (!text) return reply({ ok: false, reason: 'invalid' });
		if (!boards.has(data.channel)) boards.set(data.channel, { items: new Map() });
		const items = boards.get(data.channel).items;
		const same = [...items.values()].find(i => i.text === text);
		if (same) return reply({ ok: true, id: same.id });		// shared already
		if (items.size >= MAX_BOARD) return reply({ ok: false, reason: 'busy' });
		const id = crypto.randomUUID();
		items.set(id, { id, text, votes: new Set(), at: Date.now(), expires: Date.now() + BOARD_TTL_MS });
		sendBoard(data.channel);
		reply({ ok: true, id });
	});
	socket.on('board-remove', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		const refused = tablet(data);
		if (refused) return reply({ ok: false, reason: refused });
		const board = boards.get(data.channel);
		if (data.all === true && board) board.items.clear();
		else if (!board || typeof data.id !== 'string' || !board.items.delete(data.id)) return reply({ ok: false, reason: 'unknown' });
		sendBoard(data.channel);
		reply({ ok: true });
	});

	// The tablet starts the channel afresh (see the polls' comment): every
	// poll, the board and the pace signal forgotten, a poll open now opened
	// again empty, in a new round.  Pending throttled sends are cancelled, so
	// that nothing from before arrives after.
	socket.on('reset', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		const refused = tablet(data);
		if (refused) return reply({ ok: false, reason: refused });
		const channel = data.channel;
		const cancel = (holder, names) => { if (holder) names.forEach(n => clearTimeout(holder[n + 'Timer'])); };
		const state = polls.get(channel);
		for (const poll of state ? state.byId.values() : []) cancel(poll, ['tally', 'words', 'count']);
		const current = state && state.current !== null ? state.byId.get(state.current) : null;
		const fresh = current && newPoll(current.def, current.key);
		if (fresh) {
			fresh.expires = Date.now() + POLL_TTL_MS;
			const id = fresh.def.id;
			polls.set(channel, { current: id, words: fresh.def.kind === 'words' ? id : null, last: id, byId: new Map([[id, fresh]]) });
		}
		else polls.delete(channel);
		cancel(boards.get(channel), ['board']);
		boards.delete(channel);
		cancel(pace.get(channel), ['pace']);
		pace.delete(channel);
		io.to('results:' + channel).to('q:' + channel).emit('reset');
		io.to('audience:' + channel).to('q:' + channel).to('results:' + channel).emit('board', boardMessage(channel));
		io.to('q:' + channel).emit('pace', paceMessage(channel));
		if (fresh) {
			sendPoll(channel, fresh);
			io.to('results:' + channel).to('q:' + channel).emit('poll-tally', tallyOf(channel, fresh));
			io.to('q:' + channel).emit('poll-count', countOf(channel, fresh));
			if (fresh.def.kind === 'words') io.to('q:' + channel).emit('poll-words', wordsMessage(channel, fresh));
		}
		reply({ ok: true });
	});

	// The tablet drives the laptop's deck (see driverOp).  A batch carries the
	// step it was drawn on (at: the position the laptop last sent, which the
	// laptop checks), an id for the tablet's page (from) and a number (seq),
	// by which the laptop ignores a batch sent again.
	let driverSecond = 0, driverBatches = 0;
	socket.on('driver', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		const refused = tablet(data);
		if (refused) return reply({ ok: false, reason: refused });
		const now = Date.now();
		if (now - driverSecond >= 1000) { driverSecond = now; driverBatches = 0; }
		if (++driverBatches > DRIVER_BATCHES_PER_SECOND) return reply({ ok: false, reason: 'busy' });
		const at = data.at;
		const step = v => Number.isInteger(v) && v >= -1 && v < 100000;
		if (!at || !step(at.h) || !step(at.v) || !step(at.f) || typeof data.from !== 'string' || !/^[0-9a-f]{8,32}$/.test(data.from)
			|| !Number.isInteger(data.seq) || data.seq < 1 || !Array.isArray(data.ops) || !data.ops.length || data.ops.length > MAX_DRIVER_OPS)
			return reply({ ok: false, reason: 'invalid' });
		const ops = data.ops.map(driverOp).filter(Boolean);
		if (!ops.length) return reply({ ok: false, reason: 'invalid' });
		const room = 'master:' + data.channel;
		if (!io.sockets.adapter.rooms.get(room)?.size) return reply({ ok: false, reason: 'no-laptop' });
		const batch = { from: data.from, seq: data.seq, at: { h: at.h, v: at.v, f: at.f }, ops };
		io.to(room).timeout(DRIVER_ACK_MS).emit('driver', batch, (err, replies) => {
			const list = Array.isArray(replies) ? replies : [];
			const done = list.find(r => r && r.ok === true);
			if (done) return reply({ ok: true, dropped: Number.isInteger(done.dropped) ? done.dropped : 0 });
			const why = list.find(r => r && typeof r.reason === 'string');
			reply({ ok: false, reason: why ? oneLine(why.reason, 20) : 'timeout' });
		});
	});

	// The laptop's ink, on to the tablet; the tablet's asking for a slide's.
	const perSecond = () => { let second = 0, count = 0; return limit => { const now = Date.now(); if (now - second >= 1000) { second = now; count = 0; } return ++count <= limit; }; };
	const inkBatch = perSecond(), inkPart = perSecond(), inkWant = perSecond();
	const laptopOf = data => data && typeof data.socketId === 'string' && socket.rooms.has('master:' + data.socketId) ? data.socketId : null;
	socket.on('ink', data => {
		const channel = laptopOf(data), at = data && inkAt(data.at), run = data && inkRun(data.run);
		if (!channel || !at || !run || !Array.isArray(data.ops) || !data.ops.length || data.ops.length > MAX_INK_OPS || !inkBatch(INK_BATCHES_PER_SECOND)) return;
		const ops = data.ops.map(inkOp).filter(Boolean);
		if (ops.length) io.to('q:' + channel).emit('ink', { run, at, ops });
	});
	socket.on('ink-slide', data => {
		const channel = laptopOf(data), at = data && inkAt(data.at), run = data && inkRun(data.run);
		if (!channel || !at || !run || !inkPart(INK_PARTS_PER_SECOND)) return;
		const { part, parts, n, slide, durations } = data;
		if (!Number.isInteger(parts) || parts < 1 || parts > MAX_INK_PARTS || !Number.isInteger(part) || part < 0 || part >= parts) return;
		if (!Number.isInteger(n) || n < 0 || !slide || !inkStep(slide.h) || !inkStep(slide.v) || (slide.f !== undefined && !inkStep(slide.f))) return;
		if (!Array.isArray(durations) || durations.length !== 2 || !durations.every(d => typeof d === 'number' && Number.isFinite(d) && d >= 0 && d < 1e13)) return;
		const notes = Array.isArray(data.notes) ? data.notes : [], board = Array.isArray(data.board) ? data.board : [];
		if (notes.length + board.length > MAX_INK_PART) return;
		io.to('q:' + channel).emit('ink-slide', {
			run, at, n, part, parts, slide: slide.f === undefined ? { h: slide.h, v: slide.v } : { h: slide.h, v: slide.v, f: slide.f },
			mode: data.mode === 1 ? 1 : 0, durations, notes: notes.map(inkEvent).filter(Boolean), board: board.map(inkEvent).filter(Boolean)
		});
	});
	socket.on('ink-want', data => {
		if (tablet(data) || !inkWant(INK_WANTS_PER_SECOND)) return;
		io.to('master:' + data.channel).emit('ink-want', { at: inkAt(data.at) });
	});

	// A phone votes for a question on the board (up: true), or takes its vote
	// back (up: false).
	let lastVote = 0;
	socket.on('board-vote', (data, ack) => {
		if (typeof ack !== 'function') return;
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return ack({ ok: false, reason: 'closed' });
		if (data.code !== entry.code) return ack({ ok: false, reason: 'code' });
		const item = typeof data.id === 'string' && boards.get(data.channel)?.items.get(data.id);
		if (!item) return ack({ ok: false, reason: 'unknown' });
		if (typeof data.voter !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(data.voter)) return ack({ ok: false, reason: 'invalid' });
		if (Date.now() - lastVote < PER_SOCKET_VOTE_MS) return ack({ ok: false, reason: 'slow' });
		if (!withinLimit('va:' + addressOf(socket), VOTES_PER_ADDRESS_PER_MIN)) return ack({ ok: false, reason: 'busy' });
		lastVote = Date.now();
		if (data.up === true) item.votes.add(data.voter); else item.votes.delete(data.voter);
		sendBoard(data.channel);
		ack({ ok: true, votes: item.votes.size });
	});

	// A reaction, from those the deck offers; forwarded and forgotten.
	let lastReaction = 0;
	socket.on('reaction', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return reply({ ok: false, reason: 'closed' });
		if (data.code !== entry.code) return reply({ ok: false, reason: 'code' });
		if (!entry.audience || !entry.audience.reactions.includes(data.emoji)) return reply({ ok: false, reason: 'invalid' });
		if (Date.now() - lastReaction < PER_SOCKET_REACTION_MS) return reply({ ok: false, reason: 'slow' });
		if (!withinLimit('ra:' + addressOf(socket), REACTIONS_PER_ADDRESS_PER_MIN)) return reply({ ok: false, reason: 'busy' });
		if (!withinLimit('rc:' + data.channel, REACTIONS_PER_CHANNEL_PER_MIN)) return reply({ ok: false, reason: 'busy' });
		lastReaction = Date.now();
		io.to('results:' + data.channel).to('q:' + data.channel).emit('reaction', { emoji: data.emoji });
		reply({ ok: true });
	});

	// "I'm lost" (lost: true) or "I'm fine again" (lost: false), for the tablet
	// alone; it lapses after PACE_WINDOW_MS.
	let lastPace = 0;
	socket.on('pace', (data, ack) => {
		const reply = typeof ack === 'function' ? ack : () => {};
		const entry = data && typeof data.channel === 'string' && open.get(data.channel);
		if (!entry || entry.expires < Date.now()) return reply({ ok: false, reason: 'closed' });
		if (data.code !== entry.code) return reply({ ok: false, reason: 'code' });
		if (!entry.audience || !entry.audience.pace) return reply({ ok: false, reason: 'closed' });
		if (typeof data.voter !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(data.voter)) return reply({ ok: false, reason: 'invalid' });
		if (Date.now() - lastPace < 1000) return reply({ ok: false, reason: 'slow' });
		if (!withinLimit('pp:' + addressOf(socket), ANSWERS_PER_ADDRESS_PER_MIN)) return reply({ ok: false, reason: 'busy' });
		lastPace = Date.now();
		if (!pace.has(data.channel)) pace.set(data.channel, { lost: new Map() });
		const lost = pace.get(data.channel).lost;
		if (data.lost === true) lost.set('v:' + data.voter, Date.now());
		else lost.delete('v:' + data.voter);
		sendPace(data.channel);
		reply({ ok: true, window: PACE_WINDOW_MS });
	});
});

// The pace count falls as signals lapse: tell the tablet when it does.
setInterval(() => {
	for (const [channel, state] of pace) {
		if (paceMessage(channel).lost !== state.sent) sendPace(channel);
		if (!state.lost.size && !open.has(channel)) pace.delete(channel);
	}
}, 10 * 1000).unref();

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
	for (const [channel, board] of boards) {
		let changed = false;
		for (const [id, item] of board.items) if (item.expires < now) { board.items.delete(id); changed = true; }
		if (changed) sendBoard(channel);
		if (!board.items.size && !open.has(channel)) boards.delete(channel);
	}
}, 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => console.log(`reveal.js-presenter relay listening on ${HOST}:${PORT}`));
