"use strict";
// Pitch the clip and the Premiere insert helper, through the real
// jsx/host.jsx + host-ae.jsx on the stand-in hosts (scripts/host-mocks.js):
// a muted track is not free; a refused item In / Out never lays the whole
// file over the editor's clips; the editor's In / Out on a bin item stay as
// they were; media with two mono channels needs two free tracks and both
// parts get the speed; a file with picture goes in as sound only; a refused
// pitch leaves no item in the bin; the original's other channel goes off
// with it and its picture stays on; After Effects carries the editor's
// layer markers onto the pitched layer.
// Run: node scripts/test-pitch-inserts.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function js(v) { return JSON.stringify(JSON.stringify(v)); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-pitch-inserts-"));
const music = path.join(dir, "cue.wav"), sound = path.join(dir, "rain.wav"), movie = path.join(dir, "take.mov");
[music, sound, movie].forEach(function (f) { fs.writeFileSync(f, "x"); });
const rate = Math.pow(2, 2 / 12);
function pitchOpts(ref) {
  return { atSeconds: ref.clipStartSeconds, muteSelected: true, selectInserted: true, inSec: ref.inPointSeconds,
    outSec: ref.outPointSeconds, speed: rate, reverse: false, pitchReference: ref };
}
function pitch(host, media) {
  const ref = JSON.parse(host.run("getSelectedAudioInfo()")).data;
  return JSON.parse(host.run("insertAudioAtPlayhead(" + js(media) + ", " + ref.outPointSeconds + ", " + js(pitchOpts(ref)) + ")"));
}
function binItems(fake) {
  const downbeat = fake.rootItem.children.filter(function (c) { return c.name === "Downbeat"; })[0];
  let n = 0;
  (downbeat ? downbeat.children : []).forEach(function (b) { n += b.children ? b.children.length : 1; });
  return n;
}
// Every item the stand-in imports gets `decorate` applied.
function decorateImports(fake, decorate) {
  const importFiles = fake.context.app.project.importFiles;
  fake.context.app.project.importFiles = function (paths, suppressUI, bin) {
    const n = bin.children.length;
    const answer = importFiles(paths, suppressUI, bin);
    bin.children.slice(n).forEach(decorate);
    return answer;
  };
}

