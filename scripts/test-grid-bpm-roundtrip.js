"use strict";
// The BPM follows the beat grid in use through Beat grid -> Basic / Refined.
// The real panel runs under scripts/panel-harness.js; the two detectors'
// replies are fixed, made-up grids (no model involved).
// Checks:
//   - Basic beats with no even span (gaps of 0.4 / 0.7 s): Analyze shows
//     Refined's 120, Basic gives back the tracker's 137 (shown and saved),
//     Refined 120 again, Basic 137 again;
//   - Basic beats with an even span: Basic shows their own measured tempo
//     (100), not the tracker's figure (98.7).
// Run: node scripts/test-grid-bpm-roundtrip.js
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-grid-bpm-"));
const originalExecFile = cp.execFile;
const uneven = [];
for (let i = 0, t = 0; i < 60; i++) { uneven.push(t); t += (i % 2 ? 0.7 : 0.4); }
const even100 = Array.from({ length: 60 }, function (_, i) { return i * 0.6; });
const refined = Array.from({ length: 60 }, function (_, i) { return i * 0.5; });
let basicReply = { beats: uneven, bpm: 137 };

(async function () {
  try {
    const file = path.join(dir, "synthetic.wav");
    fs.writeFileSync(file, Buffer.alloc(44));
    fs.mkdirSync(path.join(dir, "Downbeat"));
    fs.writeFileSync(path.join(dir, "Downbeat", "settings.json"),
      JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
    cp.execFile = function (bin, args, opts, cb) {
      const data = String(args[0]).includes("beatthis-worker")
        ? { beatTimes: refined, downbeatTimes: refined.filter(function (_, i) { return i % 4 === 0; }),
            meanPeakLogit: 8, barsDecoded: true, barsUnsure: false }
        : { cuesheet: { bpm: basicReply.bpm }, beatsArray: basicReply.beats, confidence: 3, phase: 0,
            phaseAverages: [1, 0, 0, 0], phaseMarginRatio: 1, phaseAgreement: "agree" };
      queueMicrotask(function () { cb(null, JSON.stringify({ ok: true, data: data }), ""); });
      return { kill: function () {} };
    };
    const clip = { mediaPath: file, clipStartSeconds: 0, inPointSeconds: 0, outPointSeconds: 35,
      speed: 1, reversed: false, frameRate: 25, trackIndex: 0 };
    const h = require("./panel-harness.js").bootPanel({ docsDir: dir,
      evalScript: function (s, cb) { if (cb) { cb(JSON.stringify({ ok: true, data: clip })); } } });
    window.BeatMarkerAudio.decodeFileToMono44100 = function () {
      return Promise.resolve({ samples: new Float32Array(44100), original: { durationSec: 35, sampleRate: 44100, channels: 1 } });
    };
    window.BeatMarkerAudio.resampleMono = function (s) { return Promise.resolve(s); };
    const R = h.registry;
    const settle = async function (btn) {
      for (let i = 0; i < 500 && btn.disabled; i++) { await new Promise(setImmediate); }
    };
    const shown = function () { return Number(R.bpmDisplay.textContent); };
    const saved = function () { return window.BeatMarkerLibrary.get(file).bpm; };

    R.analyzeBtn._fire("click"); await settle(R.analyzeBtn);
    check("Analyze applies Refined and shows its tempo", R.gridRefinedBtn.classList.contains("is-active") && shown() === 120,
      R.bpmDisplay.textContent);
    R.gridBasicBtn._fire("click");
    check("Basic with no even span gives back the tracker's BPM", shown() === 137 && saved() === 137,
      "shown " + R.bpmDisplay.textContent + ", saved " + saved());
    R.gridRefinedBtn._fire("click"); await settle(R.gridRefinedBtn);
    check("Refined again shows 120", shown() === 120 && saved() === 120, R.bpmDisplay.textContent);
    R.gridBasicBtn._fire("click");
    check("Basic again shows 137", shown() === 137 && saved() === 137, R.bpmDisplay.textContent);

    basicReply = { beats: even100, bpm: 98.7 };
    R.analyzeBtn._fire("click"); await settle(R.analyzeBtn);
    check("a new Analyze shows Refined's 120", shown() === 120, R.bpmDisplay.textContent);
    R.gridBasicBtn._fire("click");
    check("Basic with an even span shows its measured tempo", shown() === 100 && saved() === 100,
      "shown " + R.bpmDisplay.textContent + ", saved " + saved());
  } finally {
    cp.execFile = originalExecFile;
    fs.rmSync(dir, { recursive: true, force: true }); // throwaway fixture made above
  }
  if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
  console.log("PASS: the BPM follows the beat grid in use");
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
