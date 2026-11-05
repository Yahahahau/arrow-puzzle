/* Arrow Puzzle — levels.js
 * Level data is separate from gameplay.
 *  - CUSTOM_LEVELS: hand-made levels (override generated ones by level number).
 *  - everything else is generated from a seed and is solvable by construction.
 *
 * Custom level format:
 *   N: { cols, rows, arrows: [ [[c,r],[c,r],...], ... ] }   // each arrow: cells tail -> head
 *   The head direction is the direction of the last step. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  var CUSTOM_LEVELS = {
    1: {
      cols: 5, rows: 5,
      arrows: [
        [[0, 0], [1, 0], [2, 0], [3, 0]],
        [[0, 1], [1, 1], [1, 2]],
        [[4, 1], [4, 2], [3, 2], [2, 2]],
        [[3, 1], [2, 1]],
        [[0, 4], [1, 4], [2, 4], [3, 4]],
        [[4, 3], [4, 4]]
      ]
    }
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function params(n) {
    var cols = clamp(Math.round(5 + n * 0.67), 5, 28);
    return {
      cols: cols,
      rows: n >= 6 ? cols + 1 : cols,
      minLen: 2,
      maxLen: clamp(4 + Math.floor(n / 3), 4, 12),
      turn: clamp(0.25 + n * 0.01, 0.25, 0.6),
      skew: 1.0, tries: 14, lenBonus: 0.05
    };
  }

  /* Builds arrows in REMOVAL order. A new arrow may not occupy any cell in the
   * ray of an earlier arrow, so every arrow's ray is clear once the earlier ones
   * are gone => always solvable. */
  function generate(cols, rows, seed, opt) {
    var rnd = mulberry32(seed), N = cols * rows;
    var occ = new Int16Array(N), res = new Uint8Array(N), stamp = new Int32Array(N);
    var i, stampId = 0, arrows = [];
    for (i = 0; i < N; i++) occ[i] = -1;
    var DC = [0, 0, -1, 1], DR = [-1, 1, 0, 0];

    function cellFree(c, r) {
      if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
      var k = r * cols + c;
      return occ[k] < 0 && res[k] === 0 && stamp[k] !== stampId;
    }

    function candidate(c0, r0) {
      stampId++;
      var target = opt.minLen + Math.floor(Math.pow(rnd(), opt.skew) * (opt.maxLen - opt.minLen + 1));
      var path = [[c0, r0]];
      stamp[r0 * cols + c0] = stampId;
      var d = (rnd() * 4) | 0, c = c0, r = r0;
      while (path.length < target) {
        var opts = [];
        for (var k = 0; k < 4; k++) if (cellFree(c + DC[k], r + DR[k])) opts.push(k);
        if (!opts.length) break;
        d = (opts.indexOf(d) >= 0 && rnd() > opt.turn) ? d : opts[(rnd() * opts.length) | 0];
        c += DC[d]; r += DR[d];
        path.push([c, r]);
        stamp[r * cols + c] = stampId;
      }
      if (path.length < opt.minLen) return null;
      var best = null;
      for (var o = 0; o < 2; o++) {
        var p = o ? path.slice().reverse() : path;
        var h = p[p.length - 1], pr = p[p.length - 2];
        var dc = h[0] - pr[0], dr = h[1] - pr[1];
        var cc = h[0] + dc, rr = h[1] + dr, waste = 0, ok = true, cells = [];
        while (cc >= 0 && rr >= 0 && cc < cols && rr < rows) {
          var ii = rr * cols + cc;
          if (stamp[ii] === stampId) { ok = false; break; }
          if (occ[ii] < 0 && res[ii] === 0) { waste++; cells.push(ii); }
          cc += dc; rr += dr;
        }
        if (!ok) continue;
        var sc = waste + rnd() * 0.9 - p.length * opt.lenBonus;
        if (!best || sc < best.score) best = { path: p, score: sc, ray: cells };
      }
      return best;
    }

    function place(cand) {
      var id = arrows.length, k;
      for (k = 0; k < cand.path.length; k++) occ[cand.path[k][1] * cols + cand.path[k][0]] = id;
      for (k = 0; k < cand.ray.length; k++) res[cand.ray[k]] = 1;
      arrows.push(cand.path);
    }

    function randFree() {
      for (var t = 0; t < 40; t++) {
        var k = (rnd() * N) | 0;
        if (occ[k] < 0 && res[k] === 0) return k;
      }
      return -1;
    }

    var fails = 0, maxFails = 300 + N;
    while (fails < maxFails) {
      var best = null;
      for (var t = 0; t < opt.tries; t++) {
        var k = randFree();
        if (k < 0) continue;
        var cand = candidate(k % cols, (k / cols) | 0);
        if (cand && (!best || cand.score < best.score)) best = cand;
      }
      if (!best) { fails++; continue; }
      place(best);
      fails = 0;
    }

    // final pass: fill what is still free
    var rest = [];
    for (i = 0; i < N; i++) if (occ[i] < 0 && res[i] === 0) rest.push(i);
    for (i = rest.length - 1; i > 0; i--) {
      var j = (rnd() * (i + 1)) | 0, tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
    for (i = 0; i < rest.length; i++) {
      var q = rest[i];
      if (occ[q] >= 0 || res[q] !== 0) continue;
      var bst = null;
      for (var t2 = 0; t2 < 10; t2++) {
        var cd = candidate(q % cols, (q / cols) | 0);
        if (cd && (!bst || cd.score < bst.score)) bst = cd;
      }
      if (bst) place(bst);
    }
    return arrows;
  }

  function label(n) {
    return n < 10 ? 'ง่าย' : n < 30 ? 'ปานกลาง' : n < 60 ? 'ยาก' : 'ยากมาก';
  }

  var cache = {};
  function get(n) {
    if (cache[n]) return cache[n];
    var def;
    if (CUSTOM_LEVELS[n]) {
      def = { cols: CUSTOM_LEVELS[n].cols, rows: CUSTOM_LEVELS[n].rows, arrows: CUSTOM_LEVELS[n].arrows };
    } else {
      var p = params(n);
      def = { cols: p.cols, rows: p.rows, arrows: generate(p.cols, p.rows, n * 7919 + 1234, p) };
    }
    def.n = n; def.label = label(n);
    cache = {}; cache[n] = def; // keep only the latest
    return def;
  }

  /* daily challenge: key = 'YYYY-MM-DD' */
  function daily(key) {
    var seed = parseInt(key.replace(/-/g, ''), 10) | 0;
    var p = params(18);
    var def = { cols: p.cols, rows: p.rows, arrows: generate(p.cols, p.rows, seed * 31 + 7, p) };
    def.n = 0; def.key = key; def.label = 'ท้าทาย';
    return def;
  }

  AP.Levels = { get: get, daily: daily, label: label, params: params, generate: generate, CUSTOM_LEVELS: CUSTOM_LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
