"use strict";
// The SFX "has a pitch" gate (hasPitch() in js/sound-library.js, fed by the
// pitch measures of js/analyze.js): noisy sounds lose their key, tonal ones
// keep it, and records without the measures keep it. Re-runs itself under the
// bundled Node, like the workers. Run: node scripts/test-sfx-pitch-gate.js.
const fs = require("fs");
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

const SR = 44100;
let seed = 12345;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
function tones(freqs, sec) {
  const s = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < s.length; i++) {
    let v = 0;
    for (const f of freqs) { v += Math.sin(2 * Math.PI * f * i / SR); }
    s[i] = 0.3 * v / freqs.length;
  }
  return s;
}
function whiteNoise(sec) {
  const s = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < s.length; i++) { s[i] = 0.5 * rnd(); }
  return s;
}
function pinkNoise(sec) { // Paul Kellet's filter
  const s = new Float32Array(Math.round(sec * SR));
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < s.length; i++) {
    const w = rnd();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    s[i] = 0.2 * (b0 + b1 + b2 + w * 0.1848);
  }
  return s;
}

(async function () {
  const { initNodeEssentiaEnvironment } = require(path.join(ROOT, "worker", "essentia-node-harness.js"));
  initNodeEssentiaEnvironment(ROOT);
  require(path.join(ROOT, "js", "sound-library.js"));
  const A = global.BeatMarkerAnalyze, SL = global.BeatMarkerSoundLibrary;

  async function judge(samples) {
    const r = await A.analyzeLibraryItem(samples, "sfx", false);
    r.section = "sfx";
    return r;
  }
  const cases = [
    ["a 440 Hz tone", tones([440], 2), true],
    ["a C major chord (C4 E4 G4)", tones([261.63, 329.63, 392.0], 3), true],
    ["a 50 ms 1 kHz beep (shorter than one frame)", tones([1000], 0.05), true],
    ["white noise", whiteNoise(2), false],
    ["pink noise", pinkNoise(3), false],
    ["silence", new Float32Array(SR), false]
  ];
  for (const [label, samples, expected] of cases) {
    const r = await judge(samples);
    check(label + (expected ? " has a pitch" : " has no pitch"), SL.hasPitch(r) === expected,
      "crest " + r.pitchCrest + ", flatness " + r.pitchFlatness + ", key strength " + (r.strength === null ? "-" : r.strength.toFixed(2)));
  }
  // Records that always keep their key.
  const noisy = { section: "sfx", pitchCrest: 2.1, pitchFlatness: 0.3, strength: 0.3, camelot: "5A" };
  check("a noisy SFX record has no pitch", SL.hasPitch(noisy) === false);
  check("... unless its name states the key", SL.hasPitch(Object.assign({}, noisy, { keyFrom: "name" })) === true);
  check("music always keeps its key", SL.hasPitch(Object.assign({}, noisy, { section: "music" })) === true);
  check("a record scanned before the check keeps its key",
    SL.hasPitch({ section: "sfx", camelot: "5A", strength: 0.3 }) === true);
  check("a peaky spectrum needs a confident key vote",
    SL.hasPitch({ section: "sfx", pitchCrest: 3.0, pitchFlatness: 0.001, strength: 0.7 }) === true &&
    SL.hasPitch({ section: "sfx", pitchCrest: 3.0, pitchFlatness: 0.001, strength: 0.4 }) === false);
  // Search.
  const items = [
    { name: "tone", section: "sfx", camelot: "5A", pitchCrest: 6, pitchFlatness: 0.001, strength: 0.9 },
    { name: "rain", section: "sfx", camelot: "5A", pitchCrest: 2, pitchFlatness: 0.3, strength: 0.3 }
  ];
  const byKey = SL.search(items, { camelot: "5A", keyMode: "exact" }).map(function (x) { return x.name; });
  const byName = SL.search(items, { text: "" }).map(function (x) { return x.name; });
  check("a key search skips the sound with no pitch", byKey.join(",") === "tone", byKey.join(","));
  check("... other searches still list it", byName.length === 2, byName.join(","));
  // Optional: real sounds with a known key. Set DOWNBEAT_SFX_REFERENCE to a
  // folder with a _keys.json list ([{file, key}]); skipped otherwise.
  const refDir = process.env.DOWNBEAT_SFX_REFERENCE || require("./test-tracks.js").localSetting("sfxReference") || path.join(__dirname, "no-sfx-reference");
  const wav = require(path.join(ROOT, "worker", "wav-excerpt.js"));
  const refs = fs.existsSync(path.join(refDir, "_keys.json")) ? JSON.parse(fs.readFileSync(path.join(refDir, "_keys.json"), "utf8")).slice(0, 12) : [];
  if (!refs.length) {
    console.log("skip - no reference sounds (set DOWNBEAT_SFX_REFERENCE)");
  } else {
    let kept = 0;
    for (const k of refs) {
      const p = path.join(refDir, k.file);
      const info = wav.probe(p);
      const range = SL.excerptRange(info.durationSec, "sfx");
      const r = await judge(wav.readExcerpt(p, info, range.startSec, range.lengthSec));
      if (SL.hasPitch(r)) { kept++; }
    }
    check("labelled tonal sounds (key in the file name) mostly have a pitch", kept >= refs.length - 2, kept + " of " + refs.length);
  }
})()
  .catch(function (e) { failures++; console.error("FAIL " + (e && e.stack ? e.stack : e)); })
  .then(function () {
    if (failures) {
      console.error("\n" + failures + " SFX pitch check(s) failed");
      process.exit(1);
    }
    console.log("\nsound effects without a pitch lose their key, the rest keep it");
    process.exit(0);
  });
