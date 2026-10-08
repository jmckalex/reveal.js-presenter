/*!
 * QR Studio 1.1.0 — QR codes as vector artwork
 * https://github.com/jmckalex/qr-studio#readme
 *
 * Copyright (c) 2026 J. McKenzie Alexander. Released under the MIT licence.
 *
 * Bundles QR Code Generator for JavaScript, copyright (c) 2009 Kazuhiko Arase
 * (https://www.d-project.com/), also MIT. "QR Code" is a registered trademark
 * of DENSO WAVE INCORPORATED.
 */
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/vendor/qrcode.js
var qrcode = function(typeNumber, errorCorrectionLevel) {
  const PAD0 = 236;
  const PAD1 = 17;
  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];
  const _this = {};
  const makeImpl = function(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = function(moduleCount) {
      const modules = new Array(moduleCount);
      for (let row = 0; row < moduleCount; row += 1) {
        modules[row] = new Array(moduleCount);
        for (let col = 0; col < moduleCount; col += 1) {
          modules[row][col] = null;
        }
      }
      return modules;
    }(_moduleCount);
    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }
    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }
    mapData(_dataCache, maskPattern);
  };
  const setupPositionProbePattern = function(row, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
          _modules[row + r][col + c] = true;
        } else {
          _modules[row + r][col + c] = false;
        }
      }
    }
  };
  const getBestMaskPattern = function() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  };
  const setupTimingPattern = function() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) {
        continue;
      }
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) {
        continue;
      }
      _modules[6][c] = c % 2 == 0;
    }
  };
  const setupPositionAdjustPattern = function() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];
        if (_modules[row][col] != null) {
          continue;
        }
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  };
  const setupTypeNumber = function(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };
  const setupTypeInfo = function(test, maskPattern) {
    const data = _errorCorrectionLevel << 3 | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 6) {
        _modules[i][8] = mod;
      } else if (i < 8) {
        _modules[i + 1][8] = mod;
      } else {
        _modules[_moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 8) {
        _modules[8][_moduleCount - i - 1] = mod;
      } else if (i < 9) {
        _modules[8][15 - i - 1 + 1] = mod;
      } else {
        _modules[8][15 - i - 1] = mod;
      }
    }
    _modules[_moduleCount - 8][8] = !test;
  };
  const mapData = function(data, maskPattern) {
    let inc = -1;
    let row = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row][col - c] == null) {
            let dark2 = false;
            if (byteIndex < data.length) {
              dark2 = (data[byteIndex] >>> bitIndex & 1) == 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) {
              dark2 = !dark2;
            }
            _modules[row][col - c] = dark2;
            bitIndex -= 1;
            if (bitIndex == -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || _moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };
  const createBytes = function(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }
    return data;
  };
  const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
    const buffer = qrBitBuffer();
    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD1, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode) {
    mode = mode || "Byte";
    let newData = null;
    switch (mode) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode;
    }
    _dataList.push(newData);
    _dataCache = null;
  };
  _this.isDark = function(row, col) {
    if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
      throw row + "," + col;
    }
    return _modules[row][col];
  };
  _this.getModuleCount = function() {
    return _moduleCount;
  };
  _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber2 = 1;
      for (; typeNumber2 < 40; typeNumber2++) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
        const buffer = qrBitBuffer();
        for (let i = 0; i < _dataList.length; i++) {
          const data = _dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      _typeNumber = typeNumber2;
    }
    makeImpl(false, getBestMaskPattern());
  };
  _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="';
    qrHtml += " border-width: 0px; border-style: none;";
    qrHtml += " border-collapse: collapse;";
    qrHtml += " padding: 0px; margin: " + margin + "px;";
    qrHtml += '">';
    qrHtml += "<tbody>";
    for (let r = 0; r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0; c < _this.getModuleCount(); c += 1) {
        qrHtml += '<td style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: 0px;";
        qrHtml += " width: " + cellSize + "px;";
        qrHtml += " height: " + cellSize + "px;";
        qrHtml += " background-color: ";
        qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
        qrHtml += ";";
        qrHtml += '"/>';
      }
      qrHtml += "</tr>";
    }
    qrHtml += "</tbody>";
    qrHtml += "</table>";
    return qrHtml;
  };
  _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object") {
      opts = arguments[0];
      cellSize = opts.cellSize;
      margin = opts.margin;
      alt = opts.alt;
      title = opts.title;
    }
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    alt = typeof alt === "string" ? { text: alt } : alt || {};
    alt.text = alt.text || null;
    alt.id = alt.text ? alt.id || "qrcode-description" : null;
    title = typeof title === "string" ? { text: title } : title || {};
    title.text = title.text || null;
    title.id = title.text ? title.id || "qrcode-title" : null;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let c, mc, r, mr, qrSvg = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
    qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
    qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
    qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
    qrSvg += ' preserveAspectRatio="xMinYMin meet"';
    qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
    qrSvg += ">";
    qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
    qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
    qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
    qrSvg += '<path d="';
    for (r = 0; r < _this.getModuleCount(); r += 1) {
      mr = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc = c * cellSize + margin;
          qrSvg += "M" + mc + "," + mr + rect;
        }
      }
    }
    qrSvg += '" stroke="transparent" fill="black"/>';
    qrSvg += "</svg>";
    return qrSvg;
  };
  _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        const c = Math.floor((x - min) / cellSize);
        const r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else {
        return 1;
      }
    });
  };
  _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let img = "";
    img += "<img";
    img += ' src="';
    img += _this.createDataURL(cellSize, margin);
    img += '"';
    img += ' width="';
    img += size;
    img += '"';
    img += ' height="';
    img += size;
    img += '"';
    if (alt) {
      img += ' alt="';
      img += escapeXml(alt);
      img += '"';
    }
    img += "/>";
    return img;
  };
  const escapeXml = function(s) {
    let escaped = "";
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  };
  const _createHalfASCII = function(margin) {
    const cellSize = 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r1, r2, p;
    const blocks = {
      "██": "█",
      "█ ": "▀",
      " █": "▄",
      "  ": " "
    };
    const blocksLastLineNoMargin = {
      "██": "▀",
      "█ ": "▀",
      " █": " ",
      "  ": " "
    };
    let ascii = "";
    for (y = 0; y < size; y += 2) {
      r1 = Math.floor((y - min) / cellSize);
      r2 = Math.floor((y + 1 - min) / cellSize);
      for (x = 0; x < size; x += 1) {
        p = "█";
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
          p = " ";
        }
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
          p += " ";
        } else {
          p += "█";
        }
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += "\n";
    }
    if (size % 2 && margin > 0) {
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.createASCII = function(cellSize, margin) {
    cellSize = cellSize || 1;
    if (cellSize < 2) {
      return _createHalfASCII(margin);
    }
    cellSize -= 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r, p;
    const white = Array(cellSize + 1).join("██");
    const black = Array(cellSize + 1).join("  ");
    let ascii = "";
    let line = "";
    for (y = 0; y < size; y += 1) {
      r = Math.floor((y - min) / cellSize);
      line = "";
      for (x = 0; x < size; x += 1) {
        p = 1;
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
          p = 0;
        }
        line += p ? white : black;
      }
      for (r = 0; r < cellSize; r += 1) {
        ascii += line + "\n";
      }
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    const length = _this.getModuleCount();
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        context.fillStyle = _this.isDark(row, col) ? "black" : "white";
        context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  };
  return _this;
};
qrcode.stringToBytes = function(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read = function() {
      const b = bin.read();
      if (b == -1) throw "eof";
      return b;
    };
    let count = 0;
    const unicodeMap2 = {};
    while (true) {
      const b0 = bin.read();
      if (b0 == -1) break;
      const b1 = read();
      const b2 = read();
      const b3 = read();
      const k = String.fromCharCode(b0 << 8 | b1);
      const v = b2 << 8 | b3;
      unicodeMap2[k] = v;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  }();
  const unknownChar = "?".charCodeAt(0);
  return function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b = unicodeMap[s.charAt(i)];
        if (typeof b == "number") {
          if ((b & 255) == b) {
            bytes.push(b);
          } else {
            bytes.push(b >>> 8);
            bytes.push(b & 255);
          }
        } else {
          bytes.push(unknownChar);
        }
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};
var QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};
var QRUtil = function() {
  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];
  const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
  const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
  const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
  const _this = {};
  const getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  };
  _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
      d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
    }
    return (data << 10 | d) ^ G15_MASK;
  };
  _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
      d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
    }
    return data << 12 | d;
  };
  _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  };
  _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  };
  _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i += 1) {
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  };
  _this.getLengthInBits = function(mode, type) {
    if (1 <= type && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode;
      }
    } else {
      throw "type:" + type;
    }
  };
  _this.getLostPoint = function(qrcode2) {
    const moduleCount = qrcode2.getModuleCount();
    let lostPoint = 0;
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        let sameCount = 0;
        const dark2 = qrcode2.isDark(row, col);
        for (let r = -1; r <= 1; r += 1) {
          if (row + r < 0 || moduleCount <= row + r) {
            continue;
          }
          for (let c = -1; c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark2 == qrcode2.isDark(row + r, col + c)) {
              sameCount += 1;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    ;
    for (let row = 0; row < moduleCount - 1; row += 1) {
      for (let col = 0; col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode2.isDark(row, col)) count += 1;
        if (qrcode2.isDark(row + 1, col)) count += 1;
        if (qrcode2.isDark(row, col + 1)) count += 1;
        if (qrcode2.isDark(row + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount - 6; col += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount - 6; row += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount; row += 1) {
        if (qrcode2.isDark(row, col)) {
          darkCount += 1;
        }
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };
  return _this;
}();
var QRMath = function() {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }
  const _this = {};
  _this.glog = function(n2) {
    if (n2 < 1) {
      throw "glog(" + n2 + ")";
    }
    return LOG_TABLE[n2];
  };
  _this.gexp = function(n2) {
    while (n2 < 0) {
      n2 += 255;
    }
    while (n2 >= 256) {
      n2 -= 255;
    }
    return EXP_TABLE[n2];
  };
  return _this;
}();
var qrPolynomial = function(num, shift) {
  if (typeof num.length == "undefined") {
    throw num.length + "/" + shift;
  }
  const _num = function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0) {
      offset += 1;
    }
    const _num2 = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      _num2[i] = num[i + offset];
    }
    return _num2;
  }();
  const _this = {};
  _this.getAt = function(index) {
    return _num[index];
  };
  _this.getLength = function() {
    return _num.length;
  };
  _this.multiply = function(e) {
    const num2 = new Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0; i < _this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
      }
    }
    return qrPolynomial(num2, 0);
  };
  _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0) {
      return _this;
    }
    const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
    const num2 = new Array(_this.getLength());
    for (let i = 0; i < _this.getLength(); i += 1) {
      num2[i] = _this.getAt(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    }
    return qrPolynomial(num2, 0).mod(e);
  };
  return _this;
};
var QRRSBlock = function() {
  const RS_BLOCK_TABLE = [
    // L
    // M
    // Q
    // H
    // 1
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    // 2
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    // 3
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    // 4
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    // 5
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    // 6
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    // 7
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    // 8
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    // 9
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    // 10
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    // 11
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    // 12
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    // 13
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    // 14
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    // 15
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    // 16
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    // 17
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    // 18
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    // 19
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    // 20
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    // 21
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    // 22
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    // 23
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    // 24
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    // 25
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    // 26
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    // 27
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    // 28
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    // 29
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    // 30
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    // 31
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    // 32
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    // 33
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    // 34
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    // 35
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    // 36
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    // 37
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    // 38
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    // 39
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    // 40
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  const qrRSBlock = function(totalCount, dataCount) {
    const _this2 = {};
    _this2.totalCount = totalCount;
    _this2.dataCount = dataCount;
    return _this2;
  };
  const _this = {};
  const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return void 0;
    }
  };
  _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock == "undefined") {
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i += 1) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j += 1) {
        list.push(qrRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  return _this;
}();
var qrBitBuffer = function() {
  const _buffer = [];
  let _length = 0;
  const _this = {};
  _this.getBuffer = function() {
    return _buffer;
  };
  _this.getAt = function(index) {
    const bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  };
  _this.put = function(num, length) {
    for (let i = 0; i < length; i += 1) {
      _this.putBit((num >>> length - i - 1 & 1) == 1);
    }
  };
  _this.getLengthInBits = function() {
    return _length;
  };
  _this.putBit = function(bit) {
    const bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex) {
      _buffer.push(0);
    }
    if (bit) {
      _buffer[bufIndex] |= 128 >>> _length % 8;
    }
    _length += 1;
  };
  return _this;
};
var qrNumber = function(data) {
  const _mode = QRMode.MODE_NUMBER;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const data2 = _data;
    let i = 0;
    while (i + 2 < data2.length) {
      buffer.put(strToNum(data2.substring(i, i + 3)), 10);
      i += 3;
    }
    if (i < data2.length) {
      if (data2.length - i == 1) {
        buffer.put(strToNum(data2.substring(i, i + 1)), 4);
      } else if (data2.length - i == 2) {
        buffer.put(strToNum(data2.substring(i, i + 2)), 7);
      }
    }
  };
  const strToNum = function(s) {
    let num = 0;
    for (let i = 0; i < s.length; i += 1) {
      num = num * 10 + chatToNum(s.charAt(i));
    }
    return num;
  };
  const chatToNum = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    }
    throw "illegal char :" + c;
  };
  return _this;
};
var qrAlphaNum = function(data) {
  const _mode = QRMode.MODE_ALPHA_NUM;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const s = _data;
    let i = 0;
    while (i + 1 < s.length) {
      buffer.put(
        getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s.length) {
      buffer.put(getCode(s.charAt(i)), 6);
    }
  };
  const getCode = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    } else if ("A" <= c && c <= "Z") {
      return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    } else {
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
    }
  };
  return _this;
};
var qr8BitByte = function(data) {
  const _mode = QRMode.MODE_8BIT_BYTE;
  const _data = data;
  const _bytes = qrcode.stringToBytes(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _bytes.length;
  };
  _this.write = function(buffer) {
    for (let i = 0; i < _bytes.length; i += 1) {
      buffer.put(_bytes[i], 8);
    }
  };
  return _this;
};
var qrKanji = function(data) {
  const _mode = QRMode.MODE_KANJI;
  const _data = data;
  const stringToBytes3 = qrcode.stringToBytes;
  !function(c, code) {
    const test = stringToBytes3(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
      throw "sjis not supported.";
    }
  }("友", 38726);
  const _bytes = stringToBytes3(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  };
  _this.write = function(buffer) {
    const data2 = _bytes;
    let i = 0;
    while (i + 1 < data2.length) {
      let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
      if (33088 <= c && c <= 40956) {
        c -= 33088;
      } else if (57408 <= c && c <= 60351) {
        c -= 49472;
      } else {
        throw "illegal char at " + (i + 1) + "/" + c;
      }
      c = (c >>> 8 & 255) * 192 + (c & 255);
      buffer.put(c, 13);
      i += 2;
    }
    if (i < data2.length) {
      throw "illegal char at " + (i + 1);
    }
  };
  return _this;
};
var byteArrayOutputStream = function() {
  const _bytes = [];
  const _this = {};
  _this.writeByte = function(b) {
    _bytes.push(b & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b, off, len) {
    off = off || 0;
    len = len || b.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b[i + off]);
    }
  };
  _this.writeString = function(s) {
    for (let i = 0; i < s.length; i += 1) {
      _this.writeByte(s.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s += ",";
      }
      s += _bytes[i];
    }
    s += "]";
    return s;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode2(b & 63));
  };
  const encode2 = function(n2) {
    if (n2 < 0) {
      throw "n:" + n2;
    } else if (n2 < 26) {
      return 65 + n2;
    } else if (n2 < 52) {
      return 97 + (n2 - 26);
    } else if (n2 < 62) {
      return 48 + (n2 - 52);
    } else if (n2 == 62) {
      return 43;
    } else if (n2 == 63) {
      return 47;
    } else {
      throw "n:" + n2;
    }
  };
  _this.writeByte = function(n2) {
    _buffer = _buffer << 8 | n2 & 255;
    _buflen += 8;
    _length += 1;
    while (_buflen >= 6) {
      writeEncoded(_buffer >>> _buflen - 6);
      _buflen -= 6;
    }
  };
  _this.flush = function() {
    if (_buflen > 0) {
      writeEncoded(_buffer << 6 - _buflen);
      _buffer = 0;
      _buflen = 0;
    }
    if (_length % 3 != 0) {
      const padlen = 3 - _length % 3;
      for (let i = 0; i < padlen; i += 1) {
        _base64 += "=";
      }
    }
  };
  _this.toString = function() {
    return _base64;
  };
  return _this;
};
var base64DecodeInputStream = function(str) {
  const _str = str;
  let _pos = 0;
  let _buffer = 0;
  let _buflen = 0;
  const _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0) {
          return -1;
        }
        throw "unexpected end of file./" + _buflen;
      }
      const c = _str.charAt(_pos);
      _pos += 1;
      if (c == "=") {
        _buflen = 0;
        return -1;
      } else if (c.match(/^\s$/)) {
        continue;
      }
      _buffer = _buffer << 6 | decode(c.charCodeAt(0));
      _buflen += 6;
    }
    const n2 = _buffer >>> _buflen - 8 & 255;
    _buflen -= 8;
    return n2;
  };
  const decode = function(c) {
    if (65 <= c && c <= 90) {
      return c - 65;
    } else if (97 <= c && c <= 122) {
      return c - 97 + 26;
    } else if (48 <= c && c <= 57) {
      return c - 48 + 52;
    } else if (c == 43) {
      return 62;
    } else if (c == 47) {
      return 63;
    } else {
      throw "c:" + c;
    }
  };
  return _this;
};
var gifImage = function(width, height) {
  const _width = width;
  const _height = height;
  const _data = new Array(width * height);
  const _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  };
  _this.write = function(out) {
    out.writeString("GIF87a");
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(128);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(255);
    out.writeByte(255);
    out.writeByte(255);
    out.writeString(",");
    out.writeShort(0);
    out.writeShort(0);
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(0);
    const lzwMinCodeSize = 2;
    const raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255) {
      out.writeByte(255);
      out.writeBytes(raster, offset, 255);
      offset += 255;
    }
    out.writeByte(raster.length - offset);
    out.writeBytes(raster, offset, raster.length - offset);
    out.writeByte(0);
    out.writeString(";");
  };
  const bitOutputStream = function(out) {
    const _out = out;
    let _bitLength = 0;
    let _bitBuffer = 0;
    const _this2 = {};
    _this2.write = function(data, length) {
      if (data >>> length != 0) {
        throw "length over";
      }
      while (_bitLength + length >= 8) {
        _out.writeByte(255 & (data << _bitLength | _bitBuffer));
        length -= 8 - _bitLength;
        data >>>= 8 - _bitLength;
        _bitBuffer = 0;
        _bitLength = 0;
      }
      _bitBuffer = data << _bitLength | _bitBuffer;
      _bitLength = _bitLength + length;
    };
    _this2.flush = function() {
      if (_bitLength > 0) {
        _out.writeByte(_bitBuffer);
      }
    };
    return _this2;
  };
  const getLZWRaster = function(lzwMinCodeSize) {
    const clearCode = 1 << lzwMinCodeSize;
    const endCode = (1 << lzwMinCodeSize) + 1;
    let bitLength = lzwMinCodeSize + 1;
    const table = lzwTable();
    for (let i = 0; i < clearCode; i += 1) {
      table.add(String.fromCharCode(i));
    }
    table.add(String.fromCharCode(clearCode));
    table.add(String.fromCharCode(endCode));
    const byteOut = byteArrayOutputStream();
    const bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0;
    let s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s + c)) {
        s = s + c;
      } else {
        bitOut.write(table.indexOf(s), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s + c);
        }
        s = c;
      }
    }
    bitOut.write(table.indexOf(s), bitLength);
    bitOut.write(endCode, bitLength);
    bitOut.flush();
    return byteOut.toByteArray();
  };
  const lzwTable = function() {
    const _map = {};
    let _size = 0;
    const _this2 = {};
    _this2.add = function(key) {
      if (_this2.contains(key)) {
        throw "dup key:" + key;
      }
      _map[key] = _size;
      _size += 1;
    };
    _this2.size = function() {
      return _size;
    };
    _this2.indexOf = function(key) {
      return _map[key];
    };
    _this2.contains = function(key) {
      return typeof _map[key] != "undefined";
    };
    return _this2;
  };
  return _this;
};
var createDataURL = function(width, height, getPixel) {
  const gif = gifImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gif.setPixel(x, y, getPixel(x, y));
    }
  }
  const b = byteArrayOutputStream();
  gif.write(b);
  const base64 = base64EncodeOutputStream();
  const bytes = b.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// src/vendor/qrcode-utf8.js
