"use strict";
// A delayed decoder and inspectable worker replace external services.
const fs=require("fs"),os=require("os"),path=require("path"),assert=require("assert"),cp=require("child_process");
const root=process.env.DOWNBEAT_ROOT || path.resolve(__dirname,".."),tmp=fs.mkdtempSync(path.join(os.tmpdir(),"downbeat-cancel-")),docs=path.join(tmp,"docs"),folder=path.join(tmp,"samples");
fs.mkdirSync(path.join(docs,"Downbeat"),{recursive:true});fs.mkdirSync(folder);
fs.writeFileSync(path.join(folder,"plain.mp3"),"decoder fixture");
fs.writeFileSync(path.join(docs,"Downbeat/settings.json"),JSON.stringify({language:"en",onboardingCompleted:true}));
const mocks=require("./host-mocks.js"),host=mocks.loadHost(mocks.makePremiereHost({mediaPath:"/other.wav",durationSec:8}).context);
const panel=require("./panel-harness.js").bootPanel({docsDir:docs,realTimeouts:true,evalScript:host.evalScript});
const $=panel.registry,lib=window.BeatMarkerSoundLibrary;
let release,started=false,launches=0,kills=0;
window.BeatMarkerAudio.readFileAsArrayBuffer=()=>Promise.resolve(new ArrayBuffer(1));
window.BeatMarkerAudio.decodeToMono44100=()=>{started=true;return new Promise(r=>{release=r;});};
const originalExec=cp.execFile;
cp.execFile=function(executable,args,options,callback){
 if(args[1]!=="library")return originalExec.apply(this,arguments);
 launches++;setTimeout(()=>callback(null,JSON.stringify({ok:true,data:{results:[{ok:true,durationSec:1,bpm:120,bpmConfidence:1}]}}),""),20);
 return {kill(){kills++;}};
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 lib.addFolder("music",folder);$.libRescanBtn._fire("click");
 for(let i=0;i<50&&!started;i++)await wait(10);
 assert.ok(started,"decoder must be in flight");assert.strictEqual(launches,0);
 $.libScanCancelBtn._fire("click");release({samples:new Float32Array(44100)});await wait(100);
 assert.strictEqual(launches,0,"no worker launch after Cancel");assert.strictEqual(kills,0);
 assert.strictEqual($.libScanOverlay.hidden,true);
 assert.strictEqual(lib.getState().files[path.join(folder,"plain.mp3")].status,"pending");
 console.log("PASS cancellation prevents the next analysis stage",JSON.stringify({launchesAfterCancel:launches,kills,status:$.libScanStatus.textContent,record:lib.getState().files[path.join(folder,"plain.mp3")]}));
 cp.execFile=originalExec;fs.rmSync(tmp,{recursive:true,force:true});process.exit(0);
})().catch(e=>{cp.execFile=originalExec;fs.rmSync(tmp,{recursive:true,force:true});console.error(e);process.exit(1);});
