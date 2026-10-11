"use strict";
// The saved data in Documents/Downbeat:
//   - a data file that is not valid JSON is set aside under
//     <name>.unreadable-<date>-<time>.json and never overwritten; the
//     Library says so;
//   - a data file that cannot be read at all is left alone and not saved
//     over for the session;
//   - a write that fails part-way leaves the previous file intact;
//   - the start-up sweep removes only old temp files;
//   - Premiere and After Effects open at once (one Documents/Downbeat):
//     each takes in the other's newer saves instead of overwriting them.
// Two hosts are two copies of the panel scripts in separate VM contexts.
// Run: node scripts/test-saved-data-safety.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-saved-data-"));
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
// A fresh copy of the given panel scripts, as one host's panel would load them.
function host(files, fsModule) {
  const ctx = { console: console, SystemPath: { MY_DOCUMENTS: "docs", EXTENSION: "ext" } };
  ctx.window = ctx;
  ctx.cep_node = { require: function (m) { return m === "fs" && fsModule ? fsModule : require(m); } };
  vm.createContext(ctx);
  files.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), ctx, { filename: f }); });
  return ctx;
}
function cs(docs) { return { getSystemPath: function () { return docs; } }; }
function sleep(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* spaced file times */ } }

// ---- 1. Unreadable and unavailable files ----
(function () {
  const docs = path.join(WORK, "docs1"), data = path.join(docs, "Downbeat");
  fs.mkdirSync(data, { recursive: true });
  const good = JSON.stringify({ version: 1, folders: { music: [], sfx: ["/sfx"] }, files: {} });
  fs.writeFileSync(path.join(data, "sound-library.json"), good.slice(0, 30));
  fs.writeFileSync(path.join(data, "library.json"), JSON.stringify({ not: "an array" }));
  const P = host(["persistence.js"]).BeatMarkerPersistence;
  const sl = P.loadSoundLibrary(cs(docs));
  const aside = fs.readdirSync(data).filter(function (n) { return /^sound-library\.unreadable-\d{8}-\d{6}\.json$/.test(n); });
  check("a cut-off sound-library.json is set aside, not read as empty", !sl.ok && !!sl.setAside && aside.length === 1 &&
    fs.readFileSync(path.join(data, aside[0]), "utf8") === good.slice(0, 30), JSON.stringify(sl));
  const tl = P.load(cs(docs));
  check("a library.json that is not a list is set aside too", !tl.ok && !!tl.setAside && !fs.existsSync(path.join(data, "library.json")));
  check("saving afterwards writes a new file and keeps the set-aside copy",
    P.saveSoundLibrary(cs(docs), { version: 1, folders: { music: [], sfx: [] }, files: {} }).ok &&
    fs.existsSync(path.join(data, "sound-library.json")) && fs.existsSync(path.join(data, aside[0])));
  const listed = P.listUserData(cs(docs)).files.map(function (f) { return path.basename(f); });
  check("Delete my data lists the set-aside copies as Downbeat's own", listed.indexOf(aside[0]) !== -1, listed.join(", "));
  const swept = P.clearLeftoverTempFiles(cs(docs));
  check("the start-up sweep never removes a set-aside copy", swept.ok && fs.existsSync(path.join(data, aside[0])));
})();

(function () {
  const docs = path.join(WORK, "docs2"), data = path.join(docs, "Downbeat");
  fs.mkdirSync(path.join(data, "library.json"), { recursive: true }); // something unreadable as a file
  const P = host(["persistence.js"]).BeatMarkerPersistence;
  const r = P.load(cs(docs));
  const saved = P.save(cs(docs), [{ mediaPath: "/a.wav", label: "a" }]);
  check("a data file that cannot be read is left alone and not saved over",
    !r.ok && r.blocked && !saved.ok && /not saved/.test(saved.error) && fs.statSync(path.join(data, "library.json")).isDirectory(),
    JSON.stringify(r) + " | " + JSON.stringify(saved));
})();

