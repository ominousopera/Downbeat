"use strict";
// A save that fails because the disk is full (ENOSPC while the new text goes
// to <name>.json.tmp-<n>) leaves the data file whole and no cut-short temp
// file behind. Real panel (scripts/panel-harness.js), real files in a
// throwaway folder; only the one failing write is injected.
// Run: node scripts/test-save-disk-full-temp.js
const fs = require("fs");
const os = require("os");
const path = require("path");

const HARNESS = path.join(__dirname, "panel-harness.js");

function rowStar(h, name) {
  const row = h.registry.libraryDisplay.children.find(function (x) {
    return /lib-row/.test(x.className || "") && x.children.some(function (c) {
      return /lib-row-main/.test(c.className || "") && c.children.some(function (n) { return n.textContent === name; });
    });
  });
  if (!row) { throw new Error("no row for " + name); }
  return row.children.find(function (x) { return /lib-fav/.test(x.className || ""); });
}
function click(star) { star._fire("click", { stopPropagation: function () {} }); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-disk-full-"));
let exitCode = 0;
try {
  const dir = path.join(work, "Downbeat");
  fs.mkdirSync(dir);
  const one = path.join(work, "one.wav");
  fs.writeFileSync(one, "fixture");
  const st = fs.statSync(one);
  const files = {};
  files[one] = { path: one, name: "one.wav", section: "music", size: st.size, mtimeMs: st.mtimeMs, status: "done", v: 3, nameChecked: 1, bpm: 120, updatedAt: Date.now() - 5000 };
  const dataFile = path.join(dir, "sound-library.json");
  const before = JSON.stringify({ version: 1, folders: { music: [work], sfx: [] }, files: files });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false, librarySection: "music" }));
  fs.writeFileSync(dataFile, before);
  const h = require(HARNESS).bootPanel({ docsDir: work });

  // Disk full: the temp copy gets its first bytes, then ENOSPC.
  const realWrite = fs.writeFileSync;
  let injected = 0;
  fs.writeFileSync = function (file, data) {
    if (typeof file === "string" && /sound-library\.json\.tmp-/.test(file)) {
      injected++;
      realWrite(file, String(data).slice(0, 20));
      const err = new Error("ENOSPC: no space left on device, write");
      err.code = "ENOSPC";
      throw err;
    }
    return realWrite.apply(fs, arguments);
  };
  click(rowStar(h, "one.wav")); // saves at once
  fs.writeFileSync = realWrite;
  const afterFail = fs.readFileSync(dataFile, "utf8");
  const tempsAfterFail = fs.readdirSync(dir).filter(function (n) { return /\.tmp-/.test(n); });
  const logText = h.registry.log ? h.registry.log.textContent : "";
  console.log("injected ENOSPC writes: " + injected);
  console.log("data file whole after the failed save: " + (afterFail === before));
  console.log("temp files after the failed save: " + JSON.stringify(tempsAfterFail));
  console.log("log says could not save: " + /could not save the folder library/.test(logText));
  if (afterFail !== before || injected !== 1) {
    console.log("DEFECT A02: the data file changed or the write was not injected as planned");
    exitCode = 1;
  }

  // The disk has room again: the next star saves normally.
  click(rowStar(h, "one.wav"));
  const afterOk = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const tempsAfterOk = fs.readdirSync(dir).filter(function (n) { return /\.tmp-/.test(n); });
  console.log("next save landed (star off): " + (!afterOk.files[one].fav));
  console.log("temp files after the next good save: " + JSON.stringify(tempsAfterOk));
  // What the next panel start would sweep right away (younger than 6 h: nothing).
  const sweep = window.BeatMarkerPersistence.clearLeftoverTempFiles(h.csInterface || { getSystemPath: function () { return work; } });
  console.log("start-up sweep now: " + JSON.stringify(sweep));
  const left = fs.readdirSync(dir).filter(function (n) { return /\.tmp-/.test(n); });
  if (left.length) {
    console.log("DEFECT A02: the cut-short temp file of the failed save stays in Documents/Downbeat after the next good save and the start-up sweep: " + left.join(", "));
    exitCode = 1;
  } else {
    console.log("ok A02");
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
