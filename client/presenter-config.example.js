/*
 * reveal.js-presenter — settings shared by the decks and the presenter page.
 *
 * Copy to presenter-config.js, or let `node tools/make-channel.js <relay> --write
 * <path>` write it for you.  Nothing here is secret: the channel id is useless
 * without its secret, which belongs in the laptop's ?master=<secret> URL and
 * never in a published file.
 */
window.PresenterConfig = {
	// The relay both sides connect to.  Any reveal/multiplex server works; so
	// does server/relay.js from this package.
	relay: 'https://relay.example.org',

	// sha256(secret) as 64 hex digits, from tools/make-channel.js.
	channel: 'REPLACE-WITH-THE-CHANNEL-ID',

	// Optional.  Turns on audience questions (ask.html): sha256 of the key the
	// presenter's tablet enters once to receive them, from tools/make-channel.js.
	// questionsKey: 'REPLACE-WITH-THE-KEY-HASH',

	// Optional, with questionsKey.  The public address of ask.html.  The laptop
	// then draws a QR code for it, with today's code filled in, into any
	// <question-qr></question-qr> (or element with class "question-qr"),
	// captioned with its short-url or text ("Ask a question" by default).
	// qrStudio overrides where the QR library is loaded from (default:
	// vendor/qr-studio.js next to presenter-master.js), and qrOptions is passed
	// to it (e.g. { foreground: '#604e25' }, which colours the caption too).
	// askUrl: 'https://your.site/presenter/ask.html',
	// qrStudio: '/path/to/qr-studio.js',
	// qrOptions: { moduleStyle: 'smooth' },

	// Optional, with questionsKey: what the ask page offers besides questions.
	// reactions: up to 8 emoji (a list, or one string separated by spaces),
	// which float up the laptop's screen and are tallied on the tablet; none by
	// default.  pace: true adds the "Lost?" toggle, whose count only the tablet
	// sees; it is off by default.
	// reactions: ['👍', '❤️', '😂', '🤯'],
	// pace: true,

	// Optional, with questionsKey: live polls (presenter-polls.js).  A ?master
	// deck loads presenter-polls.js and presenter-polls.css from beside
	// presenter-master.js, or from pollsScript and pollsStyle; polls: false
	// leaves them out.  pollPill is what the pill at the foot of the screen
	// says while a poll is open: '' (the default) for "Answer on your phone ·
	// 3 answers", 'icon' for the phone icon alone, 'none' for no pill, or your
	// own text, in which {n} is the number of answers and {answers} is
	// "3 answers".  pollPillPosition: 'bottom' (default), 'bottom-left',
	// 'bottom-right', 'top', 'top-left' or 'top-right'.  A poll's own
	// data-pill and data-pill-position override both.
	// polls: false,
	// pollsScript: '/path/to/presenter-polls.js',
	// pollsStyle: '/path/to/presenter-polls.css',
	// pollPill: 'icon',
	// pollPillPosition: 'top-right',

	// Optional.  Where the third-party libraries for polls come from; by
	// default, pinned versions on jsDelivr.  webAwesome is the dist-cdn
	// directory of Web Awesome 3.14 (MIT), whose components the ask page uses
	// for its poll controls; d3Cloud is d3-cloud's d3.layout.cloud.js (BSD-3),
	// which the laptop loads only for a deck with a word cloud.  Point them at
	// copies on your own site to depend on no CDN.
	// webAwesome: 'https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn',
	// d3Cloud: 'https://cdn.jsdelivr.net/npm/d3-cloud@1.2.9/build/d3.layout.cloud.js',

	// Optional, with questionsKey: Drive, the tablet writing on the laptop's
	// slides and stepping through them, and the laptop's writing shown on the
	// tablet.  A ?master deck loads presenter-drive.js from beside
	// presenter-master.js, or from driveScript; drive: false leaves it out.
	// The writing needs the chalkboard plugin in vendor/chalkboard (rajgoel's,
	// changed for this); without it, the tablet's ◀ ▶ still work.
	// drive: false,
	// driveScript: '/path/to/presenter-drive.js',

	// Optional.  A button on the deck's customcontrols toolbar (if it has one)
	// that hides and shows the question QR code in the ?master deck, and is
	// shown, as the laptop's is, in the tablet's copies.  Elsewhere it appears
	// only where the secret is in the config (the server-side variant in
	// CLAUDE.md), on localhost or in a browser that has opened a deck with
	// ?master or holds the questions key, and reopens the deck with ?master.
	// questionButton: false leaves it out; questionButtonIcon is its icon, as
	// HTML (default: a small speech bubble, drawn inline).
	// questionButton: false,
	// questionButtonIcon: '<i class="fa-solid fa-comment"></i>',

	// Optional.  How often (ms) the laptop re-broadcasts an unchanged position,
	// so a presenter view that reconnects catches up.  Default 3000.
	// heartbeatMs: 3000,

	// Optional.  Selectors hidden inside the presenter's copies of the deck, for
	// plugin UI that Reveal.configure() cannot switch off.  The current slide
	// shows what the projector does, the deck's own controls included, so
	// hideInFrames (both copies) hides only what never belongs there: by default
	// the menu plugin's open panel.  hideInNext hides more on the next slide
	// alone, which shows the slide and nothing else: by default the menu's
	// button, customcontrols' toolbar, and the chalkboard's handle and palettes.
	// hideInFrames: '.slide-menu-wrapper',
	// hideInNext: '.slide-menu-button, #customcontrols, div.boardhandle, div.palette, .chalkboard-button, .board-button, #nextboard, #previousboard',

	// Optional.  Maps the path a deck announces to the URL the presenter page
	// should load.  Needed only when the laptop serves decks under different
	// paths from the server the presenter page is on.
	// deckUrl: path => path,
};
