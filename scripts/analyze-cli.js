#!/usr/bin/env node
// Standalone diagnostic CLI: runs the plugin's real analysis code
// (js/analyze.js, js/cuesheet.js, js/camelot.js, unmodified) against real
// audio files, entirely outside Premiere/CEP.
// Developer tooling only: index.html does not load it and build-zxp.sh does
// not stage it.
// Usage: node scripts/analyze-cli.js <file-or-folder> [--json]
//   e.g. node scripts/analyze-cli.js "path/to/your/music"
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { initNodeEssentiaEnvironment, TARGET_SAMPLE_RATE } = require("../worker/essentia-node-harness.js");
// ffmpeg stands in for js/audio.js's decodeToMono44100() (which needs Web
// Audio, browser-only); same target format: mono Float32 at 44100 Hz.
function decodeMonoWithFfmpeg(filePath) {
  const raw = execFileSync(
    "ffmpeg",
    ["-i", filePath, "-f", "f32le", "-ar", String(TARGET_SAMPLE_RATE), "-ac", "1", "-v", "error", "-"],
    { maxBuffer: 400 * 1024 * 1024 }
  );
  const arrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return new Float32Array(arrayBuffer);
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) * (x - m))));
}

async function analyzeOneFile(filePath) {
  const t0 = Date.now();
  const samples = decodeMonoWithFfmpeg(filePath);
  const decodeMs = Date.now() - t0;

  const t1 = Date.now();
  const beatResult = await global.BeatMarkerAnalyze.analyzeBeatsToCuesheet(samples, filePath);
  const beatMs = Date.now() - t1;

  const t2 = Date.now();
  const keyResult = await global.BeatMarkerAnalyze.detectKey(samples);
  const keyMs = Date.now() - t2;

  const downbeatTimes = beatResult.cuesheet.tracks[1].events.map((e) => e.t);
  const spacings = [];
  for (let i = 1; i < downbeatTimes.length; i++) {
    spacings.push(downbeatTimes[i] - downbeatTimes[i - 1]);
  }
  const spacingMean = spacings.length ? mean(spacings) : null;
  const spacingStdev = spacings.length ? stdev(spacings) : null;

  const phaseAvgs = beatResult.phaseAverages;
  // The same value js/analyze.js's pickBestPhase() returns as
  // phaseMarginRatio, reused here rather than recomputed so there is one
  // formula.
  const phaseMargin = beatResult.phaseMarginRatio;

  return {
    file: path.basename(filePath),
    durationSec: samples.length / TARGET_SAMPLE_RATE,
    decodeMs,
    beatMs,
    keyMs,
    bpm: beatResult.cuesheet.bpm,
    beatCount: beatResult.beatsArray.length,
    confidence: beatResult.confidence,
    phase: beatResult.phase,
    phaseAverages: phaseAvgs,
    phaseMargin,
    chordPhaseAvailable: beatResult.chordPhaseAvailable,
    chordPhase: beatResult.chordPhase,
    chordPhaseMargin: beatResult.chordPhaseMarginRatio,
    phaseAgreement: beatResult.phaseAgreement,
    downbeatCount: downbeatTimes.length,
    firstDownbeats: downbeatTimes.slice(0, 8),
    downbeatSpacingMean: spacingMean,
    downbeatSpacingStdev: spacingStdev,
    tempoChangeRegions: beatResult.tempoChangeRegions || [],
    key: keyResult.key,
    scale: keyResult.scale,
    camelot: keyResult.camelot,
    strength: keyResult.strength,
    keyMaterial: keyResult.material,
    keyVotes: keyResult.votes + "/" + keyResult.totalProfiles,
    keyPerProfile: keyResult.perProfile.map((p) => p.profile + "=" + p.camelot).join(", "),
    chordCamelot: keyResult.chordCamelot,
    keyCorroborated: keyResult.corroborated,
  };
}

