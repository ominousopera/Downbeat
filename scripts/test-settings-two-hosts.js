"use strict";
// Settings changed in Premiere and After Effects at once, with Windows
// refusing a save or both saving in the same moment. Each host is the real
// panel (panel-harness) in its own Node process on one Documents/Downbeat;
// only the refusal or the timing is injected.
//   - Premiere switches markers to the timeline and its save is refused (a
//     copy is kept); After Effects, open since before, then turns synonyms
//     off, takes the copy in and saves both. The next start has both.
//   - The same with both saves refused: After Effects' own copy holds both.
//   - The next settings change saves both and removes the copies.
//   - Premiere's save is held just before it replaces settings.json while
//     After Effects opens, turns synonyms off and saves: the file ends with
//     both changes, and no copy or lock is left.
//   - A lock left by a host that quit mid-save: a change goes to a copy the
//     next start takes in; once the lock is a minute old it is removed.
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
// With `inside`, the other host's steps run (as a separate host) at the
// moment this one is about to replace settings.json.
const HOST = `
const fs = require("fs"), path = require("path"), cp = require("child_process");
const [harness, docs, refuse, stepsJson, wait, inside] = process.argv.slice(2);
if (inside) {
  const file = docs + "/Downbeat/settings.json", rename = fs.renameSync;
  let once = true;
  fs.renameSync = function (a, b) {
    if (once && b === file && String(a).indexOf(".tmp-") !== -1) {
      once = false;
      cp.execFileSync(process.execPath, [__filename, harness, docs, "0", inside, "0", ""], { stdio: "ignore", timeout: 60000 });
    }
    return rename.apply(fs, arguments);
  };
}
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
const HOST_FILE = path.join(WORK, "host.js");
fs.writeFileSync(HOST_FILE, HOST);
function args(docs, refuse, steps, wait, inside) {
  return [HOST_FILE, path.join(__dirname, "panel-harness.js"), docs, refuse ? "1" : "0", JSON.stringify(steps), wait ? "1" : "0", inside ? JSON.stringify(inside) : ""];
}
function result(text) {
  const line = String(text).split("\n").filter(function (l) { return l.indexOf("RESULT ") === 0; })[0];
  return line ? JSON.parse(line.slice(7)) : null;
}
function runHost(docs, refuse, steps, inside) {
  return result(execFileSync(process.execPath, args(docs, refuse, steps, false, inside), { encoding: "utf8", timeout: 120000 }));
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
const copyHolds = (docs, n) => JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", n), "utf8"));
const lockFile = (docs) => path.join(docs, "Downbeat", "settings.json.lock");

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
      const held = both ? copies(docs).map(function (n) { return copyHolds(docs, n); })[0] : onDisk(docs);
      check(L + (both ? "After Effects took the copy in and kept its own with both changes" : "After Effects took the copy in and saved both"),
        copies(docs).length === (both ? 1 : 0) && held && held.markerTarget === "sequence" && held.librarySynonyms === false,
        JSON.stringify(copies(docs)) + " " + JSON.stringify(held));
      const next = runHost(docs, false, []);
      check(L + "the next start has both changes", next && next.target === "sequence" && next.synonyms === false, JSON.stringify(next));
      runHost(docs, false, [{ synonyms: true }, { synonyms: true }]);
      const saved = onDisk(docs);
      check(L + "the next settings change saves both and removes the copies",
        saved.markerTarget === "sequence" && saved.librarySynonyms === false && copies(docs).length === 0, JSON.stringify(saved) + " " + JSON.stringify(copies(docs)));
    }

    {
      const L = "saves in the same moment: ";
      const docs = setup("overlap");
      runHost(docs, false, [{ target: "sequence" }], [{ synonyms: true }]);
      const saved = onDisk(docs);
      check(L + "settings.json has both changes", saved.markerTarget === "sequence" && saved.librarySynonyms === false, JSON.stringify(saved));
      check(L + "no copy or lock is left", copies(docs).length === 0 && !fs.existsSync(lockFile(docs)), fs.readdirSync(path.join(docs, "Downbeat")).join(", "));
    }

    {
      const L = "lock left by a host that quit: ";
      const docs = setup("left-lock");
      fs.writeFileSync(lockFile(docs), "gone");
      runHost(docs, false, [{ synonyms: true }]);
      check(L + "a change waits in a copy while the lock is new",
        copies(docs).length === 1 && onDisk(docs).librarySynonyms === true && copyHolds(docs, copies(docs)[0]).librarySynonyms === false,
        JSON.stringify(copies(docs)) + " " + JSON.stringify(onDisk(docs)));
      const next = runHost(docs, false, []);
      check(L + "the next start has it", next && next.synonyms === false, JSON.stringify(next));
      const old = new Date(Date.now() - 2 * 60 * 1000);
      fs.utimesSync(lockFile(docs), old, old);
      runHost(docs, false, [{ target: "sequence" }]);
      const saved = onDisk(docs);
      check(L + "once a minute old it is removed and the save takes the copy in",
        saved.markerTarget === "sequence" && saved.librarySynonyms === false && copies(docs).length === 0 && !fs.existsSync(lockFile(docs)),
        JSON.stringify(saved) + " " + fs.readdirSync(path.join(docs, "Downbeat")).join(", "));
    }
  } finally {
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
  console.log("\nSettings changed in two hosts both survive a refused save and saves in the same moment");
})();
