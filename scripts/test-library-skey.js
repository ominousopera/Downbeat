"use strict";
// S-KEY in the Library scan: the half-rate filter, key results on local
// tracks, and fallbacks (S-KEY missing or throwing, SFX never asks). Track
// checks skip without ffmpeg and the local test tracks.
// Run: node scripts/test-library-skey.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PLATFORM_DIR = process.platform === "win32" ? "win-x64" : process.platform + "-" + process.arch;
const BUNDLED_NODE = path.join(ROOT, "runtime", "node", PLATFORM_DIR, process.platform === "win32" ? "node.exe" : "node");
const NODE = fs.existsSync(BUNDLED_NODE) ? BUNDLED_NODE : process.execPath;
if (process.execPath !== NODE) {
  try {
    execFileSync(NODE, [__filename], { stdio: "inherit" });
    process.exit(0);
  } catch (e) {
    process.exit(e.status || 1);
  }
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
// 1. The filter.
const core = require(path.join(ROOT, "worker", "skey-core.js"));
function toneGainDb(freq) {
  const s = new Float32Array(44100 * 2);
  for (let i = 0; i < s.length; i++) { s[i] = Math.sin(2 * Math.PI * freq * i / 44100); }
  const o = core.halfRate(s);
  let e = 0;
  for (let i = 1000; i < o.length - 1000; i++) { e += o[i] * o[i]; }
  return 20 * Math.log10(Math.sqrt(e / (o.length - 2000)) / Math.SQRT1_2 + 1e-12);
}
const pass = [100, 1000, 4000, 8000].map(toneGainDb);
const stop = [14000, 16000, 20000].map(toneGainDb);
check("the 22.05 kHz filter keeps 100 Hz - 8 kHz", pass.every(function (g) { return Math.abs(g) < 0.1; }), pass.map(function (g) { return g.toFixed(2); }).join(" / ") + " dB");
check("... and stops 14 - 20 kHz", stop.every(function (g) { return g < -70; }), stop.map(function (g) { return g.toFixed(0); }).join(" / ") + " dB");
// 2. Real tracks through the real worker (skipped without ffmpeg and the local test tracks).
const findTrack = require("./test-tracks.js").named;
const TRACKS = [
  ["track C", findTrack("perfect"), "11A", "2B"],
  ["track D", findTrack("tension"), "5A", "4A"],
  ["track B", findTrack("rejected"), "8A", "8A"]
];
function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; }
}
const haveTracks = hasFfmpeg() && TRACKS.every(function (t) { return fs.existsSync(t[1]); });
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-libskey-"));
const excerpts = [];

(async function () {
  if (!haveTracks) {
    console.log("skip - the track checks need ffmpeg and the test tracks in the test-music folder (see scripts/test-tracks.js)");
  } else {
    global.window = global;
    require(path.join(ROOT, "js", "sound-library.js"));
    const SL = global.BeatMarkerSoundLibrary;
    const items = TRACKS.map(function (t, i) {
      const raw = execFileSync("ffmpeg", ["-v", "error", "-i", t[1], "-f", "f32le", "-ar", "44100", "-ac", "1", "-"], { maxBuffer: 600 * 1024 * 1024 });
      const s = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const dur = s.length / 44100;
      const r = SL.excerptRange(dur, "music");
      const part = s.subarray(Math.floor(r.startSec * 44100), Math.floor((r.startSec + r.lengthSec) * 44100));
      excerpts.push(part);
      const file = path.join(WORK, "t" + i + ".raw");
      fs.writeFileSync(file, Buffer.from(part.buffer, part.byteOffset, part.byteLength));
      return { raw: file, material: "music", bpm: false, durationSec: dur };
    });
    const manifest = path.join(WORK, "manifest.json");
    fs.writeFileSync(manifest, JSON.stringify({ items: items }));
    const out = JSON.parse(execFileSync(NODE, [path.join(ROOT, "worker", "analyze-worker.js"), "library", manifest], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));
    TRACKS.forEach(function (t, i) {
      const r = out.data.results[i];
      check("library scan key, " + t[0], r.ok && r.camelot === t[3],
        r.ok ? r.camelot + " " + r.key + " " + r.scale : r.error);
    });
    // 3. In this process: S-KEY failing, and SFX.
    const { initNodeEssentiaEnvironment } = require(path.join(ROOT, "worker", "essentia-node-harness.js"));
    initNodeEssentiaEnvironment(ROOT);
    const A = global.BeatMarkerAnalyze;
    const failing = await A.analyzeLibraryItem(excerpts[0], "music", false, { skey: function () { return Promise.reject(new Error("model missing")); } });
    check("S-KEY failing leaves the vote", failing.camelot === TRACKS[0][2], failing.camelot);
    const throwing = await A.analyzeLibraryItem(excerpts[0], "music", false, { skey: function () { throw new Error("broken"); } });
    check("... also when it throws outright", throwing.camelot === TRACKS[0][2], throwing.camelot);
    let asked = 0;
    await A.analyzeLibraryItem(excerpts[0].subarray(0, 44100 * 10), "sfx", false, { skey: function () { asked++; return Promise.resolve(null); } });
    check("SFX never asks S-KEY", asked === 0, "asked " + asked + " time(s)");
  }
})()
  .catch(function (e) { failures++; console.error("FAIL " + (e && e.stack ? e.stack : e)); })
  .then(function () {
    fs.rmSync(WORK, { recursive: true, force: true }); // throwaway fixture made above
    if (failures) {
      console.error("\n" + failures + " Library S-KEY check(s) failed");
      process.exit(1);
    }
    console.log("\nthe Library scan's music keys use S-KEY and the chord key, and fall back to the vote");
    process.exit(0);
  });
