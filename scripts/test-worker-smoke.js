"use strict";
// Starts the real analysis worker (worker/analyze-worker.js) under the
// BUNDLED Node runtime, the same way js/bridge.js does, and runs key
// detection on a synthetic A-minor chord. Other tests run under the system
// Node; this one checks the shipped runtime.
// Run: node scripts/test-worker-smoke.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
// DOWNBEAT_ROOT: build-zxp.sh points this at the staged release copy.
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
if (!fs.existsSync(path.join(ROOT, "runtime", "onnxruntime-web"))) {
  console.log("skip - run scripts/fetch-beatthis-runtime.sh first");
  process.exit(0);
}
const platformDir = process.platform === "win32" ? "win-x64" : process.platform + "-" + process.arch;
const bundled = path.join(ROOT, "runtime", "node", platformDir, process.platform === "win32" ? "node.exe" : "node");
const nodeBin = fs.existsSync(bundled) ? bundled : process.execPath;
// 6 s of A3 + C4 + E4 at 44100 Hz mono float32. Deliberately short: this
// checks that the worker starts and answers, not accuracy.
const RATE = 44100;
const seconds = 6;
const samples = new Float32Array(RATE * seconds);
[220.0, 261.63, 329.63].forEach(function (f) {
  for (let i = 0; i < samples.length; i++) {
    samples[i] += 0.2 * Math.sin(2 * Math.PI * f * i / RATE);
  }
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-worker-"));
const raw = path.join(dir, "tone.raw");
fs.writeFileSync(raw, Buffer.from(samples.buffer));

let failures = 0;
try {
  for (const material of ["music", "sfx"]) {
    const out = execFileSync(nodeBin, [path.join(ROOT, "worker", "analyze-worker.js"), "key", raw, "", "", "", material],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
    const r = JSON.parse(out);
    const ok = r.ok && r.data && r.data.material === material && r.data.perProfile.length === r.data.totalProfiles;
    if (!ok) { failures++; }
    console.log((ok ? "ok   " : "FAIL ") + "worker key detection (" + material + ") under " +
      (nodeBin === bundled ? "the bundled Node" : "this Node") + " - " +
      (r.ok ? r.data.camelot + ", " + r.data.votes + "/" + r.data.totalProfiles + " votes" : "error: " + r.error));
  }
  // S-KEY, the Music-mode third key opinion (its own worker, 22050 Hz input).
  const raw22 = path.join(dir, "tone22.raw");
  const s22 = new Float32Array(Math.floor(samples.length / 2));
  for (let i = 0; i < s22.length; i++) { s22[i] = samples[2 * i]; }
  fs.writeFileSync(raw22, Buffer.from(s22.buffer));
  const sk = JSON.parse(execFileSync(nodeBin, [path.join(ROOT, "worker", "skey-worker.js"), raw22],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 }));
  const skOk = sk.ok && sk.data.probs.length === 24;
  if (!skOk) { failures++; }
  console.log((skOk ? "ok   " : "FAIL ") + "S-KEY worker under " + (nodeBin === bundled ? "the bundled Node" : "this Node") +
    " - " + (sk.ok ? sk.data.key + " " + sk.data.scale : "error: " + sk.error));
} catch (e) {
  failures++;
  console.error("FAIL the worker did not start or crashed: " + (e && e.message ? e.message.split("\n")[0] : e));
} finally {
  fs.rmSync(dir, { recursive: true, force: true }); // throwaway fixture made above
}
if (failures) {
  process.exit(1);
}
console.log("\nworker starts and answers");
