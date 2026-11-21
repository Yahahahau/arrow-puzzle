/* Arrow Puzzle — update.js : live auto-update (same flow as Pixel Cash Factory's embed.js).
 *
 * Every deploy writes version.json {version} and stamps the same id into index.html
 * (<meta name="app-version">, also appended as ?v= to every CSS/JS url) — see tools/stamp-version.js.
 * The running game polls version.json (no-store). When it differs from the build it is running:
 *   - it tells the host page (postMessage 'arrow-puzzle:updateAvailable'),
 *   - waits for a safe moment (never in the middle of a level),
 *   - covers the screen with the black wipe, remembers where the player was, and reloads onto the
 *     new build; the new page starts black and reveals with the same wipe (see main.js).
 * Host messages: {target:'arrow-puzzle', type:'arrow-puzzle:checkUpdate' | 'arrow-puzzle:reload'}.
 * Reload attempts per version are capped (sessionStorage) so a stale cache can never cause a loop. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};
  var POLL_MS = 45000, FIRST_MS = 4000, MAX_TRIES = 2, SRC = 'arrow-puzzle';

  var meta = document.querySelector('meta[name="app-version"]');
  var BUILD = (meta && meta.getAttribute('content')) || 'dev';
  var inIframe = (function () { try { return G.self !== G.top; } catch (e) { return true; } })();
  var latest = BUILD, pending = null, checking = false, hooks = {}, timer = 0;

  function post(msg) {
    if (!inIframe) return;
    msg.source = SRC;
    try { G.parent.postMessage(msg, '*'); } catch (e) {}
  }
  function tries(v) { try { return +(sessionStorage.getItem('arrow-puzzle.reloadTries.' + v) || 0); } catch (e) { return 0; } }
  function bump(v) { try { sessionStorage.setItem('arrow-puzzle.reloadTries.' + v, String(tries(v) + 1)); } catch (e) {} }
  function enabled() { return BUILD !== 'dev' && /^https?:$/.test(G.location.protocol); }

  function check(force) {
    if (checking || !enabled()) return Promise.resolve(null);
    checking = true;
    return fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.version || j.version === BUILD) return null;
        latest = j.version;
        if (tries(j.version) >= MAX_TRIES && !force) return null;
        if (pending !== j.version) {
          pending = j.version;
          post({ type: 'arrow-puzzle:updateAvailable', from: BUILD, to: j.version });
          if (hooks.onAvailable) hooks.onAvailable(j.version);
        }
        if (force || (hooks.isSafe && hooks.isSafe())) apply();
        return j.version;
      })
      .catch(function () { return null; })        // offline: try again later
      .then(function (v) { checking = false; return v; });
  }

  /* reload onto the new build; ready() is called while the screen is black (save where we are) */
  function reload(version) {
    version = version || latest;
    try { if (hooks.beforeReload) hooks.beforeReload(); } catch (e) {}
    bump(version);
    post({ type: 'arrow-puzzle:reloading', to: version });
    var u = new URL(G.location.href);
    u.searchParams.set('v', version);              // new query string => fresh HTML even through caches
    G.location.replace(u.toString());
  }
  function apply() {
    if (!pending) return false;
    var v = pending;
    if (AP.Transition && !AP.Transition.busy) AP.Transition.run(function () { reload(v); }, { hold: true });
    else reload(v);
    return true;
  }

  AP.Update = {
    BUILD: BUILD,
    get pending() { return pending; },
    /* hooks: isSafe() -> bool, beforeReload(), onAvailable(version) */
    start: function (h) {
      hooks = h || {};
      post({ type: 'arrow-puzzle:ready', version: BUILD });
      if (!enabled()) return;
      timer = setInterval(function () { check(false); }, POLL_MS);
      G.addEventListener('online', function () { check(false); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(false); });
      setTimeout(function () { check(false); }, FIRST_MS);
      G.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || typeof d !== 'object' || (d.target && d.target !== SRC)) return;
        if (d.type === 'arrow-puzzle:checkUpdate') check(true);
        else if (d.type === 'arrow-puzzle:reload') reload(latest);
      });
    },
    check: check,
    /* call at safe moments (screen changes): reloads if an update is waiting; returns true if it did */
    applyIfPending: apply,
    reload: reload
  };
})(typeof window !== 'undefined' ? window : globalThis);
