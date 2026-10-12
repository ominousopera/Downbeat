"use strict";
// A save Windows refuses never loses the data. Windows can refuse to
// replace a data file another program holds open; the text is then written
// in place, and that write can fail before anything is written (the file
// stays whole but old) or half-way (the file is cut short). Real files in a throwaway
// folder; only those failures are injected. For each of the three data
// files:
//   - cut: the save names the complete copy it kept; the sweep keeps it;
//     the next load keeps the cut bytes aside, renames the copy over the
//     file, and the load after that still has the data;
//   - cut, then a later save of the same panel replaces the file and
//     removes the copy;
//   - refused with the file whole: one copy, the newest; a start while the
//     file is held again writes nothing and still shows the data, and so
//     does the start after it; that panel's next save removes the copy;
//   - the copy cannot be written: the temp file becomes the copy; cannot be
//     renamed either: the temp file stays, the sweep keeps it (file cut or
//     whole), and the next load takes it in;
//   - two panels: a successful save never removes a copy that panel did not
//     take in; a load takes in every copy (the newest is the data, the
//     libraries get the others in takeIn); two copies in the same second
//     get two names;
//   - an open panel that finds a file cut by the other host for over a
//     minute recovers it from the copy, or replaces it when there is none;
//     the cut bytes are kept aside once, not at every start;
//   - a copy that changed after it was read is left alone; no data file but
//     a copy: the copy is the data and its generation goes on; Delete my
//     data removes a kept copy.
// Run: node scripts/test-save-fallback-recovery.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js", "persistence.js"), "utf8");
const SP = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-save-fallback-"));

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
// One panel: its own copy of persistence.js with its own fs, as each host
// loads it.
function freshModule(docs, fsImpl) {
  const ctx = { SystemPath: { EXTENSION: "extension", MY_DOCUMENTS: "myDocuments" }, console };
  ctx.window = ctx;
  ctx.cep_node = { require: (m) => (m === "fs" ? fsImpl : require(m)) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: "persistence.js" });
  return { P: ctx.BeatMarkerPersistence, cs: { getSystemPath: (k) => (k === "myDocuments" ? docs : SP + "/ext") } };
}
// fs where replacing `target` is refused; the in-place write then cuts the
// file ("cut") or is refused before writing ("refuse"); optionally a new
// copy cannot be created (copyWrite) and the temp file cannot be renamed to
// a copy name (copyRename).
function failingFs(target, opts) {
  const f = Object.create(fs);
  f.renameSync = function (from, to) {
    if (to === target && opts.inPlace) { throw Object.assign(new Error("synthetic sharing violation"), { code: "EPERM" }); }
    if (opts.copyRename && /\.unsaved-/.test(to)) { throw Object.assign(new Error("synthetic rename refusal"), { code: "EPERM" }); }
    return fs.renameSync(from, to);
  };
  f.writeFileSync = function (to, data, o) {
    if (to === target && opts.inPlace) {
      if (opts.inPlace === "cut") {
        fs.writeFileSync(to, String(data).slice(0, 20), o);
        throw Object.assign(new Error("synthetic partial write"), { code: "EIO" });
      }
      throw Object.assign(new Error("synthetic refusal on open"), { code: "EBUSY" });
    }
    return fs.writeFileSync(to, data, o);
  };
  f.openSync = function (to, flags, mode) {
    if (opts.copyWrite && /\.unsaved-/.test(to)) { throw Object.assign(new Error("synthetic copy refusal"), { code: "EBUSY" }); }
    return fs.openSync(to, flags, mode);
  };
  return f;
}
const copiesIn = (dir) => fs.readdirSync(dir).filter((n) => /\.unsaved-\d{8}-\d{6}(-\d+)?\.json$/.test(n));
const tempsIn = (dir) => fs.readdirSync(dir).filter((n) => /\.json\.tmp-\d+-\d+$/.test(n));
const asidesIn = (dir) => fs.readdirSync(dir).filter((n) => /\.unreadable-\d{8}-\d{6}(-\d+)?\.json$/.test(n));
function age(p, ms) { const t = new Date(Date.now() - ms); fs.utimesSync(p, t, t); }

