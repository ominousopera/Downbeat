"use strict";
// Manual checks do not enable background networking; legacy receipts are inert.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-update-state-"));
const data = path.join(work, "Downbeat");
fs.mkdirSync(data);
const oldFile = path.join(work, "existing-update.zxp");
fs.writeFileSync(oldFile, "existing package");
const oldReceipt = { path: oldFile, sha256: "old receipt" };
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ downloadedUpdate: oldReceipt, language: "en", onboardingCompleted: true, updateCheck: false }));
const panel = require("./panel-harness.js").bootPanel({ docsDir: work, realTimeouts: true });
const r = panel.registry, UC = window.BeatMarkerUpdateCheck;
const tick = function () { return new Promise(function (resolve) { setTimeout(resolve, 30); }); };
const latest = { version: "9.9.9", url: "https://github.com/ominousopera/Downbeat/releases/tag/v9.9.9" };
const settings = function () { return JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8")); };
let answer = null, requests = 0;
UC.fetchLatest = function (cb) { requests++; answer = cb; };
(async function () {
  try {
    assert.strictEqual(r.updateCheckNowBtn.hidden, false);
    r.updateCheckNowBtn._fire("click");
    assert.strictEqual(requests, 1);
    answer(null, latest);
    assert.strictEqual(settings().updateCheck, false);
    assert.strictEqual(r.updateOpenBtn.hidden, false);
    r.updateCheckCheckbox.checked = true;
    r.updateCheckCheckbox._fire("change");
    const late = answer;
    r.updateCheckCheckbox.checked = false;
    r.updateCheckCheckbox._fire("change");
    late(null, latest);
    assert.strictEqual(r.updateOpenBtn.hidden, true);
    assert.strictEqual(r.settingsGearBtn.classList.contains("has-update"), false);
    assert.strictEqual(settings().updateCheck, false);
    r.updateCheckNowBtn._fire("click"); answer(null, latest);
    r.updateOpenBtn._fire("click");
    assert.strictEqual(r.externalLinkOverlay.hidden, false);
    assert(r.externalLinkMessage.textContent.includes(latest.url));
    r.externalLinkCancelBtn._fire("click");
    assert.strictEqual(r.externalLinkOverlay.hidden, true);
    assert.strictEqual(UC.downloadPackage, undefined);
    assert.strictEqual(UC.verifyDownloaded, undefined);
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    ["updateDownloadBtn", "updateReopenBtn", "updateFolderBtn", "updateSavedPath"].forEach(function (id) {
      assert(!html.includes('id="' + id + '"'), "package controls absent: " + id);
    });
    assert.deepStrictEqual(settings().downloadedUpdate, oldReceipt);
    assert.strictEqual(fs.readFileSync(oldFile, "utf8"), "existing package");
    console.log("ok - manual checks, disabled in-flight notices, release confirmation and inert legacy receipts");
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
})().catch(function (err) { console.error(err); process.exitCode = 1; });
