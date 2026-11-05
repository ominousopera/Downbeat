"use strict";
// A Premiere WebLink marker keeps its address through Copy markers and
// Paste markers here. Premiere gives the address only through the
// documented Marker.getWebLinkURL() / getWebLinkFrameTarget(); the stand-in
// in scripts/host-mocks.js has no url property either, as in Premiere.
// Run: node scripts/test-marker-weblink.js
const mocks = require("./host-mocks.js");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function run(host, code) { return JSON.parse(host.run(code)); }
function js(v) { return JSON.stringify(JSON.stringify(v)); }

const fake = mocks.makePremiereHost({ mediaPath: "/music/a.wav", durationSec: 8, clipStart: 10 });
const clip = fake.audioTrack.clips[0];
const source = clip.projectItem.getMarkers();
const link = source.createMarker(2);
link.name = "Site";
link.comments = "Open the page";
link.setTypeAsWebLink("https://example.com/page", "_blank");
check("the stand-in, like Premiere, has no url property", link.url === undefined && link.getWebLinkURL() === "https://example.com/page");

const host = mocks.loadHost(fake.context);
const copied = run(host, "getMarkersDataForSelectedClip()");
const data = copied.data;
const item = data && data.clipMarkers ? data.clipMarkers.filter(function (m) { return m.type === "WebLink"; })[0] : null;
check("Copy markers reads the address and frame target",
  copied.ok && item && item.url === "https://example.com/page" && item.frameTarget === "_blank", JSON.stringify(item || copied.error));

// Paste onto another file's clip at the same place.
const target = new source.constructor();
clip.projectItem = { name: "b.wav", getMediaPath: function () { return "/music/b.wav"; }, getMarkers: function () { return target; } };
const info = run(host, "getSelectedAudioInfo()").data;
const pasted = run(host, "pasteMarkersData(" + js(data) + "," + js(info) + ")");
const placed = target.list.filter(function (m) { return m.type === "WebLink"; })[0];
check("Paste markers here gives the pasted marker the same address",
  pasted.ok && placed && placed.getWebLinkURL() === "https://example.com/page" && placed.getWebLinkFrameTarget() === "_blank",
  JSON.stringify(pasted.error || (placed ? { url: placed._url, target: placed._target } : "no WebLink marker pasted")));

if (failures) {
  console.error("\n" + failures + " WebLink check(s) failed");
  process.exit(1);
}
console.log("\nWebLink markers keep their address through Copy and Paste");
