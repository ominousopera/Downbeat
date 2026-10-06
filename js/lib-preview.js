// LIBRARY PREVIEW PANE: waveform, play / loop / volume, time, Pitch
// (sampler-style) with Reset, Reverse, and Add - which inserts the file
// itself, with the pitch and Reverse set on the clip (no copy is ever made).
// Pitch is sampler-style: +12 semitones plays twice as fast and an octave up,
// like a sampler or tape - the length changes with it. The host gives the
// clip the same speed, so what is heard is what is inserted.
(function (global) {
  "use strict";

  var PITCH_LIMIT = 12;
  // ---------- Pure helpers ----------
  function semitoneRate(semitones) {
    return Math.pow(2, semitones / 12);
  }
  // Min / max per column, over all channels, for drawing `width` columns.
  function peaks(channels, width) {
    var length = channels.length ? channels[0].length : 0;
    var min = new Float32Array(width);
    var max = new Float32Array(width);
    if (!length || width <= 0) {
      return { min: min, max: max };
    }
    for (var x = 0; x < width; x++) {
      var from = Math.floor(x * length / width);
      var to = Math.max(from + 1, Math.floor((x + 1) * length / width));
      var lo = 0, hi = 0;
      for (var c = 0; c < channels.length; c++) {
        var data = channels[c];
        for (var i = from; i < to && i < length; i++) {
          var v = data[i];
          if (v < lo) { lo = v; }
          if (v > hi) { hi = v; }
        }
      }
      min[x] = lo;
      max[x] = hi;
    }
    return { min: min, max: max };
  }

  function reverseChannels(channels) {
    return channels.map(function (data) {
      var out = new Float32Array(data.length);
      for (var i = 0, n = data.length; i < n; i++) {
        out[i] = data[n - 1 - i];
      }
      return out;
    });
  }
  // Fade gain. x in 0..1 through the fade; `curve` -100..100 like the fade
  // handle on a clip in Premiere's timeline: 0 is equal power - sin rising,
  // cos falling, Premiere's Constant Power and its default fade; up to +100
  // the sound stays louder longer (a fade out that drops sharply at its end);
  // down to -100 it stays quieter (a slow start, a long tail). Shape: the
  // equal-power curve to the power 2^(-curve/50) - +100: ^0.25, -100: ^4.
  // Exactly 0 at the quiet end.
  function fadeGain(x, rising, curve) {
    x = Math.max(0, Math.min(1, x));
    if (x === (rising ? 0 : 1)) {
      return 0; // exactly silent at the fade's quiet end (cos(pi/2) is 6e-17)
    }
    var base = rising ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
    return curve ? Math.pow(base, Math.pow(2, -curve / 50)) : base;
  }
  function clampCurve(curve) {
    return Math.max(-100, Math.min(100, Math.round(curve || 0)));
  }
  // The Premiere transition whose shape is closest - the only fades a script
  // can put on a clip that stay editable there.
  function transitionFor(curve) {
    curve = clampCurve(curve);
    if (curve <= -60) { return "Exponential Fade"; }
    if (curve <= -20) { return "Constant Gain"; }
    return "Constant Power";
  }
  function fadeCurve(fromX, toX, rising, points, curve) {
    points = points || 64;
    var c = new Float32Array(points);
    for (var k = 0; k < points; k++) {
      c[k] = fadeGain(fromX + (toX - fromX) * k / (points - 1), rising, curve);
    }
    return c;
  }
  // 0:03.25 under a minute, 1:05 above.
  function formatTime(sec) {
    if (!(sec >= 0)) { sec = 0; }
    var centis = Math.round(sec * 100); // whole hundredths first: 1.4 must not read 1.39
    if (centis < 6000) {
      var whole = Math.floor(centis / 100);
      var cs = centis % 100;
      return "0:" + (whole < 10 ? "0" : "") + whole + "." + (cs < 10 ? "0" : "") + cs;
    }
    var total = Math.floor(centis / 100);
    var m = Math.floor(total / 60), si = total % 60;
    return m + ":" + (si < 10 ? "0" : "") + si;
  }

  function clampPitch(semitones) {
    return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.round(semitones)));
  }
  // ---------- Player ----------
  // One real-time AudioContext for the pane, created on first use. `buffer`
  // is an AudioBuffer of the loaded file; a reversed copy is made only when
  // Reverse is first switched on for it.
  // Everything below counts in the HEARD direction of the active (maybe
  // reversed) buffer, in its seconds: the selected part (region a..b) and the
  // fades (seconds of sound, before the pitch's speed).
  function createPlayer() {
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (typeof Ctx !== "function") {
      return null;
    }
    var ctx = null;
    var gain = null;
    var state = {
      buffer: null, reversed: null, semitones: 0, reverse: false, loop: false, volume: 0.8,
      region: null, fadeIn: 0, fadeOut: 0, curveIn: 0, curveOut: 0,
      playing: false, source: null, env: null, startedAt: 0, startOffset: 0, offset: 0, onEnded: null
    };
    function ensure() {
      if (!ctx) {
        ctx = new Ctx();
        gain = ctx.createGain();
        gain.gain.value = state.volume;
        gain.connect(ctx.destination);
      }
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        ctx.resume();
      }
      return ctx;
    }
    function activeBuffer() {
      if (!state.buffer) { return null; }
      if (!state.reverse) { return state.buffer; }
      if (!state.reversed) {
        var b = state.buffer;
        var chans = [];
        for (var c = 0; c < b.numberOfChannels; c++) { chans.push(b.getChannelData(c)); }
        var rev = reverseChannels(chans);
        var rb = ensure().createBuffer(b.numberOfChannels, b.length, b.sampleRate);
        rev.forEach(function (d, c) { rb.copyToChannel(d, c); });
        state.reversed = rb;
      }
      return state.reversed;
    }
    function duration() { return state.buffer ? state.buffer.duration : 0; }
    function segment() {
      return state.region ? { a: state.region.a, b: state.region.b } : { a: 0, b: duration() };
    }
    function fadesOn() { return state.fadeIn > 0 || state.fadeOut > 0; }
    function nativeLoop() { return state.loop && !fadesOn(); }
    function rate() { return semitoneRate(state.semitones); }
    function position() {
      if (!state.buffer) { return 0; }
      if (!state.playing) { return state.offset; }
      var seg = segment();
      var pos = state.startOffset + (ctx.currentTime - state.startedAt) * rate();
      if (nativeLoop() && pos >= seg.b) {
        pos = seg.a + ((pos - seg.a) % Math.max(1e-6, seg.b - seg.a));
      }
      return Math.min(pos, seg.b);
    }
    function stopSource() {
      if (state.source) {
        state.source.onended = null;
        try { state.source.stop(); } catch (e) { /* already stopped */ }
        state.source.disconnect();
        state.source = null;
      }
      if (state.env) {
        state.env.disconnect();
        state.env = null;
      }
    }
    function scheduleEnvelope(env, pos, seg, t0) {
      var g = env.gain, fi = state.fadeIn, fo = state.fadeOut, r = rate();
      var inEnd = seg.a + fi, outStart = seg.b - fo;
      try {
        if (fo > 0 && pos >= outStart) {
          g.setValueCurveAtTime(fadeCurve((pos - outStart) / fo, 1, false, 64, state.curveOut), t0, Math.max(0.001, (seg.b - pos) / r));
          return;
        }
        var t = t0;
        if (fi > 0 && pos < inEnd) {
          var dIn = Math.max(0.001, (inEnd - pos) / r);
          g.setValueCurveAtTime(fadeCurve((pos - seg.a) / fi, 1, true, 64, state.curveIn), t0, dIn);
          t = t0 + dIn;
        } else {
          g.setValueAtTime(1, t0);
        }
        if (fo > 0) {
          var tOut = Math.max(t, t0 + (outStart - pos) / r) + 0.0001;
          g.setValueCurveAtTime(fadeCurve(0, 1, false, 64, state.curveOut), tOut, Math.max(0.001, fo / r));
        }
      } catch (e) {
        g.value = 1; // a browser that refuses the curve still plays, unfaded
      }
    }
    function startAt(pos) {
      var b = activeBuffer();
      if (!b) { return; }
      ensure();
      stopSource();
      var seg = segment();
      if (!(pos >= seg.a) || pos >= seg.b - 0.0005) { pos = seg.a; }
      var src = ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = rate();
      var env = ctx.createGain();
      src.connect(env);
      env.connect(gain);
      if (nativeLoop()) {
        src.loop = true;
        src.loopStart = seg.a;
        src.loopEnd = seg.b;
        src.start(0, pos);
      } else {
        src.start(0, pos, seg.b - pos);
      }
      if (fadesOn()) {
        scheduleEnvelope(env, pos, seg, ctx.currentTime);
      }
      src.onended = function () {
        if (state.source !== src) { return; }
        state.source = null;
        if (state.loop && !nativeLoop()) {
          startAt(segment().a); // a loop with fades starts over, fading in again
          return;
        }
        state.playing = false;
        state.offset = segment().a;
        if (state.onEnded) { state.onEnded(); }
      };
      state.source = src;
      state.env = env;
      state.startOffset = pos;
      state.offset = pos;
      state.startedAt = ctx.currentTime;
      state.playing = true;
    }
    function restartIfPlaying() {
      if (state.playing) { startAt(position()); }
    }
    function clampFades() {
      var seg = segment(), len = Math.max(0, seg.b - seg.a);
      state.fadeIn = Math.max(0, Math.min(state.fadeIn, len));
      state.fadeOut = Math.max(0, Math.min(state.fadeOut, len - state.fadeIn));
    }
    return {
      createBuffer: function (channels, sampleRate) {
        var b = ensure().createBuffer(channels.length, channels[0].length, sampleRate);
        channels.forEach(function (d, c) { b.copyToChannel(d, c); });
        return b;
      },
      load: function (buffer) {
        stopSource();
        state.buffer = buffer;
        state.reversed = null;
        state.playing = false;
        state.offset = 0;
        state.region = null;
        state.fadeIn = 0;
        state.fadeOut = 0;
        state.curveIn = 0;
        state.curveOut = 0;
      },
      play: function () { if (!state.playing) { startAt(state.offset); } },
      pause: function () {
        if (!state.playing) { return; }
        state.offset = position();
        stopSource();
        state.playing = false;
      },
      stop: function () { stopSource(); state.playing = false; state.offset = segment().a; },
      seek: function (fraction) {
        if (!state.buffer) { return; }
        var to = Math.max(0, Math.min(1, fraction)) * duration();
        if (state.playing) { startAt(to); } else { state.offset = to; }
      },
      setPitch: function (semitones) {
        var pos = position();
        state.semitones = clampPitch(semitones);
        if (state.playing) { startAt(pos); }
      },
      setReverse: function (on) {
        if (!!on === state.reverse) {
          return; // no change: nothing must be mirrored
        }
        var D = duration();
        var pos = position();
        state.reverse = !!on;
        // The same part of the sound stays selected; the fades stay at the
        // heard start and end.
        if (state.region) {
          state.region = { a: D - state.region.b, b: D - state.region.a };
        }
        var mirrored = Math.max(0, D - pos);
        if (state.playing) { startAt(mirrored); } else { state.offset = mirrored; }
      },
      setLoop: function (on) {
        state.loop = !!on;
        restartIfPlaying();
      },
      setVolume: function (v) {
        state.volume = v;
        if (gain) { gain.gain.value = v; }
      },
      // The selected part, seconds of the heard direction; null = the whole
      // file.
      setRegion: function (a, b) {
        var D = duration();
        if (a == null || b == null || !(b - a >= 0.02)) {
          state.region = null;
        } else {
          state.region = { a: Math.max(0, Math.min(a, D)), b: Math.max(0, Math.min(b, D)) };
        }
        clampFades();
        if (state.playing) {
          var seg = segment();
          var pos = position();
          startAt(pos >= seg.a && pos < seg.b ? pos : seg.a);
        } else if (state.region && (state.offset < state.region.a || state.offset >= state.region.b)) {
          state.offset = state.region.a;
        }
      },
      // Lengths in seconds of sound; curves -100..100 (left as they are when
      // not given).
      setFades: function (fadeIn, fadeOut, curveIn, curveOut) {
        state.fadeIn = Math.max(0, fadeIn || 0);
        state.fadeOut = Math.max(0, fadeOut || 0);
        if (curveIn != null) { state.curveIn = clampCurve(curveIn); }
        if (curveOut != null) { state.curveOut = clampCurve(curveOut); }
        clampFades();
        restartIfPlaying();
      },
      region: function () { return state.region ? { a: state.region.a, b: state.region.b } : null; },
      fades: function () { return { fadeIn: state.fadeIn, fadeOut: state.fadeOut, curveIn: state.curveIn, curveOut: state.curveOut }; },
      segment: segment,
      duration: duration,
      onEnded: function (fn) { state.onEnded = fn; },
      isPlaying: function () { return state.playing; },
      hasBuffer: function () { return !!state.buffer; },
      // 0..1 of the whole (active) buffer, and the times as heard.
      progress: function () {
        var D = duration();
        if (!D) { return { fraction: 0, nowSec: 0, totalSec: 0 }; }
        var r = rate();
        var pos = position();
        return { fraction: pos / D, nowSec: pos / r, totalSec: D / r };
      },
      // Gain 0..1 at a heard time t (seconds of sound): 0 outside the part.
      gainAt: function (t) {
        var seg = segment();
        if (t < seg.a || t > seg.b) { return 0; }
        var g = 1;
        if (state.fadeIn > 0 && t < seg.a + state.fadeIn) { g = Math.min(g, fadeGain((t - seg.a) / state.fadeIn, true, state.curveIn)); }
        if (state.fadeOut > 0 && t > seg.b - state.fadeOut) { g = Math.min(g, fadeGain((t - (seg.b - state.fadeOut)) / state.fadeOut, false, state.curveOut)); }
        return g;
      },
      channels: function () {
        var b = state.buffer;
        if (!b) { return []; }
        var out = [];
        for (var c = 0; c < b.numberOfChannels; c++) { out.push(b.getChannelData(c)); }
        return out;
      },
      sampleRate: function () { return state.buffer ? state.buffer.sampleRate : 0; },
      settings: function () { return { semitones: state.semitones, reverse: state.reverse }; }
    };
  }

  global.BeatMarkerLibPreview = {
    PITCH_LIMIT: PITCH_LIMIT,
    semitoneRate: semitoneRate,
    peaks: peaks,
    reverseChannels: reverseChannels,
    fadeGain: fadeGain,
    clampCurve: clampCurve,
    transitionFor: transitionFor,
    fadeCurve: fadeCurve,
    formatTime: formatTime,
    clampPitch: clampPitch,
    createPlayer: createPlayer
  };
})(typeof window !== "undefined" ? window : global);
