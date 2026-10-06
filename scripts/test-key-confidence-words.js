"use strict";
// The Library row says in words how sure a music key is (no percentages):
// "key agreed" when at least two of the three key methods gave it, "key
// uncertain" when all three differed, nothing for a key read from the file
// name, a sound effect or an older record without the measure.
// Run: node scripts/test-key-confidence-words.js
const fs = require("fs");
const os = require("os");
const path = require("path");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-conf-"));
const DATA = path.join(DOCS, "Downbeat");
fs.mkdirSync(DATA, { recursive: true });
function rec(name, extra) {
  return Object.assign({ path: "/M/" + name, section: "music", name: name, status: "done", v: 3, durationSec: 100, bpm: 120, camelot: "8A", key: "A", scale: "minor" }, extra);
}
const files = {};
[rec("agreed.mp3", { keyAgreement: "two" }), rec("doubtful.mp3", { keyAgreement: "none" }), rec("named.mp3", { keyAgreement: "none", keyFrom: "name" }), rec("old.mp3", {})]
  .forEach(function (r) { files[r.path] = r; });
fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, librarySection: "music" }));
fs.writeFileSync(path.join(DATA, "sound-library.json"), JSON.stringify({ version: 1, folders: { music: ["/M"], sfx: [] }, files: files }));

const panel = require("./panel-harness.js").bootPanel({ docsDir: DOCS });
const rows = panel.registry.libraryDisplay.children.filter(function (c) { return /lib-row/.test(c.className || ""); });
function row(name) { return rows.filter(function (r) { return r.textContent.indexOf(name) !== -1; })[0]; }
check("all four rows are listed", rows.length === 4, rows.length + "");
check("two of three agreed: the row says \"key agreed\"", /8A A minor.*key agreed/.test(row("agreed.mp3").textContent), row("agreed.mp3").textContent);
check("all three differed: the row says \"key uncertain\"", /key uncertain/.test(row("doubtful.mp3").textContent) && !/key agreed/.test(row("doubtful.mp3").textContent), row("doubtful.mp3").textContent);
check("a key from the file name says where it came from, not how sure", /from the file name/.test(row("named.mp3").textContent) && !/key (agreed|uncertain)/.test(row("named.mp3").textContent), row("named.mp3").textContent);
check("a record without the measure shows no word", !/key (agreed|uncertain)/.test(row("old.mp3").textContent), row("old.mp3").textContent);
check("no percent sign in any row", !rows.some(function (r) { return /%/.test(r.textContent); }));
fs.rmSync(DOCS, { recursive: true, force: true });
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nthe Library says in words how sure a music key is");
