"use strict";
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
assert.strictEqual(lib.addFolder("sfx", "/"), false);
assert.strictEqual(lib.addFolder("sfx", "C:\\"), false);
assert.strictEqual(lib.addFolder("sfx", "\\\\server\\share\\"), false);
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
