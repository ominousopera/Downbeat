#!/usr/bin/env node
// The essentia.js worker. js/bridge.js spawns it as a separate OS process
// (window.cep_node's child_process) for every Analyze, Detect key, onset,
// phase, tempo-change and Library scan call. It is a separate process for
// two reasons: essentia.js is AGPL-3.0, and a subprocess is not linked into
// the panel's own code; and a crash or hang can be handled from outside with
// a real OS-level timeout that kills the process, which is impossible for
// code living in the same thread as the hang.
// Usage: analyze-worker.js <beats|key|onsets|phase|tempoChange|library>
//   <rawSamplesFile> [audioPath] [tempoConstraintJson] [beatsArrayJson]
//   [keyMaterial]
// rawSamplesFile: a file of raw Float32Array bytes (native byte order; it is
// written and read on the same machine) of mono audio at TARGET_SAMPLE_RATE
// (44100 Hz), as js/audio.js's decodeToMono44100() produces. In "library"
// mode it is a JSON manifest of items instead, and each item answers on its
// own: one bad file never fails the batch. keyMaterial: "music" (default) or
// "sfx", "key" mode only; it picks the profile set (js/analyze.js's
// KEY_PROFILE_SETS).
// Always prints exactly one line of JSON to stdout: {ok, error, data}, the
// same contract as every jsx/host.jsx function.
"use strict";

const pathMod = require("path");
const fsMod = require("fs");
// The vendored essentia WASM glue writes its own diagnostic lines. They are
// redirected to stderr before essentia loads, so stdout carries nothing but
// the final JSON result. stderr is still captured and surfaced on failure
// (see runAnalyzeWorker() in js/bridge.js).
console.log = console.error;
console.info = console.error;
console.warn = console.error;
// console.debug is bound to the original console.log at Node startup, so it
// has to be redirected separately.
console.debug = console.error;
const { initNodeEssentiaEnvironment, TARGET_SAMPLE_RATE } = require("./essentia-node-harness.js");
const wavExcerpt = require("./wav-excerpt.js");
const skeyCore = require("./skey-core.js");

function readSamplesFile(filePath) {
  const buf = fsMod.readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(arrayBuffer);
}
function typedArrayReplacer(key, value) {
  if (ArrayBuffer.isView(value) && typeof value.length === "number") {
    return Array.from(value);
  }
  return value;
}

