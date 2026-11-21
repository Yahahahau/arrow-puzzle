/* Arrow Puzzle — main.js : screens, HUD, modals, wiring. No dependency on the parent window. */
(function () {
  'use strict';
  var AP = window.AP, Store = AP.Store, Levels = AP.Levels;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), stage = $('stage'), canvas = $('board'), fxCanvas = $('fx'), cfCanvas = $('confetti');

  var I18n = AP.I18n, Theme = AP.Theme, t = I18n.t;
  var STAR_ICON = '<svg class="ic star" viewBox="0 0 24 24" aria-hidden="true"><path class="o fy" stroke-width="2.4" d="M12 2.5 L14.5 9.1 L21.8 9.4 L16 13.9 L17.8 20.7 L12 17.2 L6.2 20.5 L7.8 14 L2.8 9.6 L9.4 9Z"/></svg>';

  /* hand-drawn panels + 12 FPS outline frames for every [data-sk] element (js/sketch.js) */
  if (AP.Sketch) AP.Sketch.init(app);

  var mode = 'level', curLevel = 1, curDay = null;
  var calY, calM, confirmCb = null;

  /* ---------- sizing (iframe-aware) ---------- */
  function applySize() {
    var w = app.clientWidth, h = app.clientHeight;
    if (!w || !h) return;
    // portrait: 9:16 design width; landscape (tablets, rotated phones, desktop): side panels around the board.
    // --u is capped so tablets get comfortable, not oversized, controls.
    var land = w > h * 1.15;
    if (app.dataset.orient !== (land ? 'land' : 'port')) app.dataset.orient = land ? 'land' : 'port';
    var u = land ? Math.min(h / 100, w / 190) : Math.min(w / 100, h * 9 / 1600);
    app.style.setProperty('--u', Math.min(u, 5.2).toFixed(3) + 'px');
  }
  function syncCanvas() {
    var w = stage.clientWidth, h = stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    // layout offset of the board inside #app. offsetLeft/Top ignore CSS transforms, so the value stays
    // correct while a screen is still sliding in (getBoundingClientRect would capture the mid-animation
    // position and flying arrows would jump away from the board when tapped).
    var ox = 0, oy = 0, el = stage;
    while (el && el !== app) { ox += el.offsetLeft + (el.clientLeft || 0); oy += el.offsetTop + (el.clientTop || 0); el = el.offsetParent; }
    var scr = $('s-game'), still = scr.getAnimations ? scr.getAnimations().length === 0 : true;
    if (el !== app || still) { var ar = app.getBoundingClientRect(), sr = stage.getBoundingClientRect(); ox = sr.left - ar.left; oy = sr.top - ar.top; }
    var W = app.clientWidth, H = app.clientHeight;
    ox = Math.round(ox * 100) / 100; oy = Math.round(oy * 100) / 100;
    var dm = $('dotmap'), dw = dm.clientWidth, dh = dm.clientHeight;
    var key = w + 'x' + h + '|' + W + 'x' + H + '|' + ox + ',' + oy + '|' + dw + 'x' + dh;
    if (key === game._key) return;
    var sizeChanged = w !== game._w || h !== game._h;
    game._key = key; game._w = w; game._h = h;
    if (sizeChanged) game.resize(w, h);
    game.setFx(W, H, ox, oy);
    if (dw > 0 && dh > 0) game.resizeDots(dw, dh);
  }

  app.addEventListener('animationend', function () { if (app.dataset.screen === 'game') syncCanvas(); });

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
    $('g-diff-t').textContent = t('diff_' + def.label);
    $('g-diff').setAttribute('data-lvl', { easy: 1, medium: 2, hard: 3, expert: 4, daily: 2 }[def.label] || 1);
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
  /* every major scene change goes through the black wipe; the change itself runs while covered */
  var T = AP.Transition;
  var U = AP.Update, RESUME = 'arrow-puzzle.resume';
  function wipe(fn) {
    var upd = !!U.pending;                         // a new version is waiting: switch scene, then reload while black
    return T.run(function () {
      try { fn(); } finally { if (upd) U.reload(U.pending); }
    }, { hold: upd });
  }
  function saveResume() {                         // where to land after an update reload
    var r = { screen: app.dataset.screen };
    if (r.screen === 'game') { r.mode = mode; r.level = curLevel; r.day = curDay; }
    try { sessionStorage.setItem(RESUME, JSON.stringify(r)); } catch (e) {}
  }
  function goHome() { wipe(function () { hideAll(); setScreen('home'); }); }

  /* ---------- home / challenge / profile ---------- */
  function refreshHome() {
    var s = Store.get(), key = Store.dayKey();
    $('home-level').textContent = t('level_n', { n: s.level });
    $('daily-date').textContent = I18n.date(key);
    $('btn-daily-t').textContent = s.daily[key] ? t('play_again') : t('play');
  }
  function refreshProfile() {
    var s = Store.get(), n = 0;
    for (var k in s.daily) if (s.daily[k]) n++;
    $('st-level').textContent = s.level; $('st-solved').textContent = s.solved; $('st-daily').textContent = n;
    syncSwitches();
  }
  /* ---------- settings (rendered into every [data-settings] container) ---------- */
  var SW = [['sound', 'sound', 'toggle-sound'], ['music', 'music', 'toggle-music'], ['vibrate', 'vibration', 'toggle-vibrate']];
  /* hand-drawn setting icons (thick outlines, flat fills; see .ic in style.css) */
  var SET_IC = {
    sound: '<path class="o fy" d="M3.6 9.2 L7.8 9.1 L12.6 4.8 L12.9 19.4 L7.9 15.1 L3.7 15.2 Z"/><path class="o n" d="M16 9 C17.4 10.6 17.4 13.6 16.1 15.2 M18.8 6.4 C21.6 9.4 21.6 14.8 18.9 17.8"/>',
    music: '<path class="o n" d="M9.6 17.4 L9.4 5.2 L19.6 3.6 L19.8 15.6"/><path class="o fs" d="M9.5 17.3 C9.6 19.3 8 20.6 6.1 20.6 C4.3 20.5 3.4 19.4 3.5 18 C3.6 16.4 5.2 15.3 7.1 15.4 C8.4 15.4 9.4 16.1 9.5 17.3 Z M19.7 15.5 C19.8 17.5 18.2 18.8 16.3 18.8 C14.5 18.7 13.6 17.6 13.7 16.2 C13.8 14.6 15.4 13.5 17.3 13.6 C18.6 13.6 19.6 14.3 19.7 15.5 Z"/>',
    vibrate: '<path class="o fs" d="M8.2 3.6 L15.9 3.4 L16.2 20.5 L8.4 20.7 Z"/><path class="o n" d="M4.6 7.4 L2.8 9.6 L4.8 12 L2.9 14.4 L4.7 16.6 M19.4 7.2 L21.2 9.5 L19.3 11.9 L21.1 14.3 L19.3 16.5"/>',
    theme: '<path class="o fw" d="M12.3 3.4 C17.6 3.2 21 6.8 20.8 11.4 C20.6 14.4 18.4 15 16.6 14.6 C14.8 14.2 13.6 15.4 14.3 17.2 C15.1 19.2 13.8 20.8 11.8 20.6 C6.8 20.2 3.2 16.6 3.4 11.8 C3.6 7 7.2 3.6 12.3 3.4 Z"/><circle class="o fa" cx="8.2" cy="10.6" r="1.7" stroke-width="1.6"/><circle class="o fy" cx="12.1" cy="7.4" r="1.7" stroke-width="1.6"/><circle class="o fs" cx="16.3" cy="9.4" r="1.7" stroke-width="1.6"/>',
    lang: '<path class="o fw" d="M3.6 4.6 L20.4 4.2 L20.6 15.4 L11.4 15.6 L6.6 20 L7 15.6 L3.8 15.7 Z"/><path class="o n" d="M8.2 12.6 L11.9 6.6 L15.6 12.4 M9.6 10.6 L14.3 10.5" stroke-width="2"/>'
  };
  function ic(k) { return '<svg class="ic ri" viewBox="0 0 24 24" aria-hidden="true">' + SET_IC[k] + '</svg>'; }
  function buildSettings() {
    var html = '', s = Store.get(), cur = Theme.current, lang = I18n.lang;
    SW.forEach(function (r) {
      html += '<div class="row"><span class="rl">' + ic(r[0]) + '<span>' + t(r[1]) + '</span></span><button class="switch" data-sk="sw" role="switch" aria-checked="' + !!s[r[0]] + '" aria-label="' + t(r[1]) +
        '" data-action="' + r[2] + '" data-key="' + r[0] + '"><i data-sk="knob" data-sk-amp="1.6"></i></button></div>';
    });
    html += '<div class="row stack"><span class="rl">' + ic('theme') + '<span>' + t('select_theme') + '</span></span><div class="seg" data-sk="seg" role="group" aria-label="' + t('select_theme') + '">';
    Theme.NAMES.forEach(function (n) {
      html += '<button data-action="theme" data-sk="segb" data-v="' + n + '" aria-pressed="' + (n === cur) + '"><span class="sw sw-' + n + '"></span>' + t('theme_' + n) + '</button>';
    });
    html += '</div></div><div class="row stack"><span class="rl">' + ic('lang') + '<span>' + t('language') + '</span></span><div class="seg" data-sk="seg" role="group" aria-label="' + t('language') + '">';
    for (var k in I18n.LANGS) html += '<button data-action="lang" data-sk="segb" data-v="' + k + '" aria-pressed="' + (k === lang) + '">' + I18n.LANGS[k] + '</button>';
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
      b.setAttribute('data-sk', 'day');
      if (s.daily[key]) { b.classList.add('done'); b.insertAdjacentHTML('beforeend', STAR_ICON); done++; }
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
    'play-daily': function () { wipe(function () { startDaily(Store.dayKey()); }); },
    'continue': function () { wipe(function () { startLevel(Store.get().level); }); },
    'restart-game': function () {
      ask('restart_q', 'restart_q_text', function () {
        Store.set({ level: 1, solved: 0 }); wipe(function () { startLevel(1); });
      });
    },
    'tab': function (el) { if (el.dataset.tab !== app.dataset.screen) wipe(function () { setScreen(el.dataset.tab); }); },
    'home': goHome,
    'pause': function () { show('m-pause'); syncSwitches(); },
    'resume': function () { hide('m-pause'); game.setPaused(false); },
    'restart-level': function () { wipe(function () { hideAll(); game.load(game.def); game.setPaused(false); $('btn-fit').classList.remove('show'); }); },
    'next': function () {
      wipe(function () {
        hideAll();
        if (mode === 'level') startLevel(curLevel + 1);
        else setScreen('challenge');
      });
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
    'day': function (el) { wipe(function () { startDaily(el.dataset.key); }); },
    'confirm-yes': function () { var cb = confirmCb; confirmCb = null; hide('m-confirm'); if (isGame()) game.setPaused(anyModal()); if (cb) cb(); },
    'confirm-no': function () { confirmCb = null; hide('m-confirm'); if (isGame()) game.setPaused(anyModal()); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el || el.disabled || T.busy) return;     // no input while a wipe is running
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
  // came back from an auto-update reload: start covered, restore the screen, reveal with the wipe
  var resume = null;
  try { resume = JSON.parse(sessionStorage.getItem(RESUME) || 'null'); sessionStorage.removeItem(RESUME); } catch (e) {}
  if (resume) {
    T.cover();
    document.documentElement.classList.remove('wipe-boot');
    try {
      if (resume.screen === 'game') { if (resume.mode === 'daily' && resume.day) startDaily(resume.day); else startLevel(resume.level || Store.get().level); }
      else if (/^(home|challenge|profile)$/.test(resume.screen)) setScreen(resume.screen);
    } catch (e) { setScreen('home'); }
    T.reveal();
  }
  document.documentElement.classList.remove('wipe-boot');
  U.start({
    isSafe: function () { return app.dataset.screen !== 'game' && !anyModal() && !T.busy; },
    beforeReload: saveResume
  });
  if (/[?&]dev=1/.test(location.search)) setDev(true);
  if (/[?&]level=(\d+)/.test(location.search)) startLevel(parseInt(RegExp.$1, 10));
  window.ArrowPuzzle = { game: game, transition: function (fn, dir) { return AP.Transition.run(fn, { dir: dir }); }, startLevel: startLevel, startDaily: startDaily, setTheme: function (n) { Store.set({ theme: n }); Theme.set(n, true); syncSwitches(); },
    setCustomTheme: function (v) { Theme.setCustom(v); }, setLanguage: function (l) { Store.set({ lang: l }); I18n.setLang(l); refreshTexts(); } };
})();
