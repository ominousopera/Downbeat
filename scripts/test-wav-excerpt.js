"use strict";
// worker/wav-excerpt.js reads excerpts of WAV and AIFF files straight from
// disk: its samples must match an ffmpeg decode for several formats. Also:
// duration, reading from the middle, and refusing what it cannot read (so the
// panel falls back to its own decoder). Needs ffmpeg and a test track; skips
// without. Run: node scripts/test-wav-excerpt.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const W = require("../worker/wav-excerpt.js");

const TRACK = require("./test-tracks.js").named("rejected");
function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; }
}
if (!fs.existsSync(TRACK) || !hasFfmpeg()) {
  console.log("skip - needs ffmpeg and the test track");
  process.exit(0);
}
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function ffmpegMono44(file, start, length) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(start), "-t", String(length), "-i", file, "-f", "f32le", "-ac", "1", "-ar", "44100", "-"], { maxBuffer: 200 * 1024 * 1024 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-wav-"));
try {
  // 40 s of the track as the source for every flavor.
  const flavors = [
    ["16-bit 44.1k stereo", ["-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2"]],
    ["24-bit 48k stereo", ["-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2"]],
    ["24-bit 96k stereo", ["-c:a", "pcm_s24le", "-ar", "96000", "-ac", "2"]],
    ["32-bit int 48k mono", ["-c:a", "pcm_s32le", "-ar", "48000", "-ac", "1"]],
    ["32-bit float 48k stereo", ["-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2"]],
    ["16-bit 44.1k, extensible header + LIST chunk", ["-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2", "-rf64", "never", "-write_bext", "1", "-metadata", "title=test"]],
    ["AIFF 16-bit 44.1k stereo", ["-c:a", "pcm_s16be", "-ar", "44100", "-ac", "2"], ".aif"],
    ["AIFF 24-bit 48k stereo", ["-c:a", "pcm_s24be", "-ar", "48000", "-ac", "2"], ".aiff"],
    ["AIFF-C float 48k mono", ["-c:a", "pcm_f32be", "-ar", "48000", "-ac", "1"], ".aif"],
    ["AIFF-C sowt (little-endian) 44.1k", ["-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2"], ".aif"]
  ];
  flavors.forEach(function (fl, i) {
    const file = path.join(dir, "f" + i + (fl[2] || ".wav"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "30", "-t", "40", "-i", TRACK].concat(fl[1]).concat([file]));
    const info = W.probe(file);
    const mine = W.readExcerpt(file, info, 10, 20);
    const ref = ffmpegMono44(file, 10, 20);
    const r = correlation(mine, ref);
    check(fl[0] + ": duration and the samples of 10-30 s match ffmpeg",
      Math.abs(info.durationSec - 40) < 0.05 && Math.abs(mine.length - ref.length) <= 2 && r > 0.995,
      "duration " + info.durationSec.toFixed(3) + " s, " + mine.length + " vs " + ref.length + " samples, correlation " + r.toFixed(4));
  });
  // Speed on a long file: only the excerpt is read.
  const long = path.join(dir, "long.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "3", "-i", TRACK, "-c:a", "pcm_s24le", "-ar", "96000", "-ac", "2", long]);
  const size = fs.statSync(long).size;
  const t0 = Date.now();
  const li = W.probe(long);
  const ex = W.readExcerpt(long, li, 0, 30);
  check("a " + (size / 1e6).toFixed(0) + " MB 96k/24-bit file: 30 s read fast, without loading the file",
    ex.length === 30 * 44100 && Date.now() - t0 < 1500, (Date.now() - t0) + " ms, duration " + li.durationSec.toFixed(1) + " s");
  // Refusals the panel falls back on.
  const mp3AsWav = path.join(dir, "fake.wav");
  fs.copyFileSync(TRACK, mp3AsWav);
  let refused = null;
  try { W.probe(mp3AsWav); } catch (e) { refused = e; }
  check("an MP3 renamed to .wav is refused as unsupported (panel decodes it)", refused instanceof W.UnsupportedWav, refused && refused.message);
  const adpcm = path.join(dir, "adpcm.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-t", "5", "-i", TRACK, "-c:a", "adpcm_ms", adpcm]);
  refused = null;
  try { W.probe(adpcm); } catch (e) { refused = e; }
  check("a compressed (ADPCM) WAV is refused as unsupported", refused instanceof W.UnsupportedWav, refused && refused.message);
} finally {
  fs.rmSync(dir, { recursive: true, force: true }); // throwaway fixture made above
}
if (failures) {
  console.error("\n" + failures + " WAV reader check(s) failed");
  process.exit(1);
}
console.log("\nthe WAV reader matches ffmpeg");
