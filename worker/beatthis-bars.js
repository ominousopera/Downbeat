"use strict";
// Where the bars start, decided over the whole song at once from Beat
// This!'s frame activations.
//
// The model scores every frame (50 per second) twice: "a beat is here" and
// "a '1' is here". postprocessMinimal (beatthis-pipeline.js) turns every
// peak of the second curve into a "1" on its own, so a loud snare on beat 3
// can become a "1" and the "1" can jump inside the song. This file finds
// instead the single most likely run of evenly counted bars (1 2 3 4 1 2 3
// 4, the tempo free to drift a little between beats) that explains both
// curves: the bar-pointer model of Krebs, Böck & Widmer, "An Efficient
// State-Space Model for Joint Tempo and Meter Tracking" (ISMIR 2015), with
// the observation model of Böck, Krebs & Widmer, "Joint Beat and Downbeat
// Tracking with Recurrent Neural Networks" (ISMIR 2016), decoded with
// Viterbi. The decoder is written from the two papers; the conversion of
// Beat This!'s two outputs into the papers' three classes (each
// probability squeezed by 1e-5, "beat but not 1" = beat minus downbeat)
// follows Beat This!'s own postprocessor.py (MIT, see NOTICE.md).
//
// Only 4/4 is decoded, with the tempo kept near the spacing of the model's
// own beats, and only the decoded "1"s are used, each moved onto the
// nearest beat the panel already places, as postprocessMinimal does with
// the model's own "1"s. Songs in 6/8 or 12/8 are counted in fours.

const { sigmoid, FRAME_RATE } = require("./beatthis-pipeline.js");

const BEATS_PER_BAR = 4;
// Tempo states: 60 log-spaced points within +-20% of the median spacing of
// the beats the panel places, rounded to whole frames (duplicates dropped).
const TEMPO_WINDOW = 0.2;
const TEMPO_POINTS = 60;
// Cost of a tempo change from one beat to the next, exp(-lambda *
// |tau'/tau - 1|) (Krebs 2015).
const TEMPO_CHANGE_LAMBDA = 100;
// The first 1/16 of every beat is its "beat" region (Böck 2016).
const OBSERVATION_LAMBDA = 16;
const EPS = 1e-5;
// Outside these the caller keeps the model's own "1"s: a median beat
// spacing of 8-100 frames (30-375 BPM) and at most 30 minutes of frames.
// Memory is one byte per frame, tempo state and beat of the bar for the
// back-pointers - at most about 15 MB at the slowest tempo.
const MIN_BEAT_FRAMES = 8;
const MAX_BEAT_FRAMES = 100;
const MAX_FRAMES = 30 * 60 * FRAME_RATE;
// `unsure`: the model barely marks the decoded "1"s (mean downbeat
// probability under 0.3) or under 30% of its own "1"s fall on them.
// js/main.js also warns when the model's own "1"s are uneven.
const UNSURE_STRENGTH = 0.3;
const UNSURE_AGREEMENT = 0.3;
const LOGIT_LIMIT = 30;
// Silence at the start and end is not decoded (Böck 2016, section 2.2.3):
// only from the first to the last frame where the beat-only or the downbeat
// probability reaches this. Otherwise the decoder keeps counting bars
// through the silence, and those "1"s all land on the first or last beat.
const ACTIVE_THRESHOLD = 0.05;

function clampLogit(x) {
  // NaN lands on -LOGIT_LIMIT too: both comparisons are false for it.
  return x > LOGIT_LIMIT ? LOGIT_LIMIT : (x > -LOGIT_LIMIT ? x : -LOGIT_LIMIT);
}

function tempoStates(beatFrames) {
  const lo = Math.log2(beatFrames * (1 - TEMPO_WINDOW));
  const hi = Math.log2(beatFrames * (1 + TEMPO_WINDOW));
  const seen = new Set();
  for (let i = 0; i < TEMPO_POINTS; i++) {
    seen.add(Math.round(Math.pow(2, lo + (hi - lo) * i / (TEMPO_POINTS - 1))));
  }
  const taus = Array.from(seen).sort((a, b) => a - b);
  const K = taus.length;
  // logTransition[from * K + to], each row normalised to sum to 1.
  const logTransition = new Float64Array(K * K);
  for (let from = 0; from < K; from++) {
    let max = -Infinity;
    for (let to = 0; to < K; to++) {
      const v = -TEMPO_CHANGE_LAMBDA * Math.abs(taus[to] / taus[from] - 1);
      logTransition[from * K + to] = v;
      if (v > max) { max = v; }
    }
    let sum = 0;
    for (let to = 0; to < K; to++) { sum += Math.exp(logTransition[from * K + to] - max); }
    const norm = max + Math.log(sum);
    for (let to = 0; to < K; to++) { logTransition[from * K + to] -= norm; }
  }
  return { taus, logTransition };
}

