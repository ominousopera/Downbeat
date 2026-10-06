"use strict";
// Proves js/persistence.js can never delete anything that is not this
// plugin's own, in both the startup temp sweep and the Settings "Delete my
// data" button.
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const ROOT = path.join(__dirname, "..");
const SP = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-delete-"));
global.window = { cep_node: { require: (m) => require(m) } };
global.SystemPath = { EXTENSION: "extension", MY_DOCUMENTS: "myDocuments" };
function freshModule(docs) {
  const file = path.join(ROOT, "js", "persistence.js");
  delete require.cache[require.resolve(file)];
  require(file);
  return { P: window.BeatMarkerPersistence, cs: { getSystemPath: (k) => (k === "myDocuments" ? docs : SP + "/ext") } };
}
function w(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c || "x"); }
let n = 0; const ok = (m) => console.log("  PASS " + (++n) + ": " + m);

try {
// nothing saved yet
{ const { P, cs } = freshModule(SP + "/docs1"); fs.mkdirSync(SP + "/docs1", { recursive: true });
  const r = P.deleteUserData(cs); assert.ok(r.ok); assert.deepStrictEqual(r.deleted, []); ok("no data folder: nothing deleted, no error"); }
// mixed folder with traps
{ const D = SP + "/docs2"; const DB = D + "/Downbeat"; const OUT = SP + "/outside";
  w(DB + "/settings.json"); w(DB + "/library.json");
  w(DB + "/my-notes.txt", "user file"); w(DB + "/Settings.JSON.bak");
  w(DB + "/sub/settings.json", "nested, not ours"); w(DB + "/sub/library.json");
  w(DB + "/tmp/samples-1-2.raw"); w(DB + "/tmp/beatthis-3-4.raw");
  w(DB + "/sound-library.json"); w(DB + "/tmp/library-5-6.raw"); w(DB + "/tmp/library-7-8.json");
  w(DB + "/tmp/samples-final.raw", "user"); w(DB + "/tmp/song.mp3", "user");
  w(DB + "/tmp/library-notes.json", "user"); w(DB + "/tmp/samples-9-9.json", "user");
  w(OUT + "/precious.txt", "outside");
  w(OUT + "/linked-target.json", "outside json");
  const { P, cs } = freshModule(D);
  const preview = P.listUserData(cs);
  assert.deepStrictEqual(preview.files.map((f) => path.relative(DB, f)).sort(),
    ["library.json", "settings.json", "sound-library.json", "tmp/beatthis-3-4.raw", "tmp/library-5-6.raw", "tmp/library-7-8.json", "tmp/samples-1-2.raw"]);
  ok("preview lists exactly the 7 own files");
  const r = P.deleteUserData(cs);
  assert.ok(r.ok); assert.strictEqual(r.deleted.length, 7); assert.strictEqual(r.folderRemoved, false);
  for (const keep of ["my-notes.txt", "Settings.JSON.bak", "sub/settings.json", "sub/library.json", "tmp/samples-final.raw", "tmp/song.mp3",
                      "tmp/library-notes.json", "tmp/samples-9-9.json"])
    assert.ok(fs.existsSync(DB + "/" + keep), "kept " + keep);
  assert.ok(fs.existsSync(OUT + "/precious.txt"));
  ok("user files, near-miss names and nested look-alikes all kept; folder kept because not empty"); }
// symlink named library.json pointing outside: link and target both
// survive
{ const D = SP + "/docs3"; const DB = D + "/Downbeat"; const OUT = SP + "/outside3";
  w(OUT + "/real.json", "outside"); fs.mkdirSync(DB, { recursive: true });
  fs.symlinkSync(OUT + "/real.json", DB + "/library.json"); w(DB + "/settings.json");
  const { P, cs } = freshModule(D); const r = P.deleteUserData(cs);
  assert.ok(r.ok); assert.strictEqual(r.deleted.length, 1);
  assert.ok(fs.lstatSync(DB + "/library.json").isSymbolicLink()); assert.strictEqual(fs.readFileSync(OUT + "/real.json", "utf8"), "outside");
  ok("symlink disguised as library.json: neither the link nor its target touched"); }
{ const D = SP + "/docs4"; const DB = D + "/Downbeat"; const OUT = SP + "/outside4";
  w(OUT + "/samples-1-1.raw", "outside"); fs.mkdirSync(DB, { recursive: true }); fs.symlinkSync(OUT, DB + "/tmp");
  const { P, cs } = freshModule(D);
  assert.deepStrictEqual(P.clearLeftoverTempFiles(cs), { ok: true, removed: 0, error: "" });
  const r = P.deleteUserData(cs); assert.strictEqual(r.deleted.length, 0);
  assert.ok(fs.existsSync(OUT + "/samples-1-1.raw"));
  ok("tmp swapped for a symlink: nothing followed, nothing deleted (startup sweep and button)"); }
// Downbeat folder itself is a symlink: refuse outright
{ const D = SP + "/docs5"; const OUT = SP + "/outside5"; w(OUT + "/settings.json", "outside");
  fs.mkdirSync(D, { recursive: true }); fs.symlinkSync(OUT, D + "/Downbeat");
  const { P, cs } = freshModule(D); const r = P.deleteUserData(cs);
  assert.strictEqual(r.ok, false); assert.match(r.error, /Refusing/);
  assert.ok(fs.existsSync(OUT + "/settings.json"));
  ok("Downbeat folder is a symlink: refused, outside settings.json intact"); }
for (const bad of ["", "/", "C:/", "C:\\", undefined, "relative/Documents"]) {
  const { P, cs } = freshModule(bad); const r = P.deleteUserData(cs);
  assert.strictEqual(r.ok, false, "should refuse for " + JSON.stringify(bad)); assert.match(r.error, /Refusing/);
}
ok("empty / root / drive-root / relative Documents path: refused");
// only own files: everything goes, including the now-empty folders
{ const D = SP + "/docs7"; const DB = D + "/Downbeat";
  w(DB + "/settings.json"); w(DB + "/library.json"); w(DB + "/tmp/samples-5-6.raw");
  const { P, cs } = freshModule(D); const r = P.deleteUserData(cs);
  assert.ok(r.ok); assert.strictEqual(r.deleted.length, 3); assert.strictEqual(r.folderRemoved, true);
  assert.ok(!fs.existsSync(DB)); assert.ok(fs.existsSync(D));
  ok("only own files: all removed, empty Downbeat folder removed, Documents itself untouched"); }
// saving still works after a delete (folder recreated on demand)
{ const D = SP + "/docs7"; const { P, cs } = freshModule(D);
  assert.ok(P.saveSettings(cs, { language: "en" }).ok); assert.ok(fs.existsSync(D + "/Downbeat/settings.json"));
  ok("settings save recreates the folder after a delete"); }
console.log("ALL " + n + " DELETE-SAFETY CHECKS PASSED");
} finally {
  fs.rmSync(SP, { recursive: true, force: true }); // throwaway fixture made above
}
