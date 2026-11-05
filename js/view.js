/* Arrow Puzzle — view.js
 * Camera for the board canvas: pinch-zoom, pan, momentum, wheel zoom, animated
 * fit/center. Uses Pointer Events only (works in iframes / WebViews).
 * World units = grid cells. screen = world * scale + (tx, ty)  (CSS px). */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};
  var SLOP = 8;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function View(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks || {};
    this.w = 1; this.h = 1; this.dpr = 1;
    this.cols = 1; this.rows = 1; this.pad = 10;
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.minS = 1; this.maxS = 8;
    this.vx = 0; this.vy = 0;
    this.tween = null;
    this.ptrs = new Map();
    this.panning = false; this.tapC = null; this.pinch = null; this.lastT = 0;
    this.dirty = true;
    this.zoomShown = false;
    this._bind();
  }

  View.prototype._wake = function () { if (this.hooks.onWake) this.hooks.onWake(); };

  View.prototype.limits = function () {
    var p = this.pad;
    this.minS = Math.max(1, Math.min((this.w - 2 * p) / this.cols, (this.h - 2 * p) / this.rows));
    this.maxS = Math.max(this.minS * 8, 70);
  };

  /* clamp translation for a given scale; returns [tx, ty] */
  View.prototype.clampFor = function (s, tx, ty) {
    var bw = this.cols * s, bh = this.rows * s, mg = this.pad;
    var lo = this.w - bw - mg, hi = mg;
    tx = lo > hi ? (this.w - bw) / 2 : clamp(tx, lo, hi);
    lo = this.h - bh - mg; hi = mg;
    ty = lo > hi ? (this.h - bh) / 2 : clamp(ty, lo, hi);
    return [tx, ty];
  };
  View.prototype.clampPos = function () {
    var c = this.clampFor(this.scale, this.tx, this.ty);
    this.tx = c[0]; this.ty = c[1];
  };

  View.prototype.setBoard = function (cols, rows) {
    this.cols = cols; this.rows = rows;
    this.tween = null; this.vx = this.vy = 0;
    this.limits();
    this.scale = this.minS;
    var c = this.clampFor(this.scale, 0, 0);
    this.tx = c[0]; this.ty = c[1];
    this.dirty = true;
  };

  View.prototype.resize = function (w, h, dpr) {
    var had = this.w > 1 && this.h > 1;
    var zf = this.scale / this.minS;
    var cwx = (this.w / 2 - this.tx) / this.scale, cwy = (this.h / 2 - this.ty) / this.scale;
    this.w = w; this.h = h; this.dpr = dpr;
    this.limits();
    if (had) {
      this.scale = clamp(zf * this.minS, this.minS, this.maxS);
      this.tx = w / 2 - cwx * this.scale;
      this.ty = h / 2 - cwy * this.scale;
    } else {
      this.scale = this.minS;
    }
    this.clampPos();
    this.tween = null;
    this.dirty = true;
  };

  View.prototype.toWorld = function (x, y) {
    return [(x - this.tx) / this.scale, (y - this.ty) / this.scale];
  };
  View.prototype.zoomFactor = function () { return this.scale / this.minS; };

  View.prototype.apply = function (ctx) {
    var k = this.dpr * this.scale;
    ctx.setTransform(k, 0, 0, k, this.dpr * this.tx, this.dpr * this.ty);
  };

  View.prototype.animateTo = function (s, tx, ty, ms) {
    s = clamp(s, this.minS, this.maxS);
    var c = this.clampFor(s, tx, ty);
    this.vx = this.vy = 0;
    this._wake();
    this.tween = { t: 0, dur: (ms || 260) / 1000, s0: this.scale, x0: this.tx, y0: this.ty, s1: s, x1: c[0], y1: c[1] };
  };
  View.prototype.fit = function (animated) {
    if (animated) this.animateTo(this.minS, 0, 0, 280);
    else { this.scale = this.minS; this.clampPos(); this.dirty = true; }
  };
  /* bring a world point to the middle of the screen (keeps current zoom unless s given) */
  View.prototype.centerOn = function (wx, wy, s, ms) {
    s = s || this.scale;
    this.animateTo(s, this.w / 2 - wx * s, this.h / 2 - wy * s, ms || 320);
  };
  View.prototype.isVisible = function (wx, wy, m) {
    var x = this.tx + wx * this.scale, y = this.ty + wy * this.scale;
    m = m || 24;
    return x > m && y > m && x < this.w - m && y < this.h - m;
  };

  /* zoom keeping screen point (cx, cy) fixed */
  View.prototype.zoomAt = function (cx, cy, ns, lo, hi) {
    ns = clamp(ns, lo, hi);
    var wx = (cx - this.tx) / this.scale, wy = (cy - this.ty) / this.scale;
    this.scale = ns;
    this.tx = cx - wx * ns; this.ty = cy - wy * ns;
    this.clampPos();
    this.dirty = true;
  };

  /* per-frame: tween + momentum. returns true if a redraw is needed */
  View.prototype.update = function (dt) {
    if (this.tween) {
      var tw = this.tween;
      tw.t += dt;
      var u = clamp(tw.t / tw.dur, 0, 1), e = easeOutCubic(u);
      this.scale = tw.s0 + (tw.s1 - tw.s0) * e;
      this.tx = tw.x0 + (tw.x1 - tw.x0) * e;
      this.ty = tw.y0 + (tw.y1 - tw.y0) * e;
      if (u >= 1) this.tween = null;
      this.dirty = true;
    } else if (this.vx * this.vx + this.vy * this.vy > 64 && this.ptrs.size === 0) {
      var ox = this.tx, oy = this.ty;
      this.tx += this.vx * dt; this.ty += this.vy * dt;
      this.clampPos();
      if (this.tx === ox) this.vx = 0;
      if (this.ty === oy) this.vy = 0;
      var f = Math.exp(-4.2 * dt);
      this.vx *= f; this.vy *= f;
      this.dirty = true;
    } else if (this.ptrs.size === 0) {
      this.vx = this.vy = 0;
    }
    if (this.hooks.onZoom) {
      var z = this.scale > this.minS * 1.06;
      if (z !== this.zoomShown) { this.zoomShown = z; this.hooks.onZoom(z); }
    }
    var d = this.dirty; this.dirty = false;
    return d;
  };

  /* after a pinch ends outside the hard limits, spring back */
  View.prototype.settle = function () {
    if (this.scale < this.minS - 0.001 || this.scale > this.maxS + 0.001) {
      var s = clamp(this.scale, this.minS, this.maxS);
      var wx = (this.w / 2 - this.tx) / this.scale, wy = (this.h / 2 - this.ty) / this.scale;
      this.animateTo(s, this.w / 2 - wx * s, this.h / 2 - wy * s, 200);
    }
  };

  /* ---------- input ---------- */
  View.prototype._rect = function () { return this.canvas.getBoundingClientRect(); };

  View.prototype._bind = function () {
    var self = this, c = this.canvas;
    c.addEventListener('pointerdown', function (e) { self._down(e); });
    c.addEventListener('pointermove', function (e) { self._move(e); });
    c.addEventListener('pointerup', function (e) { self._up(e); });
    c.addEventListener('pointercancel', function (e) { self._up(e); });
    c.addEventListener('wheel', function (e) { self._wheel(e); }, { passive: false });
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  };

  View.prototype._down = function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var r = this._rect(), x = e.clientX - r.left, y = e.clientY - r.top;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    this.tween = null; this.vx = this.vy = 0; this._wake();
    this.ptrs.set(e.pointerId, { x: x, y: y, sx: x, sy: y, lx: x, ly: y });
    if (this.ptrs.size === 1) {
      this.panning = false;
      this.tapC = { t: performance.now() };
      this.lastT = e.timeStamp;
    } else {
      this.tapC = null; this.panning = true;
      this._initPinch();
    }
  };

  View.prototype._two = function () {
    var it = this.ptrs.values(), a = it.next().value, b = it.next().value;
    return [a, b];
  };
  View.prototype._initPinch = function () {
    var p = this._two(), dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
    this.pinch = { d: Math.max(1, Math.sqrt(dx * dx + dy * dy)), mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
  };

  View.prototype._move = function (e) {
    var p = this.ptrs.get(e.pointerId);
    if (!p) return;
    var r = this._rect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (this.ptrs.size === 1) {
      if (!this.panning) {
        var ddx = x - p.sx, ddy = y - p.sy;
        p.x = x; p.y = y;
        if (ddx * ddx + ddy * ddy < SLOP * SLOP) return;
        this.panning = true; this.tapC = null;
        p.lx = p.sx; p.ly = p.sy; this.lastT = e.timeStamp;
      }
      var dx = x - p.lx, dy = y - p.ly;
      p.lx = x; p.ly = y; p.x = x; p.y = y;
      this.tx += dx; this.ty += dy;
      this.clampPos();
      var dt = Math.max(1, e.timeStamp - this.lastT) / 1000;
      this.lastT = e.timeStamp;
      this.vx = this.vx * 0.55 + (dx / dt) * 0.45;
      this.vy = this.vy * 0.55 + (dy / dt) * 0.45;
      this.dirty = true; this._wake();
    } else {
      p.x = x; p.y = y;
      var t = this._two(), ex = t[1].x - t[0].x, ey = t[1].y - t[0].y;
      var d = Math.max(1, Math.sqrt(ex * ex + ey * ey));
      var mx = (t[0].x + t[1].x) / 2, my = (t[0].y + t[1].y) / 2;
      var pv = this.pinch;
      if (!pv) { this._initPinch(); return; }
      var ns = clamp(this.scale * d / pv.d, this.minS * 0.8, this.maxS * 1.25);
      var wx = (pv.mx - this.tx) / this.scale, wy = (pv.my - this.ty) / this.scale;
      this.scale = ns;
      this.tx = mx - wx * ns; this.ty = my - wy * ns;
      this.clampPos();
      this.pinch = { d: d, mx: mx, my: my };
      this.dirty = true; this._wake();
    }
  };

  View.prototype._up = function (e) {
    var p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (this.ptrs.size === 0) {
      if (e.type === 'pointerup' && this.tapC && !this.panning && performance.now() - this.tapC.t < 700) {
        var w = this.toWorld(p.x, p.y);
        if (this.hooks.onTap) this.hooks.onTap(w[0], w[1], this.scale);
      } else if (this.panning && (e.type !== 'pointerup' || e.timeStamp - this.lastT > 90)) {
        this.vx = this.vy = 0; // finger rested before lifting / cancelled: no fling
      }
      this.tapC = null; this.panning = false; this.pinch = null;
      this.settle(); this._wake();
    } else if (this.ptrs.size === 1) {
      var q = this.ptrs.values().next().value;
      q.lx = q.x; q.ly = q.y; q.sx = q.x; q.sy = q.y;
      this.panning = true; this.pinch = null;
      this.vx = this.vy = 0; this.lastT = e.timeStamp;
    } else {
      this._initPinch();
    }
  };

  View.prototype._wheel = function (e) {
    e.preventDefault();
    var r = this._rect(), x = e.clientX - r.left, y = e.clientY - r.top;
    var k = e.deltaMode === 1 ? 16 : 1;
    var f = Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.01 : 0.0018));
    this.tween = null;
    this.zoomAt(x, y, this.scale * f, this.minS, this.maxS); this._wake();
  };

  AP.View = View;
})(typeof window !== 'undefined' ? window : globalThis);
