#!/usr/bin/env node
// Spawned by js/bridge.js alongside the essentia "key" worker when Detect key
// runs in Music mode. Same separate-process pattern as beatthis-worker.js:
// its own OS-level timeout, stdout reserved for one JSON line, and a failure
// here can never break the essentia answer (the panel treats a missing S-KEY
// opinion as "no third opinion").
// Model: models/skey.onnx, exported from deezer/skey (pinned commit,
// hash-verified, see NOTICE.md) by scripts/skey-export/export_skey_onnx.py,
// which checks the export against the upstream PyTorch graph.
// Usage: node skey-worker.js <rawSamplesFile>
// rawSamplesFile: raw Float32Array bytes (native byte order), MONO, 22050 Hz,
// the rate S-KEY was trained at and the same samples js/audio.js's
// resampleMono() produces for Beat This!.
// Prints exactly one line of JSON to stdout: {ok, error, data}, where data is
// {key, scale, probs: [24]}, with key/scale in the spelling js/camelot.js's
// toCamelotCode() takes.
"use strict";

const pathMod = require("path");
const fsMod = require("fs");
// Same "stdout is sacred" reasoning as analyze-worker.js.
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;
// Inference and the model's key order live in skey-core.js.
const { SAMPLE_RATE, runSKey } = require("./skey-core.js");

function readSamplesFile(filePath) {
  const buf = fsMod.readFileSync(filePath);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

async function main() {
  const [, , samplesFile] = process.argv;
  const result = { ok: false, error: null, data: null };
  try {
    if (!samplesFile) {
      throw new Error("Usage: skey-worker.js <rawSamplesFile22050Hz>");
    }
    const samples = readSamplesFile(samplesFile);
    if (samples.length < SAMPLE_RATE * 2) {
      throw new Error("Audio too short for S-KEY (" + samples.length + " samples at " + SAMPLE_RATE + " Hz).");
    }
    result.data = await runSKey(pathMod.join(__dirname, ".."), samples);
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = (e && e.message) ? e.message : String(e);
  }
  process.stdout.write(JSON.stringify(result));
}

main().catch(function (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: "Unhandled worker error: " + (e && e.message ? e.message : String(e)), data: null }));
});
