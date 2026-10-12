"use strict";
// A save that fails half-way never loses the data.
// On Windows the replace-rename can be refused while another program holds
// the file; the complete text is then written in place, and if that write
// fails too the file can be cut short. Checks, for each of the three data
// files, with real files in a throwaway folder and only those two failures
// injected:
//   - the save reports the failure and names the kept copy;
//   - the complete new data stays on disk as <name>.unsaved-<date>.json;
//   - the start-up sweep of old temp files leaves that copy alone, even
//     when it is older than the six-hour limit;
//   - the next load uses it, sets the cut file aside, and says so;
//   - Delete my data removes it (it is the plugin's own file).
// Run: node scripts/test-save-fallback-recovery.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SP = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-save-fallback-"));
global.SystemPath = { EXTENSION: "extension", MY_DOCUMENTS: "myDocuments" };

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function freshModule(docs, fsImpl) {
  global.window = { cep_node: { require: (m) => (m === "fs" ? fsImpl : require(m)) } };
  const file = path.join(ROOT, "js", "persistence.js");
  delete require.cache[require.resolve(file)];
  require(file);
  return { P: global.window.BeatMarkerPersistence, cs: { getSystemPath: (k) => (k === "myDocuments" ? docs : SP + "/ext") } };
}
// fs that refuses to replace `target` and cuts the in-place write short.
function failingFs(target) {
  const f = Object.create(fs);
  f.renameSync = function (from, to) {
    if (to === target) { throw Object.assign(new Error("synthetic sharing violation"), { code: "EPERM" }); }
    return fs.renameSync(from, to);
  };
  f.writeFileSync = function (to, data, opts) {
    if (to === target) {
      fs.writeFileSync(to, String(data).slice(0, 20), opts);
      throw Object.assign(new Error("synthetic partial write"), { code: "EIO" });
    }
    return fs.writeFileSync(to, data, opts);
  };
  return f;
}

const cases = [
  { name: "library.json", save: (P, cs, v) => P.save(cs, v), load: (P, cs) => P.load(cs),
    first: [{ mediaPath: "/m/Song.wav", label: "Song", bpm: 120 }],
    next: [{ mediaPath: "/m/Song.wav", label: "Song", bpm: 121 }],
    got: (r) => r.entries && r.entries[0] && r.entries[0].bpm },
  { name: "settings.json", save: (P, cs, v) => P.saveSettings(cs, v), load: (P, cs) => P.loadSettings(cs),
    first: { language: "en", bpm: 120 }, next: { language: "ru", bpm: 121 },
    got: (r) => r.settings && r.settings.bpm },
  { name: "sound-library.json", save: (P, cs, v) => P.saveSoundLibrary(cs, v), load: (P, cs) => P.loadSoundLibrary(cs),
    first: { version: 1, folders: { music: [], sfx: [] }, files: { "/m/A.wav": { path: "/m/A.wav", bpm: 120 } } },
    next: { version: 1, folders: { music: [], sfx: [] }, files: { "/m/A.wav": { path: "/m/A.wav", bpm: 121 } } },
    got: (r) => r.state && r.state.files && r.state.files["/m/A.wav"] && r.state.files["/m/A.wav"].bpm }
];

try {
  for (const c of cases) {
    const docs = path.join(SP, c.name.replace(/\W/g, "_"));
    fs.mkdirSync(docs, { recursive: true });
    const dataDir = path.join(docs, "Downbeat"), file = path.join(dataDir, c.name);
    let m = freshModule(docs, fs);
    check(c.name + ": first save works", c.save(m.P, m.cs, c.first).ok);

    m = freshModule(docs, failingFs(file));
    m.P.load(m.cs); m.P.loadSettings(m.cs); m.P.loadSoundLibrary(m.cs);
    const r = c.save(m.P, m.cs, c.next);
    const kept = fs.readdirSync(dataDir).filter((n) => /\.unsaved-\d{8}-\d{6}(-\d+)?\.json$/.test(n));
    check(c.name + ": the failed save is reported and names the kept copy", !r.ok && kept.length === 1 && r.error.indexOf(kept[0]) !== -1, r.error);
    check(c.name + ": the file really was cut short (the case under test)", fs.readFileSync(file, "utf8").length === 20);
    const keptPath = path.join(dataDir, kept[0] || "none");
    check(c.name + ": the kept copy holds the complete new data", kept.length === 1 && JSON.stringify(JSON.parse(fs.readFileSync(keptPath, "utf8"))).indexOf("121") !== -1);

    const old = new Date(Date.now() - 24 * 3600 * 1000);
    if (kept.length) { fs.utimesSync(keptPath, old, old); }
    m = freshModule(docs, fs);
    m.P.clearLeftoverTempFiles(m.cs);
    check(c.name + ": the start-up sweep leaves the kept copy alone", kept.length === 1 && fs.existsSync(keptPath));

    m = freshModule(docs, fs);
    const loaded = c.load(m.P, m.cs);
    check(c.name + ": the next load uses the kept copy", loaded.ok && c.got(loaded) === 121 && loaded.recoveredFrom === keptPath, JSON.stringify(loaded).slice(0, 200));
    check(c.name + ": the cut file is set aside, not deleted", !!loaded.setAside && fs.existsSync(loaded.setAside) && fs.readFileSync(loaded.setAside, "utf8").length === 20);
    check(c.name + ": the next save works again", c.save(m.P, m.cs, c.next).ok && c.got(c.load(freshModule(docs, fs).P, m.cs)) === 121);

    m = freshModule(docs, fs);
    const listed = m.P.listUserData(m.cs);
    check(c.name + ": Delete my data lists the kept copy as the plugin's own", listed.ok && listed.files.some((f) => path.resolve(f) === path.resolve(keptPath)), JSON.stringify(listed.files));
    const del = m.P.deleteUserData(m.cs);
    check(c.name + ": Delete my data removes it", del.ok && !fs.existsSync(keptPath));
  }
} finally {
  fs.rmSync(SP, { recursive: true, force: true });
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nA save that fails half-way keeps the data and the next load restores it");