function fmt(n, digits) {
  return typeof n === "number" ? n.toFixed(digits === undefined ? 3 : digits) : String(n);
}

function printReport(r) {
  console.log("");
  console.log("=== " + r.file + " ===");
  console.log(`  duration: ${fmt(r.durationSec, 1)}s   decode: ${r.decodeMs}ms   beats: ${r.beatMs}ms   key: ${r.keyMs}ms`);
  console.log(`  bpm: ${fmt(r.bpm, 2)}   beats detected: ${r.beatCount}   confidence: ${fmt(r.confidence, 4)}`);
  console.log(`  phase averages (loudness per candidate "one"): [${r.phaseAverages.map((v) => fmt(v, 4)).join(", ")}]`);
  console.log(`  phase picked: ${r.phase}   margin over runner-up: ${r.phaseMargin === null ? "n/a" : fmt(r.phaseMargin * 100, 1) + "%"}`);
  console.log(`  chord-phase (2nd opinion): ${r.chordPhaseAvailable ? r.chordPhase + "  margin: " + fmt(r.chordPhaseMargin * 100, 1) + "%" : "n/a"}   agreement: ${r.phaseAgreement}`);
  console.log(`  downbeats: ${r.downbeatCount}   first 8: [${r.firstDownbeats.map((v) => fmt(v, 3)).join(", ")}]`);
  console.log(`  downbeat spacing: mean ${fmt(r.downbeatSpacingMean, 3)}s   stdev ${fmt(r.downbeatSpacingStdev, 4)}s (should be ~4x the beat interval, low stdev = steady grid)`);
  console.log(`  key: ${r.key} ${r.scale} -> Camelot ${r.camelot}   strength: ${fmt(r.strength, 4)}`);
  console.log(`  ${r.keyMaterial} vote ${r.keyVotes}: ${r.keyPerProfile}`);
  console.log(`  chord witness: ${r.chordCamelot}   ${r.keyCorroborated ? "agrees" : "disagrees"}`);
}

function printSummaryTable(results) {
  console.log("");
  console.log("=== SUMMARY ===");
  console.log(
    "file".padEnd(46) + "bpm".padEnd(9) + "phase".padEnd(7) + "margin".padEnd(9) +
    "spacing±".padEnd(12) + "camelot".padEnd(9) + "strength"
  );
  for (const r of results) {
    console.log(
      r.file.slice(0, 44).padEnd(46) +
      fmt(r.bpm, 1).padEnd(9) +
      String(r.phase).padEnd(7) +
      (r.phaseMargin === null ? "n/a" : fmt(r.phaseMargin * 100, 0) + "%").padEnd(9) +
      (r.downbeatSpacingStdev === null ? "n/a" : fmt(r.downbeatSpacingStdev, 3)).padEnd(12) +
      String(r.camelot).padEnd(9) +
      fmt(r.strength, 3)
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: node scripts/analyze-cli.js <file-or-folder> [--json]");
    process.exit(1);
  }

  initNodeEssentiaEnvironment(path.join(__dirname, ".."));

  const targetPath = path.resolve(target);
  const stat = fs.statSync(targetPath);
  let files;
  if (stat.isDirectory()) {
    files = fs.readdirSync(targetPath)
      .filter((f) => /\.(mp3|wav|m4a)$/i.test(f))
      .map((f) => path.join(targetPath, f))
      .sort();
  } else {
    files = [targetPath];
  }

  console.log(`Analyzing ${files.length} file(s)...`);
  const results = [];
  for (const f of files) {
    try {
      const r = await analyzeOneFile(f);
      results.push(r);
      if (!asJson) {
        printReport(r);
      }
    } catch (e) {
      console.error(`FAILED on ${path.basename(f)}: ${e && e.message ? e.message : e}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else if (results.length > 1) {
    printSummaryTable(results);
  }
}

main().catch((err) => {
  console.error("analyze-cli.js failed:", err);
  process.exit(1);
});