try {
  // ---- A muted track is not free.
  (function () {
    const p = mocks.makePremiereHost({ mediaPath: music, durationSec: 8, clipStart: 3, audioTrackCount: 3, insertDurationSec: 8 });
    p.sequence.audioTracks[1].isMuted = function () { return true; };
    const r = pitch(mocks.loadHost(p.context), music);
    check("Premiere: Pitch the clip skips a muted track (A2) and lands on A3", r.ok && r.data.where === "A3" && p.sequence.audioTracks[1].clips.length === 0,
      JSON.stringify(r));
  })();

  // ---- Item In / Out refused, an editor's clip further along.
  (function () {
    const p = mocks.makePremiereHost({ mediaPath: music, durationSec: 60, clipStart: 0, playheadSeconds: 10, audioTrackCount: 2, insertDurationSec: 60, noInOut: true });
    const a2 = p.sequence.audioTracks[1];
    const editorItem = { name: "dialogue.wav", getMediaPath: function () { return "/vo/dialogue.wav"; }, getMarkers: function () { return new mocks.MarkerCollection(); } };
    a2.clips.push(new mocks.PClip(editorItem, 13, 20, 0, false));
    let overwrites = 0;
    const real = a2.overwriteClip;
    a2.overwriteClip = function () { overwrites++; return real.apply(a2, arguments); };
    const r = JSON.parse(mocks.loadHost(p.context).run("insertAudioAtPlayhead(" + js(sound) + ", 60, " + js({ inSec: 1, outSec: 3 }) + ")"));
    check("Premiere: In / Out refused by the item - the whole file is not laid over the editor's clip", !r.ok && overwrites === 0 &&
      a2.clips.length === 1 && a2.clips[0].name === "dialogue.wav", JSON.stringify(r));
  })();

  // ---- The editor's In / Out on the bin item.
  (function () {
    const p = mocks.makePremiereHost({ mediaPath: "/music/other.wav", durationSec: 60, clipStart: 0, audioTrackCount: 4, playheadSeconds: 70,
      insertDurationSec: 10, mediaLength: 10 });
    const host = mocks.loadHost(p.context);
    const first = JSON.parse(host.run("insertAudioAtPlayhead(" + js(sound) + ", 10)"));
    const bin = p.rootItem.children.filter(function (c) { return c.name === "Downbeat"; })[0];
    const item = bin.children[0];
    host.run("insertAudioAtPlayhead(" + js(sound) + ", 10, " + js({ inSec: 1, outSec: 2 }) + ")");
    check("Premiere: a part insert leaves an unmarked bin item unmarked", first.ok && item._in === undefined && item._out === undefined,
      item._in + " / " + item._out);
    item.setInPoint(2, 4); item.setOutPoint(6.5, 4);
    p.playhead.seconds = 90;
    const whole = JSON.parse(host.run("insertAudioAtPlayhead(" + js(sound) + ", 10)"));
    let placed = null;
    p.sequence.audioTracks.forEach(function (t) { t.clips.forEach(function (c) { if (Math.abs(c.start.seconds - 90) < 0.01) { placed = c; } }); });
    check("Premiere: with the editor's marks on the item, Insert places the whole sound", whole.ok && placed &&
      Math.abs(placed.end.seconds - placed.start.seconds - 10) < 0.01 && placed.inPoint.seconds === 0, JSON.stringify(whole));
    p.playhead.seconds = 110;
    const part = JSON.parse(host.run("insertAudioAtPlayhead(" + js(sound) + ", 10, " + js({ inSec: 7, outSec: 8 }) + ")"));
    check("Premiere: the editor's In / Out on the bin item survive a whole and a part insert", part.ok && item._in === 2 && item._out === 6.5,
      item._in + " / " + item._out);
  })();

  // ---- Media with two mono channels (two clips, a track each).
  function twoChannelHost(extra) {
    const p = mocks.makePremiereHost(Object.assign({ mediaPath: music, durationSec: 8, clipStart: 3, audioTrackCount: 5, insertDurationSec: 8 }, extra || {}));
    decorateImports(p, function (it) { it.getAudioChannelMapping = { audioClipsNumber: 2 }; });
    const tracks = p.sequence.audioTracks;
    const real = tracks.map(function (t) { return t.overwriteClip; });
    tracks.forEach(function (t, i) {
      t.overwriteClip = function (item, time) {
        const answer = real[i].call(t, item, time);
        if (item.getAudioChannelMapping && tracks[i + 1]) { real[i + 1].call(tracks[i + 1], item, time); }
        return answer;
      };
    });
    const editorItem = { name: "fx.wav", getMediaPath: function () { return "/fx/fx.wav"; }, getMarkers: function () { return new mocks.MarkerCollection(); } };
    tracks[2].clips.push(new mocks.PClip(editorItem, 5, 6, 0, false));   // A3 is taken at the clip's place
    return p;
  }
  (function () {
    const p = twoChannelHost();
    const r = pitch(mocks.loadHost(p.context), music);
    const parts = [3, 4].map(function (t) { return p.sequence.audioTracks[t].clips[0]; });
    check("Premiere: two mono channels need two free tracks in a row (A4, A5), both get the speed", r.ok && r.data.where === "A4, A5" &&
      parts.every(function (c) { return c && Math.abs(c.getSpeed() - rate) < 1e-9; }) && p.sequence.audioTracks[1].clips.length === 0 &&
      p.sequence.audioTracks[2].clips.length === 1, JSON.stringify(r));
  })();
  (function () {
    const p = twoChannelHost({ speedBehavior: "ignore" });
    const r = pitch(mocks.loadHost(p.context), music);
    const left = p.sequence.audioTracks.map(function (t) { return t.clips.length; }).join("/");
    check("Premiere: a refused speed takes both channels away again and leaves no item in the bin", r.ok && r.data.speedFailed && left === "1/0/1/0/0" &&
      p.audioTrack.clips[0].disabled !== true && binItems(p) === 0, left + " " + binItems(p) + " " + JSON.stringify(r));
  })();

  // ---- The original's other channel and its picture.
  (function () {
    const p = mocks.makePremiereHost({ mediaPath: music, durationSec: 8, clipStart: 3, audioTrackCount: 4, insertDurationSec: 8 });
    const orig = p.audioTrack.clips[0];
    const partner = new mocks.PClip(orig.projectItem, 3, 11, 0, false);
    p.sequence.audioTracks[1].clips.push(partner);
    const picture = new mocks.PClip({ name: "take.mov", getMediaPath: function () { return "/v/take.mov"; }, getMarkers: function () { return new mocks.MarkerCollection(); } }, 3, 11, 0, false);
    p.sequence.videoTracks[0].clips.push(picture);
    orig.getLinkedItems = function () { const l = [partner, picture]; l.numItems = 2; return l; };
    // A Premiere that switches the linked picture off along with the sound.
    let off = false;
    Object.defineProperty(orig, "disabled", { get: function () { return off; }, set: function (v) { off = v; picture.disabled = v; } });
    const r = pitch(mocks.loadHost(p.context), music);
    check("Premiere: the original's linked second channel goes off with it; its picture stays on", r.ok && orig.disabled === true &&
      partner.disabled === true && picture.disabled === false && r.data.where === "A3", JSON.stringify(r));
  })();

  // ---- A file with picture.
  function movieHost() {
    const p = mocks.makePremiereHost({ mediaPath: movie, durationSec: 8, clipStart: 3, audioTrackCount: 3, insertDurationSec: 8 });
    const tracks = p.sequence.audioTracks;
    const real = tracks.map(function (t) { return t.overwriteClip; });
    // Like Premiere with an A/V item: the picture lands on a video track too.
    tracks.forEach(function (t, i) {
      t.overwriteClip = function (item, time) {
        const answer = real[i].call(t, item, time);
        if (!item._soundOnly) {
          const at = typeof time === "object" ? time.seconds : Number(time);
          const v = p.sequence.videoTracks[0].clips, pic = new mocks.PClip(item, at, at + 8, 0, false);
          pic.remove = function () { v.splice(v.indexOf(pic), 1); return true; };
          v.push(pic);
        }
        return answer;
      };
    });
    return p;
  }
  function subclipMaker(fake, honoursNoPicture) {
    decorateImports(fake, function (it) {
      it.createSubClip = function (name, start, end, hard, takeVideo, takeAudio) {
        const sub = Object.assign({}, it, { name: name, _soundOnly: honoursNoPicture && !takeVideo && !!takeAudio, _parent: it._parent });
        sub.getMarkers = it.getMarkers;
        ["_in", "_out"].forEach(function (k) { delete sub[k]; });
        sub.getInPoint = function () { return { seconds: typeof sub._in === "number" ? sub._in : 0 }; };
        sub.setInPoint = function (s) { sub._in = Number(s); };
        sub.setOutPoint = function (s) { sub._out = Number(s); };
        sub.clearInPoint = function () { delete sub._in; };
        sub.clearOutPoint = function () { delete sub._out; };
        sub.moveBin = function (dest) { const pb = sub._parent; if (pb) { pb.children.splice(pb.children.indexOf(sub), 1); } dest.children.push(sub); sub._parent = dest; };
        it._parent.children.push(sub);
        return sub;
      };
    });
  }
  (function () {
    const p = movieHost();
    const r = pitch(mocks.loadHost(p.context), movie);
    check("Premiere: picture media without an audio-only subclip - nothing placed, no item left, the original stays on",
      r.ok && r.data.pictureFailed && r.data.trimFailed && p.sequence.audioTracks[1].clips.length === 0 && p.sequence.videoTracks[0].clips.length === 1 &&
      p.audioTrack.clips[0].disabled !== true && binItems(p) === 0, JSON.stringify(r) + " items " + binItems(p));
  })();
  (function () {
    const p = movieHost();
    subclipMaker(p, true);
    const r = pitch(mocks.loadHost(p.context), movie);
    const placed = p.sequence.audioTracks[1].clips[0];
    check("Premiere: picture media goes in through an audio-only subclip - sound only, re-sped", r.ok && !r.data.pictureFailed && placed &&
      placed.projectItem._soundOnly === true && Math.abs(placed.getSpeed() - rate) < 1e-9 && p.sequence.videoTracks[0].clips.length === 1, JSON.stringify(r));
  })();
  (function () {
    const p = movieHost();
    subclipMaker(p, false);
    const r = pitch(mocks.loadHost(p.context), movie);
    check("Premiere: picture that comes along anyway is Downbeat's own and goes again; the editor's video stays",
      r.ok && r.data.pictureRemoved === 1 && p.sequence.videoTracks[0].clips.length === 1 && p.sequence.videoTracks[0].clips[0].name === "video.mp4" &&
      p.sequence.audioTracks[1].clips.length === 1, JSON.stringify(r));
  })();

  // ---- The selected clip's switched-off state (host side).
  (function () {
    const p = mocks.makePremiereHost({ mediaPath: music, durationSec: 8, clipStart: 3, audioTrackCount: 3, insertDurationSec: 8 });
    const host = mocks.loadHost(p.context);
    const ref = JSON.parse(host.run("getSelectedAudioInfo()")).data;
    p.audioTrack.clips[0].disabled = true;
    const now = JSON.parse(host.run("getSelectedAudioInfo()")).data;
    const r = JSON.parse(host.run("insertAudioAtPlayhead(" + js(music) + ", 8, " + js(pitchOpts(ref)) + ")"));
    check("Premiere: the selection says when the clip is switched off, and a plan made while it was on is refused",
      ref.disabled === false && now.disabled === true && !r.ok && p.sequence.audioTracks[1].clips.length === 0, JSON.stringify(r));
    const ae = mocks.makeAeHost({ mediaPath: music, durationSec: 8, insertDurationSec: 8 });
    ae.comp.selectedLayers[0].audioEnabled = false;
    const aeInfo = JSON.parse(mocks.loadHost(ae.context).run("getSelectedAudioInfo()")).data;
    check("After Effects: the selection says when the layer's sound is off", aeInfo.disabled === true, JSON.stringify(aeInfo));
  })();

  // ---- After Effects carries the editor's layer markers.
  (function () {
    const ae = mocks.makeAeHost({ mediaPath: music, durationSec: 60, startTime: 10, insertDurationSec: 60, compDuration: 130 });
    const L = ae.comp.selectedLayers[0];
    const drop = new mocks.MarkerValue("Drop"); drop.duration = 2; drop.label = 3;
    L.markers.setValueAtTime(18, drop);
    L.markers.setValueAtTime(20, mocks.ownAeMarkerValue("D"));
    const host = mocks.loadHost(ae.context);
    const ref = JSON.parse(host.run("getSelectedAudioInfo()")).data;
    const r = JSON.parse(host.run("insertAudioAtPlayhead(" + js(music) + ", " + ref.outPointSeconds + ", " + js(pitchOpts(ref)) + ")"));
    const added = ae.comp.selectedLayers[0];
    const keys = added.markers.keys;
    const want = added.startTime + 8 * added.stretch / 100;
    check("After Effects: the pitched layer carries the editor's marker at the same place in the sound, not Downbeat's",
      r.ok && added !== L && keys.length === 1 && keys[0].v.comment === "Drop" && Math.abs(keys[0].t - want) < 1e-6 &&
      Math.abs(keys[0].v.duration - 2 / rate) < 1e-6 && keys[0].v.label === 3 && L.markers.keys.length === 2, JSON.stringify(keys));
    check("After Effects: Edit > Undo names the step as a pitch change, not as a sound insert",
      ae.state.undoNames[ae.state.undoNames.length - 1] === "Downbeat: change pitch", JSON.stringify(ae.state.undoNames));
  })();
} catch (e) {
  failures++;
  console.error("FAIL threw: " + (e && e.stack || e));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
if (failures) { console.error(failures + " check(s) failed"); process.exit(1); }
console.log("PASS: pitch and insert safety on the stand-in hosts.");
