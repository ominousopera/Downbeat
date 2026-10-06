"use strict";
// Evened-out markers: js/cuesheet.js evenOutTimes() replaces each beat time
// by a local straight tempo line through its neighbours, removing Beat This!'s
// 20 ms frame-grid steps. Checks:
//  - a steady track's times, rounded to the 20 ms grid, come back within 3 ms
//    of the true beats (they were up to 10 ms off);
//  - a tempo change starts a new run: neither side is pulled across;
//  - one bad detection (60 ms late) stays as detected and does not tilt its
//    neighbours;
//  - a gradual tempo drift is followed to within 5 ms (a strong one, 4 BPM
//    over 40 bars, only to within the 10 ms the grid steps gave: the line is
//    straight over the 9 bars around each time);
//  - fewer than 5 times, or a run shorter than 5, are left alone;
//  - the input is not changed.
// Run: node scripts/test-even-out.js
const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "js", "cuesheet.js"));
const C = global.BeatMarkerCuesheet;

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
const grid20 = function (t) { return Math.round(t / 0.02) * 0.02; };
const maxErrMs = function (got, truth, from, to) {
  let m = 0;
  for (let i = from; i < to; i++) { m = Math.max(m, Math.abs(got[i] - truth[i]) * 1000); }
  return m;
};
// A steady 102.9 BPM track, bars 2.33225 s apart.
const truth = [];
for (let k = 0; k < 50; k++) { truth.push(0.0456 + 2.33225 * k); }
const detected = truth.map(grid20);
const before = maxErrMs(detected, truth, 0, truth.length);
const copy = JSON.stringify(detected);
let r = C.evenOutTimes(detected, 4);
check("20 ms grid steps are evened out to within 3 ms of the true bars", maxErrMs(r.times, truth, 0, truth.length) <= 3,
  "max " + before.toFixed(1) + " -> " + maxErrMs(r.times, truth, 0, truth.length).toFixed(1) + " ms");
check("it reports what it moved", r.moved > 30 && r.maxShiftMs <= 25, "moved " + r.moved + ", median " + r.medianShiftMs.toFixed(1) + " ms");
check("the input is not changed", JSON.stringify(detected) === copy);
// Every beat at 128 BPM (0.46875 s), the wider window used for Bars + beats.
const beatsTruth = [];
for (let k = 0; k < 120; k++) { beatsTruth.push(1.003 + 0.46875 * k); }
r = C.evenOutTimes(beatsTruth.map(grid20), 8);
check("every-beat times too, with the wider window (4 ms at the run's ends)", maxErrMs(r.times, beatsTruth, 0, beatsTruth.length) <= 4,
  maxErrMs(r.times, beatsTruth, 0, beatsTruth.length).toFixed(1) + " ms");
// A tempo change: 20 bars at 2.4 s, then 20 at 2.0 s.
const change = [];
for (let k = 0; k < 20; k++) { change.push(0.5037 + 2.4 * k); }
for (let k = 1; k <= 20; k++) { change.push(change[19] + 2.0 * k); }
r = C.evenOutTimes(change.map(grid20), 4);
check("a tempo change starts a new run; neither side is pulled across", maxErrMs(r.times, change, 0, change.length) <= 4,
  maxErrMs(r.times, change, 0, change.length).toFixed(1) + " ms at most");
// One bad detection, 60 ms late.
const bad = detected.slice();
bad[20] += 0.06;
r = C.evenOutTimes(bad, 4);
check("a detection 60 ms off stays as detected (a bigger move is not a grid step)", Math.abs(r.times[20] - bad[20]) < 1e-9);
check("and does not tilt its neighbours", maxErrMs(r.times, truth, 15, 20) <= 3 && maxErrMs(r.times, truth, 21, 26) <= 3,
  maxErrMs(r.times, truth, 15, 20).toFixed(1) + " / " + maxErrMs(r.times, truth, 21, 26).toFixed(1) + " ms");
// A gradual drift: 120 -> 121 BPM over 40 bars, and a strong one, -> 124.
function drifting(bpmGain) {
  const d = [0.2037];
  for (let k = 1; k < 40; k++) { d.push(d[k - 1] + 240 / (120 + bpmGain * k / 40)); }
  return d;
}
const drift = drifting(1);
r = C.evenOutTimes(drift.map(grid20), 4);
check("a gradual tempo drift (1 BPM over 40 bars) is followed to within 5 ms", maxErrMs(r.times, drift, 0, drift.length) <= 5,
  maxErrMs(r.times, drift, 0, drift.length).toFixed(1) + " ms");
const strong = drifting(4);
r = C.evenOutTimes(strong.map(grid20), 4);
check("a strong drift is never worse than the grid steps were", maxErrMs(r.times, strong, 0, strong.length) <= 10,
  maxErrMs(r.times, strong, 0, strong.length).toFixed(1) + " ms (grid steps: up to 10 ms)");
// Too few times.
r = C.evenOutTimes([1.0, 3.32, 5.66, 7.98], 4);
check("fewer than 5 times are left alone", r.moved === 0 && r.times[1] === 3.32);
const shortRun = [0.5, 2.9, 5.3, 7.7, 9.0, 11.4, 13.8, 16.2, 18.6, 21.0, 23.4];
r = C.evenOutTimes(shortRun, 4);
check("a run shorter than 5 (before an irregular gap) is left alone", r.times[0] === 0.5 && r.times[3] === 7.7);

if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nmarker times are evened out along the tempo line");
