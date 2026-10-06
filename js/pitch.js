// Pure arithmetic for key matching: this file does not shift any audio. It
// works out the numbers to type into whichever pitch shifter the editor
// already uses (Premiere's Pitch Shifter, AE's Pitch & Time, a sampler's
// tune knob, ...).
// The one piece of music theory that matters here: transposition moves the
// tonic and KEEPS the mode. You can pitch A minor to C minor; you cannot
// pitch it to C major, because no amount of shifting turns a minor third into
// a major one.
(function (global) {
  "use strict";

  var CAM = global.BeatMarkerCamelot;
  // Semitone distance from one Camelot code's tonic to another's, given both
  // directions. Pitching down usually sounds better than pitching up by the
  // same amount on sustained material, and pitching by 11 when -1 would do is
  // a common way to wreck a riser, so both are returned and the shorter one
  // is marked.
  function shiftBetween(fromCode, toCode) {
    var a = CAM.fromCamelotCode(fromCode);
    var b = CAM.fromCamelotCode(toCode);
    if (!a || !b) { return null; }
    var pa = CAM.pitchClassOf(a.key);
    var pb = CAM.pitchClassOf(b.key);
    if (pa === null || pb === null) { return null; }

    var up = (pb - pa + 12) % 12; // 0..11
    var down = (up === 0) ? 0 : up - 12; // -11..0
    // Ties (a tritone, 6 either way) resolve downward: less artefacting on
    // the formants, and an editor reaching for a tritone is matching harmony,
    // not chasing a specific octave.
    var shortest = (Math.abs(down) <= up) ? down : up;

    return {
      up: up,
      down: down,
      shortest: shortest,
      fromScale: a.scale,
      toScale: b.scale,
      modeChanges: a.scale !== b.scale
    };
  }
  // What a shifter needs, in the three units they are labelled with.
  // ratio/speedPercent apply only to shifters that resample (varispeed, a
  // sampler's tune, AE's Time Stretch) - those change the duration and
  // therefore the tempo as well, which is why tempo is reported alongside.
  function describeShift(semitones, bpm) {
    var ratio = Math.pow(2, semitones / 12);
    var out = {
      semitones: semitones,
      cents: Math.round(semitones * 100),
      ratio: ratio,
      speedPercent: ratio * 100,
      timeStretchPercent: 100 / ratio,
      newBpm: null
    };
    if (typeof bpm === "number" && isFinite(bpm) && bpm > 0) {
      out.newBpm = bpm * ratio;
    }
    return out;
  }
  // Where `semitones` of transposition actually lands, starting from
  // fromCode. Mode is carried over unchanged - see the file header.
  function transpose(fromCode, semitones) {
    var a = CAM.fromCamelotCode(fromCode);
    if (!a) { return null; }
    var pa = CAM.pitchClassOf(a.key);
    if (pa === null) { return null; }
    var pc = (((pa + semitones) % 12) + 12) % 12;
    return CAM.codeFromPitchClass(pc, a.scale);
  }
  function plan(fromCode, toCode, bpm) {
    var s = shiftBetween(fromCode, toCode);
    if (!s) { return null; }

    var landing = transpose(fromCode, s.shortest);
    var reachesTarget = (landing === toCode);
    var landingMixesWithTarget = !!(landing && toCode &&
      (landing === toCode || CAM.areCompatible(landing, toCode)));

    return {
      from: fromCode,
      to: toCode,
      modeChanges: s.modeChanges,
      fromScale: s.fromScale,
      toScale: s.toScale,
      primary: describeShift(s.shortest, bpm),
      alternative: (s.up === 0) ? null
        : describeShift(s.shortest === s.up ? s.down : s.up, bpm),
      landing: landing,
      landingName: landing ? CAM.fromCamelotCode(landing) : null,
      reachesTarget: reachesTarget,
      landingMixesWithTarget: landingMixesWithTarget,
      alreadyCompatible: (fromCode === toCode) || CAM.areCompatible(fromCode, toCode)
    };
  }
  // All 24 codes, wheel order, for the two dropdowns.
  function allCodes() {
    var out = [];
    for (var n = 1; n <= 12; n++) {
      out.push(n + "A");
      out.push(n + "B");
    }
    return out;
  }

  global.BeatMarkerPitch = {
    shiftBetween: shiftBetween,
    describeShift: describeShift,
    transpose: transpose,
    plan: plan,
    allCodes: allCodes
  };
})(window);
