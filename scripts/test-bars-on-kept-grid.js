"use strict";
// Bars on the grid that stays: when the count or peak-logit guard
// turns Beat This!'s beats away, js/main.js puts the "1"s the worker counted
// on essentia's grid (gridBars) onto that grid. Runs the real
// _runBeatThisOnCurrentAnalysis / _keptGridError / _applyBarsOnKeptGrid with
// the real js/cuesheet.js and a mocked worker. Checks:
//   - the worker is handed the grid on screen;
//   - count guard and logit guard: the grid's beats stay, the "1"s become
//     gridBars' (thinned), essentia's margin is cleared, the warning follows
//     the decoder's "unsure" or uneven own "1"s, Beat This! counts as
//     rejected and the call resolves false;
//   - too few beats, no gridBars, or a grid replaced by 1/2x / 2x while the
//     worker ran: nothing changes;
//   - guards passed: Beat This!'s own grid is applied, gridBars ignored.
// Run: node scripts/test-bars-on-kept-grid.js
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
function body(name) { const start = source.indexOf("  function " + name + "("); assert.ok(start >= 0, name); return source.slice(start, source.indexOf("\n  }", start) + 4); }
const keys = source.match(/var BEAT_FIELD_KEYS = \[[\s\S]*?\];/)[0];
const cue = { window: {} };
vm.createContext(cue); vm.runInContext(fs.readFileSync(path.join(ROOT, "js/cuesheet.js"), "utf8"), cue);
const C = cue.window.BeatMarkerCuesheet;

// essentia's grid: 64 beats at 120 BPM; the decoder's "1"s on beats 1, 5, 9...
const grid = []; for (let i = 0; i < 64; i++) { grid.push(0.5 + i * 0.5); }
const gridOnes = grid.filter((_, i) => i % 4 === 1);
function fixture(result, opts) {
  const o = opts || {};
  const applied = [], logs = [], workerArgs = [];
  let pending;
  const clipInfo = { mediaPath: "/a.wav" };
  const c = {
    Promise, BEATTHIS_COUNT_RATIO_GUARD: 1.75, BEATTHIS_MIN_MEAN_PEAK_LOGIT: 3,
    BEATTHIS_DENSITY_RATIO_HALF_MIN: 0.45, BEATTHIS_DENSITY_RATIO_HALF_MAX: 0.55,
    lastAnalysis: { audioPath: "/a.wav", clipInfo, beatsArray: grid, downbeatTimes: null, phase: 3, phaseMarginRatio: 0.1,
      phaseSource: "blend", bassPhase: 3, chordPhase: 3, phaseAgreement: "disagree", barsUnsure: null, confidence: 2 },
    lastDecodedSamples: new Float32Array(8),
    bpmDisplay: { textContent: "120.00" },
    window: { BeatMarkerCuesheet: C, BeatMarkerAudio: { TARGET_SAMPLE_RATE: 44100, resampleMono: async function (s) { return s; } },
      BeatMarkerLibrary: { setBeatGrid: function () {} } }, persistLibrary: function () {},
    log: function (s) { logs.push(s); },
    _assertAudioUnchanged: function () {},
    _applyBeatFieldsAndRefreshUI: function (f) { applied.push(f); },
    _updateGridConfidenceHint: function () {},
    runBeatThisWorker: function () { workerArgs.push(Array.from(arguments)); return new Promise(function (resolve) { pending = resolve; }); }
  };
  vm.createContext(c);
  vm.runInContext(keys + "\n" + body("_snapshotBeatFields") + "\n" + body("_runBeatThisOnCurrentAnalysis") + "\n" +
    body("_keptGridError") + "\n" + body("_applyBarsOnKeptGrid"), c);
  const before = c.lastAnalysis;
  const run = (async function () {
    const op = c._runBeatThisOnCurrentAnalysis(true);
    while (!pending) { await Promise.resolve(); }
    if (o.regridMeanwhile) { c.lastAnalysis.beatsArray = grid.map((t) => t * 1); }
    pending(result);
    return op;
  })();
  return { c, applied, logs, workerArgs, before, run };
}
const bt = (n, logit) => { const b = []; for (let i = 0; i < n; i++) { b.push(0.5 + i * 0.5 * 64 / n); } return { beatTimes: b, downbeatTimes: [b[0], b[4]], modelDownbeatTimes: [b[0], b[4]], meanPeakLogit: logit, barsDecoded: true, barsUnsure: false }; };
const evenOwn = gridOnes.slice(), unevenOwn = [1, 4, 9, 12, 17, 20, 25, 28, 33, 36, 41, 44].map((i) => grid[i]);

