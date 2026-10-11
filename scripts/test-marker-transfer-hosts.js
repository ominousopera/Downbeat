"use strict";
const assert = require("assert"), mocks = require("./host-mocks");
function run(host, code) { return JSON.parse(host.run(code)); }
function paste(host, data, info) {
  return run(host, "pasteMarkersData(" + JSON.stringify(JSON.stringify(data)) + "," + JSON.stringify(JSON.stringify(info)) + ")");
}
{
  const fake = mocks.makePremiereHost({ mediaPath: "/a.wav", durationSec: 4, clipStart: 10 });
  const clip = fake.audioTrack.clips[0], markers = clip.projectItem.getMarkers();
  clip.inPoint.seconds = 2; clip.outPoint.seconds = 10; clip._speed = 2;
  const m = markers.createMarker(4); m.name = "Cue"; m.comments = "Direction"; m.end = 5;
  const host = mocks.loadHost(fake.context);
  const data = run(host, "getMarkersDataForSelectedClip()").data;
  assert.strictEqual(data.clipMarkers[0].localSeconds, 1);
  assert.strictEqual(data.clipMarkers[0].duration, 0.5);
  const info = run(host, "getSelectedAudioInfo()").data;
  clip.start.seconds++;
  assert.strictEqual(paste(host, data, info).ok, false);
  assert.strictEqual(markers.numMarkers, 1);
  const fresh = run(host, "getSelectedAudioInfo()").data;
  clip.projectItem = { getMediaPath: () => "/a.wav", getMarkers: () => new markers.constructor() };
  assert.strictEqual(run(host, "createClipMarkers('[4]','[\"D\"]',true," + JSON.stringify(JSON.stringify(fresh)) + ")").ok, false);
  assert.strictEqual(markers.numMarkers, 1);
}
{
  const fake = mocks.makeAeHost({ mediaPath: "/a.wav", durationSec: 8 });
  const host = mocks.loadHost(fake.context), layer = fake.comp.selectedLayers[0];
  layer.startTime = 2; layer.inPoint = 4; layer.outPoint = 8; layer.stretch = 200;
  const value = new fake.context.MarkerValue("Cue"); value.duration = 0.5; value.label = 6; value.chapter = "Chapter";
  layer.markers.setValueAtTime(5, value); layer.markers.setValueAtTime(3, new fake.context.MarkerValue("Outside"));
  const data = run(host, "getMarkersDataForSelectedClip()").data;
  assert.strictEqual(data.clipMarkers.length, 1); assert.strictEqual(data.clipMarkers[0].localSeconds, 1);
  layer.startTime = 10; layer.inPoint = 12; layer.outPoint = 16; layer.stretch = 100;
  const info = run(host, "getSelectedAudioInfo()").data;
  assert.strictEqual(paste(host, data, info).ok, true);
  const key = layer.markers.nearestKeyIndex(13), copied = layer.markers.keyValue(key);
  assert.strictEqual(layer.markers.keyTime(key), 13);
  assert.strictEqual(copied.comment, "Cue"); assert.strictEqual(copied.duration, 0.5); assert.strictEqual(copied.label, 6); assert.strictEqual(copied.chapter, "Chapter");
  layer.inPoint++;
  assert.strictEqual(paste(host, data, info).ok, false);
  assert.strictEqual(fake.state.undoDepth, 0);
}
{
  // Host proxies can change while their stable selection identifiers stay equal.
  const fake = mocks.makePremiereHost({ mediaPath: "/proxy.wav", durationSec: 4 });
  const clip = fake.audioTrack.clips[0];
  fake.sequence.sequenceID = "sequence"; clip.nodeId = "clip"; clip.projectItem.nodeId = "media";
  const host = mocks.loadHost(fake.context);
  const info = run(host, "getSelectedAudioInfo()").data;
  const proxy = Object.assign(Object.create(Object.getPrototypeOf(clip)), clip);
  proxy.projectItem = Object.assign({}, clip.projectItem);
  fake.audioTrack.clips[0] = proxy;
  fake.context.app.project.activeSequence = Object.assign({}, fake.sequence);
  function place(reference) {
    return run(host, "createClipMarkers('[1]','[\"D\"]',true," + JSON.stringify(JSON.stringify(reference)) + ")");
  }
  assert.strictEqual(place(info).ok, true);
  const fresh = run(host, "getSelectedAudioInfo()").data;
  proxy.nodeId = "other-clip";
  assert.strictEqual(place(fresh).ok, false);
  assert.strictEqual(fake.clipMarkers.numMarkers, 1);
}
for (const ae of [false,true]) {
  const fake = (ae ? mocks.makeAeHost : mocks.makePremiereHost)({mediaPath:"/duration.wav",durationSec:4});
  const host=mocks.loadHost(fake.context);
  if(ae){const value=new fake.context.MarkerValue("Long");value.duration=3;fake.comp.selectedLayers[0].markers.setValueAtTime(2,value);}
  else{const value=fake.clipMarkers.createMarker(2);value.name="Long";value.end=5;}
  const data=run(host,"getMarkersDataForSelectedClip(true)").data;
  const info=run(host,"getSelectedAudioInfo()").data;
  const result=paste(host,data,info);
  assert.strictEqual(result.ok,true);assert.strictEqual(result.data.created,1);assert.strictEqual(result.data.skipped,0);
  if(ae){assert.strictEqual(fake.comp.selectedLayers[0].markers.keyValue(1).duration,3);}
  else{assert.strictEqual(fake.clipMarkers.list[0].end.seconds,5);}
}
console.log("PASS both host adapters: heard offsets, metadata and stale-reference refusal");
