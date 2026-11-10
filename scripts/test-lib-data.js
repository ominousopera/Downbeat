"use strict";
// The Library's data and search rules (js/sound-library.js, js/sfx-search.js,
// the plural forms in js/i18n.js), on the pure modules:
//   - a query word with a hyphen or apostrophe finds the name holding it;
//     a name stored decomposed (NFD) is found by the composed query;
//   - Start scan keeps a starred sound whose file is gone, moves a record
//     with its file (same name, size and date), skips NAS recycle folders;
//   - two hosts keep each other's stars, and take in every file a scan
//     dropped, however many;
//   - Load a copy brings back stars and keys set by hand on files the
//     library already has;
//   - a folder in both sections is reported; "1 file" reads as one.
// Run: node scripts/test-lib-data.js
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.window = global;
require(path.join(ROOT, "js", "camelot.js"));
require(path.join(ROOT, "js", "ucs-data.js"));
require(path.join(ROOT, "js", "sfx-search.js"));
require(path.join(ROOT, "js", "i18n.js"));
function freshLibrary() {
  const file = path.join(ROOT, "js", "sound-library.js");
  delete require.cache[require.resolve(file)];
  require(file);
  return global.BeatMarkerSoundLibrary;
}

let failures = 0;
function check(label, ok, detail) {
  if (!ok) { failures++; }
  console.log((ok ? "ok   " : "FAIL ") + label + (ok || detail === undefined ? "" : " - " + detail));
}

// Search.
(function () {
  const SL = freshLibrary();
  const f = (name) => ({ name: name, path: "/SFX/Pack/" + name, section: "sfx", status: "done" });
  const items = [f("Sci-Fi Laser Shot 01.wav"), f("Sub-Drop Deep 02.wav"), f("Don't Stop Voice.wav"), f("Subway Drop 03.wav"),
    f("Fire Crackle.wav"), f("Café Ambience 01.wav".normalize("NFD"))];
  const names = (q) => SL.search(items, { text: q, roots: ["/SFX"] }).map((it) => it.name);
  check("\"sci-fi\" finds Sci-Fi Laser", names("sci-fi").indexOf("Sci-Fi Laser Shot 01.wav") !== -1, JSON.stringify(names("sci-fi")));
  global.BeatMarkerSfxSearch.setSynonyms(false); // with synonyms, "drop" also finds Subway Drop
  check("\"sub-drop\" is one phrase: Sub-Drop, not Subway Drop", JSON.stringify(names("sub-drop")) === JSON.stringify(["Sub-Drop Deep 02.wav"]), JSON.stringify(names("sub-drop")));
  global.BeatMarkerSfxSearch.setSynonyms(true);
  check("\"don't\" finds Don't Stop", JSON.stringify(names("don't")) === JSON.stringify(["Don't Stop Voice.wav"]), JSON.stringify(names("don't")));
  check("\"-sci-fi\" leaves out only Sci-Fi (not every \"fi...\" word)", names("-sci-fi").indexOf("Fire Crackle.wav") !== -1 &&
    names("-sci-fi").indexOf("Sci-Fi Laser Shot 01.wav") === -1, JSON.stringify(names("-sci-fi")));
  check("\"café\" finds a name stored decomposed", names("café").length === 1, JSON.stringify(names("café")));
})();

// Start scan: gone, moved, recycle folders.
(function () {
  const SL = freshLibrary();
  const rec = (p, extra) => Object.assign({ path: p, section: "sfx", name: path.basename(p), size: 10, mtimeMs: 5, status: "done", v: 3, camelot: "8A", key: "A", scale: "minor" }, extra);
  SL.loadState({ folders: { music: [], sfx: ["/SFX"] }, files: {
    "/SFX/Old/Whoosh 01.wav": rec("/SFX/Old/Whoosh 01.wav", { fav: true }),
    "/SFX/Old/Hit 02.wav": rec("/SFX/Old/Hit 02.wav"),
    "/SFX/Old/Rain 03.wav": rec("/SFX/Old/Rain 03.wav", { fav: true }),
    "/SFX/Old/Drip 04.wav": rec("/SFX/Old/Drip 04.wav")
  } });
  // Whoosh and Hit moved to New/ (same name, size and date); Rain and Drip are gone.
  const found = [{ path: "/SFX/New/Whoosh 01.wav", size: 10, mtimeMs: 5 }, { path: "/SFX/New/Hit 02.wav", size: 10, mtimeMs: 5 }];
  found.incomplete = [];
  const sync = SL.syncFiles("sfx", found, []);
  const files = SL.getState().files;
  check("a moved file keeps its record and star at the new place", files["/SFX/New/Whoosh 01.wav"] && files["/SFX/New/Whoosh 01.wav"].fav === true &&
    files["/SFX/New/Whoosh 01.wav"].status === "done" && !files["/SFX/Old/Whoosh 01.wav"] && files["/SFX/New/Hit 02.wav"].camelot === "8A", JSON.stringify(sync));
  check("a gone starred file stays (\"file not found\"); a gone plain one goes", !!files["/SFX/Old/Rain 03.wav"] && !files["/SFX/Old/Drip 04.wav"] &&
    sync.moved === 2 && sync.removed === 1 && sync.added === 0, JSON.stringify(sync));
  const tree = { "/NAS": ["Rain", "#recycle", "@Recycle", "@eaDir", "#snapshot"], "/NAS/Rain": ["Rain 1.wav"], "/NAS/#recycle": ["Rain 2.wav"],
    "/NAS/@Recycle": ["Old.wav"], "/NAS/@eaDir": ["x.wav"], "/NAS/#snapshot": ["y.wav"] };
  SL.loadState({ folders: { music: [], sfx: ["/NAS"] }, files: {} });
  const listed = SL.listAudioFiles({ readdirSync: (d) => tree[d] || [], lstatSync: (p) => ({ isDirectory: () => !!tree[p], isFile: () => !tree[p], size: 1, mtimeMs: 1 }) }, "sfx");
  check("a NAS share's recycle and system folders are not scanned", JSON.stringify(listed.map((x) => x.path)) === JSON.stringify(["/NAS/Rain/Rain 1.wav"]),
    JSON.stringify(listed.map((x) => x.path)));
})();

