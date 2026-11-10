"use strict";
// The Library's keys and gestures: the keys the host is asked to leave to
// the panel (per system, and given back with a value CEP accepts), keys
// typed while Settings covers the list, keys that hand the keyboard back to
// the host, Enter on a row not analyzed yet, and one insert per double
// click. Runs the real panel (panel-harness) with a host stand-in.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-lib-ui-keys-"));
const SFX = path.join(DOCS, "SFX");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.mkdirSync(SFX);
const files = {};
[["Hit One.wav", "done"], ["Hit Two.wav", "pending"]].forEach(function (r) {
  const p = path.join(SFX, r[0]);
  fs.writeFileSync(p, "x");
  files[p] = { path: p, section: "sfx", name: r[0], size: 1, mtimeMs: 1, status: r[1], v: 3, durationSec: 1, nameChecked: 1 };
});
fs.writeFileSync(path.join(DOCS, "Downbeat", "sound-library.json"), JSON.stringify({ version: 1, folders: { music: [], sfx: [SFX] }, files: files }));
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false, librarySection: "sfx" }));

// The harness's CSInterface, plus the key registration and a system name
// this test can change.
let osName = "Mac OS X 15.0.0";
const asked = [];
let made = null;
Object.defineProperty(global, "CSInterface", {
  configurable: true,
  get: function () { return made; },
  set: function (fn) {
    made = function () {
      const o = fn();
      o.registerKeyEventsInterest = function (json) { asked.push(json); };
      o.getOSInformation = function () { return osName; };
      return o;
    };
  }
});
const inserts = [];
function evalScript(script, cb) {
  if (/^insertAudioAtPlayhead\(/.test(script)) {
    inserts.push(script);
    setTimeout(function () { cb(JSON.stringify({ ok: true, data: { where: "A2", startSeconds: 0 } })); }, 20);
  }
}
const panel = require("./panel-harness.js").bootPanel({ docsDir: DOCS, realTimeouts: true, evalScript: evalScript });
const $ = panel.registry;

let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + label + (ok || detail === undefined ? "" : " - " + detail));
  if (!ok) { failures++; }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function tab(id) { panel.select(".tab-btn").find(function (b) { return b.getAttribute("data-tab") === id; })._fire("click"); }
function rows() { return $.libraryDisplay.children.filter(function (x) { return /lib-row/.test(x.className || ""); }); }
function selectedName() {
  const r = rows().find(function (x) { return x._cls && x._cls["is-selected"]; });
  return r ? (/Hit One/.test(r.textContent) ? "Hit One" : "Hit Two") : null;
}
function key(k, target, extra) {
  return document._fire("keydown", Object.assign({ key: k, target: target, repeat: false }, extra || {}));
}
function codes(list) { return JSON.stringify(list.map(function (c) { return { keyCode: c }; })); }
const EV = { stopPropagation: function () {}, preventDefault: function () {} };

(async function () {
  tab("library");
  check("macOS: the Library asks for the arrows, Space, Return and keypad Enter in Mac key codes",
    asked[asked.length - 1] === codes([126, 125, 49, 36, 76]), asked[asked.length - 1]);
  tab("analyze");
  check("another tab gives the keys back with an empty string (CEP rejects \"[]\")", asked[asked.length - 1] === "", asked[asked.length - 1]);
  osName = "Windows 11 64-bit";
  tab("library");
  check("Windows: the same keys in Windows key codes", asked[asked.length - 1] === codes([38, 40, 32, 13]), asked[asked.length - 1]);
  await wait(20);

  key("ArrowDown", $.libKeyCatcher);
  await wait(20);
  check("an arrow selects the first row", selectedName() === "Hit One", selectedName());
  $.settingsGearBtn._fire("click");
  await wait(20);
  key("Enter", $.settingsGearBtn);
  key("Enter", document.body);
  key(" ", document.body);
  key("ArrowDown", document.body);
  await wait(60);
  check("with Settings open, Enter, Space and the arrows leave the list alone",
    inserts.length === 0 && selectedName() === "Hit One", "inserts " + inserts.length + ", selected " + selectedName());
  $.settingsCloseBtn._fire("click");
  key("Enter", document.body);
  await wait(80);
  check("with Settings closed, Enter inserts the selected sound", inserts.length === 1, "inserts " + inserts.length);

  key("ArrowDown", $.libKeyCatcher);
  key("Enter", $.libKeyCatcher);
  await wait(80);
  check("Enter inserts a row that is waiting for analysis, as Insert and a double click do",
    selectedName() === "Hit Two" && inserts.length === 2 && /Hit Two/.test(inserts[1]), "inserts " + inserts.length);

  let blurs = 0;
  $.libKeyCatcher.blur = function () { blurs++; };
  key("Control", $.libKeyCatcher, { ctrlKey: true });
  check("a key that is not the list's (Ctrl first of Ctrl+S) hands the keyboard back to the host", blurs === 1, "blurs " + blurs);
  key("Enter", document.body, { ctrlKey: true });
  await wait(80);
  check("Ctrl+Enter does not insert", inserts.length === 2, "inserts " + inserts.length);

  const row = rows().find(function (x) { return /Hit One/.test(x.textContent); });
  const insertBtn = row.children.find(function (c) { return /lib-insert/.test(c.className || ""); });
  const fav = row.children.find(function (c) { return /lib-fav/.test(c.className || ""); });
  insertBtn._fire("click", Object.assign({ detail: 1 }, EV));
  await wait(80); // the host has answered before the second click
  insertBtn._fire("click", Object.assign({ detail: 2 }, EV));
  row._fire("dblclick", Object.assign({ target: insertBtn }, EV));
  await wait(80);
  check("a double click on Insert inserts once", inserts.length === 3, "inserts " + inserts.length);
  fav._fire("click", EV);
  fav._fire("click", EV);
  row._fire("dblclick", Object.assign({ target: fav }, EV));
  await wait(80);
  check("a double click on the star does not insert", inserts.length === 3, "inserts " + inserts.length);
  await wait(650);
  row._fire("dblclick", Object.assign({ target: row }, EV));
  await wait(80);
  check("a double click on the row itself still inserts", inserts.length === 4, "inserts " + inserts.length);

  fs.rmSync(DOCS, { recursive: true, force: true });
  if (failures) {
    console.error(failures + " check(s) failed");
    process.exit(1);
  }
  console.log("ok - Library keys and gestures");
  process.exit(0);
})().catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  fs.rmSync(DOCS, { recursive: true, force: true });
  process.exit(1);
});
