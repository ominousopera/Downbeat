// Camelot Wheel data and compatibility rules: conversion between key names
// and Camelot codes, compatible-code lookup, Open Key and enharmonic names.
(function (global) {
  "use strict";
  // Pitch class (0=C .. 11=B) -> Camelot number for the MAJOR key at that
  // pitch class. A minor key shares its relative major's number (relative
  // major is 3 semitones up from the minor tonic) with the "A" suffix instead
  // of "B" - see toCamelotCode() below.
  var MAJOR_NUMBER_BY_PITCH_CLASS = {
    0: 8, // C
    1: 3, // C#/Db
    2: 10, // D
    3: 5, // D#/Eb
    4: 12, // E
    5: 7, // F
    6: 2, // F#/Gb
    7: 9, // G
    8: 4, // G#/Ab
    9: 11, // A
    10: 6, // A#/Bb
    11: 1 // B
  };
  var PITCH_CLASS_BY_NAME = {
    "C": 0,
    "C#": 1, "Db": 1,
    "D": 2,
    "D#": 3, "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6, "Gb": 6,
    "G": 7,
    "G#": 8, "Ab": 8,
    "A": 9,
    "A#": 10, "Bb": 10,
    "B": 11
  };
  // keyName: a note name as returned by essentia's KeyExtractor (e.g. "C",
  // "F#", "Bb"). scale: "major" or "minor". Returns the Camelot code (e.g.
  // "8B"), or null for an unknown note name.
  function toCamelotCode(keyName, scale) {
    var pitchClass = PITCH_CLASS_BY_NAME[keyName];
    if (pitchClass === undefined) {
      return null;
    }
    var isMinor = (scale || "").toLowerCase().indexOf("minor") === 0;
    if (isMinor) {
      var relativeMajorPitchClass = (pitchClass + 3) % 12;
      return MAJOR_NUMBER_BY_PITCH_CLASS[relativeMajorPitchClass] + "A";
    }
    return MAJOR_NUMBER_BY_PITCH_CLASS[pitchClass] + "B";
  }
  var NUMBER_TO_PITCH_CLASS_MAJOR = {};
  for (var _pc in MAJOR_NUMBER_BY_PITCH_CLASS) {
    if (MAJOR_NUMBER_BY_PITCH_CLASS.hasOwnProperty(_pc)) {
      NUMBER_TO_PITCH_CLASS_MAJOR[MAJOR_NUMBER_BY_PITCH_CLASS[_pc]] = parseInt(_pc, 10);
    }
  }
  // One canonical spelling per pitch class, for display only. toCamelotCode()
  // accepts both sharp and flat spellings on input.
  var PITCH_CLASS_DISPLAY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  // Flat spelling per pitch class, shown alongside the sharp names above
  // (e.g. "C#/Db"). The two arrays differ only on the 5 black keys.
  var PITCH_CLASS_FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  function _parseCode(code) {
    if (!code) {
      return null;
    }
    var match = /^(\d{1,2})([AB])$/.exec(code);
    if (!match) {
      return null;
    }
    return { number: parseInt(match[1], 10), letter: match[2] };
  }
  // Standard Camelot compatibility rules: same code (or same number, other
  // letter - relative major/minor); +-1 number, same letter (adjacent on the
  // wheel, a perfect-fifth relationship, wrapping 12<->1).
  function areCompatible(codeA, codeB) {
    var parsedA = _parseCode(codeA);
    var parsedB = _parseCode(codeB);
    if (!parsedA || !parsedB) {
      return false;
    }
    if (parsedA.number === parsedB.number) {
      return true;
    }
    if (parsedA.letter === parsedB.letter) {
      var diff = Math.abs(parsedA.number - parsedB.number);
      return diff === 1 || diff === 11;
    }
    return false;
  }
  // Inverse of toCamelotCode(): "8B" -> { key: "C", scale: "major" }, or null
  // for an unrecognized code.
  function fromCamelotCode(code) {
    var parsed = _parseCode(code);
    if (!parsed) {
      return null;
    }
    var majorPitchClass = NUMBER_TO_PITCH_CLASS_MAJOR[parsed.number];
    if (majorPitchClass === undefined) {
      return null;
    }
    if (parsed.letter === "B") {
      return { key: PITCH_CLASS_DISPLAY_NAMES[majorPitchClass], scale: "major" };
    }
    var minorPitchClass = (majorPitchClass - 3 + 12) % 12;
    return { key: PITCH_CLASS_DISPLAY_NAMES[minorPitchClass], scale: "minor" };
  }
  // Every OTHER Camelot code compatible with the given one (up to 3: same
  // number/other letter, +-1 number/same letter). It enumerates the rule
  // areCompatible() checks for a pair, e.g. for a "what should the other
  // track be" hint.
  function getCompatibleCodes(code) {
    var result = [];
    for (var n = 1; n <= 12; n++) {
      var a = n + "A";
      var b = n + "B";
      if (a !== code && areCompatible(code, a)) {
        result.push(a);
      }
      if (b !== code && areCompatible(code, b)) {
        result.push(b);
      }
    }
    return result;
  }
  // Open Key notation (used by Traktor and some DJ tools): the same wheel and
  // compatibility rules as Camelot, with a different starting offset and
  // letter convention (m = minor, d = major).
  function toOpenKeyCode(camelotCode) {
    var parsed = _parseCode(camelotCode);
    if (!parsed) {
      return null;
    }
    var openKeyNumber = ((parsed.number + 4) % 12) + 1;
    var letter = parsed.letter === "A" ? "m" : "d";
    return openKeyNumber + letter;
  }
  // Returns one name for the 7 white-key pitch classes, which have no
  // enharmonic ambiguity, and "sharp/flat" (e.g. "C#/Db") for the 5 others.
  function getEnharmonicSpelling(camelotCode) {
    var parsed = _parseCode(camelotCode);
    if (!parsed) {
      return null;
    }
    var majorPitchClass = NUMBER_TO_PITCH_CLASS_MAJOR[parsed.number];
    if (majorPitchClass === undefined) {
      return null;
    }
    var pitchClass = parsed.letter === "B" ? majorPitchClass : (majorPitchClass - 3 + 12) % 12;
    var sharp = PITCH_CLASS_DISPLAY_NAMES[pitchClass];
    var flat = PITCH_CLASS_FLAT_NAMES[pitchClass];
    return sharp === flat ? sharp : sharp + "/" + flat;
  }
  // Pitch class (0=C .. 11=B) for a note name, and the inverse: the Camelot
  // code for a pitch class in a given scale. Both are views onto the tables
  // above; js/pitch.js uses them for arithmetic in semitones.
  function pitchClassOf(keyName) {
    var pc = PITCH_CLASS_BY_NAME[keyName];
    return (pc === undefined) ? null : pc;
  }

  function codeFromPitchClass(pitchClass, scale) {
    if (typeof pitchClass !== "number" || pitchClass < 0 || pitchClass > 11) {
      return null;
    }
    return toCamelotCode(PITCH_CLASS_DISPLAY_NAMES[pitchClass], scale);
  }

  global.BeatMarkerCamelot = {
    pitchClassOf: pitchClassOf,
    codeFromPitchClass: codeFromPitchClass,
    toCamelotCode: toCamelotCode,
    areCompatible: areCompatible,
    fromCamelotCode: fromCamelotCode,
    getCompatibleCodes: getCompatibleCodes,
    toOpenKeyCode: toOpenKeyCode,
    getEnharmonicSpelling: getEnharmonicSpelling
  };
})(window);
