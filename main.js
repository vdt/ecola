(function () {
'use strict';

const CNV = CNVR();
const BOXES = [];
let NEW_BOX = null;
let DRAW_REQUEST_IN_FLIGHT = false;

const BOX_PAD = 40;
const PAREN_X = 10;
const PAREN_Y = 10;
const LEVEL_COLORS = ['#f0f0ff', '#fff0f0', '#f0fff0'];
const OUTLINE_COLORS = ['#e0e0ff', '#ffe0e0', '#e0ffe0'];
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

const getAbsoluteXY = function () {
};

const createNewBox = function (p, under = null) {
  const newBox = {x: p.x - BOX_PAD, y: p.y - BOX_PAD,
                  w: BOX_PAD*2, h: BOX_PAD*2,
                  finished: false, rows: [], under, level: 0};

  if (under) {
    // TODO: figure out whether to add a row, or add to a row, or
    // insert into a row
    //const {ax, ay} = getAbsoluteXY(under);

    newBox.level = under.level + 1;
    let targetRow;
    if (under.rows.length === 0) {
      targetRow = {cells: []};
      under.rows.push(targetRow);
    } else {
      targetRow = under.rows[0];
    }
    targetRow.cells.push(newBox);
    newBox.rowIdx = under.rows.indexOf(targetRow);
    newBox.idx = targetRow.cells.indexOf(newBox);
    updateRowCells(targetRow);

    updateBoxRows(under);
  } else {
    BOXES.push(newBox);
    newBox.idx = BOXES.indexOf(newBox);
  }

  return newBox;
};

const moveNewBox = function (newBox, p) {
    //newBox.x = p.x - BOX_PAD;
    //newBox.y = p.y - BOX_PAD;
};

const finishNewBox = function (newBox, p, cancelled) {
    //newBox.x = p.x - BOX_PAD;
    //newBox.y = p.y - BOX_PAD;
    newBox.finished = true;
    newBox.cancelled = cancelled;

    // for moving
    /*
    if (typeof newBox.properIdx !== 'undefined' &&
        newBox.properIdx !== newBox.idx) {
      // shift back into position
      const proper = newBox.properIdx, idx = newBox.idx;
      newBox.under.splice(idx, 1);
      newBox.under.splice(proper, 0, newBox);

      reindexBoxes(box.under);
    }
    */
};

const removeBox = function (box) {
  const idx = box.idx;
  const removed = box.under.splice(idx, 1)[0];
  removed.idx = -1;

  reindexBoxes(box.under, idx);

  return removed;
};

const reindexBoxes = function (list = BOXES, first = 0) {
  for (let i = first; i < list.length; i++) {
    list[i].idx = i;
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

  box.w = w;
  box.h = h + BOX_PAD;

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

const requestDraw = function () {
  if (!DRAW_REQUEST_IN_FLIGHT) {
    DRAW_REQUEST_IN_FLIGHT = true;
    window.requestAnimationFrame(draw);
  }
};

const draw = function () {
  DRAW_REQUEST_IN_FLIGHT = false;

  CNV.clear();

  BOXES.forEach(drawBox);
};

const drawBox = function (box, idx) {
  CNV.enterRel({x: box.x, y: box.y});

  const rectAttrs = {x: 0, y: 0, w: box.w, h: box.h,
                     fill: LEVEL_COLORS[box.level % LEVEL_COLORS.length]};

  if (!box.finished) {
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
                  fill: OUTLINE_COLORS[box.level % OUTLINE_COLORS.length]});

    row.cells.forEach(drawBox);
    CNV.exitRel();
  });

  CNV.exitRel();
};

GET_TOUCHY(CNV.element, {
  touchStart (p) {
    const target = findIntersectingBox({x: p.x, y: p.y});

    if (target) {
      /*
      // moving
      const idx = target.idx;
      removeBox(target);

      NEW_BOX = createNewBox(p);
      NEW_BOX.properIdx = idx;
      */
      NEW_BOX = createNewBox(p, target);
    } else if (!NEW_BOX) {
      NEW_BOX = createNewBox(p);
    }

    requestDraw();
  },
  touchMove (p) {
    if (NEW_BOX) {
      moveNewBox(NEW_BOX, p);
      requestDraw();
    }
  },
  touchEnd (p, cancelled) {
    if (NEW_BOX) {
      finishNewBox(NEW_BOX, p, cancelled);
      requestDraw();
      NEW_BOX = null;
    }
  },
});

})();
