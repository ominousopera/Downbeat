"use strict";
// The tour numbers only the steps it shows: a hidden-feature step (the Cut
// panel's) is skipped, so "Step 4 of N" is followed by "Step 5 of N". Real
// panel (scripts/panel-harness.js) with a saved language, so the tour
// starts on its own.
// Run: node scripts/test-tour-step-count.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bootPanel } = require("./panel-harness.js");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-tour-"));
const DOCS = path.join(WORK, "docs");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: false, updateCheck: false }));

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

const panel = bootPanel({ docsDir: DOCS, realTimeouts: true, realIntervals: false });
const $ = panel.registry;

(async function () {
  await wait(50);
  if (!$.updatePickOverlay.hidden) { $.updatePickNoBtn._fire("click"); await wait(50); }
  check("the tour starts on a first run", !$.tourOverlay.hidden);
  const seen = [];
  for (let i = 0; i < 20 && !$.tourOverlay.hidden; i++) {
    seen.push($.tourStepIndicator.textContent);
    $.tourNextBtn._fire("click");
    await wait(20);
  }
  const numbers = seen.map(function (s) { return parseInt(s.replace(/^\D+/, ""), 10); });
  const totals = seen.map(function (s) { const m = s.match(/of (\d+)/); return m ? parseInt(m[1], 10) : null; });
  const gaps = numbers.filter(function (n, k) { return k > 0 && n !== numbers[k - 1] + 1; });
  check("the steps are numbered 1..N with no gap", numbers[0] === 1 && gaps.length === 0, seen.join(" | "));
  check("and N is the number of steps shown", totals.every(function (t) { return t === seen.length; }), "total " + totals[0] + ", shown " + seen.length);
  check("the tour ends after Next on every step", $.tourOverlay.hidden);
  fs.rmSync(WORK, { recursive: true, force: true });
  if (failures) {
    console.error("\n" + failures + " tour check(s) failed");
    process.exit(1);
  }
  console.log("\nthe tour counts only the steps it shows");
  process.exit(0);
})();
