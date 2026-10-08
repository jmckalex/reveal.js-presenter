# Vendored: qr-studio

`qr-studio.js` is `dist/qr-studio.mjs` from **qr-studio v1.1.0** (MIT, © 2026
J. McKenzie Alexander), copied unmodified so the client needs no build step or
CDN. `presenter-master.js` loads it, on the laptop only, to draw the QR code
for the ask page (`.question-qr` elements).

Do not edit it. To update, rebuild qr-studio and copy its `dist/qr-studio.mjs`
over this file. A site that already serves qr-studio can point
`PresenterConfig.qrStudio` at its own copy instead.
