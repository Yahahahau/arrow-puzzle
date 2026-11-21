/* Arrow Puzzle — theme.js
 * Applies a theme (data-theme on <html>, colours from css/themes.css) and hands the canvas
 * palette to the renderer, fading it smoothly. A tiny inline script in index.html sets the
 * attribute before first paint so the wrong theme never flashes. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};
  var NAMES = ['light', 'dark', 'custom'];
  var KEYS = ['ink', 'arrow-fill', 'dot-empty', 'hint', 'glow', 'danger', 'warn', 'ok',
              'map-empty', 'map-avail', 'map-blocked', 'map-removed',
              'confetti-1', 'confetti-2', 'confetti-3', 'confetti-4', 'confetti-5', 'confetti-6'];
  var CUSTOM_KEY = 'arrow-puzzle.custom';
  var root = document.documentElement;
  var cur = null, current = 'light', onPalette = null, raf = 0, animT = 0;

  function parse(c) {                    // '#rrggbb' | '#rgb' | 'rgb(...)' -> [r,g,b]
    c = (c || '').trim();
    var m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return [parseInt(m[1].substr(0, 2), 16), parseInt(m[1].substr(2, 2), 16), parseInt(m[1].substr(4, 2), 16)];
    m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
  }
  function css(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

  function read() {                      // resolved palette (rgb arrays) of the current theme
    var cs = getComputedStyle(root), p = {};
    for (var i = 0; i < KEYS.length; i++) p[KEYS[i]] = parse(cs.getPropertyValue('--' + KEYS[i]));
    return p;
  }
  function strings(p) { var o = {}; for (var k in p) o[k] = css(p[k]); return o; }

  function loadCustom() {
    try { var o = JSON.parse(G.localStorage.getItem(CUSTOM_KEY) || 'null'); if (o) for (var k in o) root.style.setProperty(k, o[k]); } catch (e) {}
  }

  function metaColor() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#f9fafc');
  }

  AP.Theme = {
    NAMES: NAMES,
    get current() { return current; },
    onPalette: function (fn) { onPalette = fn; if (cur) fn(strings(cur)); },
    init: function (name) {
      loadCustom();
      current = NAMES.indexOf(name) >= 0 ? name : 'light';
      root.setAttribute('data-theme', current);
      cur = read(); metaColor();
      if (onPalette) onPalette(strings(cur));
    },
    /* switch theme: CSS crossfades colour properties; the canvas palette is tweened to match */
    set: function (name, animate) {
      if (NAMES.indexOf(name) < 0 || name === current) return;
      var from = cur;
      current = name;
      if (animate !== false) { root.classList.add('theme-anim'); clearTimeout(AP.Theme._t); AP.Theme._t = setTimeout(function () { root.classList.remove('theme-anim'); }, 420); }
      root.setAttribute('data-theme', name);
      var to = read(); metaColor();
      cancelAnimationFrame(raf);
      if (animate === false || !onPalette || !G.performance) { cur = to; if (onPalette) onPalette(strings(to)); return; }
      animT = performance.now();
      (function step(now) {
        var k = Math.min(1, (now - animT) / 320), e = 1 - Math.pow(1 - k, 3), p = {};
        for (var key in to) { var a = from[key], b = to[key]; p[key] = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e]; }
        cur = k >= 1 ? to : p;
        onPalette(strings(cur));
        if (k < 1) raf = requestAnimationFrame(step);
      })(animT);
    },
    /* override CSS variables of the custom theme at runtime, e.g. setCustomTheme({'--accent':'#e0457b'}) */
    setCustom: function (vars) {
      var old = {};
      try { old = JSON.parse(G.localStorage.getItem(CUSTOM_KEY) || '{}') || {}; } catch (e) {}
      for (var k in vars) { old[k] = vars[k]; root.style.setProperty(k, vars[k]); }
      try { G.localStorage.setItem(CUSTOM_KEY, JSON.stringify(old)); } catch (e) {}
      cur = read(); if (onPalette) onPalette(strings(cur)); metaColor();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
