"use strict";
// A star in the Library is saved when it is clicked: a panel closed right
// after (none of its pending timers run) still shows the star on the next
// start, and taking the star off is kept the same way. Each start is the
// real panel (panel-harness) in its own Node process on one
// Documents/Downbeat.
// Run: node scripts/test-favorite-saved-at-once.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HARNESS = path.join(__dirname, "panel-harness.js");

// One start of the panel: reads the sound's star and, with "click", clicks
// it and closes before any timer fires.
if (process.argv[2] === "host") {
  const docs = process.argv[3], click = process.argv[4] === "click";
  const h = require(HARNESS).bootPanel({ docsDir: docs });
  const item = Object.values(window.BeatMarkerSoundLibrary.getState().files)[0];
  const before = !!item.fav;
  if (click) {
    global.setTimeout = function () { return 0; };
    const row = h.registry.libraryDisplay.children.find(function (x) { return /lib-row/.test(x.className || ""); });
    const star = row.children.find(function (x) { return /lib-fav/.test(x.className || ""); });
    star._fire("click", { stopPropagation: function () {} });
  }
  console.log("RESULT " + JSON.stringify({ before: before, after: !!item.fav }));
  process.exit(0);
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-favorite-"));
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function start(click) {
  const out = execFileSync(process.execPath, [__filename, "host", WORK, click ? "click" : "read"], { encoding: "utf8", timeout: 20000 });
  const line = out.split("\n").find(function (x) { return x.indexOf("RESULT ") === 0; });
  return JSON.parse(line.slice(7));
}

try {
  const dir = path.join(WORK, "Downbeat");
  const audio = path.join(WORK, "sound.wav");
  fs.mkdirSync(dir);
  fs.writeFileSync(audio, "fixture");
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false, librarySection: "music" }));
  fs.writeFileSync(path.join(dir, "sound-library.json"), JSON.stringify({
    version: 1, folders: { music: [WORK], sfx: [] },
    files: { [audio]: { path: audio, name: "sound.wav", section: "music", status: "done", v: 3, nameChecked: 1, bpm: 120 } }
  }));

  const on = start(true);
  check("the click puts the star on", !on.before && on.after, JSON.stringify(on));
  check("the star is there after a quick close", start(false).before);
  const off = start(true);
  check("a second click takes it off", off.before && !off.after, JSON.stringify(off));
  check("taking it off is kept after a quick close", !start(false).before);
} catch (e) {
  failures++;
  console.error("FAIL " + (e && e.stack || e));
} finally {
  fs.rmSync(WORK, { recursive: true, force: true });
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nall favorite save checks passed");
