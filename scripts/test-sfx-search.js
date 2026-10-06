"use strict";
// The Library's smarter search: js/sfx-search.js over the bundled UCS list
// (js/ucs-data.js). Checks:
//  - UCS names parse into category and pack; other names do not;
//  - word starts, not word insides ("hit" is not in "white");
//  - the English thesaurus and UCS synonyms ("swoosh" finds "Whoosh" files
//    and DESIGNED / WHOOSH files), Russian and Spanish through UCS;
//  - "-word" excludes; name matches rank above category matches;
//  - speed on 30,000 files.
// Run: node scripts/test-sfx-search.js
const path = require("path");
global.window = global;
require(path.join(__dirname, "..", "js", "ucs-data.js"));
require(path.join(__dirname, "..", "js", "sfx-search.js"));
const S = global.BeatMarkerSfxSearch;

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

const risers = "DSGNRise_Short Airy Sweep, Low Sub Edge_Example Audio_Big Risers_The Full Risers Set.wav";
const u = S.parseUcsName(risers);
check("a UCS name gives category, subcategory and pack",
  u && u.catId === "DSGNRise" && u.category === "DESIGNED" && u.sub === "RISER" && u.creator === "Example Audio" && u.source === "Big Risers",
  JSON.stringify(u));
check("other names are not UCS", !S.parseUcsName("Fast Whoosh 03.wav") && !S.parseUcsName("ABCDefg_not a category.wav") && !S.parseUcsName("dsgnWhsh_lower.wav"));

function file(name, dir) { return { name: name, path: (dir || "/SFX/misc") + "/" + name }; }
const files = [
  file("Fast Whoosh 03.wav"),
  file("DSGNWhsh_Airy Pass_Example Audio_Airy Pack.wav"),
  file("FIREWhsh_Flame Pass_Example Audio_Fire Pack.wav"),
  file("White Noise Sweep.wav"),
  file("Big Hit 01.wav"),
  file("Tractor Idle.wav"),
  file("Footsteps Gravel.wav"),
  file("Wooden Door Creak.wav"),
  file("FEETHmn_Boots On Gravel_Example Audio_Steps Pack.wav")
];
function search(q) {
  const c = S.compile(q);
  return files.map(function (f) { return { f: f, s: S.score(c, f) }; }).filter(function (x) { return x.s >= 0; })
    .sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.f.name; });
}
let r = search("swoosh");
check("\"swoosh\" finds a Whoosh-named file (thesaurus) and the WHOOSH category (UCS)",
  r.indexOf("Fast Whoosh 03.wav") !== -1 && r.indexOf("DSGNWhsh_Airy Pass_Example Audio_Airy Pack.wav") !== -1 && r.indexOf("White Noise Sweep.wav") === -1, r.join(" | "));
r = search("hit");
check("\"hit\" matches a word start, not the inside of \"white\"", r.indexOf("Big Hit 01.wav") !== -1 && r.indexOf("White Noise Sweep.wav") === -1, r.join(" | "));
r = search("whoosh -fire");
check("\"-fire\" excludes", r.indexOf("FIREWhsh_Flame Pass_Example Audio_Fire Pack.wav") === -1 && r.indexOf("Fast Whoosh 03.wav") !== -1, r.join(" | "));
r = search("trac");
check("part of a word finds the whole word (\"trac\" -> Tractor)", r.join() === "Tractor Idle.wav", r.join(" | "));
r = search("whoosh");
check("a name match ranks above a category-only match", r[0] === "Fast Whoosh 03.wav", r.join(" | "));
r = search("\u0441\u0432\u0438\u0441\u0442"); // Russian "svist" (whoosh, whistle)
check("Russian \"svist\" finds the WHOOSH category and Whoosh-named files", r.indexOf("DSGNWhsh_Airy Pass_Example Audio_Airy Pack.wav") !== -1 && r.indexOf("Fast Whoosh 03.wav") !== -1, r.join(" | "));
r = search("\u0448\u0430\u0433\u043e\u0432"); // Russian "shagov" (of steps)
check("Russian case endings: \"shagov\" finds footsteps", r.indexOf("Footsteps Gravel.wav") !== -1 && r.indexOf("FEETHmn_Boots On Gravel_Example Audio_Steps Pack.wav") !== -1, r.join(" | "));
r = search("impacto");
check("Spanish \"impacto\" finds impacts by synonym", r.indexOf("Big Hit 01.wav") !== -1, r.join(" | "));
// Speed: 30,000 files, half UCS-named.
const big = [];
const words = ["Whoosh", "Impact", "Riser", "Door", "Glass", "Wind", "Crowd", "Engine", "Beep", "Drone"];
for (let i = 0; i < 30000; i++) {
  big.push(i % 2 ? file("DSGNWhsh_Variation " + i + "_Vendor_Pack " + (i % 40) + ".wav", "/SFX/Vendor " + (i % 7))
                 : file(words[i % words.length] + " Take " + i + ".wav", "/SFX/Other " + (i % 5)));
}
let t0 = Date.now();
big.forEach(function (f) { S.fileInfo(f); });
const cacheMs = Date.now() - t0;
t0 = Date.now();
const c = S.compile("swoosh -glass");
const n = big.filter(function (f) { return S.score(c, f) >= 0; }).length;
const searchMs = Date.now() - t0;
check("30,000 files: the first pass and a search stay fast", cacheMs < 1000 && searchMs < 300 && n > 15000,
  "first pass " + cacheMs + " ms, search " + searchMs + " ms, " + n + " matches");
// Synonyms off: only the typed words count.
S.setSynonyms(false);
const plain = S.compile("hit");
check("with synonyms off, \"hit\" adds no synonyms and no categories",
  plain.include[0].expand.length === 0 && Object.keys(plain.include[0].cats.syn).length === 0 && Object.keys(plain.include[0].cats.strong).length === 0);
S.setSynonyms(true);
check("and with them on again, \"hit\" finds impact, punch, slam...", S.compile("hit").include[0].expand.indexOf("impact") !== -1);

if (failures) {
  console.error("\n" + failures + " search check(s) failed");
  process.exit(1);
}
console.log("\nthe Library search matches word starts, synonyms and UCS categories");
