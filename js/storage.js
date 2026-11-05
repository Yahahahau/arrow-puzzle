/* Arrow Puzzle — storage.js : localStorage with in-memory fallback (WebView / iframe safe) */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};
  var KEY = 'arrow-puzzle.v1';
  var mem = null;

  function defaults() {
    return { level: 1, solved: 0, daily: {}, sound: true, vibrate: true, best: 1 };
  }
  function load() {
    if (mem) return mem;
    var d = defaults();
    try {
      var raw = G.localStorage.getItem(KEY);
      if (raw) { var o = JSON.parse(raw); for (var k in o) d[k] = o[k]; }
    } catch (e) {}
    mem = d;
    return d;
  }
  function save() {
    try { G.localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
  }

  AP.Store = {
    get: function () { return load(); },
    set: function (patch) { var s = load(); for (var k in patch) s[k] = patch[k]; save(); return s; },
    reset: function () { mem = defaults(); save(); return mem; },
    dayKey: function (d) {
      d = d || new Date();
      var m = d.getMonth() + 1, day = d.getDate();
      return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
