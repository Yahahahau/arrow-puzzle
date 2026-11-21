/* Arrow Puzzle — transition.js
 * Central black-wipe transition manager.
 *
 *   AP.Transition.run(changeFn, { dir: 'left' })  -> Promise<boolean>
 *   AP.Transition.cover()                          instantly cover (used at boot after an auto-update reload)
 *   AP.Transition.reveal({ dir })                  -> Promise, slide the cover away
 *
 * 1. a solid black panel slides in (from the right by default) until it covers the game viewport,
 * 2. changeFn() runs while the screen is fully covered (errors are caught and logged),
 * 3. two frames are allowed for the new screen to lay out and paint,
 * 4. the panel keeps sliding in the same direction (to the left) and reveals the new screen.
 *
 * Horizontal motion blur: the solid core is flanked by two soft gradient "wings" (leading + trailing
 * edge) whose width follows the panel's speed — wide while it moves fast, almost nothing when it
 * slows down — so the edges smear along the x axis only. The core alone is 100% of the viewport, so
 * the screen is still completely black while the scene changes. Everything animates transform only.
 *
 * The overlay lives inside #app (the real game viewport, also inside iframes), blocks input while it
 * runs and rejects requests that arrive while a transition is already running (returns false).
 * dir: 'left' (default, right -> left), 'right' (left -> right), 'up' (bottom -> top), 'down' (top -> bottom). */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  var IN_MS = 360, OUT_MS = 420;                    // total ~780ms + 2 frames
  var RM_IN = 110, RM_OUT = 130;                    // prefers-reduced-motion: short, still a wipe
  var EASE_IN = 'cubic-bezier(.65,0,.35,1)';        // smooth ease-in-out cover
  var EASE_OUT = 'cubic-bezier(.33,0,.18,1)';       // decelerating reveal, no overshoot
  var WING = 0.22;                                  // max blur wing width, fraction of the viewport width
  // per direction: [axis, sign] — the panel travels from +sign*size to 0 (cover) and on to -sign*size (reveal)
  var DIRS = { left: ['x', 1], right: ['x', -1], up: ['y', 1], down: ['y', -1] };

  var el = null, wl = null, wr = null, busy = false, covered = false;

  function panel() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'wipe';
    el.setAttribute('aria-hidden', 'true');
    wl = document.createElement('i'); wl.className = 'wing wl';
    wr = document.createElement('i'); wr.className = 'wing wr';
    el.appendChild(wl); el.appendChild(wr);
    (document.getElementById('app') || document.body).appendChild(el);
    return el;
  }
  function reduced() { return !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function frame() { return new Promise(function (r) { G.requestAnimationFrame(function () { r(); }); }); }
  function tf(axis, px) { return axis === 'x' ? 'translate3d(' + px + 'px,0,0)' : 'translate3d(0,' + px + 'px,0)'; }
  function size(axis) { var a = el.parentNode; return axis === 'x' ? a.clientWidth : a.clientHeight; }

  /* move the panel from -> to (px along axis); wings scale with the speed profile of the easing */
  function slide(axis, from, to, ms, ease, wingKeys) {
    return new Promise(function (resolve) {
      var done = false;
      function end() { if (done) return; done = true; el.style.transform = tf(axis, to); resolve(); }
      if (el.animate) {
        var a = el.animate([{ transform: tf(axis, from) }, { transform: tf(axis, to) }], { duration: ms, easing: ease, fill: 'forwards' });
        if (axis === 'x' && wingKeys) {
          var k = wingKeys.map(function (w) { return { transform: 'scaleX(' + w[1] + ')', offset: w[0] }; });
          wl.animate(k, { duration: ms, easing: 'linear', fill: 'forwards' });
          wr.animate(k, { duration: ms, easing: 'linear', fill: 'forwards' });
        }
        a.onfinish = end;
      } else {                                      // very old WebViews: CSS transition fallback
        el.style.transition = 'none'; el.style.transform = tf(axis, from); void el.offsetWidth;
        el.style.transition = 'transform ' + ms + 'ms ' + ease; el.style.transform = tf(axis, to);
        el.addEventListener('transitionend', end, { once: true });
      }
      setTimeout(end, ms + 120);                    // fallback: never wait forever for a finish event
    });
  }
  function clearAnims() {
    [el, wl, wr].forEach(function (n) { if (n.getAnimations) n.getAnimations().forEach(function (a) { a.cancel(); }); });
  }
  function setWings(axis) {
    var w = axis === 'x' ? Math.round(size('x') * WING) : 0;
    el.style.setProperty('--wing', w + 'px');
    el.classList.toggle('blur-x', axis === 'x');
    return w;
  }

  // speed profiles (offset, wing scale) matched to the easings above
  var WINGS_IN = [[0, 0.12], [0.25, 0.7], [0.5, 1], [0.78, 0.55], [1, 0.05]];   // ease-in-out: fastest mid-way
  var WINGS_OUT = [[0, 0.05], [0.12, 1], [0.35, 0.6], [0.7, 0.15], [1, 0]];     // fast start, long settle

  function enter(o) {
    var d = DIRS[o.dir] || DIRS.left, axis = d[0], w = setWings(axis), from = d[1] * (size(axis) + w);
    el.style.transform = tf(axis, from);
    el.classList.add('on');                         // visible + blocks pointer input
    return slide(axis, from, 0, reduced() ? RM_IN : IN_MS, EASE_IN, WINGS_IN).then(function () { covered = true; });
  }
  function leave(o) {
    var d = DIRS[o.dir] || DIRS.left, axis = d[0], w = setWings(axis), to = -d[1] * (size(axis) + w);
    return slide(axis, 0, to, reduced() ? RM_OUT : OUT_MS, EASE_OUT, WINGS_OUT);
  }
  function finish() {
    clearAnims();
    el.classList.remove('on');
    el.style.transform = '';
    covered = false; busy = false;
  }

  AP.Transition = {
    get busy() { return busy; },
    get covered() { return covered; },
    run: function (change, opts) {
      if (busy) return Promise.resolve(false);      // reject duplicates (double taps, rapid clicks)
      busy = true;
      opts = opts || {};
      panel(); clearAnims();
      return frame()
        .then(function () { return enter(opts); })
        .then(function () {
          try { if (change) change(); }             // the real scene / level change, fully covered
          catch (e) { if (G.console) console.error('[transition] scene change failed:', e); }
          if (opts.hold) return new Promise(function () {});   // e.g. reloading onto a new version: stay black
          return frame();
        })
        .then(frame)                                // let the new screen lay out and paint
        .then(function () { return leave(opts); })
        .catch(function (e) { if (G.console) console.error('[transition]', e); })
        .then(function () { finish(); return true; }); // always ends uncovered, even after errors
    },
    /* instantly cover the viewport (no animation) — used right after an update reload */
    cover: function () {
      panel(); clearAnims(); busy = true; covered = true;
      el.classList.add('on'); el.style.transform = tf('x', 0);
    },
    reveal: function (opts) {
      if (!covered) return Promise.resolve(false);
      opts = opts || {};
      return frame().then(frame).then(function () { return leave(opts); })
        .catch(function () {}).then(function () { finish(); return true; });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
