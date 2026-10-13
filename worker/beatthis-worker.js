#!/usr/bin/env node
// Beat This! worker (ONNX models run with onnxruntime-web/WASM). js/bridge.js
// spawns it as a separate OS process, like worker/analyze-worker.js: its own
// subprocess, its own OS-level timeout through the caller's execFile
// options, and the same "stdout carries only one JSON line" contract. It does
// not share that script or its essentia dependency; it needs only
// onnxruntime-web and the two vendored .onnx models, so a Beat This! failure
// cannot touch the essentia path.
// Usage: beatthis-worker.js <rawSamplesFile22050Hz> [gridBeatsFile] (raw
// Float32 mono samples at 22050 Hz; optionally raw Float64 beat times in
// seconds, the grid on screen). Prints {ok, error, data} with beat and
// downbeat times in seconds and the mean model logit at the beat peaks.
// downbeatTimes are the "1"s counted over the whole song by
// worker/beatthis-bars.js, and modelDownbeatTimes the model's own peak-picked
// ones; when the bars could not be counted, downbeatTimes are the model's own
// and barsDecoded is false. gridBars are the "1"s counted on the grid from
// gridBeatsFile, for the panel to use if it keeps that grid.
"use strict";

const pathMod = require("path");
const fsMod = require("fs");
// Same reasoning as analyze-worker.js: onnxruntime-web or its dependencies
// could log diagnostics to stdout, which would corrupt this script's single
// JSON output line. Redirected before requiring anything else.
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

const MEL_SAMPLE_RATE = 22050;
const FRAME_RATE = 50; // matches beatthis-pipeline.js's own constant
function readSamplesFile(filePath) {
  const buf = fsMod.readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(arrayBuffer);
}
// Beat times of the grid on screen (raw Float64, seconds); a trailing partial
// value and anything not a finite time from 0 up are left out.
function readGridBeatsFile(filePath) {
  const buf = fsMod.readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength - buf.byteLength % 8);
  return Array.from(new Float64Array(arrayBuffer)).filter((t) => Number.isFinite(t) && t >= 0);
}
// Mean beat-model logit at the frames of the selected beat times (null for no
// beats). It is a confidence measure: js/main.js rejects a grid whose mean
// is too low.
function computeMeanPeakLogit(beatFull, beatTimes) {
  if (!beatTimes.length) return null;
  let sum = 0;
  for (const t of beatTimes) {
    const frameIdx = Math.max(0, Math.min(beatFull.length - 1, Math.round(t * FRAME_RATE)));
    sum += beatFull[frameIdx];
  }
  return sum / beatTimes.length;
}
const MAX_BEATTHIS_THREADS = 6;

// Sets the WASM thread count: all cores but two, at most
// MAX_BEATTHIS_THREADS, and a single thread when SharedArrayBuffer is
// unavailable.
function _configureOnnxThreading(ort) {
  const hasSAB = typeof SharedArrayBuffer !== "undefined";
  const cores = require("os").cpus().length;
  ort.env.wasm.numThreads = hasSAB ? Math.max(1, Math.min(cores - 2, MAX_BEATTHIS_THREADS)) : 1;
  console.error(`onnxruntime numThreads = ${ort.env.wasm.numThreads} (cores=${cores}, SharedArrayBuffer=${hasSAB})`);
}

