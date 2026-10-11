"use strict";
// Placing markers on one use of a song keeps the markers of its other uses
// (Premiere and After Effects); a data file that briefly cannot be checked
// is not taken as deleted, and adding a folder afterwards keeps the Library
// and favorites; Paste keeps two markers that differ only in length; Delete
// my data stays done when the deleting host saves new data before the other
// open host looks.
// Run: node scripts/test-shared-song-and-data-safety.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const mocks = require("./host-mocks.js");
const { bootPanel } = require("./panel-harness.js");

const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-shared-song-"));
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function arg(v) { return JSON.stringify(JSON.stringify(v)); }
function flush() { return new Promise(function (resolve) { setImmediate(resolve); }); }

// ---- Two uses of one song in one sequence / composition ----
function reusedSong(kind) {
  const fake = kind === "Premiere" ?
    mocks.makePremiereHost({ mediaPath: "/synthetic/Song.wav", durationSec: 10, clipStart: 0 }) :
    mocks.makeAeHost({ mediaPath: "/synthetic/Song.wav", durationSec: 10, startTime: 0, compDuration: 80 });
  let first, second;
  if (kind === "Premiere") {
    fake.sequence.sequenceID = "sequence-1";
    first = fake.audioTrack.clips[0];
    second = new mocks.PClip(first.projectItem, 30, 40, 0, false);
    fake.audioTrack.clips.push(second);
  } else {
    fake.comp.id = 101;
    first = fake.comp.layers[0];
    second = first.duplicate();
    second.startTime = 30; second.inPoint = 30; second.outPoint = 40; second.selected = false;
  }
  const host = mocks.loadHost(fake.context);
  function place(times) {
    const info = JSON.parse(host.run("getSelectedAudioInfo()"));
    if (!info.ok) { throw new Error(info.error); }
    const result = JSON.parse(host.run("createMarkers(" + arg(times) + "," + arg(["D", "b", "b"]) + ",true," + arg(info.data) + ")"));
    if (!result.ok) { throw new Error(result.error); }
  }
  place([1, 2, 3]);
  first.selected = false; second.selected = true;
  place([31, 32, 33]);
  const times = kind === "Premiere" ? fake.sequence.markers.list.map(function (m) { return m.start.seconds; }) :
    fake.comp.markerProperty.keys.map(function (k) { return k.t; });
  check(kind + ": both uses of the song keep their markers", [1, 2, 3, 31, 32, 33].every(function (t) { return times.indexOf(t) !== -1; }), JSON.stringify(times));
}
reusedSong("Premiere");
reusedSong("After Effects");

// ---- Two markers at one time, different lengths ----
(function () {
  const fake = mocks.makePremiereHost({ mediaPath: "/synthetic/Source.wav", durationSec: 10 });
  const host = mocks.loadHost(fake.context);
  const short = fake.clipMarkers.createMarker(2); short.name = "Section"; short.end = 3;
  const long = fake.clipMarkers.createMarker(2); long.name = "Section"; long.end = 7;
  const copied = JSON.parse(host.run("getMarkersDataForSelectedClip()")).data;
  const target = new mocks.MarkerCollection();
  fake.audioTrack.clips[0].projectItem = { name: "Target.wav", getMediaPath: function () { return "/synthetic/Target.wav"; }, getMarkers: function () { return target; } };
  const info = JSON.parse(host.run("getSelectedAudioInfo()")).data;
  const pasted = JSON.parse(host.run("pasteMarkersData(" + arg(copied) + "," + arg(info) + ")"));
  const lengths = target.list.map(function (m) { return m.end.seconds - m.start.seconds; }).sort();
  check("Paste keeps markers that differ only in length", pasted.ok && JSON.stringify(lengths) === "[1,5]", JSON.stringify(lengths));
  const again = JSON.parse(host.run("pasteMarkersData(" + arg(copied) + "," + arg(info) + ")"));
  check("... and pasting again adds none", again.ok && target.list.length === 2 && again.data.kept === 2, JSON.stringify(again.data));
})();

