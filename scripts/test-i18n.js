"use strict";
// Static audit of the panel's translations. Checks, for every language in
// js/i18n.js:
//  - the same set of keys as English: nothing missing, nothing extra;
//  - the same {placeholders} as English for each key (a translation that
//    drops or renames one shows a raw "{bpm}" or loses the number);
//  - no Cyrillic in the English or Spanish strings;
//  - every data-i18n* key in index.html and every literal I18n.t("...") key
//    in the panel scripts exists.
// Keys with a plural suffix (_one/_few/_many/_other) are exempt from the
// key-set check, since each language has its own plural categories.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
global.window = global;
require(path.join(ROOT, "js", "i18n.js"));
const I18n = global.BeatMarkerI18n;

let failures = 0;
function fail(msg) { failures++; console.error("FAIL " + msg); }
// Each language's keys are read straight from its block in js/i18n.js.
const src = fs.readFileSync(path.join(ROOT, "js", "i18n.js"), "utf8");
function keysOf(lang) {
  // The literal block for one language: from "    <lang>: {" to its closing
  // "    },".
  const start = src.indexOf("\n    " + lang + ": {");
  if (start === -1) { throw new Error("no block for language " + lang); }
  const end = src.indexOf("\n    },", start);
  const block = src.slice(start, end);
  const out = {};
  const re = /^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(block))) { out[m[1]] = JSON.parse(m[2]); }
  return out;
}

const LANGS = I18n.LANGUAGES;
const dict = {};
LANGS.forEach(function (l) { dict[l] = keysOf(l); });
const PLURAL = /_(zero|one|two|few|many|other)$/;
const placeholders = (s) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort().join(",");
const CYRILLIC = /[\u0400-\u04FF]/;

const en = dict.en;
const enKeys = Object.keys(en).filter((k) => !PLURAL.test(k));
console.log("languages: " + LANGS.join(", ") + "; " + Object.keys(en).length + " English keys");

LANGS.forEach(function (lang) {
  if (lang === "en") { return; }
  const d = dict[lang];
  const keys = Object.keys(d).filter((k) => !PLURAL.test(k));
  const missing = enKeys.filter((k) => !(k in d));
  const extra = keys.filter((k) => !(k in en));
  missing.forEach((k) => fail(lang + " is missing " + k));
  extra.forEach((k) => fail(lang + " has a key English does not: " + k));
  Object.keys(d).forEach(function (k) {
    const base = en[k] !== undefined ? en[k] : en[k.replace(PLURAL, "_other")];
    if (base !== undefined && placeholders(base) !== placeholders(d[k])) {
      fail(lang + " " + k + ": placeholders " + (placeholders(d[k]) || "none") + " vs English " + (placeholders(base) || "none"));
    }
  });
  const same = keys.filter((k) => en[k] === d[k] && /[a-z]{3,}/i.test(d[k]));
  if (same.length) {
    console.log("  review - " + lang + " identical to English (" + same.length + "): " + same.join(", "));
  }
});
["en", "es"].forEach(function (lang) {
  Object.keys(dict[lang]).forEach(function (k) {
    if (CYRILLIC.test(dict[lang][k])) { fail(lang + " " + k + " contains Cyrillic: " + dict[lang][k]); }
  });
});
// Keys referenced from the markup and the scripts must exist.
const NAMESPACES = Array.from(new Set(Object.keys(en).map((k) => k.split(".")[0])));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const used = new Set();
(html.match(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g) || []).forEach(function (m) {
  used.add(m.replace(/^[^"]+"|"$/g, ""));
});
fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js") && f !== "i18n.js").forEach(function (f) {
  const js = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
  (js.match(/(?:I18n|BeatMarkerI18n)\.t\(\s*"([^"]+)"/g) || []).forEach(function (m) {
    used.add(m.replace(/^[^"]+"|"$/g, ""));
  });
  // Keys passed around as plain strings (tour steps' titleKey/bodyKey,
  // showBusy("busy.x"), ternaries picking a key): any quoted string in a
  // known namespace counts as a reference.
  (js.match(new RegExp('"(?:' + NAMESPACES.join("|") + ')\\.[A-Za-z_]+"', "g")) || []).forEach(function (m) {
    const k = m.slice(1, -1);
    // Not keys: file names ("library.json") and the stem a plural key is
    // built from ("key.pitchSemitones_" + category).
    if (/\.(json|js|md)$/.test(k) || /_$/.test(k)) { return; }
    used.add(k);
  });
});
used.forEach(function (k) {
  if (!(k in en) && !((k + "_other") in en)) { fail("key used but not defined in English: " + k); }
});
console.log("  " + used.size + " keys referenced by the markup and scripts");

if (failures) {
  console.error("\n" + failures + " translation problem(s)");
  process.exit(1);
}
console.log("\ntranslations consistent across " + LANGS.join(", "));
