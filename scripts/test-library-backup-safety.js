"use strict";
// Validate that Library duration metadata cannot become host commands.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-copy-input-"));
const docs = path.join(work, "docs");
const audio = path.join(work, "example.wav");
const copy = path.join(work, "copy.json");
fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
fs.writeFileSync(audio, "fixture");
fs.writeFileSync(path.join(docs, "Downbeat/settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
const durations = [];
const host = vm.createContext({ app: { sentinel: 0 }, insertAudioAtPlayhead: function (p, duration) {
  assert.strictEqual(JSON.parse(p), audio);
  durations.push(duration);
  return JSON.stringify({ ok: true, data: { where: "A1", startSeconds: 0 } });
} });
const panel = require("./panel-harness.js").bootPanel({ docsDir: docs, realTimeouts: true, evalScript: function (script, callback) {
  if (/^pickOpenFile/.test(script)) { callback(JSON.stringify({ ok: true, data: { path: copy } })); }
  else if (/^insertAudioAtPlayhead/.test(script)) { callback(vm.runInContext(script, host)); }
  else { callback(JSON.stringify({ ok: true, data: {} })); }
} });
const tick = function () { return new Promise(function (resolve) { setImmediate(resolve); }); };
(async function () {
  try {
    for (const duration of ["0); app.sentinel = 1;//", "12", -2, {}, null, 12.5]) {
      delete window.BeatMarkerSoundLibrary.getState().files[audio];
      const record = { path: audio, name: "example.wav", section: "music", status: "done", durationSec: duration };
      fs.writeFileSync(copy, JSON.stringify({ format: "downbeat-library-backup", soundLibrary: { folders: { music: [work], sfx: [] }, files: { [audio]: record } }, trackLibrary: [] }));
      panel.registry.loadLibraryBackupBtn._fire("click");
      await tick();
      const row = panel.registry.libraryDisplay.children.find(function (el) { return /lib-row/.test(el.className || ""); });
      assert(row, "imported record is visible");
      const insert = row.children.find(function (el) { return /lib-insert/.test(el.className || ""); });
      assert(insert, "insert action is available");
      insert._fire("click", { stopPropagation: function () {} });
      await tick();
      assert.strictEqual(host.app.sentinel, 0, "imported duration cannot execute host commands");
      assert.strictEqual(durations[durations.length - 1], typeof duration === "number" && duration >= 0 ? duration : 0);
    }
    console.log("ok - imported duration values remain numeric arguments in the host script");
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
})().catch(function (err) { console.error(err); process.exitCode = 1; });
