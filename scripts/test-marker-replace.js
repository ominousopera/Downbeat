"use strict";
// Placing markers again replaces Downbeat's own markers around the clip
// instead of stacking them, and leaves the editor's own markers alone; Clear
// markers and a move after copy scope their removal in their own ways. Runs
// against the Premiere and After Effects host mocks.
// Run: node scripts/test-marker-replace.js.
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function js(v) { return JSON.stringify(JSON.stringify(v)); }
function place(host, times, labels, replace) {
  return JSON.parse(host.run("createClipMarkers(" + js(times) + ", " + js(labels) + (replace ? ", true" : "") + ")"));
}
// ---- Premiere: the selected instance uses source 10-40 s of the media.
const p = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 30, clipStart: 0, audioTrackCount: 1 });
const clip = p.audioTrack.clips[0];
clip.inPoint = { seconds: 10, ticks: "0" };
clip.outPoint = { seconds: 40, ticks: "0" };
const ph = mocks.loadHost(p.context);
const own = p.clipMarkers.createMarker(20);
own.name = "Chorus"; // the editor's own marker
const elsewhere = p.clipMarkers.createMarker(50);
elsewhere.name = "D"; // ours, from another instance's range
const names = function () { return p.clipMarkers.list.map(function (m) { return m.name + "@" + m.start.seconds; }).join(" "); };

let r = place(ph, [12, 14, 16], ["D", "D", "D"], true);
check("Premiere: first placement adds the set", r.ok && r.data.created === 3 && r.data.replaced === 0, JSON.stringify(r.data || r.error));
r = place(ph, [12, 14, 16], ["D", "D", "D"], true);
check("Premiere: placing again replaces it - one set, not two",
  r.ok && r.data.replaced === 3 && p.clipMarkers.list.filter(function (m) { return m.name === "D" && m.start.seconds < 40; }).length === 3, names());
r = place(ph, [12.5, 13, 14.5, 16.5], ["D", "b", "D", "D"], true);
const inRange = p.clipMarkers.list.filter(function (m) { return m.start.seconds >= 10 && m.start.seconds <= 40 && m.name !== "Chorus"; });
check("Premiere: a shifted set (Shift - / +) replaces the old one, beat markers included",
  r.ok && r.data.replaced === 3 && inRange.length === 4 && inRange[0].start.seconds === 12.5, names());
check("Premiere: the editor's own marker stays", p.clipMarkers.list.indexOf(own) !== -1 && own.name === "Chorus", names());
check("Premiere: our marker outside this instance's range stays", p.clipMarkers.list.indexOf(elsewhere) !== -1, names());
const before = p.clipMarkers.list.length;
r = place(ph, [30], ["D"], false);
check("Premiere: without the flag (Paste markers) nothing is removed", r.ok && r.data.replaced === 0 && p.clipMarkers.list.length === before + 1, names());
// ---- After Effects: the layer starts at comp 5 s, trimmed to source 0-30 s.
const a = mocks.makeAeHost({ mediaPath: "/music/song.mp3", durationSec: 30, startTime: 5 });
const layer = a.comp.layers[0];
const ah = mocks.loadHost(a.context);
layer.markers.setValueAtTime(20, new mocks.MarkerValue("Drop here")); // the editor's own
const comments = function () { return layer.markers.keys.map(function (k) { return k.v.comment + "@" + k.t; }).join(" "); };
r = place(ah, [1, 3, 5], ["D", "D", "D"], true);
r = place(ah, [2, 4, 6], ["D", "b", "D"], true);
const ours = layer.markers.keys.filter(function (k) { return k.v.comment === "D" || k.v.comment === "b"; });
check("After Effects: placing again replaces the earlier set",
  r.ok && r.data.replaced === 3 && ours.length === 3 && ours[0].t === 7, comments());
check("After Effects: the editor's own marker stays", layer.markers.keys.some(function (k) { return k.v.comment === "Drop here"; }), comments());
check("After Effects: removal and placement are one undo step", a.state.undoDepth === 0);
r = place(ah, [8], ["D"], false);
check("After Effects: without the flag nothing is removed", r.ok && r.data.replaced === 0 && layer.markers.keys.length === 5, comments());
// ---- Clear markers (ownOnly) vs a move after copy (everything). Premiere:
// sequence markers inside the clip (ours and the editor's), clip markers
// (ours in range, ours elsewhere, the editor's).
const seqOurs = p.sequence.markers.createMarker(5); seqOurs.name = "D";
const seqTheirs = p.sequence.markers.createMarker(6); seqTheirs.name = "Intro";
// Shift and the "1" buttons ask this before placing again.
const countBefore = JSON.parse(ph.run("countOwnMarkersForSelectedClip()"));
r = JSON.parse(ph.run("clearMarkersForSelectedClip(true)"));
const countAfter = JSON.parse(ph.run("countOwnMarkersForSelectedClip()"));
check("Premiere: the count of Downbeat's markers around the clip, then 0 after Clear",
  countBefore.ok && countBefore.data.count >= 2 && countAfter.ok && countAfter.data.count === 0,
  (countBefore.data && countBefore.data.count) + " -> " + (countAfter.data && countAfter.data.count));
