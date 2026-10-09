"use strict";
// Verify process status reporting and ownership of temporary worker files.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const root = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-worker-error-"));
const context = { window: {}, SystemPath: { EXTENSION: "extension" }, Promise, Buffer };
let error;
context.window.cep_node = { require: function (name) {
  if (name === "child_process") { return { execFile: function (bin, args, opts, callback) { setImmediate(function () { callback(error, "", ""); }); } }; }
  return require(name);
} };
context.window.BeatMarkerPersistence = { getTempDir: function () { return dir; } };
context.window.BeatMarkerAudio = { TARGET_SAMPLE_RATE: 44100 };
vm.runInNewContext(fs.readFileSync(path.join(root, "js/bridge.js"), "utf8"), context);
const bridge = context.window.BeatMarkerBridge.create({ csInterface: { getSystemPath: function () { return root; } } });
(async function () {
  try {
    for (const status of [{ code: 1 }, { code: null, signal: "SIGKILL" }, { code: null, signal: "SIGTERM", killed: true }]) {
      error = Object.assign(new Error("worker stopped"), status);
      await assert.rejects(bridge.runAnalyzeWorker("beats", Buffer.alloc(400), "fixture.wav"), function (e) {
        return /failed/.test(e.message) && (!status.signal || e.message.includes("signal=" + status.signal)) &&
          (status.code === null || e.message.includes("code=" + status.code)) && (!status.killed || e.message.includes("killed=true"));
      });
      assert.strictEqual(bridge.tempFilesInFlight(), 0);
      assert.deepStrictEqual(fs.readdirSync(dir), []);
    }
    console.log("ok - worker errors retain code/signal/killed and clean temporary files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(function (e) { console.error(e); process.exitCode = 1; });