(async function () {
  // ---- One failed check of library.json, then Add folder ----
  await (async function () {
    const dir = path.join(WORK, "flaky-check");
    const docs = path.join(dir, "docs"), data = path.join(docs, "Downbeat");
    const song = path.join(dir, "Song.wav"), oldFolder = path.join(dir, "Old sounds"), newFolder = path.join(dir, "New sounds");
    const libraryFile = path.join(data, "library.json"), soundFile = path.join(data, "sound-library.json");
    fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(oldFolder); fs.mkdirSync(newFolder);
    fs.writeFileSync(song, "synthetic identity fixture");
    const sound = path.join(oldFolder, "Rain.wav"); fs.writeFileSync(sound, "synthetic identity fixture");
    const st = fs.statSync(sound);
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
    fs.writeFileSync(libraryFile, JSON.stringify([{ mediaPath: song, label: "Song", bpm: 120, beatsArray: [0, 0.5] }]));
    const files = {};
    files[sound] = { path: sound, name: "Rain.wav", section: "music", size: st.size, mtimeMs: st.mtimeMs, status: "done", fav: true, bpm: 100, camelot: "8A" };
    fs.writeFileSync(soundFile, JSON.stringify({ version: 1, folders: { music: [oldFolder], sfx: [] }, files: files }));
    const fake = mocks.makePremiereHost({ mediaPath: song, durationSec: 10 });
    const host = mocks.loadHost(fake.context);
    const panel = bootPanel({ docsDir: docs, evalScript: function (script, cb) {
      return script === "pickFolder()" ? cb(JSON.stringify({ ok: true, data: { directory: newFolder } })) : host.evalScript(script, cb);
    } });
    let failed = false;
    const flaky = Object.create(fs);
    flaky.statSync = function (file) {
      if (file === libraryFile && !failed) { failed = true; throw Object.assign(new Error("synthetic I/O error"), { code: "EIO" }); }
      return fs.statSync.apply(fs, arguments);
    };
    window.cep_node.require = function (name) { return name === "fs" ? flaky : require(name); };
    panel.registry.keyOverrideInput.value = "8A";
    panel.registry.applyKeyOverrideBtn._fire("click");
    await flush();
    window.cep_node.require = require;
    check("the failed check was hit", failed);
    check("... and the panel does not say the data was deleted", panel.registry.libScanStatus.textContent.indexOf("deleted") === -1, panel.registry.libScanStatus.textContent);
    panel.registry.libAddFolderBtn._fire("click");
    await flush(); await flush();
    const saved = JSON.parse(fs.readFileSync(soundFile, "utf8"));
    check("adding a folder keeps the old folder and favorite", saved.folders.music.indexOf(oldFolder) !== -1 && saved.files[sound] && saved.files[sound].fav === true);
    const tracks = JSON.parse(fs.readFileSync(libraryFile, "utf8")).filter(function (e) { return e.mediaPath; });
    check("the analyzed song is still saved", tracks.length === 1 && tracks[0].mediaPath === song);
  })();

  // ---- Delete, reopen and save in one host, then the other saves ----
  await (async function () {
    const dir = path.join(WORK, "two-hosts");
    const docs = path.join(dir, "docs"), data = path.join(docs, "Downbeat");
    fs.mkdirSync(data, { recursive: true });
    const old = path.join(dir, "Old song.wav"), current = path.join(dir, "New song.wav");
    fs.writeFileSync(old, "synthetic old identity"); fs.writeFileSync(current, "synthetic new identity");
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
    fs.writeFileSync(path.join(data, "library.json"), JSON.stringify([{ mediaPath: old, label: "Old song", bpm: 120, beatsArray: [0, 0.5], updatedAt: 1000 }]));
    const fake = mocks.makePremiereHost({ mediaPath: current, durationSec: 10 });
    const host = mocks.loadHost(fake.context);
    const panel = bootPanel({ docsDir: docs, evalScript: host.evalScript });
    function otherHost() {
      const h = { console: console, SystemPath: { MY_DOCUMENTS: "docs" } };
      h.window = h; h.cep_node = { require: require };
      vm.createContext(h);
      ["camelot", "library", "persistence"].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8"), h); });
      return h;
    }
    const cs = { getSystemPath: function () { return docs; } };
    let other = otherHost();
    other.BeatMarkerLibrary.loadEntries(other.BeatMarkerPersistence.load(cs).entries);
    check("Delete my data ran", other.BeatMarkerPersistence.deleteUserData(cs).ok);
    other = otherHost(); // the deleting panel closed and reopened
    other.BeatMarkerLibrary.loadEntries(other.BeatMarkerPersistence.load(cs).entries);
    other.BeatMarkerLibrary.upsertAnalysis(current, "New song", { bpm: 90, beatsArray: [0, 2 / 3] });
    other.BeatMarkerPersistence.save(cs, other.BeatMarkerLibrary.getAll(), other.BeatMarkerLibrary.meta());
    panel.registry.keyOverrideInput.value = "8A";
    panel.registry.applyKeyOverrideBtn._fire("click");
    await flush(); await flush();
    const names = JSON.parse(fs.readFileSync(path.join(data, "library.json"), "utf8")).filter(function (e) { return e.mediaPath; })
      .map(function (e) { return path.basename(e.mediaPath); });
    check("the other host does not bring the deleted song back", names.indexOf("Old song.wav") === -1, JSON.stringify(names));
    check("... and keeps the new one", names.indexOf("New song.wav") !== -1);
  })();
})().catch(function (e) { failures++; console.error("FAIL " + (e.stack || e)); }).then(function () {
  fs.rmSync(WORK, { recursive: true, force: true });
  if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
  console.log("PASS shared song and data safety");
});
