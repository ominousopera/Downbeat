"use strict";
// Place, Clear and the "1" buttons touch only the timeline set placed for
// the selected clip / layer, never another clip's Downbeat markers, even on
// the same frames or where two clips overlap. Real jsx/host.jsx and
// jsx/host-ae.jsx in stand-in hosts (scripts/host-mocks.js):
//   - Premiere finds a clip's set by its marker ids, After Effects by the
//     layer id each composition marker carries;
//   - two songs overlapping: Place and Clear on one keep the other's set;
//   - a moved or shortened clip: its old set goes, another clip's markers
//     at the same times stay;
//   - after a cut, Clear on either piece clears every piece, and placing
//     again on one piece keeps the markers over the other;
//   - After Effects: Clear reaches the other piece's layer markers after
//     Split Layer, finds its set after an Undo without any memory, and
//     works when the marker property answers only to its match name;
//   - Pitch the clip hands the set to the pitched layer;
//   - Premiere: timeline markers pasted onto the same song keep their
//     place in the song.
// Run: node scripts/test-own-markers.js
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function js(v) { return JSON.stringify(JSON.stringify(v)); }
function call(host, fn, args) { return JSON.parse(host.run(fn + "(" + (args || []).join(", ") + ")")); }
function every(from, to, step) { const out = []; for (let t = from; t <= to + 1e-9; t += step) { out.push(Math.round(t * 1000) / 1000); } return out; }
function labels(times) { return times.map(function () { return "D"; }); }
function placeSeq(host, times) { return call(host, "createMarkers", [js(times), js(labels(times)), "true"]); }
function placeClip(host, times) { return call(host, "createClipMarkers", [js(times), js(labels(times)), "true"]); }
function clear(host) { return call(host, "clearMarkersForSelectedClip", ["true"]); }
function select(clips, clip) { clips.forEach(function (c) { c.selected = c === clip; }); }

// ---- Premiere
function ownPr(list, a, b) {
  return list.filter(function (m) { return (m.name === "D" || m.name === "b") && m.start.seconds >= a - 1e-6 && m.start.seconds <= b + 1e-6; }).length;
}
(function () {
  // Song A on A1 0-20 s, song B on A2 12-40 s.
  const p = mocks.makePremiereHost({ mediaPath: "/m/a.wav", durationSec: 20, clipStart: 0, audioTrackCount: 2 });
  p.sequence.sequenceID = "s1";
  const a = p.audioTrack.clips[0];
  const bItem = { name: "b.wav", getMediaPath: function () { return "/m/b.wav"; }, getMarkers: function () { return new mocks.MarkerCollection(); } };
  const b = new mocks.PClip(bItem, 12, 40, 0, false);
  p.sequence.audioTracks[1].clips.push(b);
  const all = [a, b];
  const h = mocks.loadHost(p.context);
  const seq = p.sequence.markers.list;
  const editor = p.sequence.markers.createMarker(14); editor.name = "Verse";
  select(all, b); placeSeq(h, every(12, 40, 2));
  select(all, a); placeClip(h, every(0, 20, 2));
  check("Premiere: Place on a clip keeps another clip's timeline set where the two overlap", ownPr(seq, 12, 20) === 5, String(ownPr(seq, 12, 20)));
  let count = call(h, "countOwnMarkersForSelectedClip");
  check("Premiere: ... and does not count it as this clip's", count.ok && count.data.count === 11, JSON.stringify(count.data));
  clear(h);
  check("Premiere: Clear on that clip keeps it too, and the editor's marker", ownPr(seq, 12, 40) === 15 && seq.indexOf(editor) !== -1);

  // A placed on the timeline, then slid to 100 s; B takes A's old place
  // with a set on the same frames: Place on A takes only A's old set.
  select(all, a); placeSeq(h, every(0, 20, 2));
  a.start = { seconds: 100 }; a.end = { seconds: 120 };
  b.start = { seconds: 0 }; b.end = { seconds: 28 };
  select(all, b); placeSeq(h, every(0, 28, 2));
  check("Premiere: Place on the clip now in a moved clip's old place takes that old set", ownPr(seq, 0, 28) === 15, String(ownPr(seq, 0, 28)));
  select(all, a); placeSeq(h, every(100, 120, 2));
  check("Premiere: Place on the moved clip leaves the other clip's markers on the same frames", ownPr(seq, 0, 28) === 15 && ownPr(seq, 100, 120) === 11,
    ownPr(seq, 0, 28) + " / " + ownPr(seq, 100, 120));

  // Razor at 110 s: placing again on the earlier piece keeps the markers
  // over the later one; Clear on the later piece clears both pieces.
  p.sequence.audioTracks[1].clips.length = 0;
  p.context.qe.project.getActiveSequence().getAudioTrackAt(0).razor("00:01:50:00");
  const later = p.audioTrack.clips[1];
  select(p.audioTrack.clips, a); placeSeq(h, every(100.5, 110, 2));
  check("Premiere: after a cut, placing again on one piece keeps the markers over the other", ownPr(seq, 110.001, 120) === 5, String(ownPr(seq, 110.001, 120)));
  select(p.audioTrack.clips, later); const r = clear(h);
  check("Premiere: Clear on the later piece clears every piece and names the earlier piece's set",
    ownPr(seq, 100, 120) === 0 && r.data.forgetKeys.length === 1, JSON.stringify(r.data));
})();

