"use strict";
// Doubled Beat This! beats are merged: worker/beatthis-pipeline.js's
// postprocessMinimal() keeps one beat (the later) of any two closer than a
// quarter of the median beat interval, and a downbeat that sat on either
// becomes one downbeat. A regular grid is untouched.
// Run: node scripts/test-beat-merge.js
const path = require("path");
const { postprocessMinimal, mergeCloseBeats, FRAME_RATE } = require(path.join(__dirname, "..", "worker", "beatthis-pipeline.js"));

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
// Peaks every 30 frames (100 BPM at 50 fps), one doubled 4 frames later.
const regular = [];
for (let f = 30; f <= 600; f += 30) { regular.push(f); }
check("a regular grid is left alone", JSON.stringify(mergeCloseBeats(regular)) === JSON.stringify(regular));
const doubled = regular.slice(0, 10).concat([304], regular.slice(10));
const merged = mergeCloseBeats(doubled);
check("a doubled beat 4 frames (80 ms) apart becomes one - the later",
  merged.length === regular.length && merged.indexOf(304) !== -1 && merged.indexOf(300) === -1, merged.slice(8, 12).join(","));
check("a beat half a beat apart is kept (a real double-time passage)",
  mergeCloseBeats(regular.slice(0, 10).concat([315], regular.slice(10))).length === regular.length + 1);
// Through the whole postprocessor: logits with peaks where beats and
// downbeats are, the downbeat head firing on both halves of the double.
function logits(frames, n) {
  const a = new Float32Array(n).fill(-5);
  frames.forEach(function (f) { a[f] = 3; });
  return a;
}
const n = 640;
const out = postprocessMinimal(logits(doubled, n), logits([30, 150, 270, 300, 304, 390, 510], n));
const beatFrames = out.beatTimes.map(function (t) { return Math.round(t * FRAME_RATE); });
const downFrames = out.downbeatTimes.map(function (t) { return Math.round(t * FRAME_RATE); });
check("postprocess: no two beats closer than a quarter beat", beatFrames.every(function (f, i) { return i === 0 || f - beatFrames[i - 1] >= 8; }), beatFrames.slice(8, 12).join(","));
check("postprocess: the doubled downbeat is one downbeat, on the kept beat",
  JSON.stringify(downFrames) === JSON.stringify([30, 150, 270, 304, 390, 510]), downFrames.join(","));

if (failures) {
  console.error("\n" + failures + " beat merge check(s) failed");
  process.exit(1);
}
console.log("\ndoubled beats merge into one, a regular grid is untouched");
