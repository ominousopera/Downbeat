"use strict";
// Worker processes never outlive the panel and never run past their time
// limit: worker/lifeline.js ends a worker whose panel process is gone, or
// whose own limit has passed even while its main thread is stuck, and then
// removes only the hand-off files it was given; js/bridge.js stops running
// workers when the panel is closed or reloaded. Real processes for the
// lifeline (POSIX; Windows also ends them through its job object), stubs for
// the panel side.
// Run: node scripts/test-worker-lifetime.js
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm"), cp = require("child_process");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const LIFELINE = path.join(ROOT, "worker", "lifeline.js");
const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-lifeline-")));
let n = 0;
function pass(m) { console.log("  PASS " + (++n) + ": " + m); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } }
function waitFor(test, ms) {
  const until = Date.now() + ms;
  return new Promise(function (resolve) {
    (function poll() { if (test() || Date.now() > until) { resolve(test()); } else { setTimeout(poll, 50); } })();
  });
}

// A stand-in worker: the real lifeline, then a hang. "busy" blocks the main
// thread the way a stuck WebAssembly call does; "idle" waits forever.
function writeWorker(file, pidFile, how) {
  fs.writeFileSync(file, "require(" + JSON.stringify(LIFELINE) + ").watch();\n" +
    "require('fs').writeFileSync(" + JSON.stringify(pidFile) + ", String(process.pid));\n" +
    (how === "busy" ? "for (;;) {}\n" : "setInterval(function () {}, 1000);\n"));
}