function toUTF8Array(str) {
  var utf8 = [];
  for (var i = 0; i < str.length; i++) {
    var charcode = str.charCodeAt(i);
    if (charcode < 128) utf8.push(charcode);
    else if (charcode < 2048) {
      utf8.push(
        192 | charcode >> 6,
        128 | charcode & 63
      );
    } else if (charcode < 55296 || charcode >= 57344) {
      utf8.push(
        224 | charcode >> 12,
        128 | charcode >> 6 & 63,
        128 | charcode & 63
      );
    } else {
      i++;
      charcode = 65536 + ((charcode & 1023) << 10 | str.charCodeAt(i) & 1023);
      utf8.push(
        240 | charcode >> 18,
        128 | charcode >> 12 & 63,
        128 | charcode >> 6 & 63,
        128 | charcode & 63
      );
    }
  }
  return utf8;
}
var stringToBytes2 = toUTF8Array;

// src/matrix.js
qrcode_default.stringToBytes = stringToBytes2;
var PayloadTooLongError = class extends Error {
  constructor(bytes, ecLevel, version2 = 0) {
    super(version2 ? `That payload (${bytes} bytes) will not fit in a version-${version2} QR code at error-correction level ${ecLevel}. Set version to 0 to use the smallest version that fits, or shorten the payload.` : `That payload (${bytes} bytes) will not fit in a QR code at error-correction level ${ecLevel}. Shorten it, or drop to a lower level to make room.`);
    this.name = "PayloadTooLongError";
    this.bytes = bytes;
    this.ecLevel = ecLevel;
    this.version = version2;
  }
};
var LEVELS = ["L", "M", "Q", "H"];
function encode(text, { ecLevel = "H", version: version2 = 0 } = {}) {
  if (!LEVELS.includes(ecLevel)) {
    throw new RangeError(`Unknown error-correction level ${JSON.stringify(ecLevel)}. Use one of ${LEVELS.join(", ")}.`);
  }
  if (!Number.isInteger(version2) || version2 < 0 || version2 > 40) {
    throw new RangeError(`QR versions run from 1 to 40, or 0 for the smallest that fits; got ${JSON.stringify(version2)}.`);
  }
  const body = String(text ?? "");
  let qr;
  try {
    qr = qrcode_default(version2, ecLevel);
    qr.addData(body);
    qr.make();
  } catch (err) {
    if (/overflow/.test(String(err))) throw new PayloadTooLongError(stringToBytes2(body).length, ecLevel, version2);
    throw err instanceof Error ? err : new Error(`The QR encoder failed: ${err}`);
  }
  const size = qr.getModuleCount();
  return {
    size,
    version: (size - 17) / 4,
    isDark: (r, c) => r >= 0 && c >= 0 && r < size && c < size && qr.isDark(r, c)
  };
}
var ALIGN_POS = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170]
];
function functionModules(size, version2) {
  const set = /* @__PURE__ */ new Set();
  for (let i = 8; i < size - 8; i++) {
    set.add(`6,${i}`);
    set.add(`${i},6`);
  }
  const pos = ALIGN_POS[version2 - 1] || [];
  const last = size - 7;
  for (const r of pos) {
    for (const c of pos) {
      if (r === 6 && c === 6 || r === 6 && c === last || r === last && c === 6) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) set.add(`${r + dr},${c + dc}`);
      }
    }
  }
  return set;
}
var isFinder = (size, r, c) => r < 7 && c < 7 || r < 7 && c >= size - 7 || r >= size - 7 && c < 7;

