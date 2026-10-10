"use strict";
// A skipped witness cannot alter the voting rule; uncertain paths retain the full pass.
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
global.window = {};
require(path.join(ROOT, "js/i18n.js"));
require(path.join(ROOT, "js/camelot.js")); require(path.join(ROOT, "js/key-combine.js"));
const C = window.BeatMarkerCamelot, K = window.BeatMarkerKeyCombine;
const codes = Array.from({ length: 12 }, function (_, i) { return [String(i + 1) + "A", String(i + 1) + "B"]; }).flat();
for (const vote of codes) for (const chord of codes.concat([null])) {
  assert.strictEqual(K.combineMusicKey(vote, chord, vote).camelot, K.combineMusicKey(vote, null, vote).camelot);
}
const src = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const start = src.indexOf("  function _detectKey(");
const fn = src.slice(start, src.indexOf("\n  }", start) + 4);
let vote, chord, skey, failChord, failSkey, modes;
const context = {
  window: { BeatMarkerCamelot: C, BeatMarkerKeyCombine: K, BeatMarkerAudio: { TARGET_SAMPLE_RATE: 44100, resampleMono: async function (s) { return s; } } },
  I18n: window.BeatMarkerI18n,
  log: function () {},
  runSkeyWorker: async function () { if (failSkey) throw Error("unavailable"); return C.fromCamelotCode(skey); },
  runAnalyzeWorker: async function (mode) {
    modes.push(mode);
    if (mode === "keyChord") { if (failChord) throw Error("chord process failed"); return { chordCamelot: chord }; }
    return Object.assign({ camelot: vote, chordCamelot: mode === "key" ? chord : null, strength: 0.7, material: "music", perProfile: [] }, C.fromCamelotCode(vote));
  }
};
vm.createContext(context); vm.runInContext(fn, context);
const confStart = src.indexOf("  function _describeKeyConfidence(");
vm.runInContext(src.slice(confStart, src.indexOf("\n  }", confStart) + 4), context);
async function check(v, c, s, opts) {
  vote = v; chord = c; skey = s; modes = []; failChord = !!opts.failChord; failSkey = !!opts.failSkey;
  return context._detectKey({ length: (opts.short ? 30 : 180) * 44100 }, opts.sfx ? "sfx" : "music");
}
(async function () {
  let result = await check("8A", "10A", "8A", {});
  assert.strictEqual(result.camelot, "8A"); assert.strictEqual(result.witnessSkipped, true); assert.deepStrictEqual(modes, ["keyVote"]);
  for (const lang of ["en", "ru", "es"]) {
    context.I18n.setLanguage(lang);
    assert.strictEqual(context._describeKeyConfidence(result).text, context.I18n.t("key.confTwoChecked"));
  }
  result = await check("8A", "10A", "10A", {});
  assert.strictEqual(result.camelot, "10A"); assert.strictEqual(result.strength, null); assert.deepStrictEqual(modes, ["keyVote", "keyChord"]);
  result = await check("8A", "7A", "10A", {});
  assert.strictEqual(result.camelot, "8A");
  result = await check("8A", "10A", "10A", { failSkey: true });
  assert.strictEqual(result.camelot, "8A"); assert.deepStrictEqual(modes, ["keyVote", "key"]);
  result = await check("8A", "10A", "10A", { failChord: true });
  assert.strictEqual(result.camelot, "10A"); assert.deepStrictEqual(modes, ["keyVote", "keyChord", "key"]);
  await check("8A", "10A", "10A", { short: true }); assert.deepStrictEqual(modes, ["key"]);
  await check("8A", "10A", "10A", { sfx: true }); assert.deepStrictEqual(modes, ["key"]);
  console.log("PASS: all agreeing-key combinations preserve final key; long Music adapts, short/SFX stay full, failures recover.");
})().catch(function (e) { console.error(e); process.exitCode = 1; });
