/* Arrow Puzzle — main.js : screens, HUD, modals, wiring. No dependency on the parent window. */
(function () {
  'use strict';
  var AP = window.AP, Store = AP.Store, Levels = AP.Levels;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), stage = $('stage'), canvas = $('board'), fxCanvas = $('fx');

  var MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var WEEK = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

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
    var key = w + 'x' + h + '|' + W + 'x' + H + '|' + ox + ',' + oy;
    if (key === game._key) return;
    var sizeChanged = w !== game._w || h !== game._h;
    game._key = key; game._w = w; game._h = h;
    if (sizeChanged) game.resize(w, h);
    game.setFx(W, H, ox, oy);
  }

  /* ---------- game ---------- */
  var game = new AP.Game(canvas, fxCanvas, {
    onState: updateHud,
    onSfx: function (n) { AP.Audio.play(n); },
    onHaptic: function () { if (Store.get().vibrate && navigator.vibrate) { try { navigator.vibrate(45); } catch (e) {} } },
    onHeartLost: function (left) {
      var h = $('g-hearts').children[left];
      if (h) { h.classList.remove('pop'); void h.getBoundingClientRect(); h.classList.add('pop'); }
    },
    onZoom: function (z) { $('btn-fit').classList.toggle('show', z); },
    onPerf: onPerf,
    onWin: onWin,
    onLose: function () { AP.Audio.play('lose'); setTimeout(function () { if (isGame()) show('m-lose'); }, 250); }
  });

  function isGame() { return app.dataset.screen === 'game'; }

  function updateHud(i) {
    $('g-count').textContent = i.alive;
    var hs = $('g-hearts').children;
    for (var k = 0; k < hs.length; k++) {
      var lost = k >= i.hearts;
      hs[k].firstElementChild.setAttribute('href', lost ? '#ic-heart-off' : '#ic-heart');
    }
    $('b-hint').textContent = i.hints; $('b-ruler').textContent = i.rulers;
    $('btn-hint').disabled = i.hints <= 0 || i.state !== 'play';
    $('btn-ruler').disabled = i.rulers <= 0 || i.state !== 'play';
  }

  function startLevel(n) {
    mode = 'level'; curLevel = n; curDay = null;
    openGame(Levels.get(n), 'เลเวล ' + n);
  }
  function startDaily(key) {
    mode = 'daily'; curDay = key;
    openGame(Levels.daily(key), 'คำท้าประจำวัน');
  }
  function openGame(def, title) {
    hideAll();
    $('g-title').textContent = title;
    $('g-diff').textContent = def.label;
    var hs = $('g-hearts').children;
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
      $('win-title').textContent = 'ผ่านเลเวล ' + curLevel + '!';
      $('win-sub').textContent = 'เก่งมาก! พร้อมสำหรับด่านที่ยากขึ้นหรือยัง?';
      $('btn-next').textContent = 'ด่านถัดไป';
    } else {
      var d = s.daily; d[curDay] = true;
      Store.set({ daily: d });
      $('win-title').textContent = 'ทำคำท้าสำเร็จ!';
      $('win-sub').textContent = 'คำท้าประจำวันที่ ' + thDate(curDay);
      $('btn-next').textContent = 'กลับไปที่คำท้า';
    }
    setTimeout(function () { if (isGame() && game.state === 'won') show('m-win'); }, 900);
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
  function show(id) { $(id).hidden = false; game.setPaused(true); }
  function hide(id) { $(id).hidden = true; }
  function hideAll() {
    var m = document.querySelectorAll('.modal');
    for (var i = 0; i < m.length; i++) m[i].hidden = true;
  }
  function anyModal() {
    var m = document.querySelectorAll('.modal');
    for (var i = 0; i < m.length; i++) if (!m[i].hidden) return true;
    return false;
  }
  function goHome() { hideAll(); setScreen('home'); }

  /* ---------- home / challenge / profile ---------- */
  function thDate(key) {
    var p = key.split('-');
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1];
  }
  function refreshHome() {
    var s = Store.get(), key = Store.dayKey();
    $('home-level').textContent = 'เลเวล ' + s.level;
    $('daily-date').textContent = thDate(key);
    $('btn-daily').textContent = s.daily[key] ? 'เล่นอีกครั้ง' : 'เล่น';
  }
  function refreshProfile() {
    var s = Store.get(), n = 0;
    for (var k in s.daily) if (s.daily[k]) n++;
    $('st-level').textContent = s.level; $('st-solved').textContent = s.solved; $('st-daily').textContent = n;
    syncSwitches();
  }
  function syncSwitches() {
    var s = Store.get();
    ['sw-sound', 'sw-sound-p'].forEach(function (id) { $(id).setAttribute('aria-checked', String(!!s.sound)); });
    ['sw-vib', 'sw-vib-p'].forEach(function (id) { $(id).setAttribute('aria-checked', String(!!s.vibrate)); });
  }

  function renderCalendar() {
    var now = new Date();
    if (calY === undefined) { calY = now.getFullYear(); calM = now.getMonth(); }
    var s = Store.get(), todayKey = Store.dayKey(now);
    $('month-title').textContent = MONTHS[calM] + ' ' + (calY + 543);
    $('btn-month-next').disabled = calY === now.getFullYear() && calM === now.getMonth();
    var wk = $('cal-week');
    if (!wk.firstChild) WEEK.forEach(function (w) { var e = document.createElement('span'); e.textContent = w; wk.appendChild(e); });
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
    $('cal-note').textContent = 'ทำคำท้าสำเร็จเดือนนี้ ' + done + ' วัน';
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
    $('cf-title').textContent = title; $('cf-text').textContent = text; confirmCb = cb; show('m-confirm');
  }

  /* ---------- actions ---------- */
  var actions = {
    'play-daily': function () { startDaily(Store.dayKey()); },
    'continue': function () { startLevel(Store.get().level); },
    'restart-game': function () {
      ask('รีสตาร์ทเกม?', 'ความคืบหน้าจะถูกรีเซ็ตกลับไปเริ่มที่เลเวล 1', function () {
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
    'toggle-vibrate': function () { Store.set({ vibrate: !Store.get().vibrate }); syncSwitches(); },
    'reset-progress': function () {
      ask('ล้างความคืบหน้า?', 'ข้อมูลเลเวลและคำท้าทั้งหมดจะถูกลบ', function () { Store.reset(); refreshProfile(); });
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

  /* ---------- resize observers ---------- */
  function onResize() { applySize(); syncCanvas(); }
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { onResize(); });
    ro.observe(app); ro.observe(stage);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });

  /* ---------- boot ---------- */
  AP.Audio.setEnabled(Store.get().sound);
  applySize();
  setScreen('home');
  if (/[?&]dev=1/.test(location.search)) setDev(true);
  if (/[?&]level=(\d+)/.test(location.search)) startLevel(parseInt(RegExp.$1, 10));
  window.ArrowPuzzle = { game: game, startLevel: startLevel, startDaily: startDaily };
})();
