/* Arrow Puzzle — audio.js : tiny WebAudio synth (no asset files). Safe if WebAudio is missing. */
(function (G) {
  'use strict';
  var AP = G.AP = G.AP || {};
  var ctx = null, enabled = true;

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

  AP.Audio = {
    unlock: function () { ensure(); },
    setEnabled: function (v) { enabled = !!v; },
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
