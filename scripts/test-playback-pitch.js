"use strict";
// Verify playback-key updates, accumulated speed and selection validation across pitch inserts.
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const mocks = require("./host-mocks.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-playback-"));
const media = path.join(tmp, "music.wav"), docs = path.join(tmp, "docs");
fs.writeFileSync(media, "fixture");
fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true });
fs.writeFileSync(path.join(docs, "Downbeat/settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));
const fake = mocks.makePremiereHost({ mediaPath: media, durationSec: 8, clipStart: 3, audioTrackCount: 8 });
const originalItem = fake.audioTrack.clips[0].projectItem;
const originalMarkers = originalItem.getMarkers();
mocks.ownPremiereMarker(originalMarkers, 1, "D");
const editorMarker = originalMarkers.createMarker(2);
editorMarker.name = "Editor note"; editorMarker.comments = "Keep this";
const importFiles = fake.context.app.project.importFiles;
fake.context.app.project.importFiles = function (paths, suppressUI, bin) {
  const answer = importFiles(paths, suppressUI, bin);
  mocks.ownPremiereMarker(bin.children[bin.children.length - 1].getMarkers(), 1, "D");
  return answer;
};
const bridge = mocks.loadHost(fake.context), inserts = [];
const panel = require("./panel-harness.js").bootPanel({ docsDir: docs, realTimeouts: true, realIntervals: false,
  evalScript: function (script, callback) {
    if (/^insertAudioAtPlayhead\(/.test(script)) { inserts.push(script); }
    bridge.evalScript(script, callback);
  } });
const $ = panel.registry;
const pause = function () { return new Promise(function (resolve) { setTimeout(resolve, 30); }); };
async function waitFor(fn) { for (let i = 0; i < 150; i++) { if (fn()) { return; } await pause(); } throw Error("timeout"); }
function info() { return JSON.parse(bridge.run("getSelectedAudioInfo()")).data; }
function wheel() { return $.camelotWheel.children[$.camelotWheel.children.length - 1].textContent; }
async function pitch(to) {
  $.pitchToSelect.value = to; $.pitchToSelect._fire("change");
  assert.strictEqual($.pitchApplyBtn.disabled, false);
  const n = inserts.length;
  $.pitchApplyBtn._fire("click");
  await waitFor(function () { return inserts.length === n + 1 && /switched off/.test($.pitchApplyStatus.textContent); });
  await pause();
}
(async function () {
  try {
    await pause();
    window.BeatMarkerLibrary.upsertKey(media, "music.wav", { camelot: "6A", key: "G", scale: "minor", material: "music", scopeKey: "music" });
    $.keyMaterialMusicBtn._fire("click"); await pause();
    assert.strictEqual(wheel(), "6A");
    await pitch("8A");
    assert.ok(Math.abs(info().speed - Math.pow(2, 2 / 12)) < 1e-9);
    assert.strictEqual(wheel(), "8A"); assert.strictEqual($.pitchFromSelect.value, "8A");
    const pitchedItem = fake.sequence.audioTracks[info().trackIndex].clips[0].projectItem;
    assert.notStrictEqual(pitchedItem, originalItem, "Pitch owns an independent marker collection");
    assert.strictEqual(originalMarkers.numMarkers, 2, "Original markers stay intact");
    const copiedMarkers = pitchedItem.getMarkers();
    assert.strictEqual(copiedMarkers.numMarkers, 1);
    assert.strictEqual(copiedMarkers.getFirstMarker().name, "Editor note");
    assert.strictEqual(copiedMarkers.getFirstMarker().comments, "Keep this");
    assert.ok($.keyResultDisplay.textContent.startsWith("6A"));
    assert.strictEqual($.pitchApplyBtn.disabled, true, "Existing target is a no-op");
    await pitch("10A");
    assert.ok(Math.abs(info().speed - Math.pow(2, 4 / 12)) < 1e-9);
    assert.strictEqual(wheel(), "10A");
    await pitch("6A");
    assert.ok(Math.abs(info().speed - 1) < 1e-9);
    assert.strictEqual(wheel(), "6A");
    assert.strictEqual(window.BeatMarkerLibrary.getKey(media, "music").camelot, "6A");
    const clip = info(), selected = fake.sequence.audioTracks[clip.trackIndex].clips[0];
    $.pitchToSelect.value = "8A"; $.pitchToSelect._fire("change");
    selected._speed = 1.07;
    const n = inserts.length;
    $.pitchApplyBtn._fire("click"); await waitFor(function () { return /changed/.test($.pitchApplyStatus.textContent); });
    assert.strictEqual(inserts.length, n, "Changed playback cannot apply a stale plan");
    assert.strictEqual($.pitchApplyBtn.disabled, true);
    assert.strictEqual(wheel(), "—", "Off-semitone playback has no exact key");
    const reference = Object.assign({}, info(), { speed: 1 });
    const result = JSON.parse(bridge.run("insertAudioAtPlayhead(" + JSON.stringify(JSON.stringify(media)) + ", 8, " +
      JSON.stringify(JSON.stringify({ speed: 1.2, pitchReference: reference })) + ")"));
    assert.strictEqual(result.ok, false, "Host revalidates selection before insertion");
    const ae = mocks.makeAeHost({ mediaPath: media, durationSec: 8, insertDurationSec: 8 });
    const aeOriginal = ae.comp.selectedLayers[0];
    aeOriginal.markers.setValueAtTime(1, mocks.ownAeMarkerValue("D"));
    const addLayer = ae.comp.layers.add;
    ae.comp.layers.add = function (item) {
      const layer = addLayer(item);
      layer.markers.setValueAtTime(1, mocks.ownAeMarkerValue("D"));
      layer.markers.setValueAtTime(2, { comment: "Editor note" });
      return layer;
    };
    const aeBridge = mocks.loadHost(ae.context);
    const aeReference = JSON.parse(aeBridge.run("getSelectedAudioInfo()")).data;
    const aeResult = JSON.parse(aeBridge.run("insertAudioAtPlayhead(" + JSON.stringify(JSON.stringify(media)) + ", 8, " +
      JSON.stringify(JSON.stringify({ speed: 1.2, muteSelected: true, selectInserted: true, pitchReference: aeReference })) + ")"));
    assert.ok(aeResult.ok, aeResult.error);
    const aeMarkers = ae.comp.selectedLayers[0].markers;
    assert.strictEqual(aeMarkers.numKeys, 1);
    assert.strictEqual(aeMarkers.keyValue(1).comment, "Editor note");
    assert.strictEqual(aeOriginal.markers.numKeys, 1, "AE original markers remain intact");
    // The same song with the same timing in another sequence / comp, opened
    // between reading the selection and the insert: refused, nothing switched off there.
    for (const isAe of [false, true]) {
      const o = { mediaPath: media, durationSec: 8, audioTrackCount: 2, insertDurationSec: 8 };
      const first = (isAe ? mocks.makeAeHost : mocks.makePremiereHost)(o), second = (isAe ? mocks.makeAeHost : mocks.makePremiereHost)(o);
      if (isAe) { first.comp.id = 10; second.comp.id = 20; } else { first.sequence.sequenceID = "A"; second.sequence.sequenceID = "B"; }
      const host = mocks.loadHost(first.context);
      const ref = JSON.parse(host.run("getSelectedAudioInfo()")).data;
      if (isAe) { first.context.app.project.activeItem = second.comp; } else { first.context.app.project.activeSequence = second.sequence; host.context.qe = second.context.qe; }
      const other = isAe ? second.comp.layers[0] : second.audioTrack.clips[0];
      const res = JSON.parse(host.run("insertAudioAtPlayhead(" + JSON.stringify(JSON.stringify(media)) + ", 8, " +
        JSON.stringify(JSON.stringify({ atSeconds: ref.clipStartSeconds, inSec: 0, outSec: 8, speed: 1.2, muteSelected: true, pitchReference: ref })) + ")"));
      assert.strictEqual(res.ok, false, (isAe ? "AE" : "Premiere") + ": pitch refuses the same song in another sequence / comp");
      assert.ok(isAe ? other.audioEnabled !== false : other.disabled !== true, (isAe ? "AE" : "Premiere") + ": the other original stays on");
    }
    console.log("PASS: cumulative pitch, marker isolation in both hosts, source preservation and stale-plan rejection.");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
