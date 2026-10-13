"use strict";
// Which markers are Downbeat's own: a marker must carry every mark Downbeat
// gives its markers (jsx/host.jsx _dbIsOwnMarker, jsx/host-ae.jsx
// _dbAeIsOwnMarker), so an editor's own marker named D or b is never taken
// by Place or Clear. Checked
// on the real host scripts in stand-in hosts (scripts/host-mocks.js):
//   - host.jsx knows the marker explanation in every panel language;
//   - Premiere: an editor's "D" with its own comment, an editor's "D" with a
//     length, and one of Downbeat's whose comment the editor rewrote stay
//     through Place (on the clip and on the timeline) and Clear; Downbeat's
//     own markers, also a Russian one from an earlier session, go;
//   - After Effects: an editor's "D" in another color, with a length, or
//     even in Downbeat's own color (no "Downbeat" parameter) stays through
//     Place and Clear, on the layer and on the composition, and Place does
//     not write over it at the same time; Downbeat's own markers go.
// Run: node scripts/test-marker-ownership.js
const path = require("path");
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function js(v) { return JSON.stringify(JSON.stringify(v)); }
function place(host, fn, times, labels) {
  return JSON.parse(host.run(fn + "(" + js(times) + ", " + js(labels) + ", true)"));
}
function clear(host) { return JSON.parse(host.run("clearMarkersForSelectedClip()")); }

// ---- The explanation texts match the panel's, in every language.
global.window = global;
require(path.join(__dirname, "..", "js", "i18n.js"));
const I = global.BeatMarkerI18n;
const probe = mocks.makePremiereHost({ mediaPath: "/music/a.mp3", durationSec: 30, clipStart: 0, audioTrackCount: 1 });
const known = JSON.parse(mocks.loadHost(probe.context).run("JSON.stringify(OWN_MARKER_COMMENTS)"));
const missing = [];
I.LANGUAGES.forEach(function (lang) {
  I.setLanguage(lang);
  [["D", "marker.downbeat"], ["b", "marker.beat"]].forEach(function (pair) {
    if (known[pair[0]].indexOf(I.t(pair[1])) === -1) { missing.push(lang + " " + pair[0]); }
  });
});
check("host.jsx knows the marker explanation in every panel language", missing.length === 0, missing.join(", "));
const RU_BEAT = known.b[1];

// ---- Premiere: the clip plays source 0-30 s at timeline 0-30 s.
const p = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 30, clipStart: 0, audioTrackCount: 1 });
const ph = mocks.loadHost(p.context);
const editorD = p.clipMarkers.createMarker(2);
editorD.name = "D"; editorD.comments = "Drop starts here";
const longD = mocks.ownPremiereMarker(p.clipMarkers, 3, "D");
longD.end = 3.4;
const seqEditorD = p.sequence.markers.createMarker(7);
seqEditorD.name = "D"; seqEditorD.comments = "";
const legacyRu = p.clipMarkers.createMarker(9);
legacyRu.name = "b"; legacyRu.comments = RU_BEAT;
const names = function (list) { return list.map(function (m) { return m.name + "@" + m.start.seconds; }).join(" "); };

let r = place(ph, "createClipMarkers", [1, 4, 5], ["D", "b", "D"]);
check("Premiere: Place keeps the editor's D markers, takes the earlier Russian one",
  r.ok && r.data.replaced === 1 && p.clipMarkers.list.indexOf(editorD) !== -1 && p.clipMarkers.list.indexOf(longD) !== -1 &&
  p.clipMarkers.list.indexOf(legacyRu) === -1 && p.sequence.markers.list.indexOf(seqEditorD) !== -1,
  JSON.stringify(r.data) + " | clip: " + names(p.clipMarkers.list));
const rewritten = p.clipMarkers.list.filter(function (m) { return m.start.seconds === 4; })[0];
rewritten.comments = "Snare fill - keep";
r = place(ph, "createClipMarkers", [1, 5], ["D", "D"]);
check("Premiere: Place again replaces Downbeat's set but not a marker whose comment the editor rewrote",
  r.ok && r.data.replaced === 2 && p.clipMarkers.list.indexOf(rewritten) !== -1, names(p.clipMarkers.list));
r = place(ph, "createMarkers", [11, 13], ["D", "D"]);
check("Premiere: Place on the timeline moves Downbeat's set and keeps every editor marker",
  r.ok && r.data.replaced === 2 && names(p.clipMarkers.list) === "D@2 D@3 b@4" &&
  names(p.sequence.markers.list) === "D@7 D@11 D@13", names(p.clipMarkers.list) + " | seq: " + names(p.sequence.markers.list));
r = clear(ph);
check("Premiere: Clear takes only Downbeat's markers",
  r.ok && r.data.sequenceMarkersRemoved === 2 && r.data.clipMarkersRemoved === 0 &&
  names(p.clipMarkers.list) === "D@2 D@3 b@4" && names(p.sequence.markers.list) === "D@7", JSON.stringify(r.data));

// ---- After Effects: the layer starts at comp 5 s, source 0-30 s.
const a = mocks.makeAeHost({ mediaPath: "/music/song.mp3", durationSec: 30, startTime: 5 });
const layer = a.comp.layers[0];
const ah = mocks.loadHost(a.context);
const yellowD = new mocks.MarkerValue("D"); yellowD.label = 2;
layer.markers.setValueAtTime(7, yellowD); // source 2 s
const longAeD = mocks.ownAeMarkerValue("D"); longAeD.duration = 0.4;
layer.markers.setValueAtTime(8, longAeD); // source 3 s
const compD = new mocks.MarkerValue("D");
a.comp.markerProperty.setValueAtTime(12, compD);
const greenD = new mocks.MarkerValue("D"); greenD.label = 9;
layer.markers.setValueAtTime(10, greenD); // source 5 s, Downbeat's color
const compGreenD = new mocks.MarkerValue("D"); compGreenD.label = 9;
a.comp.markerProperty.setValueAtTime(13, compGreenD);
const comments = function (prop) { return prop.keys.map(function (k) { return k.v.comment + "/" + k.v.label + "@" + k.t; }).join(" "); };

r = place(ah, "createClipMarkers", [1, 2, 4], ["D", "b", "D"]);
check("After Effects: Place keeps an editor's D in another color, with a length or in Downbeat's color, and does not write over it",
  r.ok && r.data.replaced === 0 && r.data.kept === 1 && r.data.created === 2 &&
  layer.markers.keys.some(function (k) { return k.v === yellowD && k.t === 7; }) &&
  layer.markers.keys.some(function (k) { return k.v === longAeD; }) &&
  layer.markers.keys.some(function (k) { return k.v === greenD; }), JSON.stringify(r.data) + " | " + comments(layer.markers));
r = place(ah, "createClipMarkers", [1, 4], ["D", "D"]);
check("After Effects: Place again replaces only Downbeat's set",
  r.ok && r.data.replaced === 2 && comments(layer.markers) === "D/9@6 D/2@7 D/9@8 D/9@9 D/9@10", comments(layer.markers));
r = clear(ah);
check("After Effects: Clear takes only Downbeat's markers",
  r.ok && r.data.clipMarkersRemoved === 2 && r.data.sequenceMarkersRemoved === 0 &&
  comments(layer.markers) === "D/2@7 D/9@8 D/9@10" && comments(a.comp.markerProperty) === "D/0@12 D/9@13",
  JSON.stringify(r.data) + " | " + comments(layer.markers));

if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
console.log("PASS: only Downbeat's own markers are replaced or cleared");
