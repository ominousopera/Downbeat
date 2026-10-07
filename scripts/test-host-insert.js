"use strict";
// Library insert through the real host scripts on mock Premiere and After
// Effects: the free track, the Downbeat bin / folder, a trimmed part with
// fades, pitch and Reverse on the clip, and the refusals when the host does
// not take them.
// Run: node scripts/test-host-insert.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-insert-"));
const sound = path.join(dir, "whoosh 01.wav");
fs.writeFileSync(sound, "RIFF"); // only its existence matters to the host
function js(v) { return JSON.stringify(JSON.stringify(v)); }

try {
  // ---- Premiere: A1 holds the 60 s music clip at 0-60 s, A2 is empty.
  const p = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, clipStart: 0, audioTrackCount: 2,
    playheadSeconds: 10, insertDurationSec: 5 });
  const ph = mocks.loadHost(p.context);
  let r = JSON.parse(ph.run("insertAudioAtPlayhead(" + js(sound) + ", 5)"));
  const a2 = p.sequence.audioTracks[1].clips;
  check("Premiere: goes to the first track free at the playhead, never over the music on A1",
    r.ok && r.data.where === "A2" && a2.length === 1 && a2[0].start.seconds === 10 && p.audioTrack.clips.length === 1,
    JSON.stringify(r.data || r.error));
  const bin = p.rootItem.children[0];
  check("Premiere: imported once, into a Downbeat bin", r.ok && r.data.imported && bin && bin.name === "Downbeat" && bin.children.length === 1);
  r = JSON.parse(ph.run("insertAudioAtPlayhead(" + js(sound) + ", 5)"));
  check("Premiere: no free track at the playhead is refused, nothing overwritten",
    !r.ok && /No free audio track/.test(r.error) && a2.length === 1, r.error);
  p.playhead.seconds = 30;
  r = JSON.parse(ph.run("insertAudioAtPlayhead(" + js(sound) + ", 5)"));
  check("Premiere: the second insert reuses the imported item",
    r.ok && r.data.where === "A2" && r.data.imported === false && bin.children.length === 1 && a2.length === 2, JSON.stringify(r.data || r.error));
  p.sequence.audioTracks[1].locked = true;
  p.playhead.seconds = 45;
  r = JSON.parse(ph.run("insertAudioAtPlayhead(" + js(sound) + ", 5)"));
  check("Premiere: a locked track is skipped", !r.ok && /No free audio track/.test(r.error), r.error);
  r = JSON.parse(ph.run("insertAudioAtPlayhead(" + js(path.join(dir, "gone.wav")) + ", 5)"));
  check("Premiere: a file that is gone is a clear error", !r.ok && /not there any more/.test(r.error), r.error);
  // The preview pane's part with fades: the original, trimmed through the bin
  // item's in / out (cleared again), with Premiere transitions on its edges -
  // editable on the timeline.
  const p3 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5 });
  const ph3 = mocks.loadHost(p3.context);
  r = JSON.parse(ph3.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, fadeInSec: 0.2, fadeOutSec: 0.5, transitionIn: "Constant Power", transitionOut: "Constant Gain" })) + ")"));
  const placed = [].concat.apply([], p3.sequence.audioTracks.map(function (t) { return t.clips; })).filter(function (c) { return Math.abs(c.start.seconds - 40) < 1e-6; })[0];
  function findBinItem(bin) { for (const c of bin.children) { if (c.children) { const f = findBinItem(c); if (f) { return f; } } else if (c.setInPoint) { return c; } } return null; }
  const binItem = findBinItem(p3.rootItem);
  check("Premiere: a part of the file - 2 s from source 1 s, and the bin item is whole again afterwards",
    r.ok && placed && Math.abs(placed.end.seconds - 42) < 1e-6 && placed.inPoint.seconds === 1 && binItem && binItem._in === undefined && binItem._out === undefined,
    JSON.stringify(r.data || r.error));
  check("Premiere: the fades are Premiere transitions on the clip's edges, in frames (25 fps: 0.2 s = 5, 0.5 s = 13)",
    placed && placed.transitions && placed.transitions.length === 2 &&
    placed.transitions[0].name === "Constant Power" && placed.transitions[0].atStart === true && placed.transitions[0].frames === "5" &&
    placed.transitions[1].name === "Constant Gain" && placed.transitions[1].atStart === false && placed.transitions[1].frames === "13",
    JSON.stringify(placed && placed.transitions));
  check("Premiere: the QE clip's fade / curve members are reported for the log", r.data && r.data.fades && r.data.fades.qeMembers && r.data.fades.qeMembers.join() === "getFadeCurve()",
    JSON.stringify(r.data && r.data.fades));
  // A Premiere in another language: the transitions carry that language's
  // names, so the English name finds nothing and the localized one must.
  const pRu = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5,
    transitionNames: ["\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u043e\u0435 \u0443\u0441\u0438\u043b\u0435\u043d\u0438\u0435", "\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u0430\u044f \u043c\u043e\u0449\u043d\u043e\u0441\u0442\u044c", "\u042d\u043a\u0441\u043f\u043e\u043d\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u043e\u0435 \u0437\u0430\u0442\u0443\u0445\u0430\u043d\u0438\u0435"] });
  const phRu = mocks.loadHost(pRu.context);
  r = JSON.parse(phRu.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, fadeInSec: 0.2, fadeOutSec: 0.5, transitionIn: "Constant Power", transitionOut: "Exponential Fade" })) + ")"));
  check("Premiere in another language: the fades are still added, by the localized transition names",
    r.ok && r.data.fades && r.data.fades.fadeIn && r.data.fades.fadeIn.asked === true && r.data.fades.fadeOut && r.data.fades.fadeOut.asked === true,
    JSON.stringify(r.data && r.data.fades));
  // A Premiere that refuses the standard call (seen live on Windows): the
  // same request is made in other forms until one is taken, and the answer
  // names which one worked.
  const pRef = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5, refuseTransitions: 3 });
  const phRef = mocks.loadHost(pRef.context);
  r = JSON.parse(phRef.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ fadeInSec: 0.2, transitionIn: "Constant Power" })) + ")"));
  check("Premiere that refuses the standard call: the fade is taken by a later form, and says which",
    r.ok && r.data.fades.fadeIn.asked === true && /length as a number/.test(r.data.fades.fadeIn.why || ""), JSON.stringify(r.data && r.data.fades));
  const pRefAll = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5, refuseTransitions: 99 });
  const phRefAll = mocks.loadHost(pRefAll.context);
  mocks.PClip.levelMode = "noKeys"; // no keyframe way out either, so the trail of answers is what is left
  r = JSON.parse(phRefAll.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ fadeInSec: 0.2, transitionIn: "Constant Power" })) + ")"));
  mocks.PClip.levelMode = undefined;
  check("Premiere that refuses every form: not added, and the reason lists what each form answered",
    r.ok && r.data.fades.fadeIn.asked === false && /standard: refused.*clip selected: refused.*linked media on: refused.*length as a number: refused.*short form: refused.*timecode length: refused/.test(r.data.fades.fadeIn.why || ""),
    JSON.stringify(r.data && r.data.fades));
  // When every form of the transition call is refused, the fades are set
  // as Volume > Level keyframes, and the answer says so.
  const levelOf = function (host) {
    const all = [].concat.apply([], host.sequence.audioTracks.map(function (t) { return t.clips; }));
    return all.filter(function (c) { return Math.abs(c.start.seconds - 40) < 1e-6; })[0];
  };
  const mkRefusing = function () {
    return mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5, refuseTransitions: 99 });
  };
  const opts2 = js(({ inSec: 1, outSec: 3, fadeInSec: 0.2, fadeOutSec: 0.5, transitionIn: "Constant Power", transitionOut: "Constant Power", curveIn: 0, curveOut: 0 }));
  let pKey = mkRefusing();
  r = JSON.parse(mocks.loadHost(pKey.context).run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + opts2 + ")"));
  let keyedClip = levelOf(pKey);
  check("Refused transitions: both fades become Volume keyframes, and the answer says so",
    r.ok && r.data.fades.fadeIn.asked === true && r.data.fades.fadeIn.transition === "Volume keyframes" && r.data.fades.fadeOut.transition === "Volume keyframes" &&
    /Volume > Level keyframes/.test(r.data.fades.fadeIn.why), JSON.stringify(r.data && r.data.fades));
  const levelKeys = keyedClip && keyedClip._level._keys;
  check("... 9 keys per fade, from the clip's in point (1 s) on, silent at the very start and the very end",
    levelKeys && levelKeys.length === 18 && Math.abs(levelKeys[0].t - 1) < 1e-9 && levelKeys[0].v === 0 && levelKeys[8].v === 1 && Math.abs(levelKeys[17].t - 3) < 1e-9 && levelKeys[17].v === 0,
    JSON.stringify(levelKeys && levelKeys.map(function (k) { return [Number(k.t.toFixed(3)), Number(k.v.toFixed(3))]; })));
  check("... Level stays unity in the middle of the clip", keyedClip && Math.abs(keyedClip._level.getValueAtTime({ seconds: 2 }) - 1) < 1e-9);
  const mockLevel = function (mode, refuse) {
    mocks.PClip.levelMode = mode;
    const h = mkRefusing();
    const rr = JSON.parse(mocks.loadHost(h.context).run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + opts2 + ")"));
    mocks.PClip.levelMode = undefined;
    return { r: rr, clip: levelOf(h) };
  };
  let m = mockLevel("dB");
  check("A host that counts Level in dB is left alone: nothing keyed, the reason says why",
    m.r.data.fades.fadeIn.asked === false && /expected about 1/.test(m.r.data.fades.fadeIn.why) && m.clip._level._keys.length === 0, m.r.data.fades.fadeIn.why);
  m = mockLevel("noKeys");
  check("A Level that takes no keyframes is reported, nothing keyed",
    m.r.data.fades.fadeIn.asked === false && /no keyframes/.test(m.r.data.fades.fadeIn.why) && m.clip._level._keys.length === 0, m.r.data.fades.fadeIn.why);
  m = mockLevel("deaf");
  check("Keys that read back wrong are undone: Level is a plain constant again and the failure is reported",
    m.r.data.fades.fadeIn.asked === false && /read back/.test(m.r.data.fades.fadeIn.why) && m.clip._level.isTimeVarying() === false && m.clip._level.getValue() === 1, m.r.data.fades.fadeIn.why);
  // A Premiere whose names are unknown: not added, and the log says what it offers.
  const pXx = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5, transitionNames: ["Foo", "Bar"] });
  const phXx = mocks.loadHost(pXx.context);
  mocks.PClip.levelMode = "noKeys";
  r = JSON.parse(phXx.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ fadeInSec: 0.2, transitionIn: "Constant Power" })) + ")"));
  mocks.PClip.levelMode = undefined;
  check("Premiere with unknown transition names: fade not added, the reason lists what Premiere offers",
    r.ok && r.data.fades.fadeIn.asked === false && /Foo, Bar/.test(r.data.fades.fadeIn.why || ""), JSON.stringify(r.data && r.data.fades));
  // A Premiere that cannot set in / out: the whole file lands, is taken out
  // again, and the result reports that the trim failed (checked below, after
  // the pitched-insert case).
  const p2 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 10, audioTrackCount: 2, insertDurationSec: 5, noInOut: true });
  const ph2 = mocks.loadHost(p2.context);
  r = JSON.parse(ph2.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3 })) + ")"));
  // The Key tab's pitched insert: at the selected clip's own place, the
  // original switched off (Disable), not deleted.
  const p4 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, clipStart: 3, playheadSeconds: 20, audioTrackCount: 2, insertDurationSec: 5 });
  const ph4 = mocks.loadHost(p4.context);
  const orig = p4.audioTrack.clips[0];
  const r4 = JSON.parse(ph4.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ atSeconds: 3, muteSelected: true })) + ")"));
  check("Premiere: a pitched copy goes to the clip's own place on a free track, and the original is switched off (still there)",
    r4.ok && r4.data.startSeconds === 3 && r4.data.where === "A2" && r4.data.muted === true && orig.disabled === true && p4.audioTrack.clips.indexOf(orig) !== -1,
    JSON.stringify(r4.data || r4.error));
  check("Premiere: when it cannot trim, the clip is removed again and trimFailed says so (no copy stands in)",
    r.ok && r.data.trimFailed === true && p2.sequence.audioTracks[1].clips.length === 0, JSON.stringify(r.data));
  // Pitch and Reverse on the clip itself.
  const rate = Math.pow(2, 2 / 12);
  const speedOf = function (host, startAt) {
    return [].concat.apply([], host.sequence.audioTracks.map(function (t) { return t.clips; })).filter(function (c) { return Math.abs(c.start.seconds - startAt) < 1e-6; })[0];
  };
  const p5 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5 });
  const ph5 = mocks.loadHost(p5.context);
  r = JSON.parse(ph5.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, speed: rate, reverse: true, fadeInSec: 0.2 / rate })) + ")"));
  const sp = speedOf(p5, 40);
  check("Premiere: pitch + Reverse are the clip's own speed and direction - the file itself, 2 s of it, 2 / speed long on the timeline",
    r.ok && sp && Math.abs(sp.getSpeed() - rate) < 1e-9 && sp.isSpeedReversed() === true && Math.abs(sp.end.seconds - sp.start.seconds - 2 / rate) < 1e-6 &&
    r.data.speed && r.data.speed.ok === true && !r.data.speedFailed, JSON.stringify(r.data || r.error));
  check("Premiere: the setSpeed argument names are reported for the log", r.data && r.data.speed && r.data.speed.args && r.data.speed.args.length === 5, JSON.stringify(r.data && r.data.speed && r.data.speed.args));
  // A pitched-up insert must not cut what follows it: a clip at 12-14 s on A2
  // blocks a 5 s sound that would shrink to 4.4 s but is laid down at 5 s.
  const pf = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 10, audioTrackCount: 3, insertDurationSec: 5 });
  const phf = mocks.loadHost(pf.context);
  r = JSON.parse(phf.run("insertAudioAtPlayhead(" + js(sound) + ", 5)")); // lands on A2 at 10-15
  r = JSON.parse(phf.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ speed: rate })) + ")"));
  check("Premiere: a pitched insert looks for a track free for the file's full length, not the shortened one",
    r.ok && r.data.where === "A3", JSON.stringify(r.data || r.error));
  const p6 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5, speedBehavior: "wrongLength" });
  r = JSON.parse(mocks.loadHost(p6.context).run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, speed: rate })) + ")"));
  const fixed = speedOf(p6, 40);
  check("Premiere: a re-sped clip left at the wrong length is set to the right one",
    r.ok && fixed && Math.abs(fixed.end.seconds - fixed.start.seconds - 2 / rate) < 1e-6, JSON.stringify(r.data || r.error));
  const p7 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, playheadSeconds: 40, audioTrackCount: 2, insertDurationSec: 5, speedBehavior: "ignore" });
  r = JSON.parse(mocks.loadHost(p7.context).run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ speed: rate })) + ")"));
  check("Premiere: when the speed does not take, the clip is removed again and speedFailed says so (no copy)",
    r.ok && r.data.speedFailed === true && !speedOf(p7, 40), JSON.stringify(r.data || r.error));
  const p8 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, clipStart: 3, playheadSeconds: 20, audioTrackCount: 2, insertDurationSec: 5 });
  r = JSON.parse(mocks.loadHost(p8.context).run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ atSeconds: 3, muteSelected: true, speed: rate })) + ")"));
  check("Premiere: the Key tab's pitch - the file itself at the clip's place, original switched off",
    r.ok && r.data.startSeconds === 3 && r.data.where === "A2" && r.data.muted === true && r.data.speed && Math.abs(r.data.speed.speed - rate) < 1e-9, JSON.stringify(r.data || r.error));
  // The selected clip's info after the Key tab re-sped it: the used part of
  // the file is the timeline length times the speed.
  const p9 = mocks.makePremiereHost({ mediaPath: "/music/song.mp3", durationSec: 60, clipStart: 3, playheadSeconds: 0, audioTrackCount: 2 });
  const ph9 = mocks.loadHost(p9.context);
  const plain = JSON.parse(ph9.run("getSelectedAudioInfo()")).data;
  p9.context.qe.project.getActiveSequence().getAudioTrackAt(0).getItemAt(0).setSpeed(rate, "", false);
  const sped9 = JSON.parse(ph9.run("getSelectedAudioInfo()")).data;
  check("Premiere: a clip at normal speed reports speed 1 and its own out point", plain.speed === 1 && plain.outPointSeconds === 60, JSON.stringify(plain));
  check("Premiere: a re-sped clip reports its speed and the whole used part of the file (60 s), not the shortened length",
    Math.abs(sped9.speed - rate) < 1e-9 && Math.abs(sped9.outPointSeconds - 60) < 1e-6 && sped9.inPointSeconds === 0, JSON.stringify(sped9));
  // ---- After Effects: comp time 12 s.
  const a = mocks.makeAeHost({ mediaPath: "/music/song.mp3", durationSec: 60, compTime: 12, insertDurationSec: 5 });
  const ah = mocks.loadHost(a.context);
  r = JSON.parse(ah.run("insertAudioAtPlayhead(" + js(sound) + ", 5)"));
  const top = a.comp.layers[0];
  check("After Effects: a new layer starting at the current time",
    r.ok && top.name === "whoosh 01.wav" && top.startTime === 12 && r.data.startSeconds === 12, JSON.stringify(r.data || r.error));
  const footage = a.items.filter(function (i) { return i instanceof mocks.FootageItem; });
  const folder = a.items.filter(function (i) { return i instanceof mocks.FolderItem; });
  check("After Effects: imported once, into a Downbeat folder",
    footage.length === 1 && folder.length === 1 && folder[0].name === "Downbeat" && footage[0].parentFolder === folder[0]);
  a.comp.time = 20;
  r = JSON.parse(ah.run("insertAudioAtPlayhead(" + js(sound) + ", 5)"));
  check("After Effects: the second insert reuses the footage",
    r.ok && r.data.imported === false && a.items.filter(function (i) { return i instanceof mocks.FootageItem; }).length === 1 &&
    a.comp.layers[0].startTime === 20, JSON.stringify(r.data || r.error));
  check("After Effects: no undo group left open", a.state.undoDepth === 0);
  // The preview pane's part with fades: the original trimmed, fades as Audio
  // Levels keyframes along the pane's curve.
  a.comp.time = 30;
  r = JSON.parse(ah.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, fadeInSec: 0.2, fadeOutSec: 0.5, curveIn: 0, curveOut: 60 })) + ")"));
  const trimmedLayer = a.comp.layers[0];
  const keys = trimmedLayer.levels ? trimmedLayer.levels.keys : [];
  const firstKey = keys[0], lastKey = keys.filter(function (k) { return Math.abs(k.t - 32) < 1e-9; })[0];
  check("After Effects: a part of the file - the layer shows source 1-3 s from the current time",
    r.ok && trimmedLayer.startTime === 29 && trimmedLayer.inPoint === 30 && trimmedLayer.outPoint === 32, JSON.stringify(r.data || r.error));
  const selectedSong = a.comp.layers.filter(function (l) { return l.selected && l.hasAudio; })[0];
  r = JSON.parse(ah.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ atSeconds: 3, muteSelected: true })) + ")"));
  check("After Effects: a pitched copy starts at the layer's place, and the original layer's sound is switched off",
    r.ok && a.comp.layers[0].startTime === 3 && r.data.muted === true && selectedSong && selectedSong.audioEnabled === false, JSON.stringify(r.data || r.error));
  check("After Effects: fades as Audio Levels keyframes, silent (-96 dB) at both ends, full in between",
    keys.length === 18 && firstKey && firstKey.t === 30 && firstKey.v[0] === -96 && lastKey && lastKey.v[0] === -96 &&
    keys.some(function (k) { return Math.abs(k.t - 30.2) < 1e-9 && k.v[0] === 0; }), keys.length + " keys");
  // Pitch and Reverse on the layer itself: Time Stretch, negative =
  // backwards.
  a.comp.time = 40;
  const f = 1 / rate;
  r = JSON.parse(ah.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, speed: rate })) + ")"));
  let L = a.comp.layers[0];
  check("After Effects: pitch is Time Stretch 100 / speed; the same 2 s of the file now last 2 / speed",
    r.ok && Math.abs(L.stretch - 100 * f) < 1e-6 && Math.abs(L.startTime - (40 - f)) < 1e-6 && L.inPoint === 40 && Math.abs(L.outPoint - (40 + 2 * f)) < 1e-6, JSON.stringify(r.data || r.error));
  a.comp.time = 50;
  // Reverse insert (checked at the end of this block, after the speedFailed case).
  r = JSON.parse(ah.run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, speed: rate, reverse: true })) + ")"));
  // A stretch that does not take: the layer is taken away again, speedFailed.
  const aeBad = mocks.makeAeHost({ mediaPath: "/music/song.mp3", durationSec: 60, compTime: 12, insertDurationSec: 5, stretchIgnored: true });
  const before2 = aeBad.comp.layers.length;
  const rf = JSON.parse(mocks.loadHost(aeBad.context).run("insertAudioAtPlayhead(" + js(sound) + ", 5, " + js(({ inSec: 1, outSec: 3, speed: rate })) + ")"));
  check("After Effects: a stretch that does not take removes the layer again and says speedFailed (no half-set layer left)",
    rf.ok && rf.data.speedFailed === true && aeBad.comp.layers.length === before2 && aeBad.state.undoDepth === 0, JSON.stringify(rf.data || rf.error));
  L = a.comp.layers[0];
  check("After Effects: Reverse is a negative stretch, anchored so the layer still shows source 3 s back to 1 s from the current time",
    r.ok && Math.abs(L.stretch + 100 * f) < 1e-6 && Math.abs(L.startTime - (50 + 3 * f)) < 1e-6 && L.inPoint === 50 && Math.abs(L.outPoint - (50 + 2 * f)) < 1e-6, JSON.stringify(r.data || r.error));
} finally {
  fs.rmSync(dir, { recursive: true, force: true }); // throwaway fixture made above
}

if (failures) {
  console.error("\n" + failures + " insert check(s) failed");
  process.exit(1);
}
console.log("\nLibrary insert works in both hosts");
