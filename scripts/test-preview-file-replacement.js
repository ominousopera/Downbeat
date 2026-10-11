"use strict";
// Replace a loaded WAV and rescan through the real panel handlers.
const fs=require("fs"),path=require("path"),os=require("os"),assert=require("assert"),cp=require("child_process");
const root=process.env.DOWNBEAT_ROOT || path.resolve(__dirname,".."),tmp=fs.mkdtempSync(path.join(os.tmpdir(),"downbeat-audit-preview-")),docs=path.join(tmp,"docs"),folder=path.join(tmp,"samples"),media=path.join(folder,"tone_Am.wav");
fs.mkdirSync(path.join(docs,"Downbeat"),{recursive:true});fs.mkdirSync(folder);
function tone(duration){cp.execFileSync("ffmpeg",["-v","error","-y","-f","lavfi","-i","sine=frequency=440:duration="+duration,"-ac","1",media]);}
tone(1);fs.writeFileSync(path.join(docs,"Downbeat/settings.json"),JSON.stringify({language:"en",onboardingCompleted:true,librarySection:"sfx"}));
const sources=[];
function Param(){this.value=1;}Param.prototype.setValueAtTime=function(){};Param.prototype.setValueCurveAtTime=function(){};
class Buffer {constructor(ch,len,rate){this.numberOfChannels=ch;this.length=len;this.sampleRate=rate;this.duration=len/rate;this.data=Array.from({length:ch},()=>new Float32Array(len));} getChannelData(c){return this.data[c];} copyToChannel(d,c){this.data[c].set(d);}}
global.AudioContext=class {constructor(){this.currentTime=0;this.state="running";this.destination={};}createGain(){return {gain:new Param(),connect(){},disconnect(){}};}createBuffer(ch,len,rate){return new Buffer(ch,len,rate);}createBufferSource(){const s={playbackRate:new Param(),connect(){},disconnect(){},stop(){},start(){}};sources.push(s);return s;}};
const mocks=require("./host-mocks.js"),host=mocks.loadHost(mocks.makePremiereHost({mediaPath:"/other.wav",durationSec:8}).context);
const panel=require("./panel-harness.js").bootPanel({docsDir:docs,realTimeouts:true,evalScript:host.evalScript});
const $=panel.registry,lib=window.BeatMarkerSoundLibrary;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function row(){return $.libraryDisplay.children.find(x=>/lib-row/.test(x.className||"")&&/tone/.test(x.textContent));}
async function scan(){ $.libRescanBtn._fire("click");await wait(80);assert.strictEqual($.libScanOverlay.hidden,true); }
(async()=>{
 lib.addFolder("sfx",folder);await scan();row()._fire("click");await wait(180);
 assert.ok(/0:01.00/.test($.libPaneTime.textContent));
 tone(3);await scan();assert.strictEqual(lib.getState().files[media].durationSec,3);
 row()._fire("click");await wait(180);$.libPanePlayBtn._fire("click");
 assert.strictEqual(sources.at(-1).buffer.duration,3);
 console.log("PASS source replacement reloads preview: record and buffer are 3s",JSON.stringify({record:lib.getState().files[media].durationSec,pane:$.libPaneTime.textContent,played:sources.at(-1).buffer.duration}));
 fs.rmSync(tmp,{recursive:true,force:true});process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
