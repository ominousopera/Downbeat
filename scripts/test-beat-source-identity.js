"use strict";
// Delayed alternative grids and undo snapshots must retain their source identity.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
function body(name) { const start = source.indexOf("  function " + name + "("); assert.ok(start >= 0); return source.slice(start, source.indexOf("\n  }", start) + 4); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-grid-identity-")), media = path.join(dir, "audio.wav");
function identity() { const st = fs.statSync(media); return { size: st.size, mtimeMs: st.mtimeMs }; }
function fixture() {
  fs.writeFileSync(media, "original samples");
  const clipInfo = { mediaPath: media, fileIdentity: identity() }, applied = [], logs = [];
  let pending, launched = 0;
  const c = {
    Promise, lastAnalysis: { audioPath: media, clipInfo, beatsArray: [0,1,2,3,4,5,6,7] }, lastDecodedSamples: new Float32Array(8),
    BEATTHIS_COUNT_RATIO_GUARD: 1.75, BEATTHIS_MIN_MEAN_PEAK_LOGIT: 0,
    BEATTHIS_DENSITY_RATIO_HALF_MIN: 0.45, BEATTHIS_DENSITY_RATIO_HALF_MAX: 0.55,
    window: { BeatMarkerLibrary: { fileIdentity: identity, sameIdentity: function (a, b) { return a.size === b.size && a.mtimeMs === b.mtimeMs; } },
      BeatMarkerAudio: { TARGET_SAMPLE_RATE: 44100, resampleMono: async function (s) { return s; } },
      BeatMarkerCuesheet: { computeGridDensityRatio: function () { return 1; }, computeNativeDownbeatPhase: function () { return 0; }, computeDownbeatRegularity: function () { return null; } } },
    I18n: { t: function () { return "file changed"; } }, log: function (s) { logs.push(s); },
    _snapshotBeatFields: function () { return {}; }, _applyBeatFieldsAndRefreshUI: function (f) { applied.push(f); },
    _updateGridConfidenceHint: function () {},
    runBeatThisWorker: function () { launched++; return new Promise(function (resolve) { pending = resolve; }); }
  };
  vm.createContext(c); vm.runInContext(body("_assertAudioUnchanged") + "\n" + body("_runBeatThisOnCurrentAnalysis") + "\n" + body("_restoreManualBpmSnapshot"), c);
  return { c, applied, logs, resolve: function () { pending({ beatTimes: [0,1,2,3,4,5,6,7], downbeatTimes: [0,4], meanPeakLogit: 1 }); }, launches: function () { return launched; } };
}
(async function () {
  try {
    for (const changed of [false, true]) {
      const f = fixture(), operation = f.c._runBeatThisOnCurrentAnalysis(true);
      await Promise.resolve(); await Promise.resolve();
      if (changed) fs.writeFileSync(media, "new replacement samples with different size");
      f.resolve(); assert.strictEqual(await operation, !changed); assert.strictEqual(f.applied.length, changed ? 0 : 1);
      if (changed) { assert.strictEqual(f.c.lastAnalysis.beatThisApplied, undefined); assert.ok(f.logs.some(function (s) { return s.includes("file changed"); })); }
    }
    const f = fixture(); fs.writeFileSync(media, "changed before launch");
    assert.strictEqual(await f.c._runBeatThisOnCurrentAnalysis(false), false); assert.strictEqual(f.launches(), 0);
    const current = f.c.lastAnalysis;
    f.c._restoreManualBpmSnapshot({ clipInfo: current.clipInfo, lastAnalysis: null });
    assert.strictEqual(f.c.lastAnalysis, current, "stale undo cannot replace current state");
    console.log("PASS: Beat This rejects source replacement before/during work; stale manual undo leaves state untouched.");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(function (e) { console.error(e); process.exitCode = 1; });
