// Music-mode key decision with a third opinion.
// Three independent opinions: vote - the essentia profile vote
// (js/analyze.js's detectKey()), chord - the key of the detected chord
// progression (same worker), skey - Deezer's S-KEY neural network
// (worker/skey-worker.js). Rule: the vote stands, unless S-KEY and the chord
// key agree with each other on something else - then that shared answer wins.
(function (global) {
  "use strict";
  // vote, chord, skey: Camelot codes or null.
  function combineMusicKey(vote, chord, skey) {
    if (skey && chord && skey === chord && skey !== vote) {
      return { camelot: skey, source: "skey+chords", agreement: "two", dissent: vote };
    }
    var backers = 1 + (chord === vote ? 1 : 0) + (skey === vote ? 1 : 0);
    if (backers === 3) {
      return { camelot: vote, source: "vote", agreement: "all3", dissent: null };
    }
    if (backers === 2) {
      return { camelot: vote, source: "vote", agreement: "two", dissent: chord === vote ? skey : chord };
    }
    return { camelot: vote, source: "vote", agreement: "none", dissent: skey };
  }

  global.BeatMarkerKeyCombine = { combineMusicKey: combineMusicKey };
})(typeof window !== "undefined" ? window : globalThis);
