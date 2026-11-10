# Chalkboard

With this plugin you can add a chalkboard to reveal.js. The plugin provides two possibilities to include handwritten notes to your presentation:

- you can make notes directly on the slides, e.g. to comment on certain aspects,
- you can open a chalkboard or whiteboard on which you can make notes.

The main use case in mind when implementing the plugin is classroom usage in which you may want to explain some course content and quickly need to make some notes.

The plugin records all drawings made so that they can be play backed using the `autoSlide` feature or the `audio-slideshow` plugin.


[Check out the demo](https://rajgoel.github.io/reveal.js-demos/?topic=chalkboard)

## Changed here (2026-10-22)

This copy (version 2.3.3, in `libs/v2026`) differs from the original in seven ways:

- **Drawings belong to a slide**, not to each fragment step: ink stays as a slide's fragments appear (and as they are hidden again), and goes with the slide. The original kept a separate drawing for each step, so that writing vanished at the next click. `perFragment: true` restores that. An open chalkboard still closes at a step, so that the step can be seen.
- **The chalkboard scrolls down without end**, for a derivation that needs more room: with a trackpad or mouse wheel, the ↑ and ↓ keys while it is open (a quarter of a screen; ↓ no longer moves to a vertical slide then), and ↑ ↓ on its handle at the right (half a screen). Its grid and texture move with the writing. Drawings keep their place in the slide's units, a `y` beyond the slide's height being further down the board; where the board is scrolled to is recorded among them as a `scroll` event (`{ type: 'scroll', y }`, also a broadcast message), so that it is restored on returning to the slide and followed by a multiplexed copy. Clear takes the board back to the top. `RevealChalkboard.scrollBoard(y)` scrolls it, gliding there (`scrollBoard(y, false)`: at once, as a dragging finger needs); `RevealChalkboard.boardScroll()` says where it is (or is going). A `scroll` message received glides to a far place and jumps to a near one, so that a copy follows a board being dragged elsewhere. The board's texture is a layer of its own (`.chalkboard-texture`), a tile taller than the board, which slides as the board scrolls: moved by the GPU alone, it keeps up with the writing and costs nothing, where a scrolled background would be painted again at every step (and reveal's `.r-overlay` class, which the board has, eased every change over 0.3 s, so the board limits that to its fading in and out). A scroll step copies the canvas onto itself once and draws only the strip coming into view. And with no `storage`, the plugin no longer writes every drawing out as text after each change.
- **Save as PDF**: `E`, the PDF button on the chalkboard's handle, or `RevealChalkboard.exportPDF()` saves every chalkboard drawn in the presentation as one PDF, in the order of the slides. Each screenful of a board is a page (pictures of the board, at `exportScale` times the slide's size), breaking where there is a gap between lines of writing if there is one in a page's last 30%. A board cleared part-way gives a sheet for what was on it before. Each page is labelled with its slide, the slide's heading and its page number. The pen's writing on slides is not included. `exportPDF({ download: false })` returns the PDF as a Blob (or `null`, if nothing has been drawn) instead of saving it. The PDF is written by the plugin itself; no library is needed.
- **A chalkboard or a whiteboard**: `W`, or the half-shaded button on the board's handle, switches the board between the deck's own theme and the other (`RevealChalkboard.toggleTheme()`, `setTheme('whiteboard')`, `theme()`): its texture, its grid and its pens, chalk or board markers, matched by number (so that white chalk is black ink, and blue, red, green and the rest are themselves), with what is drawn on it drawn again in them. The whiteboard is white (one white pixel, as a data: URL: the plugin's `whiteboard.png` is grey); its markers are the deck's `boardmarkers` but black for the first (the deck's first is a grey, for its pen on slides), and 5 pixels wide (as thick as the chalk looks), not the slide pen's 3. The palette's colours have a faint light edge, so that a black one shows on its black. The choice is remembered in the browser (`localStorage`, `reveal-chalkboard-theme`) and sent to anyone following (`{ type: 'theme', theme }`); a whiteboard saves as white pages. The board's palette now shows the board's own pens (the original always showed the chalks).
- **The grid shown or hidden**: `R`, or the button on the board's handle (a grid of four squares), hides the board's grid or shows it again, whichever the board is (`RevealChalkboard.toggleGrid()`, `setGrid(false)`, `gridShown()`), on the screen and in a saved PDF; remembered in the browser (`reveal-chalkboard-grid`) and sent to anyone following (`{ type: 'grid', grid }`).
- **The chalk's grain is repeatable**: random, but drawn from a sequence seeded by each stroke's coordinates, so that a stroke drawn again (as a scrolled board is, and a saved page) looks exactly as it did. And drawings are kept in the slide's units from the start; the original kept them in the window's pixels until the window first resized, so that they moved when it did.
- **A copy elsewhere can show what this one does** (the presenter's iPad): `RevealChalkboard.slideDrawings()` gives the slide shown, its drawings so far on both canvases (the events as kept, and each canvas's duration) and whether the chalkboard is open (`mode`); `setSlideDrawings(drawings)`, in the other copy, puts them in place of its own for that slide, and draws them if it is the slide shown there. Each thing drawn after it is announced as before (`'broadcast'`). `slideTime()` is the time on the slide's clock, by which its drawings are kept in order: a message handed to a copy (`'received'`) with it as its `timestamp` is kept as one drawn there at that moment, after everything before it (any other timestamp resets the clock to it). `boardOpen()` says whether the chalkboard is open.

The original's print-mode PDF (below) still shows only the first screen of a scrolled chalkboard. These changes are tested by `tests/chalkboard-e2e.js` and `tests/mirror-e2e.js` in `prez/teaching/ph226-426`.

## Setup

To use the plugin include
```html
<!-- Font awesome is required for the chalkboard plugin -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<!-- Custom controls plugin is used to for opening and closing annotation modes. -->
<script src="https://cdn.jsdelivr.net/npm/reveal.js-plugins@latest/customcontrols/plugin.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js-plugins@latest/customcontrols/style.css">
<!-- Chalkboard plugin -->
<script src="https://cdn.jsdelivr.net/npm/reveal.js-plugins@latest/chalkboard/plugin.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js-plugins@latest/chalkboard/style.css">
```
to the header of your presentation and configure reveal.js and the plugin by

```js
Reveal.initialize({
  customcontrols: {
    controls: [
      { icon: '<i class="fa fa-pen-square"></i>',
        title: 'Toggle chalkboard (B)',
        action: 'RevealChalkboard.toggleChalkboard();'
      },
      { icon: '<i class="fa fa-pen"></i>',
        title: 'Toggle notes canvas (C)',
        action: 'RevealChalkboard.toggleNotesCanvas();'
      }
    ]
  },
  chalkboard: {
    // add configuration here
  },
  // ...
  plugins: [ RevealChalkboard, RevealCustomControls ],
  // ...
});
```

In order to include buttons for opening and closing the notes canvas or the chalkboard you should make sure that `font-awesome` is available. The easiest way is to include
```
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js-plugins/menu/font-awesome/css/fontawesome.css">
```
to the ```head``` section of you HTML-file.

## Usage

### Mouse or touch
- Click on the pen symbols at the bottom left to toggle the notes canvas or chalkboard
- Click on the color picker at the left to change the color (the color picker is only visible if the notes canvas or chalkboard is active)
- Click on the up/down arrows on the left to the switch among multiple chalkboardd (the up/down arrows are only available for the chlakboard)
- Click the left mouse button and drag to write on notes canvas or chalkboard
- Click the right mouse button and drag to wipe away previous drawings
- Touch and move to write on notes canvas or chalkboard

### Keyboard
- Press the 'BACKSPACE' key to delete all chalkboard drawings
- Press the 'DEL' key to clear the notes canvas or chalkboard
- Press the 'c' key to toggle the notes canvas
- Press the 'b' key to toggle the chalkboard
- Press the 'd' key to download drawings
- Press the 'e' key to save the chalkboards as a PDF (changed here)
- Press the 'w' key to make the chalkboard a whiteboard, or a whiteboard a chalkboard (changed here)
- Press the 'r' key to hide or show the chalkboard's grid (changed here)
- Press '↑' or '↓' to scroll the chalkboard, while it is open (changed here)
- Press the 'x' key to cycle colors forward
- Press the 'y' key to cycle colors backward

## Playback

If the `autoSlide` feature is set or if the `audio-slideshow` plugin is used, pre-recorded chalkboard drawings can be played. The slideshow plays back the user interaction with the chalkboard in the same way as it was conducted when recording the data.

## Multiplexing

The plugin supports multiplexing via the [`multiplex` plugin](https://github.com/reveal/multiplex) or the [`seminar` plugin](https://github.com/rajgoel/reveal.js-plugins/tree/master/seminar).

## PDF-Export

If the slideshow is opened in [print mode](https://revealjs.com/pdf-export/), the chalkboard drawings in the session storage (see `storage` option - print version must be opened in the same tab or window as the original slideshow) or provided in a file (see `src` option) are included in the PDF-file. Each drawing on the chalkboard is added after the slide that was shown when opening the chalkboard. Drawings on the notes canvas are not included in the PDF-file.


## Configuration

The plugin has several configuration options:

- ```boardmarkerWidth```: an integer, the drawing width of the boardmarker; larger values draw thicker lines.
- ```chalkWidth```: an integer, the drawing width of the chalk; larger values draw thicker lines.
- ```chalkEffect```: a float in the range ```[0.0, 1.0]```, the intesity of the chalk effect on the chalk board. Full effect (default) ```1.0```, no effect ```0.0```.
- ```storage```: Optional variable name for session storage of drawings.
- ```src```: Optional filename for pre-recorded drawings.
- ```readOnly```: Configuation option allowing to prevent changes to existing drawings. If set to ```true``` no changes can be made, if set to ```false``` changes can be made, if unset or set to ```undefined``` no changes to the drawings can be made after returning to a slide or fragment for which drawings had been recorded before. In any case the recorded drawings for a slide or fragment can be cleared by pressing the 'DEL' key (i.e. by using the ```RevealChalkboard.clear()``` function).
- ```transition```: Gives the duration (in milliseconds) of the transition for a slide change, so that the notes canvas is drawn after the transition is completed.
- ```theme```: Can be set to either ```"chalkboard"``` or ```"whiteboard"```.
- ```perFragment```: ```true``` keeps a separate drawing for each fragment step, as the original plugin did; by default (here) a drawing belongs to its slide.
- ```exportScale```: the size of a page saved as a PDF, in pixels per unit of the slide (default ```2```: 2048 by 1152 for a 1024 by 576 slide).

The following configuration options allow to change the appearance of the notes canvas and the chalkboard. All of these options require two values, the first gives the value for the notes canvas, the second for the chalkboard.

- ```background```: The first value expects a (semi-)transparent color which is used to provide visual feedback that the notes canvas is enabled, the second value expects a filename to a background image for the chalkboard.
- ```grid```: By default whiteboard and chalkboard themes include a grid pattern on the background. This pattern can be modified by setting the color, the distance between lines, and the line width, e.g. ```{ color: 'rgb(127,127,255,0.1)', distance: 40, width: 2}```. Alternatively, the grid can be removed by setting the value to ```false```.
- ```eraser```: An image path and radius for the eraser.
- ```boardmarkers```: A list of boardmarkers with given color and cursor.
- ```chalks```: A list of chalks with given color and cursor.
- ```rememberColor```: Whether to remember the last selected color for the slide canvas or the board.

All of the configurations are optional and the default values shown below are used if the options are not provided.

```javascript
Reveal.initialize({
	// ...
    chalkboard: {
        boardmarkerWidth: 3,
        chalkWidth: 7,
        chalkEffect: 1.0,
        storage: null,
        src: null,
        readOnly: undefined,
        transition: 800,
        theme: "chalkboard",
        background: [ 'rgba(127,127,127,.1)' , path + 'img/blackboard.png' ],
        grid: { color: 'rgb(50,50,10,0.5)', distance: 80, width: 2},
        eraser: { src: path + 'img/sponge.png', radius: 20},
        boardmarkers : [
                { color: 'rgba(100,100,100,1)', cursor: 'url(' + path + 'img/boardmarker-black.png), auto'},
                { color: 'rgba(30,144,255, 1)', cursor: 'url(' + path + 'img/boardmarker-blue.png), auto'},
                { color: 'rgba(220,20,60,1)', cursor: 'url(' + path + 'img/boardmarker-red.png), auto'},
                { color: 'rgba(50,205,50,1)', cursor: 'url(' + path + 'img/boardmarker-green.png), auto'},
                { color: 'rgba(255,140,0,1)', cursor: 'url(' + path + 'img/boardmarker-orange.png), auto'},
                { color: 'rgba(150,0,20150,1)', cursor: 'url(' + path + 'img/boardmarker-purple.png), auto'},
                { color: 'rgba(255,220,0,1)', cursor: 'url(' + path + 'img/boardmarker-yellow.png), auto'}
        ],
        chalks: [
                { color: 'rgba(255,255,255,0.5)', cursor: 'url(' + path + 'img/chalk-white.png), auto'},
                { color: 'rgba(96, 154, 244, 0.5)', cursor: 'url(' + path + 'img/chalk-blue.png), auto'},
                { color: 'rgba(237, 20, 28, 0.5)', cursor: 'url(' + path + 'img/chalk-red.png), auto'},
                { color: 'rgba(20, 237, 28, 0.5)', cursor: 'url(' + path + 'img/chalk-green.png), auto'},
                { color: 'rgba(220, 133, 41, 0.5)', cursor: 'url(' + path + 'img/chalk-orange.png), auto'},
                { color: 'rgba(220,0,220,0.5)', cursor: 'url(' + path + 'img/chalk-purple.png), auto'},
                { color: 'rgba(255,220,0,0.5)', cursor: 'url(' + path + 'img/chalk-yellow.png), auto'}
        ]
    },
    // ...

});
```

## Credits

The chalkboard effect is based on [Chalkboard](https://github.com/mmoustafa/Chalkboard) by Mohamed Moustafa.

## License

MIT licensed

Copyright (C) 2023 Asvin Goel
