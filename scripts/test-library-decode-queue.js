"use strict";
// The Library scan's panel-side decode queue, with the real panel and the
// real analysis worker. Decoding is stubbed with a delay and a 3 s tone, so
// the files only need the right names and sizes (the big one is sparse). Run:
// node scripts/test-library-decode-queue.js.
const fs = require("fs");
const os = require("os");
const path = require("path");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-decodeq-"));
const DOCS = path.join(WORK, "docs");
const MUSIC = path.join(WORK, "My Music");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.mkdirSync(MUSIC);
const NAMES = ["a song.mp3", "b song.mp3", "c song.m4a", "d long mix.mp3", "e song.flac", "f song.mp3", "g song.mp3", "h song.ogg"];
const BIG = "d long mix.mp3";
NAMES.forEach(function (n) {
  const p = path.join(MUSIC, n);
  fs.writeFileSync(p, "x");
  if (n === BIG) {
    fs.truncateSync(p, 17 * 1024 * 1024);
  }
});
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));

const mocks = require("./host-mocks.js");
const fake = mocks.makePremiereHost({ mediaPath: "/music/other.mp3", durationSec: 200, clipStart: 0, audioTrackCount: 2, playheadSeconds: 0, insertDurationSec: 30 });
fake.context.Folder = { selectDialog: function () { return { fsName: MUSIC }; }, desktop: { fsName: WORK } };
const host = mocks.loadHost(fake.context);
const { bootPanel } = require("./panel-harness.js");
const panel = bootPanel({ docsDir: DOCS, evalScript: host.evalScript, realTimeouts: true, realIntervals: false });
const $ = panel.registry;
// Decode stand-ins: count what runs at the same time.
let active = 0;
let maxActive = 0;
let activeWhenBigStarted = null;
let othersDuringBig = 0;
let bigRunning = false;
const decodedCount = {};
window.BeatMarkerAudio.readFileAsArrayBuffer = function (p) { return Promise.resolve({ path: p }); };
window.BeatMarkerAudio.decodeToMono44100 = function (buf) {
  const name = path.basename(buf.path);
  decodedCount[name] = (decodedCount[name] || 0) + 1;
  if (name === BIG) {
    activeWhenBigStarted = active;
    bigRunning = true;
  } else if (bigRunning) {
    othersDuringBig++;
  }
  active++;
  maxActive = Math.max(maxActive, active);
  return new Promise(function (resolve) {
    setTimeout(function () {
      active--;
      if (name === BIG) {
        bigRunning = false;
      }
      const samples = new Float32Array(3 * 44100);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / 44100);
      }
      resolve({ samples: samples, original: { durationSec: 3, sampleRate: 44100, channels: 1 } });
    }, 250);
  });
};

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function waitFor(cond, label, ms) {
  const t0 = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (cond()) { return resolve(); }
      if (Date.now() - t0 > (ms || 120000)) { return reject(new Error(label + " did not happen in time")); }
      setTimeout(poll, 50);
    })();
  });
}
function scanFinished() { return /Done|Everything|Stopped/.test($.libScanStatus.textContent) && $.libScanOverlay.hidden; }

$.libAddFolderBtn._fire("click");
waitFor(function () { return /Folder added/.test($.libScanStatus.textContent); }, "adding the folder", 10000)
  .then(function () {
    $.libScanStatus.textContent = "";
    $.libRescanBtn._fire("click");
    return waitFor(scanFinished, "the scan");
  })
  .then(function () {
    check("at most two files decode at once, and two do overlap", maxActive === 2, "most at once: " + maxActive);
    check("a file over 16 MB decodes alone", activeWhenBigStarted === 0 && othersDuringBig === 0,
      "running when it started: " + activeWhenBigStarted + ", started during it: " + othersDuringBig);
    check("every file is decoded exactly once", NAMES.every(function (n) { return decodedCount[n] === 1; }), JSON.stringify(decodedCount));
    const files = Object.values(window.BeatMarkerSoundLibrary.getState().files);
    check("the scan finishes with every file analyzed or marked unreadable",
      files.length === NAMES.length && files.every(function (f) { return f.status === "done" || f.status === "failed"; }),
      files.map(function (f) { return f.name + ":" + f.status; }).join(", "));
  })
  .catch(function (e) { failures++; console.error("FAIL " + e.message); })
  .then(function () {
    fs.rmSync(WORK, { recursive: true, force: true }); // throwaway fixture made above
    if (failures) {
      console.error("\n" + failures + " decode queue check(s) failed");
      process.exit(1);
    }
    console.log("\nthe Library scan decodes two files at a time, big ones alone");
    process.exit(0);
  });
