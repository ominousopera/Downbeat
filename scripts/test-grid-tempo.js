"use strict";
// The BPM shown from the markers: js/cuesheet.js tempoFromBeats() measures
// a grid's tempo over even spans of 32 beats (16, then 8, when none is
// even). Checks:
//   - beats on Beat This!'s 20 ms frames give the tempo within 0.1%, where
//     one interval alone is off by up to 4% and 8-beat spans alone read a
//     clean 128 as 127.66;
//   - a short grid falls back to 16- and 8-beat spans;
//   - a missed beat, a doubled beat and a loose intro do not move it;
//   - a song that changes tempo halfway reads as the tempo most of it has;
//   - typed arrays work (essentia's beats arrive as Float32Array);
//   - too few beats, or no even span, give 0 (the caller keeps essentia's
//     BPM);
//   - the input is not changed.
// Run: node scripts/test-grid-tempo.js
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
const beatsAt = function (bpm, count, start) {
  const out = [];
  for (let k = 0; k < count; k++) { out.push((start || 0.3) + k * 60 / bpm); }
  return out;
};
const relErr = function (got, want) { return Math.abs(got / want - 1); };

for (const bpm of [94, 120, 128, 143.7, 174]) {
  const beats = beatsAt(bpm, 200).map(grid20);
  const gaps = beats.slice(1).map(function (t, i) { return t - beats[i]; }).sort(function (a, b) { return a - b; });
  const oneInterval = 60 / gaps[gaps.length >> 1];
  const got = C.tempoFromBeats(beats);
  check(bpm + " BPM on 20 ms frames is read within 0.1%", relErr(got, bpm) <= 0.001,
    got.toFixed(2) + " (one interval: " + oneInterval.toFixed(2) + ")");
}

for (const count of [20, 12]) {
  const got = C.tempoFromBeats(beatsAt(140, count).map(grid20));
  check(count + " beats (no 32-beat span) still give the tempo within 0.5%", relErr(got, 140) <= 0.005, got.toFixed(2));
}

const steady = beatsAt(94, 160);
const missed = steady.slice(0, 60).concat(steady.slice(61));
const doubled = steady.slice(0, 80).concat([steady[80] + 0.08], steady.slice(81));
check("a missed beat does not move it", relErr(C.tempoFromBeats(missed), 94) <= 0.001, C.tempoFromBeats(missed).toFixed(2));
check("a doubled beat does not move it", relErr(C.tempoFromBeats(doubled), 94) <= 0.001, C.tempoFromBeats(doubled).toFixed(2));
const intro = [0.1, 0.9, 1.3, 2.6, 2.9].concat(beatsAt(94, 100, 3.5));
check("a loose intro does not move it", relErr(C.tempoFromBeats(intro), 94) <= 0.001, C.tempoFromBeats(intro).toFixed(2));

const change = beatsAt(100, 120);
const after = beatsAt(130, 60, change[change.length - 1] + 60 / 130);
const both = change.concat(after);
check("a tempo change reads as the tempo most of the song has", relErr(C.tempoFromBeats(both), 100) <= 0.001, C.tempoFromBeats(both).toFixed(2));

const typed = new Float32Array(beatsAt(128, 100).map(grid20));
check("a Float32Array works", relErr(C.tempoFromBeats(typed), 128) <= 0.001, C.tempoFromBeats(typed).toFixed(2));

check("8 beats or fewer give 0", C.tempoFromBeats(beatsAt(120, 9).slice(0, 8)) === 0 && C.tempoFromBeats([]) === 0 && C.tempoFromBeats(null) === 0);
const loose = [];
let t = 0;
for (let k = 0; k < 60; k++) { t += (k % 2 ? 0.4 : 0.7); loose.push(t); }
check("no even span gives 0", C.tempoFromBeats(loose) === 0);

const input = beatsAt(110, 50).map(grid20), copy = JSON.stringify(input);
C.tempoFromBeats(input);
check("the input is not changed", JSON.stringify(input) === copy);

if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
console.log("PASS: tempo from the beats");
