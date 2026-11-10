"use strict";
// Saved keys (js/library.js, js/analysis-cache.js): a part read back a
// hair different is the same part; a key typed by hand is never pushed out
// by the per-file limit of parts; each mode (Music, Sound effect) keeps its
// own whole-file key, hand-set or detected; a pitched copy's part can take
// the original part's key.
// Run: node scripts/test-pitch-keys.js
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-pitch-inserts-keys-"));
const media = path.join(dir, "cue.wav");
global.window = { cep_node: { require } };
["camelot", "library", "analysis-cache"].forEach(function (f) { require(path.join(ROOT, "js", f + ".js")); });
const L = window.BeatMarkerLibrary, A = window.BeatMarkerAnalysisCache;
function key(code, scope, material) {
  return Object.assign({ camelot: code, strength: 0.5, material: material || "music", scopeKey: scope }, window.BeatMarkerCamelot.fromCamelotCode(code));
}
function reload() { L.loadEntries(JSON.parse(JSON.stringify(L.getAll()))); }
try {
  fs.writeFileSync(media, "audio fixture");

  // A part read back through a speed or a stretch.
  const sk = function (i, o) { return A.scopeKey("clip", "music", { inPointSeconds: i, outPointSeconds: o }, 44100); };
  assert.strictEqual(sk(0.08, 1.320000000001711), sk(0.08, 1.32), "Premiere copy: same part");
  assert.strictEqual(sk(0.03999999999999993, 1.16), sk(0.04000000000000004, 1.1600000000000001), "After Effects copy: same part");
  // A key saved a sample off is still found.
  L.upsertKey(media, "cue.wav", key("6A", "music:1763:51157"));
  assert.strictEqual(L.getKey(media, "music:1764:51156").camelot, "6A");
  assert.strictEqual(L.getKey(media, "music:1764:52000"), null, "another part stays another part");

  // A hand-set key of one part survives twelve newer detected parts, also after a reload.
  L.confirmKey(media, "cue.wav", "3B", "music:0:882000");
  for (let i = 1; i <= 13; i++) { L.upsertKey(media, "cue.wav", key("8A", "music:" + (i * 44100) + ":" + (i * 44100 + 882000))); }
  assert.strictEqual(L.getKey(media, "music:0:882000").camelot, "3B");
  assert.strictEqual(L.getKey(media, "music:0:882000").manual, true);
  reload();
  assert.strictEqual(L.getKey(media, "music:0:882000").camelot, "3B", "kept on load");
  const detected = L.get(media).intervalKeys.filter(function (r) { return !r.confirmedKey && /:/.test(r.scopeKey); });
  assert.strictEqual(detected.length, 12, "still at most 12 detected parts");

  // Each mode keeps its own whole-file key.
  L.upsertKey(media, "cue.wav", key("6A", "music"));
  L.confirmKey(media, "cue.wav", "9A", "music");
  assert.strictEqual(L.getKey(media, "sfx"), null, "a Music key is not a Sound effect key");
  L.upsertKey(media, "cue.wav", key("8B", "sfx", "sfx"));
  assert.strictEqual(L.getKey(media, "sfx").camelot, "8B");
  assert.strictEqual(L.getKey(media, "sfx").manual, false, "the Music hand-set key does not move to Sound effect");
  assert.strictEqual(L.getKey(media, "music").camelot, "9A");
  assert.strictEqual(L.getKey(media, "music").manual, true);
  reload();
  assert.strictEqual(L.getKey(media, "music").camelot, "9A", "kept on load");
  assert.strictEqual(L.getKey(media, "sfx").camelot, "8B");
  L.upsertKey(media, "cue.wav", key("5A", "music"));
  assert.strictEqual(L.getKey(media, "music").camelot, "9A", "a new detection keeps the hand-set key");
  L.clearConfirmedKey(media, "music");
  assert.strictEqual(L.getKey(media, "music").camelot, "5A", "Use detected key brings the detection back");
  assert.strictEqual(L.getKey(media, "sfx").camelot, "8B");
  assert.strictEqual(L.get(media).camelot, "5A", "the entry shows the mode written last");

  // A pitched copy's part takes the original part's key, and only when it has none.
  L.confirmKey(media, "cue.wav", "11B", "music:44100:88200");
  assert.strictEqual(L.carryKey(media, "music:44100:88200", "music:44100:90000"), true);
  assert.strictEqual(L.getKey(media, "music:44100:90000").camelot, "11B");
  assert.strictEqual(L.getKey(media, "music:44100:90000").manual, true);
  L.upsertKey(media, "cue.wav", key("2A", "music:0:5000"));
  assert.strictEqual(L.carryKey(media, "music:44100:88200", "music:0:5000"), false);
  assert.strictEqual(L.getKey(media, "music:0:5000").camelot, "2A", "an existing key is not overwritten");
  assert.strictEqual(L.carryKey(media, "music", "music"), false, "whole-file keys are not carried");
  console.log("PASS: near parts, hand-set keys kept past the part limit, a whole-file key per mode, keys carried to a pitched copy.");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
