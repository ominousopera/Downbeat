"use strict";
// A save Windows refuses never loses the data. Windows can refuse to
// replace a data file another program holds open; the text is then written
// in place, and that write can fail before
// anything is written (the file stays whole but old) or half-way (the file
// is cut short). Real files in a throwaway folder; only those failures are
// injected. For each of the three data files:
//   - cut: the save reports it and names the complete copy it kept; the
//     start-up sweep leaves the copy alone even when old; the next load
//     sets the cut file aside and puts the copy back, and the load after
//     that (with no save in between) still has the data;
//   - cut, then a later save in the same session works again: it replaces
//     the cut file with the newest data and removes the older copy;
//   - refused with the file left whole: a copy is kept, the next load puts
//     it back because it is newer, and only one copy is left after several
//     refusals in a row;
//   - the copy's rename refused too: the copy is written afresh; even its
//     write refused: the temp file stays, the sweep keeps it while the data
//     file is cut, and the next load puts it back;
//   - a copy older than a whole data file is not used, and the next
//     successful save removes it; a copy made long before a later cut is
//     not used either;
//   - Delete my data removes a kept copy.
// Run: node scripts/test-save-fallback-recovery.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
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
// fs where replacing `target` is refused; the in-place write then cuts the
// file ("cut") or is refused before writing ("refuse"); optionally the
// copy's rename and the copy's own write are refused too.
function failingFs(target, opts) {
  const f = Object.create(fs);
  f.renameSync = function (from, to) {
    if (to === target && from.indexOf(".tmp-") !== -1) { throw Object.assign(new Error("synthetic sharing violation"), { code: "EPERM" }); }
    if (opts.copyRename && /\.unsaved-/.test(to)) { throw Object.assign(new Error("synthetic rename refusal"), { code: "EPERM" }); }
    return fs.renameSync(from, to);
  };
  f.writeFileSync = function (to, data, o) {
    if (to === target) {
      if (opts.inPlace === "cut") {
        fs.writeFileSync(to, String(data).slice(0, 20), o);
        throw Object.assign(new Error("synthetic partial write"), { code: "EIO" });
      }
      throw Object.assign(new Error("synthetic refusal on open"), { code: "EBUSY" });
    }
    if (opts.copyWrite && /\.unsaved-/.test(to)) { throw Object.assign(new Error("synthetic copy refusal"), { code: "EBUSY" }); }
    return fs.writeFileSync(to, data, o);
  };
  return f;
}
const copiesIn = (dir) => fs.readdirSync(dir).filter((n) => /\.unsaved-\d{8}-\d{6}(-\d+)?\.json$/.test(n));
const tempsIn = (dir) => fs.readdirSync(dir).filter((n) => /\.json\.tmp-\d+-\d+$/.test(n));
function age(p, ms) { const t = new Date(Date.now() - ms); fs.utimesSync(p, t, t); }

const cases = [
  { name: "library.json", save: (P, cs, n) => P.save(cs, [{ mediaPath: "/m/Song.wav", label: "Song", bpm: n }]),
    load: (P, cs) => P.load(cs), got: (r) => r.ok && r.entries && r.entries[0] && r.entries[0].bpm },
  { name: "settings.json", save: (P, cs, n) => P.saveSettings(cs, { language: "en", bpm: n }),
    load: (P, cs) => P.loadSettings(cs), got: (r) => r.ok && r.settings && r.settings.bpm },
  { name: "sound-library.json", save: (P, cs, n) => P.saveSoundLibrary(cs, { version: 1, folders: { music: [], sfx: [] }, files: { "/m/A.wav": { path: "/m/A.wav", bpm: n } } }),
    load: (P, cs) => P.loadSoundLibrary(cs), got: (r) => r.ok && r.state && r.state.files && r.state.files["/m/A.wav"] && r.state.files["/m/A.wav"].bpm }
];