// Two hosts.
(function () {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const PR = freshLibrary(); const prState = PR.getState;
  const AE = freshLibrary();
  // freshLibrary replaces the global; each keeps its own closure state.
  const X = "/SFX/Whoosh 07.wav";
  PR.addFolder("sfx", "/SFX");
  PR.syncFiles("sfx", [{ path: X, size: 1, mtimeMs: 1 }], []);
  let file = JSON.parse(JSON.stringify(prState()));
  AE.loadState(file);
  now += 5000; AE.setFavorite(X, true); file = JSON.parse(JSON.stringify(AE.getState()));
  now += 1000; PR.setResult(X, { ok: true, durationSec: 1, camelot: "8A", key: "A", scale: "minor" });
  now += 1000; PR.absorb(file); file = JSON.parse(JSON.stringify(PR.getState()));
  now += 1000; AE.absorb(file);
  check("a star set in one host survives the other's newer scan result", file.files[X].fav === true && file.files[X].camelot === "8A" && AE.getState().files[X].fav === true);
  now += 1000; PR.setFavorite(X, false); file = JSON.parse(JSON.stringify(PR.getState()));
  now += 1000; AE.setResult(X, { ok: true, durationSec: 1, camelot: "9A", key: "E", scale: "minor" }); AE.absorb(file);
  check("taking the star off in one host holds against the other's newer result", !AE.getState().files[X].fav && AE.getState().files[X].camelot === "9A");
  // 8,000 files leave in one scan.
  const P2 = freshLibrary(), A2 = freshLibrary();
  const olds = [], news = [];
  for (let i = 0; i < 8000; i++) {
    olds.push({ path: "/C/SFX/S " + i + ".wav", size: 1, mtimeMs: 1 });
    news.push({ path: "/C/SFX 2/T " + i + ".wav", size: 1, mtimeMs: 1 });
  }
  P2.addFolder("sfx", "/C");
  P2.syncFiles("sfx", olds, []);
  A2.loadState(JSON.parse(JSON.stringify(P2.getState())));
  now += 60000; P2.syncFiles("sfx", news, []);
  now += 1000; A2.absorb(JSON.parse(JSON.stringify(P2.getState())));
  const ghosts = Object.keys(A2.getState().files).filter((p) => p.indexOf("/SFX/") !== -1).length;
  check("8,000 files gone in one scan leave the other host too", ghosts === 0, ghosts + " ghosts");
  Date.now = realNow;
})();

// Load a copy; a folder in both sections.
(function () {
  const SL = freshLibrary();
  const p = "/SFX/Whoosh 01.wav";
  const rec = (extra) => Object.assign({ path: p, section: "sfx", name: "Whoosh 01.wav", size: 10, mtimeMs: 5, status: "done", v: 3, camelot: "8A", key: "A", scale: "minor" }, extra);
  SL.loadState({ folders: { music: [], sfx: ["/SFX"] }, files: { [p]: rec({ updatedAt: 2000 }) } });
  const added = SL.mergeState({ folders: { music: [], sfx: ["/SFX"] }, files: { [p]: rec({ fav: true, confirmedKey: { camelot: "5A", source: "user" }, updatedAt: 1000 }) } });
  const r = SL.getState().files[p];
  check("Load a copy brings back the star and the key set by hand", r.fav === true && r.camelot === "5A" && r.keyFrom === "user" && added.marks === 1 && added.files === 0,
    JSON.stringify(added) + " " + r.camelot);
  const other = SL.mergeState({ folders: {}, files: { [p]: rec({ fav: true, size: 11 }) } });
  check("a copy of a changed file (other size) restores nothing", other.marks === 0);
  SL.loadState({ folders: { music: ["/Packs"], sfx: ["/Packs"] }, files: {} });
  check("a folder in both sections is reported", SL.overlappingFolders("music").length === 1 && SL.overlappingFolders("sfx").length === 1);
})();

// Plural forms.
(function () {
  const I18n = global.BeatMarkerI18n;
  const said = {};
  ["en", "ru", "es"].forEach(function (lang) {
    I18n.setLanguage(lang);
    said[lang] = [1, 2, 5, 21].map((n) => I18n.t("library.upToDate", { count: n }));
  });
  I18n.setLanguage("en");
  check("\"Everything is analyzed\" counts files in each language",
    said.en[0] === "Everything is analyzed (1 file)." && said.en[1] === "Everything is analyzed (2 files)." &&
    // Russian: 1 and 21 share a form, 2 and 5 each have their own.
    said.ru[3] === said.ru[0].replace("1", "21") && said.ru[1].replace("2", "1") !== said.ru[0] &&
    said.ru[2].replace("5", "2") !== said.ru[1] && said.ru[2].replace("5", "1") !== said.ru[0] &&
    /\(1 archivo\)/.test(said.es[0]) && /\(2 archivos\)/.test(said.es[1]), JSON.stringify(said));
})();

if (failures) {
  console.error("\n" + failures + " Library data check(s) failed");
  process.exit(1);
}
console.log("\nLibrary search, scan, two-host and copy rules hold");
