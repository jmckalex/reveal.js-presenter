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
	// then draws a QR code for it, with today's code filled in, into any element
	// with class "question-qr".  qrStudio overrides where the QR library is
	// loaded from (default: vendor/qr-studio.js next to presenter-master.js), and
	// qrOptions is passed to it (e.g. { foreground: '#604e25' }).
	// askUrl: 'https://your.site/presenter/ask.html',
	// qrStudio: '/path/to/qr-studio.js',
	// qrOptions: { moduleStyle: 'smooth' },

	// Optional.  How often (ms) the laptop re-broadcasts an unchanged position,
	// so a presenter view that reconnects catches up.  Default 3000.
	// heartbeatMs: 3000,

	// Optional.  Selectors hidden inside the presenter's copies of the deck, for
	// plugin UI that Reveal.configure() cannot switch off.  The default covers
	// the menu, chalkboard and customcontrols plugins.
	// hideInFrames: '.slide-menu-button, .slide-menu-wrapper, #customcontrols',

	// Optional.  Maps the path a deck announces to the URL the presenter page
	// should load.  Needed only when the laptop serves decks under different
	// paths from the server the presenter page is on.
	// deckUrl: path => path,
};
