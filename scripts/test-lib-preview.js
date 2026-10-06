"use strict";
// The Library's preview pane: js/lib-preview.js and its wiring in
// js/library-tab.js. Part A: pure helpers in plain Node (semitone rate, fade
// curves, closest Premiere transition, times, peaks). Part B: the panel with
// stand-ins for Web Audio and the host (needs ffmpeg).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
// ---------- A. helpers ----------
require(path.join(ROOT, "js", "lib-preview.js"));
const LP = global.BeatMarkerLibPreview;

check("+12 semitones is twice the speed, -12 half", LP.semitoneRate(12) === 2 && LP.semitoneRate(-12) === 0.5);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-libpreview-"));
check("times: hundredths under a minute, m:ss above", LP.formatTime(3.25) === "0:03.25" && LP.formatTime(65.4) === "1:05" && LP.formatTime(0) === "0:00.00");
const pk = LP.peaks([new Float32Array([0, 1, -1, 0.5])], 2);
check("peaks: min and max per column over the channels", pk.max[0] === 1 && pk.min[0] === 0 && pk.min[1] === -1 && pk.max[1] === 0.5);
check("fade curve 0 is equal power (Constant Power): 0.707 halfway", Math.abs(LP.fadeGain(0.5, false, 0) - Math.SQRT1_2) < 1e-9);
check("curve +100 holds the sound, then drops sharply; -100 fades early and long",
  LP.fadeGain(0.5, false, 100) > 0.9 && LP.fadeGain(0.9, false, 100) > 0.6 && LP.fadeGain(0.5, false, -100) < 0.3 && LP.fadeGain(1, false, 100) === 0,
  LP.fadeGain(0.5, false, 100).toFixed(3) + " / " + LP.fadeGain(0.5, false, -100).toFixed(3));
check("the closest Premiere transition for a curve", LP.transitionFor(0) === "Constant Power" && LP.transitionFor(-40) === "Constant Gain" && LP.transitionFor(-80) === "Exponential Fade" && LP.transitionFor(90) === "Constant Power");
check("pitch stays within ±12", LP.clampPitch(20) === 12 && LP.clampPitch(-30) === -12 && LP.clampPitch(2.4) === 2);
// ---------- B. the panel ----------
function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; }
}
if (!hasFfmpeg()) {
  console.log("skip part B - needs ffmpeg");
  finish();
}
const reader = require(path.join(ROOT, "worker", "wav-excerpt.js"));
// Compressed files: the stored sample rate is read from the header so the
// file is decoded at that rate.
{
  const rates = [["mp3", 48000, ["-metadata", "title=x"]], ["mp3", 22050, []], ["flac", 96000, []], ["opus", 48000, ["-c:a", "libopus"]],
    ["m4a", 96000, ["-c:a", "aac"]], ["m4a", 48000, ["-c:a", "aac", "-movflags", "+faststart"]], ["aac", 22050, ["-c:a", "aac", "-f", "adts"]]];
  const got = [];
  rates.forEach(function (r, i) {
    const f = path.join(tmp, "rate" + i + "." + r[0]);
    try {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ar", String(r[1])].concat(r[2]).concat([f]));
      got.push(r[0] + " " + r[1] + " -> " + reader.nativeRate(f) + (reader.nativeRate(f) === r[1] ? "" : " WRONG"));
    } catch (e) { got.push(r[0] + " skipped (" + e.message.split("\n")[0].slice(0, 40) + ")"); }
  });
  check("a compressed file's own rate is read from its header (MP3 with ID3, FLAC, Opus, M4A moov first and last, ADTS AAC)",
    !got.some(function (g) { return /WRONG/.test(g); }), got.join(", "));
}
function Param(v) { this.value = v; this.events = []; }
Param.prototype.setValueAtTime = function (v, t) { this.events.push(["set", v, t]); };
Param.prototype.setValueCurveAtTime = function (c, t, d) { this.events.push(["curve", c[0], c[c.length - 1], t, d]); };
Param.prototype.cancelScheduledValues = function () { this.events = []; };
function FakeBuffer(ch, len, rate) {
  this.numberOfChannels = ch; this.length = len; this.sampleRate = rate; this.duration = len / rate;
  this._d = []; for (let c = 0; c < ch; c++) { this._d.push(new Float32Array(len)); }
}
FakeBuffer.prototype.getChannelData = function (c) { return this._d[c]; };
FakeBuffer.prototype.copyToChannel = function (d, c) { this._d[c].set(d); };
const sources = [];
function FakeSource() { this.playbackRate = new Param(1); this.loop = false; this.onended = null; sources.push(this); }
FakeSource.prototype.connect = function () {};
FakeSource.prototype.disconnect = function () {};
FakeSource.prototype.start = function (when, offset, duration) { this.started = true; this.offset = offset; this.duration = duration; };
FakeSource.prototype.stop = function () { this.stopped = true; };
global.AudioContext = function () { this.currentTime = 0; this.state = "running"; this.destination = {}; };
global.AudioContext.prototype.createGain = function () { return { gain: new Param(1), connect: function () {}, disconnect: function () {} }; };
global.AudioContext.prototype.createBuffer = function (ch, len, rate) { return new FakeBuffer(ch, len, rate); };
global.AudioContext.prototype.createBufferSource = function () { return new FakeSource(); };

