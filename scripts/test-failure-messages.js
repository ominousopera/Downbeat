"use strict";
// What the clip line says when something fails, in a Russian panel: a
// worker crash, a start refused by the system and the wrong package are
// short sentences in the panel's language with no command line or path
// (the full text stays in the log); a host refusal comes translated; an
// error stays through the selection polls and goes at the next click.
// The real panel (scripts/panel-harness.js), worker processes replaced by
// stand-ins; nothing is spawned.
// Run: node scripts/test-failure-messages.js
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-messages-"));
const DOCS = path.join(WORK, "docs");
const file = path.join(WORK, "song.wav");
fs.writeFileSync(file, Buffer.alloc(44));
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "ru", onboardingCompleted: true, updateCheck: false }));

const originalExecFile = cp.execFile;
const originalPlatform = os.platform;
const originalExists = fs.existsSync;
let how = "crash";
cp.execFile = function (bin, args, opts, cb) {
  if (how === "refused") {
    throw Object.assign(new Error("spawn EPERM"), { code: "EPERM", errno: -1, syscall: "spawn" });
  }
  queueMicrotask(function () {
    if (how === "wrong-package") {
      // The Mac package installed on Windows: no node.exe there.
      os.platform = function () { return "win32"; };
      fs.existsSync = function (p) { return /win-x64/.test(String(p)) ? false : /runtime\/node\/darwin-/.test(String(p)) ? true : originalExists.apply(fs, arguments); }; // the Mac runtime is there, also in a copy without runtime/
      try {
        cb(Object.assign(new Error("spawn " + bin + " ENOENT"), { code: "ENOENT" }), "", "");
      } finally {
        os.platform = originalPlatform;
        fs.existsSync = originalExists;
      }
      return;
    }
    cb(Object.assign(new Error("Command failed: " + bin + " " + args.join(" ") + "\n"), { code: null, killed: false, signal: "SIGKILL" }), "", "");
  });
  return { kill: function () {} };
};

let hostAnswer = { ok: true, data: { mediaPath: file, clipStartSeconds: 0, inPointSeconds: 0, outPointSeconds: 30,
  speed: 1, reversed: false, frameRate: 25, trackIndex: 0 } };
const panel = require("./panel-harness.js").bootPanel({
  docsDir: DOCS,
  evalScript: function (s, cb) { if (cb) { cb(JSON.stringify(hostAnswer)); } }
});
window.BeatMarkerAudio.decodeFileToMono44100 = function () {
  return Promise.resolve({ samples: new Float32Array(44100), original: { durationSec: 30, sampleRate: 44100, channels: 1 } });
};
window.BeatMarkerAudio.resampleMono = function (s) { return Promise.resolve(s); };
const I18n = window.BeatMarkerI18n;
const R = panel.registry;
const line = R.selectionStatusDisplay;
const tick = function () { return new Promise(setImmediate); };
async function idle() {
  for (let i = 0; i < 800 && R.analyzeBtn.disabled; i++) { await tick(); }
  for (let i = 0; i < 20; i++) { await tick(); }
}
async function analyze() { R.analyzeBtn._fire("click"); await idle(); }
let n = 0;
function pass(m) { console.log("  PASS " + (++n) + ": " + m); }

(async function () {
  try {
    await idle();
    panel.runIntervals(); await idle();

    // 1. A worker killed from outside.
    how = "crash";
    await analyze();
    assert.strictEqual(line.title, I18n.t("selection.failStopped"));
    assert.ok(!/Command failed|\//.test(line.title), "no command line or path on screen: " + line.title);
    assert.ok(line.title.charCodeAt(0) > 1000, "in the panel's language (Cyrillic)");
    assert.ok(line.className.indexOf("is-error") !== -1);
    assert.ok(R.analyzeClipSlot.classList.contains("has-error") && R.keyClipSlot.classList.contains("has-error"), "the line is shown whole in both headings");
    assert.ok(/Command failed: [\s\S]*\[signal=SIGKILL\]/.test(R.log.textContent), "the full text is in the log");
    pass("a worker crash shows one short Russian sentence; the command line stays in the log");

    // 2. It stays through the selection polls and goes at the next click.
    panel.runIntervals(); await idle();
    panel.runIntervals(); await idle();
    assert.strictEqual(line.title, I18n.t("selection.failStopped"), "still shown after two polls");
    document._fire("mousedown", { target: document.body });
    assert.ok(line.className.indexOf("is-error") === -1 && !R.analyzeClipSlot.classList.contains("has-error"));
    panel.runIntervals(); await idle();
    assert.ok(/song\.wav/.test(line.title), "the clip line is back: " + line.title);
    pass("the error stays until the next click, then the clip line comes back");

    // 3. The system refuses the start (an antivirus, a blocked node.exe).
    how = "refused";
    await analyze();
    assert.strictEqual(line.title, I18n.t("selection.failBlocked"));
    assert.strictEqual(R.analyzeBtn.disabled, false);
    R.deleteDataBtn._fire("click");
    assert.notStrictEqual(R.deleteDataMessage.textContent, I18n.t("settings.deleteDataBusy"), "Delete my data does not think an analysis runs");
    R.deleteDataCancelBtn._fire("click");
    document._fire("keydown", { key: "Escape", target: document.body });
    pass("a refused start says so in Russian and leaves nothing counted as running");

    // 4. The wrong package (the Mac one on Windows).
    how = "wrong-package";
    await analyze();
    assert.strictEqual(line.title, I18n.t("selection.failWrongPackage", { pkg: "Mac", want: "Windows (-win.zxp)" }));
    document._fire("mousedown", { target: document.body });
    pass("the wrong package names the package to install, in Russian");

    // 5. A host refusal reaches the clip line translated.
    panel.runIntervals(); await idle();
    hostAnswer = { ok: false, error: "Could not resolve a media file path for the selected clip." };
    panel.runIntervals(); await idle();
    assert.strictEqual(line.title, I18n.t("selection.hostNoMediaFile"));
    pass("a host refusal is shown in Russian");
    console.log("ok - " + n + " clip-line message checks passed");
  } finally {
    cp.execFile = originalExecFile;
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  process.exit(0);
})().catch(function (e) {
  console.error(e);
  cp.execFile = originalExecFile;
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(1);
});
