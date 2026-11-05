/* Arrow Puzzle — engine.js
 * Board logic only (no DOM). Arrows are "snakes": a polyline of grid cells
 * (tail -> head). The head direction is the direction of the last segment.
 * An arrow can leave only if the straight ray from its head to the board
 * edge contains no other (alive) arrow cell. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  var DX = { U: 0, D: 0, L: -1, R: 1 };
  var DY = { U: -1, D: 1, L: 0, R: 0 };
  var FADE = 5; // cells over which an exiting arrow fades out

  function dirOf(a, b) {
    if (b[0] > a[0]) return 'R';
    if (b[0] < a[0]) return 'L';
    if (b[1] > a[1]) return 'D';
    return 'U';
  }

  function Arrow(id, cells, cols, rows) {
    this.id = id;
    this.cells = cells;
    var n = cells.length;
    this.head = cells[n - 1];
    this.dir = dirOf(cells[n - 2], cells[n - 1]);
    var pts = [], i;
    for (i = 0; i < n; i++) pts.push([cells[i][0] + 0.5, cells[i][1] + 0.5]);
    var h = pts[n - 1], dx = DX[this.dir], dy = DY[this.dir];
    var dEdge = dx > 0 ? cols - h[0] : dx < 0 ? h[0] : dy > 0 ? rows - h[1] : h[1];
    this.dEdge = dEdge;           // distance head-centre -> board edge (cells)
    this.L = n - 1;               // body length (cells)
    this.hx = h[0]; this.hy = h[1];
    var ext = dEdge + FADE + 2;   // straight extension used while sliding out
    pts.push([h[0] + dx * ext, h[1] + dy * ext]);
    var cum = [0];
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i][0] - pts[i - 1][0], ay = pts[i][1] - pts[i - 1][1];
      cum.push(cum[i - 1] + Math.sqrt(ax * ax + ay * ay));
    }
    this.pts = pts;
    this.cum = cum;
    this.alive = true;
  }

  function Board(def) {
    this.cols = def.cols;
    this.rows = def.rows;
    this.grid = new Int16Array(def.cols * def.rows);
    var i;
    for (i = 0; i < this.grid.length; i++) this.grid[i] = -1;
    this.arrows = [];
    this.alive = 0;
    for (i = 0; i < def.arrows.length; i++) {
      var cells = def.arrows[i];
      var a = new Arrow(i, cells, this.cols, this.rows);
      for (var k = 0; k < cells.length; k++) this.grid[cells[k][1] * this.cols + cells[k][0]] = i;
      this.arrows.push(a);
      this.alive++;
    }
  }

  /* first alive arrow cell found along the ray from a's head, or null */
  Board.prototype.blocker = function (a) {
    var dx = DX[a.dir], dy = DY[a.dir];
    var c = a.head[0] + dx, r = a.head[1] + dy, k = 1;
    while (c >= 0 && r >= 0 && c < this.cols && r < this.rows) {
      var id = this.grid[r * this.cols + c];
      if (id >= 0) return { id: id, dist: k, c: c, r: r };
      c += dx; r += dy; k++;
    }
    return null;
  };

  Board.prototype.remove = function (id) {
    var a = this.arrows[id];
    if (!a.alive) return;
    a.alive = false;
    this.alive--;
    for (var k = 0; k < a.cells.length; k++) this.grid[a.cells[k][1] * this.cols + a.cells[k][0]] = -1;
  };

  Board.prototype.freeArrows = function () {
    var out = [];
    for (var i = 0; i < this.arrows.length; i++) {
      var a = this.arrows[i];
      if (a.alive && !this.blocker(a)) out.push(i);
    }
    return out;
  };

  /* greedy removal: removing an arrow never blocks another, so greedy is exact */
  function isSolvable(def) {
    var b = new Board(def), progress = true;
    while (progress && b.alive > 0) {
      progress = false;
      for (var i = 0; i < b.arrows.length; i++) {
        var a = b.arrows[i];
        if (a.alive && !b.blocker(a)) { b.remove(i); progress = true; }
      }
    }
    return b.alive === 0;
  }

  /* returns a list of problems (empty array = level is valid) */
  function validate(def) {
    var errs = [], seen = {};
    for (var i = 0; i < def.arrows.length; i++) {
      var cells = def.arrows[i];
      if (cells.length < 2) errs.push('arrow ' + i + ': needs >= 2 cells');
      for (var k = 0; k < cells.length; k++) {
        var c = cells[k][0], r = cells[k][1], key = c + ',' + r;
        if (c < 0 || r < 0 || c >= def.cols || r >= def.rows) errs.push('arrow ' + i + ': cell out of bounds ' + key);
        if (seen[key] !== undefined) errs.push('arrow ' + i + ': cell ' + key + ' already used by ' + seen[key]);
        seen[key] = i;
        if (k > 0 && Math.abs(c - cells[k - 1][0]) + Math.abs(r - cells[k - 1][1]) !== 1)
          errs.push('arrow ' + i + ': cells ' + (k - 1) + '->' + k + ' not adjacent');
      }
    }
    if (errs.length) return errs;
    var b = new Board(def);
    for (i = 0; i < b.arrows.length; i++) {
      var bl = b.blocker(b.arrows[i]);
      if (bl && bl.id === i) errs.push('arrow ' + i + ': blocked by its own body');
    }
    if (!isSolvable(def)) errs.push('level is not solvable');
    return errs;
  }

  AP.Board = Board;
  AP.Arrow = Arrow;
  AP.isSolvable = isSolvable;
  AP.validate = validate;
  AP.FADE = FADE;
  AP.DX = DX; AP.DY = DY;
})(typeof window !== 'undefined' ? window : globalThis);