// src/shapes.js
var shapes_exports = {};
__export(shapes_exports, {
  chamfered: () => chamfered,
  circle: () => circle,
  fillet: () => fillet,
  polygon: () => polygon,
  roundedRect: () => roundedRect
});
function roundedRect(x, y, s, [tl, tr, br, bl]) {
  const x1 = x + s;
  const y1 = y + s;
  let d = `M${n(x + tl)},${n(y)}`;
  d += `L${n(x1 - tr)},${n(y)}`;
  if (tr) d += `A${n(tr)},${n(tr)} 0 0 1 ${n(x1)},${n(y + tr)}`;
  d += `L${n(x1)},${n(y1 - br)}`;
  if (br) d += `A${n(br)},${n(br)} 0 0 1 ${n(x1 - br)},${n(y1)}`;
  d += `L${n(x + bl)},${n(y1)}`;
  if (bl) d += `A${n(bl)},${n(bl)} 0 0 1 ${n(x)},${n(y1 - bl)}`;
  d += `L${n(x)},${n(y + tl)}`;
  if (tl) d += `A${n(tl)},${n(tl)} 0 0 1 ${n(x + tl)},${n(y)}`;
  return d + "Z";
}
function fillet(px, py, r, dx, dy) {
  const sweep = dx * dy > 0 ? 1 : 0;
  return `M${n(px)},${n(py)}L${n(px)},${n(py + dy * r)}A${n(r)},${n(r)} 0 0 ${sweep} ${n(px + dx * r)},${n(py)}Z`;
}
function circle(cx, cy, r) {
  return `M${n(cx - r)},${n(cy)}a${n(r)},${n(r)} 0 1,0 ${n(r * 2)},0a${n(r)},${n(r)} 0 1,0 ${n(-r * 2)},0Z`;
}
function polygon(points) {
  return "M" + points.map((p) => `${n(p[0])},${n(p[1])}`).join("L") + "Z";
}
function chamfered(x, y, s, c) {
  const k = s * c;
  return polygon([
    [x + k, y],
    [x + s - k, y],
    [x + s, y + k],
    [x + s, y + s - k],
    [x + s - k, y + s],
    [x + k, y + s],
    [x, y + s - k],
    [x, y + k]
  ]);
}
function n(v) {
  return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(3).replace(/\.?0+$/, "");
}

