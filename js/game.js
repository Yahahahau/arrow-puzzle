/* Arrow Puzzle — game.js
 * Game state, input -> action, snake-slide animation, rendering (Canvas 2D).
 * rAF + delta time; the loop sleeps when nothing is animating. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  var INK = '#0e1650', RED = '#ef4444', ORANGE = '#f97316', BLUE = '#2f86eb', GOLD = '#ffb800', GREEN = '#22c55e';
  var LW = 0.17;            // line width (cells)
  var HEAD_LEN = 0.46, HEAD_HALF = 0.27;
  var ANTIC_T = 0.1, ANTIC_D = 0.32, ACC = 95, VMAX = 70;
  var BUMP_T = 0.5;
  var HINT_T = 3.6, RULER_T = 4.2;
  var HEARTS = 3, HINTS = 3, RULERS = 3;

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

  function Game(canvas, cb) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
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
    this.moving = 0; this.hintId = -1; this.hintT = 0; this.rulerT = 0;
    this.dots = []; this.parts = [];
    this.endTimer = 0; this.endKind = '';
    this.running = false; this.lastT = 0; this.raf = 0;
    this._tmp = [0, 0]; this._win = [];
    this._loop = this._loop.bind(this);
    this._vis = function () { self.lastT = 0; if (!document.hidden && self.running) self._kick(); };
    document.addEventListener('visibilitychange', this._vis);
  }

  Game.prototype.destroy = function () {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this._vis);
  };

  Game.prototype.resize = function (w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cv.width = Math.max(1, Math.round(w * dpr));
    this.cv.height = Math.max(1, Math.round(h * dpr));
    this.view.resize(w, h, dpr);
    this._kick();
  };

  Game.prototype.load = function (def) {
    this.def = def;
    this.board = new AP.Board(def);
    this.state = 'play';
    this.hearts = HEARTS; this.hints = HINTS; this.rulers = RULERS;
    this.moving = 0; this.hintId = -1; this.hintT = 0; this.rulerT = 0; this.parts.length = 0;
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
    this.view.setBoard(def.cols, def.rows);
    this._emit();
    this.running = true;
    this._kick();
  };

  Game.prototype.restart = function () { if (this.def) this.load(this.def); };
  Game.prototype.setPaused = function (p) { this.paused = p; this.lastT = 0; if (!p) this._kick(); };
  Game.prototype.fit = function () { this.view.fit(true); this._kick(); };
  Game.prototype.zoomBy = function (f) {
    var v = this.view;
    v.zoomAt(v.w / 2, v.h / 2, v.scale * f, v.minS, v.maxS); this._kick();
  };
  Game.prototype.getInfo = function () {
    return {
      alive: this.board ? this.board.alive : 0, total: this.board ? this.board.arrows.length : 0,
      hearts: this.hearts, hints: this.hints, rulers: this.rulers, state: this.state
    };
  };
  Game.prototype._emit = function () { if (this.cb.onState) this.cb.onState(this.getInfo()); };

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
    if (!a.alive || a.phase !== 0) return;
    if (a.bump >= 0) return;
    var bl = b.blocker(a);
    if (!bl) {
      b.remove(id);
      a.phase = 1; a.t = 0; a.s = 0; a.v = 0;
      this.moving++;
      if (this.hintId === id) { this.hintId = -1; this.hintT = 0; }
      if (this.cb.onSfx) this.cb.onSfx('go');
      if (b.alive === 0) { this.endKind = 'win'; this.endTimer = 0.3; }
      this._emit();
    } else {
      a.bump = 0;
      b.arrows[bl.id].flash = 0;
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
    return this.moving > 0 || this.hintT > 0 || this.rulerT > 0 || this.parts.length > 0 ||
      this.endTimer > 0 || this._bumping || this.view.tween !== null ||
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
    var dt = this.lastT ? (now - this.lastT) / 1000 : 1 / 60;
    this.lastT = now;
    if (dt > 0.05) dt = 0.05;
    if (this.paused) { this._render(); return; }
    this._update(dt);
    this._render();
    if (this._animating()) this.raf = requestAnimationFrame(this._loop);
  };

  Game.prototype._update = function (dt) {
    var v = this.view; v.update(dt);
    var b = this.board; if (!b) return;
    var i, a, bumping = false;
    for (i = 0; i < b.arrows.length; i++) {
      a = b.arrows[i];
      if (a.phase === 1) {
        a.t += dt;
        var u = clamp(a.t / ANTIC_T, 0, 1);
        a.s = -ANTIC_D * (1 - (1 - u) * (1 - u));
        if (u >= 1) { a.phase = 2; a.v = 0; }
      } else if (a.phase === 2) {
        a.v = Math.min(a.v + ACC * dt, VMAX);
        a.s += a.v * dt;
        if (a.s >= a.dEdge + a.L + 0.8) { a.phase = 3; this.moving--; }
      }
      if (a.bump >= 0) { a.bump += dt; if (a.bump > BUMP_T) a.bump = -1; else bumping = true; }
      if (a.flash >= 0) { a.flash += dt; if (a.flash > BUMP_T) a.flash = -1; else bumping = true; }
    }
    this._bumping = bumping;
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintId = -1; }
    if (this.rulerT > 0) this.rulerT = Math.max(0, this.rulerT - dt);
    if (this.parts.length) this._stepParts(dt);
    if (this.endTimer > 0 && this.moving === 0) {
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

  /* ---------- confetti ---------- */
  Game.prototype._confetti = function () {
    var cols = ['#2f86eb', '#ffb800', '#ef4444', '#22c55e', '#a855f7', '#0e1650'];
    var w = this.view.w, h = this.view.h;
    for (var i = 0; i < 70; i++) {
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.9, sp = (0.5 + Math.random()) * Math.min(w, h) * 1.1;
      this.parts.push({
        x: w / 2, y: h * 0.55, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        r: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
        c: cols[i % cols.length], life: 1.5 + Math.random() * 0.6, t: 0
      });
    }
  };
  Game.prototype._stepParts = function (dt) {
    var p = this.parts;
    for (var i = p.length - 1; i >= 0; i--) {
      var q = p[i];
      q.t += dt; q.vy += 900 * dt; q.vx *= 0.99; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
      if (q.t > q.life) p.splice(i, 1);
    }
  };

  /* ---------- rendering ---------- */
  function headPath(ctx, hx, hy, dx, dy) {
    var px = -dy, py = dx;
    ctx.moveTo(hx + dx * HEAD_LEN, hy + dy * HEAD_LEN);
    ctx.lineTo(hx - dx * 0.04 + px * HEAD_HALF, hy - dy * 0.04 + py * HEAD_HALF);
    ctx.lineTo(hx - dx * 0.04 - px * HEAD_HALF, hy - dy * 0.04 - py * HEAD_HALF);
    ctx.closePath();
  }

  /* collect the visible window of the arrow polyline into this._win (flat) */
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

  Game.prototype._drawOne = function (a, color, alpha, ox, oy, lw, glow) {
    var ctx = this.ctx, n = this._window(a, a.s), w = this._win, i;
    var dx = AP.DX[a.dir], dy = AP.DY[a.dir];
    ctx.save();
    ctx.translate(ox, oy);
    ctx.globalAlpha = alpha;
    if (glow) {
      ctx.strokeStyle = glow.c; ctx.fillStyle = glow.c; ctx.lineWidth = lw + glow.w;
      ctx.globalAlpha = alpha * glow.a;
      ctx.beginPath(); ctx.moveTo(w[0], w[1]);
      for (i = 2; i < n; i += 2) ctx.lineTo(w[i], w[i + 1]);
      ctx.stroke();
      ctx.beginPath(); headPath(ctx, w[n - 2], w[n - 1], dx, dy); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(w[0], w[1]);
    for (i = 2; i < n; i += 2) ctx.lineTo(w[i], w[i + 1]);
    ctx.stroke();
    ctx.beginPath(); headPath(ctx, w[n - 2], w[n - 1], dx, dy); ctx.fill();
    ctx.lineWidth = lw * 0.35; ctx.stroke();
    ctx.restore();
  };

  Game.prototype._render = function () {
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
    var vis = [];
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
      this._drawOne(a, color, 1, ox, oy, lw, glow);
    }

    // moving arrows (on top)
    for (i = 0; i < b.arrows.length; i++) {
      a = b.arrows[i];
      if (a.phase !== 1 && a.phase !== 2) continue;
      var over = a.s + a.L - a.dEdge, al = 1;
      if (over > 0) al = clamp(1 - over / (a.L * 0.6 + 4), 0, 1);
      if (al > 0.01) this._drawOne(a, INK, al, 0, 0, lw, null);
    }

    // confetti (screen space)
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

  AP.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