(function () {
  const docs = path.join(WORK, "docs3"), data = path.join(docs, "Downbeat");
  fs.mkdirSync(path.join(data, "tmp"), { recursive: true });
  const before = JSON.stringify({ language: "ru", onboardingCompleted: true });
  fs.writeFileSync(path.join(data, "settings.json"), before);
  const failing = Object.assign({}, fs, {
    writeFileSync: function (p) {
      if (/\.tmp-/.test(String(p))) { const e = new Error("ENOSPC: no space left on device"); e.code = "ENOSPC"; throw e; }
      return fs.writeFileSync.apply(fs, arguments);
    }
  });
  const P = host(["persistence.js"], failing).BeatMarkerPersistence;
  const r = P.saveSettings(cs(docs), { language: "en" });
  check("a save that fails part-way leaves the previous file whole", !r.ok && fs.readFileSync(path.join(data, "settings.json"), "utf8") === before,
    JSON.stringify(r));
  const old = path.join(data, "settings.json.tmp-1-2"), young = path.join(data, "library.json.tmp-3-4");
  const oldRaw = path.join(data, "tmp", "samples-5-6.raw"), youngRaw = path.join(data, "tmp", "skey-7-8.raw");
  [old, young, oldRaw, youngRaw].forEach(function (f) { fs.writeFileSync(f, "x"); });
  const dayAgo = new Date(Date.now() - 86400000);
  [old, oldRaw].forEach(function (f) { fs.utimesSync(f, dayAgo, dayAgo); });
  const P2 = host(["persistence.js"]).BeatMarkerPersistence;
  const s = P2.clearLeftoverTempFiles(cs(docs));
  check("the start-up sweep removes old temp files and keeps fresh ones (the other host's)",
    s.ok && s.removed === 2 && !fs.existsSync(old) && !fs.existsSync(oldRaw) && fs.existsSync(young) && fs.existsSync(youngRaw), JSON.stringify(s));
})();

// ---- 2. Two hosts sharing one folder library ----
(function () {
  const docs = path.join(WORK, "docs4");
  fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
  const A = host(["camelot.js", "sound-library.js", "persistence.js"]);
  const B = host(["camelot.js", "sound-library.js", "persistence.js"]);
  function save(h) {
    const fresh = h.BeatMarkerPersistence.readIfChanged(cs(docs), "sound-library");
    if (fresh.changed) { h.BeatMarkerSoundLibrary.absorb(fresh.value); }
    return h.BeatMarkerPersistence.saveSoundLibrary(cs(docs), h.BeatMarkerSoundLibrary.getState());
  }
  function load(h) { h.BeatMarkerSoundLibrary.loadState(h.BeatMarkerPersistence.loadSoundLibrary(cs(docs)).state); }
  function files(dir, names) { return names.map(function (n) { return { path: dir + "/" + n, size: 10, mtimeMs: 1 }; }); }
  const SA = A.BeatMarkerSoundLibrary, SB = B.BeatMarkerSoundLibrary;
  SA.addFolder("sfx", "/lib/SFX");
  SA.syncFiles("sfx", files("/lib/SFX", ["a.wav", "b.wav"]), []);
  ["/lib/SFX/a.wav", "/lib/SFX/b.wav"].forEach(function (p) { SA.setResult(p, { ok: true, durationSec: 1, camelot: "8A", key: "A", scale: "minor" }); });
  save(A);
  load(B);
  sleep(5);
  SA.setFavorite("/lib/SFX/a.wav", true);
  save(A);
  sleep(5);
  SB.confirm("/lib/SFX/b.wav", "3B", null); // B has not seen A's favourite
  save(B);
  load(A);
  const st = SA.getState().files;
  check("a favourite set in one host survives the other host's later save",
    st["/lib/SFX/a.wav"] && st["/lib/SFX/a.wav"].fav === true && st["/lib/SFX/b.wav"].confirmedKey.camelot === "3B");

  sleep(5);
  SA.addFolder("music", "/lib/Music");
  SA.syncFiles("music", files("/lib/Music", ["song.mp3"]), []);
  save(A);
  SB.absorb(B.BeatMarkerPersistence.readIfChanged(cs(docs), "sound-library").value);
  check("a folder added in one host appears in the other", SB.getFolders("music").indexOf("/lib/Music") !== -1 && !!SB.getState().files["/lib/Music/song.mp3"]);
  sleep(5);
  SA.removeFolder("music", "/lib/Music");
  save(A);
  sleep(5);
  SB.setFavorite("/lib/SFX/b.wav", true); // B still lists the folder A removed
  save(B);
  load(A);
  check("a folder removed in one host is not brought back by the other's save",
    SA.getFolders("music").length === 0 && !SA.getState().files["/lib/Music/song.mp3"] && SA.getState().files["/lib/SFX/b.wav"].fav === true,
    JSON.stringify(SA.getFolders("music")));
  sleep(5);
  SA.addFolder("music", "/lib/Music");
  save(A);
  SB.absorb(B.BeatMarkerPersistence.readIfChanged(cs(docs), "sound-library").value);
  check("adding that folder again later counts", SB.getFolders("music").indexOf("/lib/Music") !== -1);

  sleep(5);
  SA.clearAll();
  save(A);
  sleep(5);
  save(B); // B still holds the whole old library and saves without changes
  load(A);
  const after = SA.getState();
  check("Clear in one host is not undone by the other host's older library",
    Object.keys(after.files).length === 0 && after.folders.music.length === 0 && after.folders.sfx.length === 0,
    JSON.stringify(Object.keys(after.files)) + " " + JSON.stringify(after.folders));
  check("... and the other host takes the clear in as well",
    Object.keys(SB.getState().files).length === 0 && SB.getFolders("sfx").length === 0);
})();