// src/styles.js
function connectedCorners(near2, r) {
  return [
    !near2.up && !near2.left ? r : 0,
    !near2.up && !near2.right ? r : 0,
    !near2.down && !near2.right ? r : 0,
    !near2.down && !near2.left ? r : 0
  ];
}
var moduleStyles = /* @__PURE__ */ new Map();
var eyeFrameStyles = /* @__PURE__ */ new Map();
var eyeBallStyles = /* @__PURE__ */ new Map();
function refuseBuiltIn(id, registry, kind) {
  var _a;
  if ((_a = registry.get(id)) == null ? void 0 : _a.builtIn) {
    throw new TypeError(`"${id}" is a built-in ${kind} style and cannot be redefined. Register yours under a new id.`);
  }
}
function defineModuleStyle(id, spec) {
  refuseBuiltIn(id, moduleStyles, "module");
  if (typeof (spec == null ? void 0 : spec.path) !== "function") {
    throw new TypeError(`Module style "${id}" needs a path() function.`);
  }
  moduleStyles.set(id, { id, label: spec.label || id, fillets: !!spec.fillets, defaultRadius: spec.defaultRadius, path: spec.path });
  return id;
}
function defineEyeFrameStyle(id, spec) {
  refuseBuiltIn(id, eyeFrameStyles, "finder frame");
  if (typeof (spec == null ? void 0 : spec.path) !== "function") {
    throw new TypeError(`Eye frame style "${id}" needs a path() function.`);
  }
  eyeFrameStyles.set(id, { id, label: spec.label || id, path: spec.path });
  return id;
}
function defineEyeBallStyle(id, spec) {
  refuseBuiltIn(id, eyeBallStyles, "finder centre");
  if (typeof (spec == null ? void 0 : spec.path) !== "function") {
    throw new TypeError(`Eye centre style "${id}" needs a path() function.`);
  }
  eyeBallStyles.set(id, { id, label: spec.label || id, path: spec.path });
  return id;
}
var getModuleStyle = (id) => moduleStyles.get(id) || moduleStyles.get("square");
var getEyeFrameStyle = (id) => eyeFrameStyles.get(id) || eyeFrameStyles.get("square");
var getEyeBallStyle = (id) => eyeBallStyles.get(id) || eyeBallStyles.get("square");
var listModuleStyles = () => [...moduleStyles.values()].map((s) => ({ id: s.id, label: s.label, defaultRadius: s.defaultRadius ?? null }));
var listEyeFrameStyles = () => [...eyeFrameStyles.values()].map((s) => ({ id: s.id, label: s.label }));
var listEyeBallStyles = () => [...eyeBallStyles.values()].map((s) => ({ id: s.id, label: s.label }));
defineModuleStyle("square", {
  label: "Square",
  path: ({ x, y, size }) => roundedRect(x, y, size, [0, 0, 0, 0])
});
defineModuleStyle("rounded", {
  label: "Rounded",
  // Each module rounded on its own, regardless of neighbours. At the full
  // 0.5 radius this is a circle, which is what `dots` already is, so it is
  // designed around a shallower default.
  defaultRadius: 0.3,
  path: ({ x, y, size, radius }) => roundedRect(x, y, size, [radius, radius, radius, radius])
});
defineModuleStyle("smooth", {
  label: "Connected",
  defaultRadius: 0.5,
  path: ({ x, y, size, radius, near: near2 }) => roundedRect(x, y, size, connectedCorners(near2, radius))
});
defineModuleStyle("fluid", {
  label: "Fluid",
  defaultRadius: 0.5,
  fillets: true,
  path: ({ x, y, size, radius, near: near2 }) => roundedRect(x, y, size, connectedCorners(near2, radius))
});
defineModuleStyle("dots", {
  label: "Dots",
  path: ({ x, y, size }) => circle(x + size / 2, y + size / 2, size / 2)
});
defineModuleStyle("diamond", {
  label: "Diamond",
  path: ({ x, y, size: s }) => polygon([
    [x + s / 2, y],
    [x + s, y + s / 2],
    [x + s / 2, y + s],
    [x, y + s / 2]
  ])
});
defineModuleStyle("triangle", {
  label: "Triangle",
  path: ({ x, y, size: s }) => polygon([[x + s / 2, y], [x + s, y + s], [x, y + s]])
});
defineModuleStyle("classy", {
  label: "Classy",
  defaultRadius: 0.5,
  // Rounded on the leading and trailing corners only, so a run of modules
  // reads as a stroke with a calligraphic entry and exit.
  path: ({ x, y, size, radius, near: near2 }) => {
    const c = connectedCorners(near2, radius);
    return roundedRect(x, y, size, [c[0], 0, c[2], 0]);
  }
});
defineModuleStyle("cross", {
  label: "Cross",
  path: ({ x, y, size: s }) => {
    const t = s * 0.34;
    const m = (s - t) / 2;
    return polygon([
      [x + m, y],
      [x + m + t, y],
      [x + m + t, y + m],
      [x + s, y + m],
      [x + s, y + m + t],
      [x + m + t, y + m + t],
      [x + m + t, y + s],
      [x + m, y + s],
      [x + m, y + m + t],
      [x, y + m + t],
      [x, y + m],
      [x + m, y + m]
    ]);
  }
});
defineEyeFrameStyle("square", {
  label: "Square",
  path: ({ x, y }) => roundedRect(x, y, 7, [0, 0, 0, 0]) + roundedRect(x + 1, y + 1, 5, [0, 0, 0, 0])
});
defineEyeFrameStyle("rounded", {
  label: "Rounded",
  path: ({ x, y }) => roundedRect(x, y, 7, [2, 2, 2, 2]) + roundedRect(x + 1, y + 1, 5, [1.3, 1.3, 1.3, 1.3])
});
defineEyeFrameStyle("circle", {
  label: "Circle",
  path: ({ x, y }) => circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5)
});
defineEyeFrameStyle("leaf", {
  label: "Leaf",
  path: ({ x, y }) => roundedRect(x, y, 7, [3.5, 0, 3.5, 0]) + roundedRect(x + 1, y + 1, 5, [2.5, 0, 2.5, 0])
});
defineEyeFrameStyle("shield", {
  label: "Shield",
  // Shallower than it looks like it should be. At the full 3.5 radius the
  // outer ring is very nearly a circle with one sharp corner, and that
  // defeats the ratio test from most angles: it managed 0.25 with a square
  // centre. At 2.0/1.4 the same pairing measures 1.00.
  path: ({ x, y }) => roundedRect(x, y, 7, [2, 2, 0, 2]) + roundedRect(x + 1, y + 1, 5, [1.4, 1.4, 0, 1.4])
});
defineEyeFrameStyle("inset", {
  label: "Inset",
  path: ({ x, y }) => roundedRect(x, y, 7, [0, 2.6, 0, 2.6]) + roundedRect(x + 1, y + 1, 5, [0, 1.8, 0, 1.8])
});
defineEyeBallStyle("square", {
  label: "Square",
  path: ({ x, y }) => roundedRect(x + 2, y + 2, 3, [0, 0, 0, 0])
});
defineEyeBallStyle("rounded", {
  label: "Rounded",
  path: ({ x, y }) => roundedRect(x + 2, y + 2, 3, [1, 1, 1, 1])
});
defineEyeBallStyle("circle", {
  label: "Circle",
  path: ({ x, y }) => circle(x + 3.5, y + 3.5, 1.5)
});
defineEyeBallStyle("facet", {
  label: "Facet",
  // A chamfered square, not a true diamond. A full diamond halves the solid
  // area and decoded 5 times in 20 in testing; a 40% chamfer manages 16/20
  // and 30% or shallower manages 20/20, so this sits at 28%.
  path: ({ x, y }) => chamfered(x + 2, y + 2, 3, 0.28)
});
defineEyeBallStyle("leaf", {
  label: "Leaf",
  path: ({ x, y }) => roundedRect(x + 2, y + 2, 3, [1.5, 0, 1.5, 0])
});
for (const registry of [moduleStyles, eyeFrameStyles, eyeBallStyles]) {
  for (const style of registry.values()) style.builtIn = true;
}

// src/compatibility.js
var EYE_COMPATIBILITY = {
  //          square  rounded  circle  facet  leaf
  square: { square: 1, rounded: 0.31, circle: 0, facet: 0, leaf: 0 },
  rounded: { square: 0.81, rounded: 1, circle: 0.88, facet: 1, leaf: 0.94 },
  circle: { square: 0, rounded: 1, circle: 1, facet: 1, leaf: 1 },
  leaf: { square: 0, rounded: 1, circle: 1, facet: 1, leaf: 1 },
  shield: { square: 1, rounded: 0.88, circle: 0.13, facet: 0.19, leaf: 0.13 },
  inset: { square: 1, rounded: 0.31, circle: 0, facet: 0, leaf: 0 }
};
var FAIL_BELOW = 0.6;
var WARN_BELOW = 0.95;
function eyeCompatibility(frameId, ballId) {
  var _a;
  return ((_a = EYE_COMPATIBILITY[frameId]) == null ? void 0 : _a[ballId]) ?? null;
}
function safeCentresFor(frameId) {
  const row = EYE_COMPATIBILITY[frameId];
  if (!row) return [];
  return Object.entries(row).filter(([, v]) => v >= WARN_BELOW).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

// src/glyph.js
function normaliseIcon(icon) {
  if (!icon || typeof icon !== "object") return null;
  const def = Array.isArray(icon) ? icon : Array.isArray(icon.icon) ? icon.icon : null;
  const [width, height, path] = def ? [def[0], def[1], def[4]] : [icon.width, icon.height, icon.path];
  if (!(width > 0 && height > 0)) return null;
  const str = (p) => typeof p === "string" ? p.trim() : "";
  const duotone = Array.isArray(path) && path.length > 1;
  const secondary = duotone ? str(path[0]) : "";
  const primary = duotone ? str(path[1]) : str(Array.isArray(path) ? path[0] : path);
  if (!secondary && !primary) return null;
  try {
    for (const d of [secondary, primary]) if (d) outlinePoints(d);
  } catch {
    return null;
  }
  return { width: +width, height: +height, duotone, secondary, primary };
}
var CMD = /[MmLlHhVvCcSsQqTtAaZz]/y;
var NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
var SEP = /[\s,]*/y;
var STEPS = 16;
var cache = /* @__PURE__ */ new Map();
function outlinePoints(d) {
  if (cache.has(d)) return cache.get(d);
  const pts = [];
  let i = 0;
  let x = 0, y = 0;
  let sx = 0, sy = 0;
  let qx = 0, qy = 0;
  let cmd = "";
  let prev = "";
  const skip = () => {
    SEP.lastIndex = i;
    SEP.exec(d);
    i = SEP.lastIndex;
  };
  const num = () => {
    skip();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new Error(`Bad path data near "${d.slice(i, i + 12)}".`);
    i = NUM.lastIndex;
    return +m[0];
  };
  const flag = () => {
    skip();
    const ch = d[i];
    if (ch !== "0" && ch !== "1") throw new Error(`Bad arc flag near "${d.slice(i, i + 12)}".`);
    i++;
    return ch === "1";
  };
  const push = (px, py) => pts.push([px, py]);
  for (; ; ) {
    skip();
    if (i >= d.length) break;
    CMD.lastIndex = i;
    const m = CMD.exec(d);
    if (m) {
      cmd = m[0];
      i = CMD.lastIndex;
    } else if (!cmd || cmd === "Z" || cmd === "z") {
      throw new Error(`Bad path data near "${d.slice(i, i + 12)}".`);
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M":
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        push(x, y);
        cmd = rel ? "l" : "L";
        break;
      case "L":
        x = ox + num();
        y = oy + num();
        push(x, y);
        break;
      case "H":
        x = ox + num();
        push(x, y);
        break;
      case "V":
        y = oy + num();
        push(x, y);
        break;
      case "C": {
        const x1 = ox + num(), y1 = oy + num();
        const x2 = ox + num(), y2 = oy + num();
        const ex = ox + num(), ey = oy + num();
        cubic(x, y, x1, y1, x2, y2, ex, ey, push);
        qx = x2;
        qy = y2;
        x = ex;
        y = ey;
        break;
      }
      case "S": {
        const smooth = /[CcSs]/.test(prev);
        const x1 = smooth ? 2 * x - qx : x, y1 = smooth ? 2 * y - qy : y;
        const x2 = ox + num(), y2 = oy + num();
        const ex = ox + num(), ey = oy + num();
        cubic(x, y, x1, y1, x2, y2, ex, ey, push);
        qx = x2;
        qy = y2;
        x = ex;
        y = ey;
        break;
      }
      case "Q": {
        const x1 = ox + num(), y1 = oy + num();
        const ex = ox + num(), ey = oy + num();
        quad(x, y, x1, y1, ex, ey, push);
        qx = x1;
        qy = y1;
        x = ex;
        y = ey;
        break;
      }
      case "T": {
        const smooth = /[QqTt]/.test(prev);
        const x1 = smooth ? 2 * x - qx : x, y1 = smooth ? 2 * y - qy : y;
        const ex = ox + num(), ey = oy + num();
        quad(x, y, x1, y1, ex, ey, push);
        qx = x1;
        qy = y1;
        x = ex;
        y = ey;
        break;
      }
      case "A": {
        const rx = num(), ry = num(), phi = num();
        const large = flag(), sweep = flag();
        const ex = ox + num(), ey = oy + num();
        arc(x, y, rx, ry, phi, large, sweep, ex, ey, push);
        x = ex;
        y = ey;
        break;
      }
      case "Z":
        x = sx;
        y = sy;
        break;
    }
    prev = cmd;
  }
  if (cache.size > 64) cache.clear();
  cache.set(d, pts);
  return pts;
}
function cubic(x0, y0, x1, y1, x2, y2, x3, y3, push) {
  for (let k = 1; k <= STEPS; k++) {
    const t = k / STEPS, u = 1 - t;
    push(
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
    );
  }
}
function quad(x0, y0, x1, y1, x2, y2, push) {
  for (let k = 1; k <= STEPS; k++) {
    const t = k / STEPS, u = 1 - t;
    push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}
function arc(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2, push) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) {
    push(x2, y2);
    return;
  }
  const phi = phiDeg * Math.PI / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const hx = (x1 - x2) / 2, hy = (y1 - y2) / 2;
  const x1p = cos * hx + sin * hy;
  const y1p = -sin * hx + cos * hy;
  const lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = co * rx * y1p / ry;
  const cyp = -co * ry * x1p / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux2, uy2, vx2, vy2) => Math.atan2(ux2 * vy2 - uy2 * vx2, ux2 * vx2 + uy2 * vy2);
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const start = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const n2 = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / STEPS)));
  for (let k = 1; k <= n2; k++) {
    const t = start + delta * k / n2;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    push(cos * ex - sin * ey + cx, sin * ex + cos * ey + cy);
  }
}
var FLIPS = {
  none: [1, 1],
  horizontal: [-1, 1],
  vertical: [1, -1],
  both: [-1, -1]
};
function placeGlyph(glyph, box, rotation = 0, flip = "none") {
  const { width: w, height: h } = glyph;
  const [fx, fy] = FLIPS[flip] || FLIPS.none;
  const th = (+rotation || 0) * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const round2 = box.radius > 0;
  let reach = 0;
  for (const d of [glyph.secondary, glyph.primary]) {
    if (!d) continue;
    for (const [px, py] of outlinePoints(d)) {
      const dx = (px - w / 2) * fx;
      const dy = (py - h / 2) * fy;
      reach = Math.max(reach, round2 ? Math.hypot(dx, dy) : Math.max(Math.abs(cos * dx - sin * dy), Math.abs(sin * dx + cos * dy)));
    }
  }
  const bound = round2 ? box.radius : box.size / 2;
  let scale = box.size / Math.max(w, h);
  if (reach * scale > bound * (1 + 1e-9)) scale = bound / reach;
  const toGlyph = (X, Y) => {
    const dx = X - box.cx, dy = Y - box.cy;
    return [
      w / 2 + (cos * dx + sin * dy) / (fx * scale),
      h / 2 + (-sin * dx + cos * dy) / (fy * scale)
    ];
  };
  return { scale, fx, fy, toGlyph };
}

