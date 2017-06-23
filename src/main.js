(function () {
'use strict';

const CNV = CNVR();

let BOXES;
let BOX_CHANGED;
let PANNING;
let PAN_TRANSLATE;
let TEMP_PAN_TRANSLATE;
let DRAW_REQUEST_IN_FLIGHT;
let TOUCH_ORIGIN;
let TARGET_BOX;
let SAVE_HASH;
let CANCEL_PROMPT;

let SEMANTIC_ZOOM;
let DEEPEST;
let SHRINK_CUTOFF;
let HANDLE_SHRINK_ROLLOFF;
let SHRINK_ROLLOFF0;
let SHRINK_ROLLOFF1;
let SHRINK_ROLLOFF2;

let ZOOMING_BOX;
let ZOOM_CHANGED;
let LAST_ZOOM_COORDS;
let PINCH_DISTANCE;
let ZOOM_TARGET;

let CURSOR_BEFORE_BOX;
let CURSOR_AFTER_BOX;
let CURSOR_INSIDE_BOX;

const resetGlobals = function () {
  BOXES = [];
  BOX_CHANGED = true;
  PANNING = false;
  PAN_TRANSLATE = {x: 0, y: 0};
  TEMP_PAN_TRANSLATE = {x: 0, y: 0};
  if (DRAW_REQUEST_IN_FLIGHT) {
    window.cancelAnimationFrame(DRAW_REQUEST_IN_FLIGHT);
  }
  DRAW_REQUEST_IN_FLIGHT = false;
  TOUCH_ORIGIN = {x: 0, y: 0};
  TARGET_BOX = null;
  SAVE_HASH = '#';
  CANCEL_PROMPT = null;

  SEMANTIC_ZOOM = 0;
  DEEPEST = 0;
  SHRINK_CUTOFF = 0;
  HANDLE_SHRINK_ROLLOFF = 0;
  SHRINK_ROLLOFF0 = 0;
  SHRINK_ROLLOFF1 = 0;
  SHRINK_ROLLOFF2 = 0;

  ZOOMING_BOX = null;
  ZOOM_CHANGED = false;
  LAST_ZOOM_COORDS = null;
  PINCH_DISTANCE = null;
  ZOOM_TARGET = null;

  CURSOR_BEFORE_BOX = null;
  CURSOR_AFTER_BOX = null;
  CURSOR_INSIDE_BOX = null;
};

const HOLD_TIMEOUT1_MS = 500;
const HOLD_TIMEOUT2_MS = 500;
const PAN_DIST = 20;
const HANDLE_WIDTH = 40;
const BOX_BORDER = 4;
const EMPTY_WIDTH = 120;
const EMPTY_BOX_WIDTH = EMPTY_WIDTH + 2 * BOX_BORDER;
const EMPTY_BOX_HEIGHT = HANDLE_WIDTH + 2 * BOX_BORDER;
const MIN_TEXT_WIDTH = HANDLE_WIDTH;
const LEVEL_HUES = [[240],[0]];
const TEXT_COLOR = '#000000';
const FONT_SIZE = 18;
const ZOOM_LEVEL_PIXELS = 80;
const SHRINK0 = 1/2;
const MIN_SHRINK = SHRINK0/16;
const TOO_SMALL_THRESH = 0.75;

const SELECTION_LINE_COLOR = '#808080';
const SELECTED_LINE_WIDTH = 2;

const PROMPT_INPUT = document.getElementById('prompt-input');
const PROMPT_FORM = document.getElementById('prompt-form');
const PROMPT = document.getElementById('prompt');

const OPEN_SYM = '(';
const CLOSE_SYM = ')';
const ROW_SYM = ',';
const ID_SYM = "'";
const ESC_SYM = '~';

/*
  box properties

  under
  x, y: relative to row if under exists, else absolute
  w, h: now only temporary, generated through updateAllBoxes
  level: >= 0
  rows[x]: {
    x, y: relative to under
    w, h
    cells[x]: box
  }
  rows[] will exist but could be empty, rows[].cells[] cannot be empty
  idx: index in whatever array this box is in (currently cells or BOXES)
  rowIdx: row within under, in this case idx is the index in cells
  text
  textWidth
*/

const findIntersectingBox = function ({x, y, boxes = BOXES, first = -1}) {
  if (first === -1) {
    first = boxes.length - 1;
  }
  for (let i = first; i >= 0; i --) {
    const b = boxes[i];
    const bxm = b.x + b.w;
    const bym = b.y + b.h;
    if (x >= b.x && x < bxm && y >= b.y && y < bym) {
      for (let ri = b.rows.length - 1; ri >= 0; ri --) {
        const r = b.rows[ri];
        const child =
          findIntersectingBox({x: x - b.x - r.x, y: y - b.y - r.y,
                               boxes: r.cells});
        if (child) {
          return child;
        }
      }

      return b;
    }
  }

  return null;
};

const convertToBoxXY = function (box, {x, y}) {
  if (box.under) {
    const row = box.under.rows[box.rowIdx];
    x -= box.x + row.x;
    y -= box.y + row.y;
    return convertToBoxXY(box.under, {x, y});
  }
  return {x: x - box.x, y: y - box.y};
};

const convertToAbsoluteXY = function (box, {x, y}) {
  if (box.under) {
    const row = box.under.rows[box.rowIdx];
    x += box.x + row.x;
    y += box.y + row.y;
    return convertToAbsoluteXY(box.under, {x, y});
  }
  return {x: x + box.x, y: y + box.y}
};

const createBox = function (p, under = null) {
  const newBox = {x: 0, y: 0, rows: [], under, level: 0};

  if (under) {
    newBox.level = under.level + 1;
  } else {
    BOXES.push(newBox);
    newBox.idx = BOXES.indexOf(newBox);
  }

  newBox.w = EMPTY_BOX_WIDTH;
  newBox.h = EMPTY_BOX_HEIGHT;

  if (p) {
    newBox.x = p.x - newBox.w/2
    newBox.y = p.y - newBox.h/2;
  }

  BOX_CHANGED = true;

  return newBox;
};

const removeBox = function (box) {
  const idx = box.idx;
  box.idx = -1;

  let removed;

  if (box.under) {
    const under = box.under;
    const rowIdx = box.rowIdx;
    const row = under.rows[rowIdx];
    removed = row.cells.splice(idx, 1)[0];
    box.rowIdx = -1;
    if (row.cells.length === 0) {
      under.rows.splice(rowIdx, 1);
      reindexRows(under.rows);
    } else {
      reindexBoxes(row.cells);
    }

  } else {
    removed = BOXES.splice(idx, 1)[0];
    reindexBoxes();
  }

  BOX_CHANGED = true;

  return removed;
};

const reindexBoxes = function (list = BOXES, first = 0) {
  for (let i = first; i < list.length; i ++) {
    list[i].idx = i;
  }
};

const reindexRows = function (rows) {
  for (let i = 0; i < rows.length; i ++) {
    for (let j = 0; j < rows[i].cells.length; j ++) {
      rows[i].cells[j].idx = j;
      rows[i].cells[j].rowIdx = i;
    }
  }
};

const updateBoxRows = function (box, callUp = true) {
  // Set position for the rows of this box based on their sizes, then set the
  // size of this box from that.
  // Also calls up to update the parent box since this box's size could
  // have changed (updateRowCells on the row this box is in and updateBoxRows
  // on the parent box)

  const hs = getHandleShrinkage(box);
  const handle = HANDLE_WIDTH * hs;
  let w = 0;
  let h = BOX_BORDER;

  box.rows.forEach(function (row) {
    row.x = BOX_BORDER + handle;
    row.y = h;

    w = Math.max(w, row.w);
    h += row.h + BOX_BORDER;
  });

  if (box.rows.length === 0) {
    const s = getTextShrinkage(box);
    if (typeof box.textWidth === 'number') {
      box.w = BOX_BORDER * 2 + (box.textWidth * s);
      box.h = BOX_BORDER * 2 + FONT_SIZE * 1.5 * s;
    } else {
      box.w = EMPTY_BOX_WIDTH * s;
      box.h = EMPTY_BOX_HEIGHT * s;
    }
  } else {
    box.w = w + 2 * (BOX_BORDER + handle);
    box.h = h;
  }

  if (callUp && box.under) {
    updateRowCells(box.under.rows[box.rowIdx], box);
    updateBoxRows(box.under);
  }
};

const updateRowCells = function (row, box) {
  // Set the position of each cell (box) based on the size of previous boxes,
  // and update the size of the row.
  let h = 0;
  let w = 0;

  row.cells.forEach(function (cell, idx) {
    cell.x = w;
    cell.y = 0;

    w += cell.w + BOX_BORDER;
    h = Math.max(h, cell.h);
  });

  row.w = w - BOX_BORDER;
  row.h = h;
};

const recalculateDeepestInner = function (box, depth) {
  box.level = depth;
  DEEPEST = Math.max(DEEPEST, depth);
  box.rows.forEach(function (row) {
    row.cells.forEach(function (cell) {
      recalculateDeepestInner(cell, depth + 1);
    });
  });
};

const recalculateDeepest = function (box) {
  DEEPEST = 0;
  if (BOXES.length > 0) {
    recalculateDeepestInner(BOXES[0], 0);
  }
  updateZoom();
};

const updateAllBoxesInner = function (box) {
  box.rows.forEach(function (row) {
    row.cells.forEach(function (cell) {
      updateAllBoxesInner(cell);
    });
    updateRowCells(row, box);
  });
  updateBoxRows(box, false);
};
const updateAllBoxes = function () {
  recalculateDeepest();
  BOXES.forEach(updateAllBoxesInner);
};

const setZoom = function (newZoom, p) {
  SEMANTIC_ZOOM = newZoom;
  if (p) {
    LAST_ZOOM_COORDS = adjustForPanAndZoom(p);
  } else {
    LAST_ZOOM_COORDS = null;
  }
  ZOOM_CHANGED = true;
  updateZoom();
}

const updateZoom = function() {
  if (SEMANTIC_ZOOM < -ZOOM_LEVEL_PIXELS * DEEPEST) {
    SEMANTIC_ZOOM = -ZOOM_LEVEL_PIXELS * DEEPEST;
  }

  if (SEMANTIC_ZOOM < 0) {
    const nz = SEMANTIC_ZOOM / -ZOOM_LEVEL_PIXELS;
    const rnz = Math.floor(nz);
    SHRINK_CUTOFF = DEEPEST - rnz;
    const s = 1 - (nz - rnz);
    HANDLE_SHRINK_ROLLOFF = s;
    SHRINK_ROLLOFF0 = Math.max(s, SHRINK0);
    SHRINK_ROLLOFF1 = SHRINK0 * lerp01(.25, 1, s);
    SHRINK_ROLLOFF2 = SHRINK0 * lerp01(.0625, .25, s);
  } else {
    SEMANTIC_ZOOM = 0;
    SHRINK_CUTOFF = DEEPEST;
    HANDLE_SHRINK_ROLLOFF = 1;
    SHRINK_ROLLOFF0 = 1;
    SHRINK_ROLLOFF1 = 1;
    SHRINK_ROLLOFF2 = 1;
  }

  requestDraw();
};

const getHandleShrinkage = function (box, noRowBonus) {
  let level = box.level;
  if (box.rows.length !== 0 && !noRowBonus) {
    level ++;
  }

  if (level > SHRINK_CUTOFF) {
    return 0;
  } else if (level === SHRINK_CUTOFF) {
    return HANDLE_SHRINK_ROLLOFF;
  } else {
    return 1;
  }

};

const getTextShrinkage = function (box, noRowBonus) {
  let level = box.level;
  if (box.rows.length !== 0 && !noRowBonus) {
    level ++;
  }

  if (level > SHRINK_CUTOFF + 2) {
    return MIN_SHRINK;
  } else if (level === SHRINK_CUTOFF + 2) {
    return SHRINK_ROLLOFF2; 
  } else if (level === SHRINK_CUTOFF + 1) {
    return SHRINK_ROLLOFF1;
  } else if (level === SHRINK_CUTOFF) {
    return SHRINK_ROLLOFF0;
  } else {
    return 1;
  }

};

const zoomToBox = function (box, touch) {
  if (getHandleShrinkage(box) > TOO_SMALL_THRESH) {
    return;
  }
  let minLevel = DEEPEST - box.level;
  if (box.rows.length !== 0) {
    minLevel --;
  }
  setZoom(-ZOOM_LEVEL_PIXELS * minLevel, touch);
};

const zoomOut = function () {
  recalculateDeepest();
  setZoom(-ZOOM_LEVEL_PIXELS * DEEPEST - 1, null);
};

const adjustForPanAndZoom = function ({x,y}) {
  return {x: x - PAN_TRANSLATE.x,
          y: y - PAN_TRANSLATE.y};
};

const lerp01 = function (start, end, t) {
  return t * (end-start) + start;
};
const lerp = function (start, end, t, tmin, tmax) {
  return lerp01(start, end, (t-tmin)/(tmax-tmin));
};
const roundLerp = function (start, end, t, tmin, tmax, round) {
  return Math.round(lerp(start, end, t, tmin, tmax) * round) / round;
};

const setTextAttributes = function () {
  CNV.context.textAlign = 'center';
  CNV.context.textBaseline = 'middle';
  CNV.context.font = FONT_SIZE + 'px serif';
};

const requestDraw = function () {
  if (!DRAW_REQUEST_IN_FLIGHT) {
    DRAW_REQUEST_IN_FLIGHT = window.requestAnimationFrame(draw);
  }
};

const draw = function () {
  DRAW_REQUEST_IN_FLIGHT = false;

  // TODO: we could get here with boxes in a bad state before updateAllBoxes,
  // everything before that should be made to expect it
  let zoomTarget = null;
  let zoomTargetDim = null;

  if (ZOOM_CHANGED && LAST_ZOOM_COORDS) {
    // collect information about where the zoom is focused before it updates,
    // so we can center the zoom there
    if (ZOOM_TARGET) {
      zoomTarget = ZOOM_TARGET;
    } else {
      zoomTarget = findIntersectingBox(LAST_ZOOM_COORDS);
      if (!zoomTarget && BOXES.length > 0) {
        const box = BOXES[0];
        zoomTarget = box;
        LAST_ZOOM_COORDS = {x: CNV.element.width/2, y: CNV.element.height/2};
      }
    }

    if (zoomTarget &&
        typeof zoomTarget.w === 'number' && typeof zoomTarget.h === 'number') {
      zoomTargetDim = convertToAbsoluteXY(zoomTarget, {x: 0, y: 0});
      zoomTargetDim.w = zoomTarget.w;
      zoomTargetDim.h = zoomTarget.h;
    }
  }

  // so much easier to just always do this
  if (BOX_CHANGED || ZOOM_CHANGED) {
    updateAllBoxes();
  }
  BOX_CHANGED = false;
  ZOOM_CHANGED = false;

  if (zoomTargetDim) {
    // adjust pan to center on the zoom focus
    const {x: oldx, y: oldy, w: oldw, h: oldh} = zoomTargetDim;
    const {x: newx, y: newy} = convertToAbsoluteXY(zoomTarget, {x: 0, y: 0});
    const {w: neww, h: newh} = zoomTarget;
    const {x: zx, y: zy}  = LAST_ZOOM_COORDS;
    PAN_TRANSLATE.x += zx - ((zx - oldx) / oldw * neww + newx);
    PAN_TRANSLATE.y += zy - ((zy - oldy) / oldh * newh + newy);
  }

  // setup canvas context for drawing
  CNV.clear();

  setTextAttributes();
  CNV.enterRel({x: PAN_TRANSLATE.x + TEMP_PAN_TRANSLATE.x,
                y: PAN_TRANSLATE.y + TEMP_PAN_TRANSLATE.y});

  BOXES.forEach(drawBox);

  if (CURSOR_BEFORE_BOX || CURSOR_AFTER_BOX) {
    let box, cursorAttrs;
    if (CURSOR_BEFORE_BOX) {
      box = CURSOR_BEFORE_BOX;
      cursorAttrs = convertToAbsoluteXY(box, {x: -BOX_BORDER, y: 0});
    } else {
      box = CURSOR_AFTER_BOX;
      cursorAttrs = convertToAbsoluteXY(box, {x: box.w, y: 0});
    }
    cursorAttrs.w = BOX_BORDER;
    cursorAttrs.h = box.h;
    if (box.under) {
      const cells = box.under.rows[box.rowIdx].cells;
      if (CURSOR_BEFORE_BOX && box.idx > 0) {
        const prevBox = cells[box.idx-1];
        cursorAttrs.h = Math.max(prevBox.h, cursorAttrs.h);
      } else if (CURSOR_AFTER_BOX && box.idx + 1 < cells.length) {
        const nextBox = cells[box.idx+1];
        cursorAttrs.h = Math.max(nextBox.h, cursorAttrs.h);
      }
    }

    cursorAttrs.stroke = SELECTION_LINE_COLOR;
    CNV.context.lineWidth = BOX_BORDER;

    // TODO: should just be a drawline
    CNV.drawRect(cursorAttrs);
  }

  // draw selection box (shows where deletion or insertion will take place,
  // when this coincides with an existing box)
  if (CURSOR_BEFORE_BOX) {
    const box = CURSOR_BEFORE_BOX;
    const attrs = convertToAbsoluteXY(box, {x: 0, y: 0});
    attrs.w = box.w;
    attrs.h = box.h;
    attrs.stroke = SELECTION_LINE_COLOR;
    CNV.context.lineWidth = SELECTED_LINE_WIDTH;
    CNV.drawRect(attrs);
  } else if (CURSOR_AFTER_BOX && CURSOR_AFTER_BOX.under) {
    const box = CURSOR_AFTER_BOX;
    const cells = box.under.rows[box.rowIdx].cells;
    let nextBox = null;
    if (box.under && box.idx + 1 < cells.length) {
      const nextBox = cells[box.idx + 1];
      const attrs =
        convertToAbsoluteXY(box, {x: nextBox.x - box.x, y: nextBox.y - box.y});
      attrs.w = nextBox.w;
      attrs.h = nextBox.h;
      attrs.stroke = SELECTION_LINE_COLOR;

      CNV.context.lineWidth = SELECTED_LINE_WIDTH;
      CNV.drawRect(attrs);
    }
  } else if (CURSOR_INSIDE_BOX) {
    const box = CURSOR_INSIDE_BOX;
    const cursorAttrs = convertToAbsoluteXY(box, {x: box.w/4, y: box.h/4});
    cursorAttrs.w = box.w/2;
    cursorAttrs.h = box.h/2;
    cursorAttrs.stroke = SELECTION_LINE_COLOR;
    CNV.context.lineWidth = BOX_BORDER; 
    CNV.drawRect(cursorAttrs);
  }


  CNV.exitRel();
};

const drawBox = function (box, idx) {
  CNV.enterRel({x: box.x, y: box.y});

  // TODO: detection of clipping, should be easy with rects to see if
  // they are fully clipped

  const levelHue = LEVEL_HUES[box.level % LEVEL_HUES.length];
  let levelLum = roundLerp(92, 80, getHandleShrinkage(box), 1, 0, 4);

  const levelHSL = `hsl(${levelHue},80%,${levelLum}%)`;

  const rectAttrs = {x: 0, y: 0, w: box.w, h: box.h, fill: levelHSL};

  CNV.drawRect(rectAttrs);

  // draw rows, containing cells
  box.rows.forEach(function (row) {
    CNV.enterRel({x: row.x, y: row.y});
    row.cells.forEach(drawBox);
    CNV.exitRel();
  });

  // draw text
  if (typeof box.text === 'string' && box.text.length > 0) {
    const scale = getTextShrinkage(box);
    if (scale > MIN_SHRINK) {
      const adj = (1-scale)/2/scale;
      // TODO: CNVR should support this without two levels, probably just
      // do saving manually
      CNV.enterRel({zoom: scale});
      CNV.enterRel({x: box.w*adj, y: box.h*adj});
      CNV.drawText({x: Math.round(box.w/2),
                  y: Math.round(box.h/2),
                  msg: box.text, fill: TEXT_COLOR});
      CNV.exitRel();
      CNV.exitRel();
    }
  }

  CNV.exitRel();
};

const cursorBeforeOrAfter = function () {
  return CURSOR_BEFORE_BOX ? CURSOR_BEFORE_BOX : CURSOR_AFTER_BOX;
};

const cursorBeforeOrAfterOrInside = function () {
  return CURSOR_INSIDE_BOX ? CURSOR_INSIDE_BOX : cursorBeforeOrAfter();
};

const setCursorBeforeBox = function (box) {
  // TODO: we can set the keys to greyed out or not through this
  CURSOR_BEFORE_BOX = box;
  CURSOR_AFTER_BOX = null;
  CURSOR_INSIDE_BOX = null;
  
  requestDraw();
};

const setCursorAfterBox = function (box) {
  // TODO: ditto
  CURSOR_AFTER_BOX = box;
  CURSOR_BEFORE_BOX = null;
  CURSOR_INSIDE_BOX = null;

  requestDraw();
};

const setCursorInsideBox = function (box) {
  // TODO: yup
  CURSOR_INSIDE_BOX = box;
  CURSOR_BEFORE_BOX = null;
  CURSOR_AFTER_BOX = null;

  requestDraw();
}

const boxFromString = function (str, level, i) {
  if (i >= str.length) {
    throw 'expected object at end of string';
  }

  const box = {rows:[], level};

  if (str[i] === ID_SYM) {
    // id
    let idDone = false;
    let idStr = '';
    i++;
    while (!idDone && i < str.length) {
      switch (str[i]) {
        case ESC_SYM:
          i++;
          if (i < str.length) {
            idStr += str[i++];
          } else {
            throw 'escape char at end of string';
          }
          break;
        case OPEN_SYM: case CLOSE_SYM: case ROW_SYM: case ID_SYM:
          idDone = true;
          break;
        default:
          idStr += str[i++];
      }
    }

    tagBox(box, idStr);
    return {box, i};
  } else if (str[i] !== OPEN_SYM) {
    throw 'missing ' + OPEN_SYM + ' or ' + ID_SYM + ' at start of object';
  }

  // list
  i++;

  let curRow = null;

  while (i < str.length) {
    switch (str[i]) {
      case CLOSE_SYM:
        i++;
        if (curRow && curRow.cells.length === 0) {
          throw 'empty last row';
        }
        if (box.rows.length > 0) {
          // row and cell indexes
          reindexRows(box.rows);
        }
        return {box, i};
      case ROW_SYM:
        i++;
        if (!curRow) {
          throw ROW_SYM + ' without previous row';
        } else if (curRow.cells.length === 0) {
          throw 'empty row';
        }
        curRow = {cells: []};
        box.rows.push(curRow);
        break;
      case OPEN_SYM:
      case ID_SYM:
        // either of these signify a whole object
        if (!curRow) {
          curRow = {cells: []};
          box.rows.push(curRow);
        }
        let childBox;
        ({box: childBox, i} = boxFromString(str, level + 1, i));
        childBox.under = box;
        curRow.cells.push(childBox);
        break;
     default:
        throw "unexpected character '" + str[i] + "'";
    }
  }

  throw 'unexpected end of string';
};

const loadFromHash = function () {
  let hash = window.location.hash;
  if (typeof hash === 'string' && hash.length > 1 && hash[0] === '#') {
    try {
      hash = decodeURIComponent(hash.substring(1));
    } catch (e) {
      console.log('load error: decodeURIComponent failed');
      return;
    }
    let box = null;
    let i = 0;
    try {
      ({i, box} = boxFromString(hash, 0, i));
    } catch (e) {
      console.log('load error: boxFromString threw ' + e);
      return;
    }
    if (box) {
      resetGlobals();
      if (i !== hash.length) {
        console.log('load error: trailing characters')
      } else {
        // make up position for a restored box
        BOXES = [box];
        box.x = 0;
        box.y = 0;
        reindexBoxes();
        zoomOut();
        setZoom(SEMANTIC_ZOOM + ZOOM_LEVEL_PIXELS);
        updateAllBoxes();
        box.x = (CNV.element.width - box.w)/2;
        box.y = (CNV.element.height - box.h)/2;

        BOX_CHANGED = true;
        requestDraw();

        updateSaveHash();
      }
    }
  }
};

const escapeSaveString = function (str) {
  let outStr = '';

  for (let i = 0; i < str.length; i++) {
    switch (str[i]) {
      case OPEN_SYM: case CLOSE_SYM: case ROW_SYM: case ID_SYM: case ESC_SYM:
        outStr += ESC_SYM + str[i];
        break;
      default:
        outStr += str[i];
    }
  }

  return outStr;
};

const stringFromBox = function (box) {
  if (typeof box.text === 'string' && box.text !== '') {
    return ID_SYM + escapeSaveString(box.text);
  }

  let str = OPEN_SYM;

  box.rows.forEach(function (row, rowIdx) {
    if (rowIdx !== 0) {
      str += ROW_SYM;
    }
    row.cells.forEach(function (cell) {
      str += stringFromBox(cell);
    });
  });

  return str + CLOSE_SYM;
};

const updateSaveHash = function () {
  let str = '';
  if (BOXES.length > 0) {
    str = stringFromBox(BOXES[0]);
  }

  SAVE_HASH = '#' + encodeURIComponent(str);
};

const save = function () {
  updateSaveHash();
  window.history.replaceState(undefined, undefined, SAVE_HASH);
};

const promptText = function (init, cb, cbc) {
  if (typeof init !== 'string') {
    init = '';
  }

  if (CANCEL_PROMPT) {
    CANCEL_PROMPT();
  }

  PROMPT.style.visibility = 'visible';

  const submitHandler = function (e) {
    const value = PROMPT_INPUT.value;
    cancelPromptText(submitHandler);
    PROMPT_INPUT.blur();
    e.preventDefault();

    cb(value);
  };

  PROMPT_FORM.addEventListener('submit', submitHandler);

  PROMPT_INPUT.value = init;
  PROMPT_INPUT.focus();

  CANCEL_PROMPT = function () {
    cancelPromptText(submitHandler);
    if (!!cbc) {
      cbc();
    }
  };
};

const cancelPromptText = function (submitHandler) {
  PROMPT_INPUT.blur();
  PROMPT_INPUT.value = '';
  PROMPT.style.visibility = 'hidden'
  PROMPT_FORM.removeEventListener('submit', submitHandler);
  CANCEL_PROMPT = null;
};

const tagBox = function (box, text) {
  if (typeof text === 'string' && text !== '') {
    box.text = text;
    setTextAttributes();
    box.textWidth = Math.max(MIN_TEXT_WIDTH, CNV.context.measureText(text).width);
  } else {
    delete box.text;
    delete box.textWidth;
  }
  BOX_CHANGED = true;
  requestDraw();
};

const insertTaggedBox = function (text) {
  if (CURSOR_INSIDE_BOX) {
    const box = CURSOR_INSIDE_BOX;
    if (box.rows.length !== 0) {
      throw 'should only be inside empty box';
    }
    const newBox = createBox(null, box);
    tagBox(newBox, text);

    const newRow = {cells: [newBox]}
    box.rows.push(newRow);
    newBox.rowIdx = 0;
    newBox.idx = 0;

    setCursorAfterBox(newBox);
    return;
  }

  const box = cursorBeforeOrAfter();
  const newBox = createBox(null, box.under);
  const cells = box.under.rows[box.rowIdx].cells;
  tagBox(newBox, text);
      
  if (CURSOR_BEFORE_BOX) {
    cells.splice(box.idx, 0, newBox);
  } else {
    cells.splice(box.idx + 1, 0, newBox);
  }
  newBox.rowIdx = box.rowIdx;
  reindexBoxes(cells);

  setCursorAfterBox(newBox);
};

/*const menuAdd = function (text, prev, row) {
  if (!SELECTED_BOX.under) {
    return;
  }

  const rowIdx = SELECTED_BOX.rowIdx;
  const idx = SELECTED_BOX.idx;
  const under = SELECTED_BOX.under;

  const newBox = createBox(null, under);

  if (row) {
    const rows = under.rows;
    const newRow = {cells:[newBox]};
    if (prev) {
      rows.splice(rowIdx, 0, newRow);
    } else {
      rows.splice(rowIdx + 1, 0, newRow);
    }
    reindexRows(rows);
  } else {
    const cells = under.rows[rowIdx].cells;
    if (prev) {
      cells.splice(idx, 0, newBox);
    } else {
      cells.splice(idx + 1, 0, newBox);
    }
    reindexBoxes(cells);
    newBox.rowIdx = rowIdx;
  }

  if (text) {
    const myBox = newBox;
    promptText('', function (text) {
      tagBox(myBox, text);
      SELECTED_BOX = null;
    });

    SELECTED_BOX = newBox;
    return {dontDeselect: true};
  }
};

const menuEdit = function () {
  const myBox = SELECTED_BOX;
  promptText(myBox.text, function (text) {
    tagBox(myBox, text);
    SELECTED_BOX = null;
  });

  return {dontDeselect: true};
};*/

/*const menuCut = function () {
  // TODO: actually save somewhere
  removeBox(SELECTED_BOX);
  requestDraw();
};*/

/*const menuEnclose = function () {
  const box = SELECTED_BOX;

  let newBox;

  if (!box) {
    createBox({x: (window.innerWidth - box.w)/2,
               y: (window.innerHeight - box.h)/2});
    return;
  }

  if (!box.under) {

    // make a new box, put it where this root box was
    newBox = createBox({x: SELECTED_BOX.x, y: SELECTED_BOX.y});
    BOXES.pop(); // createBox has already put the newBox in BOXES, get it out
    BOXES[box.idx] = newBox;
    newBox.idx = box.idx;

  } else {
    // make a new box, put it where this box was
    newBox = createBox(null, box.under);
    box.under.rows[box.rowIdx].cells[box.idx] = newBox;
    newBox.rowIdx = box.rowIdx;
    newBox.idx = box.idx;
  }

  // move this box into the new box
  const newRow = {cells: [box]};
  newBox.rows.push(newRow);
  box.under = newBox;
  box.level = newBox.level + 1;
  box.rowIdx = 0;
  box.idx = 0;

  recalculateDeepest();

  requestDraw();
};*/

const keyNewBox = function () {
  if (CURSOR_INSIDE_BOX) {
    const box = CURSOR_INSIDE_BOX;
    if (box.rows.length !== 0) {
      throw 'should only be inside empty box';
    }
    const newBox = createBox(null, box);

    const newRow = {cells: [newBox]};
    box.rows.push(newRow);
    newBox.rowIdx = 0;
    newBox.idx = 0;

    setCursorAfterBox(newBox);
    return;
  }

  const box = cursorBeforeOrAfter();
  if (!box || !box.under) {
    // TODO: grey
    return;
  }

  const newBox = createBox(null, box.under);
  const cells = box.under.rows[box.rowIdx].cells;

  if (CURSOR_BEFORE_BOX) {
    cells.splice(box.idx, 0, newBox);
  } else {
    cells.splice(box.idx + 1, 0, newBox);
  }
  newBox.rowIdx = box.rowIdx
  reindexBoxes(cells);

  setCursorInsideBox(newBox);
};

const keyHome = function () {
};

const keyEnd = function () {
};

const keyType = function () {
  let box = cursorBeforeOrAfterOrInside();
  if (!box || !box.under) {
      // TODO: grey out key for root?
    return;
  }
  promptText('', function (text) {
    insertTaggedBox(text);
  });
};

const keyTypeWords = function () {
  const box = cursorBeforeOrAfterOrInside();
  if (!box || !box.under) {
    // TODO
    return;
  }
  promptText('', function (text) {
    text.split(' ').forEach(insertTaggedBox);
  });
};

const keyNewRow = function () {
  const box = cursorBeforeOrAfter();
  if (!box || !box.under) {
    // TODO
    return;
  }

  const cells = box.under.rows[box.rowIdx].cells;
  if (CURSOR_AFTER_BOX &&
    cells.length - 1 === box.idx) {
    // TODO
    return;
  }
  if (CURSOR_BEFORE_BOX && box.idx === 0) {
    return;
  }

  let split = box.idx;
  if (CURSOR_AFTER_BOX) {
    split ++;
  }

  const first = cells.slice(0, split);
  const second = cells.slice(split);

  box.under.rows[box.rowIdx] = {cells: first};
  box.under.rows.splice(box.rowIdx + 1, 0, {cells: second});

  reindexRows(box.under.rows);

  BOX_CHANGED = true;

  requestDraw();

};

const keyLeft = function () {
};

const keyRight = function () {
};

const keyDel = function () {
  const box = cursorBeforeOrAfter();
  if (!box || !box.under) {
    // TODO
    return;
  }

  const cells = box.under.rows[box.rowIdx].cells;
  if (CURSOR_AFTER_BOX &&
    cells.length - 1 === box.idx) {

    // delete a row break if possible
    if (box.rowIdx === box.under.rows.length - 1) {
      // nothing after the last row
      // TODO: grey
      return;
    }

    const cells2 = box.under.rows[box.rowIdx+1].cells;
    box.under.rows.splice(box.rowIdx, 2, {cells: cells.concat(cells2)});

    reindexRows(box.under.rows);
    setCursorBeforeBox(null);
    BOX_CHANGED = true;
    requestDraw();

    return;
  }

  let target = box;
  if (CURSOR_AFTER_BOX) {
    target = cells[box.idx + 1];
  }

  if (cells.length === 1) {
    // deleting the only cell in this row, thus delete the row
    box.under.rows.splice(box.rowIdx, 1);

    // TODO save somehow

    reindexRows(box.under.rows);
    setCursorBeforeBox(null);
    BOX_CHANGED = true;
    requestDraw();

    return;
  }

  // normal deletion
  cells.splice(target.idx, 1);

  reindexBoxes(cells);
  setCursorBeforeBox(null);
  BOX_CHANGED = true;
  requestDraw();
  return;
};

const keyPaste = function () {
};

const menuCallbacks = {
  newBox: keyNewBox,
  home: keyHome,
  end: keyEnd,
  type: keyType,
  typeWords: keyTypeWords,
  newRow: keyNewRow,
  left: keyLeft,
  right: keyRight,
  del: keyDel,
  paste: keyPaste,
  save,

};

const MENU = MENUR(menuCallbacks);

// main code starts here

resetGlobals();
loadFromHash();
MENU.show();
setCursorBeforeBox(null);

GET_TOUCHY(CNV.element, {
  touchStart: function (p) {
    if (CANCEL_PROMPT) {
      CANCEL_PROMPT();
    }
    // TOUCH_ORIGIN is in absolute screen units
    TOUCH_ORIGIN = {x: p.x, y: p.y};

    const {x, y} = adjustForPanAndZoom(TOUCH_ORIGIN);

    TARGET_BOX = findIntersectingBox({x, y});

    if (TARGET_BOX) {
      if (getHandleShrinkage(TARGET_BOX) < TOO_SMALL_THRESH) {
        ZOOMING_BOX = TARGET_BOX;
        TARGET_BOX = null;
      }
    }

    requestDraw();
  },
  touchMove: function (p) {
    const dist = Math.sqrt(
      Math.pow(TOUCH_ORIGIN.x - p.x, 2) + Math.pow(TOUCH_ORIGIN.y - p.y, 2));

    if (!PANNING && dist >= PAN_DIST) {
      PANNING = true;

      TARGET_BOX = null;
      ZOOMING_BOX = null;
    }

    if (PANNING) {
      TEMP_PAN_TRANSLATE.x = p.x - TOUCH_ORIGIN.x;
      TEMP_PAN_TRANSLATE.y = p.y - TOUCH_ORIGIN.y;
    }
    requestDraw();
  },
  touchEnd: function (p) {
    if (PANNING) {
      TEMP_PAN_TRANSLATE.x = p.x - TOUCH_ORIGIN.x;
      TEMP_PAN_TRANSLATE.y = p.y - TOUCH_ORIGIN.y;

      PAN_TRANSLATE.x += TEMP_PAN_TRANSLATE.x;
      PAN_TRANSLATE.y += TEMP_PAN_TRANSLATE.y;

      TEMP_PAN_TRANSLATE.x = 0;
      TEMP_PAN_TRANSLATE.y = 0;

      PANNING = false;
    } else if (ZOOMING_BOX) {
      zoomToBox(ZOOMING_BOX, TOUCH_ORIGIN);
      setCursorBeforeBox(ZOOMING_BOX);
      ZOOMING_BOX = null;
    } else if (!TARGET_BOX) {
      if (BOXES.length === 0) {
        // create initial box
        // TODO: maybe we should always just init to one box
        // but what if you delete it? maybe disallow that
        createBox(adjustForPanAndZoom(p));
        TARGET_BOX = null;
      } else {
        setCursorBeforeBox(null);
      }
    } else {
      setCursorBeforeBox(TARGET_BOX);
      const sp =
        convertToBoxXY(CURSOR_BEFORE_BOX, adjustForPanAndZoom(TOUCH_ORIGIN));
      if (sp.x > CURSOR_BEFORE_BOX.w/2) {
        setCursorAfterBox(CURSOR_BEFORE_BOX);
      }
    }

    TARGET_BOX = null;

    requestDraw();
  },
  touchCancel: function () {
    if (PANNING) {
      PAN_TRANSLATE.x += TEMP_PAN_TRANSLATE.x;
      PAN_TRANSLATE.y += TEMP_PAN_TRANSLATE.y;

      TEMP_PAN_TRANSLATE.x = 0;
      TEMP_PAN_TRANSLATE.y = 0;

      PANNING = false;
    } else if (ZOOMING_BOX) {
      ZOOMING_BOX = null;
    }

  },

  pinchStart: function (touch1, touch2) {
    let x = (touch1.x + touch2.x) / 2;
    let y = (touch1.y + touch2.y) / 2;
    PINCH_DISTANCE =
      Math.sqrt(Math.pow(touch1.x - touch2.x, 2) +
                Math.pow(touch1.y - touch2.y, 2));
    TOUCH_ORIGIN = {x, y};
    ZOOM_TARGET = findIntersectingBox(LAST_ZOOM_COORDS);
  },

  pinchMove: function (touch1, touch2) {
    let dist =
      Math.sqrt(Math.pow(touch1.x - touch2.x, 2) +
                Math.pow(touch1.y - touch2.y, 2));
    let delta = dist - PINCH_DISTANCE;
    setZoom(SEMANTIC_ZOOM + delta, TOUCH_ORIGIN);

    PINCH_DISTANCE = dist;
  },

  pinchEnd: function (touch1, touch2) {
    PINCH_DISTANCE = null;
    ZOOM_TARGET = null;
  },

});

window.addEventListener('resize', function () {
  CNV.setupCanvas();
  requestDraw();
});

window.addEventListener('wheel', function (e) {
  const mx = e.pageX;
  const my = e.pageY;
  let delta = e.deltaY;

  if (e.deltaMode === 0x01) {
    delta *= FONT_SIZE * 1.5;
  }
  if (e.deltaMode === 0x02) {
    delta *= FONT_SIZE * 15;
  }

  setZoom(SEMANTIC_ZOOM - delta, {x: mx, y: my});
});

window.addEventListener('hashchange', function () {
  updateSaveHash();
  if (window.location.hash !== SAVE_HASH) {
    loadFromHash();
  }
});

})();
