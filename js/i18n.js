/* Arrow Puzzle — i18n.js : all UI text lives here. English is the default.
 * Add a language by copying the "en" block, translating it, and adding its name to LANGS.
 * In HTML use data-i18n="key" (text) and data-i18n-aria="key" (aria-label). */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};

  var LANGS = { en: 'English', th: 'ไทย' };

  var D = {
    en: {
      play: 'Play', daily_challenge: 'Daily Challenge', continue: 'Continue', level_n: 'Level {n}',
      restart_game: 'Restart Game', tab_home: 'Home', tab_challenges: 'Challenges', tab_profile: 'Profile',
      challenges: 'Challenges', profile: 'Profile', play_again: 'Play Again',
      settings: 'Settings', pause: 'Pause', resume: 'Resume', restart: 'Restart', home: 'Home',
      sound: 'Sound', music: 'Music', vibration: 'Vibration', select_theme: 'Select Theme', language: 'Language',
      theme_light: 'Light', theme_dark: 'Dark', theme_custom: 'Custom',
      hint: 'Hint', ruler: 'Ruler', fit: 'Fit to screen', board: 'Game board', dotmap: 'Dot map of arrow positions',
      level_complete: 'Level Complete!', level_complete_sub: 'Great job! Ready for something harder?',
      next_level: 'Next Level', replay: 'Replay',
      challenge_complete: 'Challenge Complete!', challenge_complete_sub: 'Daily challenge for {date}', back_challenges: 'Back to Challenges',
      out_of_lives: 'Out of Lives', out_of_lives_sub: 'Give it another go. Hints can help!', try_again: 'Try Again',
      confirm: 'Confirm', cancel: 'Cancel',
      restart_q: 'Restart game?', restart_q_text: 'Your progress will be reset and you will start again from Level 1.',
      reset_all: 'Reset All Progress', reset_q: 'Reset progress?', reset_q_text: 'All level and challenge data will be deleted.',
      st_level: 'Current Level', st_solved: 'Levels Solved', st_daily: 'Challenges Won',
      month_done: 'Challenges completed this month: {n}',
      prev_month: 'Previous month', next_month: 'Next month', lives: 'Lives', arrows_left: 'Arrows left',
      diff_easy: 'Easy', diff_medium: 'Medium', diff_hard: 'Hard', diff_expert: 'Expert', diff_daily: 'Challenge',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      weekdays: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
      date_fmt: '{month} {d}', month_fmt: '{month} {y}'
    },
    th: {
      play: 'เล่น', daily_challenge: 'คำท้าประจำวัน', continue: 'เล่นเกมต่อไป', level_n: 'เลเวล {n}',
      restart_game: 'รีสตาร์ทเกม', tab_home: 'หน้าหลัก', tab_challenges: 'คำท้า', tab_profile: 'ฉัน',
      challenges: 'คำท้า', profile: 'ฉัน', play_again: 'เล่นอีกครั้ง',
      settings: 'ตั้งค่า', pause: 'หยุดชั่วคราว', resume: 'เล่นต่อ', restart: 'เริ่มด่านใหม่', home: 'กลับหน้าหลัก',
      sound: 'เสียง', music: 'ดนตรี', vibration: 'การสั่น', select_theme: 'เลือกธีม', language: 'ภาษา',
      theme_light: 'สว่าง', theme_dark: 'มืด', theme_custom: 'กำหนดเอง',
      hint: 'คำใบ้', ruler: 'ไม้บรรทัด', fit: 'ย่อให้พอดีจอ', board: 'กระดานเกม', dotmap: 'แผนที่จุดแสดงตำแหน่งลูกศร',
      level_complete: 'ผ่านด่าน!', level_complete_sub: 'เก่งมาก! พร้อมสำหรับด่านที่ยากขึ้นหรือยัง?',
      next_level: 'ด่านถัดไป', replay: 'เล่นซ้ำ',
      challenge_complete: 'ทำคำท้าสำเร็จ!', challenge_complete_sub: 'คำท้าประจำวันที่ {date}', back_challenges: 'กลับไปที่คำท้า',
      out_of_lives: 'ชีวิตหมดแล้ว', out_of_lives_sub: 'ลองอีกครั้ง ใช้คำใบ้ช่วยได้นะ', try_again: 'เล่นใหม่',
      confirm: 'ยืนยัน', cancel: 'ยกเลิก',
      restart_q: 'รีสตาร์ทเกม?', restart_q_text: 'ความคืบหน้าจะถูกรีเซ็ตกลับไปเริ่มที่เลเวล 1',
      reset_all: 'ล้างความคืบหน้าทั้งหมด', reset_q: 'ล้างความคืบหน้า?', reset_q_text: 'ข้อมูลเลเวลและคำท้าทั้งหมดจะถูกลบ',
      st_level: 'เลเวลปัจจุบัน', st_solved: 'ด่านที่ผ่าน', st_daily: 'คำท้าที่ผ่าน',
      month_done: 'ทำคำท้าสำเร็จเดือนนี้ {n} วัน',
      prev_month: 'เดือนก่อนหน้า', next_month: 'เดือนถัดไป', lives: 'ชีวิต', arrows_left: 'ลูกศรที่เหลือ',
      diff_easy: 'ง่าย', diff_medium: 'ปานกลาง', diff_hard: 'ยาก', diff_expert: 'ยากมาก', diff_daily: 'ท้าทาย',
      months: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
      weekdays: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'],
      date_fmt: '{d} {month}', month_fmt: '{month} {y}'
    }
  };

  var lang = 'en';

  function t(key, p) {
    var v = (D[lang] && D[lang][key] !== undefined) ? D[lang][key] : D.en[key];
    if (v === undefined) return key;
    if (typeof v !== 'string' || !p) return v;
    return v.replace(/\{(\w+)\}/g, function (m, k) { return p[k] !== undefined ? p[k] : m; });
  }

  function apply(root) {
    root = root || document;
    var i, el, a = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < a.length; i++) { el = a[i]; el.textContent = t(el.getAttribute('data-i18n')); }
    a = root.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < a.length; i++) { el = a[i]; el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); }
    document.documentElement.lang = lang;
  }

  AP.I18n = {
    LANGS: LANGS, t: t, apply: apply,
    get lang() { return lang; },
    setLang: function (l) { if (D[l]) { lang = l; } return lang; },
    /* "{month} {d}" date for a YYYY-MM-DD key */
    date: function (key) {
      var p = key.split('-');
      return t('date_fmt', { month: D[lang].months[+p[1] - 1], d: +p[2] });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