// src/defaults.js
var DEFAULTS = Object.freeze({
  // content
  ecLevel: "H",
  version: 0,
  // layout
  margin: 4,
  // quiet zone, in modules
  size: null,
  // px for width/height attrs; null = viewBox only
  // modules
  moduleStyle: "smooth",
  moduleScale: 1,
  // 0–1, fraction of the cell each module fills
  radius: null,
  // 0–0.5; null = the style's own default
  solidFunction: true,
  // keep timing/alignment patterns square
  // colour
  foreground: "#1e1e1e",
  background: "#ffffff",
  gradient: null,
  // { type:'linear'|'radial', from, to, rotation }
  // finder patterns
  eyeFrameStyle: "rounded",
  eyeBallStyle: "rounded",
  eyeFrameColor: null,
  // null = inherit the module paint
  eyeBallColor: null,
  // imagery
  image: null,
  // centre logo: any URL, though data: is safest
  icon: null,
  // centre glyph, { width, height, path }; see glyph.js
  imageSize: 0.22,
  // fraction of the code's width
  imageMargin: 0.4,
  // padding around it, in modules
  imageShape: "rounded",
  // 'none' | 'rounded' | 'circle'
  imageBackingColor: null,
  // null = the background, or white if there is none
  imageExcavate: true,
  // clear the modules behind it
  iconColor: null,
  // null = the module paint, gradient included
  iconSecondaryColor: null,
  // a two-tone glyph's other layer; null = iconColor
  iconOpacity: 1,
  iconSecondaryOpacity: 0.4,
  iconRotation: 0,
  // degrees clockwise
  iconFlip: "none",
  // 'none' | 'horizontal' | 'vertical' | 'both'
  backgroundImage: null,
  backgroundImageOpacity: 0.5,
  // caption
  title: "",
  subtitle: "",
  titleFont: '600 46px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  subtitleFont: '400 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  titleColor: "#1e1e1e",
  subtitleColor: "#6a6a6a",
  captionBackground: null,
  captionPosition: "top",
  // 'top' | 'bottom'
  // output
  idPrefix: null,
  // set it for byte-stable output; see below
  svgAttributes: null
  // extra attributes on the root <svg>
});
var EXPORT_OPTIONS = Object.freeze(["type", "width", "quality", "canvasBackground"]);

