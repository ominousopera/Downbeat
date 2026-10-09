"use strict";
// Validate phase bounds and array types with a deadline for grid construction.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const context = vm.createContext({ window: {}, ArrayBuffer });
vm.runInContext(fs.readFileSync(path.join(root, "js/cuesheet.js"), "utf8"), context);
function run(beats, phase, explicit) {
  context.beats = beats; context.phase = phase; context.explicit = explicit;
  return vm.runInContext("window.BeatMarkerCuesheet.buildDownbeatsTrack(beats, 1, phase, explicit).events.map(function(e){return e.t;})", context, { timeout: 100 });
}
const grid = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
for (const phase of [-1e20, Infinity, -1, 0.5, "1", null, {}]) {
  assert.deepStrictEqual(Array.from(run(grid, phase)), [0, 2]);
}
assert.deepStrictEqual(Array.from(run(grid, 3)), [1.5, 3.5]);
assert.deepStrictEqual(Array.from(run(new Float32Array(grid), 1)), [0.5, 2.5]);
assert.deepStrictEqual(Array.from(run({ length: 1e20 }, 0)), []);
assert.deepStrictEqual(Array.from(run(grid, 1, { length: 1e20 })), [0.5, 2.5]);
assert.deepStrictEqual(Array.from(run(grid, 0, [0.7, 2.1])), [0.7, 2.1]);
console.log("ok - invalid imported phases and array-like values cannot stall downbeat construction");
