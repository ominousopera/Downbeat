"use strict";
// Manual checks and retained downloads do not enable background networking.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-update-state-"));
const data = path.join(work, "Downbeat");
fs.mkdirSync(data);
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
const panel = require("./panel-harness.js").bootPanel({ docsDir: work, realTimeouts: true });
const r = panel.registry, UC = window.BeatMarkerUpdateCheck;
const tick = function () { return new Promise(function (resolve) { setTimeout(resolve, 30); }); };
const latest = { version: "9.9.9", url: "https://github.com/ominousopera/Downbeat/releases/tag/v9.9.9",
  files: { mac: { name: "Downbeat-9.9.9-mac.zxp", size: 20 }, win: { name: "Downbeat-9.9.9-win.zxp", size: 20 } } };
const settings = function () { return JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8")); };
let answer = null, requests = 0, opens = 0;
UC.fetchLatest = function (cb) { requests++; answer = cb; };
(async function () {
  try {
    assert.strictEqual(r.updateCheckNowBtn.hidden, false);
    r.updateCheckNowBtn._fire("click");
    assert.strictEqual(requests, 1);
    answer(null, latest);
    assert.strictEqual(settings().updateCheck, false);
    assert.strictEqual(r.updateDownloadBtn.hidden, false);
    r.updateCheckCheckbox.checked = true;
    r.updateCheckCheckbox._fire("change");
    const late = answer;
    r.updateCheckCheckbox.checked = false;
    r.updateCheckCheckbox._fire("change");
    late(null, latest);
    assert.strictEqual(r.updateDownloadBtn.hidden, true);
    assert.strictEqual(r.settingsGearBtn.classList.contains("has-update"), false);
    assert.strictEqual(settings().updateCheck, false);
    r.updateCheckNowBtn._fire("click"); answer(null, latest);
    const file = path.join(work, latest.files.mac.name), bytes = Buffer.from("saved package fixture");
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(file, bytes);
    const realRequire = window.cep_node.require;
    window.cep_node.require = function (name) {
      if (name !== "child_process") { return realRequire(name); }
      return { spawn: function () {
        opens++;
        const child = new EventEmitter(); child.unref = function () {};
        setImmediate(function () { child.emit("spawn"); child.emit("close", 0); });
        return child;
      } };
    };
    UC.downloadPackage = function (info, opts, cb) {
      cb(null, { path: file, name: path.basename(file), sha256: sha, size: bytes.length, openError: "no installer" });
    };
    r.updateDownloadBtn._fire("click");
    assert.strictEqual(settings().downloadedUpdate.path, file);
    assert.strictEqual(r.updateReopenBtn.hidden, false);
    assert.strictEqual(r.updateDownloadBtn.hidden, true);
    r.updateReopenBtn._fire("click"); await tick();
    assert.strictEqual(opens, 1);
    assert(fs.readFileSync(file).equals(bytes));
    fs.writeFileSync(file, Buffer.alloc(bytes.length));
    r.updateReopenBtn._fire("click"); await tick();
    assert.strictEqual(opens, 1, "changed bytes cannot reach the installer");
    assert.strictEqual(settings().downloadedUpdate, null);
    assert.strictEqual(r.updateDownloadBtn.hidden, false);
    assert(fs.existsSync(file), "invalid retained files are not silently deleted");
    window.cep_node.require = realRequire;
    console.log("ok - manual checks, disabled in-flight notices and verified installer retry");
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
})().catch(function (err) { console.error(err); process.exitCode = 1; });
