/* Arrow Puzzle — transition.js
 * Central black-wipe transition manager.
 *
 *   AP.Transition.run(changeFn, { dir: 'left' })  -> Promise<boolean>
 *
 * 1. a solid black panel slides in (from the right by default) until it covers the game viewport,
 * 2. changeFn() runs while the screen is fully covered (errors are caught and logged),
 * 3. two frames are allowed for the new screen to lay out and paint,
 * 4. the panel keeps sliding in the same direction (to the left) and reveals the new screen.
 *
 * The overlay lives inside #app (the real game viewport, also inside iframes), only animates
 * transform: translate3d(), blocks input while it runs, and rejects requests that arrive while a
 * transition is already running (returns false) so they can never overlap.
 * dir: 'left' (default, right -> left), 'right' (left -> right), 'up' (bottom -> top), 'down' (top -> bottom). */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  var IN_MS = 360, OUT_MS = 420;                    // total ~780ms + 2 frames
  var RM_IN = 110, RM_OUT = 130;                    // prefers-reduced-motion: short, still a wipe
  var EASE_IN = 'cubic-bezier(.65,0,.35,1)';        // smooth ease-in-out cover
  var EASE_OUT = 'cubic-bezier(.33,0,.18,1)';       // decelerating reveal, no overshoot
  var OFF = { left: ['100%', '0', '-100%', '0'], right: ['-100%', '0', '100%', '0'],
              up: ['0', '100%', '0', '-100%'], down: ['0', '-100%', '0', '100%'] };

  var el = null, busy = false;

  function panel() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'wipe';
    el.setAttribute('aria-hidden', 'true');
    (document.getElementById('app') || document.body).appendChild(el);
    return el;
  }
  function reduced() { return !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function frame() { return new Promise(function (r) { G.requestAnimationFrame(function () { r(); }); }); }
  function place(x, y) { el.style.transform = 'translate3d(' + x + ',' + y + ',0)'; }
  function slide(x, y, ms, ease) {
    return new Promise(function (resolve) {
      var done = false;
      function end(e) { if (done || (e && e.target !== el)) return; done = true; el.removeEventListener('transitionend', end); resolve(); }
      el.addEventListener('transitionend', end);
      el.style.transition = 'transform ' + ms + 'ms ' + ease;
      place(x, y);
      setTimeout(end, ms + 80);                    // fallback: WebViews that drop transitionend
    });
  }

  AP.Transition = {
    get busy() { return busy; },
    run: function (change, opts) {
      if (busy) return Promise.resolve(false);     // reject duplicates (double taps, rapid clicks)
      busy = true;
      opts = opts || {};
      var d = OFF[opts.dir] || OFF.left, rm = reduced();
      var p = panel();
      p.style.transition = 'none';
      place(d[0], d[1]);                            // parked just outside the viewport
      p.classList.add('on');                        // visible + blocks pointer input
      void p.offsetWidth;                           // commit the start position before animating
      return frame()
        .then(function () { return slide('0', '0', rm ? RM_IN : IN_MS, EASE_IN); })
        .then(function () {
          try { if (change) change(); }            // the real scene / level change, fully covered
          catch (e) { if (G.console) console.error('[transition] scene change failed:', e); }
          return frame();
        })
        .then(frame)                                // let the new screen lay out and paint
        .then(function () { return slide(d[2], d[3], rm ? RM_OUT : OUT_MS, EASE_OUT); })
        .catch(function (e) { if (G.console) console.error('[transition]', e); })
        .then(function () {                         // always ends uncovered, even after errors
          p.style.transition = 'none';
          p.classList.remove('on');
          busy = false;
          return true;
        });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
