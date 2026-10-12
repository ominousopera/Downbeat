"use strict";
// The "1"s counted over the whole song: worker/beatthis-bars.js on
// synthetic Beat This! activations (50 frames per second), through the real
// postprocessMinimal for the beats and the model's own "1"s. Checks:
//   - a steady 4/4 song with two decoy "1"s on beat 3 and two "1"s missing:
//     every decoded "1" is a real one, none is lost, and the model's own
//     "1"s did have the decoys (so the test means something);
//   - every decoded "1" is one of the beats passed in;
//   - unsure: off on that song, on with a flat downbeat curve, on when the
//     model's own "1"s are missing;
//   - a tempo drifting from 120 to 132 BPM is followed;
//   - a 2-beat bar mid-song with clear "1"s: right again within two bars;
//     with weak "1"s the decoder may stay shifted, and then flags unsure;
//   - out of range gives null: under 2 frames, under 8 beats, beats closer
//     than 8 frames or further than 100, more than 30 minutes of frames;
//   - NaN and Infinity in the activations do not break it;
//   - the input arrays are not changed;
//   - 10 minutes at 60 BPM decodes in a few seconds.
// Run: node scripts/test-beatthis-bars.js
const path = require("path");
const { postprocessMinimal, FRAME_RATE } = require(path.join(__dirname, "..", "worker", "beatthis-pipeline.js"));
const { decodeBarsOnBeats, MAX_FRAMES } = require(path.join(__dirname, "..", "worker", "beatthis-bars.js"));

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

// A song: beat frames, the beats that are a "1", and how strongly the model
// marks each "1" (downbeat logit) - with optional decoys and gaps.
function song(beatFrames, ones, opts) {
  const o = opts || {};
  const T = beatFrames[beatFrames.length - 1] + 10;
  const B = new Float32Array(T).fill(-8), D = new Float32Array(T).fill(-8);
  beatFrames.forEach((f) => { B[f] = 6; });
  ones.forEach((i) => { if (!(o.missing || []).includes(i)) { D[beatFrames[i]] = o.downLogit === undefined ? 4 : o.downLogit; } });
  (o.decoys || []).forEach((i) => { D[beatFrames[i]] = 5; });
  return { B, D, T };
}
function steadyBeats(n, tau, start) { const f = []; for (let i = 0; i < n; i++) { f.push(start + i * tau); } return f; }
function run(s) {
  const m = postprocessMinimal(s.B, s.D);
  return { m, r: decodeBarsOnBeats(s.B, s.D, m.beatTimes, m.downbeatTimes) };
}
const beatIndex = (frames, t) => frames.indexOf(Math.round(t * FRAME_RATE));

// Steady 4/4, 120 BPM, 64 bars; decoys on beat 3 of bars 10 and 30, the
// "1" missing in bars 12 and 40.
const frames = steadyBeats(256, 25, 20);
const ones = frames.map((_, i) => i).filter((i) => i % 4 === 0);
const s1 = song(frames, ones, { decoys: [42, 122], missing: [48, 160] });
const { m: m1, r: r1 } = run(s1);
const idx1 = r1 ? r1.downbeatTimes.map((t) => beatIndex(frames, t)) : [];
check("the model's own \"1\"s include the decoys", m1.downbeatTimes.some((t) => beatIndex(frames, t) === 42));
check("every decoded \"1\" is a real one", r1 && idx1.every((i) => i % 4 === 0), JSON.stringify(idx1.filter((i) => i % 4 !== 0)));
check("no real \"1\" is lost (missing ones filled in)", r1 && idx1.length === ones.length, idx1.length + " of " + ones.length);
const beatSet = new Set(m1.beatTimes);
check("every decoded \"1\" is one of the beats passed in", r1 && r1.downbeatTimes.every((t) => beatSet.has(t)));
check("unsure is off on a clear song", r1 && r1.unsure === false, r1 && (r1.strength.toFixed(3) + " / " + r1.agreement.toFixed(3)));

const flat = song(frames, ones, { downLogit: -8 });
const rFlat = decodeBarsOnBeats(flat.B, flat.D, postprocessMinimal(flat.B, flat.D).beatTimes, []);
check("unsure is on with a flat downbeat curve", rFlat && rFlat.unsure === true);
const rNoOwn = decodeBarsOnBeats(s1.B, s1.D, m1.beatTimes, []);
check("unsure is on when the model's own \"1\"s are missing", rNoOwn && rNoOwn.unsure === true && rNoOwn.agreement === 0);

