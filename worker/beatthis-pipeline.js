"use strict";
// Beat This! inference helpers: chunked model inference with aggregation,
// and the "minimal" postprocessing (beat and downbeat peak picking). The
// logic follows the reference implementation of CPJKU/beat_this
// (inference.py and model/postprocessor.py).
const FRAME_RATE = 50; // model frames per second (hop 441 at 22050 Hz)
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
// Pads a [frames, nMels] Float32Array (flattened, row-major) with `left`/
// `right` all-zero frames. Mirrors inference.py's zeropad().
function zeropadFrames(flatData, nFrames, nMels, left, right) {
  if (left === 0 && right === 0) {
    return { data: flatData, nFrames };
  }
  const outFrames = nFrames + left + right;
  const out = new Float32Array(outFrames * nMels);
  out.set(flatData, left * nMels);
  return { data: out, nFrames: outFrames };
}
// Mirrors inference.py's split_piece(): produces chunk start indices (can be
// negative - handled by zeropad) and the chunk data itself.
function splitPiece(flatMel, totalFrames, nMels, chunkSize, borderSize, avoidShortEnd) {
  const starts = [];
  const step = chunkSize - 2 * borderSize;
  for (let s = -borderSize; s < totalFrames - borderSize; s += step) {
    starts.push(s);
  }
  if (avoidShortEnd && totalFrames > step && starts.length > 0) {
    starts[starts.length - 1] = totalFrames - (chunkSize - borderSize);
  }
  const chunks = starts.map((start) => {
    const segStart = Math.max(start, 0);
    const segEnd = Math.min(start + chunkSize, totalFrames);
    const segFrames = segEnd - segStart;
    const seg = flatMel.subarray(segStart * nMels, segEnd * nMels);
    const left = Math.max(0, -start);
    const right = Math.max(0, Math.min(borderSize, start + chunkSize - totalFrames));
    return zeropadFrames(seg, segFrames, nMels, left, right);
  });
  return { chunks, starts };
}
// Runs the beat_this ONNX model over every chunk and aggregates the results
// into one full-length beat/downbeat logit array, following the reference
// split_predict_aggregate()/aggregate_prediction() with overlap_mode
// "keep_first". `ort` is the onnxruntime-web module, passed in explicitly
// rather than required here.
async function runChunked(ort, session, flatMel, totalFrames, nMels, chunkSize, borderSize) {
  const { chunks, starts } = splitPiece(flatMel, totalFrames, nMels, chunkSize, borderSize, true);

  const beatFull = new Float32Array(totalFrames).fill(-1000);
  const downbeatFull = new Float32Array(totalFrames).fill(-1000);
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const start = starts[i];
    const inputTensor = new ort.Tensor("float32", chunk.data, [1, chunk.nFrames, nMels]);
    const out = await session.run({ spectrogram: inputTensor });
    const beatChunk = out.beat.data;
    const downbeatChunk = out.downbeat.data;

    const lo = start + borderSize;
    const hi = start + chunkSize - borderSize;
    const clipLo = Math.max(lo, 0);
    const clipHi = Math.min(hi, totalFrames);
    const offsetLo = clipLo - lo;
    for (let j = 0; j < clipHi - clipLo; j++) {
      beatFull[clipLo + j] = beatChunk[borderSize + offsetLo + j];
      downbeatFull[clipLo + j] = downbeatChunk[borderSize + offsetLo + j];
    }
  }
  return { beatFull, downbeatFull };
}
function maxPoolPeaks(logits, kernelRadius) {
  const n = logits.length;
  const isPeak = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (logits[i] <= 0) continue; // threshold: prob > 0.5 <=> logit > 0
    let isMax = true;
    const lo = Math.max(0, i - kernelRadius);
    const hi = Math.min(n - 1, i + kernelRadius);
    for (let j = lo; j <= hi; j++) {
      if (j !== i && logits[j] > logits[i]) {
        isMax = false;
        break;
      }
    }
    if (isMax) isPeak[i] = 1;
  }
  const peaks = [];
  for (let i = 0; i < n; i++) {
    if (isPeak[i]) peaks.push(i);
  }
  return peaks;
}

function deduplicatePeaks(peaks, width) {
  if (peaks.length === 0) return [];
  const result = [];
  let p = peaks[0];
  let c = 1;
  for (let k = 1; k < peaks.length; k++) {
    const p2 = peaks[k];
    if (p2 - p <= width) {
      c++;
      p += (p2 - p) / c;
    } else {
      result.push(p);
      p = p2;
      c = 1;
    }
  }
  result.push(p);
  return result;
}
// Merges doubled beats: a peak closer to the previous one than
// MERGE_FRACTION_OF_BEAT of the median beat gap replaces it. Downbeats need
// no pass of their own, since they snap to the merged beats below.
const MERGE_FRACTION_OF_BEAT = 0.25;
function mergeCloseBeats(peaks) {
  if (peaks.length < 3) return peaks.slice();
  const gaps = [];
  for (let k = 1; k < peaks.length; k++) gaps.push(peaks[k] - peaks[k - 1]);
  gaps.sort((a, b) => a - b);
  const minGap = MERGE_FRACTION_OF_BEAT * gaps[gaps.length >> 1];
  const out = [peaks[0]];
  for (let k = 1; k < peaks.length; k++) {
    if (peaks[k] - out[out.length - 1] < minGap) {
      out[out.length - 1] = peaks[k];
    } else {
      out.push(peaks[k]);
    }
  }
  return out;
}

function postprocessMinimal(beatLogits, downbeatLogits) {
  const beatPeaks = mergeCloseBeats(deduplicatePeaks(maxPoolPeaks(beatLogits, 3), 1));
  const downbeatPeaks = deduplicatePeaks(maxPoolPeaks(downbeatLogits, 3), 1);
  let beatTimes = beatPeaks.map((f) => f / FRAME_RATE);
  let downbeatTimes = downbeatPeaks.map((f) => f / FRAME_RATE);
  // move each downbeat to the nearest beat time (matches postprocessor.py)
  if (beatTimes.length > 0) {
    downbeatTimes = downbeatTimes.map((d) => {
      let best = beatTimes[0], bestDist = Math.abs(beatTimes[0] - d);
      for (const b of beatTimes) {
        const dist = Math.abs(b - d);
        if (dist < bestDist) { best = b; bestDist = dist; }
      }
      return best;
    });
    downbeatTimes = Array.from(new Set(downbeatTimes)).sort((a, b) => a - b);
  }
  return { beatTimes, downbeatTimes };
}

module.exports = {
  runChunked,
  postprocessMinimal,
  mergeCloseBeats,
  sigmoid,
  FRAME_RATE,
};
