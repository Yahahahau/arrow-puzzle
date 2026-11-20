/* Arrow Puzzle — main.js : screens, HUD, modals, wiring. No dependency on the parent window. */
(function () {
  'use strict';
  var AP = window.AP, Store = AP.Store, Levels = AP.Levels;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), stage = $('stage'), canvas = $('board'), fxCanvas = $('fx'), cfCanvas = $('confetti');

  var I18n = AP.I18n, Theme = AP.Theme, t = I18n.t;

  var mode = 'level', curLevel = 1, curDay = null;
  var calY, calM, confirmCb = null;

  /* ---------- sizing (iframe-aware) ---------- */
  function applySize() {
    var w = app.clientWidth, h = app.clientHeight;
    if (!w || !h) return;
    app.style.setProperty('--u', Math.min(w / 100, h * 9 / 1600) + 'px');
  }
  function syncCanvas() {
    var w = stage.clientWidth, h = stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    var ar = app.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    var W = app.clientWidth, H = app.clientHeight, ox = Math.round((sr.left - ar.left) * 100) / 100, oy = Math.round((sr.top - ar.top) * 100) / 100;
    var dm = $('dotmap'), dw = dm.clientWidth, dh = dm.clientHeight;
    var key = w + 'x' + h + '|' + W + 'x' + H + '|' + ox + ',' + oy + '|' + dw + 'x' + dh;
    if (key === game._key) return;
    var sizeChanged = w !== game._w || h !== game._h;
    game._key = key; game._w = w; game._h = h;
    if (sizeChanged) game.resize(w, h);
    game.setFx(W, H, ox, oy);
    if (dw > 0 && dh > 0) game.resizeDots(dw, dh);
  }

  /* ---------- game ---------- */
  var game = null;
  game = new AP.Game(canvas, fxCanvas, {
    onState: updateHud,
    onSfx: function (n) { AP.Audio.play(n); },
    onHaptic: function () { if (Store.get().vibrate && navigator.vibrate) { try { navigator.vibrate(45); } catch (e) {} } },
    onLifeLost: function (left) {
      var h = $('g-lives').children[left];
      if (h) { h.classList.remove('pop'); void h.getBoundingClientRect(); h.classList.add('pop'); }
    },
    onZoom: function (z) { $('btn-fit').classList.toggle('show', z); },
    onPerf: onPerf,
    onWin: onWin,
    onLose: function () { AP.Audio.play('lose'); setTimeout(function () { if (isGame()) show('m-lose'); }, 250); }
  });

  game.attachDots($('dotmap'));
  game.setConfetti(cfCanvas);
  Theme.onPalette(function (p) { game.setPalette(p); });

  function isGame() { return app.dataset.screen === 'game'; }

  var lastAlive = -1;
  function updateHud(i) {
    var cEl = $('g-count');
    if (i.alive !== lastAlive) {
      cEl.textContent = i.alive;
      if (lastAlive >= 0 && cEl.animate) cEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: .4 }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.22,.8,.3,1)' });
      lastAlive = i.alive;
    }
    var hs = $('g-lives').children;
    for (var k = 0; k < hs.length; k++) hs[k].classList.toggle('off', k >= i.lives);
    $('b-hint').textContent = i.hints; $('b-ruler').textContent = i.rulers;
    $('btn-hint').disabled = i.hints <= 0 || i.state !== 'play';
    $('btn-ruler').disabled = i.rulers <= 0 || i.state !== 'play';
  }

  function startLevel(n) {
    mode = 'level'; curLevel = n; curDay = null;
    openGame(Levels.get(n));
  }
  function startDaily(key) {
    mode = 'daily'; curDay = key;
    openGame(Levels.daily(key));
  }
  function gameTexts(def) {
    $('g-title').textContent = mode === 'daily' ? t('daily_challenge') : t('level_n', { n: curLevel });
    $('g-diff').textContent = t('diff_' + def.label);
  }
  function openGame(def) {
    hideAll(); lastAlive = -1;
    gameTexts(def);
    var hs = $('g-lives').children;
    for (var k = 0; k < hs.length; k++) hs[k].classList.remove('pop');
    setScreen('game');
    applySize();
    game._key = ''; syncCanvas();
    game.load(def);
    game.setPaused(false);
    $('btn-fit').classList.remove('show');
  }

  function onWin() {
    var s = Store.get();
    AP.Audio.play('win');
    if (mode === 'level') {
      Store.set({ level: Math.max(s.level, curLevel + 1), solved: s.solved + 1 });
      winKind = 'level';
    } else {
      var d = s.daily; d[curDay] = true;
      Store.set({ daily: d });
      winKind = 'daily';
    }
    winTexts();
    setTimeout(function () { if (isGame() && game.state === 'won') show('m-win'); }, 450);   // confetti starts first, panel eases in
  }
  var winKind = 'level';
  function winTexts() {
    if (winKind === 'level') {
      $('win-title').textContent = t('level_complete'); $('win-sub').textContent = t('level_complete_sub');
      $('btn-next').textContent = t('next_level');
    } else {
      $('win-title').textContent = t('challenge_complete'); $('win-sub').textContent = t('challenge_complete_sub', { date: I18n.date(curDay) });
      $('btn-next').textContent = t('back_challenges');
    }
  }

  /* ---------- screens ---------- */
  function setScreen(name) {
    app.dataset.screen = name;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].dataset.tab === name);
    if (name === 'home') refreshHome();
    if (name === 'challenge') renderCalendar();
    if (name === 'profile') refreshProfile();
    if (name !== 'game') { game.cancelFx(); game.setPaused(true); }
  }
  var OUT_MS = 240;
  function show(id) { var m = $(id); clearTimeout(m._h); m.classList.remove('out'); m.hidden = false; game.setPaused(true); }
  function hide(id) {                       // animated close
    var m = $(id); if (m.hidden) return;
    m.classList.add('out'); clearTimeout(m._h);
    m._h = setTimeout(function () { m.hidden = true; m.classList.remove('out'); }, OUT_MS);
  }
  function hideAll() {                      // instant (screen / level changes)
    var m = document.querySelectorAll('.modal');
    for (var i = 0; i < m.length; i++) { clearTimeout(m[i]._h); m[i].classList.remove('out'); m[i].hidden = true; }
  }
  function anyModal() {
    var m = document.querySelectorAll('.modal');
    for (var i = 0; i < m.length; i++) if (!m[i].hidden && !m[i].classList.contains('out')) return true;
    return false;
  }
  function goHome() { hideAll(); setScreen('home'); }

  /* ---------- home / challenge / profile ---------- */
  function refreshHome() {
    var s = Store.get(), key = Store.dayKey();
    $('home-level').textContent = t('level_n', { n: s.level });
    $('daily-date').textContent = I18n.date(key);
    $('btn-daily').textContent = s.daily[key] ? t('play_again') : t('play');
  }
  function refreshProfile() {
    var s = Store.get(), n = 0;
    for (var k in s.daily) if (s.daily[k]) n++;
    $('st-level').textContent = s.level; $('st-solved').textContent = s.solved; $('st-daily').textContent = n;
    syncSwitches();
  }
  /* ---------- settings (rendered into every [data-settings] container) ---------- */
  var SW = [['sound', 'sound', 'toggle-sound'], ['music', 'music', 'toggle-music'], ['vibrate', 'vibration', 'toggle-vibrate']];
  function buildSettings() {
    var html = '', s = Store.get(), cur = Theme.current, lang = I18n.lang;
    SW.forEach(function (r) {
      html += '<div class="row"><span>' + t(r[1]) + '</span><button class="switch" role="switch" aria-checked="' + !!s[r[0]] + '" aria-label="' + t(r[1]) +
        '" data-action="' + r[2] + '" data-key="' + r[0] + '"><i></i></button></div>';
    });
    html += '<div class="row stack"><span>' + t('select_theme') + '</span><div class="seg" role="group" aria-label="' + t('select_theme') + '">';
    Theme.NAMES.forEach(function (n) {
      html += '<button data-action="theme" data-v="' + n + '" aria-pressed="' + (n === cur) + '"><span class="sw sw-' + n + '"></span>' + t('theme_' + n) + '</button>';
    });
    html += '</div></div><div class="row stack"><span>' + t('language') + '</span><div class="seg" role="group" aria-label="' + t('language') + '">';
    for (var k in I18n.LANGS) html += '<button data-action="lang" data-v="' + k + '" aria-pressed="' + (k === lang) + '">' + I18n.LANGS[k] + '</button>';
    html += '</div></div>';
    var hosts = document.querySelectorAll('[data-settings]');
    for (var i = 0; i < hosts.length; i++) hosts[i].innerHTML = html;
  }
  function syncSwitches() {
    var s = Store.get(), sw = document.querySelectorAll('.switch[data-key]'), i;
    for (i = 0; i < sw.length; i++) sw[i].setAttribute('aria-checked', String(!!s[sw[i].dataset.key]));
    var b = document.querySelectorAll('.seg button[data-action="theme"]');
    for (i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', String(b[i].dataset.v === Theme.current));
    b = document.querySelectorAll('.seg button[data-action="lang"]');
    for (i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', String(b[i].dataset.v === I18n.lang));
  }
  function refreshTexts() {                    // after a language change
    I18n.apply(document); buildSettings();
    buildWeek();
    refreshHome(); refreshProfile(); renderCalendar();
    if (game.def) { gameTexts(game.def); winTexts(); }
  }
  function buildWeek() {
    var wk = $('cal-week'), d = I18n.t('weekdays'); wk.textContent = '';
    d.forEach(function (w) { var e = document.createElement('span'); e.textContent = w; wk.appendChild(e); });
  }

  function renderCalendar() {
    var now = new Date();
    if (calY === undefined) { calY = now.getFullYear(); calM = now.getMonth(); }
    var s = Store.get(), todayKey = Store.dayKey(now);
    $('month-title').textContent = t('month_fmt', { month: t('months')[calM], y: calY });
    $('btn-month-next').disabled = calY === now.getFullYear() && calM === now.getMonth();
    if (!$('cal-week').firstChild) buildWeek();
    var g = $('cal-grid'); g.textContent = '';
    var first = new Date(calY, calM, 1).getDay(), days = new Date(calY, calM + 1, 0).getDate(), i, done = 0;
    for (i = 0; i < first; i++) { var e = document.createElement('div'); e.className = 'day empty'; g.appendChild(e); }
    for (i = 1; i <= days; i++) {
      var key = calY + '-' + (calM + 1 < 10 ? '0' : '') + (calM + 1) + '-' + (i < 10 ? '0' : '') + i;
      var b = document.createElement('button');
      b.className = 'day'; b.textContent = i; b.dataset.key = key; b.dataset.action = 'day';
      if (key > todayKey) b.disabled = true;
      if (key === todayKey) b.classList.add('today');
      if (s.daily[key]) { b.classList.add('done'); done++; }
      g.appendChild(b);
    }
    $('cal-note').textContent = t('month_done', { n: done });
  }

  /* ---------- developer mode: ?dev=1 or tap the level title 5 times ---------- */
  var devState = { on: false, grid: false, perf: true };
  function fmt(n, d) { return n.toFixed(d); }
  function onPerf(p) {
    if (!devState.on || !devState.perf) return;
    $('dev-out').textContent =
      'FPS     ' + fmt(p.fps, 1) + '  (avg ' + fmt(p.avg, 1) + ')\n' +
      'Frame   ' + fmt(p.ms, 1) + ' ms   ~' + fmt(p.refresh, 0) + ' Hz\n' +
      'Dropped ' + p.dropped + '\n' +
      'State   ' + p.state + '\n' +
      'Flying  ' + p.moving;
  }
  function applyDev() {
    $('dev').hidden = !devState.on;
    $('dv-grid').classList.toggle('on', devState.grid);
    $('dv-perf').classList.toggle('on', devState.perf);
    if (!devState.perf) $('dev-out').textContent = 'perf off';
    game.setDev({ grid: devState.on && devState.grid, perf: devState.on && devState.perf });
  }
  function setDev(on) { devState.on = on; applyDev(); }
  var titleTaps = 0, titleT = 0;
  $('g-title').addEventListener('click', function () {
    var n = performance.now();
    titleTaps = n - titleT < 1500 ? titleTaps + 1 : 1; titleT = n;
    if (titleTaps >= 5) { titleTaps = 0; setDev(!devState.on); }
  });

  /* ---------- confirm dialog ---------- */
  function ask(title, text, cb) {
    $('cf-title').textContent = t(title); $('cf-text').textContent = t(text); confirmCb = cb; show('m-confirm');
  }

  /* ---------- actions ---------- */
  var actions = {
    'play-daily': function () { startDaily(Store.dayKey()); },
    'continue': function () { startLevel(Store.get().level); },
    'restart-game': function () {
      ask('restart_q', 'restart_q_text', function () {
        Store.set({ level: 1, solved: 0 }); startLevel(1);
      });
    },
    'tab': function (el) { setScreen(el.dataset.tab); },
    'home': goHome,
    'pause': function () { show('m-pause'); syncSwitches(); },
    'resume': function () { hide('m-pause'); game.setPaused(false); },
    'restart-level': function () { hideAll(); game.load(game.def); game.setPaused(false); $('btn-fit').classList.remove('show'); },
    'next': function () {
      hideAll();
      if (mode === 'level') startLevel(curLevel + 1);
      else setScreen('challenge');
    },
    'fit': function () { game.fit(); },
    'dev-grid': function () { devState.grid = !devState.grid; applyDev(); },
    'dev-perf': function () { devState.perf = !devState.perf; applyDev(); },
    'dev-off': function () { setDev(false); },
    'hint': function () { game.useHint(); },
    'ruler': function () { game.useRuler(); },
    'toggle-sound': function () { var v = !Store.get().sound; Store.set({ sound: v }); AP.Audio.setEnabled(v); syncSwitches(); if (v) AP.Audio.play('tap'); },
    'toggle-music': function () { var v = !Store.get().music; Store.set({ music: v }); AP.Audio.setMusic(v); syncSwitches(); },
    'theme': function (el) { Store.set({ theme: el.dataset.v }); Theme.set(el.dataset.v, true); syncSwitches(); },
    'lang': function (el) { Store.set({ lang: el.dataset.v }); I18n.setLang(el.dataset.v); refreshTexts(); },
    'toggle-vibrate': function () { Store.set({ vibrate: !Store.get().vibrate }); syncSwitches(); },
    'reset-progress': function () {
      ask('reset_q', 'reset_q_text', function () { Store.reset(); refreshProfile(); });
    },
    'month-prev': function () { calM--; if (calM < 0) { calM = 11; calY--; } renderCalendar(); },
    'month-next': function () { calM++; if (calM > 11) { calM = 0; calY++; } renderCalendar(); },
    'day': function (el) { startDaily(el.dataset.key); },
    'confirm-yes': function () { var cb = confirmCb; confirmCb = null; hide('m-confirm'); if (isGame()) game.setPaused(anyModal()); if (cb) cb(); },
    'confirm-no': function () { confirmCb = null; hide('m-confirm'); if (isGame()) game.setPaused(anyModal()); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el || el.disabled) return;
    var fn = actions[el.dataset.action];
    if (fn) { AP.Audio.play('tap'); fn(el); }
  });
  document.addEventListener('pointerdown', function () { AP.Audio.unlock(); }, { once: true, capture: true });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
    document.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isGame()) { if (!$('m-pause').hidden) actions.resume(); else if (!anyModal()) actions.pause(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) AP.Audio.setEnabled(false); else AP.Audio.setEnabled(Store.get().sound); });

  /* ---------- press feedback (pointer events only: no duplicate touch/mouse handling) ---------- */
  var PRESS = '.btn-primary,.btn-secondary,.pill-sm,.tool,.icon-btn,.round-btn,.day,.tab,.fit-btn,.switch,.seg button';
  var MIN_HOLD = 90, held = [];
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest ? e.target.closest(PRESS) : null;
    if (!el || el.disabled || el.classList.contains('empty')) return;
    el.classList.add('pressed'); el._pt = performance.now(); held.push(el);
  }, true);
  function releaseAll() {
    var now = performance.now();
    while (held.length) {
      (function (el) {
        var wait = Math.max(0, MIN_HOLD - (now - el._pt));   // quick taps still show the press
        setTimeout(function () { el.classList.remove('pressed'); }, wait);
      })(held.pop());
    }
  }
  document.addEventListener('pointerup', releaseAll, true);
  document.addEventListener('pointercancel', releaseAll, true);
  window.addEventListener('blur', releaseAll);

  /* hover light follows the cursor (hover-capable devices only) */
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var hv = null, hx = 0, hy = 0, hraf = 0;
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var el = e.target.closest ? e.target.closest('.btn-primary,.btn-secondary,.pill-sm,.tool,.round-btn,.icon-btn') : null;
      if (!el) return;
      hv = el; hx = e.clientX; hy = e.clientY;
      if (!hraf) hraf = requestAnimationFrame(function () {
        hraf = 0;
        var r = hv.getBoundingClientRect();
        hv.style.setProperty('--mx', ((hx - r.left) / r.width * 100).toFixed(1) + '%');
        hv.style.setProperty('--my', ((hy - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }, { passive: true });
  }

  /* ---------- resize observers ---------- */
  function onResize() { applySize(); syncCanvas(); }
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { onResize(); });
    ro.observe(app); ro.observe(stage);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });

  /* ---------- boot ---------- */
  I18n.setLang(Store.get().lang || 'en');
  Theme.init(Store.get().theme);
  I18n.apply(document); buildSettings(); buildWeek();
  AP.Audio.setEnabled(Store.get().sound); AP.Audio.setMusic(Store.get().music);
  applySize();
  setScreen('home');
  if (/[?&]dev=1/.test(location.search)) setDev(true);
  if (/[?&]level=(\d+)/.test(location.search)) startLevel(parseInt(RegExp.$1, 10));
  window.ArrowPuzzle = { game: game, startLevel: startLevel, startDaily: startDaily, setTheme: function (n) { Store.set({ theme: n }); Theme.set(n, true); syncSwitches(); },
    setCustomTheme: function (v) { Theme.setCustom(v); }, setLanguage: function (l) { Store.set({ lang: l }); I18n.setLang(l); refreshTexts(); } };
})();
