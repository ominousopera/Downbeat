"use strict";
// Validate waveform sample ownership and stale asynchronous decode results.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js/beat-preview.js"), "utf8");
const samples = new Float32Array(88200).fill(0.3);
const tick = function () { return new Promise(function (resolve) { setImmediate(resolve); }); };
function fixture() {
  let analysis, decodedPath, decodedSamples, rects = [], urlCount = 0;
  const elements = {}, requests = [], logs = [], revoked = [];
  const drawing = { setTransform: function () {}, clearRect: function () { rects = []; }, fillRect: function (x, y, w, h) { rects.push({ color: this.fillStyle, h }); } };
  function element(id) {
    if (!elements[id]) {
      elements[id] = { style: {}, classList: { toggle: function () {} }, checked: true, value: "100",
        paused: true, duration: 2, currentTime: 0, clientWidth: 100, clientHeight: 40, width: 100, height: 40,
        addEventListener: function () {}, getAttribute: function (k) { return this[k]; },
        getContext: function () { return drawing; }, pause: function () { this.paused = true; } };
    }
    return elements[id];
  }
  const sandbox = { Float32Array, ArrayBuffer, DataView, Blob, Promise, Math, console,
    document: { getElementById: element }, addEventListener: function () {},
    requestAnimationFrame: function () {}, cancelAnimationFrame: function () {},
    setInterval: function () {}, clearInterval: function () {},
    URL: { createObjectURL: function () { return "blob:" + (++urlCount); }, revokeObjectURL: function (u) { revoked.push(u); } },
    BeatMarkerCuesheet: { buildDownbeatsTrack: function () { return { events: [{ t: 0 }, { t: 1 }] }; } },
    BeatMarkerAudio: { TARGET_SAMPLE_RATE: 44100, decodeFileToMono44100: function (p) {
      return new Promise(function (resolve, reject) { requests.push({ path: p, resolve, reject }); });
    } } };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  const preview = sandbox.BeatMarkerBeatPreview.create({ log: function (s) { logs.push(s); },
    basename: function (p) { return p.split("/").pop(); }, formatPlayerTime: String,
    retempoRow: element("retempo"), lastAnalysis: function () { return analysis; },
    lastDecodedSamplesPath: function () { return decodedPath; }, lastDecodedSamples: function () { return decodedSamples; } });
  return { preview, requests, logs, revoked, elements,
    select: function (p, pcm) { analysis = { audioPath: p, beatsArray: [0, 1], phase: 0, confidence: 1 }; decodedPath = pcm ? p : null; decodedSamples = pcm || null; preview.refresh(); },
    waveform: function () { return rects.filter(function (r) { return /^rgba/.test(r.color); }).length; },
    image: function () { return JSON.stringify(rects); }, urls: function () { return urlCount; } };
}
(async function () {
  const f = fixture();
  f.select("/music/cached.wav");
  assert.strictEqual(f.waveform(), 0);
  assert.strictEqual(f.requests.length, 1);
  f.preview.refresh();
  assert.strictEqual(f.requests.length, 1, "same-file reads are shared");
  f.requests[0].resolve({ samples }); await tick();
  assert(f.waveform() > 0, "saved beats regain their waveform");
  f.preview.refresh(); assert.strictEqual(f.requests.length, 1, "decoded samples are retained");
  f.select("/music/fresh.wav", samples);
  assert(f.waveform() > 0); assert.strictEqual(f.requests.length, 1, "fresh analysis needs no extra decode");
  f.select("/music/slow.wav");
  f.select("/music/current.wav", samples);
  const current = f.image();
  f.requests[1].resolve({ samples: new Float32Array(88200) }); await tick();
  assert.strictEqual(f.image(), current, "late samples cannot replace the selected track");
  f.select("/music/hidden.wav"); f.preview.hide();
  f.requests[2].resolve({ samples }); await tick();
  assert.strictEqual(f.elements.beatClickWaveformRow.style.display, "none");
  f.select("/music/unreadable.wav"); f.requests[3].reject(new Error("cannot decode")); await tick();
  assert(f.logs.some(function (s) { return /could not read the waveform/.test(s); }));
  f.preview.refresh(); assert.strictEqual(f.requests.length, 5, "failed reads can be retried");
  f.requests[4].resolve({ samples }); await tick(); assert(f.waveform() > 0);
  const a = fixture();
  a.select("/music/slow.aiff"); a.select("/music/current.aiff");
  assert.strictEqual(a.requests.length, 2, "AIFF playback and waveform share each decode");
  a.requests[1].resolve({ samples }); await tick();
  const activeUrl = a.elements.beatClickAudio.src;
  a.requests[0].resolve({ samples }); await tick();
  assert.strictEqual(a.elements.beatClickAudio.src, activeUrl);
  assert.strictEqual(a.urls(), 1, "late AIFF results cannot replace or revoke the current URL");
  assert.deepStrictEqual(a.revoked, []);
  assert(a.waveform() > 0);
  console.log("ok - cached, fresh, failed and rapidly switched previews retain the matching waveform");
})().catch(function (err) { console.error(err); process.exitCode = 1; });
