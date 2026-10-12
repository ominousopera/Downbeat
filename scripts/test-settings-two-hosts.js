"use strict";
// Settings changed in Premiere and After Effects at once, with Windows
// refusing a save. Each host is the real
// panel (panel-harness) in its own Node process on one Documents/Downbeat;
// only the refusal is injected (replace and in-place write of settings.json).
//   - Premiere switches markers to the timeline and its save is refused (a
//     copy is kept); After Effects, open since before, then turns synonyms
//     off and saves normally. The next start has both changes.
//   - The same with both saves refused (two copies).
//   - The next settings change saves both and removes the copies.
// Run: node scripts/test-settings-two-hosts.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-settings-hosts-"));
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

// One host: boots the panel, waits for a line on stdin when asked to, then
// changes "Place on" and/or the synonyms switch through the UI and prints
// what it shows.
const HOST = `
const fs = require("fs"), path = require("path");
const [harness, docs, refuse, stepsJson, wait] = process.argv.slice(1);
if (refuse === "1") {
  const file = docs + "/Downbeat/settings.json";
  const rename = fs.renameSync, write = fs.writeFileSync;
  fs.renameSync = function (a, b) { if (b === file) { throw Object.assign(new Error("synthetic sharing violation"), { code: "EPERM" }); } return rename.call(fs, a, b); };
  fs.writeFileSync = function (a, d, o) { if (a === file) { throw Object.assign(new Error("synthetic refusal on open"), { code: "EBUSY" }); } return write.call(fs, a, d, o); };
}
const out = process.stdout.write.bind(process.stdout);
console.log = function () {};
const { bootPanel } = require(harness);
const h = bootPanel({ docsDir: docs, realTimeouts: true, evalScript: function (s, cb) { if (cb) { cb("null"); } } });
function run() {
  JSON.parse(stepsJson).forEach(function (s) {
    if (s.target) {
      const radios = h.select('input[name="markerTarget"]');
      radios.forEach(function (r) { r.checked = r.attrs.value === s.target; });
      radios.filter(function (r) { return r.checked; })[0]._fire("change");
    }
    if (s.synonyms) { h.registry.libSynToggle._fire("click"); }
  });
  const on = h.select('input[name="markerTarget"]:checked')[0];
  out("RESULT " + JSON.stringify({ target: on ? on.attrs.value : null, synonyms: global.window.BeatMarkerSfxSearch.synonymsOn() }) + "\\n");
  process.exit(0);
}
setTimeout(function () {
  if (wait === "1") { out("READY\\n"); process.stdin.once("data", run); } else { run(); }
}, 300);
`;
// The harness reads DOWNBEAT_ROOT itself, which the child inherits.
function args(docs, refuse, steps, wait) { return ["-e", HOST, path.join(__dirname, "panel-harness.js"), docs, refuse ? "1" : "0", JSON.stringify(steps), wait ? "1" : "0"]; }
function result(text) {
  const line = String(text).split("\n").filter(function (l) { return l.indexOf("RESULT ") === 0; })[0];
  return line ? JSON.parse(line.slice(7)) : null;
}
function runHost(docs, refuse, steps) {
  return result(execFileSync(process.execPath, args(docs, refuse, steps, false), { encoding: "utf8", timeout: 60000 }));
}
// A host that is open from the start and acts when `go()` is called.
function openHost(docs, refuse, steps) {
  const child = spawn(process.execPath, args(docs, refuse, steps, true), { stdio: ["pipe", "pipe", "ignore"] });
  let text = "";
  const ready = new Promise(function (resolve) {
    child.stdout.on("data", function (d) { text += d; if (text.indexOf("READY") !== -1) { resolve(); } });
  });
  const done = new Promise(function (resolve) { child.on("exit", function () { resolve(result(text)); }); });
  return { ready: ready, go: function () { child.stdin.write("go\n"); return done; } };
}
function setup(name) {
  const docs = path.join(WORK, name);
  fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
  fs.writeFileSync(path.join(docs, "Downbeat", "settings.json"), JSON.stringify({
    language: "en", onboardingCompleted: true, updateCheck: false, librarySynonyms: true, markerTarget: "clip"
  }));
  return docs;
}
const copies = (docs) => fs.readdirSync(path.join(docs, "Downbeat")).filter(function (n) { return /^settings\.unsaved-/.test(n); });
const onDisk = (docs) => JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", "settings.json"), "utf8"));

(async function () {
  try {
    for (const both of [false, true]) {
      const L = both ? "both saves refused: " : "Premiere's save refused: ";
      const docs = setup(both ? "both" : "one");
      const ae = openHost(docs, both, [{ synonyms: true }]); // After Effects, open since before
      await ae.ready;
      runHost(docs, true, [{ target: "sequence" }]); // Premiere, then closed
      check(L + "Premiere kept a copy", copies(docs).length === 1, JSON.stringify(copies(docs)));
      await ae.go();
      check(L + (both ? "After Effects kept its own copy beside it" : "After Effects saved normally"),
        copies(docs).length === (both ? 2 : 1) && (both || onDisk(docs).librarySynonyms === false), JSON.stringify(copies(docs)));
      const next = runHost(docs, false, []);
      check(L + "the next start has both changes", next && next.target === "sequence" && next.synonyms === false, JSON.stringify(next));
      runHost(docs, false, [{ synonyms: true }, { synonyms: true }]);
      const saved = onDisk(docs);
      check(L + "the next settings change saves both and removes the copies",
        saved.markerTarget === "sequence" && saved.librarySynonyms === false && copies(docs).length === 0, JSON.stringify(saved) + " " + JSON.stringify(copies(docs)));
    }
  } finally {
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
  console.log("\nSettings changed in two hosts both survive a refused save");
})();