const DOCS = path.join(tmp, "docs");
// Cyrillic and an accent in the folder name (written as escapes, the source
// stays ASCII): the path must reach the host unchanged.
const SFX = path.join(tmp, "My SFX \u0417\u0432\u0443\u043a\u0438 m\u00fasica");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.mkdirSync(SFX);
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ac", "2", "-ar", "48000", path.join(SFX, "tone_Am.wav")]);
fs.writeFileSync(path.join(SFX, "broken.wav"), "RIFF....not really a wave file");
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, librarySection: "sfx" }));

const mocks = require("./host-mocks.js");
const fake = mocks.makePremiereHost({ mediaPath: path.join(SFX, "tone_Am.wav"), durationSec: 2, clipStart: 4, audioTrackCount: 8, playheadSeconds: 12, insertDurationSec: 2 });
let nextFolder = null;
fake.context.Folder = { selectDialog: function () { return nextFolder ? { fsName: nextFolder } : null; }, desktop: { fsName: tmp } };
const host = mocks.loadHost(fake.context);
const inserts = [];
function evalScript(script, callback) {
  const m = script.match(/^insertAudioAtPlayhead\(("(?:[^"\\]|\\.)*"), ([\d.]+)(?:, ("(?:[^"\\]|\\.)*"))?\)/);
  if (m) { inserts.push({ path: JSON.parse(JSON.parse(m[1])), duration: +m[2], opts: m[3] ? JSON.parse(JSON.parse(m[3])) : null }); }
  return host.evalScript(script, callback);
}
const { bootPanel } = require("./panel-harness.js");
const panel = bootPanel({ docsDir: DOCS, evalScript: evalScript, realTimeouts: true, realIntervals: false });
const $ = panel.registry;
function rows() { return $.libraryDisplay.children.filter(function (c) { return /lib-row/.test(c.className || ""); }); }
function waitFor(cond, label, ms) {
  const t0 = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (cond()) { return resolve(); }
      if (Date.now() - t0 > (ms || 10000)) { return reject(new Error(label + " did not happen in time")); }
      setTimeout(poll, 30);
    })();
  });
}
function lastSource() { return sources[sources.length - 1]; }

