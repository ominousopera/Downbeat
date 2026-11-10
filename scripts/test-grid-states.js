"use strict";
// Analyze tab states through the real panel and the real jsx/host.jsx on the
// Premiere stand-in (Russian panel); only the decoder and the two worker
// processes are stood in for:
//   - silent or too short audio: a translated refusal, no grid;
//   - Beat This! that does not finish: Basic stays saved (not "kept"), the
//     Beat grid line stays up with its note, Refined works on the next try;
//   - 1/2x on a Refined grid lights Basic and saves "basic" with the BPM
//     shown; 2x brings the Refined grid back;
//   - the chosen "1" survives selecting another clip and coming back;
//   - a nested sequence (no media file) gets a translated reason.
// Run: node scripts/test-grid-states.js
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const mocks = require("./host-mocks.js");
const { bootPanel } = require("./panel-harness.js");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-grid-states-"));
const DOCS = path.join(WORK, "docs");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "ru", onboardingCompleted: true, updateCheck: false }));
const media = path.join(WORK, "song.wav");
fs.writeFileSync(media, "placeholder");
const other = path.join(WORK, "other.wav");
fs.writeFileSync(other, "placeholder too");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

const grid = function (step, n, from) { return Array.from({ length: n }, function (_, i) { return (from || 0) + i * step; }); };
let beatsReply = "ok";
let beatThisReply = "fail";
const originalExecFile = cp.execFile;
cp.execFile = function (bin, args, opts, cb) {
  const worker = path.basename(String(args[0]));
  setImmediate(function () {
    if (worker === "analyze-worker.js") {
      if (beatsReply !== "ok") { cb(null, JSON.stringify({ ok: false, error: beatsReply }), ""); return; }
      const constrained = !!args[4];
      cb(null, JSON.stringify({ ok: true, data: constrained
        ? { beatsArray: grid(1, 60), confidence: 3, phase: 0, phaseAverages: [1, 0.5, 0.4, 0.3], phaseMarginRatio: 0.5, cuesheet: { bpm: 60 } }
        : { beatsArray: grid(0.5, 120), confidence: 3.2, phase: 0, phaseAverages: [1, 0.5, 0.4, 0.3], phaseMarginRatio: 0.5, cuesheet: { bpm: 120 } } }), "");
    } else if (beatThisReply === "fail") {
      cb(Object.assign(new Error("Command failed: beatthis-worker"), { killed: true, signal: "SIGTERM", code: null }), "", "");
    } else {
      const beats = grid(0.5, 120, 0.02);
      cb(null, JSON.stringify({ ok: true, data: { beatTimes: beats, downbeatTimes: beats.filter(function (_, i) { return i % 4 === 0; }),
        meanPeakLogit: 8, barsDecoded: true, barsUnsure: false } }), "");
    }
  });
  return { kill: function () {} };
};

const fake = mocks.makePremiereHost({ mediaPath: media, durationSec: 60, clipStart: 0, audioTrackCount: 2 });
const host = mocks.loadHost(fake.context);
const panel = bootPanel({ docsDir: DOCS, evalScript: host.evalScript, realTimeouts: true });
const $ = panel.registry;
const I18n = window.BeatMarkerI18n;
window.BeatMarkerAudio.decodeFileToMono44100 = function () {
  return Promise.resolve({ samples: new Float32Array(44100), original: { durationSec: 60, sampleRate: 44100, channels: 2 } });
};
window.BeatMarkerAudio.resampleMono = function (s) { return Promise.resolve(s); };
const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function idle() {
  for (let i = 0; i < 200 && ($.analyzeBtn.disabled || $.gridRefinedBtn.disabled || $.retempoHalfBtn.disabled); i++) { await wait(10); }
  await wait(30);
}
async function poll() { panel.runIntervals(); await wait(60); }
const line = function () { return $.selectionStatusDisplay.title || $.selectionStatusDisplay.textContent; };
const lit = function () {
  return $.gridRefinedBtn.classList.contains("is-active") ? "Refined" : ($.gridBasicBtn.classList.contains("is-active") ? "Basic" : "none");
};
const rowShown = function () { return $.beatThisRow.style.display !== "none"; };
const saved = function () { return window.BeatMarkerLibrary.get(media) || {}; };
const cell = function () { return ["phaseBeat1", "phaseBeat2", "phaseBeat3", "phaseBeat4"].filter(function (id) { return $[id].classList.contains("is-active"); }).join(","); };