(async function () {
  // Count guard (Beat This! found twice the beats), even own "1"s.
  let f = fixture(Object.assign(bt(128, 6), { gridBars: { downbeatTimes: gridOnes, modelDownbeatTimes: evenOwn, unsure: false } }));
  assert.strictEqual(await f.run, false);
  assert.strictEqual(f.workerArgs[0][1], grid, "the worker is handed the grid on screen");
  assert.strictEqual(f.applied.length, 1);
  let a = f.applied[0];
  assert.strictEqual(a.beatsArray, grid, "the grid's beats stay");
  assert.deepStrictEqual(Array.from(a.downbeatTimes), gridOnes);
  assert.strictEqual(a.phase, 1);
  assert.strictEqual(a.phaseMarginRatio, null);
  assert.strictEqual(a.phaseAgreement, "native");
  assert.strictEqual(a.barsUnsure, false);
  assert.strictEqual(a.shownBpm, 120);
  assert.strictEqual(f.before.beatThisRejected, true);
  assert.ok(!f.before.beatThisApplied);
  console.log("ok   count guard: the grid stays, its \"1\"s come from the decoder, no warning");

  // Logit guard, decoder unsure.
  f = fixture(Object.assign(bt(64, 1), { gridBars: { downbeatTimes: gridOnes, modelDownbeatTimes: evenOwn, unsure: true } }));
  assert.strictEqual(await f.run, false);
  assert.strictEqual(f.applied.length, 1); assert.strictEqual(f.applied[0].barsUnsure, true);
  console.log("ok   logit guard: applied, the decoder's \"unsure\" shows the warning");

  // Uneven own "1"s also warn; too few own "1"s count as uneven.
  f = fixture(Object.assign(bt(128, 6), { gridBars: { downbeatTimes: gridOnes, modelDownbeatTimes: unevenOwn, unsure: false } }));
  await f.run; assert.strictEqual(f.applied[0].barsUnsure, true);
  f = fixture(Object.assign(bt(128, 6), { gridBars: { downbeatTimes: gridOnes, modelDownbeatTimes: [grid[1]], unsure: false } }));
  await f.run; assert.strictEqual(f.applied[0].barsUnsure, true);
  console.log("ok   uneven or too few own \"1\"s show the warning");

  // Too few beats: a guard outside the measurement - nothing changes.
  f = fixture(Object.assign(bt(3, 6), { gridBars: { downbeatTimes: gridOnes, modelDownbeatTimes: evenOwn, unsure: false } }));
  assert.strictEqual(await f.run, false); assert.strictEqual(f.applied.length, 0);
  // No gridBars, or too few "1"s in it.
  f = fixture(bt(128, 6)); await f.run; assert.strictEqual(f.applied.length, 0);
  f = fixture(Object.assign(bt(128, 6), { gridBars: { downbeatTimes: [grid[1]], modelDownbeatTimes: evenOwn, unsure: false } }));
  await f.run; assert.strictEqual(f.applied.length, 0);
  // The grid replaced while the worker ran.
  f = fixture(Object.assign(bt(128, 6), { gridBars: { downbeatTimes: gridOnes, modelDownbeatTimes: evenOwn, unsure: false } }), { regridMeanwhile: true });
  await f.run; assert.strictEqual(f.applied.length, 0);
  assert.ok(f.logs.some((s) => s.includes("the grid changed meanwhile")));
  console.log("ok   too few beats, no gridBars, or a replaced grid: nothing changes");

  // Guards passed: Beat This!'s grid, gridBars ignored.
  f = fixture(Object.assign(bt(64, 6), { gridBars: { downbeatTimes: gridOnes, modelDownbeatTimes: evenOwn, unsure: true } }));
  assert.strictEqual(await f.run, true);
  assert.strictEqual(f.applied.length, 1); assert.notStrictEqual(f.applied[0].beatsArray, grid);
  assert.strictEqual(f.applied[0].phaseSource, "beatthis-native");
  console.log("ok   guards passed: Beat This!'s own grid, gridBars ignored");
  console.log("\nBars are counted on the grid that stays");
})().catch(function (e) { console.error("FAIL " + (e && e.stack ? e.stack : e)); process.exitCode = 1; });
