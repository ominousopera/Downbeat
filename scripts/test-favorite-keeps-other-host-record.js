"use strict";
// A star clicked in one host keeps what the other host changed on the same
// sound since this panel last took the file in: its fresh scan result and
// its confirmed key. The panel takes the other host's file in before
// applying the star (js/library-tab.js _libToggleFavorite). Two real panels
// (scripts/panel-harness.js) in separate Node processes on one throwaway
// Documents/Downbeat; the clock is set by hand so the other host's change
// is the newer one.
// Run: node scripts/test-favorite-keeps-other-host-record.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HARNESS = path.join(__dirname, "panel-harness.js");

function rowStar(h, name) {
  const row = h.registry.libraryDisplay.children.find(function (x) {
    return /lib-row/.test(x.className || "") && x.children.some(function (c) {
      return /lib-row-main/.test(c.className || "") && c.children.some(function (n) { return n.textContent === name; });
    });
  });
  if (!row) { throw new Error("no row for " + name); }
  return row.children.find(function (x) { return /lib-fav/.test(x.className || ""); });
}
function click(star) { star._fire("click", { stopPropagation: function () {} }); }

// The other host: starts at the given time, changes two.wav (a scan result
// or a confirmed key), saves through a star on one.wav and closes.
if (process.argv[2] === "other") {
  const docs = process.argv[3], variant = process.argv[5];
  Date.now = function () { return Number(process.argv[4]); };
  const h = require(HARNESS).bootPanel({ docsDir: docs });
  const SL = window.BeatMarkerSoundLibrary;
  const two = path.join(docs, "two.wav");
  if (variant === "scan") {
    SL.setResult(two, { ok: true, durationSec: 12, bpm: 128, bpmConfidence: 0.9, camelot: "8A", key: "A", scale: "minor", strength: 0.8 });
  } else {
    SL.confirm(two, "8A", null);
  }
  click(rowStar(h, "one.wav")); // saves the whole state at once
  process.exit(0);
}

// This panel: drawn before the other host's change, then stars two.wav.
if (process.argv[2] === "mine") {
  const docs = process.argv[3], variant = process.argv[5], absorbFirst = process.argv[6] === "absorb";
  const t0 = Number(process.argv[4]);
  const h = require(HARNESS).bootPanel({ docsDir: docs });
  const SL = window.BeatMarkerSoundLibrary;
  const two = path.join(docs, "two.wav");
  const starTwo = rowStar(h, "two.wav");
  execFileSync(process.execPath, [__filename, "other", docs, String(t0 + 1000), variant], { stdio: "pipe", timeout: 30000 });
  Date.now = function () { return t0 + 2000; };
  if (absorbFirst) {
    // A save of this panel's own first (a star on one.wav) takes the other
    // host's change in and redraws the rows.
    click(rowStar(h, "one.wav"));
    Date.now = function () { return t0 + 2500; };
  }
  click(absorbFirst ? rowStar(h, "two.wav") : starTwo);
  const disk = JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", "sound-library.json"), "utf8")).files[two];
  const mem = SL.getState().files[two];
  console.log(JSON.stringify({ variant: variant, absorbFirst: absorbFirst,
    disk: { status: disk.status, bpm: disk.bpm, confirmedKey: disk.confirmedKey, fav: !!disk.fav, updatedAt: disk.updatedAt },
    memory: { status: mem.status, bpm: mem.bpm, confirmedKey: mem.confirmedKey, fav: !!mem.fav } }));
  process.exit(0);
}

let defects = 0;
for (const variant of ["scan", "confirm"]) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-star-record-"));
  try {
    const dir = path.join(work, "Downbeat");
    fs.mkdirSync(dir);
    const t0 = Date.now();
    const files = {};
    ["one.wav", "two.wav"].forEach(function (name) {
      const p = path.join(work, name);
      fs.writeFileSync(p, "fixture");
      const st = fs.statSync(p);
      files[p] = variant === "scan" && name === "two.wav"
        ? { path: p, name: name, section: "music", size: st.size, mtimeMs: st.mtimeMs, status: "pending", updatedAt: t0 }
        : { path: p, name: name, section: "music", size: st.size, mtimeMs: st.mtimeMs, status: "done", v: 3, nameChecked: 1, bpm: 120, updatedAt: t0 };
    });
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false, librarySection: "music" }));
    fs.writeFileSync(path.join(dir, "sound-library.json"), JSON.stringify({ version: 1, folders: { music: [work], sfx: [] }, files: files }));
    const out = execFileSync(process.execPath, [__filename, "mine", work, String(t0), variant, "stale"], { encoding: "utf8", timeout: 60000 });
    const r = JSON.parse(out.trim().split("\n").pop());
    const lost = variant === "scan" ? r.disk.status !== "done" || r.disk.bpm !== 128 : !r.disk.confirmedKey || r.disk.confirmedKey.camelot !== "8A";
    const what = variant === "scan" ? "the other host's scan result (status done, 128 BPM)" : "the other host's confirmed key 8A";
    if (lost) {
      defects++;
      console.log("FAIL (" + variant + "): a star clicked here dropped " + what + " from sound-library.json: " + JSON.stringify(r.disk));
    } else {
      console.log("ok (" + variant + "): " + what + " survived the star: " + JSON.stringify(r.disk));
    }
    // Contrast: the same click after this panel took the other host's save
    // in (a save of its own first) keeps the other host's change.
    fs.writeFileSync(path.join(dir, "sound-library.json"), JSON.stringify({ version: 1, folders: { music: [work], sfx: [] }, files: files }));
    const outB = execFileSync(process.execPath, [__filename, "mine", work, String(t0), variant, "absorb"], { encoding: "utf8", timeout: 60000 });
    console.log("   (context, after a focus/absorb first: " + outB.trim().split("\n").pop() + ")");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
if (defects) { process.exit(1); }
console.log("ok: a star keeps what the other host saved");
