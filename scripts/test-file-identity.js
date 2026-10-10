"use strict";
// Cached analysis must describe the file bytes that were analyzed.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-identity-"));
const media = path.join(work, "audio.wav");
global.window = { cep_node: { require } };
require(path.join(process.env.DOWNBEAT_ROOT || path.join(__dirname, ".."), "js/library.js"));
const L = window.BeatMarkerLibrary;
try {
  fs.writeFileSync(media, "first audio");
  L.upsertAnalysis(media, "fixture", { bpm: 100, beatsArray: [0, 0.6, 1.2], phase: 0 });
  assert.strictEqual(L.get(media).bpm, 100);
  fs.writeFileSync(media, "replaced audio with different samples");
  assert.strictEqual(L.get(media), null, "replaced media must not restore its old grid");
  L.upsertKey(media, "fixture", { camelot: "8A", key: "A", scale: "minor" });
  const saved = JSON.parse(JSON.stringify(L.getAll()));
  fs.unlinkSync(media);
  L.loadEntries(saved);
  assert.strictEqual(L.get(media), null, "missing media must not restore old key");
  console.log("PASS: replaced and missing audio invalidate cached analysis.");
} finally { fs.rmSync(work, { recursive: true, force: true }); }