// src/analyse.js
var EC_CAPACITY = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };
var KNOWN_OPTIONS = [...Object.keys(DEFAULTS), ...EXPORT_OPTIONS];
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}
function suggest(word, candidates) {
  const lower = String(word).toLowerCase();
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = distance(lower, c.toLowerCase());
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(lower.length / 4)) ? ` Did you mean "${best}"?` : "";
}
var EC_LEVELS = [
  { id: "L", label: "L — 7%", capacity: 0.07 },
  { id: "M", label: "M — 15%", capacity: 0.15 },
  { id: "Q", label: "Q — 25%", capacity: 0.25 },
  { id: "H", label: "H — 30%", capacity: 0.3 }
];
function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((ch2) => ch2 + ch2).join("");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(s.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
var utf8Length = (s) => {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
};
function analyse(text, o, { count, version: version2 }) {
  const warnings = [];
  const add = (level, code, t) => warnings.push({ level, code, text: t });
  const registered = {
    moduleStyle: listModuleStyles().map((s) => s.id),
    eyeFrameStyle: listEyeFrameStyles().map((s) => s.id),
    eyeBallStyle: listEyeBallStyles().map((s) => s.id)
  };
  const drawn = (key) => registered[key].includes(o[key]) ? o[key] : "square";
  const moduleStyle = drawn("moduleStyle");
  const frameStyle = drawn("eyeFrameStyle");
  const ballStyle = drawn("eyeBallStyle");
  if (!String(text ?? "").trim()) {
    add("error", "empty", "There is nothing to encode. If this came from payload(), payloads.missing() says which fields it needs.");
  }
  const stops = o.gradient ? [o.gradient.from, o.gradient.to] : [o.foreground];
  const measurable = o.backgroundImage || !o.background;
  const ratios = measurable ? [] : stops.map((c) => contrastRatio(c, o.background)).filter((r) => r !== null);
  const ratio = ratios.length ? Math.min(...ratios) : null;
  const fgSample = ratios.length && o.gradient ? stops[stops.map((c) => contrastRatio(c, o.background)).indexOf(ratio)] : stops[0];
  if (ratio !== null && ratio < 3) {
    add(
      "error",
      "contrast",
      `Contrast is only ${ratio.toFixed(1)}:1. Below 3:1 most readers fail — darken the modules or lighten the background.`
    );
  } else if (ratio !== null && ratio < 5) {
    add(
      "warn",
      "contrast",
      `Contrast is ${ratio.toFixed(1)}:1. It will scan in good light, but 7:1 or more is safer for print.`
    );
  }
  const lf = luminance(fgSample);
  const lb = luminance(o.background);
  if (lf !== null && lb !== null && lf > lb) {
    add(
      "warn",
      "inverted",
      "Light modules on a dark background. Some older readers will not invert."
    );
  }
  let imageCoverage = 0;
  if (o.image || normaliseIcon(o.icon)) {
    const what = o.image ? "image" : "icon";
    const side = o.imageSize * count + o.imageMargin * 2;
    imageCoverage = side * side / (count * count);
    const budget = EC_CAPACITY[o.ecLevel] ?? 0.3;
    if (imageCoverage > budget) {
      add(
        "error",
        "image-coverage",
        `The ${what} covers ${(imageCoverage * 100).toFixed(0)}% of the code but level ${o.ecLevel} only recovers ${(budget * 100).toFixed(0)}%. Shrink it or raise error correction.`
      );
    } else if (imageCoverage > budget * 0.66) {
      add(
        "warn",
        "image-coverage",
        `The ${what} covers ${(imageCoverage * 100).toFixed(0)}% of a ${(budget * 100).toFixed(0)}% budget. It will scan, but there is little margin for damage.`
      );
    }
  }
  if (o.margin < 4) {
    add(
      o.margin < 2 ? "error" : "warn",
      "quiet-zone",
      `The quiet zone is ${o.margin} modules. The specification calls for 4.`
    );
  }
  if (o.moduleScale < 0.75 && moduleStyle !== "dots") {
    add(
      "warn",
      "module-scale",
      "Module size below 75% thins the pattern; test before printing small."
    );
  }
  const eye = eyeCompatibility(frameStyle, ballStyle);
  if (eye !== null && eye < WARN_BELOW) {
    const safe = safeCentresFor(frameStyle);
    const suggestion = safe.length ? ` Pair it with ${safe.slice(0, 3).map((s) => `"${s}"`).join(", ")} instead.` : "";
    add(
      eye < FAIL_BELOW ? "error" : "warn",
      "eye-pairing",
      `The "${frameStyle}" frame with the "${ballStyle}" centre decoded ${Math.round(eye * 100)}% of the time in testing: the light gap and the dark centre have to shrink together for a reader to recognise the finder pattern.${suggestion}`
    );
  }
  if (!o.solidFunction && !["square", "smooth", "fluid", "classy"].includes(moduleStyle)) {
    add(
      "warn",
      "function-patterns",
      `With solidFunction off, the "${moduleStyle}" shape breaks the timing and alignment patterns a reader uses to find the grid. In testing this style dropped well below half of decodes.`
    );
  }
  for (const k of Object.keys(o)) {
    if (!KNOWN_OPTIONS.includes(k)) {
      add("warn", "unknown-option", `There is no "${k}" option, so it was ignored.${suggest(k, KNOWN_OPTIONS)}`);
    }
  }
  for (const [key, kind] of [["moduleStyle", "module"], ["eyeFrameStyle", "finder frame"], ["eyeBallStyle", "finder centre"]]) {
    if (!registered[key].includes(o[key])) {
      add(
        "warn",
        "unknown-style",
        `There is no "${o[key]}" ${kind} style, so "square" was drawn instead.${suggest(o[key], registered[key])}`
      );
    }
  }
  return {
    version: version2,
    modules: count,
    ecLevel: o.ecLevel,
    bytes: utf8Length(String(text ?? "")),
    contrast: ratio,
    imageCoverage,
    warnings,
    get ok() {
      return !warnings.some((w) => w.level === "error");
    }
  };
}

// src/render.js
var NOMINAL = 1e3;
var uid = 0;
var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var attrs = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== void 0 && v !== "").map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
function fontSize(shorthand, fallback) {
  const m = /(\d+(?:\.\d+)?)px/.exec(shorthand || "");
  return m ? parseFloat(m[1]) : fallback;
}
function render(text, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const matrix2 = encode(text, { ecLevel: o.ecLevel, version: o.version });
  const { size: count, version: version2 } = matrix2;
  const style = getModuleStyle(o.moduleStyle);
  const radius = o.radius ?? style.defaultRadius ?? 0.5;
  const margin = Math.max(0, o.margin);
  const total = count + margin * 2;
  const cell = NOMINAL / total;
  const hasTitle = !!String(o.title).trim();
  const hasSub = !!String(o.subtitle).trim();
  const tSize = fontSize(o.titleFont, 46);
  const sSize = fontSize(o.subtitleFont, 30);
  const pad = 26;
  let bandH = 0;
  if (hasTitle) bandH += tSize * 1.25;
  if (hasSub) bandH += sSize * 1.35;
  if (bandH) bandH += pad * 2;
  let tuck = 0;
  if (bandH && !o.captionBackground && hasTitle !== hasSub) {
    const slack = hasTitle ? tSize * 0.25 : sSize * 0.35;
    tuck = pad + Math.min(slack, Math.max(0, (margin - 2) * cell));
    bandH -= tuck;
  }
  const atTop = o.captionPosition === "top";
  const codeY = bandH && atTop ? bandH : 0;
  const w = NOMINAL;
  const h = NOMINAL + bandH;
  const prefix = o.idPrefix || `qrs${++uid}`;
  const parts = [];
  const defs = [];
  let paint = o.foreground;
  if (o.gradient) {
    const gid = `${prefix}-g`;
    const stops = `<stop offset="0%" stop-color="${esc(o.gradient.from)}"/><stop offset="100%" stop-color="${esc(o.gradient.to)}"/>`;
    defs.push(o.gradient.type === "radial" ? `<radialGradient id="${gid}">${stops}</radialGradient>` : `<linearGradient id="${gid}" gradientTransform="rotate(${o.gradient.rotation || 0} 0.5 0.5)">${stops}</linearGradient>`);
    paint = `url(#${gid})`;
  }
  if (o.background) {
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${esc(o.background)}"/>`);
  }
  if (o.captionBackground && bandH) {
    parts.push(`<rect x="0" y="${atTop ? 0 : NOMINAL}" width="${w}" height="${bandH}" fill="${esc(o.captionBackground)}"/>`);
  }
  if (o.backgroundImage) {
    parts.push(`<image${attrs({
      href: o.backgroundImage,
      x: 0,
      y: codeY,
      width: NOMINAL,
      height: NOMINAL,
      opacity: o.backgroundImageOpacity,
      preserveAspectRatio: "xMidYMid slice"
    })}/>`);
  }
  const glyph = normaliseIcon(o.icon);
  const centre = !!(o.image || glyph);
  let hidden = () => false;
  if (centre && o.imageExcavate) {
    const half = o.imageSize * count / 2 + o.imageMargin;
    const mid = count / 2;
    hidden = (r, c) => Math.abs(r + 0.5 - mid) < half && Math.abs(c + 0.5 - mid) < half;
  }
  const dark2 = (r, c) => matrix2.isDark(r, c) && !isFinder(count, r, c) && !hidden(r, c);
  const fn = o.solidFunction ? functionModules(count, version2) : null;
  const squareStyle = { path: ({ x, y, size }) => roundedRect(x, y, size, [0, 0, 0, 0]) };
  const inset = (1 - o.moduleScale) / 2;
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!dark2(r, c)) continue;
      const isFn = fn && fn.has(`${r},${c}`);
      const use = isFn ? squareStyle : style;
      const scale = isFn ? 1 : o.moduleScale;
      const off = isFn ? 0 : inset;
      d += use.path({
        x: c + off,
        y: r + off,
        size: scale,
        radius: radius * scale,
        row: r,
        col: c,
        near: {
          up: dark2(r - 1, c),
          down: dark2(r + 1, c),
          left: dark2(r, c - 1),
          right: dark2(r, c + 1),
          upLeft: dark2(r - 1, c - 1),
          upRight: dark2(r - 1, c + 1),
          downLeft: dark2(r + 1, c - 1),
          downRight: dark2(r + 1, c + 1)
        }
      });
    }
  }
  if (style.fillets) {
    const fr = radius * o.moduleScale;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!dark2(r, c) || fn && fn.has(`${r},${c}`)) continue;
        if (dark2(r - 1, c) && dark2(r, c - 1) && !dark2(r - 1, c - 1)) d += fillet(c, r, fr, -1, -1);
        if (dark2(r - 1, c) && dark2(r, c + 1) && !dark2(r - 1, c + 1)) d += fillet(c + 1, r, fr, 1, -1);
        if (dark2(r + 1, c) && dark2(r, c + 1) && !dark2(r + 1, c + 1)) d += fillet(c + 1, r + 1, fr, 1, 1);
        if (dark2(r + 1, c) && dark2(r, c - 1) && !dark2(r + 1, c - 1)) d += fillet(c, r + 1, fr, -1, 1);
      }
    }
  }
  const frame = getEyeFrameStyle(o.eyeFrameStyle);
  const ball = getEyeBallStyle(o.eyeBallStyle);
  let frameD = "";
  let ballD = "";
  for (const [er, ec] of [[0, 0], [0, count - 7], [count - 7, 0]]) {
    frameD += frame.path({ x: ec, y: er, row: er, col: ec });
    ballD += ball.path({ x: ec, y: er, row: er, col: ec });
  }
  const g = [];
  if (d) g.push(`<path d="${d}" fill="${esc(paint)}"/>`);
  g.push(`<path d="${frameD}" fill="${esc(o.eyeFrameColor || paint)}" fill-rule="evenodd"/>`);
  g.push(`<path d="${ballD}" fill="${esc(o.eyeBallColor || paint)}"/>`);
  parts.push(
    `<g transform="translate(${round(margin * cell)} ${round(codeY + margin * cell)}) scale(${round(cell)})">` + g.join("") + "</g>"
  );
  if (centre) {
    const lw = o.imageSize * NOMINAL;
    const lx = (NOMINAL - lw) / 2;
    const ly = codeY + (NOMINAL - lw) / 2;
    const padPx = o.imageMargin * cell;
    if (o.imageShape !== "none") {
      const bx = lx - padPx;
      const by = ly - padPx;
      const bs = lw + padPx * 2;
      const fill = o.imageBackingColor || o.background || "#ffffff";
      parts.push(o.imageShape === "circle" ? `<circle${attrs({ cx: round(bx + bs / 2), cy: round(by + bs / 2), r: round(bs / 2), fill })}/>` : `<rect${attrs({ x: round(bx), y: round(by), width: round(bs), height: round(bs), rx: round(bs * 0.18), fill })}/>`);
    }
    if (o.image) {
      parts.push(`<image${attrs({
        href: o.image,
        x: round(lx),
        y: round(ly),
        width: round(lw),
        height: round(lw),
        preserveAspectRatio: "xMidYMid meet"
      })}/>`);
    }
    if (glyph) {
      const radius2 = o.imageShape === "circle" ? lw / 2 + padPx : null;
      parts.push(drawIcon(glyph, o, {
        box: { cx: NOMINAL / 2, cy: codeY + NOMINAL / 2, size: lw, radius: radius2 },
        paint,
        gradientId: `${prefix}-ig`,
        defs,
        span: count * cell
      }));
    }
  }
  if (bandH) {
    let ty = (atTop ? 0 : NOMINAL - tuck) + pad;
    if (hasTitle) {
      ty += tSize;
      parts.push(`<text x="${w / 2}" y="${round(ty)}" fill="${esc(o.titleColor)}" text-anchor="middle" style="font:${esc(o.titleFont)}">${esc(o.title)}</text>`);
      ty += tSize * 0.25;
    }
    if (hasSub) {
      ty += sSize;
      parts.push(`<text x="${w / 2}" y="${round(ty)}" fill="${esc(o.subtitleColor)}" text-anchor="middle" style="font:${esc(o.subtitleFont)}">${esc(o.subtitle)}</text>`);
    }
  }
  const root = attrs({
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: `0 0 ${w} ${round(h)}`,
    width: o.size ?? void 0,
    height: o.size ? round(o.size * (h / w)) : void 0,
    "shape-rendering": "geometricPrecision",
    ...o.svgAttributes || {}
  });
  const svg = `<svg${root}>` + (defs.length ? `<defs>${defs.join("")}</defs>` : "") + parts.join("") + "</svg>";
  return {
    svg,
    width: w,
    height: h,
    info: analyse(text, o, { count, version: version2, radius })
  };
}
function drawIcon(glyph, o, { box, paint, gradientId, defs, span }) {
  const { scale, fx, fy, toGlyph } = placeGlyph(glyph, box, o.iconRotation, o.iconFlip);
  let primary = o.iconColor || paint;
  if (!o.iconColor && o.gradient) {
    const stops = `<stop offset="0%" stop-color="${esc(o.gradient.from)}"/><stop offset="100%" stop-color="${esc(o.gradient.to)}"/>`;
    if (o.gradient.type === "radial") {
      const [cx, cy] = toGlyph(box.cx, box.cy);
      defs.push(`<radialGradient${attrs({
        id: gradientId,
        gradientUnits: "userSpaceOnUse",
        cx: round(cx),
        cy: round(cy),
        r: round(span / 2 / scale)
      })}>${stops}</radialGradient>`);
    } else {
      const a = (o.gradient.rotation || 0) * Math.PI / 180;
      const ux = Math.cos(a) * span / 2, uy = Math.sin(a) * span / 2;
      const [x1, y1] = toGlyph(box.cx - ux, box.cy - uy);
      const [x2, y2] = toGlyph(box.cx + ux, box.cy + uy);
      defs.push(`<linearGradient${attrs({
        id: gradientId,
        gradientUnits: "userSpaceOnUse",
        x1: round(x1),
        y1: round(y1),
        x2: round(x2),
        y2: round(y2)
      })}>${stops}</linearGradient>`);
    }
    primary = `url(#${gradientId})`;
  }
  const secondary = o.iconSecondaryColor || primary;
  const unit = (v) => Math.min(1, Math.max(0, Number.isFinite(+v) ? +v : 1));
  const layer = (d, fill, opacity) => d ? `<path${attrs({ d, fill, opacity: unit(opacity) < 1 ? round(unit(opacity)) : null })}/>` : "";
  const transform = `translate(${round(box.cx)} ${round(box.cy)})` + (o.iconRotation ? ` rotate(${round(+o.iconRotation)})` : "") + ` scale(${round(fx * scale)} ${round(fy * scale)}) translate(${round(-glyph.width / 2)} ${round(-glyph.height / 2)})`;
  return `<g transform="${transform}">` + layer(glyph.secondary, secondary, o.iconSecondaryOpacity) + layer(glyph.primary, primary, o.iconOpacity) + "</g>";
}
function round(v) {
  return Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : +v.toFixed(3);
}

