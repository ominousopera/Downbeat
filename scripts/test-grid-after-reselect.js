"use strict";
// Beat grid -> Basic / Refined on a clip opened from the saved list: after a
// restart, or after selecting another clip and coming back. The grid's name
// is saved with the analysis, and a switch that needs the audio or the
// other grid analyzes the clip again. The real panel runs under
// scripts/panel-harness.js; the two detectors' replies are fixed, made-up
// grids (no model involved). Low detection confidence (0.5), so the "may be
// less reliable" warning shows.
// Checks:
//   - Analyze applies Refined and saves "refined"; Basic saves "basic";
//   - after a restart the saved grid is not reopened, and neither the
//     warning nor the Beat grid line shows until Analyze;
//   - after selecting another clip and coming back, the saved word is lit;
//     Basic works with no Basic grid in memory and Refined with no decoded
//     audio in memory (both analyze the clip again);
//   - a grid Beat This! turned away is saved as "kept" and the Beat grid
//     line stays hidden when the clip is selected again;
//   - an entry saved before the field existed counts as Refined when it has
//     Beat This!'s "1" markers.
// Run: node scripts/test-grid-after-reselect.js
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

const phase = process.argv[2] || "first";
const dir = phase === "first" ? fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-grid-reselect-")) : process.argv[3];
const file = path.join(dir, "synthetic.wav");
const other = path.join(dir, "other.wav");
const originalExecFile = cp.execFile;

// Basic: uneven beats (no even span), so its BPM is the tracker's 137.
const basic = [];
for (let i = 0, t = 0; i < 60; i++) { basic.push(t); t += (i % 2 ? 0.7 : 0.4); }
const refined = Array.from({ length: 60 }, function (_, i) { return i * 0.5; });
const tooMany = Array.from({ length: 140 }, function (_, i) { return i * 0.25; });
let refinedReply = refined;
// Analyze runs, counted from the panel log (the waveform preview decodes on its own).
let analyses = 0;
const originalLog = console.log;
console.log = function () {
  if (String(arguments[0]).indexOf("Reading file: ") !== -1) { analyses++; }
  return originalLog.apply(console, arguments);
};

function clipFor(mediaPath) {
  return { mediaPath: mediaPath, clipStartSeconds: 0, inPointSeconds: 0, outPointSeconds: 35,
    speed: 1, reversed: false, frameRate: 25, trackIndex: 0 };
}

