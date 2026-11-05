/* Arrow Puzzle — game.js
 * Game state, input -> action, arrow animation, rendering (Canvas 2D).
 *
 * Two canvas layers:
 *   - board canvas (#board, inside the stage): idle arrows, dots, hint/ruler/debug.
 *     It is only repainted when something on it changes.
 *   - fx canvas (#fx, covers the WHOLE app area): arrows that are flying out, and
 *     confetti. Because it is not clipped by the board/stage, an arrow keeps
 *     travelling in a straight line until it has left the visible area completely.
 *
 * Arrow flight: smooth ramp-in, constant cruise speed (screen px/s at launch zoom), gentle
 * ease-out over the last 40% of the route, opacity always 1. The route length is measured
 * at launch (to the real visible edge), so duration scales with distance. Time-based
 * (rAF timestamps), so speed does not depend on the refresh rate. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  var INK = '#0e1650', RED = '#ef4444', ORANGE = '#f97316', BLUE = '#2f86eb', GOLD = '#ffb800', GREEN = '#22c55e';
  var LW = 0.17;                 // line width (cells)
  var HEAD_LEN = 0.46, HEAD_HALF = 0.27;
  var SPEED_PX = 1400;           // cruise speed in screen px / second at launch zoom (12% slower than v1: 1600)
  var MIN_V = 14, MAX_V = 122;   // clamp in cells / second
  var RAMP = 0.07;               // s: smoothstep velocity ramp at the start (no jump)
  var DEC_START = 0.6, DEC_DROP = 0.45;  // last 40% of the route eases down to 55% of cruise speed (never stops)
  var EXIT_MARGIN = 1.5;         // cells beyond the visible edge before the arrow is removed
  var BUMP_T = 0.5;
  var HINT_T = 3.6, RULER_T = 4.2;
  var HEARTS = 3, HINTS = 3, RULERS = 3;
  var MAX_DT = 0.1;
  var RING = 120;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function pointAt(a, d, out) {
    var pts = a.pts, cum = a.cum, n = pts.length, i;
    if (d <= 0) {
      var ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1];
      out[0] = pts[0][0] + ux * d; out[1] = pts[0][1] + uy * d; return;
    }
    if (d >= cum[n - 1]) {
      var vx = pts[n - 1][0] - pts[n - 2][0], vy = pts[n - 1][1] - pts[n - 2][1];
      var l = cum[n - 1] - cum[n - 2], e = d - cum[n - 1];
      out[0] = pts[n - 1][0] + vx / l * e; out[1] = pts[n - 1][1] + vy / l * e; return;
    }
    for (i = 1; i < n; i++) if (cum[i] >= d) break;
    var t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    out[0] = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
    out[1] = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
  }

  function Game(canvas, fxCanvas, cb) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.fx = fxCanvas;
    this.fctx = fxCanvas.getContext('2d', { alpha: true });
    this.fxW = 1; this.fxH = 1; this.fxX = 0; this.fxY = 0;
    this.cb = cb || {};
    var self = this;
    this.view = new AP.View(canvas, {
      onTap: function (x, y, s) { self._tap(x, y, s); },
      onWake: function () { self._kick(); },
      onZoom: function (z) { if (self.cb.onZoom) self.cb.onZoom(z); }
    });
    this.board = null; this.def = null;
    this.state = 'idle';
    this.paused = false;
    this.hearts = HEARTS; this.hints = HINTS; this.rulers = RULERS;
    this.mv = [];                       // arrows currently flying (state is per arrow)
    this.hintId = -1; this.hintT = 0; this.rulerT = 0;
    this.dots = []; this.parts = [];
    this.endTimer = 0; this.endKind = '';
    this.running = false; this.lastT = 0; this.raf = 0;
    this._tmp = [0, 0]; this._win = []; this._vis = [];
    this.dm = null; this._dotsDirty = false;
    this._needBoard = true; this._prevBA = false; this._fxDirty = false; this._bumping = false;
    // developer tools
    this.dev = { grid: false, perf: false };
    this._cs = null; this._csDirty = true;
    this._ring = new Float32Array(RING); this._ri = 0; this._rn = 0;
    this._frames = 0; this._time = 0; this._dropped = 0; this._lastMs = 0; this._perfT = 0;
    this._loop = this._loop.bind(this);
    this._onVis = function () { self.lastT = 0; if (!document.hidden && self.running) self._kick(); };
    document.addEventListener('visibilitychange', this._onVis);
  }

  /* optional overview dot map (canvas), kept in sync with the real grid */
  Game.prototype.attachDots = function (canvas) { this.dm = new AP.DotMap(canvas); this._dotsDirty = true; };
  Game.prototype.resizeDots = function (w, h) { if (this.dm) { this.dm.resize(w, h, Math.min(window.devicePixelRatio || 1, 3)); this._kick(); } };

  Game.prototype.destroy = function () {
    this.running = false;
    cancelAnimationFrame(this.raf); this.raf = 0;
    document.removeEventListener('visibilitychange', this._onVis);
  };

  Game.prototype.resize = function (w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cv.width = Math.max(1, Math.round(w * dpr));
    this.cv.height = Math.max(1, Math.round(h * dpr));
    this.view.resize(w, h, dpr);
    this._needBoard = true;
    this._kick();
  };

  /* size/position of the full-area animation layer; (ox, oy) = stage origin inside it */
  Game.prototype.setFx = function (W, H, ox, oy) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.fxW = W; this.fxH = H; this.fxX = ox; this.fxY = oy;
    this.fx.width = Math.max(1, Math.round(W * dpr));
    this.fx.height = Math.max(1, Math.round(H * dpr));
    this._fxDirty = true;
    this._kick();
  };

  Game.prototype.load = function (def) {
    this.cancelFx();
    this.def = def;
    this.board = new AP.Board(def);
    this.state = 'play';
    this.hearts = HEARTS; this.hints = HINTS; this.rulers = RULERS;
    this.hintId = -1; this.hintT = 0; this.rulerT = 0; this.parts.length = 0;
    this.endTimer = 0; this.endKind = '';
    var i, a;
    for (i = 0; i < this.board.arrows.length; i++) {
      a = this.board.arrows[i];
      a.phase = 0; a.t = 0; a.s = 0; a.v = 0; a.bump = -1; a.flash = -1;
      var mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
      for (var k = 0; k < a.cells.length; k++) {
        mnx = Math.min(mnx, a.cells[k][0]); mxx = Math.max(mxx, a.cells[k][0] + 1);
        mny = Math.min(mny, a.cells[k][1]); mxy = Math.max(mxy, a.cells[k][1] + 1);
      }
      a.bb = [mnx - 0.3, mny - 0.3, mxx + 0.3, mxy + 0.3];
    }
    this.dots = [];
    for (var r = 0; r < def.rows; r++) for (var c = 0; c < def.cols; c++)
      if (this.board.grid[r * def.cols + c] < 0) this.dots.push(c + 0.5, r + 0.5);
    this._cs = new Uint8Array(def.cols * def.rows); this._csDirty = true;
    this.view.setBoard(def.cols, def.rows);
    if (this.dm) { this.dm.setBoard(this.board); this._dotsDirty = false; }
    this._resetPerf();
    this._needBoard = true;
    this._emit();
    this.running = true;
    this._kick();
  };

  /* stop every flying arrow immediately and clear the animation layer (restart / leave level) */
  Game.prototype.cancelFx = function () {
    this.mv.length = 0; this.parts.length = 0;
    this.endTimer = 0; this.endKind = '';
    this.fctx.setTransform(1, 0, 0, 1, 0, 0);
    this.fctx.clearRect(0, 0, this.fx.width, this.fx.height);
    this._fxDirty = false;
  };

  Game.prototype.restart = function () { if (this.def) this.load(this.def); };
  Game.prototype.setPaused = function (p) { this.paused = p; this.lastT = 0; if (!p) { this._needBoard = true; this._kick(); } };
  Game.prototype.fit = function () { this.view.fit(true); this._kick(); };
  Game.prototype.zoomBy = function (f) {
    var v = this.view;
    v.zoomAt(v.w / 2, v.h / 2, v.scale * f, v.minS, v.maxS); this._kick();
  };
  Game.prototype.getInfo = function () {
    return {
      alive: this.board ? this.board.alive : 0, total: this.board ? this.board.arrows.length : 0,
      hearts: this.hearts, hints: this.hints, rulers: this.rulers, state: this.state, moving: this.mv.length
    };
  };
  Game.prototype._emit = function () { if (this.cb.onState) this.cb.onState(this.getInfo()); };

  Game.prototype.setDev = function (o) {
    if (o.grid !== undefined) { this.dev.grid = !!o.grid; this._csDirty = true; }
    if (o.perf !== undefined) { this.dev.perf = !!o.perf; this._resetPerf(); }
    this._needBoard = true; this._kick();
  };

  /* ---------- picking ---------- */
  function segDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    var t = l2 ? clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0;
    var qx = x1 + dx * t - px, qy = y1 + dy * t - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  Game.prototype._pick = function (wx, wy, scale) {
    var b = this.board, th = clamp(18 / scale, 0.34, 1.25);
    var R = Math.ceil(th), cx = Math.floor(wx), cy = Math.floor(wy);
    var best = -1, bd = th + 1e-6;
    for (var r = cy - R; r <= cy + R; r++) {
      if (r < 0 || r >= b.rows) continue;
      for (var c = cx - R; c <= cx + R; c++) {
        if (c < 0 || c >= b.cols) continue;
        var id = b.grid[r * b.cols + c];
        if (id < 0) continue;
        var a = b.arrows[id], pts = a.pts, n = a.cells.length, d = 1e9;
        for (var i = 1; i < n; i++) d = Math.min(d, segDist(wx, wy, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
        var hx = a.hx + AP.DX[a.dir] * HEAD_LEN, hy = a.hy + AP.DY[a.dir] * HEAD_LEN;
        d = Math.min(d, segDist(wx, wy, a.hx, a.hy, hx, hy) - 0.1);
        if (d < bd) { bd = d; best = id; }
      }
    }
    return best;
  };

  /* ---------- actions ---------- */
  Game.prototype._tap = function (wx, wy, scale) {
    if (this.paused || this.state !== 'play') return;
    var id = this._pick(wx, wy, scale);
    if (id < 0) return;
    var b = this.board, a = b.arrows[id];
    if (!a.alive || a.phase !== 0) return;      // already flying / gone: ignore repeated taps
    if (a.bump >= 0) return;
    var blId = b.blockerId(a);
    if (blId < 0) {
      b.remove(id);                              // occupancy grid updated at launch
      a.phase = 2; a.t = 0; a.s = 0;
      var vw = this.view, sc = vw.scale, ox = vw.tx + this.fxX, oy = vw.ty + this.fxY, edge;
      a.v = clamp(SPEED_PX / sc, MIN_V, MAX_V);                // cruise speed, fixed for the whole flight
      if (a.dir === 'R') edge = (this.fxW - ox) / sc - a.hx;   // head -> visible edge, in cells
      else if (a.dir === 'L') edge = a.hx + ox / sc;
      else if (a.dir === 'D') edge = (this.fxH - oy) / sc - a.hy;
      else edge = a.hy + oy / sc;
      a.D = Math.max(a.L + edge, a.dEdge + a.L) + EXIT_MARGIN; // path length until the TAIL has left the screen
      this.mv.push(a);
      this._csDirty = true; this._needBoard = true; this._fxDirty = true; this._dotsDirty = true;
      if (this.hintId === id) { this.hintId = -1; this.hintT = 0; }
      if (this.cb.onSfx) this.cb.onSfx('go');
      if (b.alive === 0) { this.endKind = 'win'; this.endTimer = 0.3; }
      this._emit();
    } else {
      a.bump = 0;
      b.arrows[blId].flash = 0;
      this.hearts--;
      if (this.cb.onSfx) this.cb.onSfx('err');
      if (this.cb.onHaptic) this.cb.onHaptic();
      if (this.hearts <= 0) { this.state = 'lost'; this.endKind = 'lose'; this.endTimer = 0.75; }
      if (this.cb.onHeartLost) this.cb.onHeartLost(this.hearts);
      this._emit();
    }
    this._kick();
  };

  Game.prototype.useHint = function () {
    if (this.state !== 'play' || this.paused || this.hints <= 0) return false;
    var free = this.board.freeArrows();
    if (!free.length) return false;
    var v = this.view, w = v.toWorld(v.w / 2, v.h / 2), best = -1, bd = 1e12, i;
    for (i = 0; i < free.length; i++) {
      var a = this.board.arrows[free[i]], dx = a.hx - w[0], dy = a.hy - w[1], d = dx * dx + dy * dy;
      if (v.isVisible(a.hx, a.hy, 30)) d *= 0.25;
      if (d < bd) { bd = d; best = free[i]; }
    }
    var h = this.board.arrows[best];
    this.hintId = best; this.hintT = HINT_T; this.hints--;
    if (!v.isVisible(h.hx, h.hy, 40) || v.zoomFactor() < 1.5) {
      var s = Math.max(v.scale, Math.min(v.maxS, 34));
      if (v.isVisible(h.hx, h.hy, 40)) s = Math.max(v.scale, v.minS * 1.0);
      v.centerOn(h.hx, h.hy, v.isVisible(h.hx, h.hy, 40) ? v.scale : s, 380);
    }
    if (this.cb.onSfx) this.cb.onSfx('hint');
    this._emit(); this._kick();
    return true;
  };

  Game.prototype.useRuler = function () {
    if (this.state !== 'play' || this.paused || this.rulers <= 0 || this.rulerT > 0) return false;
    this.rulers--; this.rulerT = RULER_T;
    if (this.cb.onSfx) this.cb.onSfx('hint');
    this._emit(); this._kick();
    return true;
  };

  /* ---------- loop ---------- */
  Game.prototype._animating = function () {
    return this.mv.length > 0 || this.hintT > 0 || this.rulerT > 0 || this.parts.length > 0 ||
      this.endTimer > 0 || this._bumping || (this.dm && this.dm.active) || this.view.tween !== null ||
      this.view.vx !== 0 || this.view.vy !== 0 || this.view.dirty || this.view.ptrs.size > 0;
  };
  Game.prototype._kick = function () {
    if (this.raf || !this.running || document.hidden) return;
    this.lastT = 0;
    this.raf = requestAnimationFrame(this._loop);
  };
  Game.prototype._loop = function (now) {
    this.raf = 0;
    if (!this.running) return;
    var raw = this.lastT ? now - this.lastT : 0;
    var dt = raw ? raw / 1000 : 1 / 60;
    this.lastT = now;
    if (dt > MAX_DT) dt = MAX_DT;
    if (this.paused) { this._renderBoard(); return; }
    if (raw) this._perf(raw);
    this._update(dt);
    if (this.dm) {
      if (this._dotsDirty) { this.dm.sync(this.board); this._dotsDirty = false; }
      var dmA = this.dm.step(dt);
      if (dmA || this._vd || this.dm.needDraw) this.dm.draw(this.view);
    }
    var ba = this._bumping || this.hintT > 0 || this.rulerT > 0;
    if (this._vd || this._needBoard || ba || this._prevBA) { this._renderBoard(); this._needBoard = false; }
    this._prevBA = ba;
    if (this._fxDirty || this.mv.length || this.parts.length) this._renderFx();
    if (this._animating()) this.raf = requestAnimationFrame(this._loop);
  };

  Game.prototype._update = function (dt) {
    var v = this.view;
    this._vd = v.update(dt);
    var b = this.board; if (!b) return;
    var i, a, bumping = false;

    // flying arrows: smooth ramp-in -> constant cruise -> gentle ease-out; removed only once fully off-screen
    if (this.mv.length) {
      var sc = v.scale, ox = v.tx + this.fxX, oy = v.ty + this.fxY;
      var x0 = -ox / sc, y0 = -oy / sc, x1 = (this.fxW - ox) / sc, y1 = (this.fxH - oy) / sc;
      var cap = Math.max(x1 - x0, y1 - y0) + 40, t = this._tmp;
      for (i = this.mv.length - 1; i >= 0; i--) {
        a = this.mv[i];
        a.t += dt;
        var u = a.s / a.D; if (u > 1) u = 1;
        var dec = 1;
        if (u > DEC_START) { var q = (u - DEC_START) / (1 - DEC_START); dec = 1 - DEC_DROP * q * q * (3 - 2 * q); }
        var rm = 1;
        if (a.t < RAMP) { var r0 = a.t / RAMP; rm = r0 * r0 * (3 - 2 * r0); }
        a.s += a.v * rm * dec * dt;
        var done = false;
        if (a.s >= a.D) {                          // planned route finished: confirm against the CURRENT view
          pointAt(a, a.s, t);                      // tail position (on the straight run-out line)
          var m = EXIT_MARGIN;
          switch (a.dir) {
            case 'R': done = t[0] > x1 + m; break;
            case 'L': done = t[0] < x0 - m; break;
            case 'D': done = t[1] > y1 + m; break;
            default:  done = t[1] < y0 - m;
          }
          if (a.s > a.D + cap) done = true;        // safety net
        }
        if (done) {
          a.phase = 3;
          var last = this.mv.pop();
          if (last !== a) this.mv[i] = last;
          this._fxDirty = true;                    // one more pass to wipe the last frame
        }
      }
    }

    for (i = 0; i < b.arrows.length; i++) {
      a = b.arrows[i];
      if (a.bump >= 0) { a.bump += dt; if (a.bump > BUMP_T) a.bump = -1; else bumping = true; }
      if (a.flash >= 0) { a.flash += dt; if (a.flash > BUMP_T) a.flash = -1; else bumping = true; }
    }
    this._bumping = bumping;
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintId = -1; }
    if (this.rulerT > 0) this.rulerT = Math.max(0, this.rulerT - dt);
    if (this.parts.length) this._stepParts(dt);

    if (this.endTimer > 0 && this.mv.length === 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        if (this.endKind === 'win') {
          this.state = 'won'; this._confetti(); this.view.fit(true);
          if (this.cb.onWin) this.cb.onWin();
        } else if (this.endKind === 'lose') {
          if (this.cb.onLose) this.cb.onLose();
        }
        this.endKind = '';
        this._emit();
      }
    }
  };

  /* ---------- performance monitor (developer mode) ---------- */
  Game.prototype._resetPerf = function () {
    this._ri = 0; this._rn = 0; this._frames = 0; this._time = 0; this._dropped = 0; this._lastMs = 0; this._perfT = 0;
  };
  Game.prototype._perf = function (ms) {
    if (!this.dev.perf) return;
    this._ring[this._ri] = ms; this._ri = (this._ri + 1) % RING; if (this._rn < RING) this._rn++;
    this._frames++; this._time += ms; this._lastMs = ms;
    var i, mn = 1e9, n = this._rn;
    for (i = 0; i < n; i++) { var d = this._ring[i]; if (d > 3 && d < mn) mn = d; }
    if (ms > mn * 1.5 && mn < 1e9) this._dropped++;
    this._perfT += ms;
    if (this._perfT >= 250) {
      this._perfT = 0;
      var m = Math.min(30, n), sum = 0;
      for (i = 1; i <= m; i++) sum += this._ring[(this._ri - i + RING) % RING];
      if (this.cb.onPerf) this.cb.onPerf({
        fps: m ? 1000 / (sum / m) : 0, avg: this._time ? this._frames * 1000 / this._time : 0, ms: this._lastMs,
        dropped: this._dropped, moving: this.mv.length, refresh: mn < 1e9 ? 1000 / mn : 0,
        state: this.paused ? 'paused' : this.mv.length ? 'flying' : this._bumping ? 'bump' : (this.view.tween || this.view.ptrs.size || this.view.vx || this.view.vy) ? 'camera' : 'idle'
      });
    }
  };

  /* ---------- confetti (drawn on the fx layer, screen space) ---------- */
  Game.prototype._confetti = function () {
    var cols = ['#2f86eb', '#ffb800', '#ef4444', '#22c55e', '#a855f7', '#0e1650'];
    var w = this.fxW, h = this.fxH;
    for (var i = 0; i < 70; i++) {
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.9, sp = (0.5 + Math.random()) * Math.min(w, h) * 1.1;
      this.parts.push({
        x: w / 2, y: h * 0.55, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        r: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
        c: cols[i % cols.length], life: 1.5 + Math.random() * 0.6, t: 0
      });
    }
    this._fxDirty = true;
  };
  Game.prototype._stepParts = function (dt) {
    var p = this.parts;
    for (var i = p.length - 1; i >= 0; i--) {
      var q = p[i];
      q.t += dt; q.vy += 900 * dt; q.vx *= 0.99; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
      if (q.t > q.life) { p[i] = p[p.length - 1]; p.pop(); }
    }
    if (!p.length) this._fxDirty = true;
  };

  /* ---------- rendering ---------- */
  function headPath(ctx, hx, hy, dx, dy) {
    var px = -dy, py = dx;
    ctx.moveTo(hx + dx * HEAD_LEN, hy + dy * HEAD_LEN);
    ctx.lineTo(hx - dx * 0.04 + px * HEAD_HALF, hy - dy * 0.04 + py * HEAD_HALF);
    ctx.lineTo(hx - dx * 0.04 - px * HEAD_HALF, hy - dy * 0.04 - py * HEAD_HALF);
    ctx.closePath();
  }

  /* visible window of the arrow polyline -> this._win (flat x,y list) */
  Game.prototype._window = function (a, s) {
    var w = this._win, t = this._tmp, n = 0, i;
    pointAt(a, s, t); w[n++] = t[0]; w[n++] = t[1];
    var end = s + a.L;
    for (i = 0; i < a.pts.length; i++) {
      var d = a.cum[i];
      if (d > s + 1e-6 && d < end - 1e-6) { w[n++] = a.pts[i][0]; w[n++] = a.pts[i][1]; }
    }
    pointAt(a, end, t); w[n++] = t[0]; w[n++] = t[1];
    w.length = n;
    return n;
  };

  Game.prototype._drawOne = function (ctx, a, color, ox, oy, lw, glow) {
    var n = this._window(a, a.s), w = this._win, i;
    var dx = AP.DX[a.dir], dy = AP.DY[a.dir];
    ctx.save();
    ctx.translate(ox, oy);
    if (glow) {
      ctx.strokeStyle = glow.c; ctx.fillStyle = glow.c; ctx.lineWidth = lw + glow.w;
      ctx.globalAlpha = glow.a;
      ctx.beginPath(); ctx.moveTo(w[0], w[1]);
      for (i = 2; i < n; i += 2) ctx.lineTo(w[i], w[i + 1]);
      ctx.stroke();
      ctx.beginPath(); headPath(ctx, w[n - 2], w[n - 1], dx, dy); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(w[0], w[1]);
    for (i = 2; i < n; i += 2) ctx.lineTo(w[i], w[i + 1]);
    ctx.stroke();
    ctx.beginPath(); headPath(ctx, w[n - 2], w[n - 1], dx, dy); ctx.fill();
    ctx.lineWidth = lw * 0.35; ctx.stroke();
    ctx.restore();
  };

  /* animation layer: flying arrows (opacity 1, never faded or scaled) + confetti */
  Game.prototype._renderFx = function () {
    var ctx = this.fctx, v = this.view, i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    this._fxDirty = false;
    if (this.mv.length) {
      var k = v.dpr * v.scale, lw = Math.max(LW, 1.7 / v.scale);
      ctx.setTransform(k, 0, 0, k, v.dpr * (v.tx + this.fxX), v.dpr * (v.ty + this.fxY));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 1;
      for (i = 0; i < this.mv.length; i++) this._drawOne(ctx, this.mv[i], INK, 0, 0, lw, null);
    }
    if (this.parts.length) {
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      for (i = 0; i < this.parts.length; i++) {
        var q = this.parts[i];
        ctx.save();
        ctx.globalAlpha = clamp(1 - (q.t - q.life * 0.6) / (q.life * 0.4), 0, 1);
        ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillStyle = q.c; ctx.fillRect(-q.r, -q.r * 0.5, q.r * 2, q.r);
        ctx.restore();
      }
    }
  };

  Game.prototype._renderBoard = function () {
    var ctx = this.ctx, v = this.view, b = this.board;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!b) return;
    v.apply(ctx);
    var sc = v.scale, lw = Math.max(LW, 1.7 / sc);
    var x0 = -v.tx / sc, y0 = -v.ty / sc, x1 = (v.w - v.tx) / sc, y1 = (v.h - v.ty) / sc;
    var i, a, k;

    // empty-cell dots
    ctx.fillStyle = '#d3d9e4';
    var dr = Math.max(0.05, 1.1 / sc), dd = this.dots;
    ctx.beginPath();
    for (i = 0; i < dd.length; i += 2) {
      if (dd[i] < x0 - 1 || dd[i] > x1 + 1 || dd[i + 1] < y0 - 1 || dd[i + 1] > y1 + 1) continue;
      ctx.moveTo(dd[i] + dr, dd[i + 1]); ctx.arc(dd[i], dd[i + 1], dr, 0, 6.2832);
    }
    ctx.fill();

    // developer: occupancy grid overlay
    if (this.dev.grid) {
      if (this._csDirty) { b.cellStates(this._cs); this._csDirty = false; }
      var cs = this._cs, COL = ['rgba(140,150,170,.10)', 'rgba(59,130,246,.22)', 'rgba(239,68,68,.32)', 'rgba(34,197,94,.30)'];
      var c0 = Math.max(0, Math.floor(x0)), c1 = Math.min(b.cols - 1, Math.floor(x1));
      var r0 = Math.max(0, Math.floor(y0)), r1 = Math.min(b.rows - 1, Math.floor(y1));
      for (var st = 0; st < 4; st++) {
        ctx.fillStyle = COL[st]; ctx.beginPath();
        for (var rr = r0; rr <= r1; rr++) for (var cc = c0; cc <= c1; cc++)
          if (cs[rr * b.cols + cc] === st) ctx.rect(cc + 0.04, rr + 0.04, 0.92, 0.92);
        ctx.fill();
      }
    }

    // ruler guides
    if (this.rulerT > 0) {
      var ra = Math.min(1, this.rulerT / 0.5, (RULER_T - this.rulerT) / 0.15 + 0.01);
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(0.07, 1.3 / sc);
      ctx.setLineDash([0.16, 0.16]);
      for (i = 0; i < b.arrows.length; i++) {
        a = b.arrows[i];
        if (!a.alive) continue;
        var bl = b.blocker(a), dx = AP.DX[a.dir], dy = AP.DY[a.dir];
        var sx = a.hx + dx * HEAD_LEN, sy = a.hy + dy * HEAD_LEN, ex, ey;
        if (bl) { ex = bl.c + 0.5 - dx * 0.5; ey = bl.r + 0.5 - dy * 0.5; ctx.strokeStyle = RED; }
        else { ex = a.hx + dx * a.dEdge; ey = a.hy + dy * a.dEdge; ctx.strokeStyle = GREEN; }
        ctx.globalAlpha = 0.85 * ra;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.restore();
    }

    // idle arrows: one batched pass
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = lw;
    ctx.beginPath();
    var vis = this._vis; vis.length = 0;
    for (i = 0; i < b.arrows.length; i++) {
      a = b.arrows[i];
      if (!a.alive || a.phase !== 0) continue;
      if (a.bump >= 0 || a.flash >= 0 || i === this.hintId) { vis.push(i); continue; }
      if (a.bb[2] < x0 || a.bb[0] > x1 || a.bb[3] < y0 || a.bb[1] > y1) continue;
      ctx.moveTo(a.pts[0][0], a.pts[0][1]);
      for (k = 1; k < a.cells.length; k++) ctx.lineTo(a.pts[k][0], a.pts[k][1]);
    }
    ctx.stroke();
    ctx.beginPath();
    for (i = 0; i < b.arrows.length; i++) {
      a = b.arrows[i];
      if (!a.alive || a.phase !== 0) continue;
      if (a.bump >= 0 || a.flash >= 0 || i === this.hintId) continue;
      if (a.bb[2] < x0 || a.bb[0] > x1 || a.bb[3] < y0 || a.bb[1] > y1) continue;
      headPath(ctx, a.hx, a.hy, AP.DX[a.dir], AP.DY[a.dir]);
    }
    ctx.fill();
    ctx.lineWidth = lw * 0.35; ctx.stroke();

    // flashing / hinted arrows
    for (k = 0; k < vis.length; k++) {
      a = b.arrows[vis[k]];
      var color = INK, ox = 0, oy = 0, glow = null;
      if (a.flash >= 0) {
        var f = 1 - a.flash / BUMP_T;
        color = ORANGE; glow = { c: ORANGE, w: 0.3, a: 0.28 * f };
      }
      if (a.bump >= 0) {
        var t = a.bump, o = 0.22 * Math.exp(-7 * t) * Math.sin(34 * t);
        ox = AP.DX[a.dir] * o; oy = AP.DY[a.dir] * o;
        color = RED; glow = { c: RED, w: 0.34, a: 0.3 * (1 - t / BUMP_T) };
      }
      if (vis[k] === this.hintId) {
        var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
        var fade = Math.min(1, this.hintT / 0.4);
        color = BLUE; glow = { c: GOLD, w: 0.5 + 0.25 * pulse, a: (0.4 + 0.3 * pulse) * fade };
      }
      a.s = 0;
      this._drawOne(ctx, a, color, ox, oy, lw, glow);
    }
  };

  AP.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
