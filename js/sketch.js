/* Arrow Puzzle — sketch.js
 * Hand-drawn panels for every UI element marked with data-sk="<kind>".
 *
 * Each host gets one <svg class="sk"> behind its content (z-index -1 inside an isolated host):
 *   .sk-sh   solid cartoon drop shadow (base shape, offset by CSS)
 *   .sk-fill flat fill (base shape, never moves — the layout stays perfectly still)
 *   .sk-ht   halftone dots fading in towards the bottom (pattern + gradient mask, shared defs)
 *   .sk-ln   4 precomputed outline frames (.f0-.f3): the base quad with tiny corner shifts,
 *            different edge curvature and slightly different stroke widths.
 *
 * The outline frames are swapped at 12 FPS by a CSS steps() animation (style.css: @keyframes skf):
 * no JS timer, no per-frame DOM writes, and it is completely independent of the game's rAF loop,
 * so arrow movement and touch response keep their full frame rate.
 *
 * Shapes are seeded per element (controlled asymmetry, not random noise each frame) and only
 * rebuilt when the element's size changes (ResizeObserver). New elements (settings rows, calendar
 * days) are picked up automatically by a MutationObserver.
 *
 * Optional attributes on a host:
 *   data-sk-bleed="ltrb"  extend the shape past those sides (only the remaining edges are drawn)
 *   data-sk-amp="1.6"     amount of irregularity (default 1)
 *   data-sk-seed="12"     fixed seed (otherwise: creation order) */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};
  var NS = 'http://www.w3.org/2000/svg';
  var FRAMES = 4, BLEED = 14;
  var hosts = [], queue = [], qRaf = 0, counter = 0, ro = null, defsDone = false;

  function rng(seed) {                         // mulberry32: deterministic per element
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r1(v) { return Math.round(v * 10) / 10; }

  /* shared halftone pattern + fade mask, created once */
  function defs() {
    if (defsDone) return;
    defsDone = true;
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.setAttribute('aria-hidden', 'true');
    s.style.position = 'absolute';
    s.innerHTML =
      '<defs>' +
      '<pattern id="skDots" width="6" height="6" patternUnits="userSpaceOnUse">' +
        '<circle cx="1.5" cy="1.5" r="1.15"/><circle cx="4.5" cy="4.5" r="1.15"/></pattern>' +
      '<linearGradient id="skFadeG" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset=".28" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>' +
      '<mask id="skFade" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#skFadeG)"/></mask>' +
      '</defs>';
    document.body.appendChild(s);
  }

  /* closed path through 4 corners with per-corner radius and per-edge bulge (quadratic curves) */
  function quadPath(P, R, B) {
    var a = [], c = [], i;
    for (i = 0; i < 4; i++) {
      var p = P[i], pv = P[(i + 3) % 4], nx = P[(i + 1) % 4];
      var l1 = Math.hypot(p[0] - pv[0], p[1] - pv[1]) || 1, l2 = Math.hypot(nx[0] - p[0], nx[1] - p[1]) || 1;
      var r = Math.min(R[i], l1 * 0.45, l2 * 0.45);
      a[i] = [p[0] + (pv[0] - p[0]) / l1 * r, p[1] + (pv[1] - p[1]) / l1 * r];   // arriving at corner i
      c[i] = [p[0] + (nx[0] - p[0]) / l2 * r, p[1] + (nx[1] - p[1]) / l2 * r];   // leaving corner i
    }
    var d = 'M' + r1(c[0][0]) + ' ' + r1(c[0][1]);
    for (i = 0; i < 4; i++) {
      var j = (i + 1) % 4, s = c[i], e = a[j];
      var ex = e[0] - s[0], ey = e[1] - s[1], el = Math.hypot(ex, ey) || 1;
      var mx = (s[0] + e[0]) / 2 + ey / el * B[i], my = (s[1] + e[1]) / 2 - ex / el * B[i];   // outward normal
      d += 'Q' + r1(mx) + ' ' + r1(my) + ' ' + r1(e[0]) + ' ' + r1(e[1]);
      d += 'Q' + r1(P[j][0]) + ' ' + r1(P[j][1]) + ' ' + r1(c[j][0]) + ' ' + r1(c[j][1]);
    }
    return d + 'Z';
  }

  function make(host) {
    if (host._sk) return host._sk;
    defs();
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sk'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    var html = '<path class="sk-sh"/><path class="sk-fill"/><path class="sk-ht" fill="url(#skDots)" mask="url(#skFade)"/>';
    for (var f = 0; f < FRAMES; f++) html += '<path class="sk-ln f' + f + '"/>';
    svg.innerHTML = html;
    host.insertBefore(svg, host.firstChild);
    var seedAttr = host.getAttribute('data-sk-seed');
    var st = {
      svg: svg, sh: svg.children[0], fill: svg.children[1], ht: svg.children[2], ln: [],
      seed: seedAttr ? +seedAttr * 7919 + 17 : (++counter) * 2654435761, w: 0, h: 0
    };
    for (f = 0; f < FRAMES; f++) st.ln.push(svg.children[3 + f]);
    host._sk = st;
    hosts.push(host);
    if (ro) ro.observe(host);
    schedule(host);
    return st;
  }

  function build(host) {
    var st = host._sk; if (!st || !host.isConnected) return;
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    st.w = w; st.h = h;
    st.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var sw = parseFloat(getComputedStyle(st.ln[0]).strokeWidth) || 3;
    var bleed = host.getAttribute('data-sk-bleed') || '';
    var amp = parseFloat(host.getAttribute('data-sk-amp') || '1');
    var rand = rng(st.seed), m = Math.min(w, h);
    var ax = clamp(w * 0.014, 0.5, 5) * amp, ay = clamp(h * 0.06, 0.5, 4.5) * amp;   // corner offsets (inward)
    var inset = sw / 2 + 0.6;
    var L = inset, T = inset, Rr = w - inset, Bm = h - inset;
    if (bleed.indexOf('l') >= 0) L = -BLEED;
    if (bleed.indexOf('t') >= 0) T = -BLEED;
    if (bleed.indexOf('r') >= 0) Rr = w + BLEED;
    if (bleed.indexOf('b') >= 0) Bm = h + BLEED;
    // controlled asymmetry: every corner pulled in by its own amount, one diagonal pair stronger
    var lean = rand() < 0.5 ? 1 : -1;
    var P = [
      [L + rand() * ax, T + (lean > 0 ? 0.25 : 1) * rand() * ay],
      [Rr - rand() * ax, T + (lean > 0 ? 1 : 0.25) * rand() * ay],
      [Rr - rand() * ax * 0.6, Bm - (lean > 0 ? 0.3 : 1) * rand() * ay],
      [L + rand() * ax * 0.6, Bm - (lean > 0 ? 1 : 0.3) * rand() * ay]
    ];
    var rb = clamp(m * 0.11, 1.5, 7), R = [], i, k;
    for (i = 0; i < 4; i++) R.push(rb * (0.45 + rand() * 0.75));
    var base = quadPath(P, R, [0, 0, 0, 0]);
    st.fill.setAttribute('d', base); st.sh.setAttribute('d', base); st.ht.setAttribute('d', base);
    // outline frames: tiny corner wander + edge curvature, all precomputed
    var jit = clamp(m * 0.02, 0.35, 1.1) * Math.max(0.6, amp), bul = clamp(m * 0.025, 0.4, 1.4) * Math.max(0.6, amp);
    for (k = 0; k < FRAMES; k++) {
      var Q = [], Bv = [];
      for (i = 0; i < 4; i++) {
        Q.push([P[i][0] + (rand() * 2 - 1) * jit, P[i][1] + (rand() * 2 - 1) * jit]);
        Bv.push((rand() * 2 - 1) * bul);
      }
      st.ln[k].setAttribute('d', quadPath(Q, R, Bv));
    }
  }

  function flush() {
    qRaf = 0;
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) { q[i]._skQ = false; build(q[i]); }
  }
  function schedule(host) {
    if (host._skQ) return;
    host._skQ = true; queue.push(host);
    if (!qRaf) qRaf = requestAnimationFrame(flush);
  }

  function scan(root) {
    root = root || document;
    if (root.nodeType === 1 && root.hasAttribute('data-sk')) make(root);
    var list = root.querySelectorAll ? root.querySelectorAll('[data-sk]') : [];
    for (var i = 0; i < list.length; i++) make(list[i]);
  }

  /* drop hosts that left the document (settings / calendar re-renders) */
  function prune() {
    for (var i = hosts.length - 1; i >= 0; i--) {
      if (!hosts[i].isConnected) { if (ro) ro.unobserve(hosts[i]); hosts[i]._sk = null; hosts.splice(i, 1); }
    }
  }

  function init(root) {
    if (G.ResizeObserver) ro = new ResizeObserver(function (en) {
      for (var i = 0; i < en.length; i++) {
        var h = en[i].target, st = h._sk;
        if (st && (h.clientWidth !== st.w || h.clientHeight !== st.h)) schedule(h);
      }
    });
    scan(root || document);
    if (G.MutationObserver) {
      var pending = false;
      new MutationObserver(function () {
        // text updates (textContent / i18n) wipe a host's children: put its drawing back before the next paint
        for (var i = 0; i < hosts.length; i++) {
          var h = hosts[i], sv = h._sk && h._sk.svg;
          if (sv && sv.parentNode !== h && h.isConnected) h.insertBefore(sv, h.firstChild);
        }
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; prune(); scan(root || document); });
      }).observe(root || document.body, { childList: true, subtree: true });
    }
    // sizes that depend on --u change without a ResizeObserver entry on some engines: rebuild on resize
    G.addEventListener('resize', function () { for (var i = 0; i < hosts.length; i++) schedule(hosts[i]); });
  }

  AP.Sketch = { init: init, scan: scan, rebuild: function (el) { if (el && el._sk) schedule(el); else for (var i = 0; i < hosts.length; i++) schedule(hosts[i]); } };
})(typeof window !== 'undefined' ? window : globalThis);