// ---- 3. Two hosts sharing the timeline-clip library ----
(function () {
  const docs = path.join(WORK, "docs5");
  fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
  const A = host(["camelot.js", "library.js", "persistence.js"]);
  const B = host(["camelot.js", "library.js", "persistence.js"]);
  function save(h) {
    const fresh = h.BeatMarkerPersistence.readIfChanged(cs(docs), "library");
    if (fresh.changed) { h.BeatMarkerLibrary.absorb(fresh.value); }
    return h.BeatMarkerPersistence.save(cs(docs), h.BeatMarkerLibrary.getAll());
  }
  A.BeatMarkerLibrary.upsertAnalysis("/m/one.wav", "one.wav", { bpm: 120, beatsArray: [0, 0.5], confidence: 2, phase: 0, clipInfo: { trackIndex: 0 } });
  save(A);
  sleep(5);
  B.BeatMarkerLibrary.confirmKey("/m/two.wav", "two.wav", "4A", "music");
  B.BeatMarkerLibrary.upsertAnalysis("/m/one.wav", "one.wav", { bpm: 120, beatsArray: [0, 0.5], confidence: 2, phase: 0, clipInfo: { trackIndex: 3 } });
  save(B);
  sleep(5);
  A.BeatMarkerLibrary.confirmBpm("/m/one.wav", "one.wav", 121);
  save(A);
  const all = A.BeatMarkerPersistence.load(cs(docs)).entries;
  const one = all.find(function (e) { return e.mediaPath === "/m/one.wav"; });
  const two = all.find(function (e) { return e.mediaPath === "/m/two.wav"; });
  check("timeline clips analyzed or confirmed in either host are all kept",
    !!(one && one.confirmedBpm && one.confirmedBpm.value === 121 && two && two.confirmedKey && two.confirmedKey.camelot === "4A"));
  B.BeatMarkerLibrary.absorb(all);
  const bOne = B.BeatMarkerLibrary.get("/m/one.wav");
  check("a newer entry from the other host is taken in, keeping this host's live clip position",
    bOne.confirmedBpm && bOne.confirmedBpm.value === 121 && bOne.clipInfo && bOne.clipInfo.trackIndex === 3, JSON.stringify(bOne.clipInfo));
})();

// ---- 4. The real panel: settings merge and the visible load message ----
(function () {
  const docs = path.join(WORK, "docs6"), data = path.join(docs, "Downbeat");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
  fs.writeFileSync(path.join(data, "sound-library.json"), "{\"version\":1,\"folders\":{\"music\":[");
  const mocks = require("./host-mocks.js");
  const fake = mocks.makePremiereHost({ mediaPath: "/music/other.wav", durationSec: 60 });
  const hostScript = mocks.loadHost(fake.context);
  const { bootPanel } = require("./panel-harness.js");
  const panel = bootPanel({ docsDir: docs, evalScript: hostScript.evalScript, realTimeouts: true, realIntervals: false });
  const $ = panel.registry;
  check("the Library says the saved library could not be read and where the old file is",
    /could not be read/.test($.libScanStatus.textContent) && /sound-library\.unreadable-/.test($.libScanStatus.textContent),
    $.libScanStatus.textContent);
  sleep(5);
  // The other host saves its settings meanwhile.
  const theirs = JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8"));
  theirs.markerTarget = "sequence";
  theirs.otherHostChoice = 7;
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify(theirs));
  $.keyMaterialSfxBtn._fire("click");
  const merged = JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8"));
  check("a settings change here keeps the other host's newer settings",
    merged.keyMaterial === "sfx" && merged.markerTarget === "sequence" && merged.otherHostChoice === 7, JSON.stringify(merged));
})();

fs.rmSync(WORK, { recursive: true, force: true });
if (failures) {
  console.error(failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS saved data safety");
process.exit(0);
