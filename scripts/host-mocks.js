"use strict";
// Small stand-ins for Premiere Pro's and After Effects' scripting DOMs, so
// the real jsx/host.jsx (+ host-ae.jsx) can run under Node. After Effects: a
// comp with layers (startTime/inPoint/outPoint, stretch, time remap), Marker
// properties keyed in comp time, duplicate() above the original, and a Scale
// property. Used by test-host-ae.js and test-self-test.js.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
// DOWNBEAT_ROOT: build-zxp.sh points this at the staged release copy.
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
// ---------------- After Effects ----------------
function MarkerValue(comment) { this.comment = comment; this.label = 0; }
function MarkerProp() { this.keys = []; }
MarkerProp.prototype.setValueAtTime = function (t, v) {
  this.keys = this.keys.filter(function (k) { return Math.abs(k.t - t) > 1e-9; });
  this.keys.push({ t: t, v: v });
  this.keys.sort(function (a, b) { return a.t - b.t; });
};
Object.defineProperty(MarkerProp.prototype, "numKeys", { get: function () { return this.keys.length; } });
MarkerProp.prototype.keyTime = function (i) { return this.keys[i - 1].t; };
MarkerProp.prototype.nearestKeyIndex = function (t) {
  let best = 1;
  for (let i = 1; i <= this.keys.length; i++) {
    if (Math.abs(this.keys[i - 1].t - t) < Math.abs(this.keys[best - 1].t - t)) { best = i; }
  }
  return best;
};
MarkerProp.prototype.keyValue = function (i) { return this.keys[i - 1].v; };
MarkerProp.prototype.removeKey = function (i) { this.keys.splice(i - 1, 1); };

function ScaleProp(dims) { this.value = dims === 3 ? [100, 100, 100] : [100, 100]; this.canVaryOverTime = true; this.keys = []; }
ScaleProp.prototype.setValuesAtTimes = function (times, values) {
  for (let i = 0; i < times.length; i++) { this.keys.push({ t: times[i], v: values[i] }); }
};
ScaleProp.prototype.setValueAtTime = function (t, v) { this.keys.push({ t: t, v: v }); };

function CompItem(opts) {
  this.name = opts.name || "Comp 1";
  this.frameRate = opts.frameRate || 25;
  this.duration = opts.duration || 60;
  this.layers = [];
  this.markerProperty = new MarkerProp();
}
Object.defineProperty(CompItem.prototype, "numLayers", { get: function () { return this.layers.length; } });
Object.defineProperty(CompItem.prototype, "selectedLayers", { get: function () { return this.layers.filter(function (l) { return l.selected; }); } });
CompItem.prototype.layer = function (i) { return this.layers[i - 1]; };

function Layer(comp, opts) {
  Object.assign(this, { stretch: 100, timeRemapEnabled: false, hasAudio: false, hasVideo: false, selected: false, source: null }, opts);
  this.comp = comp;
  this.markers = new MarkerProp();
  this.scale = new ScaleProp(opts.threeD ? 3 : 2);
}
Object.defineProperty(Layer.prototype, "index", { get: function () { return this.comp.layers.indexOf(this) + 1; } });
Layer.prototype.remove = function () { this.comp.layers.splice(this.comp.layers.indexOf(this), 1); };
Layer.prototype.property = function (name) {
  if (name === "Marker") { return this.markers; }
  const self = this;
  if (name === "ADBE Transform Group") { return { property: function (n) { return n === "ADBE Scale" ? self.scale : null; } }; }
  if (name === "ADBE Audio Group" && this.hasAudio) {
    this.levels = this.levels || new ScaleProp(2);
    return { property: function (n) { return n === "ADBE Audio Levels" ? self.levels : null; } };
  }
  return null;
};
// Like After Effects: the copy goes directly above the original and is
// selected too (the host must deselect it itself).
Layer.prototype.duplicate = function () {
  const copy = new Layer(this.comp, { name: this.name, startTime: this.startTime, inPoint: this.inPoint, outPoint: this.outPoint,
    hasAudio: this.hasAudio, hasVideo: this.hasVideo, source: this.source, selected: this.selected });
  copy.markers.keys = this.markers.keys.slice();
  this.comp.layers.splice(this.comp.layers.indexOf(this), 0, copy);
  return copy;
};

