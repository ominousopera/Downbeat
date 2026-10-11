"use strict";
// Behaviour checked along real users' sessions (an editor, a motion
// designer, a sound designer, two hosts open at once):
//   A02 Premiere Paste onto the same media must not double its clip markers;
//   A03 After Effects inserts sound only (a video file's picture stays off);
//   A05 undoing Custom BPM keeps a key set by hand afterwards;
//   A06 an analyzed song on an unplugged drive is kept, not deleted;
//   A07 a second open host does not write back what Clear / Delete my data removed;
//   A08 re-placing timeline markers after moving the clip leaves none behind;
//   A09 Russian / Spanish words to leave out work like English ones;
//   A10 analyses saved by 1.0.3 (no file identity) survive the upgrade.
// Run: node scripts/test-scenario-fixes.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const mocks = require("./host-mocks.js");

const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-scenario-fixes-"));
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function panelScripts(files) {
  const ctx = { console: console, SystemPath: { MY_DOCUMENTS: "docs", EXTENSION: "ext" } };
  ctx.window = ctx;
  ctx.cep_node = { require: require };
  vm.createContext(ctx);
  files.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), ctx, { filename: f }); });
  return ctx;
}
function arg(v) { return JSON.stringify(JSON.stringify(v)); }
function sleep(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* spaced file times */ } }

// ---- A06 / A10: the timeline-clip library keeps what it cannot check ----
(function () {
  const song = path.join(WORK, "Song A.wav");
  fs.writeFileSync(song, "RIFF");
  const L = panelScripts(["camelot.js", "library.js"]).BeatMarkerLibrary;
  L.loadEntries([
    { mediaPath: "/Volumes/Gone drive/Song B.wav", label: "Song B.wav", bpm: 120, beatsArray: [0, 0.5], confirmedKey: { camelot: "8A", source: "user" },
      fileIdentity: { size: 10, mtimeMs: 1 } },
    { mediaPath: song, label: "Song A.wav", bpm: 100, beatsArray: [0, 0.6] } // saved by 1.0.3: no identity
  ]);
  const all = L.getAll().map(function (e) { return path.basename(e.mediaPath); }).sort();
  check("A06 an entry whose drive is unplugged is kept for saving, but not offered as usable",
    all.indexOf("Song B.wav") !== -1 && L.get("/Volumes/Gone drive/Song B.wav") === null &&
    L.getAll(true).every(function (e) { return e.mediaPath !== "/Volumes/Gone drive/Song B.wav"; }), JSON.stringify(all));
  check("A10 an entry saved without a file identity is kept and takes the file's identity",
    L.get(song) && L.get(song).bpm === 100 && L.get(song).fileIdentity && L.get(song).fileIdentity.size === 4);
  fs.writeFileSync(song, "RIFF but replaced");
  check("... while a file that is there but changed still drops its stale entry", L.get(song) === null && L.getAll().length === 1);
})();

