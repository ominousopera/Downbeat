"use strict";
// Editor markers and re-placing, on the real jsx/host.jsx +
// jsx/host-ae.jsx through the host stand-ins:
//   - After Effects keeps one marker per time, so placing or pasting where
//     an editor's own marker sits must leave it; a Downbeat marker at that
//     time is still replaced on re-placing.
//   - Premiere reads a re-sped clip's outPoint as in point + timeline
//     length, so replacing and counting Downbeat's clip markers must use
//     the clip's real source range, or a second placement on a pitched
//     clip would leave part of the first set.
// Run: node scripts/test-marker-editor-safety.js
const path = require("path");
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function arg(v) { return JSON.stringify(JSON.stringify(v)); }
function comments(prop) {
  const out = [];
  for (let i = 1; i <= prop.numKeys; i++) { out.push(prop.keyTime(i).toFixed(2) + "=" + prop.keyValue(i).comment); }
  return out;
}

// ---- After Effects ----
(function () {
  const fake = mocks.makeAeHost({ mediaPath: "/music/song.wav", durationSec: 20, startTime: 0, frameRate: 25 });
  const host = mocks.loadHost(fake.context);
  const layerMarkers = fake.comp.layers[0].property("Marker");
  layerMarkers.setValueAtTime(1.0, new mocks.MarkerValue("Verse 2"));
  let r = JSON.parse(host.run("createClipMarkers(" + arg([0.5, 1.0, 1.5]) + "," + arg(["D", "b", "b"]) + ", true)"));
  check("AE layer markers: the editor's marker on a beat stays", comments(layerMarkers).indexOf("1.00=Verse 2") !== -1,
    comments(layerMarkers).join(", "));
  check("AE layer markers: the beat there is left out and reported", r.ok && r.data.created === 2 && r.data.kept === 1, JSON.stringify(r.data));
  r = JSON.parse(host.run("createClipMarkers(" + arg([0.5, 1.0, 1.5]) + "," + arg(["D", "b", "b"]) + ", true)"));
  check("AE layer markers: re-placing replaces Downbeat's own set and still keeps the editor's",
    r.ok && layerMarkers.numKeys === 3 && comments(layerMarkers).indexOf("1.00=Verse 2") !== -1 && r.data.replaced === 2,
    comments(layerMarkers).join(", ") + " | replaced " + r.data.replaced);

  fake.comp.markerProperty.setValueAtTime(2.0, new mocks.MarkerValue("Chorus"));
  r = JSON.parse(host.run("createMarkers(" + arg([2.0, 2.5]) + "," + arg(["D", "b"]) + ", true)"));
  check("AE composition markers: the editor's marker on a beat stays",
    r.ok && comments(fake.comp.markerProperty).indexOf("2.00=Chorus") !== -1 && r.data.kept === 1,
    comments(fake.comp.markerProperty).join(", "));

  const info = JSON.parse(host.run("getSelectedAudioInfo()")).data;
  const clipboard = { version: 2, host: "ae", clipName: "x", sequenceMarkers: [],
    clipMarkers: [{ localSeconds: 1.0, label: "Pasted", duration: 0, fields: { comment: "Pasted" } },
                  { localSeconds: 3.0, label: "Pasted 2", duration: 0, fields: { comment: "Pasted 2" } }] };
  r = JSON.parse(host.run("pasteMarkersData(" + arg(clipboard) + "," + arg(info) + ")"));
  check("AE paste: a marker already at the same time stays, the other is pasted",
    r.ok && r.data.created === 1 && r.data.kept === 1 && comments(layerMarkers).indexOf("1.00=Verse 2") !== -1 &&
    comments(layerMarkers).indexOf("3.00=Pasted 2") !== -1, comments(layerMarkers).join(", "));
})();

// ---- Premiere: a clip at 120% speed ----
(function () {
  const fake = mocks.makePremiereHost({ mediaPath: "/music/song.wav", durationSec: 10, clipStart: 0 });
  const host = mocks.loadHost(fake.context);
  fake.audioTrack.clips[0]._speed = 1.2; // timeline 0..10 s plays source 0..12 s; outPoint reads 10
  const info = JSON.parse(host.run("getSelectedAudioInfo()")).data;
  const times = [];
  for (let t = 0; t < info.outPointSeconds - 1e-9; t += 0.5) { times.push(Number(t.toFixed(3))); }
  const call = "createClipMarkers(" + arg(times) + "," + arg(times.map(function () { return "b"; })) + ", true)";
  host.run(call);
  const first = fake.clipMarkers.list.length;
  const again = JSON.parse(host.run(call));
  check("Premiere 120% clip: placing twice keeps one set over the whole source range",
    info.outPointSeconds === 12 && first === 24 && fake.clipMarkers.list.length === 24 && again.data.replaced === 24,
    "out " + info.outPointSeconds + ", first " + first + ", now " + fake.clipMarkers.list.length + ", replaced " + again.data.replaced);
  const count = JSON.parse(host.run("countOwnMarkersForSelectedClip()")).data.count;
  check("Premiere 120% clip: Shift and the 1 buttons count every Downbeat marker", count === 24, "counted " + count);
})();

if (failures) {
  console.error(failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS marker editor safety");
