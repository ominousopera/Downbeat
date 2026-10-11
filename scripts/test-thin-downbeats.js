"use strict";
// Close "1"s and the uneven warning: js/cuesheet.js
// thinCloseDownbeats() drops a "1" that comes less than 1.5 beats after
// another, never moves or adds one; downbeatsLookUneven() drives the
// warning row for Beat This! grids. Checks:
//   - an even grid of "1"s every 4 beats comes back unchanged;
//   - a stray "1" one beat after a real one is dropped, the real ones stay;
//   - "1"s two beats apart (a real bar on a half-time beat list) are kept;
//   - a stretch with a "1" on every beat keeps one every 2 beats (the
//     limit is 1.5 beats; two beats apart can be a real bar), including
//     every "1" of the even grid around it, and no kept time is moved;
//   - fewer than 3 "1"s or 8 beats, and the input array, are left alone;
//   - the warning: off for an even grid and for a short clip, on when a
//     quarter or more of the gaps are off by more than 20%.
// Run: node scripts/test-thin-downbeats.js
const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "js", "cuesheet.js"));
const C = global.BeatMarkerCuesheet;

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
const IBI = 0.5; // 120 BPM
const beats = [];
for (let i = 0; i < 128; i++) { beats.push(+(i * IBI).toFixed(3)); }
const every4 = beats.filter((_, i) => i % 4 === 0);
const same = (a, b) => a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < 1e-9);

let r = C.thinCloseDownbeats(beats, every4);
check("an even grid comes back unchanged", same(r.times, every4) && r.dropped === 0);

const stray = every4.concat([beats[17], beats[41]]).sort((a, b) => a - b);
r = C.thinCloseDownbeats(beats, stray);
check("a stray \"1\" one beat after a real one is dropped", same(r.times, every4) && r.dropped === 2,
  JSON.stringify(r.times.slice(0, 8)));

const halfTime = beats.filter((_, i) => i % 2 === 0);
r = C.thinCloseDownbeats(beats, halfTime);
check("\"1\"s two beats apart are kept", same(r.times, halfTime) && r.dropped === 0);

const messy = every4.filter((t) => t < 20 || t >= 40).concat(beats.filter((t) => t >= 20 && t < 40)).sort((a, b) => a - b);
r = C.thinCloseDownbeats(beats, messy);
const gaps = r.times.slice(1).map((t, i) => t - r.times[i]);
check("a \"1\" on every beat thins to one every 2 beats, in line with the rest",
  every4.every((t) => r.times.indexOf(t) >= 0) && gaps.every((g) => g >= 1.5 * IBI - 1e-9) &&
  r.times.filter((t) => t >= 20 && t < 40).length === 20,
  r.times.filter((t) => t >= 18 && t < 42).join(","));
check("no kept time is moved", r.times.every((t) => messy.indexOf(t) >= 0));

const input = stray.slice();
C.thinCloseDownbeats(beats, input);
check("the input array is not changed", same(input, stray));
check("fewer than 3 \"1\"s are left alone", same(C.thinCloseDownbeats(beats, [0, 0.5]).times, [0, 0.5]));
check("fewer than 8 beats are left alone", same(C.thinCloseDownbeats(beats.slice(0, 6), [0, 0.5, 1]).times, [0, 0.5, 1]));

check("warning: off for an even grid", !C.downbeatsLookUneven(every4));
const uneven = [];
for (let b = 0, t = 0; b < 24; b++) { uneven.push(t); t += (b % 3 === 0) ? 1.0 : 2.0; }
check("warning: on when a third of the gaps are off", C.downbeatsLookUneven(uneven));
check("warning: off for a short clip (under 8 gaps)", !C.downbeatsLookUneven(uneven.slice(0, 6)));
check("warning: off with no downbeats", !C.downbeatsLookUneven(null) && !C.downbeatsLookUneven([]));

if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nClose \"1\"s are dropped and uneven grids are flagged");
