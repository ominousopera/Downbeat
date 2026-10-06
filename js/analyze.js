// Beat, downbeat-phase, key, onset and tempo-change analysis with
// essentia.js, producing the cuesheets that js/cuesheet.js and js/place.js
// use. It is not loaded by the panel: worker/analyze-worker.js runs it in
// plain Node (set up by worker/essentia-node-harness.js).
(function (global) {
  "use strict";

  var essentiaInstance = null;
  var essentiaInitPromise = null;
  // Seconds each beat detector marks a beat late; subtracted from its times
  // so markers sit on the start of the hit. Beat This!'s value is applied in
  // worker/beatthis-worker.js. BEAT_TIMING_VERSION numbers the correction
  // applied to stored beat times.
  var BEAT_LATENCY_SEC = { essentia: 0.007, beatThis: 0.013 };
  var BEAT_TIMING_VERSION = 3;
  function shiftTimesEarlier(times, seconds) {
    var out = [];
    for (var i = 0; times && i < times.length; i++) {
      out.push(Math.max(0, times[i] - seconds));
    }
    return out;
  }
  // Loads the essentia WASM once. On any failure (including the timeout
  // below) essentiaInitPromise is reset to null, so the next call retries
  // instead of returning the same cached rejection.
  function initEssentia() {
    if (essentiaInitPromise) {
      return essentiaInitPromise;
    }
    essentiaInitPromise = new Promise(function (resolve, reject) {
      if (typeof EssentiaWASM !== "function") {
        essentiaInitPromise = null;
        reject(new Error("EssentiaWASM global not found - check that js/lib/essentia-wasm.web.js loaded (script order/path issue?)."));
        return;
      }
      if (typeof Essentia !== "function") {
        essentiaInitPromise = null;
        reject(new Error("Essentia global not found - check that js/lib/essentia.js-core.js loaded."));
        return;
      }

      var settled = false;
      var timeoutId = setTimeout(function () {
        if (settled) {
          return;
        }
        settled = true;
        essentiaInitPromise = null;
        reject(new Error(
          "essentia.js WASM initialization timed out after 20s. Try again; if it keeps " +
          "happening, reload the panel (right-click > Reload) and report it with the " +
          "log (Settings > Diagnostics > Copy log)."
        ));
      }, 20000);

      EssentiaWASM().then(function (wasmModule) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        try {
          essentiaInstance = new Essentia(wasmModule);
          resolve(essentiaInstance);
        } catch (e) {
          essentiaInitPromise = null;
          reject(new Error("new Essentia(wasmModule) threw: " + e.message));
        }
      }).catch(function (e) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        essentiaInitPromise = null;
        reject(new Error("EssentiaWASM() failed to initialize: " + (e && e.message ? e.message : e)));
      });
    });
    return essentiaInitPromise;
  }
  // Picks the downbeat phase (0..3) as the beat index modulo 4 whose average
  // loudness is highest. Returns { phase, averagesByPhase }, so the UI can
  // show why a phase was picked, not just the number.
  function pickBestPhase(loudnessArray) {
    var sums = [0, 0, 0, 0];
    var counts = [0, 0, 0, 0];
    for (var i = 0; i < loudnessArray.length; i++) {
      var phase = i % 4;
      sums[phase] += loudnessArray[i];
      counts[phase]++;
    }
    var averages = [0, 0, 0, 0];
    var bestPhase = 0;
    var bestAvg = -Infinity;
    for (var p = 0; p < 4; p++) {
      averages[p] = counts[p] > 0 ? sums[p] / counts[p] : 0;
      if (averages[p] > bestAvg) {
        bestAvg = averages[p];
        bestPhase = p;
      }
    }
    // How much the winning phase stands out from the runner-up, relative to
    // the winner's own magnitude: 0 means tied (no real signal which phase is
    // "one"), closer to 1 means the winner clearly dominates.
    var runnerUpAvg = -Infinity;
    for (var r = 0; r < 4; r++) {
      if (r !== bestPhase && averages[r] > runnerUpAvg) {
        runnerUpAvg = averages[r];
      }
    }
    var marginRatio = bestAvg > 0 ? (bestAvg - runnerUpAvg) / bestAvg : 0;
    return { phase: bestPhase, averagesByPhase: averages, marginRatio: marginRatio };
  }
  // Picks the best phase from precomputed per-phase averages; returns
  // { phase, marginRatio } like pickBestPhase().
  function _pickPhaseFromAverages(averages) {
    var bestPhase = 0;
    var bestAvg = -Infinity;
    for (var p = 0; p < 4; p++) {
      if (averages[p] > bestAvg) {
        bestAvg = averages[p];
        bestPhase = p;
      }
    }
    var runnerUpAvg = -Infinity;
    for (var r = 0; r < 4; r++) {
      if (r !== bestPhase && averages[r] > runnerUpAvg) {
        runnerUpAvg = averages[r];
      }
    }
    var marginRatio = bestAvg > 0 ? (bestAvg - runnerUpAvg) / bestAvg : 0;
    return { phase: bestPhase, marginRatio: marginRatio };
  }
  // Normalizes phase averages to sum to 1. Falls back to a flat
  // [.25,.25,.25,.25] when they sum to 0 (no signal) instead of dividing by
  // zero.
  function _normalizePhaseAverages(averages) {
    var total = averages[0] + averages[1] + averages[2] + averages[3];
    if (total <= 0) {
      return [0.25, 0.25, 0.25, 0.25];
    }
    return [averages[0] / total, averages[1] / total, averages[2] / total, averages[3] / total];
  }
  // Chord labels are smoothed before change events are taken: short runs
  // (< MIN_STABLE_CHORD_BEATS beats) of a chord label are folded into the
  // chord that was stable before them, because chord detection flickers
  // between closely related chords from beat to beat even when the harmony
  // has not changed. Requiring 2 consecutive beats to agree filters
  // single-beat blips while still catching fast harmonic rhythm.
  var MIN_STABLE_CHORD_BEATS = 2;
  function _smoothChordSequence(rawChords) {
    var n = rawChords.length;
    var smoothed = new Array(n);
    if (n === 0) {
      return smoothed;
    }
    var runStart = 0;
    var lastStableChord = null;
    for (var i = 1; i <= n; i++) {
      if (i === n || rawChords[i] !== rawChords[runStart]) {
        var runLength = i - runStart;
        var isStable = runLength >= MIN_STABLE_CHORD_BEATS || lastStableChord === null;
        var chordToUse = isStable ? rawChords[runStart] : lastStableChord;
        for (var j = runStart; j < i; j++) {
          smoothed[j] = chordToUse;
        }
        if (isStable) {
          lastStableChord = rawChords[runStart];
        }
        runStart = i;
      }
    }
    return smoothed;
  }

  // Chord-change evidence for the phase: runs the frame pipeline (FrameGenerator,
  // Windowing, Spectrum, SpectralPeaks, HPCP) and essentia's
  // ChordsDetectionBeats(), which gives one chord label and strength per
  // inter-beat segment, then scores each beat by the chord change into it.
  // Returns the same shape as pickBestPhase() plus `available` and
  // `chordChangeEvents` ([{ t, chord }]).
  function _computeChordChangePhase(essentia, monoSamples, beatsArray, sampleRate) {
    var unavailable = { phase: 0, averagesByPhase: [0, 0, 0, 0], marginRatio: 0, available: false, chordChangeEvents: [] };
    if (beatsArray.length < 8) {
      return unavailable; // too few beats for a meaningful 4-phase grouping
    }
    var frameSize = 4096;
    var hopSize = 2048;
    var frames = essentia.FrameGenerator(monoSamples, frameSize, hopSize);
    var frameCount = frames.size();
    if (frameCount < 2) {
      return unavailable;
    }
    var pcpFrames = new essentia.module.VectorVectorFloat();
    for (var i = 0; i < frameCount; i++) {
      var frame = frames.get(i);
      var windowResult = essentia.Windowing(frame, true, frameSize, "hann", 0, true);
      var windowed = windowResult.frame;
      var spectrumResult = essentia.Spectrum(windowed, frameSize);
      var spectrum = spectrumResult.spectrum;
      var peaks = essentia.SpectralPeaks(spectrum);
      var hpcpResult = essentia.HPCP(peaks.frequencies, peaks.magnitudes);
      var hpcp = hpcpResult.hpcp;
      pcpFrames.push_back(hpcp);
      frame.delete();
      windowed.delete();
      spectrum.delete();
      peaks.frequencies.delete();
      peaks.magnitudes.delete();
      hpcp.delete();
    }
    frames.delete();

    var ticksVector = essentia.arrayToVector(beatsArray);
    var chordsResult = essentia.ChordsDetectionBeats(pcpFrames, ticksVector, "interbeat_median", hopSize, sampleRate);
    pcpFrames.delete();
    ticksVector.delete();
    var chordCount = chordsResult.chords.size();
    if (chordCount < 4) {
      chordsResult.chords.delete();
      chordsResult.strength.delete();
      return unavailable;
    }
    var chords = [];
    for (var c = 0; c < chordCount; c++) {
      chords.push(chordsResult.chords.get(c));
    }
    var strength = essentia.vectorToArray(chordsResult.strength);
    chordsResult.chords.delete();
    chordsResult.strength.delete();

    var changeScore = new Array(beatsArray.length);
    changeScore[0] = 0;
    // changeScore uses the raw chord labels; the smoothing below applies only
    // to the chord-change events used for marker placement.
    for (var b = 1; b < beatsArray.length; b++) {
      changeScore[b] = (b < chordCount && chords[b] !== chords[b - 1]) ? (strength[b] + strength[b - 1]) / 2 : 0;
    }
    var smoothedChords = _smoothChordSequence(chords);
    var chordChangeEvents = [];
    for (var b2 = 1; b2 < chordCount; b2++) {
      if (smoothedChords[b2] !== smoothedChords[b2 - 1]) {
        chordChangeEvents.push({ t: beatsArray[b2], chord: smoothedChords[b2] });
      }
    }

    var result = pickBestPhase(changeScore);
    result.available = true;
    result.chordChangeEvents = chordChangeEvents;
    return result;
  }
  // Picks the downbeat phase for a beat grid from two kinds of evidence.
  // Bass: the energy of band 0 of frequencyBands (20-150 Hz, kick/sub-bass)
  // per beat, which marks "one" more specifically than overall loudness
  // (hi-hats, vocals and synths can dominate that). Chords: where the chord
  // changes (_computeChordChangePhase). When chords are available the two
  // normalized profiles are summed. Returns the final phase with the
  // per-source phases, margins and chord-change events.
  function _pickPhaseForBeats(essentia, signalVector, monoSamples, beatsArray, sampleRate) {
    var phaseResult = { phase: 0, averagesByPhase: [0, 0, 0, 0], marginRatio: 0 };
    var bassEnergyArray = null;
    if (beatsArray.length >= 4) {
      var vecBeats = essentia.arrayToVector(beatsArray);
      var vecFrequencyBands = essentia.arrayToVector([20, 150, 400, 3200, 7000, 22000]);
      var loudnessResult = essentia.algorithms.BeatsLoudness(
        signalVector, 0.05, 0.1, vecBeats, vecFrequencyBands, sampleRate
      );
      if (loudnessResult && loudnessResult.loudness && loudnessResult.loudnessBandRatio) {
        var fullLoudnessArray = essentia.vectorToArray(loudnessResult.loudness);
        var bandRatios = loudnessResult.loudnessBandRatio;
        bassEnergyArray = [];
        for (var bi = 0; bi < bandRatios.size(); bi++) {
          var beatBandRatios = essentia.vectorToArray(bandRatios.get(bi));
          bassEnergyArray.push(fullLoudnessArray[bi] * beatBandRatios[0]);
        }
        phaseResult = pickBestPhase(bassEnergyArray);
      }
    }

    var chordPhaseResult = { phase: 0, averagesByPhase: [0, 0, 0, 0], marginRatio: 0, available: false };
    try {
      chordPhaseResult = _computeChordChangePhase(essentia, monoSamples, beatsArray, sampleRate);
    } catch (e) {
      chordPhaseResult = {
        phase: 0, averagesByPhase: [0, 0, 0, 0], marginRatio: 0, available: false,
        error: e && e.message ? e.message : String(e)
      };
    }
    var phaseAgreement = chordPhaseResult.available
      ? (phaseResult.phase === chordPhaseResult.phase ? "agree" : "disagree")
      : "unknown";

    var finalPhase = phaseResult.phase;
    var finalPhaseMarginRatio = phaseResult.marginRatio;
    var usedBlend = false;
    if (chordPhaseResult.available) {
      var bassNorm = _normalizePhaseAverages(phaseResult.averagesByPhase);
      var chordNorm = _normalizePhaseAverages(chordPhaseResult.averagesByPhase);
      var blendedAverages = [
        bassNorm[0] + chordNorm[0],
        bassNorm[1] + chordNorm[1],
        bassNorm[2] + chordNorm[2],
        bassNorm[3] + chordNorm[3]
      ];
      var blendedPick = _pickPhaseFromAverages(blendedAverages);
      finalPhase = blendedPick.phase;
      finalPhaseMarginRatio = blendedPick.marginRatio;
      usedBlend = true;
    }

    return {
      finalPhase: finalPhase,
      finalPhaseMarginRatio: finalPhaseMarginRatio,
      phaseSource: usedBlend ? "blend" : "bass",
      bassPhase: phaseResult.phase,
      bassPhaseMarginRatio: phaseResult.marginRatio,
      phaseAverages: phaseResult.averagesByPhase,
      chordPhaseAvailable: chordPhaseResult.available,
      chordPhase: chordPhaseResult.phase,
      chordPhaseAverages: chordPhaseResult.averagesByPhase,
      chordPhaseMarginRatio: chordPhaseResult.marginRatio,
      phaseAgreement: phaseAgreement,
      chordChangeEvents: chordPhaseResult.chordChangeEvents || [],
      bassEnergyArray: bassEnergyArray
    };
  }
  // Phase for a beat grid detected elsewhere (Beat This!): runs essentia for
  // the bass and chord signals but skips beat detection. The phase index
  // depends on the grid, so it is picked again for the new beats. Returns the
  // phase fields of _pickPhaseForBeats() without the arrays.
  function pickPhaseForExternalBeats(monoSamples, beatsArray) {
    return initEssentia().then(function (essentia) {
      var signalVector = essentia.arrayToVector(monoSamples);
      var sampleRate = global.BeatMarkerAudio.TARGET_SAMPLE_RATE;
      var result = _pickPhaseForBeats(essentia, signalVector, monoSamples, beatsArray, sampleRate);
      return {
        phase: result.finalPhase,
        phaseMarginRatio: result.finalPhaseMarginRatio,
        phaseSource: result.phaseSource,
        bassPhase: result.bassPhase,
        bassPhaseMarginRatio: result.bassPhaseMarginRatio,
        phaseAverages: result.phaseAverages,
        chordPhaseAvailable: result.chordPhaseAvailable,
        chordPhase: result.chordPhase,
        chordPhaseAverages: result.chordPhaseAverages,
        chordPhaseMarginRatio: result.chordPhaseMarginRatio,
        phaseAgreement: result.phaseAgreement,
        chordChangeEvents: result.chordChangeEvents
      };
    });
  }

  // monoSamples: Float32Array at 44100 Hz (from js/audio.js). tempoConstraint:
  // optional { minTempo, maxTempo } in BPM (defaults 40..208). Returns a
  // Promise of { cuesheet, beatsArray, confidence, phase, phaseAverages, ... }.
  // The cuesheet has "beats" (every detected beat) and "downbeats" (every 4th
  // beat from the detected phase) impulse tracks. Beat times are in file
  // seconds, shifted earlier by BEAT_LATENCY_SEC.essentia.
  function analyzeBeatsToCuesheet(monoSamples, audioPath, tempoConstraint) {
    return initEssentia().then(function (essentia) {
      var signalVector = essentia.arrayToVector(monoSamples);
      var sampleRate = global.BeatMarkerAudio.TARGET_SAMPLE_RATE;
      var minTempo = (tempoConstraint && typeof tempoConstraint.minTempo === "number") ? tempoConstraint.minTempo : 40;
      var maxTempo = (tempoConstraint && typeof tempoConstraint.maxTempo === "number") ? tempoConstraint.maxTempo : 208;
      // "multifeature" is the RhythmExtractor2013 method that reports a real
      // confidence.
      var rhythmResult = essentia.RhythmExtractor2013(signalVector, maxTempo, "multifeature", minTempo);
      if (!rhythmResult) {
        throw new Error("RhythmExtractor2013 returned nothing.");
      }
      var beatsVector = rhythmResult.ticks;
      if (!beatsVector) {
        var availableKeys = [];
        for (var k in rhythmResult) {
          if (rhythmResult.hasOwnProperty(k)) {
            availableKeys.push(k);
          }
        }
        throw new Error("RhythmExtractor2013 result has no 'ticks' field. Actual fields: " + availableKeys.join(", "));
      }
      var beatsArray = essentia.vectorToArray(beatsVector);
      var bpm = rhythmResult.bpm;
      var confidence = rhythmResult.confidence;
      // Downbeat phase: bass-band and chord evidence, see _pickPhaseForBeats().
      var phasePick = _pickPhaseForBeats(essentia, signalVector, monoSamples, beatsArray, sampleRate);
      var phaseResult = { phase: phasePick.bassPhase, averagesByPhase: phasePick.phaseAverages, marginRatio: phasePick.bassPhaseMarginRatio };
      var chordPhaseResult = {
        phase: phasePick.chordPhase, averagesByPhase: phasePick.chordPhaseAverages,
        marginRatio: phasePick.chordPhaseMarginRatio, available: phasePick.chordPhaseAvailable,
        chordChangeEvents: phasePick.chordChangeEvents
      };
      var phaseAgreement = phasePick.phaseAgreement;
      var finalPhase = phasePick.finalPhase;
      var finalPhaseMarginRatio = phasePick.finalPhaseMarginRatio;
      var usedBlend = phasePick.phaseSource === "blend";
      var bassEnergyArray = phasePick.bassEnergyArray;
      // lowContrast: bass-band (20-150 Hz) energy at the detected beats vs.
      // at the midpoints between them. A low ratio hints that the grid is
      // locked to half time (used for the half/double tempo hint). Computed
      // only for essentia's own beat grid, so it is not part of
      // _pickPhaseForBeats().
      var lowContrast = null;
      if (bassEnergyArray && beatsArray.length >= 3) {
        var midpoints = [];
        for (var mi = 0; mi < beatsArray.length - 1; mi++) {
          midpoints.push((beatsArray[mi] + beatsArray[mi + 1]) / 2);
        }
        var vecMidpoints = essentia.arrayToVector(midpoints);
        var vecFrequencyBands2 = essentia.arrayToVector([20, 150, 400, 3200, 7000, 22000]);
        var midLoudnessResult = essentia.algorithms.BeatsLoudness(
          signalVector, 0.05, 0.1, vecMidpoints, vecFrequencyBands2, sampleRate
        );
        vecMidpoints.delete();
        vecFrequencyBands2.delete();
        if (midLoudnessResult && midLoudnessResult.loudness && midLoudnessResult.loudnessBandRatio) {
          var midFullLoudnessArray = essentia.vectorToArray(midLoudnessResult.loudness);
          var midBandRatios = midLoudnessResult.loudnessBandRatio;
          var lowMidSum = 0;
          var midCount = midBandRatios.size();
          for (var mj = 0; mj < midCount; mj++) {
            var midRatiosVec = midBandRatios.get(mj);
            var midRatios = essentia.vectorToArray(midRatiosVec);
            lowMidSum += midFullLoudnessArray[mj] * midRatios[0];
            midRatiosVec.delete();
          }
          midLoudnessResult.loudness.delete();
          midLoudnessResult.loudnessBandRatio.delete();
          var lowMidAvg = midCount > 0 ? lowMidSum / midCount : 0;
          var lowBeatAvg = bassEnergyArray.length > 0
            ? bassEnergyArray.reduce(function (a, b) { return a + b; }, 0) / bassEnergyArray.length
            : 0;
          lowContrast = lowMidAvg > 0 ? (lowBeatAvg / lowMidAvg) : null;
        }
      }
      beatsArray = shiftTimesEarlier(beatsArray, BEAT_LATENCY_SEC.essentia);
      var chordChangeEvents = (chordPhaseResult.chordChangeEvents || []).map(function (e) {
        return { t: Math.max(0, e.t - BEAT_LATENCY_SEC.essentia), chord: e.chord };
      });

      var events = [];
      for (var i = 0; i < beatsArray.length; i++) {
        events.push({ t: beatsArray[i], conf: confidence, label: null });
      }

      var downbeatsTrack = global.BeatMarkerCuesheet.buildDownbeatsTrack(
        beatsArray, confidence, finalPhase
      );

      var cuesheet = {
        version: "1.0",
        source: "essentia",
        audio: {
          path: audioPath,
          sampleRate: sampleRate,
          durationSec: monoSamples.length / sampleRate
        },
        bpm: bpm,
        tracks: [
          { id: "beats", type: "impulse", events: events },
          downbeatsTrack
        ]
      };

      return {
        cuesheet: cuesheet,
        beatsArray: beatsArray,
        confidence: confidence,
        phase: finalPhase,
        phaseAverages: phaseResult.averagesByPhase,
        phaseMarginRatio: finalPhaseMarginRatio,
        phaseSource: usedBlend ? "blend" : "bass",
        bassPhase: phaseResult.phase,
        bassPhaseMarginRatio: phaseResult.marginRatio,
        chordPhaseAvailable: chordPhaseResult.available,
        chordPhase: chordPhaseResult.phase,
        chordPhaseAverages: chordPhaseResult.averagesByPhase,
        chordPhaseMarginRatio: chordPhaseResult.marginRatio,
        phaseAgreement: phaseAgreement,
        chordChangeEvents: chordChangeEvents,
        lowContrast: lowContrast,
        tempoChangeRegions: detectLocalTempoChange(beatsArray)
      };
    });
  }
  // Local tempo changes. Works on any beat grid (essentia's or Beat This!'s)
  // and needs no extra essentia or model calls. A rolling median interval is
  // compared with the global median; a run of beats that deviates by more
  // than the threshold, lasts at least TEMPO_CHANGE_MIN_RUN_SEC and is steady
  // inside (coefficient of variation <= TEMPO_CHANGE_MAX_INTERNAL_CV) counts
  // as a region. Returns [] if none, else regions (longest first):
  // {startSec, endSec, localBpm, globalBpm, devPct}.
  var TEMPO_CHANGE_WINDOW_BEATS = 8;
  var TEMPO_CHANGE_MIN_RUN_SEC = 15.0;
  var TEMPO_CHANGE_DEVIATION_THRESHOLD = 0.15;
  var TEMPO_CHANGE_MAX_INTERNAL_CV = 0.06;

  function _median(arr) {
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function detectLocalTempoChange(beatsArray) {
    var minBeats = TEMPO_CHANGE_WINDOW_BEATS * 3;
    if (!beatsArray || beatsArray.length < minBeats) {
      return [];
    }
    var ibis = [];
    for (var i = 1; i < beatsArray.length; i++) {
      ibis.push(beatsArray[i] - beatsArray[i - 1]);
    }
    var globalMedianIbi = _median(ibis);
    if (!globalMedianIbi || globalMedianIbi <= 0) {
      return [];
    }
    var globalBpm = 60 / globalMedianIbi;
    // Rolling median interval, one per beat interval, so a single-beat
    // tracking blip does not look like a sustained region.
    var localIbi = new Array(ibis.length);
    for (var j = 0; j < ibis.length; j++) {
      var start = Math.max(0, j - Math.floor(TEMPO_CHANGE_WINDOW_BEATS / 2));
      var end = Math.min(ibis.length, start + TEMPO_CHANGE_WINDOW_BEATS);
      localIbi[j] = _median(ibis.slice(start, end));
    }

    var regions = [];
    var idx = 0;
    while (idx < localIbi.length) {
      var dev = (localIbi[idx] - globalMedianIbi) / globalMedianIbi;
      if (Math.abs(dev) > TEMPO_CHANGE_DEVIATION_THRESHOLD) {
        var k = idx;
        while (k < localIbi.length && Math.abs((localIbi[k] - globalMedianIbi) / globalMedianIbi) > TEMPO_CHANGE_DEVIATION_THRESHOLD) {
          k++;
        }
        var startSec = beatsArray[idx];
        var endSec = beatsArray[k];
        var duration = endSec - startSec;
        var regionIbis = ibis.slice(idx, k);
        var regionMean = regionIbis.reduce(function (a, b) { return a + b; }, 0) / regionIbis.length;
        var variance = regionIbis.reduce(function (a, b) { return a + (b - regionMean) * (b - regionMean); }, 0) / regionIbis.length;
        var cv = regionMean > 0 ? Math.sqrt(variance) / regionMean : 1;
        if (duration >= TEMPO_CHANGE_MIN_RUN_SEC && cv <= TEMPO_CHANGE_MAX_INTERNAL_CV) {
          var localBpm = 60 / regionMean;
          regions.push({
            startSec: startSec,
            endSec: endSec,
            localBpm: localBpm,
            globalBpm: globalBpm,
            devPct: (localBpm - globalBpm) / globalBpm * 100
          });
        }
        idx = k;
      } else {
        idx++;
      }
    }
    regions.sort(function (a, b) { return (b.endSec - b.startSec) - (a.endSec - a.startSec); });
    return regions;
  }
  // PROFILE SETS. Key detection is independent of analyzeBeatsToCuesheet():
  // it works on any audio (music or sound effects), not only clips with a
  // beat grid, and a sound effect with no clear tonality simply gets a low
  // `strength`. Each material has its own list of KeyExtractor profiles that
  // vote, and its own framing (frame and hop size). For music, S-KEY's
  // opinion is added on top of this vote (js/key-combine.js).
  var KEY_PROFILE_SETS = {
    music: ["edmm", "diatonic", "edma"],
    sfx: ["bgate"]
  };
  var KEY_FRAMING = {
    music: { frameSize: undefined, hopSize: undefined },
    sfx: { frameSize: 8192, hopSize: 2048 }
  };
  // Under this many seconds the panel says the key is less certain. This does
  // not change the answer, only how the panel presents it.
  var KEY_SHORT_CLIP_SECONDS = 10;
  // Frees every WASM-backed field of an algorithm result - anything with a
  // delete() is heap the JS garbage collector cannot see. TonalExtractor
  // returns a dozen such fields (hpcp alone is thousands of frames).
  function _freeWasmResult(r) {
    if (!r) {
      return;
    }
    for (var k in r) {
      var v = r[k];
      if (v && typeof v.delete === "function") {
        try { v.delete(); } catch (e) { /* already freed */ }
      }
    }
  }

  function _runKeyExtractor(essentia, signalVector, profileType, framing) {
    var keyResult = essentia.KeyExtractor(
      signalVector, // audio
      undefined, // averageDetuningCorrection (default true)
      framing ? framing.frameSize : undefined, // frameSize (default 4096) - see KEY_FRAMING
      framing ? framing.hopSize : undefined, // hopSize (default 4096)
      undefined, // hpcpSize (default 12)
      undefined, // maxFrequency (default 3500)
      undefined, // maximumSpectralPeaks (default 60)
      undefined, // minFrequency (default 25)
      undefined, // pcpThreshold (default 0.2)
      profileType // profileType (library default is 'bgate')
    );
    if (!keyResult) {
      throw new Error("KeyExtractor returned nothing (profileType='" + profileType + "').");
    }
    return {
      profile: profileType,
      key: keyResult.key,
      scale: keyResult.scale,
      strength: keyResult.strength,
      camelot: global.BeatMarkerCamelot.toCamelotCode(keyResult.key, keyResult.scale)
    };
  }
  // A second opinion from a different mechanism: TonalExtractor derives a key
  // from the chord progression it detects, rather than from matching an
  // averaged chroma against a template.
  function _chordWitness(essentia, signalVector) {
    var r = null;
    try {
      r = essentia.TonalExtractor(signalVector);
      return {
        camelot: global.BeatMarkerCamelot.toCamelotCode(r.chords_key, r.chords_scale),
        key: r.chords_key,
        scale: r.chords_scale
      };
    } catch (e) {
      return null;
    } finally {
      _freeWasmResult(r);
    }
  }
  // Counts Camelot votes across the profile results; the first result with the
  // top count wins ties. Returns { winner, counts, topVotes }.
  function _tallyKeyVotes(results) {
    var counts = {};
    for (var i = 0; i < results.length; i++) {
      var c = results[i].camelot;
      if (c) {
        counts[c] = (counts[c] || 0) + 1;
      }
    }
    var top = 0;
    for (var k in counts) {
      if (counts[k] > top) {
        top = counts[k];
      }
    }
    var winner = null;
    for (var j = 0; j < results.length; j++) {
      if (results[j].camelot && counts[results[j].camelot] === top) {
        winner = results[j].camelot;
        break;
      }
    }
    return { winner: winner, counts: counts, topVotes: top };
  }
  // The most-voted code that is neither the winner nor compatible with it, or
  // null.
  function _pickKeyRunnerUp(results, winner) {
    var counts = _tallyKeyVotes(results).counts;
    var best = null;
    var bestVotes = 0;
    for (var code in counts) {
      if (code === winner || global.BeatMarkerCamelot.areCompatible(code, winner)) {
        continue;
      }
      if (counts[code] > bestVotes) {
        bestVotes = counts[code];
        best = code;
      }
    }
    return best ? { camelot: best, votes: bestVotes, source: "profiles" } : null;
  }
  // "agreed" (all profiles name the winner), "compatible" (all are the winner
  // or compatible with it), "split", or "unknown" (no profile gave a key).
  function _classifyProfileAgreement(results, winner) {
    var seen = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i].camelot) {
        seen.push(results[i].camelot);
      }
    }
    if (!seen.length) {
      return "unknown";
    }
    var allSame = true;
    var allCompatible = true;
    for (var j = 0; j < seen.length; j++) {
      if (seen[j] !== winner) {
        allSame = false;
        if (!global.BeatMarkerCamelot.areCompatible(seen[j], winner)) {
          allCompatible = false;
        }
      }
    }
    return allSame ? "agreed" : (allCompatible ? "compatible" : "split");
  }
  // material: "music" (default) or "sfx", the Key tab's switch.
  // options.skipWitness: leave out the chord-progression witness (a whole
  // TonalExtractor pass); the Library scan shows only the key, never the
  // "chords agree" line, and the witness is most of the analysis time per file.
  function detectKey(monoSamples, material, options) {
    var setName = (material === "sfx") ? "sfx" : "music";
    var profiles = KEY_PROFILE_SETS[setName];
    var sampleRate = (global.BeatMarkerAudio && global.BeatMarkerAudio.TARGET_SAMPLE_RATE) || 44100;
    var durationSec = monoSamples ? (monoSamples.length / sampleRate) : 0;
    return initEssentia().then(function (essentia) {
      var signalVector = essentia.arrayToVector(monoSamples);
      var results = [];
      var witness = null;
      try {
        for (var i = 0; i < profiles.length; i++) {
          results.push(_runKeyExtractor(essentia, signalVector, profiles[i], KEY_FRAMING[setName]));
        }
        witness = (options && options.skipWitness) ? null : _chordWitness(essentia, signalVector);
      } finally {
        if (signalVector && typeof signalVector.delete === "function") {
          signalVector.delete();
        }
      }

      var voted = _tallyKeyVotes(results);
      var winner = voted.winner;
      var primary = null;
      for (var j = 0; j < results.length; j++) {
        if (results[j].camelot === winner) {
          primary = results[j];
          break;
        }
      }
      var profileAgreement = _classifyProfileAgreement(results, winner);
      var corroborated = !!(witness && witness.camelot && winner && witness.camelot === winner);
      return {
        material: setName,
        key: primary ? primary.key : null,
        scale: primary ? primary.scale : null,
        strength: primary ? primary.strength : null,
        camelot: winner,
        corroborated: corroborated,
        witnessAvailable: !!witness,
        chordCamelot: witness ? witness.camelot : null,
        profileAgreement: profileAgreement,
        durationSec: durationSec,
        shortClip: durationSec > 0 && durationSec < KEY_SHORT_CLIP_SECONDS,
        // A losing profile only matters when there was no witness at all.
        runnerUp: corroborated ? null
          : (witness && witness.camelot && witness.camelot !== winner
            ? { camelot: witness.camelot, source: "chords" }
            : (profileAgreement === "split" ? _pickKeyRunnerUp(results, winner) : null)),
        votes: voted.topVotes,
        totalProfiles: profiles.length,
        perProfile: results
      };
    });
  }
  // Onset detection (essentia OnsetRate). Onsets are finer-grained than
  // downbeats (kick/snare/hi-hat level, not bar level), so they are a
  // separate result: the onset rate feeds the half-time hint, and the
  // downbeat workflow does not use them. OnsetRate is only valid at 44100 Hz, which
  // js/audio.js's resample step guarantees.
  function detectOnsets(monoSamples) {
    return initEssentia().then(function (essentia) {
      var signalVector = essentia.arrayToVector(monoSamples);
      var onsetResult = essentia.OnsetRate(signalVector);
      if (!onsetResult || !onsetResult.onsets) {
        throw new Error("OnsetRate returned nothing usable.");
      }
      var onsetsArray = essentia.vectorToArray(onsetResult.onsets);
      return { onsetsArray: onsetsArray, onsetRate: onsetResult.onsetRate };
    });
  }
  // "Is there a pitch at all?" - for sound effects. A key is a property of
  // pitched sound; footsteps, rain or a gunshot have none, yet the key vote
  // always names one. Two per-frame medians decide (thresholds live in
  // js/sound-library.js hasPitch()): crest = max / mean of the frame's 12-bin
  // HPCP (one pitch class standing out means a note); flatness = spectral
  // flatness (near zero for any peaky spectrum, including dense drones and
  // chords).
  var PITCH_FRAME = 4096;
  var PITCH_MAX_FRAMES = 48;
  function _pitchFeatures(essentia, monoSamples) {
    var N = PITCH_FRAME;
    var source = monoSamples;
    if (source.length < N) {
      source = new Float32Array(N);
      source.set(monoSamples);
    }
    var count = Math.floor(source.length / N);
    var energies = new Float64Array(count);
    var loudest = 0;
    for (var i = 0; i < count; i++) {
      var e = 0;
      for (var j = i * N, end = j + N; j < end; j++) {
        e += source[j] * source[j];
      }
      energies[i] = e;
      if (e > loudest) {
        loudest = e;
      }
    }
    var active = [];
    for (var a = 0; a < count; a++) {
      if (energies[a] >= loudest * 1e-3 && energies[a] >= 1e-9) {
        active.push(a);
      }
    }
    if (active.length === 0) {
      return null;
    }
    var picked = active;
    if (active.length > PITCH_MAX_FRAMES) {
      picked = [];
      for (var q = 0; q < PITCH_MAX_FRAMES; q++) {
        picked.push(active[Math.floor(q * active.length / PITCH_MAX_FRAMES)]);
      }
    }
    var crests = [];
    var flatnesses = [];
    for (var p = 0; p < picked.length; p++) {
      var start = picked[p] * N;
      var frame = essentia.arrayToVector(source.subarray(start, start + N));
      var windowed = null, spectrum = null, peaks = null, hpcp = null;
      try {
        windowed = essentia.Windowing(frame, true, N, "hann", 0, true).frame;
        spectrum = essentia.Spectrum(windowed, N).spectrum;
        flatnesses.push(essentia.Flatness(spectrum).flatness);
        peaks = essentia.SpectralPeaks(spectrum);
        hpcp = essentia.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
        var bins = essentia.vectorToArray(hpcp);
        var sum = 0, max = 0;
        for (var b = 0; b < bins.length; b++) {
          sum += bins[b];
          if (bins[b] > max) {
            max = bins[b];
          }
        }
        crests.push(sum > 0 ? max / (sum / bins.length) : 0);
      } finally {
        // WASM heap objects are not garbage collected (see
        // _computeChordChangePhase).
        frame.delete();
        if (windowed) { windowed.delete(); }
        if (spectrum) { spectrum.delete(); }
        if (peaks) { peaks.frequencies.delete(); peaks.magnitudes.delete(); }
        if (hpcp) { hpcp.delete(); }
      }
    }
    function median(values) {
      var sorted = values.slice().sort(function (x, y) { return x - y; });
      return sorted[sorted.length >> 1];
    }
    return { crest: median(crests), flatness: median(flatnesses) };
  }
  // The chord-progression key alone (the witness detectKey() leaves out with
  // skipWitness), for the Library scan's 2-of-3 rule below.
  function _chordKeyOnly(monoSamples) {
    return initEssentia().then(function (essentia) {
      var signalVector = essentia.arrayToVector(monoSamples);
      try {
        var witness = _chordWitness(essentia, signalVector);
        return witness ? witness.camelot : null;
      } finally {
        signalVector.delete();
      }
    });
  }
  // Library scan: tempo and key of one file, fast. Only the tempo step of
  // analyzeBeatsToCuesheet() (same RhythmExtractor2013 "multifeature" call,
  // so the BPM agrees with Analyze) - no beat phases, chord cues or Beat
  // This!, which only matter for markers - and the same key vote as Detect
  // key. wantBpm false (a one-shot sound effect too short to have a tempo)
  // skips the tempo. bpmConfidence is RhythmExtractor2013's own confidence;
  // low values mean the tempo is doubtful.
  // Music also gets Detect key's third opinion (js/key-combine.js), when the
  // worker passes options.skey (samples -> Promise of {key, scale} or null;
  // worker/skey-core.js). S-KEY failing leaves the vote, as in Detect key.
  // SFX also get pitchCrest and pitchFlatness (_pitchFeatures above), so the
  // Library can hide the key of a sound with no pitch.
  function analyzeLibraryItem(monoSamples, material, wantBpm, options) {
    var sampleRate = (global.BeatMarkerAudio && global.BeatMarkerAudio.TARGET_SAMPLE_RATE) || 44100;
    return initEssentia().then(function (essentia) {
      var bpm = null;
      var bpmConfidence = null;
      if (wantBpm) {
        var signalVector = essentia.arrayToVector(monoSamples);
        var rhythm = null;
        try {
          rhythm = essentia.RhythmExtractor2013(signalVector, 208, "multifeature", 40);
          bpm = rhythm && rhythm.bpm > 0 ? rhythm.bpm : null;
          bpmConfidence = rhythm ? rhythm.confidence : null;
        } finally {
          _freeWasmResult(rhythm);
          signalVector.delete();
        }
      }
      return detectKey(monoSamples, material, { skipWitness: true }).then(function (keyResult) {
        var out = {
          durationSec: monoSamples.length / sampleRate,
          bpm: bpm,
          bpmConfidence: bpmConfidence,
          key: keyResult.key,
          scale: keyResult.scale,
          camelot: keyResult.camelot,
          strength: keyResult.strength
        };
        if (material === "sfx") {
          // Stored as numbers; the decision is made in js/sound-library.js's
          // hasPitch(), so the thresholds can change without a rescan. Silence
          // has no pitch (crest 0, flatness 1); a failure leaves both null,
          // which leaves the key shown.
          try {
            var pitch = _pitchFeatures(essentia, monoSamples) || { crest: 0, flatness: 1 };
            out.pitchCrest = Math.round(pitch.crest * 1000) / 1000;
            out.pitchFlatness = Math.round(pitch.flatness * 1e5) / 1e5;
          } catch (e) {
            out.pitchCrest = null;
            out.pitchFlatness = null;
          }
          return out;
        }
        if (!options || typeof options.skey !== "function" || !out.camelot) {
          return out;
        }
        return Promise.resolve()
          .then(function () { return options.skey(monoSamples); })
          .then(function (skey) {
            var skeyCamelot = skey ? global.BeatMarkerCamelot.toCamelotCode(skey.key, skey.scale) : null;
            if (!skeyCamelot) {
              return out;
            }
            if (skeyCamelot === out.camelot) {
              out.keyAgreement = "two"; // vote and S-KEY agree
              return out;
            }
            return _chordKeyOnly(monoSamples).then(function (chordCamelot) {
              var decision = global.BeatMarkerKeyCombine.combineMusicKey(out.camelot, chordCamelot, skeyCamelot);
              out.keyAgreement = decision.agreement === "none" ? "none" : "two";
              if (decision.camelot !== out.camelot) {
                out.camelot = decision.camelot;
                out.key = skey.key;
                out.scale = skey.scale;
                out.strength = null; // KeyExtractor's strength described the vote, not this answer
              }
              return out;
            });
          })
          .catch(function (err) {
            console.error("Library scan: S-KEY / chord key unavailable, the vote stands: " + (err && err.message ? err.message : err));
            return out;
          });
      });
    });
  }

  global.BeatMarkerAnalyze = {
    analyzeLibraryItem: analyzeLibraryItem,
    initEssentia: initEssentia,
    pickBestPhase: pickBestPhase,
    analyzeBeatsToCuesheet: analyzeBeatsToCuesheet,
    pickPhaseForExternalBeats: pickPhaseForExternalBeats,
    detectKey: detectKey,
    KEY_PROFILE_SETS: KEY_PROFILE_SETS,
    KEY_FRAMING: KEY_FRAMING,
    KEY_SHORT_CLIP_SECONDS: KEY_SHORT_CLIP_SECONDS,
    detectOnsets: detectOnsets,
    detectLocalTempoChange: detectLocalTempoChange,
    BEAT_LATENCY_SEC: BEAT_LATENCY_SEC,
    BEAT_TIMING_VERSION: BEAT_TIMING_VERSION,
    shiftTimesEarlier: shiftTimesEarlier
  };
})(window);
