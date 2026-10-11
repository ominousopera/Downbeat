"use strict";
const fs=require("fs"),path=require("path"),os=require("os"),assert=require("assert");
const root=process.env.DOWNBEAT_ROOT || path.resolve(__dirname,".."),tmp=fs.mkdtempSync(path.join(os.tmpdir(),"downbeat-audit-move-"));
fs.mkdirSync(path.join(tmp,"Downbeat"));fs.writeFileSync(path.join(tmp,"Downbeat/settings.json"),JSON.stringify({language:"en",onboardingCompleted:true}));
const mocks=require("./host-mocks.js");
const fake=mocks.makePremiereHost({mediaPath:"/source.wav",durationSec:8,clipStart:10});
const clip=fake.audioTrack.clips[0],sourceMarkers=clip.projectItem.getMarkers(),targetMarkers=new sourceMarkers.constructor();
sourceMarkers.createMarker(2).name="Source note";targetMarkers.createMarker(3).name="Target note to preserve";
const host=mocks.loadHost(fake.context);
const panel=require("./panel-harness.js").bootPanel({docsDir:tmp,realTimeouts:true,evalScript:(script,callback)=>{
  if(/^getMarkersDataForSelectedClip\(/.test(script)){
    const answer=host.run(script);
    clip.projectItem={name:"target.wav",getMediaPath:()=>"/target.wav",getMarkers:()=>targetMarkers};clip.name="target.wav";
    setTimeout(()=>callback(answer),20);
  }else host.evalScript(script,callback);
}});
panel.registry.removeAfterCopyCheckbox.checked=true;panel.registry.copyMarkersBtn._fire("click");
setTimeout(()=>{
  assert.strictEqual(sourceMarkers.numMarkers,0);assert.strictEqual(targetMarkers.numMarkers,1);
  console.log("PASS move deletes the captured source only; delayed callback preserves the target",JSON.stringify({source:sourceMarkers.numMarkers,target:targetMarkers.numMarkers}));
  fs.rmSync(tmp,{recursive:true,force:true});process.exit(0);
},100);
