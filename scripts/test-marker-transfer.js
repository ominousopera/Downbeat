"use strict";
// Real Copy/Paste handlers and real Premiere adapter with isolated host data.
const fs=require("fs"),path=require("path"),os=require("os"),assert=require("assert");
const root=process.env.DOWNBEAT_ROOT || path.resolve(__dirname,".."),tmp=fs.mkdtempSync(path.join(os.tmpdir(),"downbeat-audit-copy-"));
fs.mkdirSync(path.join(tmp,"Downbeat"));fs.writeFileSync(path.join(tmp,"Downbeat/settings.json"),JSON.stringify({language:"en",onboardingCompleted:true}));
const mocks=require("./host-mocks.js");
const fake=mocks.makePremiereHost({mediaPath:"/source.wav",durationSec:4,clipStart:10});
const clip=fake.audioTrack.clips[0];clip.inPoint.seconds=2;clip.outPoint.seconds=6;
const markers=clip.projectItem.getMarkers();
const before=markers.createMarker(1);before.name="Outside";
const inside=markers.createMarker(4);inside.name="Editor cue";inside.comments="Important direction";inside.end={seconds:4.5};
const host=mocks.loadHost(fake.context);
const panel=require("./panel-harness.js").bootPanel({docsDir:tmp,realTimeouts:true,evalScript:host.evalScript});
const $=panel.registry;
const wait=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
  $.copyMarkersBtn._fire("click");await wait();
  const copied=JSON.parse(host.run("getMarkersDataForSelectedClip()")).data;
  assert.strictEqual(copied.clipMarkers.length,1,"Exclude markers outside selected source interval");
  assert.strictEqual(copied.clipMarkers[0].comments,"Important direction");
  assert.strictEqual(copied.clipMarkers[0].duration,0.5);
  // Change the selected clip to another source, with different source trim.
  const targetMarkers=new markers.constructor();
  clip.projectItem={name:"target.wav",getMediaPath:()=>"/target.wav",getMarkers:()=>targetMarkers};
  clip.name="target.wav";clip.inPoint.seconds=10;clip.outPoint.seconds=14;clip.start.seconds=20;clip.end.seconds=24;
  $.pasteMarkersBtn._fire("click");await wait();
  assert.deepStrictEqual(targetMarkers.list.map(m=>m.start.seconds),[12]);
  assert.strictEqual(targetMarkers.list.filter(m=>m.start.seconds>=10&&m.start.seconds<=14).length,1);
  assert.strictEqual(targetMarkers.list[0].comments,"Important direction");
  assert.strictEqual(targetMarkers.list[0].end.seconds,12.5);
  console.log("PASS marker transfer preserves heard offsets, comments and duration");
  fs.rmSync(tmp,{recursive:true,force:true});process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
