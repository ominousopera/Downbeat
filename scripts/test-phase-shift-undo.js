"use strict";
// The "1" buttons (beat 1-4) re-place Downbeat's markers. When the host
// refuses that (here: the selected clip now holds another file), the shown
// beat goes back to what the markers on the clip show, so the two always
// agree. Real panel, real jsx/host.jsx on the Premiere stand-in.
// Run: node scripts/test-phase-shift-undo.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const mocks = require("./host-mocks.js");
const { bootPanel } = require("./panel-harness.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-phase-undo-"));
const DOCS = path.join(WORK, "docs");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
const fake = mocks.makePremiereHost({ mediaPath: "/music/song.wav", durationSec: 30, clipStart: 0 });
const host = mocks.loadHost(fake.context);
const panel = bootPanel({ docsDir: DOCS, evalScript: host.evalScript, realTimeouts: true, realIntervals: false });
const $ = panel.registry;
function markerTimes() { return fake.clipMarkers.list.map(function (m) { return m.start.seconds.toFixed(3); }).join(","); }

$.manualBpmInput.value = "120";
$.manualBpmBtn._fire("click");
wait(300).then(function () {
  $.placeMarkersBtn._fire("click");
  return wait(400);
}).then(function () {
  const placed = markerTimes();
  check("Place markers put the downbeats on the clip", fake.clipMarkers.list.length > 0 && $.phaseDisplay.textContent === "0", placed);
  $.phaseBeat2._fire("click");
  return wait(400).then(function () {
    check("a successful beat-2 choice moves the markers and shows +1", $.phaseDisplay.textContent === "+1" && markerTimes() !== placed,
      $.phaseDisplay.textContent);
    const moved = markerTimes();
    // Another file is selected now; the host-side check refuses to place.
    fake.audioTrack.clips[0].projectItem.getMediaPath = function () { return "/music/other.wav"; };
    $.phaseBeat3._fire("click");
    return wait(400).then(function () {
      check("a refused beat-3 choice keeps showing +1, the markers stay", $.phaseDisplay.textContent === "+1" && markerTimes() === moved,
        $.phaseDisplay.textContent);
      fake.audioTrack.clips[0].projectItem.getMediaPath = function () { return "/music/song.wav"; };
      $.phaseBeat3._fire("click");
      return wait(400).then(function () {
        check("choosing beat 3 again after reselecting the clip works from the right place",
          $.phaseDisplay.textContent === "+2" && markerTimes() !== moved, $.phaseDisplay.textContent);
      });
    });
  });
}).then(function () {
  fs.rmSync(WORK, { recursive: true, force: true });
  if (failures) {
    console.error(failures + " check(s) failed");
    process.exit(1);
  }
  console.log("PASS phase shift undo");
  process.exit(0);
}).catch(function (e) { console.error("FAIL " + (e && e.stack || e)); process.exit(1); });