(function () {
  // Copy timeline markers of a song from its start, paste onto the same
  // song trimmed by 8.3 s: they stay on the song's own beats.
  const p = mocks.makePremiereHost({ mediaPath: "/m/song.wav", durationSec: 60, clipStart: 10 });
  const h = mocks.loadHost(p.context);
  placeSeq(h, every(10, 70, 2));
  const copied = call(h, "getMarkersDataForSelectedClip");
  p.sequence.markers.list.length = 0;
  const clip2 = new mocks.PClip(p.audioTrack.clips[0].projectItem, 0, 51.7, 8.3, true);
  p.audioTrack.clips.length = 0; p.audioTrack.clips.push(clip2);
  const target = call(h, "getSelectedAudioInfo").data;
  const r = call(h, "pasteMarkersData", [js(copied.data), js(target)]);
  const off = p.sequence.markers.list.map(function (m) { const s = m.start.seconds + 8.3; return Math.abs(s / 2 - Math.round(s / 2)); });
  check("Premiere: timeline markers pasted onto the same song keep their place in the song",
    r.ok && r.data.created === 26 && Math.max.apply(null, off) < 1e-6, JSON.stringify(r.data));
})();

// ---- After Effects
function ownAe(prop, a, b) {
  return prop.keys.filter(function (k) { return k.v.params && k.v.params.Downbeat === k.v.comment && k.t >= a - 1e-6 && k.t <= b + 1e-6; }).length;
}
(function () {
  const f = mocks.makeAeHost({ mediaPath: "/m/a.wav", durationSec: 20, startTime: 0, compDuration: 400 });
  const comp = f.comp, cm = comp.markerProperty;
  const a = comp.layers[0];
  const b = new mocks.Layer(comp, { name: "b.wav", startTime: 12, inPoint: 12, outPoint: 40, hasAudio: true,
    source: { file: { fsName: "/m/b.wav" }, footageMissing: false } });
  comp.layers.unshift(b);
  const all = [a, b];
  const h = mocks.loadHost(f.context);
  select(all, b); placeSeq(h, every(12, 40, 2));
  check("After Effects: composition markers carry the id of the layer they were placed for",
    cm.keys.every(function (k) { return k.v.params.DownbeatLayer === String(b.id); }));
  select(all, a); placeClip(h, every(0, 20, 2));
  clear(h);
  check("After Effects: Place and Clear on a layer keep another layer's set where the two overlap", ownAe(cm, 12, 20) === 5, String(ownAe(cm, 12, 20)));

  // Place, slide the layer, Place, Edit > Undo (the old set is back, no
  // memory says where), Clear: the tag still finds it.
  select(all, a); placeSeq(h, every(0, 20, 2));
  const before = cm.keys.slice();
  a.startTime = 200; a.inPoint = 200; a.outPoint = 220;
  placeSeq(h, every(200, 220, 2));
  cm.keys = before; // what Undo puts back
  clear(h);
  check("After Effects: after an Undo, Clear still finds the layer's set outside it, and only that",
    ownAe(cm, 0, 11.9) === 0 && ownAe(cm, 12, 40) === 15 && ownAe(cm, 0, 400) === 15, ownAe(cm, 0, 400) + " left");

  // Split Layer at 210 s: placing again on the first piece keeps the
  // markers over the second; Clear clears both pieces, layer markers too.
  placeSeq(h, every(200, 220, 2));
  placeClip(h, every(0, 20, 2));
  placeSeq(h, every(200, 220, 2));
  const split = call(h, "testRazorAtSeconds", ["210"]);
  const second = comp.layers.filter(function (l) { return l.source === a.source && l !== a; })[0];
  select(comp.layers, a); placeSeq(h, every(201, 209, 2));
  check("After Effects: after Split Layer, placing again on one piece keeps the markers over the other",
    split.ok && ownAe(cm, 210.001, 220) === 5, ownAe(cm, 210.001, 220) + "");
  second.markers.setValueAtTime(215, mocks.ownAeMarkerValue("D"));
  select(comp.layers, second); const r = clear(h);
  check("After Effects: Clear on a piece clears every piece, layer markers included",
    ownAe(cm, 200, 220) === 0 && ownAe(a.markers, 0, 400) === 0 && ownAe(second.markers, 0, 400) === 0 && f.state.undoDepth === 0, JSON.stringify(r.data));
})();

