"use strict";
// Runs Settings > Run full self-test end to end, the way a user would click
// it, with the real jsx/host.jsx answering from a stand-in Premiere or After
// Effects (scripts/host-mocks.js), the real workers doing the analysis, and
// ffmpeg in place of Web Audio.
// Slow (a few minutes: it runs Analyze, Beat This!, three key detections,
// retempo and every other step), so it is not part of build-zxp.sh; run it
// after changing the self-test or the host scripts.
// Run: node scripts/test-self-test.js      (Premiere, then After Effects)
//      node scripts/test-self-test.js ppro|ae   (one host)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const mode = process.argv[2];
if (!mode) {
  let failed = 0;
  for (const m of ["ppro", "ae"]) {
    const r = spawnSync(process.execPath, [__filename, m], { stdio: "inherit" });
    if (r.status !== 0) { failed++; }
  }
  process.exit(failed ? 1 : 0);
}
// DOWNBEAT_ROOT: build-zxp.sh points this at the staged release copy.
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const TRACK = require("./test-tracks.js").named("applies");
function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; }
}
if (!fs.existsSync(TRACK) || !hasFfmpeg()) {
  console.log("skip - needs ffmpeg and the local test track (see scripts/test-tracks.js)");
  process.exit(0);
}
function decode(file, rate) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ar", String(rate), "-ac", "1", "-"],
    { maxBuffer: 600 * 1024 * 1024 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
const samples44 = decode(TRACK, 44100);
const samples22 = decode(TRACK, 22050);
const durationSec = samples44.length / 44100;

const mocks = require("./host-mocks.js");
const isAe = mode === "ae";
const hostName = isAe ? "After Effects" : "Premiere";
const fake = isAe
  ? mocks.makeAeHost({ mediaPath: TRACK, durationSec: durationSec, startTime: 10 })
  : mocks.makePremiereHost({ mediaPath: TRACK, durationSec: durationSec, clipStart: 10 });
const host = mocks.loadHost(fake.context);

const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-selftest-"));
fs.mkdirSync(path.join(DOCS, "Downbeat"));
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));

const { bootPanel } = require("./panel-harness.js");
const panel = bootPanel({ docsDir: DOCS, evalScript: host.evalScript, realTimeouts: true, realIntervals: true, appName: isAe ? "AEFT" : "PPRO" });
const $ = panel.registry;
window.BeatMarkerAudio.readFileAsArrayBuffer = function () { return Promise.resolve(new ArrayBuffer(8)); };
window.BeatMarkerAudio.decodeToMono44100 = function () {
  return Promise.resolve({ samples: samples44, original: { durationSec: durationSec, sampleRate: 44100, channels: 2 } });
};
window.BeatMarkerAudio.decodeFileToMono44100 = function () { return window.BeatMarkerAudio.decodeToMono44100(); };
window.BeatMarkerAudio.resampleMono = function (samples, from, to) {
  return Promise.resolve(to === 22050 ? samples22 : samples);
};

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   [" + hostName + "] " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL [" + hostName + "] " + label + (detail ? " - " + detail : "")); }
}
// Timing: Premiere only; After Effects always places on the frame, so Timing
// and Shift are hidden there.
{
  const timingHidden = $.timingKey.hidden && $.timingOpts.hidden;
  const shiftHidden = $.nudgeKey.hidden && $.nudgeOpts.hidden;
  check(isAe ? "Timing and Shift are hidden in After Effects" : "Timing is shown in Premiere (Shift only with Exact)",
    isAe ? (timingHidden && shiftHidden) : (!timingHidden && shiftHidden));
  check(isAe ? "After Effects shows the note on what is limited there" : "Premiere does not show the After Effects note",
    isAe ? !$.aeNote.hidden : $.aeNote.hidden);
}
function finish() {
  fs.rmSync(DOCS, { recursive: true, force: true }); // throwaway fixture made above
  if (failures) {
    console.error("\n" + failures + " self-test check(s) failed in " + hostName);
    process.exit(1);
  }
  console.log("\nthe full self-test passes in " + hostName + "\n");
  process.exit(0);
}

const t0 = Date.now();
console.log("running the full self-test in a stand-in " + hostName + " (takes a few minutes)...");
$.runSelfTestBtn._fire("click");
(function wait() {
  const log = $.log.textContent;
  if (/=== SELF-TEST END/.test(log)) { return report(log); }
  if (Date.now() - t0 > 15 * 60 * 1000) { check("the self-test finished within 15 minutes", false); return finish(); }
  setTimeout(wait, 500);
})();

function report(log) {
  const summary = log.slice(log.indexOf("--- SELF-TEST SUMMARY ---"), log.indexOf("=== SELF-TEST END"));
  const lines = summary.split("\n").filter(function (l) { return /\[(PASS|FAIL|SKIP)\]/.test(l); });
  lines.forEach(function (l) { console.log("       " + l.trim()); });
  const failed = lines.filter(function (l) { return /\[FAIL\]/.test(l); });
  check("the self-test finished, " + ((Date.now() - t0) / 1000).toFixed(0) + " s", true);
  check("its summary has no FAIL line", lines.length > 10 && failed.length === 0,
    lines.length + " lines, " + failed.length + " failed" + (failed.length ? ": " + failed[0].trim() : ""));
  const hostErrors = log.split("\n").filter(function (l) { return /EvalScript error|syntax error|not stubbed|is not a function/.test(l); });
  check("no host-script errors anywhere in the log", hostErrors.length === 0, hostErrors[0] || "");
  const skipped = lines.filter(function (l) { return /\[SKIP\]/.test(l); }).map(function (l) { return l.trim().replace(/^\[SKIP\] /, "").split(" - ")[0]; });
  console.log("       (skipped: " + (skipped.join("; ") || "none") + ")");

  if (isAe) {
    const comp = fake.comp;
    const pieces = comp.layers.filter(function (l) { return l.source === fake.audioSource; });
    const selected = pieces.filter(function (l) { return l.selected; });
    check("the real cuts split the layer", pieces.length > 10, pieces.length + " pieces");
    check("exactly one piece is still selected", selected.length === 1, selected.length + " selected");
    check("test and pasted markers were cleaned off the selected piece and the comp",
      selected.length === 1 && selected[0].markers.numKeys === 0 && comp.markerProperty.numKeys === 0,
      (selected[0] ? selected[0].markers.numKeys : "?") + " layer markers, " + comp.markerProperty.numKeys + " comp markers left");
    check("no undo group left open", fake.state.undoDepth === 0, "depth " + fake.state.undoDepth);
  } else {
    const clips = fake.audioTrack.clips;
    const selected = clips.filter(function (c) { return c.selected; });
    check("the real cuts split the clip", clips.length > 10, clips.length + " pieces");
    check("exactly one piece is still selected", selected.length === 1, selected.length + " selected");
    check("test and pasted markers were cleaned up", fake.sequence.markers.numMarkers === 0 && fake.clipMarkers.numMarkers === 0,
      fake.sequence.markers.numMarkers + " sequence markers, " + fake.clipMarkers.numMarkers + " clip markers left");
  }
  finish();
}
