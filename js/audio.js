/* Arrow Puzzle — audio.js : tiny WebAudio synth (no asset files). Safe if WebAudio is missing. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};
  var ctx = null, enabled = true, musicOn = false, mTimer = 0, mStep = 0, mNext = 0, mGain = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') try { ctx.resume(); } catch (e) {} return ctx; }
    var C = G.AudioContext || G.webkitAudioContext;
    if (!C) return null;
    try { ctx = new C(); } catch (e) { ctx = null; }
    return ctx;
  }
  function tone(freq, t0, dur, type, vol, slideTo) {
    var c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }


  /* procedural background loop: a soft pentatonic arpeggio, scheduled a little ahead of time */
  var SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
  var PATTERN = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 7, 5, 4, 2, 3];
  function musicTick() {
    if (!ctx || !musicOn || !enabled) return;
    var step = 0.42;
    if (mNext < ctx.currentTime) mNext = ctx.currentTime + 0.05;
    while (mNext < ctx.currentTime + 0.6) {
      var n = PATTERN[mStep % PATTERN.length];
      var c = ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = SCALE[n];
      g.gain.setValueAtTime(0.0001, mNext);
      g.gain.exponentialRampToValueAtTime(0.035, mNext + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, mNext + step * 1.8);
      o.connect(g); g.connect(c.destination); o.start(mNext); o.stop(mNext + step * 1.9);
      if (mStep % 8 === 0) { var b = c.createOscillator(), bg = c.createGain(); b.type = 'triangle'; b.frequency.value = SCALE[0] / 2;
        bg.gain.setValueAtTime(0.0001, mNext); bg.gain.exponentialRampToValueAtTime(0.04, mNext + 0.06); bg.gain.exponentialRampToValueAtTime(0.0001, mNext + step * 7);
        b.connect(bg); bg.connect(c.destination); b.start(mNext); b.stop(mNext + step * 7.2); }
      mNext += step; mStep++;
    }
  }
  function musicSync() {
    clearInterval(mTimer); mTimer = 0;
    if (musicOn && enabled && ensure()) { mNext = 0; mTimer = setInterval(musicTick, 200); musicTick(); }
  }

  AP.Audio = {
    unlock: function () { ensure(); },
    setEnabled: function (v) { enabled = !!v; musicSync(); },
    setMusic: function (v) { musicOn = !!v; musicSync(); },
    play: function (name) {
      if (!enabled || !ensure()) return;
      var t = ctx.currentTime;
      try {
        if (name === 'go') { tone(520, t, 0.16, 'triangle', 0.16, 1100); }
        else if (name === 'err') { tone(170, t, 0.22, 'square', 0.1, 95); }
        else if (name === 'hint') { tone(880, t, 0.1, 'sine', 0.12); tone(1320, t + 0.08, 0.16, 'sine', 0.1); }
        else if (name === 'tap') { tone(600, t, 0.05, 'sine', 0.08); }
        else if (name === 'win') { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, t + i * 0.11, 0.3, 'triangle', 0.16); }); }
        else if (name === 'lose') { tone(330, t, 0.25, 'sawtooth', 0.09, 160); tone(220, t + 0.22, 0.35, 'sawtooth', 0.09, 110); }
      } catch (e) {}
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