// ---- A07: two hosts, Clear and Delete my data ----
(function () {
  const docs = path.join(WORK, "docs-two");
  fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
  const cs = { getSystemPath: function () { return docs; } };
  const files = ["camelot.js", "library.js", "persistence.js", "sound-library.js"];
  const PR = panelScripts(files), AE = panelScripts(files);
  function dropAll(h) { h.BeatMarkerSoundLibrary.loadState(null); h.BeatMarkerLibrary.loadEntries([]); }
  function saveTracks(h) { // as js/main.js persistLibrary
    const fresh = h.BeatMarkerPersistence.readIfChanged(cs, "library");
    if (fresh.deleted) { dropAll(h); return; }
    if (fresh.changed) { h.BeatMarkerLibrary.absorb(fresh.value); }
    h.BeatMarkerPersistence.save(cs, h.BeatMarkerLibrary.getAll(), h.BeatMarkerLibrary.meta());
  }
  function saveSounds(h) { // as js/library-tab.js persistSoundLibrary
    const fresh = h.BeatMarkerPersistence.readIfChanged(cs, "sound-library");
    if (fresh.deleted) { dropAll(h); return; }
    if (fresh.changed) { h.BeatMarkerSoundLibrary.absorb(fresh.value); }
    h.BeatMarkerPersistence.saveSoundLibrary(cs, h.BeatMarkerSoundLibrary.getState());
  }
  function onDisk() { return PR.BeatMarkerPersistence.load(cs).entries.filter(function (e) { return e.mediaPath; }).map(function (e) { return path.basename(e.mediaPath); }); }
  PR.BeatMarkerLibrary.upsertAnalysis("/m/Old song.wav", "Old song.wav", { bpm: 120, beatsArray: [0, 0.5], confidence: 2, phase: 0, clipInfo: null });
  saveTracks(PR);
  sleep(5);
  AE.BeatMarkerLibrary.loadEntries(AE.BeatMarkerPersistence.load(cs).entries);
  sleep(5);
  PR.BeatMarkerLibrary.clear();
  saveTracks(PR);
  sleep(5);
  AE.BeatMarkerLibrary.upsertAnalysis("/m/New in AE.wav", "New in AE.wav", { bpm: 100, beatsArray: [0, 0.6], confidence: 2, phase: 0, clipInfo: null });
  saveTracks(AE);
  check("A07 a Clear in one host is not undone by the other host's next save", JSON.stringify(onDisk()) === JSON.stringify(["New in AE.wav"]), JSON.stringify(onDisk()));
  check("... and the other host drops the cleared entry itself", !AE.BeatMarkerLibrary.get("/m/Old song.wav"));
  AE.BeatMarkerSoundLibrary.addFolder("sfx", "/Volumes/SFX CARD");
  AE.BeatMarkerSoundLibrary.syncFiles("sfx", [{ path: "/Volumes/SFX CARD/Rain loop.wav", size: 10, mtimeMs: 1 }], []);
  saveSounds(AE);
  sleep(5);
  PR.BeatMarkerPersistence.deleteUserData(cs);
  sleep(5);
  AE.BeatMarkerSoundLibrary.setFavorite("/Volumes/SFX CARD/Rain loop.wav", true);
  saveSounds(AE);
  saveTracks(AE);
  const left = fs.existsSync(path.join(docs, "Downbeat")) ? fs.readdirSync(path.join(docs, "Downbeat")) : [];
  check("A07 after Delete my data in one host, the other host writes nothing back", left.indexOf("sound-library.json") === -1 && left.indexOf("library.json") === -1, JSON.stringify(left));
  AE.BeatMarkerSoundLibrary.addFolder("music", "/Volumes/New");
  saveSounds(AE);
  check("... and saves again normally once it holds new data", fs.existsSync(path.join(docs, "Downbeat", "sound-library.json")));
  const reader = panelScripts(["camelot.js", "library.js"]).BeatMarkerLibrary;
  reader.loadEntries([{ mediaPath: "", downbeatLibraryMeta: { clearedAt: 5 } }, { mediaPath: "/m/x.wav", label: "x", bpm: 90, beatsArray: [0, 1], updatedAt: 9 }]);
  check("the clear-time element in library.json is not read as a song", reader.getAll().length === 1);
})();

// ---- A09: Russian / Spanish exclusions ----
(function () {
  const S = panelScripts(["ucs-data.js", "sfx-search.js"]).BeatMarkerSfxSearch;
  const items = [{ name: "Rain loop.wav", path: "/sfx/Rain loop.wav" }, { name: "Door creak.wav", path: "/sfx/Door creak.wav" }];
  function names(q) { const c = S.compile(q); return items.filter(function (it) { return S.score(c, it) >= 0; }).map(function (it) { return it.name; }); }
  check("A09 the Russian word for rain with a minus leaves out Rain loop.wav", names("-\u0434\u043e\u0436\u0434\u044c").join() === "Door creak.wav", names("-\u0434\u043e\u0436\u0434\u044c").join());
  check("A09 -lluvia leaves out Rain loop.wav", names("-lluvia").join() === "Door creak.wav", names("-lluvia").join());
  check("... and an English exclusion is unchanged", names("-rain").join() === "Door creak.wav");
})();

// ---- A02: Paste onto the same media in Premiere ----
(function () {
  const fake = mocks.makePremiereHost({ mediaPath: "/music/song.wav", durationSec: 20, clipStart: 0 });
  const host = mocks.loadHost(fake.context);
  host.run("createClipMarkers(" + arg([0.5, 1.0]) + "," + arg(["D", "b"]) + ", true)");
  const chorus = fake.clipMarkers.createMarker(2); chorus.name = "Chorus";
  const data = JSON.parse(host.run("getMarkersDataForSelectedClip()")).data;
  const clip = fake.audioTrack.clips[0];
  clip.inPoint.seconds = 4; clip.outPoint.seconds = 24; // another instance of the same song, trimmed 4 s later
  const info = JSON.parse(host.run("getSelectedAudioInfo()")).data;
  let r = JSON.parse(host.run("pasteMarkersData(" + arg(data) + "," + arg(info) + ")"));
  const list = function () { return fake.clipMarkers.list.map(function (m) { return m.start.seconds + "=" + m.name; }).join(", "); };
  check("A02 Paste onto another instance of the same song adds no second or shifted set", r.ok && fake.clipMarkers.list.length === 3 && r.data.created === 0, list());
  fake.clipMarkers.deleteMarker(chorus);
  r = JSON.parse(host.run("pasteMarkersData(" + arg(data) + "," + arg(info) + ")"));
  check("... and a marker deleted since the copy comes back at its own place in the song", r.ok && r.data.created === 1 && /2=Chorus/.test(list()), list());
})();

