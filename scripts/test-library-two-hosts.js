"use strict";
// The track and folder libraries saved by Premiere and After Effects in the
// same moment: each save runs in turn with the other host
// (js/persistence.js "One save at a time"), so the write that comes last
// never drops what the other host saved.
//   - Track library, real panels (panel-harness) in two Node processes on
//     one Documents/Downbeat: Premiere analyzes A and its save is held just
//     before it replaces library.json while After Effects analyzes B and
//     saves. library.json ends with both, and no copy or lock is left.
//   - Folder library, two copies of js/persistence.js in this process: the
//     second save while the first holds the lock goes to a copy, the first
//     takes it in and saves both, and the copy is removed.
// Only detector and decoder replies and the timing are injected.
// Run: node scripts/test-library-two-hosts.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-library-hosts-"));
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

// One host: boots the panel, analyzes its own placeholder track and exits.
// With `inside`, the other host runs (as a separate host) at the moment
// this one is about to replace library.json.
const HOST = `
const fs = require("fs"), path = require("path"), cp = require("child_process");
const [harness, docs, role, inside] = process.argv.slice(2);
const file = docs + "/Downbeat/library.json";
if (inside) {
  const rename = fs.renameSync;
  let once = true;
  fs.renameSync = function (a, b) {
    if (once && b === file && String(a).indexOf(".tmp-") !== -1) {
      once = false;
      cp.execFileSync(process.execPath, [__filename, harness, docs, inside, ""], { stdio: "ignore", timeout: 60000 });
    }
    return rename.apply(fs, arguments);
  };
}
console.log = function () {};
const beats = Array.from({ length: 60 }, function (_, i) { return i * 0.5; });
cp.execFile = function (bin, args, opts, cb) {
  const second = String(args[0]).indexOf("beatthis-worker") !== -1;
  const data = second
    ? { beatTimes: beats, downbeatTimes: beats.filter(function (_, i) { return i % 4 === 0; }), meanPeakLogit: 8, barsDecoded: true, barsUnsure: false }
    : { cuesheet: { bpm: 120 }, beatsArray: beats, confidence: 3, phase: 0, phaseAverages: [1, 0, 0, 0], phaseMarginRatio: 1, phaseAgreement: "agree" };
  queueMicrotask(function () { cb(null, JSON.stringify({ ok: true, data: data }), ""); });
  return { kill: function () {} };
};
const clip = { mediaPath: docs + "/track-" + role + ".wav", clipStartSeconds: 0, inPointSeconds: 0, outPointSeconds: 30, speed: 1, reversed: false, frameRate: 25, trackIndex: 0 };
const h = require(harness).bootPanel({ docsDir: docs, evalScript: function (s, cb) { if (cb) { cb(JSON.stringify({ ok: true, data: clip })); } } });
window.BeatMarkerAudio.decodeFileToMono44100 = function () {
  return Promise.resolve({ samples: new Float32Array(44100), original: { durationSec: 30, sampleRate: 44100, channels: 1 } });
};
window.BeatMarkerAudio.resampleMono = function (s) { return Promise.resolve(s); };
(async function () {
  h.registry.analyzeBtn._fire("click");
  for (let i = 0; i < 500 && h.registry.analyzeBtn.disabled; i++) { await new Promise(setImmediate); }
  process.exit(h.registry.analyzeBtn.disabled ? 2 : 0);
})();
`;
const HOST_FILE = path.join(WORK, "host.js");
fs.writeFileSync(HOST_FILE, HOST);

function setup(name) {
  const docs = path.join(WORK, name);
  fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
  fs.writeFileSync(path.join(docs, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
  fs.writeFileSync(path.join(docs, "Downbeat", "library.json"), "[]");
  ["A", "B"].forEach(function (role) { fs.writeFileSync(path.join(docs, "track-" + role + ".wav"), Buffer.alloc(44)); });
  return docs;
}
const leftovers = (docs, name) => fs.readdirSync(path.join(docs, "Downbeat")).filter(function (n) {
  return n.indexOf(name + ".unsaved-") === 0 || n.indexOf(name + ".json.tmp-") === 0 || n === name + ".json.lock";
});

try {
  {
    const L = "track library, saves in the same moment: ";
    const docs = setup("tracks");
    execFileSync(process.execPath, [HOST_FILE, path.join(__dirname, "panel-harness.js"), docs, "A", "B"], { stdio: "ignore", timeout: 120000 });
    const tracks = JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", "library.json"), "utf8"))
      .filter(function (e) { return e.mediaPath; }).map(function (e) { return path.basename(e.mediaPath); }).sort();
    check(L + "library.json has both analyses", tracks.join(",") === "track-A.wav,track-B.wav", JSON.stringify(tracks));
    check(L + "no copy or lock is left", leftovers(docs, "library").length === 0, JSON.stringify(leftovers(docs, "library")));
  }

  {
    const L = "folder library, saves in the same moment: ";
    const docs = path.join(WORK, "folders");
    fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
    global.window = { cep_node: { require: function (m) { return require(m); } } };
    global.SystemPath = { EXTENSION: "extension", MY_DOCUMENTS: "myDocuments" };
    const cs = { getSystemPath: function (k) { return k === "myDocuments" ? docs : path.join(WORK, "ext"); } };
    const file = path.join(__dirname, "..", "js", "persistence.js");
    const host = function () { delete require.cache[require.resolve(file)]; require(file); return window.BeatMarkerPersistence; };
    const P1 = host(), P2 = host();
    // A panel's save as library-tab.js makes it: take in what is on disk
    // and in kept copies, add its own folder, write.
    const state = { 1: { folders: [] }, 2: { folders: [] } };
    function absorb(n, value) {
      (value && value.folders || []).forEach(function (f) { if (state[n].folders.indexOf(f) === -1) { state[n].folders.push(f); } });
    }
    function save(P, n, add, during) {
      P.inTurn(cs, "sound-library", function () {
        const fresh = P.readIfChanged(cs, "sound-library");
        if (fresh.changed) { absorb(n, fresh.value); }
        (fresh.takeIn || []).forEach(function (v) { absorb(n, v); });
        if (add && state[n].folders.indexOf(add) === -1) { state[n].folders.push(add); }
        if (during) { const d = during; during = null; d(); }
        const r = P.saveSoundLibrary(cs, { folders: state[n].folders.slice() });
        if (!r.ok) { throw new Error(r.error); }
      });
    }
    let keptIn = null;
    save(P1, 1, "/sfx/one", function () {
      save(P2, 2, "/sfx/two");
      keptIn = leftovers(docs, "sound-library").filter(function (n) { return n.indexOf(".unsaved-") !== -1; });
    });
    const saved = JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", "sound-library.json"), "utf8"));
    check(L + "the second save went to a copy while the first held the lock", keptIn && keptIn.length === 1, JSON.stringify(keptIn));
    check(L + "sound-library.json has both folders", (saved.folders || []).slice().sort().join(",") === "/sfx/one,/sfx/two", JSON.stringify(saved));
    check(L + "no copy or lock is left", leftovers(docs, "sound-library").length === 0, JSON.stringify(leftovers(docs, "sound-library")));
  }
} finally {
  fs.rmSync(WORK, { recursive: true, force: true });
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nTrack and folder library saves in the same moment from two hosts keep both");