// src/payloads.js
function esc2(s) {
  return String(s || "").replace(/([\\;,:"])/g, "\\$1");
}
function vesc(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
var blank = (v) => !String(v ?? "").trim();
function stamp(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(String(d ?? "").trim());
  if (!m) return null;
  const [, y, mo, da, h, mi, se] = m;
  return h === void 0 ? { param: ";VALUE=DATE", value: `${y}${mo}${da}` } : { param: "", value: `${y}${mo}${da}T${h}${mi}${se ?? "00"}` };
}
var coordinate = (v, limit) => {
  const s = String(v ?? "").trim();
  return /^[-+]?\d+(\.\d+)?$/.test(s) && Math.abs(+s) <= limit;
};
var TYPES = [
  {
    id: "url",
    label: "Link",
    hint: "Opens a web page. Include the scheme — bare domains are treated as plain text by some readers.",
    fields: [{ key: "url", label: "URL", type: "text", placeholder: "https://example.org", width: "full", required: true }],
    build: (v) => (v.url || "").trim()
  },
  {
    id: "text",
    label: "Text",
    hint: "Plain text. Most phones will offer to search for it; dedicated scanners just display it.",
    fields: [{ key: "text", label: "Text", type: "textarea", width: "full", required: true }],
    build: (v) => v.text || ""
  },
  {
    id: "wifi",
    label: "Wi-Fi",
    hint: "Joins a network. Supported by iOS 11+ and Android 10+ from the camera; older phones need a scanner app.",
    fields: [
      { key: "ssid", label: "Network name", type: "text", width: "full", required: true },
      { key: "password", label: "Password", type: "text", width: "full" },
      {
        key: "encryption",
        label: "Security",
        type: "select",
        options: [["WPA", "WPA / WPA2 / WPA3"], ["WEP", "WEP"], ["nopass", "Open — no password"]],
        value: "WPA"
      },
      { key: "hidden", label: "Hidden network", type: "checkbox" }
    ],
    // A secured network with no password is one nobody can join.
    needs: (v) => v.encryption !== "nopass" && blank(v.password) ? ["password"] : [],
    build: (v) => {
      const t = v.encryption === "nopass" ? "nopass" : v.encryption || "WPA";
      let s = `WIFI:T:${t};S:${esc2(v.ssid)};`;
      if (t !== "nopass") s += `P:${esc2(v.password)};`;
      if (v.hidden) s += "H:true;";
      return s + ";";
    }
  },
  {
    id: "vcard",
    label: "Contact",
    hint: "A contact card. vCard 3.0, which is the version both iOS and Android import without complaint.",
    fields: [
      { key: "first", label: "First name", type: "text" },
      { key: "last", label: "Last name", type: "text" },
      { key: "org", label: "Organisation", type: "text", width: "full" },
      { key: "title", label: "Job title", type: "text", width: "full" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "url", label: "Website", type: "text", width: "full" },
      { key: "address", label: "Address", type: "text", width: "full" },
      { key: "note", label: "Note", type: "textarea", width: "full" }
    ],
    // vCard 3.0 requires a formatted name; an organisation will do.
    needs: (v) => blank(v.first) && blank(v.last) && blank(v.org) ? ["first", "last", "org"] : [],
    build: (v) => {
      const L = ["BEGIN:VCARD", "VERSION:3.0"];
      L.push(`N:${vesc(v.last)};${vesc(v.first)};;;`);
      L.push(`FN:${vesc([v.first, v.last].filter(Boolean).join(" ") || v.org)}`);
      if (v.org) L.push(`ORG:${vesc(v.org)}`);
      if (v.title) L.push(`TITLE:${vesc(v.title)}`);
      if (v.phone) L.push(`TEL;TYPE=CELL:${vesc(v.phone)}`);
      if (v.email) L.push(`EMAIL;TYPE=INTERNET:${vesc(v.email)}`);
      if (v.url) L.push(`URL:${vesc(v.url)}`);
      if (v.address) L.push(`ADR;TYPE=WORK:;;${vesc(v.address)};;;;`);
      if (v.note) L.push(`NOTE:${vesc(v.note)}`);
      L.push("END:VCARD");
      return L.join("\n");
    }
  },
  {
    id: "email",
    label: "Email",
    hint: "Opens a pre-addressed message in the default mail client.",
    fields: [
      { key: "to", label: "To", type: "text", width: "full", required: true },
      { key: "subject", label: "Subject", type: "text", width: "full" },
      { key: "body", label: "Message", type: "textarea", width: "full" }
    ],
    build: (v) => {
      const q = [];
      if (v.subject) q.push("subject=" + encodeURIComponent(v.subject));
      if (v.body) q.push("body=" + encodeURIComponent(v.body));
      return `mailto:${(v.to || "").trim()}${q.length ? "?" + q.join("&") : ""}`;
    }
  },
  {
    id: "sms",
    label: "SMS",
    hint: "Opens a text message. Include the country code for anything crossing a border.",
    fields: [
      { key: "number", label: "Number", type: "text", width: "full", required: true },
      { key: "message", label: "Message", type: "textarea", width: "full" }
    ],
    build: (v) => `SMSTO:${(v.number || "").trim()}:${v.message || ""}`
  },
  {
    id: "tel",
    label: "Phone",
    hint: "Dials a number. Phones ask before calling, so this is safe to put on a poster.",
    fields: [{ key: "number", label: "Number", type: "text", width: "full", placeholder: "+44 20 7405 7686", required: true }],
    build: (v) => `tel:${(v.number || "").replace(/\s+/g, "")}`
  },
  {
    id: "geo",
    label: "Location",
    hint: "Opens a point in the default maps app.",
    fields: [
      { key: "lat", label: "Latitude", type: "text", placeholder: "51.5145", required: true },
      { key: "lon", label: "Longitude", type: "text", placeholder: "-0.1167", required: true },
      { key: "label", label: "Place name", type: "text", width: "full" }
    ],
    // Filled is not enough: a maps app wants numbers, in range.
    needs: (v) => [
      ...coordinate(v.lat, 90) ? [] : ["lat"],
      ...coordinate(v.lon, 180) ? [] : ["lon"]
    ],
    build: (v) => {
      const at = `${String(v.lat).trim()},${String(v.lon).trim()}`;
      return v.label ? `geo:${at}?q=${at}(${encodeURIComponent(v.label)})` : `geo:${at}`;
    }
  },
  {
    id: "event",
    label: "Event",
    hint: "Adds an entry to the calendar. Times are written as given, without a timezone, so they read as local.",
    fields: [
      { key: "title", label: "Event", type: "text", width: "full", required: true },
      { key: "location", label: "Location", type: "text", width: "full" },
      { key: "start", label: "Starts", type: "datetime-local", required: true },
      { key: "end", label: "Ends", type: "datetime-local" },
      { key: "description", label: "Description", type: "textarea", width: "full" }
    ],
    // A start a calendar cannot read is as good as none.
    needs: (v) => [
      ...blank(v.start) || stamp(v.start) ? [] : ["start"],
      ...blank(v.end) || stamp(v.end) ? [] : ["end"]
    ],
    build: (v) => {
      const L = ["BEGIN:VEVENT"];
      const start = stamp(v.start);
      const end = stamp(v.end);
      if (v.title) L.push(`SUMMARY:${vesc(v.title)}`);
      if (v.location) L.push(`LOCATION:${vesc(v.location)}`);
      if (start) L.push(`DTSTART${start.param}:${start.value}`);
      if (end) L.push(`DTEND${end.param}:${end.value}`);
      if (v.description) L.push(`DESCRIPTION:${vesc(v.description)}`);
      L.push("END:VEVENT");
      return L.join("\n");
    }
  }
];
var byId = (id) => TYPES.find((t) => t.id === id) || TYPES[0];
function missing(id, values = {}) {
  const spec = byId(id);
  const v = values || {};
  const out = new Set(spec.fields.filter((f) => f.required && blank(v[f.key])).map((f) => f.key));
  for (const k of spec.needs ? spec.needs(v) : []) out.add(k);
  return spec.fields.map((f) => f.key).filter((k) => out.has(k));
}
function defaults(id) {
  const out = {};
  for (const f of byId(id).fields) out[f.key] = f.value ?? (f.type === "checkbox" ? false : "");
  return out;
}

// src/sample.js
var SAMPLE = ["01110", "11001", "10111", "11100", "01011"];
var near = (r, c) => {
  const at = (rr, cc) => rr >= 0 && cc >= 0 && rr < 5 && cc < 5 && SAMPLE[rr][cc] === "1";
  return {
    up: at(r - 1, c),
    down: at(r + 1, c),
    left: at(r, c - 1),
    right: at(r, c + 1),
    upLeft: at(r - 1, c - 1),
    upRight: at(r - 1, c + 1),
    downLeft: at(r + 1, c - 1),
    downRight: at(r + 1, c + 1)
  };
};
var dark = (r, c) => r >= 0 && c >= 0 && r < 5 && c < 5 && SAMPLE[r][c] === "1";
function moduleSample(styleId, { color = "currentColor", radius } = {}) {
  const style = getModuleStyle(styleId);
  const r0 = radius ?? style.defaultRadius ?? 0.5;
  let d = "";
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (!dark(r, c)) continue;
      d += style.path({ x: c, y: r, size: 1, radius: r0, row: r, col: c, near: near(r, c) });
    }
  }
  if (style.fillets) {
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (!dark(r, c)) continue;
        if (dark(r - 1, c) && dark(r, c - 1) && !dark(r - 1, c - 1)) d += fillet(c, r, r0, -1, -1);
        if (dark(r - 1, c) && dark(r, c + 1) && !dark(r - 1, c + 1)) d += fillet(c + 1, r, r0, 1, -1);
        if (dark(r + 1, c) && dark(r, c + 1) && !dark(r + 1, c + 1)) d += fillet(c + 1, r + 1, r0, 1, 1);
        if (dark(r + 1, c) && dark(r, c - 1) && !dark(r + 1, c - 1)) d += fillet(c, r + 1, r0, -1, 1);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><path d="${d}" fill="${color}"/></svg>`;
}
function eyeSample(frameId, ballId, { color = "currentColor" } = {}) {
  const frame = getEyeFrameStyle(frameId);
  const ball = getEyeBallStyle(ballId);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7"><path d="${frame.path({ x: 0, y: 0, row: 0, col: 0 })}" fill="${color}" fill-rule="evenodd"/><path d="${ball.path({ x: 0, y: 0, row: 0, col: 0 })}" fill="${color}"/></svg>`;
}

// src/browser.js
var needDOM = (what) => {
  if (typeof document === "undefined") {
    throw new Error(`QRStudio.${what}() needs a DOM. In Node, use toString() and write the SVG, or rasterise it with a library such as resvg.`);
  }
};
function toElement(text, options) {
  needDOM("toElement");
  const { svg } = render(text, options);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("QR Studio produced invalid SVG: " + err.textContent.trim());
  return document.importNode(doc.documentElement, true);
}
async function toCanvas(text, options = {}) {
  needDOM("toCanvas");
  const { width = 1024, canvasBackground = null } = options;
  const { svg, width: vw, height: vh } = render(text, options);
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width);
    canvas.height = Math.round(width * (vh / vw));
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (canvasBackground) {
        ctx.fillStyle = canvasBackground;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterise the SVG."));
    };
    img.src = url;
  });
}
var MIME = { svg: "image/svg+xml", png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" };
async function toBlob(text, options = {}) {
  const type = (options.type || "png").toLowerCase();
  if (!MIME[type]) throw new Error(`Unknown export type "${type}". Use svg, png, jpeg or webp.`);
  if (type === "svg") {
    const { svg } = render(text, options);
    return new Blob([svg], { type: MIME.svg });
  }
  const canvasBackground = options.canvasBackground ?? (type === "jpeg" || type === "jpg" ? options.background ?? "#ffffff" : null);
  const canvas = await toCanvas(text, { ...options, canvasBackground });
  return new Promise((res, rej) => canvas.toBlob(
    (b) => b ? res(b) : rej(new Error("The browser refused to encode that image.")),
    MIME[type],
    options.quality ?? 0.92
  ));
}
async function toDataURL(text, options = {}) {
  const type = (options.type || "png").toLowerCase();
  if (type === "svg") {
    const { svg } = render(text, options);
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  const canvas = await toCanvas(text, options);
  return canvas.toDataURL(MIME[type] || "image/png", options.quality ?? 0.92);
}
async function download(text, filename = "qr-code", options = {}) {
  needDOM("download");
  const type = (options.type || "png").toLowerCase();
  const blob = await toBlob(text, options);
  const ext = type === "jpeg" ? "jpg" : type;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
  return blob;
}
function mount(target, text, options) {
  needDOM("mount");
  const host = typeof target === "string" ? document.querySelector(target) : target;
  if (!host) throw new Error(`QRStudio.mount(): no element matched ${JSON.stringify(target)}.`);
  const el = toElement(text, options);
  host.textContent = "";
  host.appendChild(el);
  return el;
}
async function copyToClipboard(text, options = {}) {
  var _a;
  needDOM("copyToClipboard");
  if (!((_a = navigator.clipboard) == null ? void 0 : _a.write)) return false;
  try {
    const blob = await toBlob(text, { ...options, type: "png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

// src/index.js
var version = "1.1.0";
function toSVGString(text, options) {
  return render(text, options).svg;
}
function payload(type, fields) {
  const spec = TYPES.find((t) => t.id === type);
  if (!spec) {
    throw new Error(`Unknown payload type "${type}". Known types: ${TYPES.map((t) => t.id).join(", ")}.`);
  }
  if (missing(type, fields).length) return "";
  return spec.build(fields || {});
}
function matrix(text, options = {}) {
  const m = encode(text, options);
  const fn = functionModules(m.size, m.version);
  return {
    size: m.size,
    version: m.version,
    isDark: m.isDark,
    /** True for the three 7x7 finder patterns. */
    isFinder: (r, c) => isFinder(m.size, r, c),
    /** True for timing and alignment modules — keep these square. */
    isFunction: (r, c) => fn.has(`${r},${c}`),
    /** A plain boolean[][], for the impatient. */
    toArray() {
      return Array.from({ length: m.size }, (_, r) => Array.from({ length: m.size }, (_2, c) => m.isDark(r, c)));
    }
  };
}
function check(text, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const m = encode(text, { ecLevel: o.ecLevel, version: o.version });
  return analyse(text, o, { count: m.size, version: m.version });
}
var styles = {
  get modules() {
    return listModuleStyles();
  },
  get eyeFrames() {
    return listEyeFrameStyles();
  },
  get eyeBalls() {
    return listEyeBallStyles();
  },
  sample: { module: moduleSample, eye: eyeSample }
};
var payloads = {
  get types() {
    return TYPES.map(({ id, label, hint, fields }) => ({ id, label, hint, fields }));
  },
  build: payload,
  fields: (id) => byId(id).fields,
  defaults,
  missing
};
var index_default = {
  version,
  render,
  toString: toSVGString,
  toSVG: toSVGString,
  toElement,
  toCanvas,
  toBlob,
  toDataURL,
  download,
  mount,
  copyToClipboard,
  matrix,
  check,
  analyse: check,
  analyze: check,
  encode,
  payload,
  payloads,
  styles,
  defaults: DEFAULTS,
  errorCorrectionLevels: EC_LEVELS,
  contrastRatio,
  luminance,
  eyeCompatibility,
  safeCentresFor,
  defineModuleStyle,
  defineEyeFrameStyle,
  defineEyeBallStyle,
  connectedCorners,
  shapes: shapes_exports,
  moduleSample,
  eyeSample,
  PayloadTooLongError
};
export {
  EC_CAPACITY,
  NOMINAL,
  PayloadTooLongError,
  check as analyse,
  check as analyze,
  check,
  connectedCorners,
  contrastRatio,
  copyToClipboard,
  index_default as default,
  DEFAULTS as defaults,
  defineEyeBallStyle,
  defineEyeFrameStyle,
  defineModuleStyle,
  download,
  encode,
  EC_LEVELS as errorCorrectionLevels,
  eyeCompatibility,
  eyeSample,
  luminance,
  matrix,
  moduleSample,
  mount,
  payload,
  payloads,
  render,
  safeCentresFor,
  shapes_exports as shapes,
  styles,
  toBlob,
  toCanvas,
  toDataURL,
  toElement,
  toSVGString as toSVG,
  toSVGString as toString,
  version
};
