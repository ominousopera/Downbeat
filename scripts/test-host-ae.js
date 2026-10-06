"use strict";
// Checks what the panel depends on: layer time <-> source time mapping, the
// selection rules, marker colors, splitting, undo groups always closed, and
// that Premiere still takes its own path.
// What this cannot prove: that After Effects accepts these exact calls. The
// calls used (setValueAtTime with MarkerValue, MarkerValue.label,
// comp.markerProperty, duplicate/inPoint/outPoint, setValuesAtTimes) are the
// documented ones; running the self-test inside After Effects is the real
// check. Run: node scripts/test-host-ae.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
// DOWNBEAT_ROOT: build-zxp.sh points this at the staged release copy.
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const hostAe = fs.readFileSync(path.join(ROOT, "jsx", "host-ae.jsx"), "utf8");
const host = fs.readFileSync(path.join(ROOT, "jsx", "host.jsx"), "utf8");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
// ExtendScript is ES3: none of these exist there, and a call to one throws
// only when that line runs - in the user's After Effects, not here.
const es3Problems = [];
hostAe.split("\n").forEach(function (line, i) {
  const code = line.replace(/\/\/.*$/, "");
  [[/=>/, "arrow function"], [/\b(let|const)\s/, "let/const"], [/\.(map|forEach|filter|some|every|reduce|find|includes)\(/, "ES5+ array method"],
   [/`/, "template literal"], [/Array\.isArray|Object\.keys/, "ES5 builtin"], [/,\s*[}\]]/, "trailing comma"]].forEach(function (rule) {
    if (rule[0].test(code)) { es3Problems.push((i + 1) + ": " + rule[1]); }
  });
});
check("host-ae.jsx uses only what ExtendScript (ES3) has", es3Problems.length === 0, es3Problems.slice(0, 3).join("; "));
const { MarkerValue, ScaleProp, CompItem, Layer } = require("./host-mocks.js");

let undoDepth = 0;
const audioFile = { file: { fsName: "/music/song.mp3" }, footageMissing: false };
const videoFile = { file: { fsName: "/video/clip.mp4" }, footageMissing: false };
function freshComp() {
  const comp = new CompItem({ frameRate: 25, duration: 60 });
  // Source second 0 sits at comp 10 s; the layer is trimmed to show source
  // 2..30 s (comp 12..40).
  comp.layers.push(new Layer(comp, { name: "song.mp3", startTime: 10, inPoint: 12, outPoint: 40, hasAudio: true, source: audioFile, selected: true }));
  comp.layers.push(new Layer(comp, { name: "clip.mp4", startTime: 0, inPoint: 0, outPoint: 60, hasVideo: true, source: videoFile }));
  return comp;
}

const context = {
  JSON: JSON, Math: Math, Number: Number, String: String, isNaN: isNaN, Error: Error,
  MarkerValue: MarkerValue, CompItem: CompItem,
  BridgeTalk: { appName: "aftereffects" },
  app: {
    project: { activeItem: null },
    beginUndoGroup: function () { undoDepth++; },
    endUndoGroup: function () { undoDepth--; }
  },
  Folder: {}, File: function () {}
};
vm.createContext(context);
vm.runInContext(hostAe + "\n" + host.replace(/^#include .*$/mg, ""), context, { filename: "host.jsx" });

function call(src) { return JSON.parse(vm.runInContext(src, context)); }
function js(v) { return JSON.stringify(JSON.stringify(v)); }

let comp = freshComp();
context.app.project.activeItem = comp;
const song = comp.layers[0];
const clip = comp.layers[1];
// Selection and time mapping.
let r = call("getSelectedAudioInfo()");
check("the selected audio layer is read as a clip: start, in and out in the panel's terms",
  r.ok && r.data.clipStartSeconds === 12 && r.data.inPointSeconds === 2 && r.data.outPointSeconds === 30 &&
  r.data.frameRate === 25 && r.data.mediaPath === "/music/song.mp3" && r.data.host === "ae",
  JSON.stringify(r.data || r.error));

song.selected = false;
r = call("getSelectedAudioInfo()");
check("nothing selected is a clear error", !r.ok && /Nothing selected/.test(r.error), r.error);
clip.selected = true;
r = call("getSelectedAudioInfo()");
check("a video-only layer is not taken for audio", !r.ok && /no audio/.test(r.error), r.error);
song.selected = true;
r = call("getSelectedAudioInfo()");
check("audio + video layers selected: the audio one is used", r.ok && r.data.layerName === "song.mp3");
clip.selected = false;

song.stretch = 50;
r = call("getSelectedAudioInfo()");
check("a time-stretched layer is refused, not given misplaced markers", !r.ok && /time-stretched/.test(r.error), r.error);
song.stretch = 100;
song.timeRemapEnabled = true;
r = call("getSelectedAudioInfo()");
check("a time-remapped layer is refused too", !r.ok && /Time Remapping/.test(r.error), r.error);
song.timeRemapEnabled = false;
song.source = { mainSource: {} };
r = call("getSelectedAudioInfo()");
check("a precomp layer is refused with a hint", !r.ok && /not a file/.test(r.error), r.error);
song.source = audioFile;
context.app.project.activeItem = null;
r = call("getSelectedAudioInfo()");
check("no open composition is a clear error", !r.ok && /No active composition/.test(r.error), r.error);
context.app.project.activeItem = comp;
// Layer markers: source seconds in, comp seconds on the layer.
r = call("createClipMarkers(" + js([1, 2.5, 5, 100]) + ", " + js(["D", "b", "D", "D"]) + ")");
const lk = song.markers.keys;
check("layer markers land at layer start + source time, outside the trim skipped",
  r.ok && r.data.created === 2 && r.data.skipped === 2 && lk.length === 2 && lk[0].t === 12.5 && lk[1].t === 15,
  JSON.stringify(r.data) + " at " + lk.map(function (k) { return k.t; }).join(", "));
check("marker colors and names follow the same types as in Premiere",
  lk[0].v.comment === "b" && lk[0].v.label === 8 && lk[1].v.comment === "D" && lk[1].v.label === 9,
  lk.map(function (k) { return k.v.comment + "/" + k.v.label; }).join(", "));
check("the undo group is closed", undoDepth === 0);
check("where After Effects put the first markers comes back for the log",
  r.ok && r.data.stored.length === 2 && r.data.stored[0].requested === 12.5 && r.data.stored[0].stored === 12.5,
  JSON.stringify(r.data.stored));
r = call("createClipMarkers(" + js([3, 4]) + ", " + js(["Verse: 2", "D:1"]) + ")");
const colonKeys = song.markers.keys.filter(function (k) { return k.t === 13 || k.t === 14; });
check("a colon in the user's own marker text is kept; our code before a colon still colors it",
  r.ok && colonKeys.length === 2 && colonKeys[0].v.comment === "Verse: 2" && colonKeys[0].v.label === 0 &&
  colonKeys[1].v.comment === "1" && colonKeys[1].v.label === 9,
  colonKeys.map(function (k) { return k.v.comment + "/" + k.v.label; }).join(", "));
song.markers.keys = song.markers.keys.filter(function (k) { return k.t !== 13 && k.t !== 14; });
// Composition markers, then copy.
r = call("createMarkers(" + js([13, 50]) + ", " + js(["D", "D"]) + ")");
check("composition markers are placed at comp times", r.ok && r.data.created === 2 && comp.markerProperty.numKeys === 2);
r = call("getMarkersDataForSelectedClip()");
check("copy returns layer markers in source seconds and comp markers from the layer start",
  r.ok && r.data.clipMarkers.map(function (m) { return m.localSeconds; }).join() === "2.5,5" &&
  r.data.sequenceMarkers.length === 1 && r.data.sequenceMarkers[0].localSeconds === 1,
  JSON.stringify(r.data));
// Clear: everything on the layer, comp markers only inside it.
r = call("clearMarkersForSelectedClip()");
check("clear removes the layer's markers and only comp markers inside the layer",
  r.ok && r.data.clipMarkersRemoved === 2 && r.data.sequenceMarkersRemoved === 1 && song.markers.numKeys === 0 &&
  comp.markerProperty.numKeys === 1 && comp.markerProperty.keyTime(1) === 50, JSON.stringify(r.data));
// Split at beats: frame-snapped, pieces tile the original range.
r = call("razorAtManySeconds(" + js([15, 20.013, 5, 45]) + ")");
const pieces = comp.layers.filter(function (l) { return l.source === audioFile; })
  .map(function (l) { return [l.inPoint, l.outPoint]; }).sort(function (a, b) { return a[0] - b[0]; });
check("splitting makes pieces at the (frame-snapped) times, outside ones reported",
  r.ok && r.data.cut === 2 && r.data.failures.length === 2 && JSON.stringify(pieces) === "[[12,15],[15,20],[20,40]]",
  JSON.stringify(pieces) + ", failures at " + (r.data ? r.data.failures.map(function (f) { return f.seconds; }).join(", ") : r.error));
check("the undo group is closed after splitting", undoDepth === 0);
const selectedAudio = comp.layers.filter(function (l) { return l.selected && l.hasAudio; });
check("after splitting only the earliest piece stays selected, as in Premiere",
  selectedAudio.length === 1 && selectedAudio[0].inPoint === 12 && selectedAudio[0].outPoint === 15,
  selectedAudio.length + " selected: " + selectedAudio.map(function (l) { return l.inPoint + "-" + l.outPoint; }).join(", "));

check("no undo group left open anywhere", undoDepth === 0, "depth " + undoDepth);
// Premiere still goes its own way.
context.BridgeTalk.appName = "premierepro";
context.app.project.activeSequence = null;
r = call("getSelectedAudioInfo()");
check("in Premiere the Premiere half answers", !r.ok && /No active sequence/.test(r.error), r.error);

if (failures) {
  console.error("\n" + failures + " After Effects host check(s) failed");
  process.exit(1);
}
console.log("\nAfter Effects host functions behave like the Premiere ones");
