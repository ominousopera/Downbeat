"use strict";
// js/sound-library.js's parseNameTags(): key and BPM read from file names.
// Formats common in sound-effect libraries and in key-tagged file names
// ("8A - 128 - ..."), and the traps those names contain ("Hang Em" is "them",
// "Am Radio" is AM radio). Run: node scripts/test-name-tags.js
global.window = global;
require("../js/camelot.js");
require("../js/sound-library.js");
const SL = global.BeatMarkerSoundLibrary;

let failures = 0;
function expect(name, folder, want) {
  const got = SL.parseNameTags(name, folder || "");
  const ok = got.key === (want.key || null) && got.scale === (want.scale || null) &&
             got.bpm === (want.bpm || null) && got.note === (want.note || null);
  if (!ok) { failures++; }
  console.log((ok ? "ok   " : "FAIL ") + name + (folder ? "  [folder " + folder + "]" : "") + " -> " + JSON.stringify(got) +
              (ok ? "" : "  expected " + JSON.stringify(want)));
}
// Explicit key words (the reliable kind).
expect("DSGNDron_Dark Pad Drone, Loop, Key Emaj_Example Audio_Drone Pack.wav", "", { key: "E", scale: "major" });
expect("DSGNBram_Low Braam Hit, key D#min_Example Audio.wav", "", { key: "D#", scale: "minor" });
expect("MUSCKeyd_PIANO CHORD-Soft Piano Chord Amin 03_Example_Sketch.wav", "", { key: "A", scale: "minor" });
expect("Piano C# Minor 90 BPM.wav", "", { key: "C#", scale: "minor", bpm: 90 });
expect("Lead Bb major.wav", "", { key: "A#", scale: "major" });
expect("DSGNRythm_Slow Drum Loop, Key C_Example Audio.wav", "", { key: "C", scale: "major" });
expect("Pad Key of F#m.wav", "", { key: "F#", scale: "minor" });
// Short forms, only with context.
expect("Bass_Loop_Fm_128_BPM.wav", "", { key: "F", scale: "minor", bpm: 128 });
expect("Synth Pad (F#m).wav", "", { key: "F#", scale: "minor" });
expect("Guitar Loop 120bpm Am.wav", "", { key: "A", scale: "minor", bpm: 120 });
// Camelot codes and Mixed In Key renames.
expect("8A - 128 - Artist - Title.mp3", "", { key: "A", scale: "minor", bpm: 128 });
expect("Track Name (11B).mp3", "", { key: "A", scale: "major" });
// BPM alone, and root notes without a mode.
expect("bpm_140 Drum Loop.wav", "", { bpm: 140 });
expect("MUSCPerc_PERCUSSION-Soft Shaker Loopable_Example_Marble_120 bpm.wav", "", { bpm: 120 });
expect("DSGNRythm_WORLD RHYTHMS-Calm Hand Drums Loopable F_Example_Marble_90 bpm.wav", "", { note: "F", bpm: 90 });
expect("MUSCKeyd_NATURAL-Soft Piano Octave Ping G 01_Example_Sketch.wav", "G", { note: "G" });
expect("Sub Hit 03.wav", "C# minor", { key: "C#", scale: "minor" });
// Traps: none of these name a key or tempo.
expect("Sailor Voice Say Hang Em 01.wav", "", {});
expect("Vintage Am Radio Tuning 01.wav", "", {});
expect("Hit_A_01.wav", "", {});
expect("Whoosh A 02.wav", "", {});
expect("The Amazing Grace Cinematic.wav", "", {});
expect("Admin Panel Click.wav", "", {});
expect("Final Minor Crash.wav", "", {});
expect("Vol 2 - 2023 Mix - Take 5.wav", "", {});
expect("Impact 808.wav", "", {});
expect("Riser 15 sec.wav", "", {});
// Name tags win over detection, a bare root takes its mode from detection.
(function () {
  const st = SL.getState();
  function rec(path, camelot, key, scale, bpm) {
    st.files[path] = { path: path, section: "sfx", name: path.split("/").pop(), status: "done", camelot: camelot, key: key, scale: scale, bpm: bpm };
    SL.applyNameTags(path);
    return st.files[path];
  }
  const a = rec("/x/Pad, Key Cmin_y.wav", "8B", "C", "major", 97);
  const b = rec("/x/G/Ping G 01.wav", "6A", "G", "minor", null); // detected G minor, name says G
  const c = rec("/x/G/Ping G 02.wav", "9A", "E", "minor", null); // detected E minor = relative of G major
  const d = rec("/x/Loop_120 bpm.wav", "8A", "A", "minor", 60.2); // tempo from the name
  const ok = a.camelot === "5A" && a.keyFrom === "name" && b.camelot === "6A" && c.camelot === "9B" && c.key === "G" &&
             d.bpm === 120 && d.bpmFrom === "name" && d.camelot === "8A";
  if (!ok) { failures++; }
  console.log((ok ? "ok   " : "FAIL ") + "name tags override detection; a bare root keeps detection's mode or its relative's - " +
              [a.camelot, b.camelot, c.camelot, d.bpm].join(", "));
  const complete = SL.nameTagsComplete("/x/Pad, Key Cmin_y.wav", "sfx") && !SL.nameTagsComplete("/x/Pad, Key Cmin_y.wav", "music") &&
                   SL.nameTagsComplete("/x/8A - 128 - Song.mp3", "music");
  if (!complete) { failures++; }
  console.log((complete ? "ok   " : "FAIL ") + "a key alone skips analysis for SFX; music also needs the BPM in the name");
})();
// A saved library or a library copy with "__proto__" as a file key (hand
// edited or damaged) must not replace the records object's prototype.
(function () {
  const evil = JSON.parse('{"folders":{"sfx":["/x"]},"files":{"__proto__":{"ghost":{"path":"ghost","section":"sfx","status":"done"}},' +
    '"/x/a.wav":{"path":"/x/a.wav","section":"sfx","status":"done"}}}');
  const seen = function () { const k = []; for (const p in SL.getState().files) { k.push(p); } return k.join(","); };
  SL.loadState(evil);
  const loaded = seen();
  SL.loadState({});
  SL.mergeState(evil);
  const merged = seen();
  const ok = loaded === "/x/a.wav" && merged === "/x/a.wav" && Object.getPrototypeOf(SL.getState().files) === Object.prototype;
  if (!ok) { failures++; }
  console.log((ok ? "ok   " : "FAIL ") + "a \"__proto__\" file key is skipped on load and merge - " + loaded + " / " + merged);
  SL.loadState({});
})();

if (failures) {
  console.error("\n" + failures + " file-name tag check(s) failed");
  process.exit(1);
}
console.log("\nkeys and tempos are read from file names, and the traps are left alone");