async function main() {
  const [, , mode, samplesFile, audioPath, tempoConstraintJson, beatsArrayJson, keyMaterial] = process.argv;
  const result = { ok: false, error: null, data: null };

  try {
    // "tempoChange" is the one mode that needs no audio samples at all:
    // detectLocalTempoChange() is pure arithmetic on an already-detected
    // beatsArray, see below.
    if (!mode || (mode !== "tempoChange" && !samplesFile)) {
      throw new Error("Usage: analyze-worker.js <beats|key|onsets|phase|tempoChange|library> <rawSamplesFile> [audioPath] [tempoConstraintJson] [beatsArrayJson] [keyMaterial]");
    }
    if (["beats", "key", "onsets", "phase", "tempoChange", "library"].indexOf(mode) === -1) {
      throw new Error("Unknown mode '" + mode + "' - expected beats, key, onsets, phase, tempoChange, or library.");
    }

    const baseDir = pathMod.join(__dirname, "..");
    initNodeEssentiaEnvironment(baseDir);

    const samples = (mode === "tempoChange" || mode === "library") ? null : readSamplesFile(samplesFile);
    // Optional {minTempo, maxTempo} override for the half/double buttons'
    // constrained re-analysis (see js/analyze.js's analyzeBeatsToCuesheet()),
    // passed as JSON over argv.
    let tempoConstraint = null;
    if (tempoConstraintJson) {
      try {
        tempoConstraint = JSON.parse(tempoConstraintJson);
      } catch (e) {
        throw new Error("Could not parse tempoConstraintJson argument: " + e.message);
      }
    }

    if (mode === "library") {
      require(pathMod.join(baseDir, "js", "sound-library.js")); // excerptRange() for WAV items
      const manifest = JSON.parse(fsMod.readFileSync(samplesFile, "utf8"));
      const results = [];
      for (const item of manifest.items || []) {
        try {
          let itemSamples, wantBpm = !!item.bpm, durationSec = item.durationSec;
          if (item.wav) {
            // WAV: read here, only the excerpt's bytes (worker/wav-excerpt.js),
            // so the panel never loads these files. The excerpt rule is the
            // same as the panel's decode path (js/sound-library.js
            // excerptRange).
            let info;
            try {
              info = wavExcerpt.probe(item.wav);
            } catch (probeErr) {
              if (probeErr instanceof wavExcerpt.UnsupportedWav) {
                results.push({ ok: false, fallback: true, error: probeErr.message }); // the panel decodes it instead
                continue;
              }
              throw probeErr;
            }
            durationSec = info.durationSec;
            const range = global.BeatMarkerSoundLibrary.excerptRange(durationSec, item.material === "sfx" ? "sfx" : "music");
            wantBpm = range.wantBpm;
            itemSamples = wavExcerpt.readExcerpt(item.wav, info, range.startSec, range.lengthSec);
            if (itemSamples.length === 0) {
              throw new Error("the file has no audio");
            }
          } else {
            itemSamples = readSamplesFile(item.raw);
          }
          // Music keys get S-KEY as a third opinion (js/analyze.js's
          // analyzeLibraryItem); one ONNX session serves the whole batch.
          const libOptions = item.material === "sfx" ? null
            : { skey: function (s) { return skeyCore.detectFrom44100(baseDir, s); } };
          const r = await global.BeatMarkerAnalyze.analyzeLibraryItem(itemSamples, item.material === "sfx" ? "sfx" : "music", wantBpm, libOptions);
          r.ok = true;
          if (durationSec) {
            r.durationSec = durationSec; // the whole file's length, not the analyzed excerpt's
          }
          results.push(r);
        } catch (e) {
          results.push({ ok: false, error: e && e.message ? e.message : String(e) });
        }
      }
      result.ok = true;
      result.data = { results: results };
    } else if (mode === "beats") {
      const analysis = await global.BeatMarkerAnalyze.analyzeBeatsToCuesheet(samples, audioPath || null, tempoConstraint);
      result.ok = true;
      result.data = analysis;
    } else if (mode === "key") {
      const keyResult = await global.BeatMarkerAnalyze.detectKey(samples, keyMaterial === "sfx" ? "sfx" : "music");
      result.ok = true;
      result.data = keyResult;
    } else if (mode === "onsets") {
      const onsetResult = await global.BeatMarkerAnalyze.detectOnsets(samples);
      result.ok = true;
      result.data = onsetResult;
    } else if (mode === "phase") {
      // Re-picks the downbeat phase for an externally provided beatsArray
      // (the Beat This! grid; see js/analyze.js's pickPhaseForExternalBeats()).
      // The phase index depends on the beat grid, so it cannot be reused when
      // the beats differ from essentia's own detection. `samples` must be the
      // 44100 Hz samples that essentia's bass and chord cues expect, not
      // Beat This!'s 22050 Hz input.
      if (!beatsArrayJson) {
        throw new Error("phase mode requires a beatsArrayJson argument.");
      }
      let beatsArray;
      try {
        beatsArray = JSON.parse(beatsArrayJson);
      } catch (e) {
        throw new Error("Could not parse beatsArrayJson argument: " + e.message);
      }
      const phaseResult = await global.BeatMarkerAnalyze.pickPhaseForExternalBeats(samples, beatsArray);
      // Also computed here, since js/analyze.js is loaded only inside this
      // worker. detectLocalTempoChange() is pure arithmetic on beatsArray, so
      // it adds one field to a response that already had beatsArray in hand.
      phaseResult.tempoChangeRegions = global.BeatMarkerAnalyze.detectLocalTempoChange(beatsArray);
      result.ok = true;
      result.data = phaseResult;
    } else if (mode === "tempoChange") {
      if (!beatsArrayJson) {
        throw new Error("tempoChange mode requires a beatsArrayJson argument.");
      }
      let tcBeatsArray;
      try {
        tcBeatsArray = JSON.parse(beatsArrayJson);
      } catch (e) {
        throw new Error("Could not parse beatsArrayJson argument: " + e.message);
      }
      result.ok = true;
      result.data = { tempoChangeRegions: global.BeatMarkerAnalyze.detectLocalTempoChange(tcBeatsArray) };
    }
  } catch (e) {
    result.ok = false;
    result.error = (e && e.message) ? e.message : String(e);
  }
  // Wrapped separately from the try/catch above: that one covers the analysis
  // itself, this one covers JSON.stringify() failing on the result (e.g. a
  // circular reference), and still honors the "always exactly one JSON line
  // on stdout" contract instead of crashing with no output.
  try {
    process.stdout.write(JSON.stringify(result, typedArrayReplacer));
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
  // Defense in depth: main()'s own try/catch should handle every real
  // failure, but an unhandled rejection here would crash the process with no
  // stdout output.
  process.stdout.write(JSON.stringify({
    ok: false,
    error: "Unhandled worker error: " + (e && e.message ? e.message : String(e)),
    data: null
  }));
});
