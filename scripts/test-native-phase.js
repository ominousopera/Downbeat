"use strict";
// Exercise phase controls against native times and detailed beat accents.
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const acorn = require("./vendor/acorn-8.15.0.js");
const root = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
const functions = {};
function walk(node) {
  if (!node || typeof node !== "object") { return; }
  if (node.type === "FunctionDeclaration" && node.id) { functions[node.id.name] = main.slice(node.start, node.end); }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) { value.forEach(walk); }
    else if (value && typeof value === "object") { walk(value); }
  }
}
walk(acorn.parse(main, { ecmaVersion: 2020 }));
for (const mode of ["simple", "detailed"]) {
  const state = {
    window: {}, getSelectedCutMode: function () { return mode; }, log: function () {},
    lastAnalysis: { phase: 2, beatsArray: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], downbeatTimes: [0, 2] },
    _replaceMarkersIfPlaced: function (phase) { state.lastAnalysis.phase = phase; },
    _forgetPhaseShift: function () { state.lastAnalysis.phaseShift = 0; }
  };
  vm.createContext(state);
  vm.runInContext(fs.readFileSync(path.join(root, "js/cuesheet.js"), "utf8"), state);
  vm.runInContext(functions.shiftPhase + "\n" + functions.resetPhaseShift, state);
  vm.runInContext("shiftPhase(1)", state);
  assert.deepStrictEqual(Array.from(state.lastAnalysis.downbeatTimes), [0.5, 2.5], mode);
  const detailed = state.window.BeatMarkerCuesheet.buildLabeledBeatsTrack(
    state.lastAnalysis.beatsArray, 1, state.lastAnalysis.phase, state.lastAnalysis.downbeatTimes);
  assert.deepStrictEqual(Array.from(detailed.events.filter(function (e) { return e.label === "D"; }), function (e) { return e.t; }), [0.5, 2.5]);
  vm.runInContext("resetPhaseShift()", state);
  assert.deepStrictEqual(Array.from(state.lastAnalysis.downbeatTimes), [0, 2]);
  assert.strictEqual(state.lastAnalysis.phase, 2);
}
console.log("ok - native phase shift updates detailed accents and restores the original grid in both modes");