(async function () {
  try {
    // 1. The panel's process dies (SIGKILL) while its worker hangs.
    if (process.platform !== "win32") {
      const worker = path.join(WORK, "orphan-worker.js"), pidFile = path.join(WORK, "orphan.pid");
      const handoff = path.join(WORK, "samples-1-2.raw");
      fs.writeFileSync(handoff, "x");
      writeWorker(worker, pidFile, "busy");
      const panelCode = "const cp = require('child_process');" +
        "cp.execFile(process.execPath, [" + JSON.stringify(worker) + "], { env: Object.assign({}, process.env, " +
        "{ DOWNBEAT_WORKER_TEMP_FILES: JSON.stringify([" + JSON.stringify(handoff) + "]) }) }, function () {});" +
        "setInterval(function () {}, 1000);";
      const panel = cp.spawn(process.execPath, ["-e", panelCode], { stdio: "ignore" });
      assert.ok(await waitFor(function () { return fs.existsSync(pidFile); }, 10000), "the stand-in worker started");
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      await new Promise(function (r) { setTimeout(r, 300); }); // the watcher thread is up
      panel.kill("SIGKILL");
      const gone = await waitFor(function () { return !alive(pid); }, 3000);
      if (!gone) { process.kill(pid, "SIGKILL"); }
      assert.ok(gone, "the orphaned worker ended");
      assert.ok(!fs.existsSync(handoff), "its hand-off file is gone");
      pass("a hung worker ends within seconds once the panel's process is gone, and its hand-off file goes with it");
    } else {
      console.log("  skip: orphan check is POSIX only");
    }

    // 2. The worker's own limit, with its main thread blocked.
    {
      const worker = path.join(WORK, "limit-worker.js"), pidFile = path.join(WORK, "limit.pid");
      const own = path.join(WORK, "beatthis-3-4.raw"), notOurs = path.join(WORK, "song.wav");
      fs.writeFileSync(own, "x");
      fs.writeFileSync(notOurs, "user audio");
      writeWorker(worker, pidFile, "busy");
      const started = Date.now();
      const result = await new Promise(function (resolve) {
        cp.execFile(process.execPath, [worker], {
          env: Object.assign({}, process.env, {
            DOWNBEAT_WORKER_LIMIT_MS: "400",
            DOWNBEAT_WORKER_TEMP_FILES: JSON.stringify([own, notOurs, "relative-5-6.raw"])
          }),
          timeout: 20000
        }, function (err) { resolve({ err: err, ms: Date.now() - started }); });
      });
      assert.ok(result.err && result.err.signal === "SIGKILL" && !result.err.killed, "ended by its own limit, not by the caller: " + JSON.stringify(result.err && { signal: result.err.signal, killed: result.err.killed }));
      assert.ok(result.ms < 10000, "ended in " + result.ms + " ms");
      assert.ok(!fs.existsSync(own), "its own hand-off file is gone");
      assert.ok(fs.existsSync(notOurs), "a file with another name is never removed");
      pass("a worker stuck on its main thread ends at its own time limit (" + result.ms + " ms) and removes only Downbeat's own file");
    }

    // 3. A worker that finishes normally exits at once; the watcher does not hold it.
    {
      const worker = path.join(WORK, "quick-worker.js");
      fs.writeFileSync(worker, "require(" + JSON.stringify(LIFELINE) + ").watch();\nprocess.stdout.write('{\"ok\":true}');\n");
      const started = Date.now();
      const out = cp.execFileSync(process.execPath, [worker], { encoding: "utf8", env: Object.assign({}, process.env, { DOWNBEAT_WORKER_LIMIT_MS: "60000" }) });
      assert.strictEqual(out, "{\"ok\":true}");
      assert.ok(Date.now() - started < 5000);
      pass("a finished worker exits normally, its output untouched");
    }

    // 4. Closing or reloading the panel stops its running workers and removes their files.
    {
      const listeners = {};
      const kills = [];
      let lastOptions = null;
      const context = { window: { addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); } },
        SystemPath: { EXTENSION: "extension" }, Promise, Buffer, JSON, Math, Date, Float64Array };
      context.window.cep_node = { require: function (name) {
        if (name === "child_process") {
          return { execFile: function (bin, args, opts) { lastOptions = opts; return { kill: function () { kills.push(args[0]); } }; } };
        }
        return require(name);
      } };
      context.window.BeatMarkerPersistence = { getTempDir: function () { return WORK; } };
      context.window.BeatMarkerAudio = { TARGET_SAMPLE_RATE: 44100 };
      vm.runInNewContext(fs.readFileSync(path.join(ROOT, "js/bridge.js"), "utf8"), context);
      const bridge = context.window.BeatMarkerBridge.create({ csInterface: { getSystemPath: function () { return ROOT; } } });
      bridge.runAnalyzeWorker("beats", new Float32Array(44100), "/x/song.wav");
      bridge.runSkeyWorker(new Float32Array(22050));
      assert.strictEqual(lastOptions.windowsHide, true, "no console window on Windows");
      assert.ok(Number(lastOptions.env.DOWNBEAT_WORKER_LIMIT_MS) > lastOptions.timeout, "the worker's own limit comes after the panel's");
      const handedOver = JSON.parse(lastOptions.env.DOWNBEAT_WORKER_TEMP_FILES);
      assert.ok(handedOver.length === 1 && fs.existsSync(handedOver[0]), "the worker is told its hand-off file");
      const before = fs.readdirSync(WORK).filter(function (f) { return /^(samples|skey)-\d+-\d+\.raw$/.test(f); });
      assert.strictEqual(before.length, 2);
      assert.ok(listeners.unload && listeners.pagehide, "listens for the panel going away");
      listeners.pagehide.forEach(function (fn) { fn(); });
      listeners.unload.forEach(function (fn) { fn(); });
      assert.strictEqual(kills.length, 2, "both workers stopped once: " + kills.length);
      assert.deepStrictEqual(fs.readdirSync(WORK).filter(function (f) { return /^(samples|skey)-\d+-\d+\.raw$/.test(f); }), []);
      pass("closing the panel stops both running workers and removes their hand-off files");
    }
    console.log("ok - " + n + " worker lifetime checks passed");
  } finally {
    fs.rmSync(WORK, { recursive: true, force: true });
  }
})().catch(function (e) { console.error(e); fs.rmSync(WORK, { recursive: true, force: true }); process.exitCode = 1; });
