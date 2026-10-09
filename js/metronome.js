// Synthesize and insert a click track aligned to the selected music.
(function (global) {
  "use strict";
  var RATE = 44100;
  function render(events, duration) {
    if (!(duration > 0) || !isFinite(duration) || duration > 1800) {
      throw new Error("metronome.durationLimit");
    }
    var frames = Math.ceil(duration * RATE);
    var bytes = new Uint8Array(44 + frames * 2);
    var view = new DataView(bytes.buffer);
    function str(at, text) {
      for (var j = 0; j < text.length; j++) { view.setUint8(at + j, text.charCodeAt(j)); }
    }
    str(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); str(8, "WAVE"); str(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, "data"); view.setUint32(40, frames * 2, true);
    var count = 0;
    for (var e = 0; e < events.length; e++) {
      var time = events[e].t;
      if (typeof time !== "number" || !isFinite(time) || time < 0 || time >= duration) { continue; }
      var start = Math.round(time * RATE);
      if (start >= frames) { continue; }
      var accent = events[e].label === "D";
      var frequency = accent ? 2000 : 1500;
      var amplitude = accent ? 0.8 : 0.55;
      for (var n = 0; n < Math.round(0.025 * RATE) && start + n < frames; n++) {
        var t = n / RATE;
        var click = Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t * 300) * amplitude;
        var offset = 44 + (start + n) * 2;
        var value = view.getInt16(offset, true) + Math.round(click * 32767);
        view.setInt16(offset, Math.max(-32768, Math.min(32767, value)), true);
      }
      count++;
    }
    if (!count) { throw new Error("metronome.noBeats"); }
    return { bytes: bytes, count: count, duration: frames / RATE };
  }
  function create(ctx) {
    var button = document.getElementById("metronomeBtn");
    var status = document.getElementById("metronomeStatus");
    button.addEventListener("click", function () {
      var analysis = ctx.analysis();
      if (!analysis || !analysis.beatsArray || !analysis.beatsArray.length) {
        ctx.setText(status, "metronome.analyzeFirst"); return;
      }
      button.disabled = true;
      ctx.showBusy("busy.default");
      var reference, savedPath;
      ctx.getClipInfo().then(function (clip) {
        if (clip.mediaPath !== analysis.audioPath || analysis !== ctx.analysis()) {
          throw new Error("metronome.selectionChanged");
        }
        reference = clip;
        return ctx.evalJson("getProjectFilePath()");
      }).then(function (project) {
        if (analysis !== ctx.analysis()) { throw new Error("metronome.selectionChanged"); }
        var cuesheet = ctx.cuesheet(analysis.phase, "detailed", reference);
        var mapped = global.BeatMarkerCuesheet.mapEventsToSequenceSeconds(cuesheet, reference, "downbeats");
        var events = mapped.times.map(function (t, i) { return { t: t - reference.clipStartSeconds, label: mapped.labels[i] }; });
        var duration = (reference.outPointSeconds - reference.inPointSeconds) / (reference.speed || 1);
        var rendered = render(events, duration);
        var fs = window.cep_node.require("fs"), path = window.cep_node.require("path");
        var folder = global.BeatMarkerAudioOutput.directory(ctx.settings(), project.path,
          global.BeatMarkerPersistence.getDataDir(ctx.csInterface), path);
        savedPath = global.BeatMarkerAudioOutput.save(rendered.bytes, folder, reference.mediaPath, fs, path);
        return ctx.evalJson("insertMetronomeTrack(" + ctx.jsxJsonArg(savedPath) + ", " + rendered.duration + ", " + ctx.jsxJsonArg(reference) + ")");
      }).then(function (placed) {
        if (placed.trimFailed || placed.speedFailed) { throw new Error("metronome.insertFailed"); }
        ctx.setText(status, "metronome.done", { where: placed.where });
        ctx.log("Metronome: saved " + savedPath + " and placed at " + reference.clipStartSeconds.toFixed(3) + " s on " + placed.where + ".");
      }).catch(function (err) {
        var message = err && err.message ? err.message : String(err);
        if (/^(metronome|output)\./.test(message)) { message = ctx.I18n.t(message); }
        ctx.setText(status, savedPath ? "metronome.savedNotPlaced" : "metronome.failed", { error: message, path: savedPath || "" });
        ctx.log("Metronome: " + message + (savedPath ? "; file kept at " + savedPath : ""));
      }).then(function () { button.disabled = false; ctx.hideBusy(); });
    });
  }
  global.BeatMarkerMetronome = { create: create, render: render };
})(window);
