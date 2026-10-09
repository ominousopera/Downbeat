"use strict";
// Verify saved output preferences and cancelled folder dialogs.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-output-ui-"));
const data = path.join(work, "Downbeat");
fs.mkdirSync(data);
const settingsFile = path.join(data, "settings.json");
fs.writeFileSync(settingsFile, JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
let picked = null;
const panel = require("./panel-harness.js").bootPanel({ docsDir: work, realTimeouts: true,
  evalScript: function (script, cb) { cb(JSON.stringify({ ok: true, data: /^pickOutputFolder/.test(script) ? { directory: picked } : {} })); } });
const r = panel.registry;
const tick = function () { return new Promise(function (resolve) { setImmediate(resolve); }); };
(async function () {
  try {
    assert.strictEqual(r.audioOutputModeSelect.value, "documents");
    r.audioOutputModeSelect.value = "project"; r.audioOutputModeSelect._fire("change");
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile)).audioOutputMode, "project");
    r.audioOutputModeSelect.value = "custom"; r.audioOutputModeSelect._fire("change"); await tick();
    assert.strictEqual(r.audioOutputModeSelect.value, "project", "cancel preserves the previous destination");
    picked = path.join(work, "chosen");
    r.audioOutputModeSelect.value = "custom"; r.audioOutputModeSelect._fire("change"); await tick();
    const saved = JSON.parse(fs.readFileSync(settingsFile));
    assert.strictEqual(saved.audioOutputMode, "custom"); assert.strictEqual(saved.audioOutputFolder, picked);
    assert.strictEqual(r.audioOutputPath.textContent, picked); assert.strictEqual(r.audioOutputFolderBtn.hidden, false);
    picked = null; r.audioOutputFolderBtn._fire("click"); await tick();
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile)).audioOutputFolder, saved.audioOutputFolder);
    assert.deepStrictEqual(fs.readdirSync(data).sort(), ["settings.json"]);
    console.log("ok - output settings persist project/custom modes and preserve choice on cancel");
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
})().catch(function (e) { console.error(e); process.exitCode = 1; });