const cases = [
  { name: "library.json", save: (P, cs, n) => P.save(cs, [{ mediaPath: "/m/Song.wav", label: "Song", bpm: n }]),
    load: (P, cs) => P.load(cs), got: (r) => r.ok && r.entries && r.entries[0] && r.entries[0].bpm,
    of: (v) => v && v[0] && v[0].bpm, kind: "library", libraryLike: true },
  { name: "settings.json", save: (P, cs, n) => P.saveSettings(cs, { language: "en", bpm: n }),
    load: (P, cs) => P.loadSettings(cs), got: (r) => r.ok && r.settings && r.settings.bpm,
    of: (v) => v && v.bpm, kind: "settings", libraryLike: false },
  { name: "sound-library.json", save: (P, cs, n) => P.saveSoundLibrary(cs, { version: 1, folders: { music: [], sfx: [] }, files: { "/m/A.wav": { path: "/m/A.wav", bpm: n } } }),
    load: (P, cs) => P.loadSoundLibrary(cs), got: (r) => r.ok && r.state && r.state.files && r.state.files["/m/A.wav"] && r.state.files["/m/A.wav"].bpm,
    of: (v) => v && v.files && v.files["/m/A.wav"] && v.files["/m/A.wav"].bpm, kind: "sound-library", libraryLike: true }
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
    const loadNow = (env, fsImpl) => { const m = freshModule(env.docs, fsImpl || fs); return { m, r: c.load(m.P, m.cs) }; };
    const onDisk = (env) => c.of(JSON.parse(fs.readFileSync(env.file, "utf8")));
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
    let ld = loadNow(env);
    check(L + "the next load uses the copy and keeps the cut bytes aside", c.got(ld.r) === 121 && !!ld.r.recoveredFrom &&
      !!ld.r.setAside && fs.readFileSync(ld.r.setAside, "utf8").length === 20, JSON.stringify(ld.r).slice(0, 200));
    check(L + "the copy is renamed over the cut file", copiesIn(env.dir).length === 0 && onDisk(env) === 121);
    ld = loadNow(env);
    check(L + "the start after that, with no save between, still has the data", c.got(ld.r) === 121 && !ld.r.recoveredFrom && asidesIn(env.dir).length === 1);

    // Cut, then a later save of the same panel works again.
    env = setup(130);
    const flaky = failingFs(env.file, { inPlace: "cut" });
    m = session(env, flaky);
    c.save(m.P, m.cs, 131);
    flaky.renameSync = fs.renameSync; flaky.writeFileSync = fs.writeFileSync;
    r = c.save(m.P, m.cs, 132);
    check(L + "after a cut, the next save of the same panel replaces the cut file", r.ok && onDisk(env) === 132, r.error);
    check(L + "and removes the copy it kept", copiesIn(env.dir).length === 0, JSON.stringify(copiesIn(env.dir)));

    // Refused with the file whole, three times in a row; then starts while
    // the file is held again.
    env = setup(140);
    const held = failingFs(env.file, { inPlace: "cut" });
    m = session(env, failingFs(env.file, { inPlace: "refuse" }));
    c.save(m.P, m.cs, 141); c.save(m.P, m.cs, 142); r = c.save(m.P, m.cs, 143);
    const wholeBefore = fs.readFileSync(env.file, "utf8");
    check(L + "a refused save with the file whole keeps one copy, the newest", !r.ok && copiesIn(env.dir).length === 1 &&
      fs.readFileSync(path.join(env.dir, copiesIn(env.dir)[0]), "utf8").indexOf("143") !== -1 && onDisk(env) === 140);
    ld = loadNow(env, held);
    check(L + "a start while the file is held again shows the copy's data", c.got(ld.r) === 143 && !!ld.r.recoveredFrom);
    check(L + "and writes nothing over the whole data file", fs.readFileSync(env.file, "utf8") === wholeBefore && copiesIn(env.dir).length === 1);
    ld = loadNow(env, held);
    check(L + "the start after that still shows it", c.got(ld.r) === 143 && copiesIn(env.dir).length === 1);
    held.renameSync = fs.renameSync; held.writeFileSync = fs.writeFileSync;
    r = c.save(ld.m.P, ld.m.cs, 144);
    check(L + "a save that works then removes the copy it took in", r.ok && onDisk(env) === 144 && copiesIn(env.dir).length === 0, r.error);

    // The copy cannot be written; then neither written nor renamed.
    env = setup(150); m = session(env, failingFs(env.file, { inPlace: "cut", copyWrite: true }));
    r = c.save(m.P, m.cs, 151);
    check(L + "a copy that cannot be written: the temp file becomes the copy", !r.ok && copiesIn(env.dir).length === 1 && tempsIn(env.dir).length === 0 &&
      c.of(JSON.parse(fs.readFileSync(path.join(env.dir, copiesIn(env.dir)[0]), "utf8"))) === 151, r.error);
    for (const inPlace of ["cut", "refuse"]) {
      env = setup(160); m = session(env, failingFs(env.file, { inPlace, copyWrite: true, copyRename: true }));
      r = c.save(m.P, m.cs, 161);
      const temps = tempsIn(env.dir);
      check(L + "no copy possible (" + inPlace + "): the temp file stays and the message says so", !r.ok && temps.length === 1 && r.error.indexOf(temps[0]) !== -1, r.error);
      age(env.file, 25 * 3600e3); age(path.join(env.dir, temps[0]), 24 * 3600e3);
      m = freshModule(env.docs, fs); m.P.clearLeftoverTempFiles(m.cs);
      check(L + "the sweep keeps that temp file (" + inPlace + ")", tempsIn(env.dir).length === 1);
      ld = loadNow(env);
      check(L + "and the next load takes it in (" + inPlace + ")", c.got(ld.r) === 161);
      r = c.save(ld.m.P, ld.m.cs, 162);
      check(L + "a save that works then removes it (" + inPlace + ")", r.ok && onDisk(env) === 162 && tempsIn(env.dir).length === 0, r.error);
    }

    // Two panels (Premiere and After Effects on one Documents/Downbeat).
    env = setup(170);
    const other = freshModule(env.docs, fs); c.load(other.P, other.cs); // all three open since before
    m = session(env, failingFs(env.file, { inPlace: "refuse" }));
    const m2 = session(env, failingFs(env.file, { inPlace: "refuse" }));
    c.save(m.P, m.cs, 171);
    age(path.join(env.dir, copiesIn(env.dir)[0]), 20e3);
    r = c.save(other.P, other.cs, 172);
    check(L + "a save that works never removes a copy that panel did not take in", r.ok && copiesIn(env.dir).length === 1);
    age(env.file, 10e3);
    c.save(m2.P, m2.cs, 173);
    check(L + "a second panel's refused save keeps its own copy beside the first", copiesIn(env.dir).length === 2);
    ld = loadNow(env);
    const takeIn = (ld.r.takeIn || []).map(c.of).sort();
    check(L + "the next load takes in both: the newest is the data" + (c.libraryLike ? ", the others go to takeIn" : ""),
      c.got(ld.r) === 173 && ld.r.keptCopies && ld.r.keptCopies.length === (c.libraryLike ? 2 : 1) &&
      (c.libraryLike ? takeIn.join() === "171,172" : takeIn.length === 0), JSON.stringify({ takeIn, from: ld.r.keptCopies }));
    r = c.save(ld.m.P, ld.m.cs, 174);
    check(L + "and its next save that works removes both", r.ok && copiesIn(env.dir).length === 0);
    env = setup(175);
    const a = session(env, failingFs(env.file, { inPlace: "refuse" })), b = session(env, failingFs(env.file, { inPlace: "refuse" }));
    c.save(a.P, a.cs, 176); c.save(b.P, b.cs, 177);
    const both = copiesIn(env.dir).map((n) => c.of(JSON.parse(fs.readFileSync(path.join(env.dir, n), "utf8")))).sort();
    check(L + "two panels refused at once keep two copies under two names", both.join() === "176,177", JSON.stringify(copiesIn(env.dir)));

    // The other host finds a file cut by a panel that is closed now.
    env = setup(180);
    const open = freshModule(env.docs, fs); c.load(open.P, open.cs);
    m = session(env, failingFs(env.file, { inPlace: "cut" }));
    c.save(m.P, m.cs, 181);
    let fresh = open.P.readIfChanged(open.cs, c.kind);
    check(L + "the other panel: a file cut just now is not checked yet", fresh.unavailable === true && asidesIn(env.dir).length === 0);
    age(env.file, 120e3);
    fresh = open.P.readIfChanged(open.cs, c.kind);
    check(L + "a minute later it is recovered from the copy", fresh.changed && c.of(fresh.value) === 181 && !!fresh.setAside &&
      onDisk(env) === 181 && copiesIn(env.dir).length === 0, JSON.stringify(fresh).slice(0, 200));
    r = c.save(open.P, open.cs, 182);
    check(L + "and that panel saves again", r.ok && onDisk(env) === 182);
    env = setup(185);
    const open2 = freshModule(env.docs, fs); c.load(open2.P, open2.cs);
    fs.writeFileSync(env.file, fs.readFileSync(env.file, "utf8").slice(0, 15));
    age(env.file, 120e3);
    fresh = open2.P.readIfChanged(open2.cs, c.kind);
    r = c.save(open2.P, open2.cs, 186);
    check(L + "with no copy, the open panel keeps the bytes aside and its save replaces the file",
      !fresh.changed && !!fresh.setAside && fs.readFileSync(fresh.setAside, "utf8").length === 15 && r.ok && onDisk(env) === 186, JSON.stringify(fresh));

    // A cut file whose copy cannot be renamed over it at start.
    env = setup(190);
    m = session(env, failingFs(env.file, { inPlace: "cut" }));
    c.save(m.P, m.cs, 191);
    age(env.file, 3600e3);
    const stuck = failingFs(env.file, { inPlace: "cut" });
    ld = loadNow(env, stuck);
    const ld2 = loadNow(env, stuck);
    check(L + "a copy that cannot be renamed in is still used, and the cut bytes are kept aside once",
      c.got(ld.r) === 191 && c.got(ld2.r) === 191 && asidesIn(env.dir).length === 1 && copiesIn(env.dir).length === 1);
    stuck.renameSync = fs.renameSync; stuck.writeFileSync = fs.writeFileSync;
    r = c.save(ld2.m.P, ld2.m.cs, 192);
    check(L + "the panel that used it replaces the cut file and removes the copy", r.ok && onDisk(env) === 192 && copiesIn(env.dir).length === 0, r.error);

    // An older copy beside a whole, newer data file.
    env = setup(200);
    const oldCopy = path.join(env.dir, c.name.replace(/\.json$/, "") + ".unsaved-20200101-000000.json");
    fs.writeFileSync(oldCopy, fs.readFileSync(env.file, "utf8").replace(/200/g, "99"));
    age(oldCopy, 3600e3);
    ld = loadNow(env);
    check(L + "an older copy is not the data" + (c.libraryLike ? ", it goes to takeIn" : ""), c.got(ld.r) === 200 &&
      (c.libraryLike ? (ld.r.takeIn || []).map(c.of).join() === "99" : true));
    check(L + "and the next save that works removes it", c.save(ld.m.P, ld.m.cs, 201).ok && !fs.existsSync(oldCopy));
    env = setup(205);
    const changing = path.join(env.dir, c.name.replace(/\.json$/, "") + ".unsaved-20200101-000000.json");
    fs.writeFileSync(changing, fs.readFileSync(env.file, "utf8"));
    age(changing, 3600e3);
    ld = loadNow(env);
    fs.writeFileSync(changing, fs.readFileSync(env.file, "utf8") + " ");
    check(L + "a copy that changed after it was read is left alone by the save", c.save(ld.m.P, ld.m.cs, 206).ok && fs.existsSync(changing));

    // No data file, only a copy.
    env = setup(210);
    const gen = (v) => (Array.isArray(v) ? v[v.length - 1].downbeatLibraryMeta.generation : v.dataGeneration);
    const firstGen = gen(JSON.parse(fs.readFileSync(env.file, "utf8")));
    m = session(env, failingFs(env.file, { inPlace: "refuse" }));
    c.save(m.P, m.cs, 211);
    fs.unlinkSync(env.file);
    ld = loadNow(env);
    r = c.save(ld.m.P, ld.m.cs, 212);
    check(L + "no data file but a copy: the copy is the data, and its generation goes on", c.got(ld.r) === 211 && ld.r.existed &&
      r.ok && gen(JSON.parse(fs.readFileSync(env.file, "utf8"))) === firstGen && copiesIn(env.dir).length === 0);

    // Delete my data.
    env = setup(220); m = session(env, failingFs(env.file, { inPlace: "refuse" }));
    c.save(m.P, m.cs, 221);
    m = freshModule(env.docs, fs);
    const listed = m.P.listUserData(m.cs);
    const del = m.P.deleteUserData(m.cs);
    check(L + "Delete my data lists and removes a kept copy", listed.ok && listed.files.some((f) => /\.unsaved-/.test(f)) && del.ok && !fs.existsSync(env.dir));
  }
} finally {
  fs.rmSync(SP, { recursive: true, force: true });
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nA save Windows refuses keeps the data, and only the panel holding it removes the copy");
