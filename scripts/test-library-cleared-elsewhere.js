"use strict";
// Settings > Library > Clear in the other host (Premiere and After Effects
// share Documents/Downbeat): this panel's list empties, and the line under
// it says so instead of speaking of the old list (a scan's result).
//   - the panel window getting the focus back takes the Clear in: no rows,
//     the line says the library was cleared in the other app;
//   - a star clicked on a row drawn before the Clear does not land, and the
//     line says the sound was taken out there.
// The real panel (panel-harness); the other host's save is written by hand.
// Run: node scripts/test-library-cleared-elsewhere.js
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.log("FAIL " + label + (detail ? " - " + detail : "")); }
}

const HARNESS = path.join(__dirname, "panel-harness.js");
const mode = process.argv[2];

if (mode === "focus" || mode === "star") {
  const docs = process.argv[3];
  const t0 = Number(process.argv[4]);
  Date.now = function () { return t0 + 2000; };
  const h = require(HARNESS).bootPanel({ docsDir: docs });
  const R = h.registry;
  const I18n = window.BeatMarkerI18n;
  function rows() { return R.libraryDisplay.children.filter(function (x) { return /lib-row/.test(x.className || ""); }); }
  check(mode + ": the list starts with both sounds", rows().length === 2, rows().length + " rows");
  const oldLine = I18n.t("library.scanPartial");
  R.libScanStatus.textContent = oldLine;
  const drawnBefore = rows()[0];
  // The other host's Clear, saved after this panel loaded.
  fs.writeFileSync(path.join(docs, "Downbeat", "sound-library.json"), JSON.stringify({
    version: 1, folders: { music: [], sfx: [] }, files: {},
    removedFolders: { ["sfx\n" + docs]: t0 + 1000 }, clearedAt: { music: t0 + 1000, sfx: t0 + 1000 }
  }));
  if (mode === "focus") {
    window._fireWindow("focus");
    check("focus: the other host's Clear empties the list", rows().length === 0, rows().length + " rows");
    check("focus: the line says the library was cleared in the other app",
      R.libScanStatus.textContent === I18n.t("library.clearedElsewhere"), R.libScanStatus.textContent);
  } else {
    const star = drawnBefore.children.find(function (x) { return /lib-fav/.test(x.className || ""); });
    star._fire("click", { stopPropagation: function () {} });
    check("star: the star does not land", star.getAttribute("aria-pressed") !== "true" &&
      !Object.keys(window.BeatMarkerSoundLibrary.getState().files).length, star.getAttribute("aria-pressed"));
    check("star: the list empties", rows().length === 0, rows().length + " rows");
    check("star: the line says the sound was taken out in the other app",
      R.libScanStatus.textContent === I18n.t("library.goneElsewhere"), R.libScanStatus.textContent);
  }
  check(mode + ": the old line is gone", R.libScanStatus.textContent !== oldLine);
  console.log("FAILURES " + failures);
  process.exit(0);
}

const { execFileSync } = require("child_process");
for (const run of ["focus", "star"]) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-cleared-elsewhere-"));
  try {
    const dir = path.join(work, "Downbeat");
    fs.mkdirSync(dir);
    const t0 = Date.now();
    const files = {};
    ["one.wav", "two.wav"].forEach(function (name) {
      const p = path.join(work, name);
      fs.writeFileSync(p, "fixture");
      files[p] = { path: p, name: name, section: "sfx", status: "done", v: 3, nameChecked: 1, durationSec: 1, updatedAt: t0 };
    });
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ language: "ru", onboardingCompleted: true, updateCheck: false, librarySection: "sfx" }));
    fs.writeFileSync(path.join(dir, "sound-library.json"), JSON.stringify({ version: 1, folders: { music: [], sfx: [work] }, files: files }));
    const out = execFileSync(process.execPath, [__filename, run, work, String(t0)], { encoding: "utf8", timeout: 60000 });
    out.split("\n").forEach(function (line) {
      if (/^(ok|FAIL) /.test(line)) { console.log(line); }
      if (/^FAIL /.test(line)) { failures++; }
    });
    if (!/^FAILURES 0$/m.test(out)) {
      failures++;
      console.error("FAIL " + run + ": the case did not finish cleanly");
    }
  } catch (e) {
    failures++;
    console.error("FAIL " + run + ": " + (e && e.stderr ? e.stderr : e && e.stack || e));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nok - the other host's Clear shows here");
