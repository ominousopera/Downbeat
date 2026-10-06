"use strict";
// js/pitch.js: no host, no audio. The whole module is arithmetic over the
// Camelot wheel, so all of it is testable here.
// Run: node scripts/test-pitch.js
global.window = global;
require("../js/camelot.js");
require("../js/pitch.js");

const CAM = global.BeatMarkerCamelot;
const P = global.BeatMarkerPitch;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error("FAIL " + label + "\n  expected " + JSON.stringify(expected) +
                  "\n  actual   " + JSON.stringify(actual));
  } else {
    console.log("ok   " + label);
  }
}
function close(label, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures++;
    console.error("FAIL " + label + "\n  expected " + expected + " +-" + tol + "\n  actual   " + actual);
  } else {
    console.log("ok   " + label);
  }
}
// ---- the camelot.js helpers the calculator leans on -------------------
check("pitchClassOf C", CAM.pitchClassOf("C"), 0);
check("pitchClassOf A", CAM.pitchClassOf("A"), 9);
check("pitchClassOf flat spelling Bb", CAM.pitchClassOf("Bb"), 10);
check("pitchClassOf rejects junk", CAM.pitchClassOf("H"), null);
check("codeFromPitchClass 0 major = 8B", CAM.codeFromPitchClass(0, "major"), "8B");
check("codeFromPitchClass 9 minor = 8A", CAM.codeFromPitchClass(9, "minor"), "8A");
check("codeFromPitchClass rejects out of range", CAM.codeFromPitchClass(12, "major"), null);
// Round trip: every code -> name -> pitch class -> code.
for (const code of P.allCodes()) {
  const n = CAM.fromCamelotCode(code);
  const back = CAM.codeFromPitchClass(CAM.pitchClassOf(n.key), n.scale);
  if (back !== code) { failures++; console.error("FAIL round trip " + code + " -> " + back); }
}
console.log("ok   all 24 codes round-trip through pitch class");
// ---- semitone distance ----
// A minor (8A) to D minor (7A): D is 5 semitones above A, or 7 below.
const aToD = P.shiftBetween("8A", "7A");
check("8A->7A up", aToD.up, 5);
check("8A->7A down", aToD.down, -7);
check("8A->7A shortest is up", aToD.shortest, 5);
check("8A->7A no mode change", aToD.modeChanges, false);
// Same key: no shift at all, and no bogus "alternative".
const same = P.plan("8A", "8A", 120);
check("8A->8A shift is zero", same.primary.semitones, 0);
check("8A->8A has no alternative", same.alternative, null);
check("8A->8A reaches target", same.reachesTarget, true);
// Tritone: 6 either way. Ties resolve downward.
const tri = P.shiftBetween("8A", "2A");
check("tritone up", tri.up, 6);
check("tritone down", tri.down, -6);
check("tritone tie resolves downward", tri.shortest, -6);
// ---- transposition keeps the mode -------------------------------------
check("8A up 3 lands on C minor (5A), not C major", P.transpose("8A", 3), "5A");
check("8B up 2 = D major (10B)", P.transpose("8B", 2), "10B");
check("transpose wraps an octave down", P.transpose("8A", -12), "8A");
check("transpose wraps an octave up", P.transpose("8A", 12), "8A");
// The relative-major trap: 8A and 8B share every note but no amount of
// pitching turns one into the other. The calculator must say so.
const trap = P.plan("8A", "8B", null);
check("8A->8B is flagged as a mode change", trap.modeChanges, true);
check("8A->8B cannot reach the target", trap.reachesTarget, false);
check("8A->8B is already compatible - no shift needed", trap.alreadyCompatible, true);
// Shifting the tonic still leaves it minor.
const cross = P.plan("8A", "3B", null);
check("8A->3B is a mode change", cross.modeChanges, true);
check("8A->3B does not reach the target", cross.reachesTarget, false);
check("8A->3B is not already compatible", cross.alreadyCompatible, false);
check("8A->3B lands on Db minor (12A)", cross.landing, "12A");
// ---- units a shifter actually takes -----------------------------------
const up7 = P.describeShift(7, 120);
check("7 semitones = 700 cents", up7.cents, 700);
close("7 semitones ratio", up7.ratio, 1.498307, 1e-5);
close("7 semitones speed %", up7.speedPercent, 149.8307, 1e-3);
close("7 semitones AE time-stretch %", up7.timeStretchPercent, 66.7420, 1e-3);
close("120 BPM pitched up 7 by speed", up7.newBpm, 179.797, 1e-2);

const down5 = P.describeShift(-5, 120);
check("-5 semitones = -500 cents", down5.cents, -500);
close("-5 semitones ratio", down5.ratio, 0.749154, 1e-5);
close("120 BPM pitched down 5 by speed", down5.newBpm, 89.898, 1e-2);

check("an octave doubles the speed", P.describeShift(12, 100).speedPercent, 200);
check("an octave doubles the tempo", P.describeShift(12, 100).newBpm, 200);
check("no tempo shown when no BPM is known", P.describeShift(3).newBpm, null);
// ---- alternative direction is the other way round, same landing -------
const plan57 = P.plan("8A", "7A", 128);
check("primary is +5", plan57.primary.semitones, 5);
check("alternative is -7", plan57.alternative.semitones, -7);
check("both directions land on the same code",
      P.transpose("8A", plan57.primary.semitones) === P.transpose("8A", plan57.alternative.semitones), true);
check("primary reaches the target", plan57.reachesTarget, true);
// ---- garbage in -------------------------------------------------------
check("unknown source code", P.plan("99Z", "8A", 120), null);
check("unknown target code", P.plan("8A", "99Z", 120), null);
check("transpose of junk", P.transpose("nope", 3), null);

if (failures) {
  console.error("\n" + failures + " assertion(s) FAILED");
  process.exit(1);
}
console.log("\nall pitch assertions passed");
