"use strict";
// Analyze and Key read a file through BeatMarkerAudio.decodeFileToMono44100:
// the panel's decoder first and, when that cannot read a WAV or AIFF, the
// plugin's own reader (worker/wav-excerpt.js). Here the panel's decoder is a
// stand-in that always fails, like Chromium does for AIFF.
//   - a 16-bit AIFF and a 24-bit WAV are read by the fallback, mono 44100 Hz,
//     with the right length;
//   - the fallback is announced (onFallback), a successful decode is not;
//   - a file the plugin's reader cannot read either (an MP3 here) keeps the
//     decoder's own error.
// Needs ffmpeg to make the test files; skips without it.
// Run: node scripts/test-audio-fallback.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch (e) { console.log("skip - needs ffmpeg"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-fallback-"));
const make = function (name, args) {
  const out = path.join(tmp, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000", "-ac", "2"].concat(args, [out]));
  return out;
};
const aiff = make("tone.aiff", ["-c:a", "pcm_s16be"]);
const wav24 = make("tone24.wav", ["-c:a", "pcm_s24le"]);
const mp3 = make("tone.mp3", ["-c:a", "libmp3lame"]);

global.window = global;
global.cep_node = { require: function (p) { return require(p); } };
global.SystemPath = { EXTENSION: "EXTENSION" };
global.CSInterface = function () { this.getSystemPath = function () { return ROOT; }; };
require(path.join(ROOT, "js", "audio.js"));
const A = global.BeatMarkerAudio;
// Chromium's decoder, as it behaves for these files: refuses them.
global.OfflineAudioContext = function () { this.decodeAudioData = function () { return Promise.reject(new Error("Unable to decode audio data")); }; };

(async function () {
  let fell = 0;
  let r = await A.decodeFileToMono44100(aiff, { onFallback: function () { fell++; } });
  check("AIFF: read by the plugin's own reader, mono 44100 Hz, 2 s", fell === 1 && r.samples instanceof Float32Array && Math.abs(r.samples.length - 88200) <= 2 &&
    r.original.sampleRate === 48000 && r.original.channels === 2, r.samples.length + " samples, " + r.original.sampleRate + " Hz source");
  let peak = 0;
  for (let i = 0; i < r.samples.length; i++) { peak = Math.max(peak, Math.abs(r.samples[i])); }
  check("... and it is the sound, not silence", peak > 0.05, "peak " + peak.toFixed(3));
  fell = 0;
  r = await A.decodeFileToMono44100(wav24, { onFallback: function () { fell++; } });
  check("24-bit WAV the panel's decoder refused: read by the fallback", fell === 1 && Math.abs(r.samples.length - 88200) <= 2);
  let err = null;
  try { await A.decodeFileToMono44100(mp3, {}); } catch (e) { err = e; }
  check("MP3 is never sent to the WAV reader: the decoder's own error stays", err && /codec/.test(err.message), err && err.message.slice(0, 60));
  fs.rmSync(tmp, { recursive: true, force: true }); // throwaway fixture made above
  if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
  console.log("\nAnalyze and Key fall back to the plugin's own WAV / AIFF reader");
})();
