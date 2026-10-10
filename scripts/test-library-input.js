"use strict";
// Saved track metadata must not break cache formatting or beat placement.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/library.js"), "utf8"), scope);
const library = scope.window.BeatMarkerLibrary;
const make = function (bpm, beats) {
  return { mediaPath: "example.wav", label: "Example", bpm: bpm, beatsArray: beats,
    clipInfo: { mediaPath: "example.wav" }, phase: 1, camelot: "8A", key: "A", scale: "minor" };
};
for (const bad of ["120", {}, NaN, Infinity, -1, 0, null]) {
  library.loadEntries([make(bad, [0, 0.5, 1])]);
  const entry = library.get("example.wav");
  assert.strictEqual(entry.bpm, null);
  assert.strictEqual(entry.beatsArray, null, "an unusable tempo cannot restore a beat grid");
  assert.strictEqual(entry.camelot, "8A", "valid key metadata remains usable");
}
for (const bad of [{ 0: 0, 1: 0.5, length: 2 }, [0, "0.5"], [1, 0], [0, 0], [-1, 0], [0, Infinity]]) {
  library.loadEntries([make(120, bad)]);
  assert.strictEqual(library.get("example.wav").beatsArray, null);
}
library.loadEntries([make(120, [0, 0.5, 1])]);
assert.strictEqual(library.get("example.wav").bpm.toFixed(1), "120.0");
assert.strictEqual(library.get("example.wav").beatsArray.length, 3);
library.loadEntries({ 0: make(120, [0, 0.5]), length: 1 });
assert.strictEqual(library.getAll().length, 0, "array-like objects are not a saved library");
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/sound-library.js"), "utf8"), scope);
for (const duration of [0, 30, 100, 101, 110, 120, 150, 600]) {
  const range = scope.window.BeatMarkerSoundLibrary.excerptRange(duration, "music");
  assert(range.startSec >= 0 && range.lengthSec >= 0);
  assert(range.startSec + range.lengthSec <= duration, "the requested interval ends inside the source");
}
console.log("ok - malformed cache data is isolated and excerpts stay inside the source");