// ---- A08: re-placing timeline markers after the clip moved ----
(function () {
  const fake = mocks.makePremiereHost({ mediaPath: "/music/Song.mp3", durationSec: 20, clipStart: 10 });
  const host = mocks.loadHost(fake.context);
  const clip = fake.audioTrack.clips[0];
  function place() {
    const info = JSON.parse(host.run("getSelectedAudioInfo()")).data;
    const times = [], labels = [];
    for (let t = 0; t < 20; t += 0.5) { times.push(info.clipStartSeconds + t); labels.push(t % 2 === 0 ? "D" : "b"); }
    return JSON.parse(host.run("createMarkers(" + arg(times) + "," + arg(labels) + ", true, " + arg(info) + ")"));
  }
  const mine = fake.sequence.markers.createMarker(5); mine.name = "Intro";
  place();
  clip.start.seconds += 1.25; clip.end.seconds += 1.25;
  place();
  const own = fake.sequence.markers.list.filter(function (m) { return m.name === "D" || m.name === "b"; });
  check("A08 after moving the clip, re-placing leaves no old Downbeat timeline marker in front of it",
    own.length === 40 && own.every(function (m) { return m.start.seconds >= clip.start.seconds - 1e-6; }) &&
    fake.sequence.markers.list.indexOf(mine) !== -1, own.length + " own markers");
})();

// ---- A03: After Effects inserts sound only ----
(function () {
  const fake = mocks.makeAeHost({ mediaPath: "/clips/Music video.mp4", durationSec: 20, startTime: 0, frameRate: 25, insertDurationSec: 20 });
  const original = fake.comp.layers[0];
  original.hasVideo = true; original.enabled = true;
  const add = fake.comp.layers.add;
  fake.comp.layers.add = function (item) { const l = add(item); l.hasVideo = /\.mp4$/i.test(item.file.fsName); l.enabled = true; return l; };
  fake.context.File = function (p) { this.fsName = String(p); this.exists = true; };
  const host = mocks.loadHost(fake.context);
  const info = JSON.parse(host.run("getSelectedAudioInfo()")).data;
  const r = JSON.parse(host.run("insertAudioAtPlayhead(" + arg("/clips/Music video.mp4") + ", 20, " +
    arg({ atSeconds: 0, muteSelected: true, inSec: 0, outSec: 20, speed: Math.pow(2, 2 / 12), pitchReference: info }) + ")"));
  const added = fake.comp.layers.find(function (l) { return l !== original && l.hasVideo; });
  check("A03 the pitched copy of a video file shows no picture; the original's picture stays",
    r.ok && added && added.enabled === false && original.enabled !== false, JSON.stringify(r.error || ""));
})();

// ---- A05: undoing Custom BPM keeps a key set by hand (real panel) ----
(function () {
  const docs = path.join(WORK, "docs-panel");
  fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
  fs.writeFileSync(path.join(docs, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false }));
  const song = path.join(WORK, "Score cue 03.wav");
  const n = 44100, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(song, b);
  const fake = mocks.makePremiereHost({ mediaPath: song, durationSec: 10, clipStart: 0 });
  const host = mocks.loadHost(fake.context);
  const { bootPanel } = require("./panel-harness.js");
  const panel = bootPanel({ docsDir: docs, evalScript: host.evalScript, realTimeouts: true });
  const $ = panel.registry;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  (async function () {
    $.manualBpmInput.value = "120"; $.manualBpmBtn._fire("click"); await wait(300);
    $.keyOverrideInput.value = "8A"; $.applyKeyOverrideBtn._fire("click"); await wait(300);
    $.manualBpmBtn._fire("click"); await wait(300); // the same button is Undo while the custom grid shows
    const key = window.BeatMarkerLibrary.getKey(song, "music");
    const saved = JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", "library.json"), "utf8")).filter(function (e) { return e.mediaPath === song; })[0];
    check("A05 undoing Custom BPM keeps the key set by hand afterwards", !!(key && key.manual && saved && saved.confirmedKey && saved.confirmedKey.camelot === "8A"),
      JSON.stringify(saved && saved.confirmedKey));
    check("... and the custom beat grid is gone", !(saved && saved.beatsArray));
  })().catch(function (e) { failures++; console.error("FAIL " + (e && e.stack || e)); }).then(function () {
    fs.rmSync(WORK, { recursive: true, force: true });
    if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
    console.log("PASS scenario fixes");
    process.exit(0);
  });
})();
