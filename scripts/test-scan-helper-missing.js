"use strict";
// A Library scan whose helper cannot start at all - the Mac package
// installed on Windows - stops with the same short text Analyze shows
// ("This is the Mac package of Downbeat..."), and its files stay to scan
// instead of being saved as unreadable. The real panel, the scan's worker
// start replaced by a stand-in that fails the way Node does (ENOENT).
// Run: node scripts/test-scan-helper-missing.js
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-scan-helper-"));
const docs = path.join(work, "docs"), folder = path.join(work, "samples");
fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
fs.mkdirSync(folder);
fs.writeFileSync(path.join(folder, "loop.wav"), "fixture");
fs.writeFileSync(path.join(docs, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
const originalExecFile = cp.execFile, originalPlatform = os.platform, originalExists = fs.existsSync;
let starts = 0;
cp.execFile = function (bin, args, opts, callback) {
  starts++;
  setImmediate(function () {
    // As on Windows with the Mac package: no win-x64 runtime folder.
    os.platform = function () { return "win32"; };
    fs.existsSync = function (p) { return /win-x64/.test(String(p)) ? false : /runtime\/node\/darwin-/.test(String(p)) ? true : originalExists.apply(fs, arguments); }; // the Mac runtime is there, also in a copy without runtime/
    try {
      callback(Object.assign(new Error("spawn " + bin + " ENOENT"), { code: "ENOENT", errno: -2, syscall: "spawn " + bin }), "", "");
    } finally {
      os.platform = originalPlatform;
      fs.existsSync = originalExists;
    }
  });
  return { kill: function () {} };
};
const mocks = require("./host-mocks.js");
const host = mocks.loadHost(mocks.makePremiereHost({ mediaPath: "/other.wav", durationSec: 8 }).context);
const panel = require("./panel-harness.js").bootPanel({ docsDir: docs, realTimeouts: true, evalScript: host.evalScript });
const $ = panel.registry, lib = window.BeatMarkerSoundLibrary, I18n = window.BeatMarkerI18n;
lib.addFolder("sfx", folder);
const sfxBtn = panel.select(".lib-section-btn").filter(function (b) { return b.getAttribute && b.getAttribute("data-section") === "sfx"; })[0];
if (sfxBtn) { sfxBtn._fire("click"); }
$.libRescanBtn._fire("click");
setTimeout(function () {
  cp.execFile = originalExecFile;
  let failed = false;
  try {
    assert.ok(starts >= 1, "the scan tried to start its helper");
    assert.strictEqual($.libScanStatus.textContent, I18n.t("selection.failWrongPackage", { pkg: "Mac", want: "Windows (-win.zxp)" }));
    let rec = null;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", "sound-library.json"), "utf8"));
      rec = state.files[Object.keys(state.files)[0]];
    } catch (e) { rec = null; }
    assert.ok(!rec || rec.status !== "error", "the file is not saved as unreadable: " + JSON.stringify(rec));
    console.log("ok - a scan without its helper says which package to install and keeps its files to scan");
  } catch (e) {
    console.error(e);
    failed = true;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}, 400);
