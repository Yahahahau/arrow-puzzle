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

  // default (light) palette; replaced from the active theme through Game.setPalette
  var PAL0 = { 'ink': '#111111', 'arrow-fill': '#ffd23f', 'dot-empty': '#cfcfc6', 'hint': '#7fd3ff', 'glow': '#14f05a', 'danger': '#ff3b3b', 'warn': '#ff8a00', 'ok': '#00c84a',
    'confetti-1': '#14f05a', 'confetti-2': '#ffd23f', 'confetti-3': '#7fd3ff', 'confetti-4': '#ff4b4b', 'confetti-5': '#111111', 'confetti-6': '#ffffff' };
  var LW = 0.17;                 // reference line width (cells) — used by the impact distance, unchanged
  // cartoon look (render-only): bold ink outline around a bright body, irregular dart heads
  var OW = 0.27, IW_K = 0.46;    // outline stroke width (cells) and the fill's share of it
  var HEAD_HH = 0.3, NOTCH = 0.11, WOB = 0.028;
  var HEAD_LEN = 0.46, HEAD_HALF = 0.27;
  var SPEED_PX = 1010;           // cruise speed in screen px / second at launch zoom (27% slower than round 3: 1400)
  var MIN_V = 10, MAX_V = 90;    // clamp in cells / second
  var RAMP = 0.07;               // s: smoothstep velocity ramp at the start (no jump)
  var DEC_START = 0.6, DEC_DROP = 0.45;  // last 40% of the route eases down to 55% of cruise speed (never stops)
  var EXIT_MARGIN = 1.5;         // cells beyond the visible edge before the arrow is removed
  var BUMP_T = 0.5;                                   // blocker flash duration
  var POP_T = 0.75;                                   // board dot "pop in" (spring) duration
  var HIT_GAP = 0.02;                                 // cells left between arrow tip and the blocker's stroke at impact
  var BACK_MIN = 0.34, BACK_MAX = 0.7;                // retreat duration range (s), relaxed ease-in-out
  var HOVER_S = 1.035, PRESS_S = 0.93, LIFT = 0.05;   // arrow interaction: scale / lift (cells), render-only
  var SPR_K = 380, SPR_C = 21;                        // spring stiffness / damping (slight overshoot)
  var HINT_T = 3.6, RULER_T = 4.2;
  var LIVES = 3, HINTS = 3, RULERS = 3;
  var MAX_DT = 0.1;
  var RING = 120;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rgbOf(c) {
    var m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return [parseInt(m[1].substr(0, 2), 16), parseInt(m[1].substr(2, 2), 16), parseInt(m[1].substr(4, 2), 16)];
    m = /(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c || ''); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  }
  function mix(c1, c2, t) {
    var a = rgbOf(c1), b = rgbOf(c2);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

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
      onZoom: function (z) { if (self.cb.onZoom) self.cb.onZoom(z); },
      onDown: function (x, y, s, type) { self._down(x, y, s, type); },
      onUp: function (tap) { self._release(tap); },
      onCancel: function () { self._release(false); },
      onHover: function (x, y, s) { self._hover(x, y, s); }
    });
    this.pal = {}; for (var pk in PAL0) this.pal[pk] = PAL0[pk];
    this.cf = []; this.cfv = null; this.cfctx = null; 
    this.hoverId = -1; this.pressId = -1; this._spring = 0;
    this.board = null; this.def = null;
    this.state = 'idle';
    this.paused = false;
    this.lives = LIVES; this.hints = HINTS; this.rulers = RULERS;
    this.mv = [];                       // arrows currently flying (state is per arrow)
    this.hintId = -1; this.hintT = 0; this.rulerT = 0;
    this.dotB = null; this.clock = 0; this._dotsAnimUntil = 0; this.bp = [];
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

  /* theme palette: strings 'rgb(...)'/'#hex' keyed like PAL0 (+ map-* for the dot map) */
  Game.prototype.setPalette = function (p) {
    for (var k in p) this.pal[k] = p[k];
    if (this.dm) this.dm.setPalette(p);
    this._needBoard = true; this._fxDirty = true; this._kick();
  };
  Game.prototype.setConfetti = function (canvas) { this.cfv = canvas; this.cfctx = canvas.getContext('2d', { alpha: true }); };

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
    if (this.cfv) { this.cfv.width = this.fx.width; this.cfv.height = this.fx.height; }
    this._kick();
  };

  Game.prototype.load = function (def) {
    this.cancelFx();
    this.def = def;
    this.board = new AP.Board(def);
    this.state = 'play';
    this.lives = LIVES; this.hints = HINTS; this.rulers = RULERS;
    this.hintId = -1; this.hintT = 0; this.rulerT = 0; this.hoverId = -1; this.pressId = -1; this._spring = 0;
    this.endTimer = 0; this.endKind = '';
    var i, a;
    for (i = 0; i < this.board.arrows.length; i++) {
      a = this.board.arrows[i];
      a.phase = 0; a.t = 0; a.s = 0; a.v = 0; a.bump = -1; a.flash = -1; a.sc = 1; a.sv = 0; a.hv = 0; a.tg = 1; a.dl = 0; a.vac = 0; a.hitT = -1;
      var mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
      for (var k = 0; k < a.cells.length; k++) {
        mnx = Math.min(mnx, a.cells[k][0]); mxx = Math.max(mxx, a.cells[k][0] + 1);
        mny = Math.min(mny, a.cells[k][1]); mxy = Math.max(mxy, a.cells[k][1] + 1);
      }
      a.bb = [mnx - 0.3, mny - 0.3, mxx + 0.3, mxy + 0.3];
      // hand-drawn imperfection of the head: fixed per arrow (seeded), so it never flickers
      var sd = (a.hx * 73.1 + a.hy * 37.7 + i * 11.3) % 1, wb = a.wb = [];
      for (var q = 0; q < 6; q++) { sd = (sd * 9301 + 49297) % 233280 / 233280 || 0.37; wb.push((sd * 2 - 1) * WOB); }
    }
    // board dots: born (with a springy pop) on empty cells at level start, and on arrow cells only once
    // the arrow has really left them. dotB[cell] = birth time on this.clock, -1 = no dot.
    var nC = def.cols * def.rows, cx0 = def.cols / 2, cy0 = def.rows / 2, md = Math.sqrt(cx0 * cx0 + cy0 * cy0) || 1;
    this.dotB = new Float32Array(nC); this.clock = 0; this.bp.length = 0;
    var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (var r = 0; r < def.rows; r++) for (var c = 0; c < def.cols; c++) {
      var dd = Math.sqrt((c + 0.5 - cx0) * (c + 0.5 - cx0) + (r + 0.5 - cy0) * (r + 0.5 - cy0)) / md;
      this.dotB[r * def.cols + c] = this.board.grid[r * def.cols + c] < 0 ? (rm ? -POP_T : 0.12 + dd * 0.4) : -1;
    }
    // intro: arrows spring in from the centre outwards (render-only)
    if (!rm) for (i = 0; i < this.board.arrows.length; i++) {
      a = this.board.arrows[i];
      var ax = (a.bb[0] + a.bb[2]) / 2 - cx0, ay = (a.bb[1] + a.bb[3]) / 2 - cy0;
      a.sc = 0; a.sv = 0; a.tg = 1; a.dl = 0.04 + Math.sqrt(ax * ax + ay * ay) / md * 0.42;
    }
    this._spring = rm ? 0 : 1;
    this._dotsAnimUntil = 0.12 + 0.4 + POP_T;
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
    this.mv.length = 0; this.cf.length = 0;
    if (this.cfctx) { this.cfctx.setTransform(1, 0, 0, 1, 0, 0); this.cfctx.clearRect(0, 0, this.cfv.width, this.cfv.height); }
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
      lives: this.lives, hints: this.hints, rulers: this.rulers, state: this.state, moving: this.mv.length
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

  /* ---------- hover / press (render-only springs: grid position and collision are never touched) ---------- */
  Game.prototype._target = function (id, kind) {          // kind: 'hv' hover, 'pr' press
    var b = this.board; if (!b) return;
    var a, i;
    if (kind === 'hv') {
      if (id === this.hoverId) return;
      if (this.hoverId >= 0) b.arrows[this.hoverId].tg = this.pressId === this.hoverId ? PRESS_S : 1;
      this.hoverId = id;
      if (id >= 0 && this.pressId !== id) b.arrows[id].tg = HOVER_S;
    } else {
      if (this.pressId >= 0 && this.pressId !== id) { a = b.arrows[this.pressId]; a.tg = this.hoverId === this.pressId ? HOVER_S : 1; }
      this.pressId = id;
      if (id >= 0) b.arrows[id].tg = PRESS_S;
    }
    this._spring = 1; this._needBoard = true; this._kick();
  };
  Game.prototype._canAct = function (id) {
    var a = this.board.arrows[id];
    return a.alive && a.phase === 0 && !this.paused && this.state === 'play';
  };
  Game.prototype._hover = function (x, y, s) {
    if (!this.board || this.paused || this.state !== 'play' || this.view.ptrs.size) return;
    var id = x === null || x === undefined ? -1 : this._pick(x, y, s);
    if (id >= 0 && !this._canAct(id)) id = -1;
    this.cv.style.cursor = id >= 0 ? 'pointer' : '';
    this._target(id, 'hv');
  };
  Game.prototype._down = function (x, y, s, type) {
    if (!this.board || this.paused || this.state !== 'play') return;
    var id = this._pick(x, y, s);
    if (id >= 0 && this._canAct(id)) this._target(id, 'pr');
  };
  Game.prototype._release = function (tap) {
    if (!this.board || this.pressId < 0) return;
    var id = this.pressId; this.pressId = -1;
    var a = this.board.arrows[id];
    a.tg = (this.hoverId === id && !tap) ? HOVER_S : 1;
    this._spring = 1; this._needBoard = true; this._kick();
  };
  Game.prototype._stepSprings = function (dt) {
    var b = this.board; if (!b || !this._spring) return false;
    var any = false, n = b.arrows.length, i, a, k = 0;
    var h = Math.min(dt, 1 / 30);
    for (i = 0; i < n; i++) {
      a = b.arrows[i];
      if (!a.alive || a.phase > 1) continue;
      if (a.dl > 0) { a.dl -= dt; any = true; continue; }
      var d = a.sc - a.tg;
      if (d > 0.0005 || d < -0.0005 || a.sv > 0.002 || a.sv < -0.002) {
        a.sv += (-SPR_K * d - SPR_C * a.sv) * h; a.sc += a.sv * h; any = true;
      } else { a.sc = a.tg; a.sv = 0; }
      a.hv += ((a.tg > 1 ? 1 : 0) - a.hv) * (1 - Math.exp(-h * 14));
      if (a.hv < 0.003 && a.tg <= 1) a.hv = 0; else any = true;
    }
    if (!any) this._spring = 0;
    return any;
  };

  /* ---------- actions ---------- */
  Game.prototype._tap = function (wx, wy, scale) {
    if (this.paused || this.state !== 'play') return;
    var id = this._pick(wx, wy, scale);
    if (id < 0) return;
    var b = this.board, a = b.arrows[id];
    if (!a.alive || a.phase !== 0) return;      // already flying / gone: ignore repeated taps
    var blId = b.blockerId(a);
    if (blId < 0) {
      b.remove(id);                              // occupancy grid updated at launch
      a.phase = 2; a.t = 0; a.s = 0; a.tg = 1;   // the press spring flows into the movement (continues in the fx layer)
      if (this.hoverId === id) this.hoverId = -1;
      if (this.pressId === id) this.pressId = -1;
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
      // blocked: the arrow really travels forward along its path until its tip touches the blocker,
      // loses a life on impact, then eases back to where it started. The grid never changes.
      var bl = b.blocker(a);
      a.phase = 1; a.t = 0; a.s = 0; a.tg = 1; a.hitT = -1;
      a.hit = Math.max(0.12, bl.dist - HEAD_LEN - LW * 0.5 - HIT_GAP);
      a.blk = bl.id;
      a.v = clamp(SPEED_PX / this.view.scale, MIN_V, MAX_V);
      if (this.pressId === id) this.pressId = -1;
      this.bp.push(a);
      if (this.hintId === id) { this.hintId = -1; this.hintT = 0; }
      if (this.cb.onSfx) this.cb.onSfx('go');
    }
    this._kick();
  };

  Game.prototype._impact = function (a) {
    var b = this.board;
    if (b.arrows[a.blk] && b.arrows[a.blk].alive) b.arrows[a.blk].flash = 0;
    a.sv = -2.6;                                 // small squash on the spring, released while backing off
    this.lives--;
    if (this.cb.onSfx) this.cb.onSfx('err');
    if (this.cb.onHaptic) this.cb.onHaptic();
    if (this.lives <= 0) { this.state = 'lost'; this.endKind = 'lose'; this.endTimer = 0.75; }
    if (this.cb.onLifeLost) this.cb.onLifeLost(this.lives);
    this._spring = 1;
    this._emit();
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
    return this.mv.length > 0 || this.hintT > 0 || this.rulerT > 0 ||
      this.endTimer > 0 || this._bumping || this._spring || (this.board && this.clock < this._dotsAnimUntil) || this.cf.length || (this.dm && this.dm.active) || this.view.tween !== null ||
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
    var dt = this.lastT ? raw / 1000 : 1 / 60;
    this.lastT = now;
    if (dt > MAX_DT) dt = MAX_DT;
    if (this.cf.length) { this._stepConfetti(dt); this._renderConfetti(); }
    if (this.paused) { this._renderBoard(); if (this.cf.length && !this.raf) this.raf = requestAnimationFrame(this._loop); return; }
    if (raw) this._perf(raw);
    this._update(dt);
    if (this.dm) {
      if (this._dotsDirty) { this.dm.sync(this.board); this._dotsDirty = false; }
      var dmA = this.dm.step(dt);
      if (dmA || this._vd || this.dm.needDraw) this.dm.draw(this.view);
    }
    var ba = this._bumping || this.hintT > 0 || this.rulerT > 0 || this._spring || this.clock < this._dotsAnimUntil;
    if (this._vd || this._needBoard || ba || this._prevBA) { this._renderBoard(); this._needBoard = false; }
    this._prevBA = ba;
    if (this._fxDirty || this.mv.length) this._renderFx();
    if (this._animating() && !this.raf) this.raf = requestAnimationFrame(this._loop);
  };

  Game.prototype._update = function (dt) {
    var v = this.view;
    this._vd = v.update(dt);
    var b = this.board; if (!b) return;
    if (this._spring) { this._stepSprings(dt); this._needBoard = true; }
    for (var mi = 0; mi < this.mv.length; mi++) {          // flying arrows: finish the press/hover spring on the fx layer
      var ma = this.mv[mi];
      if (ma.sc !== 1 || ma.sv) {
        var md = ma.sc - 1, hh = Math.min(dt, 1 / 30);
        ma.sv += (-SPR_K * md - SPR_C * ma.sv) * hh; ma.sc += ma.sv * hh;
        if (Math.abs(ma.sc - 1) < 0.0008 && Math.abs(ma.sv) < 0.003) { ma.sc = 1; ma.sv = 0; }
      }
    }
    var i, a, bumping = false;
    this.clock += dt;

    // blocked arrows: forward (same ramp + cruise as a real exit) -> impact -> relaxed retreat
    for (i = this.bp.length - 1; i >= 0; i--) {
      a = this.bp[i]; a.t += dt; bumping = true;
      if (a.hitT < 0) {
        var rr = a.t < RAMP ? (a.t / RAMP) * (a.t / RAMP) * (3 - 2 * a.t / RAMP) : 1;
        a.s += a.v * rr * dt;
        if (a.s >= a.hit) {
          a.s = a.hit; a.hitT = a.t;
          a.back = clamp(0.26 + a.hit * 0.045, BACK_MIN, BACK_MAX);
          this._impact(a);
        }
      } else {
        var k = (a.t - a.hitT - 0.06) / a.back;             // short hold at the contact point
        if (k > 0) {
          if (k >= 1) { a.s = 0; a.phase = 0; a.hitT = -1; this.bp[i] = this.bp[this.bp.length - 1]; this.bp.pop(); }
          else { var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; a.s = a.hit * (1 - e); }
        }
      }
    }

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
        while (a.vac < a.cells.length && a.s > a.cum[a.vac] + 0.5) {     // tail has fully left this cell -> its dot is born
          var vc = a.cells[a.vac++];
          this.dotB[vc[1] * b.cols + vc[0]] = this.clock;
          this._dotsAnimUntil = this.clock + POP_T; this._needBoard = true;
        }
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
          while (a.vac < a.cells.length) { var vc2 = a.cells[a.vac++]; this.dotB[vc2[1] * b.cols + vc2[0]] = this.clock; this._dotsAnimUntil = this.clock + POP_T; }
          var last = this.mv.pop();
          if (last !== a) this.mv[i] = last;
          this._fxDirty = true;                    // one more pass to wipe the last frame
        }
      }
    }

    for (i = 0; i < b.arrows.length; i++) {
      a = b.arrows[i];
      if (a.flash >= 0) { a.flash += dt; if (a.flash > BUMP_T) a.flash = -1; else bumping = true; }
    }
    this._bumping = bumping;
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintId = -1; }
    if (this.rulerT > 0) this.rulerT = Math.max(0, this.rulerT - dt);

    if (this.endTimer > 0 && this.mv.length === 0 && this.bp.length === 0) {
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

  /* ---------- confetti: own full-screen canvas, drawn in screen space ----------
   * ~60 pieces spawn staggered just above the top edge and fall with gravity -> per-piece terminal
   * velocity, horizontal drift + flutter, rotation and a flip (cos) for a paper look. A piece is only
   * removed once it is below the bottom edge (never faded out), so the whole shower lasts ~2.5-3.5 s.
   * It keeps running while a modal is open (the game loop is paused, confetti is not). */
  Game.prototype._confetti = function () {
    var W = this.fxW, H = this.fxH, N = 60, i, rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rm) N = 24;
    for (i = 0; i < N; i++) {
      var T = 2.15 + Math.random() * 0.5;                   // seconds from spawn to leaving the screen
      var size = 5 + Math.random() * 7;
      this.cf.push({
        x: Math.random() * W, y: -size * 3 - Math.random() * H * 0.08,
        d: Math.random() * 0.75,                            // spawn delay (s)
        vx: (Math.random() - 0.5) * 70, vy: 30 + Math.random() * 60,
        vt: (H + size * 8) / (T - 0.36),                     // terminal fall speed (px/s)
        w: size, h: size * (0.45 + Math.random() * 0.4),
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 9,
        ph: Math.random() * 6.28, fq: 2 + Math.random() * 3, am: 14 + Math.random() * 26,
        fl: Math.random() * 6.28, ff: 4 + Math.random() * 5,
        ci: i % 6, t: 0, a: 0, circ: Math.random() < 0.22
      });
    }
    this._kick();
  };
  Game.prototype._stepConfetti = function (dt) {
    var p = this.cf, H = this.fxH;
    for (var i = p.length - 1; i >= 0; i--) {
      var q = p[i];
      if (q.d > 0) { q.d -= dt; continue; }
      q.t += dt;
      q.vy += (q.vt - q.vy) * Math.min(1, 2.6 * dt);   // gravity eased into terminal velocity
      q.y += q.vy * dt;
      q.x += (q.vx + Math.cos(q.t * q.fq + q.ph) * q.am) * dt;
      q.vx *= 1 - 0.25 * dt;
      q.rot += q.vr * dt; q.fl += q.ff * dt;
      q.a = Math.min(1, q.t / 0.18);
      if (q.y - q.w > H + 8) { p[i] = p[p.length - 1]; p.pop(); }
    }
    this._cfDirty = true;
  };
  Game.prototype._renderConfetti = function () {
    var ctx = this.cfctx; if (!ctx) return;
    var v = this.view, dpr = v.dpr, p = this.cf, P = this.pal, i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cfv.width, this.cfv.height);
    if (!p.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (i = 0; i < p.length; i++) {
      var q = p[i];
      if (q.d > 0) continue;
      ctx.globalAlpha = q.a;
      ctx.fillStyle = P['confetti-' + (q.ci + 1)];
      ctx.save();
      ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(1, Math.cos(q.fl) * 0.85 + 0.15 * (Math.cos(q.fl) < 0 ? -1 : 1));
      if (q.circ) { ctx.beginPath(); ctx.arc(0, 0, q.w * 0.42, 0, 6.2832); ctx.fill(); }
      else ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  /* ---------- rendering ---------- */
  /* cartoon dart head: tip, two barbs and a notch, each nudged by the arrow's own seeded wobble.
   * The tip (outline included) ends where the original head ended, so the art stays on the grid. */
  function headPath(ctx, hx, hy, dx, dy, wb, ow) {
    var px = -dy, py = dx, L = HEAD_LEN - ow * 0.32, w = wb || [0, 0, 0, 0, 0, 0];
    var tx = hx + dx * L + px * w[0], ty = hy + dy * L + py * w[0];
    var b = -0.07 + w[1], h1 = HEAD_HH + w[2], h2 = HEAD_HH + w[3];
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx + dx * (b + w[4]) + px * h1, hy + dy * (b + w[4]) + py * h1);
    ctx.lineTo(hx + dx * NOTCH + px * w[5], hy + dy * NOTCH + py * w[5]);
    ctx.lineTo(hx + dx * (b - w[4]) - px * h2, hy + dy * (b - w[4]) - py * h2);
    ctx.closePath();
  }
  function ow(scale) { return Math.max(OW, 4.2 / scale); }

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

  /* one arrow with its own transform: fill colour, optional glow, hover tilt, press squash, blocked shake.
   * Everything here is drawing only — a.pts / a.s / the grid are never modified. */
  Game.prototype._drawOne = function (ctx, a, color, ox, oy, lw, glow, line) {
    var n = this._window(a, a.s), w = this._win, i;
    var dx = AP.DX[a.dir], dy = AP.DY[a.dir], iw = lw * IW_K;
    ctx.save();
    ctx.translate(ox, oy);
    var mx = (w[0] + w[n - 2]) / 2, my = (w[1] + w[n - 1]) / 2;
    if (a.sc !== 1 || a.hv > 0) {
      ctx.translate(mx, my);
      if (a.hv > 0) ctx.rotate(-0.045 * a.hv * (dx || dy));             // hover: small playful tilt
      if (a.sc < 1) {                                                     // press: squash along the arrow, bulge across
        var al = a.sc, ac = 1 + (1 - a.sc) * 0.7;
        if (dx) ctx.scale(al, ac); else ctx.scale(ac, al);
      } else if (a.sc !== 1) ctx.scale(a.sc, a.sc);                       // hover / spring overshoot: grow
      ctx.translate(-mx, -my);
    }
    if (glow) {                                                           // illustrated highlight halo
      ctx.strokeStyle = glow.c; ctx.fillStyle = glow.c; ctx.lineWidth = lw + glow.w;
      ctx.globalAlpha = glow.a;
      ctx.beginPath(); ctx.moveTo(w[0], w[1]);
      for (i = 2; i < n; i += 2) ctx.lineTo(w[i], w[i + 1]);
      ctx.stroke();
      ctx.beginPath(); headPath(ctx, w[n - 2], w[n - 1], dx, dy, a.wb, lw); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // ink outline
    ctx.strokeStyle = line || this.pal.ink; ctx.fillStyle = line || this.pal.ink; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(w[0], w[1]);
    for (i = 2; i < n; i += 2) ctx.lineTo(w[i], w[i + 1]);
    ctx.stroke();
    ctx.beginPath(); headPath(ctx, w[n - 2], w[n - 1], dx, dy, a.wb, lw); ctx.fill();
    ctx.lineWidth = lw - iw; ctx.stroke();
    // bright body
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = iw;
    ctx.beginPath(); ctx.moveTo(w[0], w[1]);
    for (i = 2; i < n; i += 2) ctx.lineTo(w[i], w[i + 1]);
    ctx.stroke();
    ctx.beginPath(); headPath(ctx, w[n - 2], w[n - 1], dx, dy, a.wb, lw); ctx.fill();
    ctx.restore();
  };

  /* animation layer: flying arrows (opacity 1, never faded or scaled) + confetti */
  Game.prototype._renderFx = function () {
    var ctx = this.fctx, v = this.view, i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    this._fxDirty = false;
    if (this.mv.length) {
      var k = v.dpr * v.scale, lw = ow(v.scale);
      ctx.setTransform(k, 0, 0, k, v.dpr * (v.tx + this.fxX), v.dpr * (v.ty + this.fxY));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 1;
      for (i = 0; i < this.mv.length; i++) this._drawOne(ctx, this.mv[i], this.pal['arrow-fill'], 0, 0, lw, null);
    }
  };

  Game.prototype._renderBoard = function () {
    var ctx = this.ctx, v = this.view, b = this.board;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!b) return;
    v.apply(ctx);
    var sc = v.scale, lw = ow(sc), iw = lw * IW_K;
    var x0 = -v.tx / sc, y0 = -v.ty / sc, x1 = (v.w - v.tx) / sc, y1 = (v.h - v.ty) / sc;
    var i, a, k, P = this.pal;

    // board dots (static ones in one batch, popping ones with a damped-spring radius)
    ctx.fillStyle = P['dot-empty'];
    var dr = Math.max(0.05, 1.1 / sc), DB = this.dotB, cl = this.clock;
    var c0d = Math.max(0, Math.floor(x0)), c1d = Math.min(b.cols - 1, Math.floor(x1));
    var r0d = Math.max(0, Math.floor(y0)), r1d = Math.min(b.rows - 1, Math.floor(y1));
    ctx.beginPath();
    for (var ry = r0d; ry <= r1d; ry++) for (var cx = c0d; cx <= c1d; cx++) {
      var bt = DB[ry * b.cols + cx];
      if (bt < 0 && bt !== -POP_T) continue;
      var age = bt === -POP_T ? POP_T : cl - bt;
      if (age <= 0) continue;
      var rad = dr;
      if (age < POP_T) rad = dr * (1 - Math.exp(-7.5 * age) * Math.cos(15 * age));   // springy pop with overshoot
      if (rad <= 0.002) continue;
      ctx.moveTo(cx + 0.5 + rad, ry + 0.5); ctx.arc(cx + 0.5, ry + 0.5, rad, 0, 6.2832);
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
      var P = this.pal;
      var ra = Math.min(1, this.rulerT / 0.5, (RULER_T - this.rulerT) / 0.15 + 0.01);
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(0.07, 1.3 / sc);
      ctx.setLineDash([0.16, 0.16]);
      for (i = 0; i < b.arrows.length; i++) {
        a = b.arrows[i];
        if (!a.alive) continue;
        var bl = b.blocker(a), dx = AP.DX[a.dir], dy = AP.DY[a.dir];
        var sx = a.hx + dx * HEAD_LEN, sy = a.hy + dy * HEAD_LEN, ex, ey;
        if (bl) { ex = bl.c + 0.5 - dx * 0.5; ey = bl.r + 0.5 - dy * 0.5; ctx.strokeStyle = P.danger; }
        else { ex = a.hx + dx * a.dEdge; ey = a.hy + dy * a.dEdge; ctx.strokeStyle = P.ok; }
        ctx.globalAlpha = 0.85 * ra;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.restore();
    }

    // idle arrows: batched — all ink outlines first, then all bright bodies on top (arrows never overlap)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var vis = this._vis, idle = this._idle || (this._idle = []); vis.length = 0; idle.length = 0;
    for (i = 0; i < b.arrows.length; i++) {
      a = b.arrows[i];
      if (!a.alive || a.phase > 1) continue;
      if (a.phase === 1 || a.flash >= 0 || i === this.hintId || a.sc !== 1 || a.hv > 0) { vis.push(i); continue; }
      if (a.bb[2] < x0 || a.bb[0] > x1 || a.bb[3] < y0 || a.bb[1] > y1) continue;
      idle.push(a);
    }
    var pass, body = function () {
      ctx.beginPath();
      for (var j = 0; j < idle.length; j++) {
        var q = idle[j]; ctx.moveTo(q.pts[0][0], q.pts[0][1]);
        for (var m = 1; m < q.cells.length; m++) ctx.lineTo(q.pts[m][0], q.pts[m][1]);
      }
      ctx.stroke();
    }, heads = function () {
      ctx.beginPath();
      for (var j = 0; j < idle.length; j++) { var q = idle[j]; headPath(ctx, q.hx, q.hy, AP.DX[q.dir], AP.DY[q.dir], q.wb, lw); }
    };
    for (pass = 0; pass < 2; pass++) {
      var col = pass ? P['arrow-fill'] : P.ink;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = pass ? iw : lw;
      body();
      heads(); ctx.fill();
      if (!pass) { ctx.lineWidth = lw - iw; ctx.stroke(); }
    }

    // flashing / hinted arrows
    for (k = 0; k < vis.length; k++) {
      a = b.arrows[vis[k]];
      var fillC = P['arrow-fill'], ox = 0, oy = 0, glow = null;
      if (a.hv > 0.003 && a.phase === 0 && a.flash < 0) { glow = { c: P.glow, w: 0.2, a: 0.55 * a.hv }; oy = -LIFT * a.hv; }
      if (a.flash >= 0) {                                       // the arrow that was hit: orange flash + wobble
        var f = 1 - a.flash / BUMP_T;
        fillC = mix(P['arrow-fill'], P.warn, f); glow = { c: P.warn, w: 0.22, a: 0.35 * f };
        var wf = 0.05 * f * Math.sin(a.flash * 48); ox += AP.DY[a.dir] * wf; oy += AP.DX[a.dir] * wf;
      }
      if (a.phase === 1 && a.hitT >= 0) {                       // blocked: red, short illustrated shake, then relax while backing off
        var since = a.t - a.hitT, tt = clamp(since / (a.back + 0.06), 0, 1);
        fillC = mix(P.danger, P['arrow-fill'], tt * tt); glow = { c: P.danger, w: 0.24, a: 0.4 * (1 - tt) };
        var sh = 0.085 * Math.exp(-since * 7) * Math.sin(since * 62);
        ox += -AP.DY[a.dir] * sh; oy += AP.DX[a.dir] * sh;
      }
      if (vis[k] === this.hintId) {
        var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
        var fade = Math.min(1, this.hintT / 0.4);
        fillC = P.hint; glow = { c: P.glow, w: 0.26 + 0.16 * pulse, a: (0.45 + 0.3 * pulse) * fade };
      }
      if (a.phase === 0) a.s = 0;
      this._drawOne(ctx, a, fillC, ox, oy, lw, glow);
    }
  };

  AP.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
