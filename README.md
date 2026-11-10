# reveal.js-presenter

A presenter view for [reveal.js](https://revealjs.com) on a second device. Prop
an iPad on the lectern (or hold a phone), and it shows:

- the current slide, exactly as the audience sees it: fragments, the deck's
  own controls, and (with audience questions on) whatever is written on it,
  the QR code and the poll charts the laptop draws;
- the next slide, or the next fragment, so you know what your click will reveal;
- your speaker notes (`<aside class="notes">` or `data-notes`), resizable;
- a clock and a timer; and the overview or a blanked screen as the laptop has
  them, with a badge.

reveal.js's own speaker view (the `S` key) opens a popup tied to the laptop's
browser, so it can't move to another device. This can, and it works when you
are nowhere near the laptop. Optionally, the audience can send questions to it
from their phones, by scanning a QR code on a slide, and answer live polls,
whose results the laptop draws on the slides. With the chalkboard plugin in
`client/vendor/chalkboard`, the tablet's **Drive** button also makes it the
laptop's pen: an Apple Pencil writes on the projected slide, or on a
chalkboard that scrolls down without end, and ◀ ▶ step through the talk.

![The laptop deck and the tablet's presenter view side by side, as the laptop steps through the demo deck and a student's question arrives on the tablet](docs/demo.gif)

## Try it on one computer

Five minutes, with Node 18 or later. (Without git, GitHub's **Code →
Download ZIP** gives the same files; unzip them and start at the `npm` line.)

```
git clone https://github.com/jmckalex/reveal.js-presenter.git
cd reveal.js-presenter
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
  iframes (as `deck.html?presenter`): one for the current slide and one for
  the next. It moves both to follow the laptop, through each copy's `Reveal`
  object. With audience questions on, each copy also runs the laptop's script
  as a *mirror*, drawing what the laptop draws (the QR code, the poll pill,
  the charts) from what the tablet hands it, and the current copy shows what
  is written on the laptop's slide as it is written.

The two devices never connect to each other, only to the relay. So they need
internet access, but not the same network. That matters because conference
and university WiFi (eduroam, for instance) usually blocks devices on it from
reaching each other directly.

A deck opened *without* `?master` is untouched. The script returns
immediately, and the deck never contacts the relay. So your published decks
behave exactly as before, for you and for everyone else. The tablet's own
copies (`?presenter`) never contact the relay either: the tablet page does
that for them.

## Using it with Claude Code

Open Claude Code in the project that holds your presentations and say
something like:

> Add the presenter view from ~/reveal.js-presenter to my decks.

(using wherever you cloned this project).

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
   `presenter-polls.css`, `presenter-mirror.js` and `vendor/` (the QR code) to
   the same directory; for Drive and the laptop's writing on the tablet, also
   `presenter-drive.js`, `presenter-driver.js` and `presenter-ink.js`.
4. **Add two lines to every deck**, or once to a shared template, anywhere
   after reveal.js is loaded:
   ```html
   <script src="/presenter/presenter-config.js"></script>
   <script src="/presenter/presenter-master.js"></script>
   ```
   The deck must expose `window.Reveal`. The standard `dist/reveal.js` script
   does this. With ES modules, add `window.Reveal = deck` after creating it.
   For Drive, the deck also loads the chalkboard plugin from
   `vendor/chalkboard` (its `style.css` and `plugin.js`, with `RevealChalkboard`
   among its plugins; `example/index.html` shows how). It must be this copy:
   rajgoel's plugin, changed so that writing belongs to a slide and a following
   copy can be given a slide's drawings.
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
first, or the slides won't line up. The laptop sends its slide count with its
position, and a tablet whose copy has another count shows a red strip across
the slide and "Following, but the copies differ". If the laptop serves decks
under different paths from the site, set `deckUrl` in `presenter-config.js` to
map one onto the other.

Two buttons on the tablet each take two taps within four seconds ("Tap
again"): **Reset**, in the questions' header, starts the talk again from a
clean state after a rehearsal (see [What a chart can add](#what-a-chart-can-add));
**Reload** fetches again every file of the site that the page and its two
copies have loaded, bypassing the browser's cache, and reloads the page. A
Home Screen web app has no reload button, and a server that lets browsers keep
files for days would otherwise leave it running an old deck. The key survives,
and the timer carries over (Start becomes Resume).

## Audience questions

Students can send questions straight to the tablet, from their phones:

1. The **laptop** deck shows a 4-digit code on a slide: put
   `<question-code></question-code>` (or `<span class="question-code">····</span>`)
   wherever you want it. Only the laptop's copy knows the code, because it is
   derived from the secret, and it changes daily. Everyone else, including the
   published deck, sees nothing (or the dots). A deck may instead fix its own
   code, the same every time, with `code="1234"` on its `<question-qr>`
   (below); that code is then visible in the deck's source.
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

**The QR code.** Put `<question-qr></question-qr>` (or
`<div class="question-qr"></div>`) on the slide, and give `make-channel.js`
the public address of `ask.html` with `--ask` (it becomes `askUrl` in the
config). The laptop's copy then draws a QR code for `ask.html?code=<the code>`
into the element, captioned "Ask a question"; the tablet's copies draw it too,
and every other copy leaves it empty. Size the element with CSS; the code
fills its width. It always points at `askUrl`, never at the deck's own
address, so it works when you present from `localhost`. On the element:

- `code="1234"` fixes the deck's code, as above;
- `short-url="example.org/ask"` captions the code with a short link that
  carries the code (one you have made at a link shortener), for students who
  would rather type than scan; it needs a `code`;
- `text="…"` sets the caption otherwise (`text=""` for none), and `text-size`
  its size, in the code's units (1000 wide, default 80) or as a percentage of
  that (`"150%"`); a caption too long for the code's width is set smaller.

The drawing is done by the vendored [QR Studio](client/vendor/README.md);
`qrOptions` in the config is passed to it, e.g.
`{ moduleStyle: 'rounded', foreground: '#604e25' }` (a `foreground` colours
the caption too). Its default background is transparent, so test a busy slide
background with a phone in the room.

`body.question-qr-hidden` hides every QR code. A deck with a customcontrols
toolbar gets a button on it for that (`questionButton`, in
[Settings](#settings)), so the codes needn't be forgotten in the rush before
a talk; the tablet shows the codes hidden or shown as the laptop has them.

## Live polls

With questions on, a deck can also ask the audience things, and show the
answers on the slides as they arrive. A poll is an empty element on a slide:

```html
<live-poll name="sleep" kind="number" min="0" max="12" unit="hr|hrs"
           prompt="How many hours did you sleep last night?"></live-poll>
<poll-results poll="sleep"></poll-results>
```

or, in the older markup, which still works:

```html
<div class="poll" data-poll="sleep" data-kind="number" data-min="0" data-max="12"
     data-unit="hr|hrs" data-prompt="How many hours did you sleep last night?"></div>
<div class="poll-results" data-poll="sleep"></div>
```

The laptop's script turns each custom element into the older markup before
anything else uses it: `<live-poll>` becomes `.poll`, `<poll-results>`
`.poll-results`, `<qa-board>` `.qa-board`, and each attribute its `data-`
form, a `<live-poll>`'s `name` becoming `data-poll` and a `<poll-results>`'s
`overlay` a class. The tables below give the attributes in their `data-` form.
**Always write the closing tag:** `<live-poll … />` does not end the element,
which then swallows the rest of the slide (the laptop warns in the console).

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
  on the laptop and in the tablet's copies (which mirror it); the position is
  sent without it, with the laptop's own index besides, so every copy stays
  in line.
- Each phone answers once and may change its answer while the poll is open.
  It is counted by a random id kept in its own storage. Poll answers carry no
  name.
- **Only the laptop's copy, and the tablet's copies of it, draw anything.**
  The tablet's copies draw exactly what the laptop does, from the tallies the
  relay sends the tablet with its key. Opened any other way, a deck's `.poll`
  and `.poll-results` stay empty, so an inline chart leaves an empty space
  (and an empty step, if it is a fragment) in the published copy. Overlays
  leave nothing.

### The kinds of poll

Lists are separated by `|`. Every poll takes `data-poll` (its id: letters,
digits, `-` and `_`), `data-prompt` and, optionally, `data-instructions`, a
line shown on the phones under the "Live poll" title (otherwise a default for
the kind).

| `data-kind` | Attributes | The phone | The chart |
|---|---|---|---|
| `choice` (the default) | `data-options` (2–12); `data-picks="2"`, or `"all"`, for several; with picks, `data-exclusive="None of them"` (an option's text) for one that stands alone, `"all"` then meaning all the others | buttons; with picks, ticks and Send, ticking the exclusive option unticking the rest, and the reverse | a bar per option |
| `number` | `data-min`, `data-max` (whole numbers, up to a million apart), `data-unit` (`"%"`, or a singular and plural, `"hr\|hrs"`) | a button per value, up to 13 values; a slider, up to 101; else a field to type in | a column per value, or per range of values, with the median and mean |
| `scale` | `data-statements` (1–12), `data-min` (1), `data-max` (5), `data-labels="Disagree\|Agree"` | stars per statement when `min` is 1, else a row of numbers | a bar per statement divided by rating, with its mean |
| `premises` | `data-statements` (2–12, the conclusion last, or `data-conclusion="n"`, from 1), `data-labels` (`Accept\|Reject`) | accept or reject each | how many accept each, against the halfway line; it flags the discursive dilemma |
| `ranking` | `data-options` (2–10) | tap the options in order | the options by average position |
| `words` | `data-entries` (1–5 per phone), `data-moderate="on"`, `data-filter="off"`, `data-vertical` (the share of words on end, 0–1, default 0.5), `data-colours="shades"` | type words, each a tag (a space, comma, semicolon or return ends one, so a phrase becomes separate words) | a word cloud of the words shown |
| `self-others` | `data-options` (`Yes\|No`), `data-target` (from 1), `data-others` (the second question) | your own answer, then a guess at the room's percentage | the share who gave the target answer, against the room's guesses |
| `points` | `data-options` (2–10), `data-total` (100), `data-unit` | a slider per option, each stopping where the total would be passed; Send once they add up | each option's average, and each answer as a dot |
| `grid` | `data-items` (1–8), `data-x="Slow\|Fast"`, `data-y="Shallow\|Deep"`, `data-min`, `data-max` (0, 10) | a square per item to tap | each item's average place as a numbered disc, and each answer as a dot, in hues far apart (two items may land side by side) |
| `pin` | `data-image`, `data-alt` | tap the picture | a heat map over the picture |

**A word cloud's words go up at once, but for any the filter catches.** They
are free text from the audience, so every word also appears on the tablet,
where a tap hides it from the screen (or shows it again). The relay's word
filter (swear words and slurs, also spelt "sh1t" or "f u c k") holds any word
it catches for the tablet, flagged ⚑; it only holds a word, never refuses it,
so a false alarm costs one tap. With `data-moderate="on"` every word waits for
the tablet, where you tap it (or "Show all new") to put it on the screen; the
laptop never receives a word that hasn't been shown. The cloud is laid out by
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
| `data-before="<poll>"` | any | before and after: see below; `data-headings="Harm\|Help"` names the two sides in place of "Before" and "After" |
| `data-share="Yes"` | choice, in versions | a column per version: the share of its phones choosing that option (the first by default), and how many were dealt it |
| `data-reference="82\|23"` | choice, in versions | a dashed mark per version for a published figure, labelled `data-reference-label` |

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

**Versions.** A single-pick choice poll may come in two to four versions: an
experiment in which each phone sees one version and the versions' answers are
compared, as Knobe ran his two stories of the chairman. Give the `<live-poll>`
a `<template>` per version, each with `data-version` (a name, for the laptop
and the tablet only), `data-prompt` (its question) and the story as its
content (plain text, up to 1200 characters):

```html
<live-poll name="chairman" options="Yes|No" instructions="Read the story, then answer.">
  <template data-version="Harm" data-prompt="Did the chairman harm the environment intentionally?">The vice-president …</template>
  <template data-version="Help" data-prompt="Did the chairman help the environment intentionally?">The vice-president …</template>
</live-poll>
<poll-results poll="chairman" share="Yes" reference="82|23" reference-label="Knobe"></poll-results>
```

The relay deals the versions out in turn as each phone is first sent the poll
(those already joined, in the order they joined, then late arrivals), so each
is seen by as many phones as the others, give or take one. It keeps which
phone has which with the poll, so a reload brings back the same one, and sends
a phone only its own story and question, which the phone shows above the
options. The tablet's counts read "Harm: Yes 12 · Harm: No 3 · …", and the
chart has a column per version. The screen can't show either story while the
poll is open, so its slide should be neutral.

**Reset.** The tablet's **Reset** starts the talk again from a clean state
(after a rehearsal, say): the relay forgets that channel's polls, their
answers and the versions it dealt, the board and "Lost?", and opens again,
empty, any poll open at the time. The laptop's charts and pill go back to
empty, and the tablet clears its screen. Each poll the phones are sent
carries a `round`, new whenever the relay has forgotten the poll's answers (a
reset or a restart), so a phone remembers its answer by poll and round and
never shows one the relay no longer has.

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
  `<qa-board top="5"></qa-board>` on the laptop's slides, most votes first. **Answered** on the tablet takes it down. No question reaches
  the board unless you share it.
- **Reactions.** `PresenterConfig.reactions` (up to 8 emoji; none by default)
  puts reaction buttons at the foot of the ask page. Each tap floats up the
  right of the laptop's screen, and the tablet tallies the last minute's.
- **"Lost?"** A toggle on the phones (off unless `PresenterConfig.pace` is
  `true`): the tablet alone shows "Lost: 3 of 41", counted over the last two
  minutes, red from 15%.

### What is kept

The relay keeps, in memory only and for three hours: each phone's current
answer to each poll, under its random id (and, for a poll in versions, which
version it was dealt); the questions you share, without names, with their
votes. The tablet's Reset forgets all of it for its channel at once. Nothing is written to disk or logged. The laptop
receives answers under aliases, never the phones' ids, and a word cloud's
words only once shown. Questions themselves are still never kept.

### Styling

The charts take their colours from the reveal.js theme (its link, text and
background colours). To change them, set these on `.reveal` in your deck's
CSS: `--poll-accent` (bars and borders), `--poll-text`, `--poll-card` (the
overlay's card and the pill), `--poll-highlight` (right answers, winners,
marks) and `--poll-colour-1` to `--poll-colour-8` (word clouds, flows,
versions). A grid's items take hues of their own, much further apart, since
any two may land side by side: `--poll-grid-colour-1` to `-8`, with
`--poll-grid-ink-1` to `-8` for the number drawn on each.

### Libraries

The ask page's poll controls are [Web Awesome](https://webawesome.com) 3.14
components (free, MIT), and the laptop lays out word clouds with
[d3-cloud](https://github.com/jasondavies/d3-cloud) 1.2.9 (BSD-3), loaded only
by a deck with a word cloud. Both come from jsDelivr by default, at pinned
versions; `PresenterConfig.webAwesome` and `d3Cloud` point elsewhere, such as
copies on your own site.

## Drive, and the laptop's writing on the tablet

With questions on, and the chalkboard plugin from `client/vendor/chalkboard`
in the deck, the tablet's **Drive** button makes it the laptop's pen:

- The current slide fills the screen, with a row of tools under it: the pen
  (writing on the slide) or the board (the plugin's chalkboard, which a finger
  drags up and down, a flick carrying it on), the deck's colours, an eraser,
  Clear, and ◀ ▶.
- An Apple Pencil writes; once it has touched the screen, only the Pencil
  writes, so a resting palm never does (a finger writes before that). Each
  stroke is drawn at once on the tablet's copy and sent through the relay to
  the laptop, which hands it to the plugin as one of the plugin's own
  messages, so it behaves exactly as writing done there: it belongs to its
  slide, stays through its fragments, goes with the next slide and is back on
  returning.
- The copy's own controls work in Drive (only a tap: a palm presses nothing):
  reveal's arrows, the toolbar, the question button, and in the overview a
  tap on a slide goes there. The board opened or closed on the laptop itself
  switches Drive between Board and Pen.
- A batch of strokes goes once the one before is answered and is sent again
  until it is; one made on a slide the laptop has since left is not drawn
  there. The plugin clears a slide 100 ms after arriving on it (its
  `transition`), so writing begun then waits that long.

Without the plugin in the deck, Drive still steps through the talk, and says
why it has no pen.

The other way, whether or not you are driving, the tablet's current slide
shows what is written on the laptop: each stroke as it is drawn there (`ink`),
and the slide's drawings so far (`ink-slide`, in parts) whenever the tablet
arrives on a slide, loads or reconnects, or the laptop's page does. The
chalkboard, open or closed, scrolled, as a whiteboard or without its grid,
follows the laptop too, and so does the pen's palette.

The chalkboard plugin is rajgoel's, changed for this (its
[README](client/vendor/chalkboard/README.md) says how): writing belongs to a
slide rather than each fragment step (`perFragment: true` for the old way);
the chalkboard scrolls down without end; `W` makes it a whiteboard and `R`
hides its grid; `E` saves every chalkboard of the talk as one PDF; and a
following copy can be given a slide's drawings (`slideDrawings()`,
`setSlideDrawings()`, `slideTime()`, `boardOpen()`).

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
| `pace` | `true` adds "Lost?" (off by default) |
| `pollPill`, `pollPillPosition` | The pill's text and place (above) |
| `polls` | `false`: a `?master` deck loads no poll support |
| `pollsScript`, `pollsStyle` | Where `presenter-polls.js` and `.css` are loaded from (default: beside `presenter-master.js`) |
| `drive` | `false`: a `?master` deck loads no Drive or ink support |
| `driveScript` | Where `presenter-drive.js` is loaded from (default: beside `presenter-master.js`) |
| `questionButton`, `questionButtonIcon` | `false` leaves out the customcontrols button that hides and shows the QR codes; its icon, as HTML |
| `webAwesome` | Web Awesome's `dist-cdn` directory (default: 3.14.0 on jsDelivr) |
| `d3Cloud` | d3-cloud's `d3.layout.cloud.js` (default: 1.2.9 on jsDelivr) |
| `heartbeatMs` | How often the laptop re-broadcasts its position (3000) |
| `hideInFrames` | Selectors hidden in both the tablet's copies of the deck (default: the menu plugin's panel) |
| `hideInNext` | Selectors hidden in the next slide's copy alone (default: the menu's button, customcontrols, the chalkboard's handle and palettes) |
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
node tools/ink-test.js           # the laptop's ink, to the tablet, at the socket level
node tools/laptop-test.js        # the laptop's script: inert copies, the mirror, Drive's strokes
node tools/tablet-test.js        # the tablet page: copies, Drive, ink, Reset, Reload
node tools/drive-ink-test.js     # the tablet and the real laptop page, together
node tools/ask-test.js           # the ask page: versions, rounds, exclusive picks, points, words
node tools/chalkboard-test.js    # the chalkboard plugin's changes (no relay)
```

Each test but `chalkboard-test.js` starts the relay, and each but
`relay-test.js` a local web server. They need the internet, for reveal.js,
Font Awesome, Web Awesome and d3-cloud from CDNs.

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
- that the overlay is a step only on the laptop and the tablet's mirroring
  copies, and the position is sent without it, the laptop's own index besides;
- that a moderated word cloud's words wait for the tablet, and reach the
  laptop's cloud once shown;
- the board (share, vote, take down), reactions and "Lost?";
- that no page logs an error.

`relay-test.js` checks the relay's later events directly: the wide number
poll, the self-others, points, grid and pin polls, the tablet's poll counts,
the word filter, the board, reactions, the pace signal and an exclusive
option. `driver-test.js` and `ink-test.js` do the same for Drive and ink.

`laptop-test.js`, `tablet-test.js`, `drive-ink-test.js` and `ask-test.js` take
each side through what it gained on 10 November 2026 (see `CLAUDE.md`), the
tablet in landscape and portrait, a Pencil and a palm emulated with pointer
events; `chalkboard-test.js` writes, scrolls, saves and switches the
chalkboard with the mouse and keys, as the laptop's user would.

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

- **Driving needs questions on.** The tablet can advance the slides and write
  on them only in Drive, which needs the questions key (and, for writing, the
  vendored chalkboard plugin in the deck). Otherwise it follows the laptop; use
  a clicker or the keyboard.
- **The position, the writing and the charts.** The tablet's copies show the
  laptop's position, what is written with the chalkboard plugin, and what the
  presenter's own scripts draw. Video playback, other plugins' state, and
  anything typed or clicked inside a slide are not mirrored. The copies are
  muted, and take no taps outside Drive.
- **Same origin.** The presenter page must be served from the same site as the
  decks, and each deck must expose `window.Reveal`.
- **A second load.** The tablet loads each deck twice, which is noticeable for
  very heavy decks on older tablets.
- **Tested with reveal.js 5 and 6.** reveal.js 4 has the same API and should
  work, but hasn't been tested.
- **Polls draw only on the laptop and the tablet.** An inline chart is an
  empty space in the published deck. Polls need audience questions on, since
  phones join with the code.

## Files

| Path | What it is |
|---|---|
| `client/presenter-master.js` | Laptop side: inert unless `?master=<secret>`, or a mirror in the tablet's copies (`?presenter`) |
| `client/presenter-polls.js`, `presenter-polls.css` | Laptop side of polls, the board and reactions; loaded by `presenter-master.js` only with `?master`, or in a mirror |
| `client/presenter-drive.js` | Laptop side of Drive and ink: applies the tablet's strokes and steps, sends what is written; loaded only with `?master` |
| `client/presenter.html` | Tablet side: the presenter view, incoming questions, word approval, poll counts, the board, "Lost?", reactions, Reset and Reload |
| `client/presenter-driver.js`, `presenter-ink.js`, `presenter-mirror.js` | Tablet side of Drive, of the laptop's writing, and of what its copies draw as mirrors |
| `client/ask.html` | The audience's page: questions, live polls, the board, reactions and "Lost?" |
| `client/presenter-config.example.js` | The shared, public settings: relay URL, channel id, options |
| `server/relay.js` | The relay, plus `deploy/` for systemd and nginx |
| `tools/make-channel.js` | Makes a secret and its channel id |
| `client/vendor/qr-studio.js` | QR Studio, vendored, for the laptop's QR code |
| `client/vendor/chalkboard/` | rajgoel's chalkboard plugin (MIT), changed for Drive and ink; its README says how |
| `tools/e2e-test.js` | End-to-end test (puppeteer) |
| `tools/polls-test.js` | Polls end to end: laptop, tablet and three phones |
| `tools/relay-test.js` | The relay's later events at the socket level: the wider poll kinds, the word filter, the board, reactions, the pace signal |
| `tools/driver-test.js`, `ink-test.js` | Drive and ink at the socket level |
| `tools/laptop-test.js` | The laptop's script: inert copies, the mirror, the position's extra fields, Drive's strokes and steps |
| `tools/tablet-test.js` | The tablet page against a stand-in laptop: copies, Drive, ink, Reset, Reload, in both orientations |
| `tools/drive-ink-test.js` | The tablet and the real laptop page together: Drive, ink and the mirror |
| `tools/ask-test.js` | The ask page: versions, rounds, exclusive picks, points, words |
| `tools/chalkboard-test.js` | The chalkboard plugin's changes, with the mouse and keys |
| `tools/make-demo-gif.js` | Makes `docs/demo.gif` |
| `example/index.html` | A demo deck; its presenter-specific lines are two `<script>` tags (and the chalkboard plugin), the question code and QR slide, and empty elements for the polls, their charts and the board |
| `CLAUDE.md` | Integration playbook for a Claude Code agent |
