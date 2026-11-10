"use strict";
// js/sound-library.js's parseNameTags(): key and BPM read from file names.
// Formats common in sound-effect libraries and in key-tagged file names
// ("8A - 128 - ..."), and the traps those names contain ("Get Em" is "them",
// "Am Dial" is AM radio). Run: node scripts/test-name-tags.js
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
expect("Crowd Yell Get Em 01.wav", "", {});
expect("Old Am Dial Sweep 01.wav", "", {});
expect("Hit_A_01.wav", "", {});
expect("Whoosh A 02.wav", "", {});
expect("The Amazing Grace Cinematic.wav", "", {});
expect("Admin Panel Click.wav", "", {});
expect("Final Minor Crash.wav", "", {});
expect("Vol 2 - 2023 Mix - Take 5.wav", "", {});
expect("Impact 808.wav", "", {});
expect("Riser 15 sec.wav", "", {});
// Song titles with a BPM tag: a title word is no key; a short form beside the tag is.
expect("Am I Ready Yet 120 BPM.mp3", "", { bpm: 120 });
expect("Paint A Cloud 128bpm.mp3", "", { bpm: 128 });
expect("Option B - Ready 120 BPM.mp3", "", { bpm: 120 });
expect("Plan A 120 BPM.mp3", "", { bpm: 120 });
expect("Look Where I Am 128bpm.mp3", "", { bpm: 128 });
expect("120 BPM A Night Out.mp3", "", { bpm: 120 });
expect("Bass Loop Cm 120bpm.wav", "", { key: "C", scale: "minor", bpm: 120 });
expect("Pluck F# 128 BPM.wav", "", { note: "F#", bpm: 128 });
expect("Lead 128 BPM Dm 02.wav", "", { key: "D", scale: "minor", bpm: 128 });

// Name tags win over detection, a bare root takes its mode from detection.
(function () {
  const st = SL.getState();
  function rec(path, camelot, key, scale, bpm) {
    st.files[path] = { path: path, section: "sfx", name: path.split("/").pop(), status: "done", camelot: camelot, key: key, scale: scale, bpm: bpm };
    SL.applyNameTags(path);
    return st.files[path];
  }
  const a = rec("/x/Pad, Key Cmin_y.wav", "8B", "C", "major", 97);
  // A bare letter folder counts beside other note folders (G, G#, A...).
  st.files["/x/G#/Ping G# 01.wav"] = { path: "/x/G#/Ping G# 01.wav", section: "sfx", name: "Ping G# 01.wav", status: "pending" };
  st.files["/x/A/Ping A 01.wav"] = { path: "/x/A/Ping A 01.wav", section: "sfx", name: "Ping A 01.wav", status: "pending" };
  const b = rec("/x/G/Ping G 01.wav", "6A", "G", "minor", null);       // detected G minor, name says G
  const c = rec("/x/G/Ping G 02.wav", "9A", "E", "minor", null);       // detected E minor = relative of G major
  const d = rec("/x/Loop_120 bpm.wav", "8A", "A", "minor", 60.2);       // tempo from the name
  const ok = a.camelot === "5A" && a.keyFrom === "name" && b.camelot === "6A" && c.camelot === "9B" && c.key === "G" &&
             d.bpm === 120 && d.bpmFrom === "name" && d.camelot === "8A";
  if (!ok) { failures++; }
  console.log((ok ? "ok   " : "FAIL ") + "name tags override detection; a bare root keeps detection's mode or its relative's - " +
              [a.camelot, b.camelot, c.camelot, d.bpm].join(", "));
  const complete = SL.nameTagsComplete("/x/Pad, Key Cmin_y.wav", "sfx") && !SL.nameTagsComplete("/x/Pad, Key Cmin_y.wav", "music") &&
                   SL.nameTagsComplete("/x/8A - 128 - Song.mp3", "music");
  if (!complete) { failures++; }
  console.log((complete ? "ok   " : "FAIL ") + "a key alone skips analysis for SFX; music also needs the BPM in the name");
  SL.loadState({});
})();

// A folder letter is no key for a sound without a pitch, nor in a library
// sorted by first letter; a key from the folder alone still gets analyzed.
(function () {
  const st = SL.getState();
  function add(path, extra) {
    st.files[path] = Object.assign({ path: path, section: "sfx", name: path.split("/").pop(), status: "done", camelot: "3B", key: "C#", scale: "major", v: 3 }, extra || {});
    return st.files[path];
  }
  add("/lib/H/Horn 01.wav", { status: "pending" });
  const noise = add("/lib/A/Applause 01.wav", { strength: 0.2, pitchCrest: 1.2, pitchFlatness: 0.4 });
  const bell = add("/lib/B/Bell 01.wav", { strength: 0.9, pitchCrest: 6, pitchFlatness: 0.001 });
  const drone = add("/notes/C# minor/Drone 01.wav", { strength: 0.9, pitchCrest: 6, pitchFlatness: 0.001 });
  const hiss = add("/notes/C# minor/Hiss 01.wav", { strength: 0.2, pitchCrest: 1.2, pitchFlatness: 0.4 });
  [noise, bell, drone, hiss].forEach(function (r) { SL.applyNameTags(r.path); });
  const ok = !noise.keyFrom && noise.camelot === "3B" && !SL.hasPitch(noise) && !bell.keyFrom && bell.camelot === "3B" &&
             drone.keyFrom === "name" && drone.camelot === "12A" && !hiss.keyFrom &&
             !SL.nameTagsComplete("/notes/C# minor/Sub Hit 03.wav", "sfx");
  if (!ok) { failures++; }
  console.log((ok ? "ok   " : "FAIL ") + "folder notes: none for noise or an A-Z library, kept for a pitched sound in \"C# minor\" - " +
              [noise.camelot, bell.camelot, drone.camelot, hiss.camelot].join(", "));
  SL.loadState({});
})();

// A saved key taken from a title word goes back to the scan.
(function () {
  SL.loadState({ folders: { music: ["/m"], sfx: [] }, files: {
    "/m/Am I Ready Yet 120 BPM.mp3": { path: "/m/Am I Ready Yet 120 BPM.mp3", section: "music", name: "Am I Ready Yet 120 BPM.mp3", status: "done", v: 3,
      nameChecked: 1, key: "A", scale: "minor", camelot: "8A", keyFrom: "name", bpm: 120, bpmFrom: "name", fav: true },
    "/m/Loop 120bpm Am.wav": { path: "/m/Loop 120bpm Am.wav", section: "music", name: "Loop 120bpm Am.wav", status: "done", v: 3,
      nameChecked: 1, key: "A", scale: "minor", camelot: "8A", keyFrom: "name", bpm: 120, bpmFrom: "name" }
  } });
  const files = SL.getState().files;
  const title = files["/m/Am I Ready Yet 120 BPM.mp3"], loop = files["/m/Loop 120bpm Am.wav"];
  const ok = title.status === "pending" && title.fav === true && loop.status === "done" && loop.camelot === "8A";
  if (!ok) { failures++; }
  console.log((ok ? "ok   " : "FAIL ") + "a saved key read from a title word is analyzed again, the star kept - " + title.status + ", " + loop.status);
  SL.loadState({});
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
