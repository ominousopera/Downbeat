"use strict";
// Saved data kept honest in the real panel (panel-harness), one panel per
// child process on a throwaway Documents folder:
//   - after Delete my data, the next settings change saves only the current
//     choices, not the deleted ones; a delete that fails for one file still
//     empties the Library in memory and says to reopen the panel;
//   - a per-clip map (where Place last put timeline markers) keeps the entry
//     the other host saved meanwhile when this panel changes its own entry;
//   - a data file with a UTF-8 byte order mark is read, not set aside;
//   - a save that fails is said on screen until a save works again;
//   - a settings.json that cannot be opened is said, and no first-run
//     question or tour starts;
//   - Save a copy that fails half-way leaves the old copy whole, and Load a
//     copy reads a file with a byte order mark;
//   - Esc closes Delete my data, not Settings behind it.
// Run: node scripts/test-saved-data-problems.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SONG = "/Volumes/Work/Music/Client A/song.wav";
const FOLDER = "/Volumes/Work/Music/Client A";
const OWN_KEY = "ae|comp-1|layer-1";
const OTHER_KEY = "pr|seq-1|node-9";
const BACKUP = { format: "downbeat-library-backup", version: 1, soundLibrary: { folders: { music: [], sfx: [] }, files: {} },
  trackLibrary: [{ mediaPath: "/Volumes/Work/Music/from-copy.wav", label: "from-copy.wav", bpm: 100 }] };

function soundLibrary(withFolder) {
  return { version: 1, folders: { music: withFolder ? [FOLDER] : [], sfx: [] },
    files: withFolder ? { [SONG]: { path: SONG, section: "music", name: "song.wav", size: 1, mtimeMs: 1, status: "done", v: 1, updatedAt: 1, bpm: 120, camelot: "8A" } } : {},
    removed: {}, folderAt: {}, removedFolders: {}, clearedAt: { music: 0, sfx: 0 }, dataGeneration: "sound" };
}