const leftClip = p.clipMarkers.list.map(function (m) { return m.name + "@" + m.start.seconds; }).join(" ");
check("Premiere: Clear removes every Downbeat marker on the media (other pieces too), and only those",
  r.ok && r.data.clipMarkersRemoved === 6 && r.data.sequenceMarkersRemoved === 1 &&
  leftClip === "Chorus@20" && p.sequence.markers.list.length === 1 && p.sequence.markers.list[0] === seqTheirs,
  JSON.stringify(r.data) + " | clip: " + leftClip);
r = JSON.parse(ph.run("clearMarkersForSelectedClip()"));
check("Premiere: a move after copy still removes everything it copied",
  r.ok && r.data.clipMarkersRemoved === 1 && p.clipMarkers.list.length === 0 && p.sequence.markers.list.length === 0, JSON.stringify(r.data));
// After Effects: layer markers (ours, the editor's) and comp markers.
a.comp.markerProperty.setValueAtTime(6, new mocks.MarkerValue("D"));
a.comp.markerProperty.setValueAtTime(9, new mocks.MarkerValue("Scene 2"));
const aeBefore = JSON.parse(ah.run("countOwnMarkersForSelectedClip()"));
r = JSON.parse(ah.run("clearMarkersForSelectedClip(true)"));
const aeAfter = JSON.parse(ah.run("countOwnMarkersForSelectedClip()"));
check("After Effects: the count of Downbeat's markers around the layer, then 0 after Clear",
  aeBefore.ok && aeBefore.data.count === 5 && aeAfter.ok && aeAfter.data.count === 0,
  (aeBefore.data && aeBefore.data.count) + " -> " + (aeAfter.data && aeAfter.data.count));
check("After Effects: Clear removes only Downbeat's markers",
  r.ok && r.data.clipMarkersRemoved === 4 && r.data.sequenceMarkersRemoved === 1 &&
  layer.markers.keys.length === 1 && layer.markers.keys[0].v.comment === "Drop here" &&
  a.comp.markerProperty.keys.length === 1 && a.comp.markerProperty.keys[0].v.comment === "Scene 2" && a.state.undoDepth === 0,
  JSON.stringify(r.data) + " | " + comments());
// ---- The clip / timeline choice: switching target moves the set instead of
// leaving one in each place.
function placeSeq(host, times, labels) {
  return JSON.parse(host.run("createMarkers(" + js(times) + ", " + js(labels) + ", true)"));
}
const p2 = mocks.makePremiereHost({ mediaPath: "/music/song2.mp3", durationSec: 30, clipStart: 100, audioTrackCount: 1 });
const ph2 = mocks.loadHost(p2.context);
const mine2 = p2.sequence.markers.createMarker(110); mine2.name = "Verse";
r = place(ph2, [1, 3, 5], ["D", "D", "D"], true);
check("Premiere: the host reports where it stored the markers", r.ok && r.data.stored.length === 3 && r.data.stored[1].requested === 3 && r.data.stored[1].stored === 3,
  JSON.stringify(r.data.stored));
r = placeSeq(ph2, [101, 103, 105], ["D", "D", "D"]);
const seqNames = p2.sequence.markers.list.map(function (m) { return m.name + "@" + m.start.seconds; }).join(" ");
check("Premiere: switching to the timeline moves the set off the clip",
  r.ok && r.data.replaced === 3 && p2.clipMarkers.list.length === 0 && seqNames === "D@101 D@103 D@105 Verse@110", seqNames);
r = placeSeq(ph2, [102, 104], ["D", "D"]);
check("Premiere: placing on the timeline again replaces it, the editor's marker stays",
  r.ok && r.data.replaced === 3 && p2.sequence.markers.list.map(function (m) { return m.name + "@" + m.start.seconds; }).join(" ") === "D@102 D@104 Verse@110");
r = place(ph2, [2, 4], ["D", "D"], true);
check("Premiere: switching back to the clip moves it back", r.ok && r.data.replaced === 2 && p2.clipMarkers.list.length === 2 &&
  p2.sequence.markers.list.length === 1 && p2.sequence.markers.list[0] === mine2);

const a2 = mocks.makeAeHost({ mediaPath: "/music/song2.mp3", durationSec: 30, startTime: 5 });
const layer2 = a2.comp.layers[0];
const ah2 = mocks.loadHost(a2.context);
layer2.markers.setValueAtTime(15, new mocks.MarkerValue("Hook"));
r = place(ah2, [1, 3], ["D", "D"], true);
r = placeSeq(ah2, [6, 8, 10], ["D", "b", "D"]);
check("After Effects: switching to the timeline moves the set to composition markers, in one undo step",
  r.ok && r.data.replaced === 2 && layer2.markers.keys.length === 1 && layer2.markers.keys[0].v.comment === "Hook" &&
  a2.comp.markerProperty.keys.length === 3 && a2.state.undoDepth === 0, JSON.stringify(r.data));

if (failures) {
  console.error("\n" + failures + " marker replace check(s) failed");
  process.exit(1);
}
console.log("\nplacing markers again replaces Downbeat's own set and nothing else");
