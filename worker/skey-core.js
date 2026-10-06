// S-KEY inference, shared by worker/skey-worker.js (Detect key, one clip per
// process) and worker/analyze-worker.js's "library" mode (the Library scan,
// several files per process - hence the one cached session).
"use strict";

const pathMod = require("path");

const SAMPLE_RATE = 22050;
// Below this many samples S-KEY is not asked at all.
const MIN_SAMPLES = SAMPLE_RATE * 2;
// Upstream skey/key_detection.py's key_map, index -> key. The model's 24
// outputs are in exactly this order.
const KEY_MAP = [
  ["A", "major"], ["Bb", "major"], ["B", "major"], ["C", "major"], ["C#", "major"], ["D", "major"],
  ["D#", "major"], ["E", "major"], ["F", "major"], ["F#", "major"], ["G", "major"], ["G#", "major"],
  ["B", "minor"], ["C", "minor"], ["C#", "minor"], ["D", "minor"], ["D#", "minor"], ["E", "minor"],
  ["F", "minor"], ["F#", "minor"], ["G", "minor"], ["G#", "minor"], ["A", "minor"], ["Bb", "minor"]
];

let _ort = null;
let _sessionPromise = null;
function _session(baseDir) {
  if (!_sessionPromise) {
    _ort = require(pathMod.join(baseDir, "runtime", "onnxruntime-web", "node_modules", "onnxruntime-web"));
    // A small model (75k weights) - one thread is plenty, and it leaves the
    // cores to Premiere and to the essentia work running at the same time.
    _ort.env.wasm.numThreads = 1;
    _sessionPromise = _ort.InferenceSession.create(pathMod.join(baseDir, "models", "skey.onnx"));
    _sessionPromise.catch(function () { _sessionPromise = null; }); // a failed load may be retried
  }
  return _sessionPromise;
}
// samples: mono Float32Array at 22050 Hz. Resolves {key, scale, probs}.
async function runSKey(baseDir, samples) {
  // Peak-normalize, as upstream load_audio() does before inference.
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) { peak = a; }
  }
  if (peak === 0) {
    throw new Error("Silent audio - nothing to detect a key from.");
  }
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) { normalized[i] = samples[i] / peak; }

  const session = await _session(baseDir);
  const out = await session.run({ waveform: new _ort.Tensor("float32", normalized, [1, normalized.length]) });
  const probs = Array.from(out.probs.data);
  let best = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[best]) { best = i; }
  }
  return { key: KEY_MAP[best][0], scale: KEY_MAP[best][1], probs: probs.map(function (p) { return Math.round(p * 1e5) / 1e5; }) };
}
// 44100 -> 22050 Hz for the Library scan, whose excerpts reach the worker at
// 44100 only (the panel's Detect key resamples in Web Audio instead). A
// 47-tap half-band low-pass (windowed sinc, Blackman), so every other tap is
// zero: 12 symmetric pairs plus the center per output sample.
const HB_HALF = 23;
const HB_OFFSETS = [];
const HB_PAIRS = [];
let HB_CENTER = 0;
(function designHalfBand() {
  const taps = [];
  let sum = 0;
  for (let n = 0; n <= 2 * HB_HALF; n++) {
    const d = n - HB_HALF;
    const x = 0.5 * d;
    const sinc = d === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / (2 * HB_HALF)) + 0.08 * Math.cos(4 * Math.PI * n / (2 * HB_HALF));
    taps.push(0.5 * sinc * w);
    sum += 0.5 * sinc * w;
  }
  HB_CENTER = taps[HB_HALF] / sum;
  for (let d = 1; d <= HB_HALF; d += 2) {
    HB_OFFSETS.push(d);
    HB_PAIRS.push(taps[HB_HALF + d] / sum);
  }
})();

function halfRate(x) {
  const n = Math.floor(x.length / 2);
  const out = new Float32Array(n);
  const len = x.length;
  for (let m = 0; m < n; m++) {
    const i = 2 * m;
    let acc = HB_CENTER * x[i];
    if (i >= HB_HALF && i + HB_HALF < len) {
      for (let j = 0; j < HB_OFFSETS.length; j++) {
        acc += HB_PAIRS[j] * (x[i - HB_OFFSETS[j]] + x[i + HB_OFFSETS[j]]);
      }
    } else {
      for (let j = 0; j < HB_OFFSETS.length; j++) {
        const d = HB_OFFSETS[j];
        acc += HB_PAIRS[j] * ((i - d >= 0 ? x[i - d] : 0) + (i + d < len ? x[i + d] : 0));
      }
    }
    out[m] = acc;
  }
  return out;
}
// For the Library scan: 44100 Hz samples in, {key, scale} out, or null when
// the excerpt is too short to ask.
async function detectFrom44100(baseDir, samples44100) {
  const s = halfRate(samples44100);
  if (s.length < MIN_SAMPLES) {
    return null;
  }
  const r = await runSKey(baseDir, s);
  return { key: r.key, scale: r.scale };
}

module.exports = { SAMPLE_RATE, MIN_SAMPLES, runSKey, halfRate, detectFrom44100 };
