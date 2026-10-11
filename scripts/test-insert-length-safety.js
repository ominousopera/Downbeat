"use strict";
// A Library insert never covers the editor's clips, also when the panel does
// not know how long the sound is (a sound whose key and tempo came from its
// file name is never decoded). The real jsx/host.jsx on the Premiere
// stand-in; the editor's clip sits on A2 at 12-20 s, the playhead at 10 s.
// Run: node scripts/test-insert-length-safety.js
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function setup(extra) {
  const fake = mocks.makePremiereHost(Object.assign({ mediaPath: "/music/song.wav", durationSec: 60, clipStart: 0, audioTrackCount: 3, playheadSeconds: 10, insertDurationSec: 8 }, extra || {}));
  const item = { name: "Dialog take 3.wav", getMediaPath: function () { return "/edit/Dialog take 3.wav"; }, getMarkers: function () { return new mocks.MarkerCollection(); } };
  fake.sequence.audioTracks[1].clips.push(new mocks.PClip(item, 12, 20, 0, false));
  fake.sequence.audioTracks[1].clips.sort(function (a, b) { return a.start.seconds - b.start.seconds; });
  fake.context.File = function (p) { this.fsName = String(p); this.exists = true; };
  return { fake: fake, host: mocks.loadHost(fake.context) };
}
function insert(h, duration) {
  return JSON.parse(h.host.run("insertAudioAtPlayhead(" + JSON.stringify(JSON.stringify("/sfx/Riser 120bpm Am.mp3")) + ", " + duration + ", " +
    JSON.stringify(JSON.stringify({ underTrack: 1 })) + ")"));
}
function overlaps(h) {
  const out = [];
  h.fake.sequence.audioTracks.forEach(function (track, t) {
    track.clips.forEach(function (a) {
      track.clips.forEach(function (b) {
        if (a !== b && /Riser/.test(a.name) && b.start.seconds < a.end.seconds - 1e-6 && b.end.seconds > a.start.seconds + 1e-6) {
          out.push("A" + (t + 1) + ": " + a.name + " over " + b.name);
        }
      });
    });
  });
  return out;
}

// 1. Length unknown to the panel, Premiere knows it: the next free track.
let h = setup({ mediaLength: 8 });
let r = insert(h, 0);
check("an 8 s sound sent with no length goes to a free track, not over the editor's clip",
  r.ok && r.data.where === "A3" && overlaps(h).length === 0, JSON.stringify(r.data || r.error) + " " + overlaps(h).join("; "));
// 2. A length shorter than the file (decoded differently): the file's own length counts.
h = setup({ mediaLength: 8 });
r = insert(h, 1.5);
check("a too-short length from the panel is replaced by the file's own length",
  r.ok && r.data.where === "A3" && overlaps(h).length === 0, JSON.stringify(r.data || r.error));
// 3. Nobody knows the length: nothing is placed and the timeline is unchanged.
h = setup({});
const before = h.fake.sequence.audioTracks.map(function (t) { return t.clips.length; }).join();
r = insert(h, 0);
check("with no length anywhere, the insert is refused and nothing is placed",
  !r.ok && /did not insert/.test(r.error) && h.fake.sequence.audioTracks.map(function (t) { return t.clips.length; }).join() === before, r.error);
// 4. A known length that fits: the normal case (A2 before the editor's clip is free for 1.5 s).
h = setup({ mediaLength: 1.5, insertDurationSec: 1.5 });
r = insert(h, 1.5);
check("a sound that fits before the editor's clip still goes on the first free track", r.ok && r.data.where === "A2" && overlaps(h).length === 0, JSON.stringify(r.data || r.error));

if (failures) {
  console.error(failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS insert length safety");