check("the pane is hidden until a file is chosen", $.libPane.hidden);
if ($.libSectionSfxBtn) { $.libSectionSfxBtn._fire("click"); }
nextFolder = SFX;
$.libAddFolderBtn._fire("click");
waitFor(function () { return rows().length === 2; }, "listing the SFX folder")
  .then(function () {
    // Start scan: tone_Am.wav gets its key from its name (A minor).
    $.libRescanBtn._fire("click");
    return waitFor(function () { return $.libScanOverlay.hidden && /Done|Everything/.test($.libScanStatus.textContent); }, "the SFX scan", 120000);
  })
  .then(function () {
    const toneRow = rows().find(function (x) { return /tone/.test(x.textContent); });
    toneRow._fire("click");
    return waitFor(function () { return !$.libPane.hidden && /\//.test($.libPaneTime.textContent) && $.libPaneTime.textContent !== "…"; }, "loading tone_Am.wav into the pane");
  })
  .then(function () {
    check("choosing a row shows it in the pane: name and length", $.libPaneName.textContent === "tone_Am.wav" && /0:00\.00 \/ 0:02\.00/.test($.libPaneTime.textContent),
      $.libPaneName.textContent + " " + $.libPaneTime.textContent);
    $.libPanePlayBtn._fire("click");
    check("▶ plays it through the pane, stereo at its own rate", lastSource() && lastSource().started && lastSource().buffer.numberOfChannels === 2 &&
      lastSource().buffer.sampleRate === 48000 && $.libPanePlayBtn.textContent === "‖");
    $.libPanePitchUp._fire("click");
    $.libPanePitchUp._fire("click");
    check("Pitch + twice: +2 shown, played 2 semitones faster", $.libPanePitchValue.textContent === "+2" &&
      Math.abs(lastSource().playbackRate.value - Math.pow(2, 2 / 12)) < 1e-9 && !$.libPanePitchReset.hidden);
    check("with a pitch, the line under it says what the key becomes (A minor +2 = B minor)",
      !$.libPaneKey.hidden && /8A A minor → 10A B minor/.test($.libPaneKey.textContent), $.libPaneKey.textContent);
    const forward = lastSource().buffer;
    $.libPaneReverse.checked = true;
    $.libPaneReverse._fire("change");
    const rev = lastSource().buffer;
    check("Reverse plays the reversed sound", rev !== forward && rev.getChannelData(0)[0] === forward.getChannelData(0)[forward.length - 1]);
    $.libPaneLoop.checked = true;
    $.libPaneLoop._fire("change");
    check("Loop loops the sound that plays", lastSource().loop === true);
    $.libPaneAddBtn._fire("click");
    return waitFor(function () { return inserts.length === 1; }, "Add with pitch and reverse");
  })
  .then(function () {
    const o0 = inserts[0].opts || {};
    const rate2 = Math.pow(2, 2 / 12);
    check("Add with a pitch and Reverse inserts the ORIGINAL file, with the speed and reverse for the host - no copy",
      inserts[0].path === path.join(SFX, "tone_Am.wav") && Math.abs(o0.speed - rate2) < 1e-9 && o0.reverse === true &&
      o0.inSec === undefined && o0.outSec === undefined && !fs.existsSync(path.join(DOCS, "Downbeat", "Processed")),
      JSON.stringify(inserts[0]));
    $.libPanePitchReset._fire("click");
    $.libPaneReverse.checked = false;
    $.libPaneReverse._fire("change");
    $.libPaneAddBtn._fire("click");
    return waitFor(function () { return inserts.length === 2; }, "Add without processing");
  })
  .then(function () {
    check("at pitch 0 the key line is gone", $.libPaneKey.hidden);
    check("Add with no pitch or reverse inserts the original file", inserts[1].path === path.join(SFX, "tone_Am.wav") && $.libPanePitchValue.textContent === "0" && $.libPanePitchReset.hidden,
      inserts[1].path);
    $.libPaneWave.getBoundingClientRect = function () { return { left: 0, top: 0, width: 300, height: 44, right: 300, bottom: 44 }; };
    const mouse = function (type, x, y) {
      const e = { clientX: x, clientY: y, target: $.libPaneWave, preventDefault: function () {} };
      if (type === "mousedown") { $.libPaneWave._fire(type, e); } else { document._fire(type, e); }
    };
    mouse("mousedown", 60, 30); mouse("mousemove", 150, 30); mouse("mousemove", 210, 30); mouse("mouseup", 210, 30);
    check("dragging on the waveform selects a part, shown under it", !$.libPaneSel.hidden && /0:00\.40 – 0:01\.40 \(1\.00 s\)/.test($.libPaneSelText.textContent),
      $.libPaneSelText.textContent);
    // The handles sit at the part's edges (60 and 210 px); 30 px is 0.2 s.
    mouse("mousedown", 60, 3); mouse("mousemove", 90, 3); mouse("mouseup", 90, 3);
    mouse("mousedown", 210, 3); mouse("mousemove", 180, 3); mouse("mouseup", 180, 3);
    check("dragging the fade handles at the top sets the fades", /fade in 0\.20 s \(0\) · fade out 0\.20 s \(0\)/.test($.libPaneSelText.textContent), $.libPaneSelText.textContent);
    // Like the handle on a clip in Premiere: up / down bends the curve.
    mouse("mousedown", 180, 3); mouse("mousemove", 180, -21); mouse("mouseup", 180, -21);
    check("dragging a fade handle up bends its curve (+60: the sound holds, then drops), and the line says what Premiere gets",
      /fade out 0\.20 s \(\+60\)/.test($.libPaneSelText.textContent) && /Premiere: Constant Power/.test($.libPaneSelText.textContent), $.libPaneSelText.textContent);
    $.libPanePlayBtn._fire("click");
    const src = lastSource();
    const curves = src && $.libPanePlayBtn.textContent === "‖" ? true : false;
    check("▶ plays just the part, from its start, for its length", src.offset === 0.4 && Math.abs(src.duration - 1.0) < 1e-9 && curves, src.offset + " + " + src.duration);
    $.libPanePlayBtn._fire("click");
    $.libPaneAddBtn._fire("click");
    return waitFor(function () { return inserts.length === 3; }, "Add with a part and fades");
  })
  .then(function () {
    const o = inserts[2].opts || {};
    check("Add with a part and fades (no pitch, no Reverse) inserts the ORIGINAL, trimmed, with editable fades - no copy",
      inserts[2].path === path.join(SFX, "tone_Am.wav") && Math.abs(o.inSec - 0.4) < 1e-9 && Math.abs(o.outSec - 1.4) < 1e-9 &&
      Math.abs(o.fadeInSec - 0.2) < 1e-9 && Math.abs(o.fadeOutSec - 0.2) < 1e-9 && o.curveOut === 60 && o.transitionIn === "Constant Power" &&
      JSON.stringify(o));
    // With a pitch: still the original; the fades are timeline seconds.
    $.libPanePitchUp._fire("click");
    $.libPaneAddBtn._fire("click");
    return waitFor(function () { return inserts.length === 4; }, "Add with a part, fades and a pitch");
  })
  .then(function () {
    const o3 = inserts[3].opts || {};
    const rate1 = Math.pow(2, 1 / 12);
    check("with a pitch: the original, the same part, speed 2^(1/12), fades shortened by the speed (timeline seconds), no copy",
      inserts[3].path === path.join(SFX, "tone_Am.wav") && Math.abs(o3.inSec - 0.4) < 1e-9 && Math.abs(o3.outSec - 1.4) < 1e-9 &&
      Math.abs(o3.speed - rate1) < 1e-9 && !o3.reverse && Math.abs(o3.fadeInSec - 0.2 / rate1) < 1e-9 && Math.abs(o3.fadeOutSec - 0.2 / rate1) < 1e-9 &&
      o3.curveOut === 60, JSON.stringify(o3));
    $.libPanePitchReset._fire("click");
    $.libPaneSelClear._fire("click");
    check("Clear goes back to the whole file without fades", $.libPaneSel.hidden);
    // In key: every previewed sound pitched into the music clip's key. With
    // no clip key known yet it only explains.
    $.libPaneInKeyBtn._fire("click");
    check("In key with no clip key yet says what to do and stays off",
      /detect its key first/.test($.libPaneNote.textContent) && !$.libPaneInKeyBtn.classList.contains("is-active"), $.libPaneNote.textContent);
    const setClipKey = function (code) { $.keyOverrideInput.value = code; $.applyKeyOverrideBtn._fire("click"); };
    setClipKey("10A"); // the music clip is in B minor
    $.libPaneInKeyBtn._fire("click");
    check("In key pitches the A minor tone +2 to the clip's B minor",
      $.libPaneInKeyBtn.classList.contains("is-active") && $.libPanePitchValue.textContent === "+2" &&
      /8A A minor → 10A B minor/.test($.libPaneKey.textContent) && /In key 10A/.test($.libPaneInKeyBtn.textContent) && $.libPaneNote.hidden,
      $.libPanePitchValue.textContent + " | " + $.libPaneKey.textContent + " | " + $.libPaneInKeyBtn.textContent);
    $.libPaneInKeyBtn._fire("click");
    check("... and off again goes back to the sound's own pitch", $.libPanePitchValue.textContent === "0" && !$.libPaneInKeyBtn.classList.contains("is-active"));
    setClipKey("10B"); // D major: a minor sound goes to its relative, B minor
    $.libPaneInKeyBtn._fire("click");
    check("a major clip takes a minor sound to the clip's relative minor (same Camelot number)",
      $.libPanePitchValue.textContent === "+2" && /10A B minor/.test($.libPaneKey.textContent), $.libPaneKey.textContent);
    setClipKey("8A");
    $.libPaneInKeyBtn._fire("click");
    $.libPaneInKeyBtn._fire("click");
    check("a sound already in the clip's key stays as it is and says so",
      $.libPanePitchValue.textContent === "0" && /Already in the clip's key/.test($.libPaneKey.textContent), $.libPaneKey.textContent);
    $.libPaneInKeyBtn._fire("click");
    const brokenRow = rows().find(function (x) { return /broken/.test(x.textContent); });
    brokenRow._fire("click");
    return waitFor(function () { return !$.libPaneNote.hidden; }, "the unreadable file's note");
  })
  .then(function () {
    check("a file the pane cannot read says so, and ▶ is not offered", /Could not read/.test($.libPaneNote.textContent) && $.libPanePlayBtn.disabled,
      $.libPaneNote.textContent);
    // The Key tab's "Pitch the clip": A minor -> B minor = +2 st.
    $.pitchFromSelect.value = "8A"; $.pitchFromSelect._fire("change");
    $.pitchToSelect.value = "10A"; $.pitchToSelect._fire("change");
    check("Key tab: the pitch button is offered for a real shift", !$.pitchApplyBtn.disabled);
    const before = inserts.length;
    $.pitchApplyBtn._fire("click");
    return waitFor(function () { return inserts.length === before + 1; }, "the Key tab's pitch").then(function () {
      const ins = inserts[inserts.length - 1];
      check("Key tab: the clip's own file at +2 st speed, placed at the clip's own place with the original switched off - no copy",
        ins.path === path.join(SFX, "tone_Am.wav") && ins.opts && ins.opts.atSeconds === 4 && ins.opts.muteSelected === true &&
        Math.abs(ins.opts.speed - Math.pow(2, 2 / 12)) < 1e-9 && !fs.existsSync(path.join(DOCS, "Downbeat", "Processed")), JSON.stringify(ins));
      return waitFor(function () { return /switched off/.test($.pitchApplyStatus.textContent); }, "the Key tab's status line").then(function () {
        check("Key tab: says where it went and that the original is off", /Placed on A\d; the original is switched off/.test($.pitchApplyStatus.textContent), $.pitchApplyStatus.textContent);
      });
    });
  })
  .then(function () {
    const saved = (function () { try { return JSON.parse(fs.readFileSync(path.join(DOCS, "Downbeat", "settings.json"), "utf8")); } catch (e) { return {}; } })();
    $.libPaneVolume.value = "35";
    $.libPaneVolume._fire("change");
    const after = JSON.parse(fs.readFileSync(path.join(DOCS, "Downbeat", "settings.json"), "utf8"));
    check("the volume is remembered", after.libPreviewVolume === 35, JSON.stringify(saved.libPreviewVolume) + " -> " + after.libPreviewVolume);
  })
  .catch(function (e) { check("the pane test ran to the end", false, e.message); })
  .then(finish);

function finish() {
  fs.rmSync(tmp, { recursive: true, force: true }); // throwaway fixture made above
  if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
  console.log("\nthe Library preview pane loads, plays, pitches, reverses and adds");
  process.exit(0);
}