// Log probabilities per frame for the three kinds of state: the "1" region,
// the region of beats 2-4, and everything else (spread over the remaining
// OBSERVATION_LAMBDA - 1 parts of a beat). Beat This!'s beat head fires on
// every beat including the "1", so "beat but not 1" is beat minus downbeat.
function observations(beatLogits, downbeatLogits, T) {
  const down = new Float64Array(T), beat = new Float64Array(T), none = new Float64Array(T);
  const beatProb = new Float64Array(T), active = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const pb = sigmoid(clampLogit(beatLogits[t])) * (1 - EPS) + EPS / 2;
    const pd = sigmoid(clampLogit(downbeatLogits[t])) * (1 - EPS) + EPS / 2;
    const beatOnly = Math.max(pb - pd, EPS / 2);
    down[t] = Math.log(pd);
    beat[t] = Math.log(beatOnly);
    none[t] = Math.log(Math.max(1 - beatOnly - pd, EPS / 2) / (OBSERVATION_LAMBDA - 1));
    beatProb[t] = pb;
    active[t] = (beatOnly >= ACTIVE_THRESHOLD || pd >= ACTIVE_THRESHOLD) ? 1 : 0;
  }
  return { down, beat, none, beatProb, active };
}

// Viterbi over the bar-pointer states. A state is (tempo k, position p in
// the bar, 0 .. 4 * taus[k] - 1); the position moves one frame at a time,
// and the tempo may change only where a beat starts. Back-pointers are kept
// only for those beat-start states, one byte each (taus.length <= 60).
// Decodes frames start .. start + T - 1 and returns the tempo and position
// of every one of them on the best path (index 0 = frame start).
function bestPath(obs, taus, logTransition, start, T) {
  const M = BEATS_PER_BAR, K = taus.length;
  const offset = new Int32Array(K);
  let S = 0;
  for (let k = 0; k < K; k++) { offset[k] = S; S += M * taus[k]; }
  let prev = new Float64Array(S), cur = new Float64Array(S);
  const back = new Uint8Array(T * K * M);
  const obsAt = (t, k, p) => {
    const tau = taus[k], f = start + t;
    if ((p % tau) * OBSERVATION_LAMBDA < tau) { return p < tau ? obs.down[f] : obs.beat[f]; }
    return obs.none[f];
  };
  for (let k = 0; k < K; k++) {
    for (let p = 0; p < M * taus[k]; p++) { prev[offset[k] + p] = obsAt(0, k, p); }
  }
  for (let t = 1; t < T; t++) {
    for (let k = 0; k < K; k++) {
      const tau = taus[k], o = offset[k], len = M * tau;
      for (let p = 1; p < len; p++) {
        if (p % tau !== 0) { cur[o + p] = prev[o + p - 1] + obsAt(t, k, p); }
      }
      for (let b = 0; b < M; b++) {
        // The previous frame was the last one of beat b-1 (beat 4 for b=0),
        // at any tempo.
        let best = -Infinity, arg = 0;
        for (let q = 0; q < K; q++) {
          const tq = taus[q];
          const v = prev[offset[q] + (b * tq - 1 + M * tq) % (M * tq)] + logTransition[q * K + k];
          if (v > best) { best = v; arg = q; }
        }
        cur[o + b * tau] = best + obsAt(t, k, b * tau);
        back[(t * K + k) * M + b] = arg;
      }
    }
    const swap = prev; prev = cur; cur = swap;
  }
  let bestState = 0;
  for (let s = 1; s < S; s++) { if (prev[s] > prev[bestState]) { bestState = s; } }
  let k = K - 1;
  while (offset[k] > bestState) { k--; }
  let p = bestState - offset[k];
  const pathK = new Uint8Array(T), pathP = new Uint16Array(T);
  for (let t = T - 1; t >= 0; t--) {
    pathK[t] = k; pathP[t] = p;
    if (t === 0) { break; }
    const tau = taus[k];
    if (p % tau === 0) {
      const b = p / tau, q = back[(t * K + k) * M + b], tq = taus[q];
      k = q;
      p = (b * tq - 1 + M * tq) % (M * tq);
    } else {
      p -= 1;
    }
  }
  return { pathK, pathP };
}

