/*****************************************************************
 ** Author: Asvin Goel, goel@telematique.eu
 **
 ** A plugin for reveal.js adding a chalkboard.
 **
 ** Version: 2.3.3
 **
 ** License: MIT license (see LICENSE.md)
 **
 ** Credits:
 ** Chalkboard effect by Mohamed Moustafa https://github.com/mmoustafa/Chalkboard
 ** Multi color support initially added by Kurt Rinnert https://github.com/rinnert
 ** Compatibility with reveal.js v4 by Hakim El Hattab https://github.com/hakimel
 **
 ** Changed here (2026-10-22; see README.md): drawings belong to a slide,
 ** not to each fragment step (perFragment: true restores that); the
 ** chalkboard scrolls down without end; and every chalkboard can be saved
 ** as a PDF.
 ******************************************************************/

"use strict";

window.RevealChalkboard = window.RevealChalkboard || {
	id: 'RevealChalkboard',
	init: function ( deck ) {
		initChalkboard.call(this, deck );
	},
	configure: function ( config ) {
		configure( config );
	},
	toggleNotesCanvas: function () {
		toggleNotesCanvas();
	},
	toggleChalkboard: function () {
		toggleChalkboard();
	},
	colorIndex: function () {
		colorIndex();
	},
	colorNext: function () {
		colorNext();
	},
	colorPrev: function () {
		colorPrev();
	},
	clear: function () {
		clear();
	},
	reset: function () {
		reset();
	},
	resetAll: function () {
		resetAll();
	},
	updateStorage: function () {
		updateStorage();
	},
	getData: function () {
		return getData();
	},
	download: function () {
		download();
	},
};

function scriptPath() {
	// obtain plugin path from the script element
	var src;
	if ( document.currentScript ) {
		src = document.currentScript.src;
	} else {
		var sel = document.querySelector( 'script[src$="/chalkboard/plugin.js"]' )
		if ( sel ) {
			src = sel.src;
		}
	}
	var path = ( src === undefined ) ? "" : src.slice( 0, src.lastIndexOf( "/" ) + 1 );
//console.log("Path: " + path);
	return path;
}
var path = scriptPath();

