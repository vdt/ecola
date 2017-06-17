(function () {
'use strict';

const CNV = CNVR();
const BOXES = [];

let PANNING = false;
let PAN_TRANSLATE = {x: 0, y: 0};
let TEMP_PAN_TRANSLATE = {x: 0, y: 0};
let LAST_ADDED_BOX = null;
let NEW_BOX = null;
let DRAW_REQUEST_IN_FLIGHT = false;
let TOUCH_ORIGIN = {x: 0, y: 0};
let HOLD_TIMEOUT_ID = null;

const HOLD_TIMEOUT_MS = 750;
const PAN_DIST = 20;
const BOX_PAD = 30;
const PAREN_X = 10;
const PAREN_Y = 10;
const LEVEL_COLORS = ['#f0f0ff', '#fff0f0', '#f0fff0'];
const ROW_COLORS = ['#e8e8ff', '#ffe8e8', '#e8ffe8'];
const OUTLINE_GREY = '#808080';

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

const convertToBoxXY = function (box, x, y) {
  if (box.under) {
    const row = box.under.rows[box.rowIdx];
    x -= box.x + row.x;
    y -= box.y + row.y;
    return convertToBoxXY(box.under, x, y);
  }
  return {x: x - box.x, y: y - box.y};
};

const createNewBox = function (p, under = null) {
  const newBox = {x: p.x - BOX_PAD, y: p.y - BOX_PAD,
                  w: BOX_PAD*2, h: BOX_PAD*2,
                  finished: false, rows: [], under, level: 0};

  if (under) {
    newBox.level = under.level + 1;
    let targetRow = null;
    let targetRowIdx = -1;
    let targetIdx = -1;

    const {x: lx, y: ly} = convertToBoxXY(under, p.x, p.y);

    if (under.rows.length === 0 || ly < under.rows[0].y) {
      // add new row to top
      targetRowIdx = 0;
      targetIdx = 0;
    } else {
      for (let ri = 0; ri < under.rows.length; ri ++) {
        const row = under.rows[ri];
        if (ly >= row.y && ly < row.y + row.h) {
          // add to existing row
          targetRow = row;
          targetRowIdx = ri;

          if (row.cells.length === 0 || lx < row.cells[0].x) {
            // add at start of row
            targetIdx = 0;
          } else {
            for (let i = 0; i < row.cells.length - 1; i ++) {
              const cell = row.cells[i];
              const nextCell = row.cells[i+1];
              if (lx >= cell.x + cell.w && lx < nextCell.x) {
                // add between cells
                targetIdx = i+1;
                break;
              }
            }

            if (targetIdx === -1) {
              // add at end of row
              targetIdx = row.cells.length;
            }
          }
          break;
        } else if (ri < under.rows.length - 1) {
          const nextRow = under.rows[ri+1];
          if (ly >= row.y + row.h && ly < nextRow.y) {
            // add new row in the middle
            targetRowIdx = ri + 1;
            targetIdx = 0;
            break;
          }
        }
      }
      if (targetRowIdx === -1) {
        // add new row to bottom
        targetRowIdx = under.rows.length;
        targetIdx = 0;
      }
    }

    if (!targetRow) {
      targetRow = {cells: []};
      under.rows.splice(targetRowIdx, 0, targetRow);
    }
    targetRow.cells.splice(targetIdx, 0, newBox);

    reindexRows(under.rows);
    updateRowCells(targetRow);
    updateBoxRows(under);
  } else {
    // TODO: avoid overlapping with existing boxes
    BOXES.push(newBox);
    newBox.idx = BOXES.indexOf(newBox);
  }

  return newBox;
};

const finishNewBox = function (newBox, p, cancelled) {
    newBox.finished = true;

    if (cancelled) {
      removeBox(newBox);
    }
};

const removeBox = function (box) {
  const idx = box.idx;
  box.idx = -1;

  let removed;

  if (box.under) {
    const under = box.under;
    const rowIdx = box.rowIdx;
    const row = under.rows[rowIdx];
    const removed = row.cells.splice(idx, 1)[0];
    box.rowIdx = -1;
    if (row.cells.length === 0) {
      under.rows.splice(rowIdx, 1);
      reindexRows(under.rows);
    } else {
      reindexBoxes(row.cells);
      updateRowCells(row);
    }

    updateBoxRows(under);
  } else {
    removed = BOXES.splice(idx, 1)[0];
    reindexBoxes();
  }

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

const updateBoxRows = function (box) {
  let w = 0;
  let h = 0;

  box.rows.forEach(function (row) {
    row.x = 0;
    row.y = BOX_PAD + h;

    w = Math.max(w, row.w);
    h += row.h + BOX_PAD;
  });

  if (box.rows.length === 0) {
    box.w = BOX_PAD * 2;
    box.h = BOX_PAD * 2;
  } else {
    box.w = w;
    box.h = h + BOX_PAD;
  }

  if (box.under) {
    updateRowCells(box.under.rows[box.rowIdx]);
    updateBoxRows(box.under);
  }
};

const updateRowCells = function (row) {
  let h = 0;
  let w = BOX_PAD;

  row.cells.forEach(function (cell, idx) {
    cell.x = w;
    cell.y = 0;

    w += cell.w + BOX_PAD;
    h = Math.max(h, cell.h);
  });

  row.w = w;
  row.h = h;
};

const adjustForPan = function ({x,y}) {
  return {x: x - PAN_TRANSLATE.x,
          y: y - PAN_TRANSLATE.y};
};

const requestDraw = function () {
  if (!DRAW_REQUEST_IN_FLIGHT) {
    DRAW_REQUEST_IN_FLIGHT = true;
    window.requestAnimationFrame(draw);
  }
};

const draw = function () {
  DRAW_REQUEST_IN_FLIGHT = false;

  CNV.clear();

  CNV.enterRel({x: PAN_TRANSLATE.x + TEMP_PAN_TRANSLATE.x,
                y: PAN_TRANSLATE.y + TEMP_PAN_TRANSLATE.y});

  BOXES.forEach(drawBox);

  CNV.exitRel();
};

const drawBox = function (box, idx) {
  CNV.enterRel({x: box.x, y: box.y});

  const rectAttrs = {x: 0, y: 0, w: box.w, h: box.h,
                     fill: LEVEL_COLORS[box.level % LEVEL_COLORS.length]};

  if (!NEW_BOX && box === LAST_ADDED_BOX) {
    rectAttrs.stroke = OUTLINE_GREY;
  }

  CNV.drawRect(rectAttrs);

  const openParenAttrs = {x: PAREN_X, y: box.h/2,
                          msg: '(', fill: '#000000'};
 
  const closeParenAttrs = {x: box.w - 1 - PAREN_X, y: box.h/2,
                           msg: ')', fill: '#000000'}

  if (box.rows.length > 0) {
    openParenAttrs.y = PAREN_Y;
    closeParenAttrs.y = box.h - PAREN_Y;
  }

  CNV.drawText(openParenAttrs);
  CNV.drawText(closeParenAttrs);

  box.rows.forEach(function (row) {
    CNV.enterRel({x: row.x, y: row.y});
    CNV.drawRect({x: 0, y: 0, w: row.w, h: row.h,
                  fill: ROW_COLORS[box.level % ROW_COLORS.length]});

    row.cells.forEach(drawBox);
    CNV.exitRel();
  });

  CNV.exitRel();
};

const startHoldTimeout = function () {
  HOLD_TIMEOUT_ID = window.setTimeout(handleHoldTimeout, HOLD_TIMEOUT_MS);
};

const cancelHoldTimeout = function () {
  if (typeof HOLD_TIMEOUT_ID === 'number') {
    clearTimeout(HOLD_TIMEOUT_ID)
    HOLD_TIMEOUT_ID =   null;
  }
};

const handleHoldTimeout = function () {
  console.log('hit timeout');
  const target = findIntersectingBox(TOUCH_ORIGIN);

  removeBox(target);
  requestDraw();
};

GET_TOUCHY(CNV.element, {
  touchStart (p) {
    p = adjustForPan(p);
    const target = findIntersectingBox({x: p.x, y: p.y});

    if (target) {
      NEW_BOX = createNewBox(p, target);
    } else if (!NEW_BOX && BOXES.length === 0) {
      NEW_BOX = createNewBox(p);
    }

    TOUCH_ORIGIN = {x: p.x, y: p.y};

    startHoldTimeout();

    requestDraw();
  },
  touchMove (p) {
    p = adjustForPan(p);
    const dist = Math.sqrt(
      Math.pow(TOUCH_ORIGIN.x - p.x, 2) + Math.pow(TOUCH_ORIGIN.y - p.y, 2));

    if (!PANNING && dist >= PAN_DIST) {
      PANNING = true;
      cancelHoldTimeout();
    }

    if (NEW_BOX) {
      if (PANNING) {
        finishNewBox(NEW_BOX, p, true);
        NEW_BOX = null;
      }
    }

    if (PANNING) {
      TEMP_PAN_TRANSLATE.x = p.x - TOUCH_ORIGIN.x;
      TEMP_PAN_TRANSLATE.y = p.y - TOUCH_ORIGIN.y;
    }
    requestDraw();
  },
  touchEnd (p, cancelled) {
    p = adjustForPan(p);
    if (NEW_BOX) {
      finishNewBox(NEW_BOX, p, cancelled);
      if (!cancelled) {
        LAST_ADDED_BOX = NEW_BOX;
      }
      NEW_BOX = null;
    }

    if (PANNING) {
      TEMP_PAN_TRANSLATE.x = p.x - TOUCH_ORIGIN.x;
      TEMP_PAN_TRANSLATE.y = p.y - TOUCH_ORIGIN.y;

      PAN_TRANSLATE.x += TEMP_PAN_TRANSLATE.x;
      PAN_TRANSLATE.y += TEMP_PAN_TRANSLATE.y;

      TEMP_PAN_TRANSLATE.x = 0;
      TEMP_PAN_TRANSLATE.y = 0;

      PANNING = false;
    }
    cancelHoldTimeout();
    requestDraw();
  },
});

})();
