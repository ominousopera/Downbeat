"use strict";
// Delayed tempo results must belong to the analysis still on screen.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(process.env.DOWNBEAT_ROOT || path.join(__dirname, ".."), "js/main.js"), "utf8");
function body(name) {
  const start = source.indexOf("  function " + name + "(");
  assert(start >= 0, name);
  const end = source.indexOf("\n  }", start);
  assert(end > start, name);
  return source.slice(start, end + 4);
}
function fixture() {
  const pending = [], calls = [];
  const c = { Promise, _activeOperationGeneration: 1,
    lastAnalysis: { audioPath: "first.wav", beatsArray: [0, 1] },
    lastDecodedSamples: new Float32Array(4),
    RETEMPO_AUTOCORRECT_MARGIN: 1.1, bpmDisplay: { textContent: "60" },
    retempoHalfBtn: {}, retempoDoubleBtn: {},
    runAnalyzeWorker: function () { return new Promise(function (resolve, reject) { pending.push({ resolve, reject }); }); },
    _narrowForcedWindow: function () { return {}; },
    _forcedTempoWindow: function () { return {}; },
    _snapshotRetempoFields: function () { return {}; },
    _maybePreserveBetterPhase: function () { calls.push("phase"); },
    _applyRecomputedBeatsAnalysis: function () { calls.push("apply"); },
    _retempoNaive: function () { calls.push("fallback"); },
    log: function () {}, showBusy: function () {}, hideBusy: function () { calls.push("hide"); }
  };
  vm.createContext(c);
  vm.runInContext(body("_tryAutoCorrectHalfTempo") + "\n" + body("_retempoViaRecompute"), c);
  return { c, pending, calls };
}
const result = { confidence: 1, cuesheet: { bpm: 120 } };
const flush = async function () { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };
(async function () {
  for (const change of ["generation", "selection", "none"]) {
    const f = fixture();
    const done = f.c._tryAutoCorrectHalfTempo(60, f.c.lastDecodedSamples, "first.wav");
    if (change === "generation") { f.c._activeOperationGeneration++; }
    if (change === "selection") { f.c.lastAnalysis = { audioPath: "second.wav" }; }
    f.pending[0].resolve({ confidence: 2, cuesheet: { bpm: 60 } });
    f.pending[1].resolve(result);
    await done;
    assert.strictEqual(f.calls.includes("apply"), change === "none", "automatic correction: " + change);
  }
  for (const rejected of [false, true]) {
    for (const change of ["generation", "selection", "none"]) {
      const f = fixture();
      f.c._retempoViaRecompute(2, 60);
      if (change === "generation") { f.c._activeOperationGeneration++; }
      if (change === "selection") { f.c.lastAnalysis = { audioPath: "second.wav" }; }
      if (rejected) { f.pending[0].reject(new Error("worker unavailable")); }
      else { f.pending[0].resolve(result); }
      await flush();
      assert.strictEqual(f.calls.includes(rejected ? "fallback" : "apply"), change === "none", "manual correction: " + change);
      assert.strictEqual(f.calls.includes("hide"), true, "balance busy operation");
    }
  }
  console.log("PASS: delayed tempo correction ignores superseded analysis and balances busy state.");
})().catch(function (err) { console.error(err); process.exitCode = 1; });