const initChalkboard = function ( Reveal ) {
//console.warn(path);
	/* Feature detection for passive event handling*/
	var passiveSupported = false;

	try {
		window.addEventListener( 'test', null, Object.defineProperty( {}, 'passive', {
			get: function () {
				passiveSupported = true;
			}
		} ) );
	} catch ( err ) {}


/*****************************************************************
 ** Configuration
 ******************************************************************/
	var background, pens, draw, color;
	var grid = false;
	var boardmarkerWidth = 3;
	var chalkWidth = 7;
	var chalkEffect = 1.0;
	var rememberColor = [ true, false ];
	var eraser = {
		src: path + 'img/sponge.png',
		radius: 20
	};
	var boardmarkers = [ {
			color: 'rgba(100,100,100,1)',
			cursor: 'url(' + path + 'img/boardmarker-black.png), auto'
		},
		{
			color: 'rgba(30,144,255, 1)',
			cursor: 'url(' + path + 'img/boardmarker-blue.png), auto'
		},
		{
			color: 'rgba(220,20,60,1)',
			cursor: 'url(' + path + 'img/boardmarker-red.png), auto'
		},
		{
			color: 'rgba(50,205,50,1)',
			cursor: 'url(' + path + 'img/boardmarker-green.png), auto'
		},
		{
			color: 'rgba(255,140,0,1)',
			cursor: 'url(' + path + 'img/boardmarker-orange.png), auto'
		},
		{
			color: 'rgba(150,0,20150,1)',
			cursor: 'url(' + path + 'img/boardmarker-purple.png), auto'
		},
		{
			color: 'rgba(255,220,0,1)',
			cursor: 'url(' + path + 'img/boardmarker-yellow.png), auto'
		}
	];
	var chalks = [ {
			color: 'rgba(255,255,255,0.5)',
			cursor: 'url(' + path + 'img/chalk-white.png), auto'
		},
		{
			color: 'rgba(96, 154, 244, 0.5)',
			cursor: 'url(' + path + 'img/chalk-blue.png), auto'
		},
		{
			color: 'rgba(237, 20, 28, 0.5)',
			cursor: 'url(' + path + 'img/chalk-red.png), auto'
		},
		{
			color: 'rgba(20, 237, 28, 0.5)',
			cursor: 'url(' + path + 'img/chalk-green.png), auto'
		},
		{
			color: 'rgba(220, 133, 41, 0.5)',
			cursor: 'url(' + path + 'img/chalk-orange.png), auto'
		},
		{
			color: 'rgba(220,0,220,0.5)',
			cursor: 'url(' + path + 'img/chalk-purple.png), auto'
		},
		{
			color: 'rgba(255,220,0,0.5)',
			cursor: 'url(' + path + 'img/chalk-yellow.png), auto'
		}
	];

  var sponge = 		{
		cursor: 'url(' + path + 'img/sponge.png), auto'
	}


	var keyBindings = {
		toggleNotesCanvas: {
			keyCode: 67,
			key: 'C',
			description: 'Toggle notes canvas'
		},
		toggleChalkboard: {
			keyCode: 66,
			key: 'B',
			description: 'Toggle chalkboard'
		},
		clear: {
			keyCode: 46,
			key: 'DEL',
			description: 'Clear drawings on slide'
		},
/*
		reset: {
			keyCode: 173,
			key: '-',
			description: 'Reset drawings on slide'
		},
*/
		resetAll: {
			keyCode: 8,
			key: 'BACKSPACE',
			description: 'Reset all drawings'
		},
		colorNext: {
			keyCode: 88,
			key: 'X',
			description: 'Next color'
		},
		colorPrev: {
			keyCode: 89,
			key: 'Y',
			description: 'Previous color'
		},
		download: {
			keyCode: 68,
			key: 'D',
			description: 'Download drawings'
		},
		exportPDF: {
			keyCode: 69,
			key: 'E',
			description: 'Save the chalkboards as a PDF'
		},
		toggleTheme: {
			keyCode: 87,
			key: 'W',
			description: 'Chalkboard or whiteboard'
		},
		toggleGrid: {
			keyCode: 82,
			key: 'R',
			description: 'Show or hide the chalkboard\'s grid'
		}
	};


	var theme = 'chalkboard';
	var color = [ 0, 0 ];
	var toggleChalkboardButton = false;
	var toggleNotesButton = false;
	var colorButtons = true;
	var boardHandle = true;
	var transition = 800;

	var readOnly = false;
	var messageType = 'broadcast';

	var perFragment = false;	// a drawing for each fragment step, as the plugin first had it
	var exportScale = 2;		// a saved page's pixels per unit of the slide
	var textureTile = 300;		// the height of the board's texture image (once loaded, its own)

	var config = configure( Reveal.getConfig().chalkboard || {} );
	if ( config.keyBindings ) {
		for ( var key in config.keyBindings ) {
			keyBindings[ key ] = config.keyBindings[ key ];
		};
	}

	function configure( config ) {

		if ( config.boardmarkerWidth || config.penWidth ) boardmarkerWidth = config.boardmarkerWidth || config.penWidth;
		if ( config.chalkWidth ) chalkWidth = config.chalkWidth;
		if ( config.chalkEffect ) chalkEffect = config.chalkEffect;
		if ( config.rememberColor ) rememberColor = config.rememberColor;
		if ( config.eraser ) eraser = config.eraser;
		if ( config.boardmarkers ) boardmarkers = config.boardmarkers;
		if ( config.chalks ) chalks = config.chalks;

		if ( config.theme ) theme = config.theme;
		switch ( theme ) {
		case 'whiteboard':
			background = [ 'rgba(127,127,127,.1)', path + 'img/whiteboard.png' ];
			draw = [ drawWithBoardmarker, drawWithBoardmarker ];
			pens = [ boardmarkers, boardmarkers ];
			grid = {
				color: 'rgb(127,127,255,0.1)',
				distance: 40,
				width: 2
			};
			break;
		case 'chalkboard':
		default:
			background = [ 'rgba(127,127,127,.1)', path + 'img/blackboard.png' ];
			draw = [ drawWithBoardmarker, drawWithChalk ];
			pens = [ boardmarkers, chalks ];
			grid = {
				color: 'rgb(50,50,10,0.5)',
				distance: 80,
				width: 2
			};
		}

		if ( config.background ) background = config.background;
		if ( config.grid != undefined ) grid = config.grid;

		if ( config.toggleChalkboardButton != undefined ) toggleChalkboardButton = config.toggleChalkboardButton;
		if ( config.toggleNotesButton != undefined ) toggleNotesButton = config.toggleNotesButton;
		if ( config.colorButtons != undefined ) colorButtons = config.colorButtons;
		if ( config.boardHandle != undefined ) boardHandle = config.boardHandle;
		if ( config.transition ) transition = config.transition;

		if ( config.readOnly != undefined ) readOnly = config.readOnly;
		if ( config.messageType ) messageType = config.messageType;
		if ( config.perFragment != undefined ) perFragment = config.perFragment;
		if ( config.exportScale ) exportScale = config.exportScale;

		if ( drawingCanvas && ( config.theme || config.background || config.grid ) ) {
			setTexture( background[ 1 ] );
			clearCanvas( 1 );
		}

		return config;
	}
/*****************************************************************
 ** Setup
 ******************************************************************/

	function whenReady( callback ) {
		// wait for markdown to be parsed and code to be highlighted
		if ( !document.querySelector( 'section[data-markdown]:not([data-markdown-parsed])' ) 
			   && !document.querySelector( '[data-load]:not([data-loaded])') 
		     && !document.querySelector( 'code[data-line-numbers*="|"]') 	
		) {
			callback();
		} else {
			console.log( "Wait for external sources to be loaded and code to be highlighted" );
			setTimeout( whenReady, 500, callback )
		}
	}

	function whenLoaded( callback ) {
		// wait for drawings to be loaded and markdown to be parsed
		if ( loaded !== null ) {
			callback();
		} else {
			console.log( "Wait for drawings to be loaded" );
			setTimeout( whenLoaded, 500, callback )
		}
	}

	var drawingCanvas = [ {
		id: 'notescanvas'
	}, {
		id: 'chalkboard'
	} ];
	setupDrawingCanvas( 0 );
	setupDrawingCanvas( 1 );

	// The board's texture: its picture, and the height of its tile once loaded.
	function setTexture( url ) {
		var texture = drawingCanvas[ 1 ].texture;
		texture.style.backgroundImage = 'url("' + url + '")';
		var tile = new Image();
		tile.onload = function () {
			textureTile = tile.naturalHeight || textureTile;
			texture.style.height = 'calc(100% + ' + textureTile + 'px)';
			if ( storage ) layoutCanvas( 1 );
		};
		tile.src = url;
	}

	// The board as a chalkboard or a whiteboard (its theme), switched with W
	// or the button on its handle: its texture, its grid and its pens (chalk,
	// or board markers: the same colours by number, so that white chalk is
	// black ink), and what is drawn on it drawn again in them.  The deck's own
	// settings make its own theme; the other is the plugin's.  The choice is
	// remembered in this browser, and sent ('theme') to anyone following.
	var THEME_KEY = 'reveal-chalkboard-theme';
	// The whiteboard is white (a picture of one white pixel: the plugin's own
	// whiteboard.png is grey), and its markers are the deck's but black for
	// the first (the deck's is a grey, for its pen on slides), a little
	// thicker than that pen (as thick as chalk looks), to be seen across a room.
	var WHITE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
	var whiteboardMarkers = boardmarkers.map( function ( pen, i ) {
		return i ? pen : { color: 'rgba(0,0,0,1)', cursor: pen.cursor };
	} );
	var looks = {
		chalkboard: { background: path + 'img/blackboard.png', grid: { color: 'rgb(50,50,10,0.5)', distance: 80, width: 2 }, draw: drawWithChalk, pens: chalks },
		whiteboard: { background: WHITE, grid: { color: 'rgb(127,127,255,0.1)', distance: 40, width: 2 }, draw: drawOnWhiteboard, pens: whiteboardMarkers }
	};
	function drawOnWhiteboard( context, fromX, fromY, toX, toY, colorIdx ) {
		if ( colorIdx == undefined ) colorIdx = color[ 1 ];
		context.lineWidth = Math.max( boardmarkerWidth, 5 );
		context.lineCap = 'round';
		context.strokeStyle = whiteboardMarkers[ colorIdx ].color;
		context.beginPath();
		context.moveTo( fromX, fromY );
		context.lineTo( toX, toY );
		context.stroke();
	}
	looks[ theme ] = { background: background[ 1 ], grid: grid, draw: draw[ 1 ], pens: pens[ 1 ] };

	function setTheme( name, remember ) {
		if ( !looks[ name ] ) return false;
		if ( remember ) {
			try { localStorage.setItem( THEME_KEY, name ); } catch ( e ) { /* no storage */ }
		}
		if ( name === theme ) return false;
		theme = name;
		var look = looks[ name ], canvas = drawingCanvas[ 1 ];
		background[ 1 ] = look.background;
		grid = look.grid;
		draw[ 1 ] = look.draw;
		pens[ 1 ] = look.pens;
		setTexture( look.background );
		if ( canvas.palette ) {
			canvas.palette.querySelectorAll( 'li[data-color]' ).forEach( function ( li ) {
				var pen = look.pens[ Number( li.getAttribute( 'data-color' ) ) ];
				if ( pen ) li.style.color = pen.color;
			} );
		}
		if ( color[ 1 ] >= look.pens.length ) color[ 1 ] = 0;
		if ( color[ 1 ] >= 0 ) canvas.canvas.style.cursor = canvas.container.style.cursor = look.pens[ color[ 1 ] ].cursor;
		var button = canvas.container.querySelector( '#toggleboardtheme' );
		if ( button ) button.title = name === 'whiteboard' ? 'Make it a chalkboard (W)' : 'Make it a whiteboard (W)';
		if ( Reveal.isReady() ) redrawChalkboard( board );
		return true;
	}

	function toggleTheme() {
		var name = theme === 'whiteboard' ? 'chalkboard' : 'whiteboard';
		setTheme( name, true );
		var message = new CustomEvent( messageType );
		message.content = {
			sender: 'chalkboard-plugin',
			type: 'theme',
			timestamp: Date.now() - slideStart,
			mode,
			board,
			theme: name
		};
		document.dispatchEvent( message );
	}

	// The board's grid, shown or hidden (R, or the button on its handle),
	// whichever the board is: remembered in this browser, and sent ('grid')
	// to anyone following.
	var GRID_KEY = 'reveal-chalkboard-grid';
	var gridShown = true;
	function boardGrid() {
		return gridShown ? grid : false;
	}

	function setGrid( shown, remember ) {
		shown = !!shown;
		if ( remember ) {
			try { localStorage.setItem( GRID_KEY, shown ? 'on' : 'off' ); } catch ( e ) { /* no storage */ }
		}
		var button = drawingCanvas[ 1 ].container.querySelector( '#toggleboardgrid' );
		if ( button ) button.title = shown ? 'Hide the grid (R)' : 'Show the grid (R)';
		if ( shown === gridShown ) return false;
		gridShown = shown;
		if ( Reveal.isReady() ) redrawChalkboard( board );
		return true;
	}

	function toggleGrid() {
		setGrid( !gridShown, true );
		var message = new CustomEvent( messageType );
		message.content = {
			sender: 'chalkboard-plugin',
			type: 'grid',
			timestamp: Date.now() - slideStart,
			mode,
			board,
			grid: gridShown
		};
		document.dispatchEvent( message );
	}

	try { setTheme( localStorage.getItem( THEME_KEY ) ); } catch ( e ) { /* no storage */ }
	try { setGrid( localStorage.getItem( GRID_KEY ) !== 'off' ); } catch ( e ) { /* no storage */ }

	var mode = 0; // 0: notes canvas, 1: chalkboard
	var board = 0; // board index (only for chalkboard)

	var mouseX = 0;
	var mouseY = 0;
	var lastX = null;
	var lastY = null;

	var drawing = false;
	var erasing = false;

	var slideStart = Date.now();
	var slideIndices = {
		h: 0,
		v: 0
	};

	var timeouts = [
		[],
		[]
	];
	var slidechangeTimeout = null;
	var updateStorageTimeout = null;
	var playback = false;

	var boardScroll = 0;		// how far down the chalkboard is shown, in the slide's units
	var boardScrollPx = 0;		// the same in the canvas's pixels, as drawn
	var boardScrollTarget = 0;	// where it is going, while it moves
	var scrollAnimation = null;
	var scrollFinish = null;
	var scrollCommit = null;

	// The position drawings are filed under: the slide alone, so that ink
	// stays while the slide's fragments appear, unless perFragment is set.
	function drawingIndices() {
		var indices = Reveal.getIndices();
		if ( !perFragment ) delete indices.f;
		return indices;
	}

  function changeCursor( element, tool ) {
    element.style.cursor = tool.cursor;
    var palette = document.querySelector('.palette[data-mode="' + mode + '"]');
    if ( palette ) {
      palette.style.cursor = tool.cursor;
    }
  }

	function createPalette( colors, length ) {
		if ( length === true || length > colors.length ) {
			length = colors.length;
		}
		var palette = document.createElement( 'div' );
		palette.classList.add( 'palette' );
		var list = document.createElement( 'ul' );
		// color pickers
		for ( var i = 0; i < length; i++ ) {
			var colorButton = document.createElement( 'li' );
			colorButton.setAttribute( 'data-color', i );
			colorButton.innerHTML = '<i class="fa fa-square"></i>';
			colorButton.style.color = colors[ i ].color;
			colorButton.addEventListener( 'click', function ( e ) {
				var element = e.target;
				while ( !element.hasAttribute( 'data-color' ) ) {
					element = element.parentElement;
				}
				colorIndex( parseInt( element.getAttribute( 'data-color' ) ) );
			} );
			colorButton.addEventListener( 'touchstart', function ( e ) {
				var element = e.target;
				while ( !element.hasAttribute( 'data-color' ) ) {
					element = element.parentElement;
				}
				colorIndex( parseInt( element.getAttribute( 'data-color' ) ) );
			} );
			list.appendChild( colorButton );
		}
    // eraser
    var eraserButton = document.createElement( 'li' );
		eraserButton.setAttribute( 'data-eraser', 'true' );
		var spongeImg = document.createElement( 'img' );
		spongeImg.src = eraser.src;
    spongeImg.height = "24";
    spongeImg.width = "24";
    spongeImg.style.marginTop = '10px';
    spongeImg.style.marginRight = '0';
    spongeImg.style.marginBottom = '0';
    spongeImg.style.marginLeft = '0';
		eraserButton.appendChild(spongeImg);
		eraserButton.addEventListener( 'click', function ( e ) {
			colorIndex( -1 );
		} );
		eraserButton.addEventListener( 'touchstart', function ( e ) {
			colorIndex( -1 );
		} );
		list.appendChild( eraserButton );

		palette.appendChild( list );
		return palette;
	};

	function switchBoard( boardIdx ) {
		selectBoard( boardIdx, true );
		// broadcast
		var message = new CustomEvent( messageType );
			message.content = {
			sender: 'chalkboard-plugin',
			type: 'selectboard',
			timestamp: Date.now() - slideStart,
			mode,
			board
		};
		document.dispatchEvent( message );	
	}

	function setupDrawingCanvas( id ) {
		var container = document.createElement( 'div' );
		container.id = drawingCanvas[ id ].id;
		container.classList.add( 'overlay' );
		container.classList.add( 'r-overlay' );
		container.setAttribute( 'data-prevent-swipe', 'true' );
		container.oncontextmenu = function () {
			return false;
		}

    changeCursor( container, pens[ id ][ color[ id ] ] );

		drawingCanvas[ id ].width = window.innerWidth;
		drawingCanvas[ id ].height = window.innerHeight;
		drawingCanvas[ id ].scale = 1;
		drawingCanvas[ id ].xOffset = 0;
		drawingCanvas[ id ].yOffset = 0;

		if ( id == "0" ) {
			container.style.background = 'rgba(0,0,0,0)';
			container.style.zIndex = 24;
			container.style.opacity = 1;
			container.style.visibility = 'visible';
			container.style.pointerEvents = 'none';
			container.style['backdrop-filter'] = 'none';
			container.style['-webkit-backdrop-filter'] = 'none';

			var slides = document.querySelector( '.slides' );
			var aspectRatio = Reveal.getConfig().width / Reveal.getConfig().height;
			if ( drawingCanvas[ id ].width > drawingCanvas[ id ].height * aspectRatio ) {
				drawingCanvas[ id ].xOffset = ( drawingCanvas[ id ].width - drawingCanvas[ id ].height * aspectRatio ) / 2;
			} else if ( drawingCanvas[ id ].height > drawingCanvas[ id ].width / aspectRatio ) {
				drawingCanvas[ id ].yOffset = ( drawingCanvas[ id ].height - drawingCanvas[ id ].width / aspectRatio ) / 2;
			}

			if ( colorButtons ) {
				var palette = createPalette( boardmarkers, colorButtons );
        palette.dataset.mode = id;
				palette.style.visibility = 'hidden'; // only show palette in drawing mode
				container.appendChild( palette );
			}
		} else {
			container.style.background = 'none';
			container.style.zIndex = 26;
			container.style.opacity = 0;
			container.style.visibility = 'hidden';
			container.style.overflow = 'hidden';
			// reveal's .r-overlay eases every change over 0.3 s: only the
			// board's fading in and out.
			container.style.transitionProperty = 'opacity, visibility';

			// The board's texture, on a layer of its own a tile taller than the
			// board, which slides up as the board scrolls (see layoutCanvas):
			// moved by the GPU alone, never painted again, as a scrolled
			// background would be at every step.
			var texture = document.createElement( 'div' );
			texture.className = 'chalkboard-texture';
			texture.style.cssText = 'position: absolute; left: 0; right: 0; top: 0; z-index: -1; pointer-events: none;'
				+ ' will-change: transform; background-repeat: repeat; height: calc(100% + ' + textureTile + 'px)';
			container.appendChild( texture );
			drawingCanvas[ id ].texture = texture;
			setTexture( background[ id ] );

			if ( colorButtons ) {
				var palette = createPalette( pens[ id ], colorButtons );
        palette.dataset.mode = id;
				container.appendChild( palette );
				drawingCanvas[ id ].palette = palette;
			}
			if ( boardHandle ) {
				var handle = document.createElement( 'div' );
				handle.classList.add( 'boardhandle' );
				handle.innerHTML = '<ul>'
					+ '<li><a id="scrollboardup" href="#" title="Scroll the chalkboard up (↑)"><i class="fas fa-arrow-up"></i></a></li>'
					+ '<li><a id="scrollboarddown" href="#" title="More room: scroll the chalkboard down (↓)"><i class="fas fa-arrow-down"></i></a></li>'
					+ '<li><a id="previousboard" href="#" title="Previous board"><i class="fas fa-chevron-up"></i></a></li>'
					+ '<li><a id="nextboard" href="#" title="Next board"><i class="fas fa-chevron-down"></i></a></li>'
					+ '<li><a id="toggleboardgrid" href="#" title="Hide the grid (R)"><i class="fas fa-table-cells-large"></i></a></li>'
					+ '<li><a id="toggleboardtheme" href="#" title="Make it a whiteboard (W)"><i class="fas fa-circle-half-stroke"></i></a></li>'
					+ '<li><a id="exportboards" href="#" title="Save the chalkboards as a PDF (E)"><i class="fas fa-file-pdf"></i></a></li>'
					+ '</ul>';
				var actions = {
					scrollboardup: function () { scrollBoard( boardScrollTarget - storage[ 1 ].height / 2, true ); },
					scrollboarddown: function () { scrollBoard( boardScrollTarget + storage[ 1 ].height / 2, true ); },
					previousboard: function () { switchBoard( board - 1 ); },
					nextboard: function () { switchBoard( board + 1 ); },
					toggleboardgrid: function () { toggleGrid(); },
					toggleboardtheme: function () { toggleTheme(); },
					exportboards: function () { exportPDF(); }
				};
				Object.keys( actions ).forEach( function ( id ) {
					[ 'click', 'touchstart' ].forEach( function ( type ) {
						handle.querySelector( '#' + id ).addEventListener( type, function ( e ) {
							e.preventDefault();
							actions[ id ]();
						} );
					} );
				} );

				container.appendChild( handle );
			}

			// A trackpad or mouse wheel scrolls the chalkboard.
			container.addEventListener( 'wheel', function ( evt ) {
				if ( mode != 1 ) return;
				evt.preventDefault();
				var lines = evt.deltaMode == 1 ? 16 : evt.deltaMode == 2 ? drawingCanvas[ 1 ].height : 1;
				scrollBoard( boardScrollTarget + evt.deltaY * lines / drawingCanvas[ 1 ].scale, false );
			}, passiveSupported ? { passive: false } : false );
		}

		var canvas = document.createElement( 'canvas' );
		canvas.width = drawingCanvas[ id ].width;
		canvas.height = drawingCanvas[ id ].height;
		canvas.setAttribute( 'data-chalkboard', id );
    changeCursor( canvas, pens[ id ][ color[ id ] ] );
		container.appendChild( canvas );
		drawingCanvas[ id ].canvas = canvas;

		drawingCanvas[ id ].context = canvas.getContext( '2d' );

		setupCanvasEvents( container );

		document.querySelector( '.reveal' ).appendChild( container );
		drawingCanvas[ id ].container = container;
	}


/*****************************************************************
 ** Storage
 ******************************************************************/

	var storage = [ {
			width: Reveal.getConfig().width,
			height: Reveal.getConfig().height,
			data: []
		},
		{
			width: Reveal.getConfig().width,
			height: Reveal.getConfig().height,
			data: []
		}
	];

	var loaded = null;

	if ( config.storage ) {
		// Get chalkboard drawings from session storage
		loaded = initStorage( sessionStorage.getItem( config.storage ) );
	}

	if ( !loaded && config.src != null ) {
		// Get chalkboard drawings from the given file
		loadData( config.src );
	}

	/**
	 * Initialize storage.
	 */
	function initStorage( json ) {
		var success = false;
		try {
			var data = JSON.parse( json );
			for ( var id = 0; id < data.length; id++ ) {
				if ( drawingCanvas[ id ].width != data[ id ].width || drawingCanvas[ id ].height != data[ id ].height ) {
					drawingCanvas[ id ].scale = Math.min( drawingCanvas[ id ].width / data[ id ].width, drawingCanvas[ id ].height / data[ id ].height );
					drawingCanvas[ id ].xOffset = ( drawingCanvas[ id ].width - data[ id ].width * drawingCanvas[ id ].scale ) / 2;
					drawingCanvas[ id ].yOffset = ( drawingCanvas[ id ].height - data[ id ].height * drawingCanvas[ id ].scale ) / 2;
				}
				if ( config.readOnly ) {
					drawingCanvas[ id ].container.style.cursor = 'default';
					drawingCanvas[ id ].canvas.style.cursor = 'default';
				}
			}
			success = true;
			storage = data;
		} catch ( err ) {
			console.warn( "Cannot initialise storage!" );
		}
		return success;
	}


	/**
	 * Load data.
	 */
	function loadData( filename ) {
		var xhr = new XMLHttpRequest();
		xhr.onload = function () {
			if ( xhr.readyState === 4 && xhr.status != 404 ) {
				loaded = initStorage( xhr.responseText );
				updateStorage();
				console.log( "Drawings loaded from file" );
			} else {
				config.readOnly = undefined;
				readOnly = undefined;
				console.warn( 'Failed to get file ' + filename + '. ReadyState: ' + xhr.readyState + ', Status: ' + xhr.status );
				loaded = false;
			}
		};

		xhr.open( 'GET', filename, true );
		try {
			xhr.send();
		} catch ( error ) {
			config.readOnly = undefined;
			readOnly = undefined;
			console.warn( 'Failed to get file ' + filename + '. Make sure that the presentation and the file are served by a HTTP server and the file can be found there. ' + error );
			loaded = false;
		}
	}


	function storageChanged( now ) {
		// Only to keep the drawings in session storage: without that (as in our
		// template), writing them all out as text after every change is waste.
		if ( !config.storage ) return;
		if ( !now ) {
			// create or update timer
			if ( updateStorageTimeout ) {
				clearTimeout( updateStorageTimeout );
			}
			updateStorageTimeout = setTimeout( storageChanged, 1000, true);
		}
		else {
// console.log("Update storage", updateStorageTimeout,  Date.now());
			updateStorage();
			updateStorageTimeout = null;
		}
	}

	function updateStorage() {
		var json = JSON.stringify( storage )
		if ( config.storage ) {
			sessionStorage.setItem( config.storage, json )
		}
		return json;
	}

	function recordEvent( event ) {
//console.log(event);
		event.time = Date.now() - slideStart;
		if ( mode == 1 ) event.board = board;
		var slideData = getSlideData();
		var i = slideData.events.length;
		while ( i > 0 && event.time < slideData.events[ i - 1 ].time ) {
			i--;
		}
		slideData.events.splice( i, 0, event );
		slideData.duration = Math.max( slideData.duration, Date.now() - slideStart ) + 1;

		storageChanged();
	}

	/**
	 * Get data as json string.
	 */
	function getData() {
		// cleanup slide data without events
		for ( var id = 0; id < 2; id++ ) {
			for ( var i = storage[ id ].data.length - 1; i >= 0; i-- ) {
				if ( storage[ id ].data[ i ].events.length == 0 ) {
					storage[ id ].data.splice( i, 1 );
				}
			}
		}

		return updateStorage();
	}

	/**
	 * Download data.
	 */
	function downloadData() {
		var a = document.createElement( 'a' );
		document.body.appendChild( a );
		try {
			a.download = 'chalkboard.json';
			var blob = new Blob( [ getData() ], {
				type: 'application/json'
			} );
			a.href = window.URL.createObjectURL( blob );
		} catch ( error ) {
			// https://stackoverflow.com/a/6234804
			// escape data for proper handling of quotes and line breaks
			// in case malicious user gets a chance to craft the exception message
			error = String(error)
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;")
					.replace(/'/g, "&#039;");
			a.innerHTML += ' (' + error + ')';
		}
		a.click();
		document.body.removeChild( a );
	}

	/**
	 * Returns data object for the slide with the given indices.
	 */
	function getSlideData( indices, id ) {
		if ( id == undefined ) id = mode;
		if ( !indices ) indices = slideIndices;
		var data;
		for ( var i = 0; i < storage[ id ].data.length; i++ ) {
			if ( storage[ id ].data[ i ].slide.h === indices.h && storage[ id ].data[ i ].slide.v === indices.v && storage[ id ].data[ i ].slide.f === indices.f ) {
				data = storage[ id ].data[ i ];
				return data;
			}
		}
		var page = Number( Reveal.getCurrentSlide().getAttribute('data-pdf-page-number') ); 
//console.log( indices, Reveal.getCurrentSlide() );
		storage[ id ].data.push( {
			slide: indices,
			page,
			events: [],
			duration: 0
		} );
		data = storage[ id ].data[ storage[ id ].data.length - 1 ];
		return data;
	}

	/**
	 * Returns maximum duration of slide playback for both modes
	 */
	function getSlideDuration( indices ) {
		if ( !indices ) indices = slideIndices;
		var duration = 0;
		for ( var id = 0; id < 2; id++ ) {
			for ( var i = 0; i < storage[ id ].data.length; i++ ) {
				if ( storage[ id ].data[ i ].slide.h === indices.h && storage[ id ].data[ i ].slide.v === indices.v && storage[ id ].data[ i ].slide.f === indices.f ) {
					duration = Math.max( duration, storage[ id ].data[ i ].duration );
					break;
				}
			}
		}
//console.log( duration );
		return duration;
	}

/*****************************************************************
 ** Print
 ******************************************************************/
	var printMode = ( /print-pdf/gi ).test( window.location.search );
//console.log("createPrintout" + printMode)

	function addPageNumbers() {
		// determine page number for printouts with fragments serialised
		var slides = Reveal.getSlides();
		var page = 0;
		for ( var i=0; i < slides.length; i++) {
			slides[i].setAttribute('data-pdf-page-number',page.toString());
			// add number of fragments without fragment indices
			var count = slides[i].querySelectorAll('.fragment:not([data-fragment-index])').length;
			var fragments = slides[i].querySelectorAll('.fragment[data-fragment-index]');
			for ( var j=0; j < fragments.length; j++) {
				// increasenumber of fragments by highest fragment index (which start at 0)
				if ( Number(fragments[j].getAttribute('data-fragment-index')) + 1 > count ) {
					count = Number(fragments[j].getAttribute('data-fragment-index')) + 1;
				}
			}
			page += count + 1;
		}
	}

	function createPrintout() {
		//console.warn(Reveal.getTotalSlides(),Reveal.getSlidesElement());
		if ( storage[ 1 ].data.length == 0 ) return;
		console.log( 'Create printout(s) for ' + storage[ 1 ].data.length + " slides" );
		drawingCanvas[ 0 ].container.style.opacity = 0; // do not print notes canvas
		drawingCanvas[ 0 ].container.style.visibility = 'hidden';

		var patImg = new Image();
		patImg.onload = function () {
			var slides = Reveal.getSlides();
//console.log(slides);
			for ( var i = storage[ 1 ].data.length - 1; i >= 0; i-- ) {
				console.log( 'Create printout for slide ' + storage[ 1 ].data[ i ].slide.h + '.' + storage[ 1 ].data[ i ].slide.v );
				var slideData = getSlideData( storage[ 1 ].data[ i ].slide, 1 );
				var drawings = createDrawings( slideData, patImg );
				addDrawings( slides[storage[ 1 ].data[ i ].page], drawings );

			}
//			Reveal.sync();
		};
		patImg.src = background[ 1 ];
	}


	function cloneCanvas( oldCanvas ) {
		//create a new canvas
		var newCanvas = document.createElement( 'canvas' );
		var context = newCanvas.getContext( '2d' );
		//set dimensions
		newCanvas.width = oldCanvas.width;
		newCanvas.height = oldCanvas.height;
		//apply the old canvas to the new one
		context.drawImage( oldCanvas, 0, 0 );
		//return the new canvas
		return newCanvas;
	}

	function getCanvas( template, container, board ) {
		var idx = container.findIndex( element => element.board === board );
		if ( idx === -1 ) {
			var canvas = cloneCanvas( template );
			if ( !container.length ) {
				idx = 0;
				container.push( {
					board,
					canvas
				} );
			} else if ( board < container[ 0 ].board ) {
				idx = 0;
				container.unshift( {
					board,
					canvas
				} );
			} else if ( board > container[ container.length - 1 ].board ) {
				idx = container.length;
				container.push( {
					board,
					canvas
				} );
			}
		}

		return container[ idx ].canvas;
	}

	function createDrawings( slideData, patImg ) {
		var width = Reveal.getConfig().width;
		var height = Reveal.getConfig().height;
		var scale = 1;
		var xOffset = 0;
		var yOffset = 0;
		if ( width != storage[ 1 ].width || height != storage[ 1 ].height ) {
			scale = Math.min( width / storage[ 1 ].width, height / storage[ 1 ].height );
			xOffset = ( width - storage[ 1 ].width * scale ) / 2;
			yOffset = ( height - storage[ 1 ].height * scale ) / 2;
		}
		mode = 1;
		board = 0;
//		console.log( 'Create printout(s) for slide ', slideData );

		var drawings = [];
		var template = document.createElement( 'canvas' );
		template.width = width;
		template.height = height;

		var imgCtx = template.getContext( '2d' );
		imgCtx.fillStyle = imgCtx.createPattern( patImg, 'repeat' );
		imgCtx.rect( 0, 0, width, height );
		imgCtx.fill();

		for ( var j = 0; j < slideData.events.length; j++ ) {
			switch ( slideData.events[ j ].type ) {
			case 'draw':
				draw[ 1 ]( getCanvas( template, drawings, board ).getContext( '2d' ),
					xOffset + slideData.events[ j ].x1 * scale,
					yOffset + slideData.events[ j ].y1 * scale,
					xOffset + slideData.events[ j ].x2 * scale,
					yOffset + slideData.events[ j ].y2 * scale,
					yOffset + slideData.events[ j ].color
				);
				break;
			case 'erase':
				eraseWithSponge( getCanvas( template, drawings, board ).getContext( '2d' ),
					xOffset + slideData.events[ j ].x * scale,
					yOffset + slideData.events[ j ].y * scale
				);
				break;
			case 'selectboard':
				selectBoard( slideData.events[ j ].board );
				break;
			case 'clear':
				getCanvas( template, drawings, board ).getContext( '2d' ).clearRect( 0, 0, width, height );
				getCanvas( template, drawings, board ).getContext( '2d' ).fill();
				break;
			default:
				break;
			}
		}

		drawings = drawings.sort( ( a, b ) => a.board > b.board && 1 || -1 );

		mode = 0;

		return drawings;
	}

	function addDrawings( slide, drawings ) {
		var parent = slide.parentElement.parentElement;
		var nextSlide = slide.parentElement.nextElementSibling;

		for ( var i = 0; i < drawings.length; i++ ) {
			var newPDFPage = document.createElement( 'div' );
			newPDFPage.classList.add( 'pdf-page' );
			newPDFPage.style.height = Reveal.getConfig().height;
			newPDFPage.append( drawings[ i ].canvas );
//console.log("Add drawing", newPDFPage);
			if ( nextSlide != null ) {
				parent.insertBefore( newPDFPage, nextSlide );
			} else {
				parent.append( newPDFPage );
			}
		}
	}

	/*****************************************************************
	 ** Drawings
	 ******************************************************************/

	function drawWithBoardmarker( context, fromX, fromY, toX, toY, colorIdx ) {
		if ( colorIdx == undefined ) colorIdx = color[ mode ];
		context.lineWidth = boardmarkerWidth;
		context.lineCap = 'round';
		context.strokeStyle = boardmarkers[ colorIdx ].color;
		context.beginPath();
		context.moveTo( fromX, fromY );
		context.lineTo( toX, toY );
		context.stroke();
	}

	// The chalk's grain is random, but drawn from a sequence seeded by the
	// stroke's own coordinates, so that a stroke drawn again (as a scrolled
	// chalkboard is, and a saved page) looks exactly as it did.
	function strokeRandom( fromX, fromY, toX, toY ) {
		var seed = 2166136261;
		[ fromX, fromY, toX, toY ].forEach( function ( value ) {
			seed = Math.imul( seed ^ Math.round( value * 100 ), 16777619 );
		} );
		return function () {
			seed = seed + 0x6D2B79F5 | 0;
			var t = Math.imul( seed ^ seed >>> 15, 1 | seed );
			t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
			return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;
		};
	}

	function drawWithChalk( context, fromX, fromY, toX, toY, colorIdx, random ) {
		if ( colorIdx == undefined ) colorIdx = color[ mode ];
		if ( !random ) random = Math.random;
		var brushDiameter = chalkWidth;
		context.lineWidth = brushDiameter;
		context.lineCap = 'round';
		context.fillStyle = chalks[ colorIdx ].color; // 'rgba(255,255,255,0.5)';
		context.strokeStyle = chalks[ colorIdx ].color;

		var opacity = 1.0;
		context.strokeStyle = context.strokeStyle.replace( /[\d\.]+\)$/g, opacity + ')' );
		context.beginPath();
		context.moveTo( fromX, fromY );
		context.lineTo( toX, toY );
		context.stroke();
		// Chalk Effect
		var length = Math.round( Math.sqrt( Math.pow( toX - fromX, 2 ) + Math.pow( toY - fromY, 2 ) ) / ( 5 / brushDiameter ) );
		var xUnit = ( toX - fromX ) / length;
		var yUnit = ( toY - fromY ) / length;
		for ( var i = 0; i < length; i++ ) {
			if ( chalkEffect > ( random() * 0.9 ) ) {
				var xCurrent = fromX + ( i * xUnit );
				var yCurrent = fromY + ( i * yUnit );
				var xRandom = xCurrent + ( random() - 0.5 ) * brushDiameter * 1.2;
				var yRandom = yCurrent + ( random() - 0.5 ) * brushDiameter * 1.2;
				context.clearRect( xRandom, yRandom, random() * 2 + 2, random() + 1 );
			}
		}
	}
 
	function eraseWithSponge( context, x, y ) {
		context.save();
		context.beginPath();
		context.arc( x + eraser.radius, y + eraser.radius, eraser.radius, 0, 2 * Math.PI, false );
		context.clip();
		context.clearRect( x - 1, y - 1, eraser.radius * 2 + 2, eraser.radius * 2 + 2 );
		context.restore();
		// (on the chalkboard whichever mode is current: it is redrawn while closed)
		if ( context == drawingCanvas[ 1 ].context && boardGrid() ) {
			redrawGrid( x + eraser.radius, y + eraser.radius, eraser.radius );
		}
	}


	/**
	 * Show an overlay for the chalkboard.
	 */
	function showChalkboard() {
//console.log("showChalkboard");
		drawingCanvas[ 1 ].container.style.opacity = 1;
		drawingCanvas[ 1 ].container.style.visibility = 'visible';
		mode = 1;
	}


	/**
	 * Closes open chalkboard.
	 */
	function closeChalkboard() {
		drawingCanvas[ 1 ].container.style.opacity = 0;
		drawingCanvas[ 1 ].container.style.visibility = 'hidden';
		lastX = null;
		lastY = null;
		mode = 0;
	}

	/**
	 * Clear current canvas.
	 */
	function clearCanvas( id ) {
		if ( id == 0 ) clearTimeout( slidechangeTimeout );
		drawingCanvas[ id ].context.clearRect( 0, 0, drawingCanvas[ id ].width, drawingCanvas[ id ].height );
		if ( id == 1 && boardGrid() ) drawGrid();
	}

	/**
	 * Draw grid on background
	 */
	function drawGrid() {
		var context = drawingCanvas[ 1 ].context;

		layoutCanvas( 1 );

		var scale = drawingCanvas[ 1 ].scale;
		var xOffset = drawingCanvas[ 1 ].xOffset;
		var yOffset = drawingCanvas[ 1 ].yOffset;

		var distance = grid.distance * scale;

		var fromX = drawingCanvas[ 1 ].width / 2 - distance / 2 - Math.floor( ( drawingCanvas[ 1 ].width - distance ) / 2 / distance ) * distance;
		for ( var x = fromX; x < drawingCanvas[ 1 ].width; x += distance ) {
			context.beginPath();
			context.lineWidth = grid.width * scale;
			context.lineCap = 'round';
			context.fillStyle = grid.color;
			context.strokeStyle = grid.color;
			context.moveTo( x, 0 );
			context.lineTo( x, drawingCanvas[ 1 ].height );
			context.stroke();
		}
		var fromY = gridTop( distance );

		// (from just off the screen: a line's edge may be on it, and scrolls into view)
		for ( var y = fromY - distance; y < drawingCanvas[ 1 ].height + distance; y += distance ) {
			context.beginPath();
			context.lineWidth = grid.width * scale;
			context.lineCap = 'round';
			context.fillStyle = grid.color;
			context.strokeStyle = grid.color;
			context.moveTo( 0, y );
			context.lineTo( drawingCanvas[ 1 ].width, y );
			context.stroke();
		}
	}

	function redrawGrid( centerX, centerY, diameter ) {
		var context = drawingCanvas[ 1 ].context;

		layoutCanvas( 1 );

		var scale = drawingCanvas[ 1 ].scale;
		var xOffset = drawingCanvas[ 1 ].xOffset;
		var yOffset = drawingCanvas[ 1 ].yOffset;

		var distance = grid.distance * scale;

		var fromX = drawingCanvas[ 1 ].width / 2 - distance / 2 - Math.floor( ( drawingCanvas[ 1 ].width - distance ) / 2 / distance ) * distance;

		for ( var x = fromX + distance * Math.ceil( ( centerX - diameter - fromX ) / distance ); x <= fromX + distance * Math.floor( ( centerX + diameter - fromX ) / distance ); x += distance ) {
			context.beginPath();
			context.lineWidth = grid.width * scale;
			context.lineCap = 'round';
			context.fillStyle = grid.color;
			context.strokeStyle = grid.color;
			context.moveTo( x, centerY - Math.sqrt( diameter * diameter - ( centerX - x ) * ( centerX - x ) ) );
			context.lineTo( x, centerY + Math.sqrt( diameter * diameter - ( centerX - x ) * ( centerX - x ) ) );
			context.stroke();
		}
		var fromY = gridTop( distance );
		for ( var y = fromY + distance * Math.ceil( ( centerY - diameter - fromY ) / distance ); y <= fromY + distance * Math.floor( ( centerY + diameter - fromY ) / distance ); y += distance ) {
			context.beginPath();
			context.lineWidth = grid.width * scale;
			context.lineCap = 'round';
			context.fillStyle = grid.color;
			context.strokeStyle = grid.color;
			context.moveTo( centerX - Math.sqrt( diameter * diameter - ( centerY - y ) * ( centerY - y ) ), y );
			context.lineTo( centerX + Math.sqrt( diameter * diameter - ( centerY - y ) * ( centerY - y ) ), y );
			context.stroke();
		}
	}

	// The first horizontal line of the grid: centred on the screen, as the
	// plugin had it, and moving up with the drawings as the board scrolls.
	function gridTop( distance ) {
		var height = drawingCanvas[ 1 ].height;
		var top = height / 2 - distance / 2 - Math.floor( ( height - distance ) / 2 / distance ) * distance;
		return ( ( top - boardScrollPx ) % distance + distance ) % distance;
	}

	// Where the drawings' units fall on a canvas: scaled to fit the screen
	// and centred, as the slides are; on the chalkboard, moved up by how
	// far it is scrolled, in whole pixels, so that what is drawn can be
	// moved as it scrolls without blurring.
	function layoutCanvas( id ) {
		var canvas = drawingCanvas[ id ];
		canvas.scale = Math.min( canvas.width / storage[ id ].width, canvas.height / storage[ id ].height );
		canvas.xOffset = ( canvas.width - storage[ id ].width * canvas.scale ) / 2;
		canvas.yOffset = ( canvas.height - storage[ id ].height * canvas.scale ) / 2;
		if ( id == 1 ) {
			boardScrollPx = Math.round( boardScroll * canvas.scale );
			canvas.yOffset -= boardScrollPx;
			canvas.texture.style.transform = 'translateY(' + ( -( boardScrollPx % textureTile ) ) + 'px)';
		}
	}

/*****************************************************************
 ** Scrolling the chalkboard
 ******************************************************************/

	// The chalkboard has no foot: it scrolls down as far as is wanted, so
	// that a derivation can run on.  Drawings keep their place in the
	// slide's units (a y beyond the slide's height is further down the
	// board), and the board's position is recorded among them as a 'scroll'
	// event, so that it is restored on returning to the slide and sent to
	// anyone following.

	// The current slide's events on a board since it was last cleared.
	function boardEvents( boardIdx ) {
		var events = getSlideData( slideIndices, 1 ).events;
		var now = Date.now() - slideStart;
		var since = 0, end = 0;
		for ( ; end < events.length && events[ end ].time <= now; end++ ) {
			if ( events[ end ].type == 'clear' && ( events[ end ].board || 0 ) == boardIdx ) since = end + 1;
		}
		return events.slice( since, end ).filter( function ( event ) {
			return ( event.board || 0 ) == boardIdx;
		} );
	}

	function lastScroll( boardIdx ) {
		var events = boardEvents( boardIdx );
		for ( var i = events.length - 1; i >= 0; i-- ) {
			if ( events[ i ].type == 'scroll' ) return events[ i ].y;
		}
		return 0;
	}

	// Draw the chalkboard again between two heights on its canvas.
	function repaintBoard( top, bottom ) {
		var canvas = drawingCanvas[ 1 ], context = canvas.context;
		var reach = Math.max( chalkWidth, boardmarkerWidth ) * 1.2 + 6;
		context.save();
		context.beginPath();
		context.rect( 0, top, canvas.width, bottom - top );
		context.clip();
		context.clearRect( 0, top, canvas.width, bottom - top );
		if ( boardGrid() ) drawGrid();
		boardEvents( board ).forEach( function ( event ) {
			if ( event.type == 'draw' ) {
				var y1 = event.y1 * canvas.scale + canvas.yOffset, y2 = event.y2 * canvas.scale + canvas.yOffset;
				if ( Math.max( y1, y2 ) + reach >= top && Math.min( y1, y2 ) - reach <= bottom ) drawLine( 1, event );
			} else if ( event.type == 'erase' ) {
				var y = event.y * canvas.scale + canvas.yOffset;
				if ( y + 2 * eraser.radius >= top && y <= bottom ) eraseCircle( 1, event );
			}
		} );
		context.restore();
	}

	// Show the chalkboard from a height: what is drawn already is moved, and
	// only the strip coming into view drawn.
	function setBoardScroll( y ) {
		var canvas = drawingCanvas[ 1 ];
		var before = boardScrollPx;
		boardScroll = y;
		layoutCanvas( 1 );
		var shift = boardScrollPx - before;
		if ( shift == 0 ) return;
		if ( Math.abs( shift ) >= canvas.height ) {
			repaintBoard( 0, canvas.height );
			return;
		}
		// (the canvas copied onto itself, once, replacing what was there)
		canvas.context.save();
		canvas.context.globalCompositeOperation = 'copy';
		canvas.context.drawImage( canvas.canvas, 0, -shift );
		canvas.context.restore();
		if ( shift > 0 ) repaintBoard( canvas.height - shift, canvas.height );
		else repaintBoard( 0, -shift );
	}

	function stopScrolling() {
		cancelAnimationFrame( scrollAnimation );
		clearTimeout( scrollFinish );
		scrollAnimation = scrollFinish = null;
	}

	// Move the chalkboard to a height, gliding there if asked (and finishing
	// at once in a window that draws no frames, being out of sight).
	function scrollBoardTo( y, animate ) {
		stopScrolling();
		if ( !animate || boardScroll == y ) {
			setBoardScroll( y );
			return;
		}
		var from = boardScroll, start = performance.now();
		var step = function ( now ) {
			var t = Math.min( 1, ( now - start ) / 250 );
			setBoardScroll( from + ( y - from ) * ( 1 - Math.pow( 1 - t, 3 ) ) );
			if ( t < 1 ) scrollAnimation = requestAnimationFrame( step );
			else stopScrolling();
		};
		scrollAnimation = requestAnimationFrame( step );
		scrollFinish = setTimeout( function () {
			stopScrolling();
			setBoardScroll( y );
		}, 400 );
	}

	// Back to the top, as a board cleared or drawn afresh is.
	function resetBoardScroll() {
		stopScrolling();
		clearTimeout( scrollCommit );
		scrollCommit = null;
		boardScroll = boardScrollTarget = 0;
		layoutCanvas( 1 );
	}

	// Scroll the chalkboard to a height, as its user asks.
	function scrollBoard( y, animate ) {
		if ( mode != 1 ) return;
		y = Math.max( 0, y );
		if ( y == boardScrollTarget ) return;
		boardScrollTarget = y;
		scrollBoardTo( y, animate );
		// Recorded and sent at most ten times a second, as a wheel scrolls.
		if ( !readOnly && !scrollCommit ) scrollCommit = setTimeout( commitScroll, animate ? 0 : 100 );
	}

	function commitScroll() {
		scrollCommit = null;
		if ( mode != 1 ) return;
		recordEvent( { type: 'scroll', y: boardScrollTarget } );
		var message = new CustomEvent( messageType );
		message.content = {
			sender: 'chalkboard-plugin',
			type: 'scroll',
			timestamp: Date.now() - slideStart,
			mode,
			board,
			y: boardScrollTarget
		};
		document.dispatchEvent( message );
	}

	// While the chalkboard is open, the up and down arrows scroll it.
	window.addEventListener( 'keydown', function ( evt ) {
		if ( mode != 1 || evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey ) return;
		if ( evt.key != 'ArrowUp' && evt.key != 'ArrowDown' ) return;
		if ( evt.target.isContentEditable || /^(input|textarea|select)$/i.test( evt.target.tagName ) ) return;
		evt.preventDefault();
		evt.stopImmediatePropagation();
		scrollBoard( boardScrollTarget + ( evt.key == 'ArrowDown' ? 1 : -1 ) * storage[ 1 ].height / 4, true );
	}, true );

	/**
	 * Set the  color
	 */
	function setColor( index, record ) {
 		// protect against out of bounds (this could happen when
  	// replaying events recorded with different color settings).
    if ( index >= pens[ mode ].length ) index = 0;

	  color[ mode ] = index;

    if ( color[ mode ] < 0 ) {
      // use eraser
      changeCursor( drawingCanvas[ mode ].canvas, sponge );
    }
    else {
      changeCursor( drawingCanvas[ mode ].canvas, pens[ mode ][ color[ mode ] ] );
    }
	}

	/**
	 * Set the  board
	 */
	function selectBoard( boardIdx, record ) {
//console.log("Set board",boardIdx);
		if ( board == boardIdx ) return;

		board = boardIdx;
		redrawChalkboard( boardIdx );
		if ( record ) {
			recordEvent( { type: 'selectboard' } );
		}
	}

	// Draw a board afresh, where it was last scrolled to.
	function redrawChalkboard( boardIdx ) {
		resetBoardScroll();
		boardScroll = boardScrollTarget = lastScroll( boardIdx );
		layoutCanvas( 1 );
		repaintBoard( 0, drawingCanvas[ 1 ].height );
	}


	/**
	 * Forward cycle color
	 */
	function cycleColorNext() {
		color[ mode ] = ( color[ mode ] + 1 ) % pens[ mode ].length;
		return color[ mode ];
	}

	/**
	 * Backward cycle color
	 */
	function cycleColorPrev() {
		color[ mode ] = ( color[ mode ] + ( pens[ mode ].length - 1 ) ) % pens[ mode ].length;
		return color[ mode ];
	}

/*****************************************************************
 ** Broadcast
 ******************************************************************/

	var eventQueue = [];

	document.addEventListener( 'received', function ( message ) {
		if ( message.content && message.content.sender == 'chalkboard-plugin' ) {
			// add message to queue
			eventQueue.push( message );
			console.log( JSON.stringify( message ) );
		}
		if ( eventQueue.length == 1 ) processQueue();
	} );

	function processQueue() {
		// take first message from queue
		var message = eventQueue.shift();

		// synchronize time with seminar host
		slideStart = Date.now() - message.content.timestamp;
		// set status
		if ( mode < message.content.mode ) {
			// open chalkboard
			showChalkboard();
		} else if ( mode > message.content.mode ) {
			// close chalkboard
			closeChalkboard();
		}
		if ( board != message.content.board ) {
			board = message.content.board;
			redrawChalkboard( board );
		};

		switch ( message.content.type ) {
		case 'showChalkboard':
			showChalkboard();
			break;
		case 'closeChalkboard':
			closeChalkboard();
			break;
		case 'erase':
			erasePoint( message.content.x, message.content.y );
			break;
		case 'draw':
			drawSegment( message.content.fromX, message.content.fromY, message.content.toX, message.content.toY, message.content.color );
			break;
		case 'clear':
			clearSlide();
			break;
		case 'selectboard':
			selectBoard( message.content.board, true );
			break;
		case 'scroll':
			if ( mode == 1 && isFinite( message.content.y ) ) {
				// Gliding to a far place; at once to a near one, so as to
				// follow a board being dragged.
				var far = Math.abs( message.content.y - boardScrollTarget ) > storage[ 1 ].height / 4;
				boardScrollTarget = Math.max( 0, message.content.y );
				recordEvent( { type: 'scroll', y: boardScrollTarget } );
				scrollBoardTo( boardScrollTarget, far );
			}
			break;
		case 'theme':
			setTheme( message.content.theme, true );
			break;
		case 'grid':
			setGrid( message.content.grid, true );
			break;
		case 'resetSlide':
			resetSlideDrawings();
			break;
		case 'init':
			storage = message.content.storage;
			for ( var id = 0; id < 2; id++ ) {
				layoutCanvas( id );
			}
			clearCanvas( 0 );
			clearCanvas( 1 );
			if ( !playback ) {
				slidechangeTimeout = setTimeout( startPlayback, transition, getSlideDuration(), 0 );
			}
			if ( mode == 1 && message.content.mode == 0 ) {
				setTimeout( closeChalkboard, transition + 50 );
			}
			if ( mode == 0 && message.content.mode == 1 ) {
				setTimeout( showChalkboard, transition + 50 );
			}
			mode = message.content.mode;
			board = message.content.board;
			break;
		default:
			break;
		}

		// continue with next message if queued
		if ( eventQueue.length > 0 ) {
			processQueue();
		} else {
			storageChanged();
		}
	}

	document.addEventListener( 'welcome', function ( user ) {
		// broadcast storage
		var message = new CustomEvent( messageType );
		message.content = {
			sender: 'chalkboard-plugin',
			recipient: user.id,
			type: 'init',
			timestamp: Date.now() - slideStart,
			storage: storage,
			mode,
			board
		};
		document.dispatchEvent( message );
	} );

	/*****************************************************************
	 ** Playback
	 ******************************************************************/

	document.addEventListener( 'seekplayback', function ( event ) {
//console.log('event seekplayback ' + event.timestamp);
		stopPlayback();
		if ( !playback || event.timestamp == 0 ) {
			// in other cases startplayback fires after seeked
			startPlayback( event.timestamp );
		}
		//console.log('seeked');
	} );


	document.addEventListener( 'startplayback', function ( event ) {
//console.log('event startplayback ' + event.timestamp);
		stopPlayback();
		playback = true;
		startPlayback( event.timestamp );
	} );

	document.addEventListener( 'stopplayback', function ( event ) {
//console.log('event stopplayback ' + (Date.now() - slideStart) );
		playback = false;
		stopPlayback();
	} );

	document.addEventListener( 'startrecording', function ( event ) {
//console.log('event startrecording ' + event.timestamp);
		startRecording();
	} );


	function startRecording() {
		resetSlide( true );
		slideStart = Date.now();
	}

	function startPlayback( timestamp, finalMode ) {
//console.log("playback " + timestamp );
		slideStart = Date.now() - timestamp;
		closeChalkboard();
		mode = 0;
		board = 0;
		for ( var id = 0; id < 2; id++ ) {
			clearCanvas( id );
			var slideData = getSlideData( slideIndices, id );
//console.log( timestamp +" / " + JSON.stringify(slideData));
			var index = 0;
			while ( index < slideData.events.length && slideData.events[ index ].time < ( Date.now() - slideStart ) ) {
				// The chalkboard's drawings are drawn all at once below, at
				// its last position.
				var type = slideData.events[ index ].type;
				if ( id == 0 || !/^(draw|erase|clear|scroll|selectboard)$/.test( type ) ) {
					playEvent( id, slideData.events[ index ], timestamp );
				} else if ( type == 'selectboard' ) {
					board = slideData.events[ index ].board;
				}
				index++;
			}
			if ( id == 1 ) redrawChalkboard( board );

			while ( playback && index < slideData.events.length ) {
				timeouts[ id ].push( setTimeout( playEvent, slideData.events[ index ].time - ( Date.now() - slideStart ), id, slideData.events[ index ], timestamp ) );
				index++;
			}
		}
//console.log("Mode: " + finalMode + "/" + mode );
		if ( finalMode != undefined ) {
			mode = finalMode;
		}
		if ( mode == 1 ) showChalkboard();
//console.log("playback (ok)");

	};

	function stopPlayback() {
//console.log("stopPlayback");
//console.log("Timeouts: " + timeouts[0].length + "/"+ timeouts[1].length);
		for ( var id = 0; id < 2; id++ ) {
			for ( var i = 0; i < timeouts[ id ].length; i++ ) {
				clearTimeout( timeouts[ id ][ i ] );
			}
			timeouts[ id ] = [];
		}
	};

	function playEvent( id, event, timestamp ) {
//console.log( timestamp +" / " + JSON.stringify(event));
//console.log( id + ": " + timestamp +" / " +  event.time +" / " + event.type +" / " + mode );
		switch ( event.type ) {
		case 'open':
			if ( timestamp <= event.time ) {
				showChalkboard();
			} else {
				mode = 1;
			}

			break;
		case 'close':
			if ( timestamp < event.time ) {
				closeChalkboard();
			} else {
				mode = 0;
			}
			break;
		case 'clear':
			if ( id == 1 ) resetBoardScroll();
			clearCanvas( id );
			break;
		case 'selectboard':
			selectBoard( event.board );
			break;
		case 'scroll':
			if ( id == 1 && ( event.board || 0 ) == board ) {
				boardScrollTarget = event.y;
				scrollBoardTo( event.y, false );
			}
			break;
		case 'draw':
			drawLine( id, event, timestamp );
			break;
		case 'erase':
			eraseCircle( id, event, timestamp );
			break;
		}
	};

	function drawLine( id, event, timestamp ) {
		var ctx = drawingCanvas[ id ].context;
		var scale = drawingCanvas[ id ].scale;
		var xOffset = drawingCanvas[ id ].xOffset;
		var yOffset = drawingCanvas[ id ].yOffset;
		draw[ id ]( ctx, xOffset + event.x1 * scale, yOffset + event.y1 * scale, xOffset + event.x2 * scale, yOffset + event.y2 * scale, event.color,
			strokeRandom( event.x1, event.y1, event.x2, event.y2 ) );
	};

	function eraseCircle( id, event, timestamp ) {
		var ctx = drawingCanvas[ id ].context;
		var scale = drawingCanvas[ id ].scale;
		var xOffset = drawingCanvas[ id ].xOffset;
		var yOffset = drawingCanvas[ id ].yOffset;

		eraseWithSponge( ctx, xOffset + event.x * scale, yOffset + event.y * scale );
	};

	function startErasing( x, y ) {
		drawing = false;
		erasing = true;
		erasePoint( x, y );
	}

	function erasePoint( x, y ) {
		var ctx = drawingCanvas[ mode ].context;
		var scale = drawingCanvas[ mode ].scale;
		var xOffset = drawingCanvas[ mode ].xOffset;
		var yOffset = drawingCanvas[ mode ].yOffset;

		recordEvent( {
			type: 'erase',
			x,
			y
		} );

		if (
			x * scale + xOffset > 0 &&
			y * scale + yOffset > 0 &&
			x * scale + xOffset < drawingCanvas[ mode ].width &&
			y * scale + yOffset < drawingCanvas[ mode ].height
		) {
			eraseWithSponge( ctx, x * scale + xOffset, y * scale + yOffset );
		}
	}

	function stopErasing() {
		erasing = false;
	}

	function startDrawing( x, y ) {
		drawing = true;

		var ctx = drawingCanvas[ mode ].context;
		var scale = drawingCanvas[ mode ].scale;
		var xOffset = drawingCanvas[ mode ].xOffset;
		var yOffset = drawingCanvas[ mode ].yOffset;
		lastX = x * scale + xOffset;
		lastY = y * scale + yOffset;
	}

	function drawSegment( fromX, fromY, toX, toY, colorIdx ) {
		var ctx = drawingCanvas[ mode ].context;
		var scale = drawingCanvas[ mode ].scale;
		var xOffset = drawingCanvas[ mode ].xOffset;
		var yOffset = drawingCanvas[ mode ].yOffset;

		recordEvent( {
			type: 'draw',
			color: colorIdx,
			x1: fromX,
			y1: fromY,
			x2: toX,
			y2: toY
		} );

		if (
			fromX * scale + xOffset > 0 &&
			fromY * scale + yOffset > 0 &&
			fromX * scale + xOffset < drawingCanvas[ mode ].width &&
			fromY * scale + yOffset < drawingCanvas[ mode ].height &&
			toX * scale + xOffset > 0 &&
			toY * scale + yOffset > 0 &&
			toX * scale + xOffset < drawingCanvas[ mode ].width &&
			toY * scale + yOffset < drawingCanvas[ mode ].height
		) {
			draw[ mode ]( ctx, fromX * scale + xOffset, fromY * scale + yOffset, toX * scale + xOffset, toY * scale + yOffset, colorIdx,
				strokeRandom( fromX, fromY, toX, toY ) );
		}
	}

	function stopDrawing() {
		drawing = false;
	}


/*****************************************************************
 ** User interface
 ******************************************************************/

	function setupCanvasEvents( canvas ) {
// TODO: check all touchevents
		canvas.addEventListener( 'touchstart', function ( evt ) {
			evt.preventDefault();
//console.log("Touch start");
			if ( !readOnly && evt.target.getAttribute( 'data-chalkboard' ) == mode ) {
				var scale = drawingCanvas[ mode ].scale;
				var xOffset = drawingCanvas[ mode ].xOffset;
				var yOffset = drawingCanvas[ mode ].yOffset;

				var touch = evt.touches[ 0 ];
				mouseX = touch.pageX;
				mouseY = touch.pageY;
        if ( color[ mode ]  < 0 ) {
          startErasing( ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale);
        }
        else {
  				startDrawing( ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale );
        }
			}
		}, passiveSupported ? {
			passive: false
		} : false );

		canvas.addEventListener( 'touchmove', function ( evt ) {
			evt.preventDefault();
//console.log("Touch move");
			if ( drawing || erasing ) {
				var scale = drawingCanvas[ mode ].scale;
				var xOffset = drawingCanvas[ mode ].xOffset;
				var yOffset = drawingCanvas[ mode ].yOffset;

				var touch = evt.touches[ 0 ];
				mouseX = touch.pageX;
				mouseY = touch.pageY;

				if ( drawing ) {
					drawSegment( ( lastX - xOffset ) / scale, ( lastY - yOffset ) / scale, ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale, color[ mode ] );
					// broadcast
					var message = new CustomEvent( messageType );
					message.content = {
						sender: 'chalkboard-plugin',
						type: 'draw',
						timestamp: Date.now() - slideStart,
						mode,
						board,
						fromX: ( lastX - xOffset ) / scale,
						fromY: ( lastY - yOffset ) / scale,
						toX: ( mouseX - xOffset ) / scale,
						toY: ( mouseY - yOffset ) / scale,
						color: color[ mode ]
					};
					document.dispatchEvent( message );

					lastX = mouseX;
					lastY = mouseY;
				} else {
					erasePoint( ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale );
					// broadcast
					var message = new CustomEvent( messageType );
					message.content = {
						sender: 'chalkboard-plugin',
						type: 'erase',
						timestamp: Date.now() - slideStart,
						mode,
						board,
						x: ( mouseX - xOffset ) / scale,
						y: ( mouseY - yOffset ) / scale
					};
					document.dispatchEvent( message );
				}

			}
		}, false );


		canvas.addEventListener( 'touchend', function ( evt ) {
			evt.preventDefault();
			stopDrawing();
			stopErasing();
		}, false );

		canvas.addEventListener( 'mousedown', function ( evt ) {
			evt.preventDefault();
			if ( !readOnly && evt.target.getAttribute( 'data-chalkboard' ) == mode ) {
//console.log( "mousedown: " + evt.button );
				var scale = drawingCanvas[ mode ].scale;
				var xOffset = drawingCanvas[ mode ].xOffset;
				var yOffset = drawingCanvas[ mode ].yOffset;

				mouseX = evt.pageX;
				mouseY = evt.pageY;

				if ( color[ mode ]  < 0 || evt.button == 2 || evt.button == 1 ) {
          if ( color[ mode ]  >= 0 ) {
            // show sponge
            changeCursor( drawingCanvas[ mode ].canvas, sponge );
          }
					startErasing( ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale );
					// broadcast
					var message = new CustomEvent( messageType );
					message.content = {
						sender: 'chalkboard-plugin',
						type: 'erase',
						timestamp: Date.now() - slideStart,
						mode,
						board,
						x: ( mouseX - xOffset ) / scale,
						y: ( mouseY - yOffset ) / scale
					};
					document.dispatchEvent( message );
				} else {
					startDrawing( ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale );
				}
			}
		} );

		canvas.addEventListener( 'mousemove', function ( evt ) {
			evt.preventDefault();
//console.log("Mouse move");

			var scale = drawingCanvas[ mode ].scale;
			var xOffset = drawingCanvas[ mode ].xOffset;
			var yOffset = drawingCanvas[ mode ].yOffset;

			mouseX = evt.pageX;
			mouseY = evt.pageY;

			if ( drawing || erasing ) {
				var scale = drawingCanvas[ mode ].scale;
				var xOffset = drawingCanvas[ mode ].xOffset;
				var yOffset = drawingCanvas[ mode ].yOffset;

				mouseX = evt.pageX;
				mouseY = evt.pageY;

				if ( drawing ) {
					drawSegment( ( lastX - xOffset ) / scale, ( lastY - yOffset ) / scale, ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale, color[ mode ] );
					// broadcast
					var message = new CustomEvent( messageType );
					message.content = {
						sender: 'chalkboard-plugin',
						type: 'draw',
						timestamp: Date.now() - slideStart,
						mode,
						board,
						fromX: ( lastX - xOffset ) / scale,
						fromY: ( lastY - yOffset ) / scale,
						toX: ( mouseX - xOffset ) / scale,
						toY: ( mouseY - yOffset ) / scale,
						color: color[ mode ]
					};
					document.dispatchEvent( message );

					lastX = mouseX;
					lastY = mouseY;
				} else {
					erasePoint( ( mouseX - xOffset ) / scale, ( mouseY - yOffset ) / scale );
					// broadcast
					var message = new CustomEvent( messageType );
					message.content = {
						sender: 'chalkboard-plugin',
						type: 'erase',
						timestamp: Date.now() - slideStart,
						mode,
						board,
						x: ( mouseX - xOffset ) / scale,
						y: ( mouseY - yOffset ) / scale
					};
					document.dispatchEvent( message );
				}

			}
		} );


		canvas.addEventListener( 'mouseup', function ( evt ) {
			evt.preventDefault();
      if ( color[ mode ] >= 0 ) {
        changeCursor( drawingCanvas[ mode ].canvas, pens[ mode ][ color[ mode ] ] );
      }
			if ( drawing || erasing ) {
				stopDrawing();
				stopErasing();
			}
		} );
	}

	function resize() {
//console.log("resize");
		// Resize the canvas and draw everything again
		var timestamp = Date.now() - slideStart;
		if ( !playback ) {
			timestamp = getSlideDuration();
		}

//console.log( drawingCanvas[0].scale + "/" + drawingCanvas[0].xOffset + "/" +drawingCanvas[0].yOffset );
		for ( var id = 0; id < 2; id++ ) {
			drawingCanvas[ id ].width = window.innerWidth;
			drawingCanvas[ id ].height = window.innerHeight;
			drawingCanvas[ id ].canvas.width = drawingCanvas[ id ].width;
			drawingCanvas[ id ].canvas.height = drawingCanvas[ id ].height;
			drawingCanvas[ id ].context.canvas.width = drawingCanvas[ id ].width;
			drawingCanvas[ id ].context.canvas.height = drawingCanvas[ id ].height;

			layoutCanvas( id );
//console.log( drawingCanvas[id].scale + "/" + drawingCanvas[id].xOffset + "/" +drawingCanvas[id].yOffset );
		}
//console.log( window.innerWidth + "/" + window.innerHeight);
		startPlayback( timestamp, mode, true );
	}

	Reveal.addEventListener( 'pdf-ready', function ( evt ) {
//		console.log( "Create printouts when ready" );
		whenLoaded( createPrintout );
	});

	Reveal.addEventListener( 'ready', function ( evt ) {
//console.log('ready');
		if ( !printMode ) {
			window.addEventListener( 'resize', resize );

			slideIndices = drawingIndices();
			slideStart = Date.now() - getSlideDuration();
			// Drawings are kept in the slide's units from the first: until
			// now, they were in the window's pixels until it first resized.
			layoutCanvas( 0 );
			layoutCanvas( 1 );
			if ( !playback ) {
				startPlayback( getSlideDuration(), 0 );
			}
			if ( Reveal.isAutoSliding() ) {
				var event = new CustomEvent( 'startplayback' );
				event.timestamp = 0;
				document.dispatchEvent( event );
			}
			updateStorage();
			whenReady( addPageNumbers );
		}
	} );
	Reveal.addEventListener( 'slidechanged', function ( evt ) {
//		clearTimeout( slidechangeTimeout );
//console.log('slidechanged');
		if ( !printMode ) {
			slideIndices = drawingIndices();
			slideStart = Date.now() - getSlideDuration();
			closeChalkboard();
			board = 0;
			clearCanvas( 0 );
			clearCanvas( 1 );
			if ( !playback ) {
				slidechangeTimeout = setTimeout( startPlayback, transition, getSlideDuration(), 0 );
			}
			if ( Reveal.isAutoSliding() ) {
				var event = new CustomEvent( 'startplayback' );
				event.timestamp = 0;
				document.dispatchEvent( event );
			}
		}
	} );
	Reveal.addEventListener( 'fragmentshown', function ( evt ) {
//		clearTimeout( slidechangeTimeout );
//console.log('fragmentshown');
		if ( !printMode && !perFragment ) {
			// The slide's drawings stay; an open chalkboard closes, to show the step.
			if ( mode == 1 ) closeChalkboard();
		} else if ( !printMode ) {
			slideStart = Date.now() - getSlideDuration();
			slideIndices = drawingIndices();
			closeChalkboard();
			board = 0;
			clearCanvas( 0 );
			clearCanvas( 1 );
			if ( Reveal.isAutoSliding() ) {
				var event = new CustomEvent( 'startplayback' );
				event.timestamp = 0;
				document.dispatchEvent( event );
			} else if ( !playback ) {
				startPlayback( getSlideDuration(), 0 );
//				closeChalkboard();
			}
		}
	} );
	Reveal.addEventListener( 'fragmenthidden', function ( evt ) {
//		clearTimeout( slidechangeTimeout );
//console.log('fragmenthidden');
		if ( !printMode && !perFragment ) {
			if ( mode == 1 ) closeChalkboard();
		} else if ( !printMode ) {
			slideStart = Date.now() - getSlideDuration();
			slideIndices = drawingIndices();
			closeChalkboard();
			board = 0;
			clearCanvas( 0 );
			clearCanvas( 1 );
			if ( Reveal.isAutoSliding() ) {
				document.dispatchEvent( new CustomEvent( 'stopplayback' ) );
			} else if ( !playback ) {
				startPlayback( getSlideDuration() );
				closeChalkboard();
			}
		}
	} );

	Reveal.addEventListener( 'autoslideresumed', function ( evt ) {
//console.log('autoslideresumed');
		var event = new CustomEvent( 'startplayback' );
		event.timestamp = 0;
		document.dispatchEvent( event );
	} );
	Reveal.addEventListener( 'autoslidepaused', function ( evt ) {
//console.log('autoslidepaused');
		document.dispatchEvent( new CustomEvent( 'stopplayback' ) );

		// advance to end of slide
//		closeChalkboard();
		startPlayback( getSlideDuration(), 0 );
	} );

	function toggleNotesCanvas() {
		if ( !readOnly ) {
			if ( mode == 1 ) {
				toggleChalkboard();
				notescanvas.style.background = background[ 0 ]; //'rgba(255,0,0,0.5)';
				notescanvas.style.pointerEvents = 'auto';
			}
			else {
				if ( notescanvas.style.pointerEvents != 'none' ) {
					// hide notes canvas
					if ( colorButtons ) {
						notescanvas.querySelector( '.palette' ).style.visibility = 'hidden';
					}
					notescanvas.style.background = 'rgba(0,0,0,0)';
					notescanvas.style.pointerEvents = 'none';
				}
				else {
					// show notes canvas
					if ( colorButtons ) {
						notescanvas.querySelector( '.palette' ).style.visibility = 'visible';
					}
					notescanvas.style.background = background[ 0 ]; //'rgba(255,0,0,0.5)';
					notescanvas.style.pointerEvents = 'auto';

					var idx = 0;
					if ( color[ mode ] ) {
						idx = color[ mode ];
					}

					setColor( idx, true );
				}
			}
		}
	};

	function toggleChalkboard() {
//console.log("toggleChalkboard " + mode);
		if ( mode == 1 ) {
			if ( !readOnly ) {
				recordEvent( { type: 'close' } );
			}
			closeChalkboard();

			// broadcast
			var message = new CustomEvent( messageType );
			message.content = {
				sender: 'chalkboard-plugin',
				type: 'closeChalkboard',
				timestamp: Date.now() - slideStart,
				mode: 0,
				board
			};
			document.dispatchEvent( message );


		} else {
			showChalkboard();
			if ( !readOnly ) {
				recordEvent( { type: 'open' } );
				// broadcast
				var message = new CustomEvent( messageType );
				message.content = {
					sender: 'chalkboard-plugin',
					type: 'showChalkboard',
					timestamp: Date.now() - slideStart,
					mode: 1,
					board
				};
				document.dispatchEvent( message );

				var idx = 0;

				if ( rememberColor[ mode ] ) {
					idx = color[ mode ];
				}

				setColor( idx, true );
			}
		}
	};

	function clearSlide() {
		recordEvent( { type: 'clear' } );
		if ( mode == 1 ) resetBoardScroll();
		clearCanvas( mode );
	}

	function clear() {
		if ( !readOnly ) {
			clearSlide();
			// broadcast
			var message = new CustomEvent( messageType );
			message.content = {
				sender: 'chalkboard-plugin',
				type: 'clear',
				timestamp: Date.now() - slideStart,
				mode,
				board
			};
			document.dispatchEvent( message );
		}
	};

	function colorIndex( idx ) {
		if ( !readOnly ) {
			setColor( idx, true );
		}
	}

	function colorNext() {
		if ( !readOnly ) {
			let idx = cycleColorNext();
			setColor( idx, true );
		}
	}

	function colorPrev() {
		if ( !readOnly ) {
			let idx = cycleColorPrev();
			setColor( idx, true );
		}
	}

	function resetSlideDrawings() {
		slideStart = Date.now();
		closeChalkboard();

		resetBoardScroll();
		clearCanvas( 0 );
		clearCanvas( 1 );

		mode = 1;
		var slideData = getSlideData();
		slideData.duration = 0;
		slideData.events = [];
		mode = 0;
		var slideData = getSlideData();
		slideData.duration = 0;
		slideData.events = [];

		updateStorage();
	}

	function resetSlide( force ) {
		var ok = force || confirm( "Please confirm to delete chalkboard drawings on this slide!" );
		if ( ok ) {
//console.log("resetSlide ");
			stopPlayback();
			resetSlideDrawings();
			// broadcast
			var message = new CustomEvent( messageType );
			message.content = {
				sender: 'chalkboard-plugin',
				type: 'resetSlide',
				timestamp: Date.now() - slideStart,
				mode,
				board
			};
			document.dispatchEvent( message );
		}
	};

	function resetStorage( force ) {
		var ok = force || confirm( "Please confirm to delete all chalkboard drawings!" );
		if ( ok ) {
			stopPlayback();
			slideStart = Date.now();
			resetBoardScroll();
			clearCanvas( 0 );
			clearCanvas( 1 );
			if ( mode == 1 ) {
				closeChalkboard();
			}

			storage = [ {
					width: Reveal.getConfig().width,
					height: Reveal.getConfig().height,
					data: []
				},
				{
					width: Reveal.getConfig().width,
					height: Reveal.getConfig().height,
					data: []
				}
			];

			if ( config.storage ) {
				sessionStorage.setItem( config.storage, null )
			}
			// broadcast
			var message = new CustomEvent( messageType );
			message.content = {
				sender: 'chalkboard-plugin',
				type: 'init',
				timestamp: Date.now() - slideStart,
				storage,
				mode,
				board
			};
			document.dispatchEvent( message );
		}
	};

/*****************************************************************
 ** A copy elsewhere that shows what this one does
 ******************************************************************/

	// The slide shown here, its drawings so far on both canvases, and whether
	// the chalkboard is open: for a copy of this deck elsewhere that is to show
	// what this one does (the presenter's iPad), which puts them in place with
	// setSlideDrawings.  (Each thing drawn after it is announced as it is drawn,
	// as the plugin's own messages are.)
	function slideDrawings() {
		var part = function ( id ) {
			var data = getSlideData( slideIndices, id );
			return { events: data.events.slice(), duration: data.duration };
		};
		return { slide: Object.assign( {}, slideIndices ), notes: part( 0 ), board: part( 1 ), mode: mode };
	}

	// A slide's drawings, from slideDrawings in another copy, in place of
	// this copy's own; drawn, if it is the slide shown.
	function setSlideDrawings( drawings ) {
		[ drawings.notes, drawings.board ].forEach( function ( part, id ) {
			var data = getSlideData( drawings.slide, id );
			data.events = part.events;
			data.duration = part.duration;
		} );
		var here = drawings.slide.h === slideIndices.h && drawings.slide.v === slideIndices.v && drawings.slide.f === slideIndices.f;
		if ( here && !printMode ) {
			stopPlayback();
			startPlayback( getSlideDuration(), drawings.mode == 1 ? 1 : 0 );
		}
	}

	// The time on the slide's clock, by which its drawings are kept in order:
	// a message handed to this copy ('received') at this time is kept as one
	// drawn here now, after everything before it.
	function slideTime() {
		return Date.now() - slideStart;
	}

/*****************************************************************
 ** Saving the chalkboards as a PDF
 ******************************************************************/

	// Every chalkboard drawn in the presentation, as one PDF: in the order of
	// the slides, a page for each screenful of each board (which may run to
	// several, a board scrolling), and a board cleared part-way giving a
	// sheet for what was on it before.  A page breaks where there is a gap
	// between lines of writing, if there is one in its last 30%.  The pages
	// are pictures of the board, drawn as on the screen at twice the slide's
	// size (exportScale), and the PDF is written here: no library is needed.

	function chalkboardSheets() {
		var sheets = [];
		var step = function ( slide ) { return slide.f == null ? -1 : slide.f; };
		storage[ 1 ].data.slice().sort( function ( a, b ) {
			return ( a.slide.h - b.slide.h ) || ( ( a.slide.v || 0 ) - ( b.slide.v || 0 ) ) || ( step( a.slide ) - step( b.slide ) );
		} ).forEach( function ( slideData ) {
			var boards = {};
			slideData.events.forEach( function ( event ) {
				var sheetsOfBoard = boards[ event.board || 0 ] = boards[ event.board || 0 ] || [ [] ];
				if ( event.type == 'clear' ) sheetsOfBoard.push( [] );
				else if ( event.type == 'draw' || event.type == 'erase' ) sheetsOfBoard[ sheetsOfBoard.length - 1 ].push( event );
			} );
			var numbers = Object.keys( boards ).map( Number ).sort( function ( a, b ) { return a - b; } );
			numbers.forEach( function ( boardIdx ) {
				boards[ boardIdx ].forEach( function ( events ) {
					if ( events.some( function ( event ) { return event.type == 'draw'; } ) ) {
						sheets.push( { slide: slideData.slide, board: boardIdx, boards: numbers.length, events } );
					}
				} );
			} );
		} );
		return sheets;
	}

	// How far a stroke's ink reaches beyond its line, in the slide's units.
	function inkReach() {
		return ( Math.max( chalkWidth, boardmarkerWidth ) * 0.6 + 3 ) / ( drawingCanvas[ 1 ].scale || 1 );
	}

	// The heights (in the slide's units) between which a sheet's pages fall.
	function pageRanges( events ) {
		var height = storage[ 1 ].height, reach = inkReach();
		var top = 0, bottom = 0, spans = [];
		events.forEach( function ( event ) {
			if ( event.type != 'draw' ) return;
			var span = [ Math.min( event.y1, event.y2 ) - reach, Math.max( event.y1, event.y2 ) + reach ];
			spans.push( span );
			top = Math.min( top, span[ 0 ] );
			bottom = Math.max( bottom, span[ 1 ] );
		} );
		// Which rows (two units high) any ink crosses.
		var ROW = 2;
		var inked = new Uint8Array( Math.ceil( ( bottom - top ) / ROW ) + 2 );
		spans.forEach( function ( span ) {
			for ( var r = Math.floor( ( span[ 0 ] - top ) / ROW ); r <= Math.floor( ( span[ 1 ] - top ) / ROW ); r++ ) inked[ r ] = 1;
		} );
		var ranges = [];
		var from = top;
		while ( from + height < bottom ) {
			var to = from + height;
			for ( var y = to; y > from + height * 0.7; y -= ROW ) {
				if ( !inked[ Math.floor( ( y - top ) / ROW ) ] ) {
					to = y;
					break;
				}
			}
			ranges.push( { from, to } );
			from = to;
		}
		ranges.push( { from, to: from + height } );
		return ranges;
	}

	function sheetLabel( sheet ) {
		var slide = Reveal.getSlide( sheet.slide.h, sheet.slide.v );
		var heading = slide && slide.querySelector( 'h1, h2, h3' );
		var title = heading ? heading.textContent.replace( /\s+/g, ' ' ).trim() : '';
		if ( title.length > 70 ) title = title.slice( 0, 69 ) + '…';
		return 'Slide ' + ( sheet.slide.h + 1 ) + ( sheet.slide.v ? '.' + ( sheet.slide.v + 1 ) : '' )
			+ ( title ? ': ' + title : '' )
			+ ( sheet.boards > 1 ? ', board ' + ( sheet.board + 1 ) : '' );
	}

	function loadImage( src ) {
		return new Promise( function ( resolve ) {
			if ( !src || !( /^data:image\//.test( src ) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test( src ) ) ) return resolve( null );
			var image = new Image();
			image.onload = function () { resolve( image ); };
			image.onerror = function () { resolve( null ); };
			image.src = src;
		} );
	}

	// One page: the board (its picture and grid), then the ink, drawn as on
	// the screen (the chalk's width and grain are in the screen's pixels)
	// and scaled up, then the label.
	function renderPage( sheet, range, label, texture ) {
		var width = storage[ 1 ].width, height = storage[ 1 ].height;
		var scale = exportScale, screen = drawingCanvas[ 1 ].scale || 1;
		var page = document.createElement( 'canvas' );
		page.width = Math.round( width * scale );
		page.height = Math.round( height * scale );
		var context = page.getContext( '2d' );
		context.fillStyle = theme == 'whiteboard' ? '#ffffff' : '#262626';
		context.fillRect( 0, 0, page.width, page.height );
		if ( texture ) {
			context.fillStyle = context.createPattern( texture, 'repeat' );
			context.fillRect( 0, 0, page.width, page.height );
		}
		if ( boardGrid() ) {
			var distance = grid.distance * scale;
			context.lineWidth = grid.width * scale;
			context.lineCap = 'round';
			context.strokeStyle = grid.color;
			context.beginPath();
			for ( var x = ( page.width / 2 - distance / 2 ) % distance; x < page.width; x += distance ) {
				context.moveTo( x, 0 );
				context.lineTo( x, page.height );
			}
			for ( var y = ( ( ( height / 2 - range.from ) * scale - distance / 2 ) % distance + distance ) % distance; y < page.height; y += distance ) {
				context.moveTo( 0, y );
				context.lineTo( page.width, y );
			}
			context.stroke();
		}

		var ink = document.createElement( 'canvas' );
		ink.width = page.width;
		ink.height = page.height;
		var inkContext = ink.getContext( '2d' );
		inkContext.setTransform( scale / screen, 0, 0, scale / screen, 0, 0 );
		inkContext.beginPath();
		inkContext.rect( 0, 0, width * screen, ( range.to - range.from ) * screen );
		inkContext.clip();
		var reach = inkReach();
		sheet.events.forEach( function ( event ) {
			if ( event.type == 'draw' ) {
				if ( Math.max( event.y1, event.y2 ) + reach < range.from || Math.min( event.y1, event.y2 ) - reach > range.to ) return;
				draw[ 1 ]( inkContext, event.x1 * screen, ( event.y1 - range.from ) * screen, event.x2 * screen, ( event.y2 - range.from ) * screen,
					event.color, strokeRandom( event.x1, event.y1, event.x2, event.y2 ) );
			} else {
				var ex = event.x * screen, ey = ( event.y - range.from ) * screen;
				inkContext.save();
				inkContext.beginPath();
				inkContext.arc( ex + eraser.radius, ey + eraser.radius, eraser.radius, 0, 2 * Math.PI, false );
				inkContext.clip();
				inkContext.clearRect( ex - 1, ey - 1, eraser.radius * 2 + 2, eraser.radius * 2 + 2 );
				inkContext.restore();
			}
		} );
		context.drawImage( ink, 0, 0 );

		context.font = Math.round( 10 * scale ) + 'px sans-serif';
		context.textAlign = 'right';
		context.textBaseline = 'bottom';
		context.fillStyle = theme == 'whiteboard' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)';
		context.fillText( label, page.width - 8 * scale, page.height - 6 * scale );

		return new Promise( function ( resolve, reject ) {
			page.toBlob( function ( blob ) {
				if ( !blob ) return reject( new Error( 'a page could not be drawn' ) );
				blob.arrayBuffer().then( function ( buffer ) {
					resolve( { jpeg: new Uint8Array( buffer ), width: page.width, height: page.height } );
				}, reject );
			}, 'image/jpeg', 0.85 );
		} );
	}

	// A PDF of JPEG pages, a page a picture.
	function makePDF( pages, title ) {
		var encoder = new TextEncoder();
		var parts = [], offsets = [], length = 0;
		var add = function ( chunk ) {
			if ( typeof chunk == 'string' ) chunk = encoder.encode( chunk );
			parts.push( chunk );
			length += chunk.length;
		};
		var object = function ( number, dictionary, stream ) {
			offsets[ number ] = length;
			add( number + ' 0 obj\n' + dictionary + '\n' );
			if ( stream ) {
				add( 'stream\n' );
				add( stream );
				add( '\nendstream\n' );
			}
			add( 'endobj\n' );
		};
		var text = function ( string ) {
			var hex = 'FEFF';
			for ( var i = 0; i < string.length; i++ ) hex += ( '000' + string.charCodeAt( i ).toString( 16 ) ).slice( -4 );
			return '<' + hex.toUpperCase() + '>';
		};
		var width = 960, height = Math.round( 960 * storage[ 1 ].height / storage[ 1 ].width * 100 ) / 100;

		add( '%PDF-1.4\n%âãÏÓ\n' );
		object( 1, '<< /Type /Catalog /Pages 2 0 R >>' );
		object( 2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map( function ( page, i ) { return ( 4 + 3 * i ) + ' 0 R'; } ).join( ' ' ) + '] >>' );
		object( 3, '<< /Title ' + text( title ) + ' /Producer (reveal.js chalkboard) >>' );
		pages.forEach( function ( page, i ) {
			var n = 4 + 3 * i;
			var content = 'q ' + width + ' 0 0 ' + height + ' 0 0 cm /Board Do Q';
			object( n, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height + '] /Resources << /XObject << /Board ' + ( n + 2 ) + ' 0 R >> >> /Contents ' + ( n + 1 ) + ' 0 R >>' );
			object( n + 1, '<< /Length ' + content.length + ' >>', content );
			object( n + 2, '<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height
				+ ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.jpeg.length + ' >>', page.jpeg );
		} );
		var count = 4 + 3 * pages.length;
		var xref = length;
		add( 'xref\n0 ' + count + '\n0000000000 65535 f \n' );
		for ( var n = 1; n < count; n++ ) add( ( '000000000' + offsets[ n ] ).slice( -10 ) + ' 00000 n \n' );
		add( 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n' );
		return new Blob( parts, { type: 'application/pdf' } );
	}

	function pdfName() {
		var title = ( document.title || 'Presentation' ).replace( /[\\\/:*?"<>|]+/g, '-' ).replace( /\s+/g, ' ' ).trim();
		var now = new Date();
		var pad = function ( n ) { return String( n ).padStart( 2, '0' ); };
		return title + ' - chalkboards ' + now.getFullYear() + '-' + pad( now.getMonth() + 1 ) + '-' + pad( now.getDate() ) + '.pdf';
	}

	function saveFile( blob, name ) {
		var a = document.createElement( 'a' );
		a.href = URL.createObjectURL( blob );
		a.download = name;
		document.body.appendChild( a );
		a.click();
		a.remove();
		setTimeout( function () { URL.revokeObjectURL( a.href ); }, 60000 );
	}

	// A line of news at the foot of the screen.
	var notice = null, noticeTimer = null;
	function notify( text, lasting ) {
		if ( !notice ) {
			notice = document.createElement( 'div' );
			notice.className = 'chalkboard-notice';
			notice.setAttribute( 'role', 'status' );
			document.querySelector( '.reveal' ).appendChild( notice );
		}
		clearTimeout( noticeTimer );
		notice.textContent = text;
		notice.classList.add( 'visible' );
		if ( !lasting ) noticeTimer = setTimeout( function () { notice.classList.remove( 'visible' ); }, 3000 );
	}

	// Save every chalkboard as a PDF, or with { download: false } only
	// return it (a Blob; null if nothing has been drawn).
	var exporting = false;
	async function exportPDF( options ) {
		var download = !( options && options.download === false );
		if ( exporting ) return null;
		var sheets = chalkboardSheets();
		if ( !sheets.length ) {
			if ( download ) notify( 'Nothing has been drawn on a chalkboard yet.' );
			return null;
		}
		exporting = true;
		if ( download ) notify( 'Saving the chalkboards…', true );
		try {
			var texture = await loadImage( background[ 1 ] );
			var pages = [];
			for ( var s = 0; s < sheets.length; s++ ) {
				var ranges = pageRanges( sheets[ s ].events );
				var label = sheetLabel( sheets[ s ] );
				for ( var p = 0; p < ranges.length; p++ ) {
					pages.push( await renderPage( sheets[ s ], ranges[ p ],
						label + ( ranges.length > 1 ? ' · page ' + ( p + 1 ) + ' of ' + ranges.length : '' ), texture ) );
				}
			}
			var blob = makePDF( pages, ( document.title || 'Presentation' ) + ': chalkboards' );
			if ( download ) {
				saveFile( blob, pdfName() );
				notify( 'Saved the chalkboards: ' + pages.length + ( pages.length == 1 ? ' page.' : ' pages.' ) );
			}
			return blob;
		} catch ( error ) {
			console.error( error );
			if ( download ) notify( 'The chalkboards could not be saved (' + error.message + ').' );
			return null;
		} finally {
			exporting = false;
		}
	}

	this.toggleNotesCanvas = toggleNotesCanvas;
	this.toggleChalkboard = toggleChalkboard;
	this.colorIndex = colorIndex;
	this.colorNext = colorNext;
	this.colorPrev = colorPrev;
	this.clear = clear;
	this.reset = resetSlide;
	this.resetAll = resetStorage;
	this.download = downloadData;
	this.updateStorage = updateStorage;
	this.getData = getData;
	this.configure = configure;
	this.exportPDF = exportPDF;
	this.scrollBoard = function ( y, animate ) { scrollBoard( y, animate !== false ); };
	this.boardScroll = function () { return boardScrollTarget; };
	this.toggleTheme = toggleTheme;
	this.setTheme = function ( name ) { return setTheme( name, true ); };
	this.theme = function () { return theme; };
	this.toggleGrid = toggleGrid;
	this.setGrid = function ( shown ) { return setGrid( shown, true ); };
	this.gridShown = function () { return gridShown; };
	this.slideDrawings = slideDrawings;
	this.setSlideDrawings = setSlideDrawings;
	this.slideTime = slideTime;
	this.boardOpen = function () { return mode == 1; };


	for ( var key in keyBindings ) {
		if ( keyBindings[ key ] ) {
			Reveal.addKeyBinding( keyBindings[ key ], RevealChalkboard[ key ] );
		}
	};

	return this;
};
