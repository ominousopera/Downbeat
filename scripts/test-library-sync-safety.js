"use strict";
// Partial scans, section overlap, retry and root rejection preserve library state.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = process.env.DOWNBEAT_ROOT || path.resolve(__dirname, "..");
function fresh() {
  const scope = { window: {} };
  ["camelot", "sound-library"].forEach(name => vm.runInNewContext(fs.readFileSync(path.join(root, "js", name + ".js"), "utf8"), scope));
  return scope.window.BeatMarkerSoundLibrary;
}
const file = "/samples/sub/loop.wav", found = [{ path: file, size: 100, mtimeMs: 1 }];
const lib = fresh();
assert.strictEqual(lib.addFolder("music", "/samples"), true);
lib.syncFiles("music", found, []);
lib.setResult(file, { ok: true, camelot: "8A", key: "A", scale: "minor", bpm: 120 });
lib.setFavorite(file, true); lib.confirm(file, "10A", 128);
assert.strictEqual(lib.addFolder("sfx", "/samples/sub"), false);
// The system disk cannot be added whole; other drives, cards and shares can.
assert.strictEqual(lib.addFolder("sfx", "/"), false);
assert.strictEqual(lib.addFolder("sfx", "C:\\"), false);
assert.strictEqual(lib.folderProblem("sfx", "c:/"), "library.folderRoot");
assert.strictEqual(lib.addFolder("sfx", "E:\\"), true);
assert.strictEqual(lib.addFolder("sfx", "\\\\server\\share\\"), true);
assert.strictEqual(lib.addFolder("sfx", "/Volumes/SD CARD"), true);
lib.setSystemDrive("D:");
assert.strictEqual(lib.folderProblem("music", "D:\\"), "library.folderRoot");
assert.strictEqual(lib.folderProblem("music", "C:\\"), null);
lib.setSystemDrive("C:");
// A drive root's files sit in its tree and scope like any folder's.
lib.syncFiles("sfx", [{ path: "E:/Booms/hit.wav", size: 1, mtimeMs: 1 }, { path: "E:/riser.wav", size: 1, mtimeMs: 1 }], []);
const tree = lib.folderTree("sfx").find(n => n.path === "E:/");
assert.ok(tree && tree.count === 2 && tree.children.length === 1 && tree.children[0].path === "E:/Booms", JSON.stringify(tree));
assert.strictEqual(lib.isUnder("E:/Booms/hit.wav", "E:\\"), true);
assert.strictEqual(lib.isUnder("F:/x.wav", "E:/"), false);
let rootListing = lib.listAudioFiles({
  readdirSync: dir => dir === "E:/" ? ["System Volume Information", "$RECYCLE.BIN", "riser.wav"] : (() => { throw Object.assign(Error("denied"), { code: "EPERM" }); })(),
  lstatSync: p => ({ isDirectory: () => !/\.wav$/.test(p), isFile: () => /\.wav$/.test(p), size: 1, mtimeMs: 1 })
}, "sfx");
assert.ok(!rootListing.incomplete.some(p => /^E:/.test(p)), "system folders at a drive root are skipped, not reported unreadable: " + JSON.stringify(rootListing.incomplete));
lib.removeFolder("sfx", "E:/"); lib.removeFolder("sfx", "//server/share"); lib.removeFolder("sfx", "/Volumes/SD CARD");
assert.strictEqual(lib.getState().files[file].confirmedBpm.value, 128);
lib.syncFiles("sfx", found, []);
assert.strictEqual(lib.getState().files[file].section, "music");
const denied = () => { throw Object.assign(Error("denied"), { code: "EACCES" }); };
let listing = lib.listAudioFiles({ readdirSync: denied }, "music");
assert.strictEqual(lib.syncFiles("music", listing, []).removed, 0);
assert.strictEqual(lib.getState().files[file].fav, true);
listing = lib.listAudioFiles({
  readdirSync: dir => dir === "/samples" ? ["sub"] : denied(),
  lstatSync: () => ({ isDirectory: () => true })
}, "music");
assert.strictEqual(lib.syncFiles("music", listing, []).removed, 0);
listing = lib.listAudioFiles({ readdirSync: () => [] }, "music");
assert.strictEqual(lib.syncFiles("music", listing, []).removed, 1);
lib.syncFiles("music", found, []);
lib.setResult(file, { ok: false, error: "temporary failure" });
assert.strictEqual(lib.syncFiles("music", found, []).pending, 1);
lib.setResult(file, { ok: true, durationSec: 1 });
assert.strictEqual(lib.syncFiles("music", found, []).pending, 0);
console.log("PASS partial scans, overlap, roots and explicit retry");