try {
  let k = 0;
  for (const c of cases) {
    const setup = (first) => {
      const docs = path.join(SP, "d" + (++k));
      fs.mkdirSync(docs, { recursive: true });
      const m = freshModule(docs, fs);
      c.save(m.P, m.cs, first);
      return { docs, dir: path.join(docs, "Downbeat"), file: path.join(docs, "Downbeat", c.name) };
    };
    const session = (env, fsImpl) => { const m = freshModule(env.docs, fsImpl); c.load(m.P, m.cs); return m; };
    const L = c.name + ": ";

    // Cut, then two starts with no save in between.
    let env = setup(120), m = session(env, failingFs(env.file, { inPlace: "cut" }));
    let r = c.save(m.P, m.cs, 121);
    let kept = copiesIn(env.dir);
    check(L + "a cut save is reported and names the copy it kept", !r.ok && kept.length === 1 && r.error.indexOf(kept[0]) !== -1, r.error);
    check(L + "the data file really was cut (the case under test)", fs.readFileSync(env.file, "utf8").length === 20);
    age(env.file, 24 * 3600e3); age(path.join(env.dir, kept[0]), 24 * 3600e3);
    m = freshModule(env.docs, fs); m.P.clearLeftoverTempFiles(m.cs);
    check(L + "the start-up sweep leaves an old copy alone", copiesIn(env.dir).length === 1);
    m = freshModule(env.docs, fs);
    let loaded = c.load(m.P, m.cs);
    check(L + "the next load uses the copy and sets the cut file aside", c.got(loaded) === 121 && !!loaded.recoveredFrom &&
      !!loaded.setAside && fs.existsSync(loaded.setAside) && fs.readFileSync(loaded.setAside, "utf8").length === 20, JSON.stringify(loaded).slice(0, 160));
    check(L + "the copy is back in place as the data file", copiesIn(env.dir).length === 0 && JSON.stringify(JSON.parse(fs.readFileSync(env.file, "utf8"))).indexOf("121") !== -1);
    m = freshModule(env.docs, fs);
    loaded = c.load(m.P, m.cs);
    check(L + "the start after that, with no save between, still has the data", c.got(loaded) === 121 && !loaded.recoveredFrom);

    // Cut, then a later save in the same session works again.
    env = setup(130);
    const flaky = failingFs(env.file, { inPlace: "cut" });
    m = session(env, flaky);
    c.save(m.P, m.cs, 131);
    flaky.renameSync = fs.renameSync; flaky.writeFileSync = fs.writeFileSync;
    r = c.save(m.P, m.cs, 132);
    check(L + "after a cut, the next save of the same session replaces the cut file", r.ok && c.got(c.load(freshModule(env.docs, fs).P, freshModule(env.docs, fs).cs)) === 132, r.error);
    check(L + "and removes the older copy", copiesIn(env.dir).length === 0, JSON.stringify(copiesIn(env.dir)));

    // Refused with the file left whole, three times in a row.
    env = setup(140); m = session(env, failingFs(env.file, { inPlace: "refuse" }));
    c.save(m.P, m.cs, 141); c.save(m.P, m.cs, 142); r = c.save(m.P, m.cs, 143);
    check(L + "a refused save with the file whole keeps one copy, the newest", !r.ok && copiesIn(env.dir).length === 1 &&
      fs.readFileSync(path.join(env.dir, copiesIn(env.dir)[0]), "utf8").indexOf("143") !== -1 && fs.readFileSync(env.file, "utf8").indexOf("140") !== -1);
    m = freshModule(env.docs, fs);
    loaded = c.load(m.P, m.cs);
    check(L + "the next load puts the newer copy back", c.got(loaded) === 143 && !!loaded.recoveredFrom && copiesIn(env.dir).length === 0);
    check(L + "and the load after that reads it from the data file", c.got(c.load(freshModule(env.docs, fs).P, freshModule(env.docs, fs).cs)) === 143);

    // The copy's rename refused; then also its write.
    env = setup(150); m = session(env, failingFs(env.file, { inPlace: "cut", copyRename: true }));
    r = c.save(m.P, m.cs, 151);
    check(L + "a refused rename of the copy: the copy is written afresh", !r.ok && copiesIn(env.dir).length === 1 && tempsIn(env.dir).length === 0, r.error);
    env = setup(160); m = session(env, failingFs(env.file, { inPlace: "cut", copyRename: true, copyWrite: true }));
    r = c.save(m.P, m.cs, 161);
    const temps = tempsIn(env.dir);
    check(L + "no copy possible: the temp file stays and the message says so", !r.ok && temps.length === 1 && r.error.indexOf(temps[0]) !== -1, r.error);
    age(env.file, 24 * 3600e3); age(path.join(env.dir, temps[0]), 24 * 3600e3);
    m = freshModule(env.docs, fs); m.P.clearLeftoverTempFiles(m.cs);
    check(L + "the sweep keeps that temp file while the data file is cut", tempsIn(env.dir).length === 1);
    m = freshModule(env.docs, fs);
    loaded = c.load(m.P, m.cs);
    check(L + "and the next load puts it back", c.got(loaded) === 161 && tempsIn(env.dir).length === 0);

    // Copies that must not be used.
    env = setup(170);
    fs.writeFileSync(path.join(env.dir, c.name.replace(/\.json$/, "") + ".unsaved-20200101-000000.json"), fs.readFileSync(env.file, "utf8").replace(/170/g, "99"));
    age(path.join(env.dir, c.name.replace(/\.json$/, "") + ".unsaved-20200101-000000.json"), 3600e3);
    m = freshModule(env.docs, fs);
    loaded = c.load(m.P, m.cs);
    check(L + "a copy older than a whole data file is not used", c.got(loaded) === 170 && !loaded.recoveredFrom);
    check(L + "and the next successful save removes it", c.save(m.P, m.cs, 171).ok && copiesIn(env.dir).length === 0);
    fs.writeFileSync(path.join(env.dir, c.name.replace(/\.json$/, "") + ".unsaved-20200101-000000.json"), fs.readFileSync(env.file, "utf8").replace(/171/g, "98"));
    age(path.join(env.dir, c.name.replace(/\.json$/, "") + ".unsaved-20200101-000000.json"), 3600e3);
    fs.writeFileSync(env.file, fs.readFileSync(env.file, "utf8").slice(0, 25));
    m = freshModule(env.docs, fs);
    loaded = c.load(m.P, m.cs);
    check(L + "a copy made long before a later cut is not used", !loaded.recoveredFrom && c.got(loaded) !== 98);

    // Delete my data.
    env = setup(180); m = session(env, failingFs(env.file, { inPlace: "refuse" }));
    c.save(m.P, m.cs, 181);
    m = freshModule(env.docs, fs);
    const listed = m.P.listUserData(m.cs);
    const del = m.P.deleteUserData(m.cs);
    check(L + "Delete my data lists and removes a kept copy", listed.ok && listed.files.some((f) => /\.unsaved-/.test(f)) && del.ok && !fs.existsSync(env.dir));
  }
} finally {
  fs.rmSync(SP, { recursive: true, force: true });
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nA save Windows refuses keeps the data, and the next start puts it back");
