# Vendored

## qr-studio

`qr-studio.js` is `dist/qr-studio.mjs` from **qr-studio v1.1.0** (MIT, © 2026
J. McKenzie Alexander), copied unmodified so the client needs no build step or
CDN. `presenter-master.js` loads it, on the laptop (and in the tablet's
mirroring copies) only, to draw the QR code for the ask page (`.question-qr`
elements).

Do not edit it. To update, rebuild qr-studio and copy its `dist/qr-studio.mjs`
over this file. A site that already serves qr-studio can point
`PresenterConfig.qrStudio` at its own copy instead.

## chalkboard

`chalkboard/` is Asvin Goel's chalkboard plugin for reveal.js, **version
2.3.3** from [rajgoel/reveal.js-plugins](https://github.com/rajgoel/reveal.js-plugins)
(MIT, `chalkboard/LICENSE`), **changed** on 22 October 2026 for the presenter:
writing belongs to a slide rather than each fragment step; the chalkboard
scrolls down without end; it can be a whiteboard, with or without its grid;
every chalkboard of a deck can be saved as one PDF; and a following copy can
be given a slide's drawings (`slideDrawings()`, `setSlideDrawings()`,
`slideTime()`, `boardOpen()`). `chalkboard/README.md` describes each change.
Drive and the laptop's ink on the tablet need this copy, not the upstream one.

It is a copy of the plugin in jmckalex.org's `prez/libs/v2026` bundle
(`reveal.js-v5.2/plugin/chalkboard`), where it is maintained; copy that
directory over this one to update. `tools/chalkboard-test.js` tests it.