(function () {
  // Pitch the clip: the pitched layer takes the original's set, so Place
  // on it leaves nothing after its shorter end.
  const f = mocks.makeAeHost({ mediaPath: __filename, durationSec: 60, startTime: 2, compDuration: 200 });
  const comp = f.comp, cm = comp.markerProperty;
  const realImport = f.context.app.project.importFile;
  f.context.app.project.importFile = function (io) { const it = realImport(io); it.duration = 60; return it; };
  const h = mocks.loadHost(f.context);
  let info = call(h, "getSelectedAudioInfo").data;
  placeSeq(h, every(2, 62, 2));
  const speed = Math.pow(2, 2 / 12);
  const r = call(h, "insertAudioAtPlayhead", [js(__filename), "60", js({ atSeconds: 2, muteSelected: true, selectInserted: true, inSec: 0, outSec: 60, speed: speed, pitchReference: info })]);
  const pitched = comp.layers[0];
  placeSeq(h, every(2, pitched.outPoint - 0.01, 2 / speed));
  check("After Effects: after Pitch the clip, Place on the pitched layer leaves none of the first set after its end",
    r.ok && ownAe(cm, pitched.outPoint + 0.01, 200) === 0, ownAe(cm, pitched.outPoint + 0.01, 200) + " left");
})();

(function () {
  // A Marker property that answers only to its match name, as in an After
  // Effects that is not in English.
  const english = mocks.Layer.prototype.property;
  mocks.Layer.prototype.property = function (name) { return name === "Marker" ? null : english.call(this, name); };
  try {
    const f = mocks.makeAeHost({ mediaPath: "/m/c.wav", durationSec: 20, startTime: 0 });
    const h = mocks.loadHost(f.context);
    const placed = placeClip(h, [1, 2]);
    const cleared = clear(h);
    check("After Effects: layer markers are reached by their match name", placed.ok && placed.data.created === 2 && cleared.ok && cleared.data.clipMarkersRemoved === 2,
      (placed.error || "") + " " + (cleared.error || ""));
  } finally {
    mocks.Layer.prototype.property = english;
  }
})();

if (failures) { console.error("\n" + failures + " own-marker check(s) failed"); process.exit(1); }
console.log("\nPASS: Place and Clear touch only the selected clip's own set");
