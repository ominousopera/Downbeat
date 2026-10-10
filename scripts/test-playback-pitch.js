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
    console.log("PASS: consecutive pitch, no-op target, source preservation and stale-plan rejection.");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