function FootageItem(file) { this.file = file; this.name = path.basename(file.fsName); this.parentFolder = null; }
function FolderItem(name) { this.name = name; }
function ImportOptions(file) { this.file = file; }
// ExtendScript's File, backed by the real disk (tests pass real paths).
function MockFile(p) { this.fsName = String(p); this.exists = fs.existsSync(String(p)); }
MockFile.nextSave = null;
MockFile.nextOpen = null;
MockFile.prototype.saveDlg = function () { return MockFile.nextSave ? new MockFile(MockFile.nextSave) : null; };
MockFile.openDialog = function () { return MockFile.nextOpen ? new MockFile(MockFile.nextOpen) : null; };
// A comp holding the audio file as one selected layer (source 0 at comp
// `startTime`, trimmed to the whole file) plus an unselected video layer.
function makeAeHost(opts) {
  const comp = new CompItem({ frameRate: opts.frameRate || 25, duration: opts.compDuration || (opts.startTime || 0) + opts.durationSec + 5 });
  const audioSource = { file: { fsName: opts.mediaPath }, footageMissing: false };
  const layer = new Layer(comp, { name: path.basename(opts.mediaPath), startTime: opts.startTime || 0,
    inPoint: opts.startTime || 0, outPoint: (opts.startTime || 0) + opts.durationSec, hasAudio: true, source: audioSource, selected: true });
  comp.layers.push(layer);
  comp.layers.push(new Layer(comp, { name: "video.mp4", startTime: 0, inPoint: 0, outPoint: comp.duration, hasVideo: true,
    source: { file: { fsName: "/video/video.mp4" }, footageMissing: false } }));
  const state = { undoDepth: 0 };
  comp.time = opts.compTime || 0;
  // Library insert: a new layer goes on top, starting at comp time 0 until
  // the host moves it.
  comp.layers.add = function (item) {
    const l = new Layer(comp, { name: item.name, startTime: 0, inPoint: 0, outPoint: opts.insertDurationSec || 5, hasAudio: true, source: item });
    // opts.stretchIgnored: a Time Stretch that does not take (a half-set
    // layer).
    if (opts.stretchIgnored) { Object.defineProperty(l, "stretch", { get: function () { return 100; }, set: function () {} }); }
    comp.layers.unshift(l);
    return l;
  };
  const items = [];
  items.addFolder = function (name) { const f = new FolderItem(name); items.push(f); return f; };
  const project = {
    activeItem: comp,
    items: items,
    item: function (i) { return items[i - 1]; },
    importFile: function (io) { const it = new FootageItem(io.file); items.push(it); return it; }
  };
  Object.defineProperty(project, "numItems", { get: function () { return items.length; } });
  const context = {
    MarkerValue: MarkerValue, CompItem: CompItem, FootageItem: FootageItem, FolderItem: FolderItem,
    ImportOptions: ImportOptions, File: MockFile,
    BridgeTalk: { appName: "aftereffects" },
    app: {
      project: project,
      beginUndoGroup: function () { state.undoDepth++; },
      endUndoGroup: function () { state.undoDepth--; }
    }
  };
  return { context: context, comp: comp, audioSource: audioSource, state: state, items: items };
}
// ---------------- Premiere Pro ----------------
const TICKS_PER_SECOND = 254016000000;
function T(s) { return { seconds: s, ticks: String(Math.round(s * TICKS_PER_SECOND)) }; }
function listWith(countName, items) {
  Object.defineProperty(items, countName, { get: function () { return items.length; } });
  return items;
}
function MarkerCollection() { this.list = []; }
MarkerCollection.prototype.createMarker = function (seconds) {
  const m = { start: T(seconds), end: T(seconds), name: "", comments: "", colorIndex: -1,
    setColorByIndex: function (i) { this.colorIndex = i; } };
  this.list.push(m);
  this.list.sort(function (a, b) { return a.start.seconds - b.start.seconds; });
  return m;
};
MarkerCollection.prototype.getFirstMarker = function () { return this.list[0]; };
MarkerCollection.prototype.getNextMarker = function (m) { return this.list[this.list.indexOf(m) + 1]; };
MarkerCollection.prototype.deleteMarker = function (m) { this.list.splice(this.list.indexOf(m), 1); };
Object.defineProperty(MarkerCollection.prototype, "numMarkers", { get: function () { return this.list.length; } });

