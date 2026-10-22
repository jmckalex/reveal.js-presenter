# reveal.js-presenter

A presenter view for [reveal.js](https://revealjs.com) on a second device. Prop
an iPad on the lectern (or hold a phone), and it shows:

- the current slide, exactly as the audience sees it, fragments included;
- the next slide, or the next fragment, so you know what your click will reveal;
- your speaker notes (`<aside class="notes">` or `data-notes`), resizable;
- a clock and a timer; and badges for a blanked screen or open overview.

reveal.js's own speaker view (the `S` key) opens a popup tied to the laptop's
browser, so it can't move to another device. This can, and it works when you
are nowhere near the laptop. Optionally, the audience can send questions to it
from their phones, by scanning a QR code on a slide, and answer live polls,
whose results the laptop draws on the slides.

![The laptop deck and the tablet's presenter view side by side, as the laptop steps through the demo deck and a student's question arrives on the tablet](docs/demo.gif)

## Try it on one computer

Five minutes, with Node 18 or later. From this directory:

```
npm --prefix server install
node server/relay.js &
node tools/make-channel.js http://127.0.0.1:1948 --write client/presenter-config.js \
     --ask http://127.0.0.1:8000/client/ask.html
python3 -m http.server 8000 --bind 127.0.0.1
```

`make-channel.js` prints a **secret** and a **questions key**. Then, in two
browser windows:

1. **"Laptop":** `http://127.0.0.1:8000/example/index.html?master=<secret>`
2. **"Tablet":** `http://127.0.0.1:8000/client/presenter.html`. Make the window
   tablet-sized, tap **Start**, and enter the questions key when asked.

Step through the deck in the first window; the second follows. On the
*Questions?* slide, open the QR code's link (or `client/ask.html`) in a third
window and send a question. Then carry on through the *Live polls* slides:
each opens a poll on the ask page, and the laptop draws the answers. Every
browser counts as one phone, so open the link in a private window or two, or
in other browsers, to see several answers. When you're done, stop the two
servers. The generated `client/presenter-config.js` is ignored by git.

Everything here runs on `127.0.0.1`. To use a real tablet, the relay and the
decks must be reachable from it: see [Doing it by hand](#doing-it-by-hand).

## How it works

```
 laptop                              relay                         tablet
 deck.html?master=<secret>  ──►  Socket.IO server  ──►  presenter.html
 broadcasts {position, deck}     forwards it only if    loads the same deck twice
 on every change + every 3 s     sha256(secret) =       (current + next), drives
                                 channel id             them, shows notes & time
```

- The **laptop** runs your deck with `?master=<secret>` on the URL. A small
  script broadcasts the deck's position on every slide or fragment change, and
  again every 3 s.
- The **relay** forwards each message to everyone listening on that channel. It
  only does so if the message's secret hashes (SHA-256) to the channel id. Any
  [reveal/multiplex](https://github.com/reveal/multiplex) server works; so does
  the stricter one in `server/`.
- The **tablet** opens `presenter.html`, which loads your deck twice in
  iframes: one for the current slide and one for the next. It moves both to
  follow the laptop, through each copy's `Reveal` object.

The two devices never connect to each other, only to the relay. So they need
internet access, but not the same network. That matters because conference
and university WiFi (eduroam, for instance) usually blocks devices on it from
reaching each other directly.

A deck opened *without* `?master` is untouched. The script returns
immediately, and the deck never contacts the relay. So your published decks
behave exactly as before, for you and for everyone else.

## Using it with Claude Code

Open Claude Code in the project that holds your presentations and say
something like:

> Add the presenter view from ~/Source/reveal.js/presenter to my decks.

The agent should read [`CLAUDE.md`](CLAUDE.md) in this directory. It describes
how to fit the package to different deck setups (plain HTML, templated, ES
modules), what to ask you, and the design decisions that must not be
"simplified" away.

## Doing it by hand

1. **Pick a relay.** Use an existing reveal/multiplex server, or deploy
   `server/` (see [Running the relay](#running-the-relay)). It must be on
   HTTPS if your decks are.
2. **Make a channel:**
   `node tools/make-channel.js https://relay.example.org --write client/presenter-config.js`.
   It prints the **secret**. Keep the secret private and out of every file you
   publish.
3. **Install the client.** Put `presenter.html`, `presenter-master.js` and
   `presenter-config.js` together in one directory on the **same site** as
   your decks, e.g. `/presenter/`. The presenter page drives the decks through
   their JavaScript, which browsers allow only within one origin. For audience
   questions and polls, add `ask.html`, `presenter-polls.js`,
   `presenter-polls.css` and `vendor/` (the QR code) to the same directory.
4. **Add two lines to every deck**, or once to a shared template, anywhere
   after reveal.js is loaded:
   ```html
   <script src="/presenter/presenter-config.js"></script>
   <script src="/presenter/presenter-master.js"></script>
   ```
   The deck must expose `window.Reveal`. The standard `dist/reveal.js` script
   does this. With ES modules, add `window.Reveal = deck` after creating it.
5. **Publish** the decks and the `/presenter/` directory.

## In the room

1. Laptop: open the deck as `…/deck.html?master=<secret>`. Bookmark it.
2. Tablet: open `https://your.site/presenter/presenter.html` and tap
   **Start**. That starts the timer and asks the device not to sleep. On an
   iPad, Safari's *Share → Add to Home Screen* gives it a full-screen icon.
3. The status light shows the connection:
   - green: following the laptop;
   - amber: connected, but the laptop has gone quiet (its lid is closed, or the
     deck isn't open with `?master`);
   - red: the relay can't be reached.

The tablet follows whichever deck the laptop broadcasts, so one bookmark works
for a whole course or conference. `?deck=/path/to/deck.html` preloads a deck
before the laptop speaks.

The tablet loads the deck *from the site*, so the published copy must match
the one on the laptop. If you present from a local copy, publish your changes
first, or the slides won't line up. If the laptop serves decks under different
paths from the site, set `deckUrl` in `presenter-config.js` to map one onto the
other.

## Audience questions

Students can send questions straight to the tablet, from their phones:

1. The **laptop** deck shows a 4-digit code on a slide: put
   `<span class="question-code">····</span>` wherever you want it. Only the
   laptop's copy knows the code, because it is derived from the secret, and it
   changes daily. Everyone else, including the published deck, sees the dots.
2. **Students** open `ask.html`, most easily by scanning a QR code on the
   same slide (below), which fills the code in for them. They type a question
   of up to 280 characters, and press Send. They are told whether it was
   delivered.
3. The **tablet** shows each question in its lower-right corner, newest
   first. The clock and timer shrink to make room; tap a question to dismiss
   it. The tablet also shows the day's code.

Two keys keep it private:
- **Posting needs the code on the slide.** That stops anyone who isn't in the
  room or following the lecture live.
- **Reading needs the tablet key.** You type it on the tablet once, and the
  tablet remembers it. Without it, knowing the (public) channel gets you
  nothing.

**Questions are transient.** The relay hands each one to the tablet's open
connection and forgets it. Questions are never stored or logged anywhere. If
the tablet isn't connected, the question is refused, and the student is told
so. On the tablet, questions live only in the open page. The one exception is
a question you choose to *share* with the room (below): the relay keeps that,
without any name, for three hours.

**Limits:** one question per page every 10 s, and 20 a minute per channel.
There is also a generous per-address cap; it can't be strict, because a whole
lecture hall on university WiFi may share a few public addresses.

To turn questions on, `tools/make-channel.js` prints a tablet key and puts its
hash in `presenter-config.js` as `questionsKey`. Without `questionsKey`,
everything behaves as before.

**The QR code.** Put `<div class="question-qr"></div>` on the slide, and give
`make-channel.js` the public address of `ask.html` with `--ask` (it becomes
`askUrl` in the config). The laptop's copy then draws a QR code for
`ask.html?code=<today's code>` into the element; every other copy leaves it
empty. Size the element with CSS; the code fills its width. It always points
at `askUrl`, never at the deck's own address, so it works when you present
from `localhost`. The drawing is done by the vendored
[QR Studio](client/vendor/README.md); `qrOptions` in the config is passed to
it, e.g. `{ moduleStyle: 'rounded', foreground: '#604e25' }`. Its default
background is transparent, so test a busy slide background with a phone in
the room.

## Live polls

With questions on, a deck can also ask the audience things, and show the
answers on the slides as they arrive. A poll is an empty element on a slide:

```html
<div class="poll" data-poll="sleep" data-kind="number" data-min="0" data-max="12"
     data-unit="hr|hrs" data-prompt="How many hours did you sleep last night?"></div>
<div class="poll-results" data-poll="sleep"></div>
```

- While that slide is showing on the laptop (`?master`), the poll is **open**:
  every phone on the ask page swaps the question form for it ("Live poll"),
  and a pill at the foot of the laptop's screen counts the answers. If the
  `.poll` is a fragment, or inside one, the poll opens once it is shown.
  Leaving the slide closes it.
- A `.poll-results` with the same `data-poll`, on that slide or any later
  one, **draws the answers**, live. Make it a fragment to hold it back for a
  click. It is 280 px tall unless you set `style="height: …"`.
- With class `overlay`, the chart is instead a card over the slide below its
  title, with the poll's prompt, as a step of its own where it stands among
  the slide's fragments; the next click takes it away. That step exists only
  on the laptop, and the tablet is sent the position without it, so the two
  stay in line.
- Each phone answers once and may change its answer while the poll is open.
  It is counted by a random id kept in its own storage. Poll answers carry no
  name.
- **Only the laptop's copy draws anything.** Opened without `?master`, a
  deck's `.poll` and `.poll-results` stay empty, so an inline chart leaves an
  empty space (and an empty step, if it is a fragment) in the published copy
  and on the tablet. Overlays leave nothing.

### The kinds of poll

Lists are separated by `|`. Every poll takes `data-poll` (its id: letters,
digits, `-` and `_`), `data-prompt` and, optionally, `data-instructions`, a
line shown on the phones under the "Live poll" title (otherwise a default for
the kind).

| `data-kind` | Attributes | The phone | The chart |
|---|---|---|---|
| `choice` (the default) | `data-options` (2–12); `data-picks="2"`, or `"all"`, for several | buttons; with picks, ticks and Send | a bar per option |
| `number` | `data-min`, `data-max` (whole numbers, up to a million apart), `data-unit` (`"%"`, or a singular and plural, `"hr\|hrs"`) | a button per value, up to 13 values; a slider, up to 101; else a field to type in | a column per value, or per range of values, with the median and mean |
| `scale` | `data-statements` (1–12), `data-min` (1), `data-max` (5), `data-labels="Disagree\|Agree"` | stars per statement when `min` is 1, else a row of numbers | a bar per statement divided by rating, with its mean |
| `premises` | `data-statements` (2–12, the conclusion last, or `data-conclusion="n"`, from 1), `data-labels` (`Accept\|Reject`) | accept or reject each | how many accept each, against the halfway line; it flags the discursive dilemma |
| `ranking` | `data-options` (2–10) | tap the options in order | the options by average position |
| `words` | `data-entries` (1–5 per phone), `data-moderate="off"`, `data-filter="off"`, `data-vertical` (the share of words on end, 0–1, default 0.5), `data-colours="shades"` | type words or short phrases | a word cloud of the approved words |
| `self-others` | `data-options` (`Yes\|No`), `data-target` (from 1), `data-others` (the second question) | your own answer, then a guess at the room's percentage | the share who gave the target answer, against the room's guesses |
| `points` | `data-options` (2–10), `data-total` (100), `data-unit` | a slider per option; Send once they add up | each option's average, and each answer as a dot |
| `grid` | `data-items` (1–8), `data-x="Slow\|Fast"`, `data-y="Shallow\|Deep"`, `data-min`, `data-max` (0, 10) | a square per item to tap | each item's average place, and each answer as a dot |
| `pin` | `data-image`, `data-alt` | tap the picture | a heat map over the picture |

**A word cloud's words wait for the tablet.** They are free text from the
audience, so each goes first to the tablet, where you tap it (or "Show all
new") to put it on the screen; the laptop never receives a word you haven't
shown. With `data-moderate="off"` every word goes straight up, except those
the relay's word filter catches (swear words and slurs, also spelt "sh1t" or
"f u c k"): those wait, flagged ⚑. The filter only holds a word, never refuses
it, so a false alarm costs one tap. The cloud is laid out by
[d3-cloud](https://github.com/jasondavies/d3-cloud), as in Wordle.

**A pin poll's picture** must be one the phones can load over `https`. A
relative `data-image` is taken relative to the deck; if the laptop serves the
deck from `localhost`, the phones are sent the same path on the site of
`askUrl` instead.

### What a chart can add

On a `.poll-results` (not the `.poll`):

| Attribute | For | Shows |
|---|---|---|
| `data-answer` | choice, number | the right answer: an option's text or number (from 1), or a quantity's true value, with how the median guess did (Galton's ox) |
| `data-display="beauty"` | number | the beauty contest: the guess closest to two-thirds of the average wins (`data-fraction`, default `2/3`); on a 0–100 poll, the levels of reasoning are marked |
| `data-display="coordination"` | choice, number | the most common answer wins |
| `data-payoffs="4 0 \| 3 3"` | choice, one pick | a game against the room: a row of payoffs per option (here, the stag hunt); each option's expected payoff against someone picked at random from the room, and the best reply |
| `data-display="rules"` | ranking | the winner and the full order under plurality, the Borda count, Condorcet and instant runoff |
| `data-display="dots"` | pin | a dot per answer instead of the heat map |
| `data-before="<poll>"` | any | before and after: see below |

Two charts of one poll, the second a fragment with `data-answer`, reveal the
truth on a click.

**Before and after.** `<div class="poll" data-poll="after" data-repeat="before">`
asks the poll `before` again, with its attributes, as a poll of its own; and
`<div class="poll-results" data-poll="after" data-before="before">` compares
the two, phone by phone: a flow of who moved where (one-pick choice), a line
per phone (number), or each row's average before and after (scale, premises,
points, ranking). Only phones that answered both count. The relay matches
phones by aliases it makes afresh each time it starts, so it must not restart
between the two.

**Versions** (relay protocol only, for now). A single-pick choice poll may come
in two to four versions, each `{ name, prompt, story }`: an experiment in which
each phone sees one version and the versions' answers are compared (Knobe's
two stories of the chairman). The relay deals the versions out in turn as each
phone is first sent the poll, keeps which phone has which with the poll, and
sends a phone only its own `prompt` and `story` (up to 1200 characters). A
phone answers with an option's index; the laptop's counts and aliases carry
`version × options + index`, its tally also says how many phones were `dealt`
each version, and the tablet's counts are labelled "name: option". A phone
should send its `voter` id with `audience-join`, so that a reload brings back
the same version. `client/ask.html` and `presenter-polls.js` don't build or
show versions yet; the PH226 course pages (`ask.js`, `master.js`) do.

**Reset** (relay protocol only, for now). The tablet may send `reset` with
the questions key, to start the lecture again from a clean state (after a
rehearsal, say): the relay forgets that channel's polls, their answers and
the versions it dealt, the board and "Lost?", and opens again, empty, any
poll open at the time. Each poll the phones are sent carries a `round`, new
whenever the relay has forgotten the poll's answers, so a phone remembers
its answer by poll and round and never shows one the relay no longer has.
`client/presenter.html` has no Reset button yet; the PH226 iPad page does.

**Driving** (relay protocol only, for now). The tablet may send `driver`
with the questions key: strokes for the deck's chalkboard plugin (its pen,
on the slide, and its chalkboard, which it may scroll) and steps back and
forward or in any of reveal's four directions, which the relay
checks against a short list and passes to the laptop's copy alone, telling
the tablet whether it drew them. The PH226 iPad page's Drive button uses it,
to write on the projector with an Apple Pencil.

### The pill, the board, reactions and "Lost?"

- **The pill** says "Answer on your phone · 3 answers" while a poll is open.
  `PresenterConfig.pollPill`, or a poll's `data-pill`, changes it: `"icon"`
  (the phone icon alone), `"none"`, or your own text, in which `{n}` is the
  number of answers and `{answers}` is "3 answers". `pollPillPosition`, or
  `data-pill-position`, moves it: `bottom` (the default), `bottom-left`,
  `bottom-right`, `top`, `top-left` or `top-right`.
- **The board.** Each question on the tablet has a **Share** button. A shared
  question goes, without any name, to every phone ("Questions from the
  room"), where each phone may vote for it once, and to any
  `<div class="qa-board" data-top="5"></div>` on the laptop's slides, most
  votes first. **Answered** on the tablet takes it down. No question reaches
  the board unless you share it.
- **Reactions.** `PresenterConfig.reactions` (up to 8 emoji; none by default)
  puts reaction buttons at the foot of the ask page. Each tap floats up the
  right of the laptop's screen, and the tablet tallies the last minute's.
- **"Lost?"** A toggle on the phones (on unless `PresenterConfig.pace` is
  `false`): the tablet alone shows "Lost: 3 of 41", counted over the last two
  minutes, red from 15%.

### What is kept

The relay keeps, in memory only and for three hours: each phone's current
answer to each poll, under its random id; the questions you share, without
names, with their votes. Nothing is written to disk or logged. The laptop
receives answers under aliases, never the phones' ids, and a word cloud's
words only once shown. Questions themselves are still never kept.

### Styling

The charts take their colours from the reveal.js theme (its link, text and
background colours). To change them, set these on `.reveal` in your deck's
CSS: `--poll-accent` (bars and borders), `--poll-text`, `--poll-card` (the
overlay's card and the pill), `--poll-highlight` (right answers, winners,
marks) and `--poll-colour-1` to `--poll-colour-8` (word clouds, flows, grids).

### Libraries

The ask page's poll controls are [Web Awesome](https://webawesome.com) 3.14
components (free, MIT), and the laptop lays out word clouds with
[d3-cloud](https://github.com/jasondavies/d3-cloud) 1.2.9 (BSD-3), loaded only
by a deck with a word cloud. Both come from jsDelivr by default, at pinned
versions; `PresenterConfig.webAwesome` and `d3Cloud` point elsewhere, such as
copies on your own site.

## Settings

All in `presenter-config.js`, which is public: it holds no secret.
`tools/make-channel.js` writes `relay`, `channel`, `questionsKey` and, given
`--ask`, `askUrl`; the rest are optional, and
`client/presenter-config.example.js` describes each.

| Setting | What it does |
|---|---|
| `relay` | The relay's URL |
| `channel` | sha256 of the secret |
| `questionsKey` | sha256 of the tablet's key; turns on questions, polls and everything after them in this table |
| `askUrl` | The public address of `ask.html`, for the QR code |
| `qrStudio`, `qrOptions` | Where the QR library is loaded from, and its options |
| `reactions` | Up to 8 emoji for the ask page (a list, or a string separated by spaces); none by default |
| `pace` | `false` hides "Lost?" |
| `pollPill`, `pollPillPosition` | The pill's text and place (above) |
| `polls` | `false`: a `?master` deck loads no poll support |
| `pollsScript`, `pollsStyle` | Where `presenter-polls.js` and `.css` are loaded from (default: beside `presenter-master.js`) |
| `webAwesome` | Web Awesome's `dist-cdn` directory (default: 3.14.0 on jsDelivr) |
| `d3Cloud` | d3-cloud's `d3.layout.cloud.js` (default: 1.2.9 on jsDelivr) |
| `heartbeatMs` | How often the laptop re-broadcasts its position (3000) |
| `hideInFrames` | Selectors hidden in the tablet's copies of the deck |
| `deckUrl` | Maps the path a deck announces to the URL the tablet loads |
| `deck` | The Reveal instance, for an ES-module setup with no global `Reveal` |

## The secret

`sha256(secret) = channel id`. The channel id is public: it sits in
`presenter-config.js`, and anyone who knows it can *watch* the channel, which
reveals nothing that isn't on the projector anyway. Only someone holding the
secret can *broadcast*, and all a broadcast can do is move what your tablet
shows.

The secret travels in the laptop's URL (`?master=<secret>`), so it lives in
that browser's bookmarks and history and nowhere else. A templated site can
instead inject it server-side, as `window.PresenterConfig.secret`, and only when
`?master` is present. That variant is described in `CLAUDE.md`.

## Running the relay

`server/relay.js` runs on Socket.IO 4. It speaks the reveal/multiplex
protocol, with three differences:

- **It serves no files.** reveal/multiplex's `index.js` also serves its own
  directory as static files, which publishes anything kept there, including
  secrets and `.git/`.
- **It remembers each channel's last position.** A tablet that wakes up or
  reconnects catches up immediately, instead of waiting up to 3 s for the next
  heartbeat.
- **It carries audience questions and polls** (above), with the board,
  reactions and "Lost?". These need this relay; an unmodified
  reveal/multiplex server simply ignores them.

```
cd server && npm install && node relay.js     # PORT=1948, HOST=127.0.0.1 by default
```

`server/deploy/` has a systemd unit and an nginx site (TLS plus the WebSocket
upgrade) for putting it on a small VPS.

## Testing

```
npm install                      # puppeteer and jsqr, for the tests
npm --prefix server install      # socket.io, for the relay
node tools/e2e-test.js           # the presenter view and questions
node tools/polls-test.js         # polls, through the pages
node tools/relay-test.js         # the relay's later events, at the socket level
node tools/driver-test.js        # the tablet driving the laptop's deck, at the socket level
```

Each test starts the relay and, but for `relay-test.js`, a local web server.
They need the internet, for reveal.js, Web Awesome and d3-cloud from jsDelivr.

`e2e-test.js` drives a "laptop" and a "tablet" through the demo deck in
landscape and portrait, and checks:
- the current slide and the next slide or fragment;
- notes from both `aside.notes` and `data-notes`;
- the blank-screen badge and the end-of-deck message;
- that a late-joining tablet catches up;
- that a deck without `?master` never contacts the relay;
- that the relay ignores a wrong secret;
- for audience questions:
  - the code appears only on the laptop;
  - so does the QR code, which decodes (with jsQR) to the ask page with the
    day's code, and which pre-fills the code when followed;
  - wrong keys and wrong codes are refused;
  - a question arrives verbatim, with injected HTML shown as plain text;
  - a page without the key overhears nothing;
  - rate limiting works;
  - an absent tablet is reported to the student;
  - the relay never logs question text.
- and, at the socket level, the relay's side of polls.

`polls-test.js` drives the demo deck on a laptop with `?master`, the tablet,
and three phones on the ask page, each in a browser of its own, through the
*Live polls* slides. It checks:
- that the deck without `?master` loads no poll code, contacts no relay and
  draws nothing, before and after the polls run;
- that each poll opens on the phones, in place of the question form, and
  closes when its slide is left;
- that answers reach the laptop's charts (bars, columns with median and mean,
  the voting rules, the beauty contest, before and after) and the tablet's
  count;
- that the overlay is a step only on the laptop, and the tablet is sent the
  position without it;
- that a word cloud's words wait for the tablet, and reach the laptop's cloud
  once shown;
- the board (share, vote, take down), reactions and "Lost?";
- that no page logs an error.

`relay-test.js` checks the relay's later events directly: the wide number
poll, the self-others, points, grid and pin polls, the tablet's poll counts,
the word filter, the board, reactions and the pace signal.
Environment variables:
- `RELAY_URL` tests against an existing relay.
- `REVEAL_VERSION` swaps the reveal.js version.
- `PUPPETEER_PATH` points at a puppeteer install, if `require('puppeteer')`
  fails. Clicks and screenshots need a headless Chrome that renders frames;
  if they hang while the page itself is fine (seen once with Chrome 148),
  try another build this way.
- `SCREENSHOTS=<dir>` saves what the tablet showed (with `polls-test.js`,
  also the laptop's charts and a phone).

`e2e-test.js` passes in these setups:

| Relay | reveal.js |
|---|---|
| `server/relay.js` | 5.2.1 |
| `server/relay.js` | 6.0.2 |
| An unmodified reveal/multiplex server (Socket.IO 2.5) | 5.2.1 |

`polls-test.js` passes with `server/relay.js` and reveal.js 5.2.1 and 6.0.2;
an unmodified reveal/multiplex server has no polls.

With the unmodified server, a late-joining tablet catches up within one
heartbeat (0.7–2.8 s) instead of at once. The test has been checked against a
reintroduction of the scroll-view bug described in `CLAUDE.md`, and catches it.

`docs/demo.gif` is made by `node tools/make-demo-gif.js`, which drives the same
setup and needs ImageMagick 7. Remake it after changing how the presenter view
or the demo deck looks.

## Limitations

- **One-way.** The tablet follows the laptop; it can't advance the slides.
  Use a clicker or the keyboard.
- **Position only.** Chalkboard drawings, video playback, and anything typed
  or clicked inside a slide are not mirrored. The tablet's copies are muted
  and non-interactive.
- **Same origin.** The presenter page must be served from the same site as the
  decks, and each deck must expose `window.Reveal`.
- **A second load.** The tablet loads each deck twice, which is noticeable for
  very heavy decks on older tablets.
- **Tested with reveal.js 5 and 6.** reveal.js 4 has the same API and should
  work, but hasn't been tested.
- **Polls draw only on the laptop.** An inline chart is an empty space in the
  published deck and on the tablet. Polls need audience questions on, since
  phones join with the day's code.

## Files

| Path | What it is |
|---|---|
| `client/presenter-master.js` | Laptop side: inert unless `?master=<secret>` |
| `client/presenter-polls.js`, `presenter-polls.css` | Laptop side of polls, the board and reactions; loaded by `presenter-master.js` only with `?master` |
| `client/presenter.html` | Tablet side: the presenter view, incoming questions, word approval, poll counts, the board, "Lost?" and reactions |
| `client/ask.html` | The audience's page: questions, live polls, the board, reactions and "Lost?" |
| `client/presenter-config.example.js` | The shared, public settings: relay URL, channel id, options |
| `server/relay.js` | The relay, plus `deploy/` for systemd and nginx |
| `tools/make-channel.js` | Makes a secret and its channel id |
| `client/vendor/qr-studio.js` | QR Studio, vendored, for the laptop's QR code |
| `tools/e2e-test.js` | End-to-end test (puppeteer) |
| `tools/polls-test.js` | Polls end to end: laptop, tablet and three phones |
| `tools/relay-test.js` | The relay's later events at the socket level: the wider poll kinds, the word filter, the board, reactions, the pace signal |
| `tools/make-demo-gif.js` | Makes `docs/demo.gif` |
| `example/index.html` | A demo deck; its presenter-specific lines are two `<script>` tags, the question code and QR slide, and empty elements for the polls, their charts and the board |
| `CLAUDE.md` | Integration playbook for a Claude Code agent |
