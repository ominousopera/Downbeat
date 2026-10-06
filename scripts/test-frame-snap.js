"use strict";
// js/cuesheet.js snapToFrameStart() and mapEventsToSequenceSeconds(): marker
// times move back to the start of their video frame on the timeline's grid,
// also on re-sped and reversed clips; times in one frame merge.
// Run: node scripts/test-frame-snap.js.
const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "js", "cuesheet.js"));
const C = global.BeatMarkerCuesheet;

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
const near = function (a, b) { return Math.abs(a - b) < 1e-6; };

let r = C.snapToFrameStart([10.51, 10.55, 11.2], ["D", "D", "D"], { frameRate: 25 }, false);
check("timeline times move back to their frame's start, never forward",
  near(r.times[0], 10.48) && near(r.times[1], 10.52) && r.times.every(function (t, i) { return t <= [10.51, 10.55, 11.2][i] + 1e-9; }), r.times.join(", "));
check("a time exactly on a frame stays", near(r.times[2], 11.2));
r = C.snapToFrameStart([2.5, 3.0], ["D", "D"], { frameRate: 25, clipStartSeconds: 10, inPointSeconds: 2.01 }, true);
check("clip-marker times snap on the timeline's grid, through the clip's position",
  near(r.times[0], 2.49) && near(r.times[1], 2.97), r.times.join(", ") + " (timeline " + r.times.map(function (t) { return (t + 7.99).toFixed(2); }).join(", ") + ")");
r = C.snapToFrameStart([1.0], ["D"], { frameRate: 30000 / 1001 }, false);
check("29.97 fps uses the exact rate", near(r.times[0], 29 * 1001 / 30000), r.times[0].toFixed(6));
r = C.snapToFrameStart([2.5, 2.519, 2.521, 3.0], ["D", "s", "s", "D"], { frameRate: 25, clipStartSeconds: 10, inPointSeconds: 2.01 }, true);
check("times in the same frame merge into one marker, the first label kept",
  r.times.length === 2 && r.merged === 2 && r.labels.join(",") === "D,D", JSON.stringify(r));
// A clip the Key tab re-sped: 2x, so the file's 4 s is the timeline's 2 s
// after the clip's start.
r = C.snapToFrameStart([4.01], ["D"], { frameRate: 25, clipStartSeconds: 10, inPointSeconds: 0, speed: 2 }, true);
check("a re-sped clip: file seconds snap on the timeline's frame grid (4.01 s at 2x = 12.005 -> frame 12.00 = 4.00 s)", near(r.times[0], 4.0), r.times.join(", "));
const mapped = C.mapEventsToSequenceSeconds({ tracks: [{ id: "t", events: [{ t: 4 }, { t: 100 }] }] },
  { clipStartSeconds: 10, inPointSeconds: 0, outPointSeconds: 60, speed: 2 }, "t");
check("a re-sped clip: the timeline position is clipStart + (t - in) / speed", near(mapped.times[0], 12) && mapped.times.length === 1 && mapped.droppedCount === 1, mapped.times.join(", "));
// A reversed clip: the used part 0-60 s of the file plays backwards from the
// clip start (10 s), so file second 58 is at timeline 12 s.
const revMapped = C.mapEventsToSequenceSeconds({ tracks: [{ id: "t", events: [{ t: 58 }, { t: 60 }] }] },
  { clipStartSeconds: 10, inPointSeconds: 0, outPointSeconds: 60, speed: 1, reversed: true }, "t");
check("a reversed clip: the part's end sits at the clip's start (58 s -> 12 s, 60 s -> 10 s)", near(revMapped.times[0], 12) && near(revMapped.times[1], 10), revMapped.times.join(", "));
r = C.snapToFrameStart([57.99], ["D"], { frameRate: 25, clipStartSeconds: 10, inPointSeconds: 0, outPointSeconds: 60, speed: 1, reversed: true }, true);
check("a reversed clip: snapping never moves a marker later on the timeline (file 57.99 -> timeline 12.01 -> frame 12.00 = file 58.00)", near(r.times[0], 58), r.times.join(", "));
r = C.snapToFrameStart([1.234], ["D"], {}, false);
check("without a frame rate nothing moves", near(r.times[0], 1.234));

if (failures) {
  console.error("\n" + failures + " frame snap check(s) failed");
  process.exit(1);
}
console.log("\nmarkers go to the start of their beat's video frame");