function PClip(projectItem, start, end, inPoint, selected) {
  this.name = projectItem.name;
  this.projectItem = projectItem;
  this.start = T(start);
  this.end = T(end);
  this.inPoint = T(inPoint);
  this.outPoint = T(inPoint + (end - start));
  this.selected = !!selected;
  this.components = listWith("numItems", []);
}
PClip.prototype.isSelected = function () { return this.selected; };
// Speed and direction: 1 and forward until the QE item's setSpeed changes
// them.
PClip.prototype.getSpeed = function () { return this._speed || 1; };
PClip.prototype.isSpeedReversed = function () { return !!this._reversed; };
// A sequence with the audio file as one selected clip on A1 at `clipStart`,
// and one unselected video clip on V1.
function makePremiereHost(opts) {
  const fps = opts.frameRate || 25;
  const clipMarkers = new MarkerCollection();
  const projectItem = { name: path.basename(opts.mediaPath), getMediaPath: function () { return opts.mediaPath; },
    getMarkers: function () { return clipMarkers; } };
  const start = opts.clipStart || 0;
  const audioTrack = { clips: listWith("numItems", [new PClip(projectItem, start, start + opts.durationSec, 0, true)]) };
  const videoItem = { name: "video.mp4", getMediaPath: function () { return "/video/video.mp4"; }, getMarkers: function () { return new MarkerCollection(); } };
  const videoTrack = { clips: listWith("numItems", [new PClip(videoItem, 0, start + opts.durationSec, 0, false)]) };
  const extraTracks = [];
  for (let i = 1; i < (opts.audioTrackCount || 1); i++) { extraTracks.push({ clips: listWith("numItems", []) }); }
  const allAudio = [audioTrack].concat(extraTracks);
  const playhead = { seconds: opts.playheadSeconds || 0 };
  allAudio.forEach(function (track) {
    track.locked = false;
    track.isLocked = function () { return track.locked; };
    track.overwriteClip = function (item, time) {
      const at = typeof time === "object" ? time.seconds : Number(time);
      const inS = typeof item._in === "number" ? item._in : 0;
      const outS = typeof item._out === "number" ? item._out : inS + (opts.insertDurationSec || 5);
      const clip = new PClip(item, at, at + (outS - inS), inS, false);
      clip.remove = function () { track.clips.splice(track.clips.indexOf(clip), 1); return true; };
      track.clips.push(clip);
      track.clips.sort(function (a, b) { return a.start.seconds - b.start.seconds; });
      return true;
    };
  });
  function makeBin(name) {
    return { type: 2, name: name, children: listWith("numItems", []),
      createBin: function (n) { const b = makeBin(n); this.children.push(b); return b; } };
  }
  const rootItem = makeBin("root");
  rootItem.type = 3;
  const sequence = {
    audioTracks: listWith("numTracks", allAudio),
    getPlayerPosition: function () { return T(playhead.seconds); },
    videoTracks: listWith("numTracks", [videoTrack]),
    markers: new MarkerCollection(),
    getSettings: function () { return { videoFrameRate: { ticks: String(TICKS_PER_SECOND / fps) } }; }
  };
  function razorTrack(track, timecode) {
    const p = timecode.split(":").map(Number);
    const t = ((p[0] * 60 + p[1]) * 60 + p[2]) + p[3] / fps;
    for (let i = 0; i < track.clips.length; i++) {
      const c = track.clips[i];
      if (t > c.start.seconds + 1e-6 && t < c.end.seconds - 1e-6) {
        const right = new PClip(c.projectItem, t, c.end.seconds, c.inPoint.seconds + (t - c.start.seconds), false);
        c.end = T(t);
        c.outPoint = T(c.inPoint.seconds + (t - c.start.seconds));
        track.clips.splice(i + 1, 0, right);
        return true;
      }
    }
    return false;
  }
  const context = {
    BridgeTalk: { appName: "premierepro" },
    ProjectItemType: { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 },
    File: MockFile,
    app: { project: { activeSequence: sequence, rootItem: rootItem,
      importFiles: function (paths, suppressUI, bin) {
        paths.forEach(function (p) {
          const it = { type: 1, name: path.basename(p), getMediaPath: function () { return p; } };
          if (!opts.noInOut) {
            it.setInPoint = function (s) { it._in = Number(s); };
            it.setOutPoint = function (s) { it._out = Number(s); };
            it.clearInPoint = function () { delete it._in; };
            it.clearOutPoint = function () { delete it._out; };
          }
          bin.children.push(it);
        });
        return true;
      } }, enableQE: function () {} },
    qe: { project: {
      getAudioTransitionByName: function (name) { return /^(Constant Power|Constant Gain|Exponential Fade)$/.test(name) ? { name: name } : null; },
      getActiveSequence: function () {
        return { getAudioTrackAt: function (i) {
          const track = sequence.audioTracks[i];
          return {
            razor: function (tc) { return razorTrack(track, tc); },
            get numItems() { return track.clips.length; },
            getItemAt: function (j) {
              const c = track.clips[j];
              return { type: "Clip", start: { secs: c.start.seconds }, end: { secs: c.end.seconds },
                reflect: { methods: [{ name: "addTransition" }, { name: "getFadeCurve" },
                  { name: "setSpeed", arguments: [{ name: "speed", dataType: "number" }, { name: "stretch", dataType: "string" },
                    { name: "reverse", dataType: "boolean" }, { name: "keepPitch", dataType: "boolean" }, { name: "ripple", dataType: "boolean" }] }],
                  properties: [{ name: "name" }] },
                // Like Premiere: the clip plays `speed` times as fast, so it
                // gets shorter by that (opts.speedBehavior "ignore" = the
                // call does nothing, "wrongLength" = the clip is left at
                // twice the length, which the host then has to fix).
                setSpeed: function (speed, stretch, reverse) {
                  if (opts.speedBehavior === "ignore") { return true; }
                  const len = c.end.seconds - c.start.seconds;
                  c._speed = speed;
                  c._reversed = !!reverse;
                  c.end = T(c.start.seconds + (opts.speedBehavior === "wrongLength" ? len * 2 : len / speed));
                  return true;
                },
                addTransition: function (tr, atStart, frames) { (c.transitions = c.transitions || []).push({ name: tr.name, atStart: atStart, frames: frames }); return true; } };
            }
          };
        } };
      } } },
    Time: function () { this.seconds = 0; }
  };
  return { context: context, sequence: sequence, audioTrack: audioTrack, clipMarkers: clipMarkers, rootItem: rootItem, playhead: playhead };
}
// Loads the real host.jsx (with host-ae.jsx inlined for its #include) into a
// fresh VM context around `hostContext`. Returns evalScript(script, cb)
// shaped like CSInterface's: a thrown script answers "EvalScript error.".
function loadHost(hostContext) {
  const ctx = Object.assign({ JSON: JSON, Math: Math, Number: Number, String: String, isNaN: isNaN, Error: Error,
    Folder: {}, File: MockFile, $: { os: "Macintosh OS 15.0" } }, hostContext);
  vm.createContext(ctx);
  const hostAe = fs.readFileSync(path.join(ROOT, "jsx", "host-ae.jsx"), "utf8");
  const host = fs.readFileSync(path.join(ROOT, "jsx", "host.jsx"), "utf8");
  vm.runInContext(hostAe + "\n" + host.replace(/^#include .*$/mg, ""), ctx, { filename: "host.jsx" });
  return {
    context: ctx,
    run: function (script) { return vm.runInContext(script, ctx); },
    evalScript: function (script, callback) {
      let out;
      try {
        out = vm.runInContext(script, ctx);
      } catch (e) {
        out = "EvalScript error.";
      }
      if (callback) { setImmediate(function () { callback(out === undefined ? "undefined" : String(out)); }); }
    }
  };
}

module.exports = {
  MarkerValue: MarkerValue, MarkerProp: MarkerProp, ScaleProp: ScaleProp, CompItem: CompItem, Layer: Layer,
  FootageItem: FootageItem, FolderItem: FolderItem,
  makeAeHost: makeAeHost, makePremiereHost: makePremiereHost, loadHost: loadHost,
  PClip: PClip, MarkerCollection: MarkerCollection
};
