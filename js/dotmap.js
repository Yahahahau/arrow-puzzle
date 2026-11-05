/* Arrow Puzzle — dotmap.js
 * Small overview map: one dot per grid cell, laid out exactly like the board
 * (same rows / columns). Dots of arrow cells show the arrow's real state:
 *   available (can leave now) · blocked · removed.
 * States come from the live Board (never random). Colour/size changes ease smoothly.
 * Static dots live on an offscreen canvas; only the viewport outline is redrawn on pan/zoom. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  // r,g,b,radius(as fraction of cell pitch)
  var ST = [
    [240, 243, 248, 0.10],   // 0 empty cell
    [47, 134, 235, 0.36],    // 1 available
    [150, 160, 182, 0.30],   // 2 blocked
    [214, 221, 233, 0.17]    // 3 removed
  ];
  var TAU = 0.075;           // s, smoothing time constant (~250ms to settle)

  function DotMap(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas'); this.octx = this.off.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.cols = 0; this.rows = 0;
    this.owner = null; this.tgt = null; this.cur = null;   // cur: 4 floats per cell
    this.active = false; this.needDraw = true; this.dirtyDots = true;
    this.pitch = 1; this.ox = 0; this.oy = 0;
    this.board = null;
  }

  DotMap.prototype.resize = function (w, h, dpr) {
    this.w = Math.max(1, w); this.h = Math.max(1, h); this.dpr = dpr;
    this.cv.width = this.off.width = Math.max(1, Math.round(this.w * dpr));
    this.cv.height = this.off.height = Math.max(1, Math.round(this.h * dpr));
    this._layout();
    this.dirtyDots = true; this.needDraw = true;
  };

  DotMap.prototype._layout = function () {
    if (!this.cols) return;
    this.pitch = Math.min(this.w / this.cols, this.h / this.rows);
    this.ox = (this.w - this.pitch * this.cols) / 2;
    this.oy = (this.h - this.pitch * this.rows) / 2;
  };

  DotMap.prototype.setBoard = function (board) {
    this.board = board;
    this.cols = board.cols; this.rows = board.rows;
    var n = this.cols * this.rows, i, k;
    this.owner = new Int16Array(n); this.tgt = new Uint8Array(n); this.cur = new Float32Array(n * 4);
    for (i = 0; i < n; i++) this.owner[i] = board.grid[i];
    this._layout();
    this.sync(board);
    for (i = 0; i < n; i++) for (k = 0; k < 4; k++) this.cur[i * 4 + k] = ST[this.tgt[i]][k];   // no animation on load
    this.active = false; this.dirtyDots = true; this.needDraw = true;
  };

  /* recompute every dot's state from the real grid */
  DotMap.prototype.sync = function (board) {
    if (!this.owner) return;
    var arrows = board.arrows, st = new Uint8Array(arrows.length), i;
    for (i = 0; i < arrows.length; i++) st[i] = !arrows[i].alive ? 3 : (board.blockerId(arrows[i]) < 0 ? 1 : 2);
    for (i = 0; i < this.owner.length; i++) this.tgt[i] = this.owner[i] < 0 ? 0 : st[this.owner[i]];
    this.active = true;
  };

  /* ease current look towards target; returns true while something is still moving */
  DotMap.prototype.step = function (dt) {
    if (!this.active || !this.cur) return false;
    var k = 1 - Math.exp(-dt / TAU), moving = false, n = this.tgt.length, i, j, c = this.cur;
    for (i = 0; i < n; i++) {
      var T = ST[this.tgt[i]], b = i * 4;
      for (j = 0; j < 4; j++) {
        var d = T[j] - c[b + j];
        var lim = j === 3 ? 0.004 : 0.6;
        if (d > lim || d < -lim) { c[b + j] += d * k; moving = true; } else c[b + j] = T[j];
      }
    }
    this.active = moving; this.dirtyDots = true; this.needDraw = true;
    return true;
  };

  DotMap.prototype._paintDots = function () {
    var ctx = this.octx, c = this.cur, p = this.pitch, cols = this.cols, n = this.tgt.length;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    for (var i = 0; i < n; i++) {
      var b = i * 4, r = c[b + 3] * p;
      if (r < 0.15) continue;
      ctx.fillStyle = 'rgb(' + (c[b] | 0) + ',' + (c[b + 1] | 0) + ',' + (c[b + 2] | 0) + ')';
      ctx.beginPath();
      ctx.arc(this.ox + ((i % cols) + 0.5) * p, this.oy + (((i / cols) | 0) + 0.5) * p, r, 0, 6.2832);
      ctx.fill();
    }
    this.dirtyDots = false;
  };

  /* view: AP.View (for the visible-area outline when zoomed in) */
  DotMap.prototype.draw = function (view) {
    if (!this.owner) return;
    if (this.dirtyDots) this._paintDots();
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.drawImage(this.off, 0, 0);
    if (view && view.scale > view.minS * 1.06) {
      var sc = view.scale, p = this.pitch;
      var x0 = Math.max(0, -view.tx / sc), y0 = Math.max(0, -view.ty / sc);
      var x1 = Math.min(this.cols, (view.w - view.tx) / sc), y1 = Math.min(this.rows, (view.h - view.ty) / sc);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(47,134,235,.85)'; ctx.fillStyle = 'rgba(47,134,235,.08)';
      var rx = this.ox + x0 * p, ry = this.oy + y0 * p, rw = (x1 - x0) * p, rh = (y1 - y0) * p;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx + 0.6, ry + 0.6, Math.max(1, rw - 1.2), Math.max(1, rh - 1.2));
    }
    this.needDraw = false;
  };

  AP.DotMap = DotMap;
})(typeof window !== 'undefined' ? window : globalThis);