// The beat tracker's own refusal (js/analyze.js, run in the worker).
(function () {
  const vm = require("vm");
  const box = { window: {} };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "analyze.js"), "utf8"), box);
  const unfit = box.window.BeatMarkerAnalyze.audioUnfitForBeats;
  const tone = new Float32Array(3 * 44100).map(function (_, i) { return 0.1 * Math.sin(i / 10); });
  const hum = new Float32Array(3 * 44100).map(function (_, i) { return 0.0003 * Math.sin(i / 10); });
  check("the beat tracker refuses under 2 s", unfit(new Float32Array(44100), 44100) === "DOWNBEAT_AUDIO_TOO_SHORT");
  check("the beat tracker refuses silence and near silence",
    unfit(new Float32Array(3 * 44100), 44100) === "DOWNBEAT_AUDIO_SILENT" && unfit(hum, 44100) === "DOWNBEAT_AUDIO_SILENT");
  check("the beat tracker takes 3 s of sound", unfit(tone, 44100) === null);
})();

(async function () {
  try {
    await poll();

    beatsReply = "DOWNBEAT_AUDIO_SILENT";
    $.analyzeBtn._fire("click"); await idle();
    check("silent audio is refused in the panel's language", line() === I18n.t("analyze.silent") && /is-error/.test($.selectionStatusDisplay.className) && !saved().beatsArray,
      line());
    beatsReply = "DOWNBEAT_AUDIO_TOO_SHORT";
    $.analyzeBtn._fire("click"); await idle();
    check("too short audio is refused in the panel's language", line() === I18n.t("analyze.tooShort") && !saved().beatsArray, line());

    beatsReply = "ok";
    beatThisReply = "fail";
    $.analyzeBtn._fire("click"); await idle();
    check("a Beat This! run that did not finish leaves Basic saved, not kept", saved().beatGrid === "basic", String(saved().beatGrid));
    check("the Beat grid line stays up and says the refined grid could not be made",
      rowShown() && lit() === "Basic" && $.beatThisHintText.textContent === I18n.t("analyze.refinedFailed"),
      "row " + rowShown() + ", " + lit() + ", " + $.beatThisHintText.textContent);
    beatThisReply = "ok";
    $.gridRefinedBtn._fire("click"); await idle();
    check("Refined works on the next try", lit() === "Refined" && saved().beatGrid === "refined" &&
      $.beatThisHintText.textContent === I18n.t("analyze.gridHelp"), lit() + ", saved " + saved().beatGrid);

    $.retempoHalfBtn._fire("click"); await idle();
    check("1/2x on a Refined grid lights Basic and saves basic", lit() === "Basic" && saved().beatGrid === "basic", lit() + ", saved " + saved().beatGrid);
    check("the saved BPM follows 1/2x", Math.abs(saved().bpm - Number($.bpmDisplay.textContent)) < 0.01 && Math.abs(saved().bpm - 60) < 0.01,
      "saved " + saved().bpm + ", shown " + $.bpmDisplay.textContent);
    check("the clip line follows 1/2x", /60\.0 BPM/.test(line()), line());
    $.retempoDoubleBtn._fire("click"); await idle();
    check("2x brings the Refined grid back", lit() === "Refined" && saved().beatGrid === "refined", lit() + ", saved " + saved().beatGrid);

    // The chosen "1" survives another selection.
    $.phaseBeat3._fire("click"); await wait(150);
    const clipA = fake.audioTrack.clips[0];
    const clipB = new mocks.PClip({ name: "other.wav", getMediaPath: function () { return other; }, getMarkers: function () { return new mocks.MarkerCollection(); } }, 70, 90, 0, false);
    fake.sequence.audioTracks[1].clips.push(clipB);
    clipA.selected = false; clipB.selected = true;
    await poll();
    check("another clip shows its own line", /other\.wav/.test(line()), line());
    clipB.selected = false; clipA.selected = true;
    await poll();
    check("back on the clip, the chosen 1 is still lit and Refined still on", cell() === "phaseBeat3" && lit() === "Refined", cell() + ", " + lit());

    // A nested sequence has no media file of its own.
    const projectItem = clipA.projectItem;
    const realPath = projectItem.getMediaPath;
    projectItem.getMediaPath = function () { return ""; };
    await poll();
    check("a nested sequence gets a translated reason", line() === I18n.t("selection.hostNoMediaFile"), line());
    projectItem.getMediaPath = realPath;
  } finally {
    cp.execFile = originalExecFile;
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
  console.log("PASS: refusals, an unfinished Beat This! run, 1/2x / 2x and a kept \"1\" behave as the panel says");
  process.exit(0);
})().catch(function (e) { console.error(e); cp.execFile = originalExecFile; fs.rmSync(WORK, { recursive: true, force: true }); process.exit(1); });
