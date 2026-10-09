"use strict";
// Validate click timing, WAV encoding, file collisions and host placement.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const root = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
const ctx = { window: {}, Uint8Array, DataView };
for (const file of ["metronome.js", "audio-output.js", "cuesheet.js"]) {
  vm.runInNewContext(fs.readFileSync(path.join(root, "js", file), "utf8"), ctx);
}
const M = ctx.window.BeatMarkerMetronome, O = ctx.window.BeatMarkerAudioOutput, C = ctx.window.BeatMarkerCuesheet;
const rate = 44100;
const events = [{ t: 0.1, label: "D" }, { t: 0.417, label: "b" }, { t: 1.123, label: "D" }];
const wav = M.render(events, 1.5);
const view = new DataView(wav.bytes.buffer);
assert.strictEqual(Buffer.from(wav.bytes.slice(0, 4)).toString(), "RIFF");
assert.strictEqual(view.getUint32(24, true), rate);
assert.strictEqual(view.getUint16(22, true), 1);
assert.strictEqual(view.getUint16(34, true), 16);
assert.strictEqual(view.getUint32(40, true), 1.5 * rate * 2);
assert.strictEqual(wav.count, 3);
function sample(n) { return view.getInt16(44 + n * 2, true); }
for (const event of events) {
  const frame = Math.round(event.t * rate);
  assert.strictEqual(sample(frame - 1), 0);
  assert.notStrictEqual(sample(frame + 1), 0, "click starts at the detected sample, without a BPM-generated grid");
  assert.strictEqual(sample(frame + Math.round(0.03 * rate)), 0);
}
assert.strictEqual(sample(Math.round(0.75 * rate)), 0);
assert(Math.abs(sample(Math.round(0.1 * rate) + 1)) > Math.abs(sample(Math.round(0.417 * rate) + 1)), "downbeats are accented");
assert.throws(function () { M.render([], 1801); }, /durationLimit/);
assert.throws(function () { M.render([{ t: -1 }], 1); }, /noBeats/);
const mapped = C.mapEventsToSequenceSeconds({ tracks: [{ id: "t", events }] },
  { inPointSeconds: 0.2, outPointSeconds: 1.3, clipStartSeconds: 10, speed: 2 }, "t");
assert.strictEqual(mapped.droppedCount, 1);
assert(Math.abs(mapped.times[0] - 10.1085) < 1e-9);
const reverse = C.mapEventsToSequenceSeconds({ tracks: [{ id: "t", events }] },
  { inPointSeconds: 0.2, outPointSeconds: 1.3, clipStartSeconds: 10, speed: 0.5, reversed: true }, "t");
assert(Math.abs(reverse.times[0] - 11.766) < 1e-9);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-metronome-"));
try {
  const docs = path.join(work, "docs/Downbeat");
  const project = path.join(work, "project/session.aep");
  assert.strictEqual(O.directory({}, project, docs, path), path.join(docs, "processed"));
  assert.strictEqual(O.directory({ audioOutputMode: "project" }, project, docs, path), path.join(work, "project/Downbeat/processed"));
  assert.strictEqual(O.directory({ audioOutputMode: "custom", audioOutputFolder: work }, null, docs, path), work);
  assert.throws(function () { O.directory({ audioOutputMode: "project" }, null, docs, path); }, /projectUnsaved/);
  const source = path.join(work, "source.wav"); fs.writeFileSync(source, "original");
  const first = O.save(wav.bytes, work, source, fs, path);
  const second = O.save(wav.bytes, work, source, fs, path);
  assert.notStrictEqual(first, second); assert.strictEqual(fs.readFileSync(source, "utf8"), "original");
  assert(fs.readFileSync(first).equals(Buffer.from(wav.bytes)));
  const mocks = require("./host-mocks.js");
  function js(value) { return JSON.stringify(JSON.stringify(value)); }
  for (const kind of ["ae", "premiere"]) {
    const fake = kind === "ae" ? mocks.makeAeHost({ mediaPath: source, durationSec: 1.5, startTime: 10, insertDurationSec: 1.5 }) :
      mocks.makePremiereHost({ mediaPath: source, durationSec: 1.5, clipStart: 10, audioTrackCount: 3, playheadSeconds: 50, insertDurationSec: 1.5 });
    const host = mocks.loadHost(fake.context);
    const originalLayer = kind === "ae" ? fake.comp.layers[0] : null;
    const reference = JSON.parse(host.run("getSelectedAudioInfo()")).data;
    assert(reference, kind + " selected source");
    const result = JSON.parse(host.run("insertMetronomeTrack(" + js(first) + ",1.5," + js(reference) + ")"));
    assert(result.ok, kind + ": " + result.error);
    assert.strictEqual(result.data.startSeconds, 10);
    if (kind === "ae") {
      assert.strictEqual(fake.comp.layers[0], originalLayer);
      assert.strictEqual(fake.comp.layers[1].source.file.fsName, first);
      assert.strictEqual(originalLayer.audioEnabled, undefined);
    } else {
      assert.strictEqual(result.data.target, 1);
      assert.strictEqual(fake.audioTrack.clips.length, 1);
      reference.clipStartSeconds = 11;
      const changed = JSON.parse(host.run("insertMetronomeTrack(" + js(second) + ",1.5," + js(reference) + ")"));
      assert(!changed.ok && /changed/.test(changed.error));
    }
  }
  console.log("ok - metronome WAV preserves irregular beats, accent, trim/speed, files and both host placements");
} finally { fs.rmSync(work, { recursive: true, force: true }); }