// ---- child: one panel, one scenario ----
if (process.argv[2] === "child") {
  const scenario = process.argv[3], docs = process.argv[4];
  const dataDir = path.join(docs, "Downbeat");
  const settingsFile = path.join(dataDir, "settings.json");
  const out = process.stdout.write.bind(process.stdout);
  console.log = function () {};
  const copy = path.join(docs, "downbeat-library-copy.json");
  if (scenario === "partial") {
    const unlink = fs.unlinkSync;
    fs.unlinkSync = function (p) {
      if (String(p) === settingsFile) { throw Object.assign(new Error("EBUSY: resource busy or locked, unlink"), { code: "EBUSY" }); }
      return unlink.apply(fs, arguments);
    };
  }
  let failCopy = false;
  const copyFds = {};
  if (scenario === "copy") {
    const open = fs.openSync, write = fs.writeFileSync;
    fs.openSync = function (p) {
      const fd = open.apply(fs, arguments);
      if (String(p).indexOf(copy + ".tmp-") === 0) { copyFds[fd] = true; }
      return fd;
    };
    fs.writeFileSync = function (target, data) {
      if (failCopy && typeof target === "number" && copyFds[target]) {
        write.call(fs, target, String(data).slice(0, String(data).length >> 1));
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
      }
      return write.apply(fs, arguments);
    };
  }
  function reply(script) {
    if (/^clearMarkersForSelectedClip\(/.test(script)) {
      return { ok: true, error: null, data: { placedKey: OWN_KEY, sequenceMarkersRemoved: 0, clipStartSeconds: 0, clipEndSeconds: 10, clipMarkersAttempted: true, clipMarkersRemoved: 0 } };
    }
    if (/^pickSaveFile\(/.test(script) || /^pickOpenFile\(/.test(script)) { return { ok: true, error: null, data: { path: copy } }; }
    return { ok: false, error: "No active sequence.", data: null };
  }
  const h = require("./panel-harness.js").bootPanel({ docsDir: docs, realTimeouts: true, appName: scenario === "maps" ? "AEFT" : "PPRO",
    evalScript: function (s, cb) { if (cb) { setImmediate(function () { cb(JSON.stringify(reply(s))); }); } } });
  const r = h.registry;
  const wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  const readJson = function (f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
  const setTarget = function (value) {
    const radios = h.select('input[name="markerTarget"]');
    radios.forEach(function (x) { x.checked = x.attrs.value === value; });
    radios.filter(function (x) { return x.checked; })[0]._fire("change");
  };
  const shownProblem = function () { return r.dataProblemRow.hidden ? "" : r.dataProblemStatus.textContent; };
  const result = {};
  (async function () {
    await wait(200);
    if (scenario === "delete") {
      r.deleteDataBtn._fire("click");
      await wait(650);
      r.deleteDataConfirmBtn._fire("click");
      result.done = r.deleteDataMessage.textContent;
      setTarget("sequence");
      result.settings = readJson(settingsFile);
    } else if (scenario === "partial") {
      r.deleteDataBtn._fire("click");
      await wait(650);
      r.deleteDataConfirmBtn._fire("click");
      result.done = r.deleteDataMessage.textContent;
      result.folders = global.window.BeatMarkerSoundLibrary.getFolders("music");
      result.tracks = global.window.BeatMarkerLibrary.getAll().length;
      r.libRescanBtn._fire("click");
      result.sound = readJson(path.join(dataDir, "sound-library.json"));
    } else if (scenario === "maps") {
      // The other host places markers on its own clip and saves.
      const other = readJson(settingsFile);
      const now = Date.now();
      other.placedTimeline[OTHER_KEY] = { t: [3, 4, 5], at: now };
      other.settingsChangedAt = { placedTimeline: now };
      fs.writeFileSync(settingsFile, JSON.stringify(other, null, 2));
      r.clearMarkersBtn._fire("click");
      await wait(300);
      result.settings = readJson(settingsFile);
    } else if (scenario === "bom") {
      result.question = !r.langPickOverlay.hidden;
      result.tracks = global.window.BeatMarkerLibrary.getAll().length;
      result.files = fs.readdirSync(dataDir).sort();
    } else if (scenario === "save-failed") {
      fs.chmodSync(dataDir, 0o555);
      r.libRescanBtn._fire("click");
      setTarget("sequence");
      result.failedLine = shownProblem();
      fs.chmodSync(dataDir, 0o755);
      r.libRescanBtn._fire("click");
      setTarget("clip");
      result.afterLine = shownProblem();
    } else if (scenario === "blocked") {
      result.line = shownProblem();
      result.question = !r.langPickOverlay.hidden || !r.updatePickOverlay.hidden;
      result.tour = !r.tourOverlay.hidden;
      fs.chmodSync(settingsFile, 0o600);
    } else if (scenario === "copy") {
      fs.writeFileSync(copy, "old copy");
      failCopy = true;
      r.saveLibraryBackupBtn._fire("click");
      await wait(100);
      result.failedStatus = r.libraryAdminStatus.textContent;
      result.oldKept = fs.readFileSync(copy, "utf8") === "old copy";
      result.tempsAfterFail = fs.readdirSync(docs).filter(function (n) { return n.indexOf(".tmp-") !== -1; });
      failCopy = false;
      r.saveLibraryBackupBtn._fire("click");
      await wait(100);
      const saved = readJson(copy);
      result.newSaved = !!saved && saved.format === "downbeat-library-backup";
      result.tempsAfterSave = fs.readdirSync(docs).filter(function (n) { return n.indexOf(".tmp-") !== -1; });
      fs.writeFileSync(copy, "\uFEFF" + JSON.stringify(BACKUP));
      r.loadLibraryBackupBtn._fire("click");
      await wait(100);
      result.loadedFromBom = global.window.BeatMarkerLibrary.getAll().some(function (e) { return e.mediaPath === BACKUP.trackLibrary[0].mediaPath; });
    } else if (scenario === "esc") {
      r.settingsGearBtn._fire("click");
      r.deleteDataBtn._fire("click");
      document._fire("keydown", { key: "Escape", target: document.body });
      result.dialogOpen = !r.deleteDataOverlay.hidden;
      result.settingsOpen = !r.settingsPanel.hidden;
    }
    out("RESULT " + JSON.stringify(result) + "\n");
    process.exit(0);
  })();
  return;
}

// ---- parent ----
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-saved-data-"));
function run(scenario, files) {
  const docs = path.join(WORK, scenario);
  const dataDir = path.join(docs, "Downbeat");
  fs.mkdirSync(dataDir, { recursive: true });
  Object.keys(files).forEach(function (f) {
    fs.writeFileSync(path.join(dataDir, f), typeof files[f] === "string" ? files[f] : JSON.stringify(files[f]));
  });
  if (scenario === "blocked") { fs.chmodSync(path.join(dataDir, "settings.json"), 0o000); }
  const text = execFileSync(process.execPath, [__filename, "child", scenario, docs], { encoding: "utf8", timeout: 120000 });
  const line = text.split("\n").filter(function (l) { return l.indexOf("RESULT ") === 0; })[0];
  return line ? JSON.parse(line.slice(7)) : {};
}
const OLD_SETTINGS = {
  language: "en", onboardingCompleted: true, updateCheck: true, lastUpdateCheck: 1, markerTarget: "clip",
  libraryFolderScope: { music: [FOLDER], sfx: [] }, audioOutputMode: "custom", audioOutputFolder: "/Volumes/Work/Private/Exports",
  markerNudgeMs: { [SONG]: 4 }, placedTimeline: { "pr|seq-1|node-7": { t: [1, 2, 3], at: 1 } }, dataGeneration: "old-settings"
};
const OLD_LIBRARY = [{ mediaPath: SONG, label: "song.wav", bpm: 120, beatsArray: [0.5, 1], phase: 0, updatedAt: 1 },
  { mediaPath: "", downbeatLibraryMeta: { generation: "old-library", clearedAt: 0, removed: {} } }];
const posixUser = process.platform !== "win32" && !(process.getuid && process.getuid() === 0);
try {
  {
    const r = run("delete", { "settings.json": OLD_SETTINGS, "library.json": OLD_LIBRARY, "sound-library.json": soundLibrary(true) });
    const s = r.settings || {};
    const back = ["libraryFolderScope", "audioOutputFolder", "markerNudgeMs", "placedTimeline", "updateCheck", "lastUpdateCheck"].filter(function (k) { return s[k] !== undefined; });
    check("Delete my data, then a settings change: only current choices are saved",
      /Deleted 3 file/.test(r.done || "") && s.markerTarget === "sequence" && s.language === "en" && s.onboardingCompleted === true && !back.length,
      JSON.stringify(r.done) + " " + JSON.stringify(s));
  }
  {
    const r = run("partial", { "settings.json": OLD_SETTINGS, "library.json": OLD_LIBRARY, "sound-library.json": soundLibrary(true) });
    check("a delete that fails for one file empties the Library in memory and says to reopen the panel",
      /could not be deleted/.test(r.done || "") && /reopen the panel/.test(r.done || "") && r.folders.length === 0 && r.tracks === 0 &&
      !(r.sound && r.sound.folders && r.sound.folders.music.length), JSON.stringify(r));
  }
  {
    const r = run("maps", { "settings.json": { language: "en", onboardingCompleted: true, updateCheck: false, markerTarget: "sequence",
      placedTimeline: { [OWN_KEY]: { t: [1, 2], at: 1 } }, settingsChangedAt: { placedTimeline: 1 }, dataGeneration: "g" } });
    const m = (r.settings && r.settings.placedTimeline) || {};
    check("Clear in one host removes its own entry and keeps the one the other host saved meanwhile",
      !!m[OTHER_KEY] && !m[OWN_KEY], JSON.stringify(m));
  }
  {
    const r = run("bom", { "settings.json": "\uFEFF" + JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }),
      "library.json": "\uFEFF" + JSON.stringify(OLD_LIBRARY) });
    check("files with a byte order mark are read, not set aside",
      r.question === false && r.tracks === 1 && !r.files.some(function (f) { return /unreadable/.test(f); }), JSON.stringify(r));
  }
  if (posixUser) {
    const r = run("save-failed", { "settings.json": { language: "en", onboardingCompleted: true, updateCheck: false }, "sound-library.json": soundLibrary(false) });
    check("a failed save is said on screen, and the line goes once saves work again",
      /could not save/.test(r.failedLine || "") && r.afterLine === "", JSON.stringify(r));
    const b = run("blocked", { "settings.json": { language: "ru", onboardingCompleted: true, updateCheck: false } });
    check("settings.json that cannot be opened: said on screen, no first-run question, no tour",
      /settings\.json/.test(b.line || "") && b.question === false && b.tour === false, JSON.stringify(b));
  } else {
    console.log("skip read-only and unreadable-file checks (need a POSIX non-root user)");
  }
  {
    const r = run("copy", { "settings.json": { language: "en", onboardingCompleted: true, updateCheck: false }, "sound-library.json": soundLibrary(true) });
    check("Save a copy that fails half-way leaves the old copy whole and no temp file",
      r.oldKept === true && r.tempsAfterFail.length === 0 && /could not|failed/i.test(r.failedStatus || ""), JSON.stringify(r));
    check("... and the next Save a copy writes the new copy, with no temp file left",
      r.newSaved === true && r.tempsAfterSave.length === 0, JSON.stringify(r));
    check("Load a copy reads a file with a byte order mark", r.loadedFromBom === true, JSON.stringify(r));
  }
  {
    const r = run("esc", { "settings.json": { language: "en", onboardingCompleted: true, updateCheck: false } });
    check("Esc closes Delete my data and leaves Settings open", r.dialogOpen === false && r.settingsOpen === true, JSON.stringify(r));
  }
} finally {
  try { fs.chmodSync(path.join(WORK, "save-failed", "Downbeat"), 0o755); } catch (e) { /* not made */ }
  fs.rmSync(WORK, { recursive: true, force: true });
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nSaved data: Delete my data, two hosts, BOM files, failed saves, unreadable settings and Save a copy behave");
