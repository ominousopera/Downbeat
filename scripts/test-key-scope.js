"use strict";
// The selected-interval option must send source samples, not timeline or stretched samples.
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-scope-"));
const docs = path.join(tmp, "docs"), media = path.join(tmp, "audio.wav");
fs.mkdirSync(path.join(docs, "Downbeat"), { recursive: true }); fs.writeFileSync(media, "fixture");
fs.writeFileSync(path.join(docs, "Downbeat/settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));
const host = require("./host-mocks.js");
const fake = host.makePremiereHost({ mediaPath: media, durationSec: 4, clipStart: 0 });
fake.audioTrack.clips[0].inPoint = { seconds: 1 };
fake.audioTrack.clips[0].outPoint = { seconds: 3 };
fake.audioTrack.clips[0]._speed = 0.5;
const bridge = host.loadHost(fake.context);
const panel = require("./panel-harness.js").bootPanel({ docsDir: docs, evalScript: bridge.evalScript, realTimeouts: true, realIntervals: false });
const $ = panel.registry, original = cp.execFile, calls = [];
let holdNextKey = false, pendingReply = null;
// Host selection is returned through the production bridge; no replacement of key handlers.
window.BeatMarkerAudio.decodeFileToMono44100 = async function () { return { samples: new Float32Array(4 * 44100), original: { durationSec: 4 } }; };
window.BeatMarkerAudio.resampleMono = async function () { throw new Error("No neural opinion in this fixture"); };
cp.execFile = function (bin, args, opts, cb) {
  if (/analyze-worker/.test(args[0])) {
    calls.push(fs.statSync(args[2]).size / 4);
    const reply = function () { cb(null, JSON.stringify({ ok: true, data: { key: "A", scale: "minor", camelot: "8A", material: "sfx", strength: 0.5, perProfile: [], durationSec: calls[calls.length - 1] / 44100 } }), ""); };
    if (holdNextKey) { holdNextKey = false; pendingReply = reply; } else { setImmediate(reply); }
    return { kill: function () {} };
  }
  return original.apply(this, arguments);
};
function waitFor(fn) { return new Promise(function (resolve, reject) { const start = Date.now(); (function poll() { if (fn()) return resolve(); if (Date.now() - start > 5000) return reject(Error("timeout")); setTimeout(poll, 10); })(); }); }
(async function () {
  try {
    $.keyMaterialSfxBtn._fire("click");
    await new Promise(function (r) { setTimeout(r, 20); });
    $.detectKeyBtn._fire("click"); await waitFor(function () { return !$.detectKeyBtn.disabled && calls.length === 1; });
    assert.strictEqual(calls[0], 4 * 44100);
    $.keyScopeSelect.value = "clip"; $.keyScopeSelect._fire("change");
    await new Promise(function (r) { setTimeout(r, 20); });
    $.detectKeyBtn._fire("click"); await waitFor(function () { return !$.detectKeyBtn.disabled && calls.length === 2; });
    // Stretch changes timeline duration, not the two-second source interval.
    assert.strictEqual(calls[1], 2 * 44100);
    assert.ok(window.BeatMarkerLibrary.get(media).intervalKeys.length);
    assert.strictEqual(window.BeatMarkerLibrary.getKey(media, "sfx").camelot, "8A");
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(docs, "Downbeat/settings.json"))).keyScope, "clip");
    fake.audioTrack.clips[0]._speed = 1;
    $.manualBpmInput.value = "100"; $.manualBpmBtn._fire("click");
    await waitFor(function () { return !$.manualBpmBtn.disabled; });
    const originalGrid = window.BeatMarkerLibrary.get(media).beatsArray.slice();
    fake.audioTrack.clips[0]._speed = Math.pow(2, 2 / 12);
    $.detectKeyBtn._fire("click"); await waitFor(function () { return !$.detectKeyBtn.disabled && calls.length === 3; });
    assert.ok($.keyResultDisplay.textContent.startsWith("8A"));
    assert.strictEqual($.heardKeyRow.hidden, false, "Fresh pitched Key must not use the old beat analysis speed");
    assert.ok(/10A/.test($.heardKeyHint.textContent) && /\+2/.test($.heardKeyHint.textContent));
    assert.strictEqual(window.BeatMarkerLibrary.getKey(media, "sfx").camelot, "8A");
    panel.runIntervals(); await new Promise(function (r) { setTimeout(r, 30); });
    fake.audioTrack.clips[0]._speed = 1;
    panel.runIntervals(); await new Promise(function (r) { setTimeout(r, 30); });
    assert.strictEqual($.heardKeyRow.hidden, true, "Speed-only selection change must restore source playback");
    fake.audioTrack.clips[0]._speed = Math.pow(2, 2 / 12);
    panel.runIntervals(); await new Promise(function (r) { setTimeout(r, 30); });
    assert.strictEqual($.heardKeyRow.hidden, false);
    assert.ok(/10A/.test($.heardKeyHint.textContent));
    $.keyScopeSelect.value = "file"; $.keyScopeSelect._fire("change");
    await new Promise(function (r) { setTimeout(r, 20); });
    fake.audioTrack.clips[0]._speed = 1;
    panel.runIntervals(); await new Promise(function (r) { setTimeout(r, 30); });
    holdNextKey = true;
    $.detectKeyBtn._fire("click"); await waitFor(function () { return !!pendingReply; });
    panel.runIntervals();
    fake.audioTrack.clips[0]._speed = Math.pow(2, 2 / 12);
    pendingReply(); pendingReply = null;
    await waitFor(function () { return !$.detectKeyBtn.disabled; });
    panel.runIntervals(); await new Promise(function (r) { setTimeout(r, 30); });
    panel.runIntervals(); await new Promise(function (r) { setTimeout(r, 30); });
    assert.strictEqual($.heardKeyRow.hidden, false, "Busy resync must apply current host speed after a delayed Key result");
    assert.ok(/10A/.test($.heardKeyHint.textContent));
    assert.strictEqual($.heardTempoRow.hidden, false);
    assert.ok(/112\.25/.test($.heardTempoHint.textContent));
    assert.deepStrictEqual(window.BeatMarkerLibrary.get(media).beatsArray, originalGrid);
    window.BeatMarkerLibrary.upsertKey(media, "audio.wav", { camelot: "8A", key: "A", scale: "minor", material: "music", scopeKey: "music" });
    $.keyMaterialMusicBtn._fire("click");
    await new Promise(function (r) { setTimeout(r, 20); });
    $.libSectionMusicBtn._fire("click");
    const row = $.libraryDisplay.children.find(function (r) { return /lib-row/.test(r.className || ""); });
    assert.ok(row); row._fire("click");
    assert.strictEqual($.libConfirmPanel.hidden, false);
    $.libConfirmKey.value = "10A"; $.libConfirmBpm.value = "128"; $.libConfirmApplyBtn._fire("click");
    assert.strictEqual(window.BeatMarkerLibrary.get(media).confirmedBpm.value, 128);
    assert.strictEqual(window.BeatMarkerLibrary.get(media).bpm, 100);
    assert.deepStrictEqual(window.BeatMarkerLibrary.get(media).beatsArray, originalGrid);
    assert.strictEqual(window.BeatMarkerLibrary.getKey(media, "music").camelot, "10A");
    await new Promise(function (r) { setTimeout(r, 20); });
    assert.ok($.keyResultDisplay.textContent.startsWith("10A"));
    $.libMatchClipBtn._fire("click");
    assert.strictEqual($.libKeySelect.value, "10A");
    assert.strictEqual($.libBpmInput.value, "128.0");
    $.libConfirmResetBtn._fire("click");
    assert.strictEqual(window.BeatMarkerLibrary.getKey(media, "music").camelot, "8A");
    assert.strictEqual(window.BeatMarkerLibrary.get(media).confirmedBpm, null);
    await new Promise(function (r) { setTimeout(r, 20); });
    assert.ok($.keyResultDisplay.textContent.startsWith("8A"));
    $.libMatchClipBtn._fire("click"); $.libMatchClipBtn._fire("click");
    assert.strictEqual($.libKeySelect.value, "8A"); assert.strictEqual($.libBpmInput.value, "100.0");
    console.log("PASS: confirmation controls preserve beat timing and reset detector values.");
    console.log("PASS: real Detect key handlers select source scope, persist the choice and keep whole-file keys separately.");
  } finally { cp.execFile = original; fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(function (e) { console.error(e); process.exitCode = 1; });