// Frames of the "1"s on the path: in each "1" region the path passes
// through, the frame where the beat curve is highest. The path may start
// inside a region (its first state is free), so frame 0 opens one too -
// otherwise a "1" right at the start of the window is lost.
function downbeatFramesOnPath(path, taus, beatProb, start, T) {
  const frames = [];
  let t = 0;
  while (t < T) {
    const tau = taus[path.pathK[t]], p = path.pathP[t];
    const opens = p % tau === 0 || (t === 0 && (p % tau) * OBSERVATION_LAMBDA < tau);
    if (!opens) { t++; continue; }
    const beatIndex = Math.floor(p / tau);
    let u = t, top = t;
    while (u < T) {
      const tau2 = taus[path.pathK[u]], p2 = path.pathP[u];
      if ((p2 % tau2) * OBSERVATION_LAMBDA >= tau2 || Math.floor(p2 / tau2) !== beatIndex) { break; }
      if (beatProb[start + u] > beatProb[start + top]) { top = u; }
      u++;
    }
    if (beatIndex === 0) { frames.push(start + top); }
    t = Math.max(u, t + 1);
  }
  return frames;
}

function nearestIndex(sorted, x) {
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) { lo = mid + 1; } else { hi = mid; }
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - x) <= Math.abs(sorted[lo] - x)) { lo--; }
  return lo;
}

// beatLogits / downbeatLogits: Beat This!'s frame outputs (runChunked).
// beatTimes: the beats the panel places (postprocessMinimal, seconds, before
// the latency shift). modelDownbeatTimes: the model's own "1"s from the same
// call. Returns { downbeatTimes, strength, agreement, unsure }, the "1"s
// being members of beatTimes, or null when the input is out of range (the
// caller then keeps the model's own "1"s).
function decodeBarsOnBeats(beatLogits, downbeatLogits, beatTimes, modelDownbeatTimes) {
  const T = Math.min(beatLogits ? beatLogits.length : 0, downbeatLogits ? downbeatLogits.length : 0);
  if (T < 2 || T > MAX_FRAMES || !beatTimes || beatTimes.length < 8) { return null; }
  const gaps = [];
  for (let i = 1; i < beatTimes.length; i++) { gaps.push(beatTimes[i] - beatTimes[i - 1]); }
  gaps.sort((a, b) => a - b);
  const beatFrames = gaps[gaps.length >> 1] * FRAME_RATE;
  if (!(beatFrames >= MIN_BEAT_FRAMES && beatFrames <= MAX_BEAT_FRAMES)) { return null; }

  const { taus, logTransition } = tempoStates(beatFrames);
  const obs = observations(beatLogits, downbeatLogits, T);
  let first = 0, last = T - 1;
  while (first < T && !obs.active[first]) { first++; }
  while (last > first && !obs.active[last]) { last--; }
  if (last - first < 1) { return null; }
  const decoded = downbeatFramesOnPath(bestPath(obs, taus, logTransition, first, last - first + 1),
    taus, obs.beatProb, first, last - first + 1);

  // A "1" more than half a beat before the first placed beat or after the
  // last one has no beat of its own; moved onto the edge beat it would be a
  // wrong "1" there.
  const halfBeat = beatFrames / FRAME_RATE / 2;
  const lo = beatTimes[0] - halfBeat, hi = beatTimes[beatTimes.length - 1] + halfBeat;
  const frames = decoded.filter((f) => f / FRAME_RATE >= lo && f / FRAME_RATE <= hi);
  const onBeats = new Set();
  for (const f of frames) { onBeats.add(beatTimes[nearestIndex(beatTimes, f / FRAME_RATE)]); }
  const downbeatTimes = Array.from(onBeats).sort((a, b) => a - b);
  if (downbeatTimes.length < 2) { return null; }

  // How strongly the model itself marks the decoded "1"s: its downbeat
  // probability at each, the highest within +-2 frames, averaged.
  let strength = 0;
  for (const f of frames) {
    let m = 0;
    for (let j = Math.max(0, f - 2); j <= Math.min(T - 1, f + 2); j++) { m = Math.max(m, sigmoid(clampLogit(downbeatLogits[j]))); }
    strength += m;
  }
  strength /= frames.length;
  const own = modelDownbeatTimes || [];
  let shared = 0;
  for (const t of own) { if (onBeats.has(t)) { shared++; } }
  const agreement = own.length ? shared / own.length : 0;
  return {
    downbeatTimes,
    strength,
    agreement,
    unsure: strength < UNSURE_STRENGTH || agreement < UNSURE_AGREEMENT
  };
}

module.exports = {
  decodeBarsOnBeats,
  MAX_FRAMES,
  MIN_BEAT_FRAMES,
  MAX_BEAT_FRAMES
};
