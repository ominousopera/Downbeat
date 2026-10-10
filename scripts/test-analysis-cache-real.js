"use strict";
// Identical passes reuse a real worker answer without sharing its mutable beat arrays.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), util = require("util");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const executable = path.join(ROOT, "runtime/node", process.platform === "win32" ? "win-x64" : process.platform + "-" + process.arch, process.platform === "win32" ? "node.exe" : "node");
if (!fs.existsSync(executable)) { console.log("SKIP: bundled worker runtime is not available."); process.exit(0); }
require(path.join(ROOT, "js/analysis-cache.js"));
const cache = global.BeatMarkerAnalysisCache.create(4), dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-pass-"));
const samples = new Float32Array(30 * 44100);
for (let beat = 0; beat < 60; beat++) for (let i = 0; i < 400; i++) samples[beat * 22050 + i] = 0.8 * Math.exp(-i / 40);
const raw = path.join(dir, "samples.raw"); fs.writeFileSync(raw, Buffer.from(samples.buffer));
const constraint = { minTempo: 80, maxTempo: 160 }; let calls = 0;
async function execute() {
  calls++;
  const result = await util.promisify(cp.execFile)(executable, [path.join(ROOT, "worker/analyze-worker.js"), "beats", raw, "fixture.wav", JSON.stringify(constraint)], { timeout: 120000, maxBuffer: 8e6 });
  const json = JSON.parse(result.stdout); assert.ok(json.ok, json.error); return json.data;
}
(async function () {
  try {
    const a = await cache.run(samples, "fixture.wav", constraint, execute);
    const b = await cache.run(samples, "fixture.wav", constraint, execute);
    assert.strictEqual(calls, 1); assert.deepStrictEqual(a, b); assert.ok(a.beatsArray.length > 10);
    a.beatsArray[0] = 100;
    assert.notStrictEqual(a.beatsArray[0], b.beatsArray[0]);
    cache.clear(); await cache.run(samples, "fixture.wav", constraint, execute); assert.strictEqual(calls, 2);
    console.log("PASS: repeated constrained BPM uses one real worker pass, preserves its full result and resets explicitly.");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(function (e) { console.error(e); process.exitCode = 1; });
