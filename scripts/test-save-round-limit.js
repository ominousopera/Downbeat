"use strict";
// One save that keeps meeting the other host's saves: after its three
// rounds no lock may be left behind, or every later save of that file goes
// to a kept copy until the lock is a minute old. Two real persistence
// instances share one Documents/Downbeat; the other host saves each time
// the first one is about to replace settings.json.
// Run: node scripts/test-save-round-limit.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

function host() {
  const ctx = { window: { cep_node: { require: require } }, SystemPath: { MY_DOCUMENTS: "docs" } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "js/persistence.js"), "utf8"), ctx);
  return ctx.window.BeatMarkerPersistence;
}

// The first host saves once while the other host saves during its first
// `contended` replacements of settings.json.
function run(contended) {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-round-limit-"));
  const dir = path.join(docs, "Downbeat");
  const file = path.join(dir, "settings.json");
  fs.mkdirSync(dir);
  fs.writeFileSync(file, JSON.stringify({ language: "en" }));
  const cs = { getSystemPath: function () { return docs; } };
  const a = host(), b = host();
  let sa = a.loadSettings(cs).settings || {}, sb = b.loadSettings(cs).settings || {};
  let rounds = 0, other = 0, next = null;
  const rename = fs.renameSync;
  function saveOther() {
    b.inTurn(cs, "settings", function () {
      const r = b.readIfChanged(cs, "settings");
      if (r.changed) { sb = b.mergeSettings(sb, r.value); }
      sb.other = ++other;
      sb.settingsChangedAt = Object.assign({}, sb.settingsChangedAt, { other: Date.now() + other });
      const saved = b.saveSettings(cs, sb);
      if (!saved.ok) { throw new Error(saved.error); }
    });
  }
  function saveFirst(change) {
    const r = a.readIfChanged(cs, "settings");
    if (r.changed) { sa = a.mergeSettings(sa, r.value); }
    if (change) { change(); }
    return a.saveSettings(cs, sa);
  }
  try {
    fs.renameSync = function (src, dst) {
      if (dst === file && String(src).indexOf(".tmp-") !== -1 && rounds <= contended) { saveOther(); }
      return rename.apply(fs, arguments);
    };
    a.inTurn(cs, "settings", function () {
      rounds++;
      const saved = saveFirst(function () { sa.first = true; });
      if (!saved.ok) { throw new Error(saved.error); }
    });
    fs.renameSync = rename;
    const lockLeft = fs.existsSync(file + ".lock");
    a.inTurn(cs, "settings", function () { next = saveFirst(null); });
    return {
      rounds: rounds, other: other, lockLeft: lockLeft, keptIn: next && next.keptIn,
      final: JSON.parse(fs.readFileSync(file, "utf8")), files: fs.readdirSync(dir)
    };
  } finally {
    fs.renameSync = rename;
    fs.rmSync(docs, { recursive: true, force: true });
  }
}

try {
  [1, 3, 5].forEach(function (contended) {
    const r = run(contended);
    const tag = contended + " contended save(s): ";
    check(tag + "the first host's save ran at most three times", r.rounds >= 1 && r.rounds <= 3, "rounds " + r.rounds);
    check(tag + "no lock is left behind", !r.lockLeft);
    check(tag + "the next save goes to settings.json, not to a copy", !r.keptIn, "kept in " + r.keptIn);
    check(tag + "settings.json holds both hosts' changes", r.final.first === true && r.final.other === r.other,
      JSON.stringify({ first: r.final.first, other: r.final.other, saves: r.other }));
    check(tag + "only settings.json is left in the folder", r.files.length === 1 && r.files[0] === "settings.json", r.files.join(", "));
  });
} catch (e) {
  failures++;
  console.error("FAIL " + (e && e.stack || e));
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nall save round limit checks passed");