// Runs the mel-spectrogram model and then the beat model over 22050 Hz mono
// samples. Returns { beatTimes, downbeatTimes, meanPeakLogit, gridBars }; the
// times are in seconds, shifted earlier by LATENCY_SEC (the detector's
// latency). gridBeats (or null): the grid on screen, in its own times.
async function runBeatThis(baseDir, samples, gridBeats) {
  const ort = require(pathMod.join(baseDir, "runtime", "onnxruntime-web", "node_modules", "onnxruntime-web"));
  _configureOnnxThreading(ort);
  const { runChunked, postprocessMinimal } = require("./beatthis-pipeline.js");

  const modelsDir = pathMod.join(baseDir, "models");
  const melSession = await ort.InferenceSession.create(pathMod.join(modelsDir, "mel_spectrogram.onnx"));
  // ONNX export of the Beat This! model, see NOTICE.md.
  const beatSession = await ort.InferenceSession.create(pathMod.join(modelsDir, "beat_this_own_export.onnx"));

  const audioTensor = new ort.Tensor("float32", samples, [1, samples.length]);
  const melOut = await melSession.run({ audio_pcm: audioTensor });
  const melTensor = melOut.mel_spectrogram;
  const [, nFrames, nMels] = melTensor.dims;

  const { beatFull, downbeatFull } = await runChunked(ort, beatSession, melTensor.data, nFrames, nMels, 1500, 6);
  const { beatTimes, downbeatTimes } = postprocessMinimal(beatFull, downbeatFull);
  const meanPeakLogit = computeMeanPeakLogit(beatFull, beatTimes);
  // Must equal BEAT_LATENCY_SEC.beatThis in js/analyze.js.
  const LATENCY_SEC = 0.013;
  // The "1"s counted over the whole song, on the model's beats and on the
  // grid on screen; a failure here only costs that improvement, never the
  // analysis.
  let bars = null, gridBars = null;
  try {
    const { decodeBarsOnBeats, decodeBarsOnGrid } = require("./beatthis-bars.js");
    bars = decodeBarsOnBeats(beatFull, downbeatFull, beatTimes, downbeatTimes);
    if (gridBeats) {
      const g = decodeBarsOnGrid(beatFull, downbeatFull, gridBeats, downbeatTimes, LATENCY_SEC);
      if (g) { gridBars = { downbeatTimes: g.downbeatTimes, modelDownbeatTimes: g.modelDownbeatTimes, unsure: g.unsure }; }
    }
  } catch (e) {
    console.error("bar decoding failed: " + (e && e.message ? e.message : e));
  }
  const early = function (t) { return Math.max(0, t - LATENCY_SEC); };
  return {
    beatTimes: beatTimes.map(early),
    downbeatTimes: (bars ? bars.downbeatTimes : downbeatTimes).map(early),
    modelDownbeatTimes: downbeatTimes.map(early),
    barsDecoded: !!bars,
    barsUnsure: bars ? bars.unsure : null,
    meanPeakLogit,
    // Already in the grid's own times (members of gridBeats).
    gridBars
  };
}

async function main() {
  const [, , samplesFile, gridBeatsFile] = process.argv;
  const result = { ok: false, error: null, data: null };

  try {
    if (!samplesFile) {
      throw new Error("Usage: beatthis-worker.js <rawSamplesFile22050Hz>");
    }
    const baseDir = pathMod.join(__dirname, "..");
    const samples = readSamplesFile(samplesFile);
    if (samples.length < MEL_SAMPLE_RATE) {
      throw new Error("Audio too short for Beat This! (" + samples.length + " samples at " + MEL_SAMPLE_RATE + "Hz).");
    }
    // An unreadable grid file only costs the grid's bars, never the analysis.
    let gridBeats = null;
    if (gridBeatsFile) {
      try { gridBeats = readGridBeatsFile(gridBeatsFile); } catch (e) { console.error("grid beats unreadable: " + (e && e.message ? e.message : e)); }
    }
    result.data = await runBeatThis(baseDir, samples, gridBeats);
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = (e && e.message) ? e.message : String(e);
  }

  try {
    process.stdout.write(JSON.stringify(result));
  } catch (stringifyErr) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: "Worker result could not be serialized: " +
        (stringifyErr && stringifyErr.message ? stringifyErr.message : String(stringifyErr)),
      data: null
    }));
  }
}

main().catch(function (e) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: "Unhandled worker error: " + (e && e.message ? e.message : String(e)),
    data: null
  }));
});
