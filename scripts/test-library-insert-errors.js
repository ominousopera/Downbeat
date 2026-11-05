"use strict";
// A Library insert the host refuses tells the editor why in the panel's
// language, while the support log keeps the host's English text. Real
// panel (scripts/panel-harness.js) in Russian with the real jsx/host.jsx on
// the Premiere stand-in: the only audio track holds music under the
// playhead, so there is no free track for the sound.
// Run: node scripts/test-library-insert-errors.js
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-insert-errors-"));
const DOCS = path.join(WORK, "docs");
const SFX = path.join(WORK, "SFX");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.mkdirSync(SFX);
const BOOM = path.join(SFX, "boom.wav");
writeWav(BOOM, 2);
const st = fs.statSync(BOOM);
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "ru", onboardingCompleted: true, updateCheck: false }));
fs.writeFileSync(path.join(DOCS, "Downbeat", "sound-library.json"), JSON.stringify({ version: 1, folders: { music: [], sfx: [SFX] },
  files: { [BOOM]: { path: BOOM, section: "sfx", name: "boom.wav", size: st.size, mtimeMs: Math.round(st.mtimeMs),
    status: "done", v: 3, durationSec: 2, camelot: "8A", key: "A", scale: "minor" } } }));

// One audio track, the music on it from 0 to 60 s, the playhead at 30 s.
const fake = mocks.makePremiereHost({ mediaPath: "/music/song.wav", durationSec: 60, clipStart: 0, audioTrackCount: 1, playheadSeconds: 30, insertDurationSec: 2 });
const host = mocks.loadHost(fake.context);
const panel = bootPanel({ docsDir: DOCS, evalScript: function (script, cb) { host.evalScript(script, cb); }, realTimeouts: true, realIntervals: false });
const $ = panel.registry;

const libTab = panel.allEls.find(function (e) { return e._cls && e._cls["tab-btn"] && e.attrs["data-tab"] === "library"; });
libTab._fire("click");
$.libSectionSfxBtn._fire("click");
document._fire("keydown", { key: "ArrowDown", target: document.body });
document._fire("keydown", { key: "Enter", target: document.body });
wait(600).then(function () {
  const status = $.libScanStatus.textContent;
  const log = $.log.textContent;
  const I18n = window.BeatMarkerI18n;
  const expected = I18n.t("library.insertFailed", { error: I18n.t("library.insertNoFreeTrack", { seconds: "2.0" }) });
  check("the refusal is shown in Russian, with the sound's length",
    status === expected && /[\u0400-\u04ff]/.test(status) && /2\.0/.test(status), status);
  check("no English host text in the Russian status line", !/No free audio track/.test(status), status);
  check("the log keeps the host's English text", /could not insert boom\.wav: No free audio track at the playhead/.test(log),
    log.split("\n").filter(function (l) { return /could not insert/.test(l); }).join(" | "));
  check("nothing was placed", fake.sequence.audioTracks[0].clips.length === 1);
  const keys = ["library.insertNoFreeTrack", "library.insertOffline", "library.insertGone", "library.insertNotImported",
    "library.insertNotPlaced", "library.insertNoLength"];
  ["en", "ru", "es"].forEach(function (lang) {
    I18n.setLanguage(lang);
    const missing = keys.filter(function (k) { const t = I18n.t(k); return !t || t === k; });
    check("every insert refusal has a " + lang + " text", missing.length === 0, missing.join(", "));
  });
  fs.rmSync(WORK, { recursive: true, force: true });
  if (failures) {
    console.error("\n" + failures + " insert-error check(s) failed");
    process.exit(1);
  }
  console.log("\nLibrary insert refusals are shown in the panel's language");
  process.exit(0);
});
