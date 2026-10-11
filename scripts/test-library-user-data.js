"use strict";
// Library inserts and Clear, with the real panel and the real
// jsx/host.jsx on the Premiere stand-in:
//   - Enter held down or pressed twice while an insert is still running
//     inserts the sound once;
//   - Settings > Clear empties the whole library (added folders, scanned
//     records, favourites, analyzed clips) and asks to reopen the panel -
//     yet touches NO file on disk: every audio file, its folder, and
//     anything else in Documents/Downbeat stay exactly as they were.
// Run: node scripts/test-library-user-data.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const mocks = require("./host-mocks.js");
const { bootPanel } = require("./panel-harness.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function writeWav(file, seconds) {
  const rate = 44100, n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(file, b);
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-userdata-"));
const DOCS = path.join(WORK, "docs");
const SFX = path.join(WORK, "SFX");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.mkdirSync(SFX);
const FAV = path.join(SFX, "riser.wav");
const PLAIN = path.join(SFX, "boom.wav");
writeWav(FAV, 2);
writeWav(PLAIN, 1);
function rec(p, extra) {
  const st = fs.statSync(p);
  return Object.assign({ path: p, section: "sfx", name: path.basename(p), size: st.size, mtimeMs: Math.round(st.mtimeMs),
    status: "done", v: 3, durationSec: 1, camelot: "8A", key: "A", scale: "minor" }, extra || {});
}
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
fs.writeFileSync(path.join(DOCS, "Downbeat", "sound-library.json"), JSON.stringify({ version: 1, folders: { music: [], sfx: [SFX] },
  files: { [FAV]: rec(FAV, { fav: true }), [PLAIN]: rec(PLAIN) } }));

const fake = mocks.makePremiereHost({ mediaPath: "/music/other.wav", durationSec: 60, clipStart: 0, audioTrackCount: 6, playheadSeconds: 30, insertDurationSec: 2 });
const host = mocks.loadHost(fake.context);
let inserts = 0;
function slowEval(script, cb) {
  if (/^insertAudioAtPlayhead\(/.test(script)) {
    inserts++;
    setTimeout(function () { host.evalScript(script, cb); }, 200); // the host takes a moment
    return;
  }
  host.evalScript(script, cb);
}
const panel = bootPanel({ docsDir: DOCS, evalScript: slowEval, realTimeouts: true, realIntervals: false });
const $ = panel.registry;
const SL = window.BeatMarkerSoundLibrary;
const TL = window.BeatMarkerLibrary;
function clipsNamed(name) {
  let n = 0;
  const tracks = fake.context.app.project.activeSequence.audioTracks;
  for (let t = 0; t < tracks.numTracks; t++) {
    tracks[t].clips.forEach(function (c) { if (c.name === name) { n++; } });
  }
  return n;
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

const libTab = panel.allEls.find(function (e) { return e._cls && e._cls["tab-btn"] && e.attrs["data-tab"] === "library"; });
libTab._fire("click");
$.libSectionSfxBtn._fire("click");
document._fire("keydown", { key: "ArrowDown", target: document.body });
const selected = $.libraryDisplay.children.filter(function (c) { return c._cls && c._cls["is-selected"]; })[0];
const selectedName = selected ? (/boom/.test(selected.textContent) ? "boom.wav" : "riser.wav") : "?";
document._fire("keydown", { key: "Enter", target: document.body });
document._fire("keydown", { key: "Enter", target: document.body, repeat: true });
document._fire("keydown", { key: "Enter", target: document.body });
wait(800).then(function () {
  check("Enter, its key repeat and a second press during the insert place the sound once",
    inserts === 1 && clipsNamed(selectedName) === 1, "insert calls " + inserts + ", clips " + clipsNamed(selectedName));
  document._fire("keydown", { key: "Enter", target: document.body });
  return wait(800);
}).then(function () {
  check("after the insert finished, Enter inserts again", inserts === 2 && clipsNamed(selectedName) === 2, "insert calls " + inserts);

  // Clear empties the library and touches no file.
  SL.confirm(FAV, "9A", 120);
  TL.confirmKey("/music/confirmed.wav", "confirmed.wav", "5B", "music");
  TL.upsertAnalysis("/music/analyzed.wav", "analyzed.wav", { bpm: 100, beatsArray: [0, 0.6], confidence: 2, phase: 0, clipInfo: null });
  const NOTE = path.join(DOCS, "Downbeat", "my notes.txt");
  fs.writeFileSync(NOTE, "mine");
  const NESTED = path.join(SFX, "sub");
  fs.mkdirSync(NESTED);
  fs.writeFileSync(path.join(NESTED, "keep.wav"), "x");
  function snapshot(dir) {
    const out = {};
    (function walk(d) {
      fs.readdirSync(d).forEach(function (n) {
        const full = path.join(d, n), st = fs.statSync(full);
        if (st.isDirectory()) { out[full + "/"] = true; walk(full); } else { out[full] = st.size + ":" + st.mtimeMs; }
      });
    })(dir);
    return out;
  }
  const audioBefore = snapshot(SFX);
  $.clearLibraryBtn._fire("click");
  check("one click only arms Clear; nothing is removed yet", Object.keys(SL.getState().files).length > 0);
  $.clearLibraryBtn._fire("click");
  const saved = JSON.parse(fs.readFileSync(path.join(DOCS, "Downbeat", "sound-library.json"), "utf8"));
  check("Clear empties folders, records and favourites", Object.keys(saved.files).length === 0 &&
    saved.folders.music.length === 0 && saved.folders.sfx.length === 0, JSON.stringify(saved.folders));
  const timeline = JSON.parse(fs.readFileSync(path.join(DOCS, "Downbeat", "library.json"), "utf8")).filter(function (e) { return e.mediaPath; });
  check("Clear empties the timeline-clip library too", timeline.length === 0, JSON.stringify(timeline));
  check("Clear touches no audio file or folder on disk", JSON.stringify(snapshot(SFX)) === JSON.stringify(audioBefore));
  check("Clear leaves other files in Documents/Downbeat alone", fs.readFileSync(NOTE, "utf8") === "mine");
  check("after Clear the panel asks to be reopened", /reopen the Downbeat panel/.test($.libraryAdminStatus.textContent), $.libraryAdminStatus.textContent);
  check("the Clear hint says audio files are never touched", /never touched/.test(window.BeatMarkerI18n.t("settings.libraryHint")));
  check("selecting a sound shows no Key / BPM confirmation panel", !panel.allEls.some(function (e) { return e.id === "libConfirmPanel"; }));
  if (failures) {
    console.error(failures + " check(s) failed");
    process.exit(1);
  }
  console.log("PASS library user data");
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(0);
}).catch(function (e) { console.error("FAIL " + (e && e.stack || e)); process.exit(1); });