(async function () {
  try {
    if (phase === "first") {
      fs.writeFileSync(file, Buffer.alloc(44));
      fs.writeFileSync(other, Buffer.alloc(46));
      fs.mkdirSync(path.join(dir, "Downbeat"));
      fs.writeFileSync(path.join(dir, "Downbeat", "settings.json"),
        JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
    }
    cp.execFile = function (bin, args, opts, cb) {
      const data = String(args[0]).includes("beatthis-worker")
        ? { beatTimes: refinedReply, downbeatTimes: refinedReply.filter(function (_, i) { return i % 4 === 0; }),
            meanPeakLogit: 8, barsDecoded: true, barsUnsure: false }
        : { cuesheet: { bpm: 137 }, beatsArray: basic, confidence: 0.5, phase: 0,
            phaseAverages: [1, 0, 0, 0], phaseMarginRatio: 1, phaseAgreement: "agree" };
      queueMicrotask(function () { cb(null, JSON.stringify({ ok: true, data: data }), ""); });
      return { kill: function () {} };
    };
    let selected = clipFor(file);
    const h = require("./panel-harness.js").bootPanel({ docsDir: dir,
      evalScript: function (s, cb) { if (cb) { cb(JSON.stringify({ ok: true, data: selected })); } } });
    window.BeatMarkerAudio.decodeFileToMono44100 = function () {
      return Promise.resolve({ samples: new Float32Array(44100), original: { durationSec: 35, sampleRate: 44100, channels: 1 } });
    };
    window.BeatMarkerAudio.resampleMono = function (s) { return Promise.resolve(s); };
    const R = h.registry;
    const tick = function () { return new Promise(setImmediate); };
    const idle = async function () {
      for (let i = 0; i < 800 && (R.analyzeBtn.disabled || R.gridRefinedBtn.disabled); i++) { await tick(); }
      for (let i = 0; i < 20; i++) { await tick(); }
    };
    const select = async function (mediaPath) {
      selected = clipFor(mediaPath);
      h.runIntervals();
      await idle();
    };
    const lit = function () {
      return R.gridRefinedBtn.classList.contains("is-active") ? "Refined"
        : (R.gridBasicBtn.classList.contains("is-active") ? "Basic" : "none");
    };
    const rowShown = function () { return R.beatThisRow.style.display !== "none"; };
    const shown = function () { return Number(R.bpmDisplay.textContent); };
    const savedGrid = function () {
      const list = JSON.parse(fs.readFileSync(path.join(dir, "Downbeat", "library.json"), "utf8"));
      const e = list.find(function (x) { return x.mediaPath === file; });
      return e ? e.beatGrid : undefined;
    };
    await idle();

    if (phase === "first") {
      R.analyzeBtn._fire("click"); await idle();
      check("Analyze applies Refined and saves it", lit() === "Refined" && savedGrid() === "refined",
        lit() + ", saved " + savedGrid());
      R.gridBasicBtn._fire("click"); await idle();
      check("Basic is saved", lit() === "Basic" && savedGrid() === "basic" && shown() === 137,
        lit() + ", saved " + savedGrid() + ", " + R.bpmDisplay.textContent + " BPM");
      cp.execFile = originalExecFile;
      const second = cp.spawnSync(process.execPath, [__filename, "second", dir], { encoding: "utf8" });
      process.stdout.write(second.stdout || "");
      process.stderr.write(second.stderr || "");
      check("the restarted panel passes its checks", second.status === 0, "exit " + second.status);
    } else {
      // A grid from an earlier session is not reopened: no warning and no
      // Beat grid line until Analyze.
      const warned = function () { return R.gridConfidenceRow.style.display !== "none"; };
      check("after a restart the saved grid waits for Analyze, with no warning or switch",
        !rowShown() && !warned() && R.bpmDisplay.textContent === "-",
        "row " + rowShown() + ", warning " + warned() + ", " + R.bpmDisplay.textContent + " BPM");
      R.analyzeBtn._fire("click"); await idle();
      check("Analyze after the restart applies Refined", lit() === "Refined" && warned() && analyses === 1,
        lit() + ", Analyze runs " + analyses);

      // Another clip analyzed meanwhile: the audio in memory is that clip's.
      await select(other);
      R.analyzeBtn._fire("click"); await idle();
      await select(file);
      check("back on the clip, Refined is lit", lit() === "Refined" && rowShown() && shown() === 120,
        lit() + ", " + R.bpmDisplay.textContent + " BPM");
      R.gridBasicBtn._fire("click"); await idle();
      check("Basic with no Basic grid in memory analyzes again and switches back",
        lit() === "Basic" && shown() === 137 && savedGrid() === "basic" && analyses === 3,
        lit() + ", " + R.bpmDisplay.textContent + " BPM, saved " + savedGrid() + ", Analyze runs " + analyses);

      await select(other);
      await select(file);
      check("back on the clip, Basic is lit", lit() === "Basic" && rowShown(), lit());
      R.gridRefinedBtn._fire("click"); await idle();
      check("Refined with the audio still in memory runs only the second detector",
        lit() === "Refined" && shown() === 120 && savedGrid() === "refined" && analyses === 3,
        lit() + ", " + R.bpmDisplay.textContent + " BPM, Analyze runs " + analyses);
      R.gridBasicBtn._fire("click"); await idle();

      await select(other);
      R.analyzeBtn._fire("click"); await idle();
      await select(file);
      R.gridRefinedBtn._fire("click"); await idle();
      check("Refined with no audio in memory analyzes again and applies",
        lit() === "Refined" && shown() === 120 && savedGrid() === "refined" && analyses === 5,
        lit() + ", " + R.bpmDisplay.textContent + " BPM, saved " + savedGrid() + ", Analyze runs " + analyses);

      refinedReply = tooMany;
      R.analyzeBtn._fire("click"); await idle();
      check("a grid Beat This! turns away is saved as kept", savedGrid() === "kept" && !rowShown(),
        "saved " + savedGrid() + ", row " + rowShown());
      await select(other);
      await select(file);
      check("back on that clip, the Beat grid line stays hidden", !rowShown() && shown() === 137,
        "row " + rowShown() + ", " + R.bpmDisplay.textContent + " BPM");

      const L = window.BeatMarkerLibrary;
      L.absorb([{ mediaPath: other, bpm: 120, beatsArray: refined, downbeatTimes: [0, 2, 4], phase: 0, updatedAt: Date.now() + 1000 }]);
      check("an entry saved before the field existed counts as Refined", L.get(other) && L.get(other).beatGrid === "refined",
        L.get(other) ? String(L.get(other).beatGrid) : "no entry");
    }
  } finally {
    cp.execFile = originalExecFile;
    if (phase === "first") { fs.rmSync(dir, { recursive: true, force: true }); } // throwaway fixture made above
  }
  if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
  console.log(phase === "first" ? "PASS: Basic / Refined work on a clip opened from the saved list" : "second panel: ok");
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