// 120 -> 132 BPM over 192 beats.
const drift = [20]; for (let i = 1; i < 192; i++) { drift.push(Math.round(drift[i - 1] + 25 - 2.3 * i / 191)); }
const driftOnes = drift.map((_, i) => i).filter((i) => i % 4 === 0);
const { r: r2 } = run(song(drift, driftOnes));
const idx2 = r2 ? r2.downbeatTimes.map((t) => beatIndex(drift, t)) : [];
check("a drifting tempo is followed", r2 && idx2.length === driftOnes.length && idx2.every((i) => i % 4 === 0), JSON.stringify(idx2.filter((i) => i % 4 !== 0)));

// A 2-beat bar at beat 80 of 160.
const brokenOnes = []; for (let b = 0; b < 160;) { brokenOnes.push(b); b += b === 80 ? 2 : 4; }
const brokenFrames = steadyBeats(160, 25, 20);
const { r: r3 } = run(song(brokenFrames, brokenOnes));
const idx3 = r3 ? r3.downbeatTimes.map((t) => beatIndex(brokenFrames, t)) : [];
const trueSet = new Set(brokenOnes);
const wrong3 = idx3.filter((i) => !trueSet.has(i));
check("a 2-beat bar with clear \"1\"s: right again within two bars", r3 && wrong3.every((i) => i >= 72 && i <= 90) && idx3.filter((i) => i > 90).length === brokenOnes.filter((i) => i > 90).length,
  JSON.stringify(wrong3));
const { r: r4 } = run(song(brokenFrames, brokenOnes, { downLogit: 0 }));
const wrong4 = r4 ? r4.downbeatTimes.map((t) => beatIndex(brokenFrames, t)).filter((i) => !trueSet.has(i)) : [];
check("a 2-beat bar with weak \"1\"s: shifted only if flagged unsure", r4 && (wrong4.length <= 2 || r4.unsure === true), wrong4.length + " wrong, unsure " + (r4 && r4.unsure));

check("under 2 frames gives null", decodeBarsOnBeats(new Float32Array(1), new Float32Array(1), m1.beatTimes, m1.downbeatTimes) === null);
check("under 8 beats gives null", decodeBarsOnBeats(s1.B, s1.D, m1.beatTimes.slice(0, 7), m1.downbeatTimes) === null);
check("no activations gives null", decodeBarsOnBeats(null, null, m1.beatTimes, m1.downbeatTimes) === null);
const fast = []; for (let i = 0; i < 64; i++) { fast.push(i * 0.1); }
check("beats closer than 8 frames give null", decodeBarsOnBeats(s1.B, s1.D, fast, []) === null);
const slow = []; for (let i = 0; i < 64; i++) { slow.push(i * 2.1); }
check("beats further than 100 frames give null", decodeBarsOnBeats(s1.B, s1.D, slow, []) === null);
const huge = new Float32Array(MAX_FRAMES + 1);
check("more than 30 minutes of frames gives null", decodeBarsOnBeats(huge, huge, m1.beatTimes, m1.downbeatTimes) === null);

const broken = song(frames, ones);
const B5 = Float32Array.from(broken.B), D5 = Float32Array.from(broken.D);
for (let f = 300; f < 5000; f += 377) { B5[f] = NaN; D5[f + 1] = Infinity; B5[f + 2] = -Infinity; }
const m5 = postprocessMinimal(broken.B, broken.D);
let r5 = null, threw = null;
try { r5 = decodeBarsOnBeats(B5, D5, m5.beatTimes, m5.downbeatTimes); } catch (e) { threw = e; }
check("NaN and Infinity in the activations do not break it", !threw && r5 && r5.downbeatTimes.every(Number.isFinite) && Number.isFinite(r5.strength), threw && threw.message);

const bCopy = Float32Array.from(s1.B), beatsCopy = m1.beatTimes.slice(), ownCopy = m1.downbeatTimes.slice();
decodeBarsOnBeats(s1.B, s1.D, m1.beatTimes, m1.downbeatTimes);
check("the input arrays are not changed", s1.B.every((v, i) => v === bCopy[i]) &&
  m1.beatTimes.every((t, i) => t === beatsCopy[i]) && m1.downbeatTimes.every((t, i) => t === ownCopy[i]));

const longFrames = steadyBeats(600, 50, 20);
const longSong = song(longFrames, longFrames.map((_, i) => i).filter((i) => i % 4 === 0));
const t0 = Date.now();
const { r: r6 } = run(longSong);
const sec = (Date.now() - t0) / 1000;
check("10 minutes at 60 BPM decodes in a few seconds", r6 && sec < 10, sec.toFixed(2) + " s");

if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nThe \"1\"s are counted over the whole song");
