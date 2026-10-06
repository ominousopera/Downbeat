"use strict";
// The one-time question about the update notice: asked on the very first
// run (after the language), asked once for someone who has not answered yet,
// never asked again, and neither answer makes a request unless it is "yes".
// Each scenario boots the panel in its own process.
// Run: node scripts/test-update-question.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const scenario = process.argv[2];
if (!scenario) {
  let failed = false;
  ["first-yes", "returning-no", "answered"].forEach(function (name) {
    try {
      process.stdout.write(execFileSync(process.execPath, [__filename, name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(function (l) { return /^(ok|FAIL)/.test(l); }).join("\n") + "\n");
    } catch (e) {
      failed = true;
      process.stdout.write((e.stdout || "") + (e.stderr || ""));
    }
  });
  if (failed) { process.exit(1); }
  console.log("\nthe update-notice question is asked once, and only \"yes\" asks GitHub");
  process.exit(0);
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + scenario + ": " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.log("FAIL " + scenario + ": " + label + (detail ? " - " + detail : "")); }
}
const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-updq-"));
const DATA = path.join(DOCS, "Downbeat");
fs.mkdirSync(DATA, { recursive: true });
if (scenario === "returning-no") {
  fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));
} else if (scenario === "answered") {
  fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
}
let requests = 0;
const panel = require("./panel-harness.js").bootPanel({ docsDir: DOCS, realTimeouts: true });
window.BeatMarkerUpdateCheck.fetchLatest = function (cb) { requests++; setImmediate(function () { cb(null, { version: "1.0.1", url: "https://github.com/ominousopera/Downbeat/releases/latest" }); }); };
const r = panel.registry;
function saved() { return JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf8")); }
(async function () {
  if (scenario === "first-yes") {
    check("first run: the language is asked first, the update question waits", r.langPickOverlay.hidden === false && r.updatePickOverlay.hidden === true);
    const choose = panel.select("#langPickOverlay .lang-btn")[0];
    choose._fire("click");
    check("after the language, the update question shows (and the tour waits)", r.updatePickOverlay.hidden === false && r.langPickOverlay.hidden === true && r.tourOverlay.hidden === true);
    r.updatePickYesBtn._fire("click");
    await new Promise(function (res) { setTimeout(res, 30); });
    check("yes: saved on, one request, the question is gone, the tour starts",
      saved().updateCheck === true && requests === 1 && r.updatePickOverlay.hidden === true && r.tourOverlay.hidden === false, JSON.stringify({ req: requests }));
    check("the switch in Settings reads on", r.updateCheckCheckbox.checked === true);
  } else if (scenario === "returning-no") {
    check("a returning user who never answered is asked once, on start", r.updatePickOverlay.hidden === false && r.langPickOverlay.hidden === true);
    r.updatePickNoBtn._fire("click");
    await new Promise(function (res) { setTimeout(res, 30); });
    check("no: saved off, no request, the question is gone, the switch is off",
      saved().updateCheck === false && requests === 0 && r.updatePickOverlay.hidden === true && r.updateCheckCheckbox.checked === false);
  } else {
    check("an answered question is never asked again", r.updatePickOverlay.hidden === true && requests === 0);
  }
  fs.rmSync(DOCS, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})();
