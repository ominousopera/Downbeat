"use strict";
// The Library tab end to end with the real panel, host scripts and workers.
// Needs ffmpeg and the local test tracks; skips (exit 0) without them.
// Run: node scripts/test-library-tab.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TRACK_A = require("./test-tracks.js").named("applies");
const TRACK_B = require("./test-tracks.js").named("rejected");
function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; }
}
if (!fs.existsSync(TRACK_A) || !fs.existsSync(TRACK_B) || !hasFfmpeg()) {
  console.log("skip - needs ffmpeg and the test tracks in the test-music folder (see scripts/test-tracks.js)");
  process.exit(0);
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-libtab-"));
const DOCS = path.join(WORK, "docs");
const MUSIC = path.join(WORK, "My Music");
const SFX = path.join(WORK, "My SFX");
fs.mkdirSync(path.join(DOCS, "Downbeat"), { recursive: true });
fs.mkdirSync(path.join(MUSIC, "sub"), { recursive: true });
fs.mkdirSync(SFX);
fs.copyFileSync(TRACK_A, path.join(MUSIC, "Track One.mp3"));
fs.copyFileSync(TRACK_B, path.join(MUSIC, "sub", "Track Two.mp3"));
fs.writeFileSync(path.join(MUSIC, "notes.txt"), "not audio");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "1", path.join(SFX, "tone A.wav")]);
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=4:c=pink:a=0.3:r=44100", "-ac", "1", path.join(SFX, "wind noise.wav")]);
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));
const mocks = require("./host-mocks.js");
const fake = mocks.makePremiereHost({ mediaPath: "/music/other.mp3", durationSec: 200, clipStart: 0, audioTrackCount: 2, playheadSeconds: 12, insertDurationSec: 30 });
let nextFolder = null;
fake.context.Folder = { selectDialog: function () { return nextFolder ? { fsName: nextFolder } : null; }, desktop: { fsName: WORK } };
const host = mocks.loadHost(fake.context);

const { bootPanel } = require("./panel-harness.js");
// Counts the selection-poll calls, for the open-dropdown check below.
let selectionPolls = 0;
function countingEvalScript(script, callback) {
  if (/^getSelectedAudioInfo\(\)/.test(script)) { selectionPolls++; }
  return host.evalScript(script, callback);
}
const panel = bootPanel({ docsDir: DOCS, evalScript: countingEvalScript, realTimeouts: true, realIntervals: false });
const $ = panel.registry;
// Web Audio stand-ins: the "ArrayBuffer" carries the path, ffmpeg decodes it.
window.BeatMarkerAudio.readFileAsArrayBuffer = function (p) { return Promise.resolve({ path: p }); };
window.BeatMarkerAudio.decodeToMono44100 = function (buf) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", buf.path, "-f", "f32le", "-ar", "44100", "-ac", "1", "-"], { maxBuffer: 600 * 1024 * 1024 });
  const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  return Promise.resolve({ samples: samples, original: { durationSec: samples.length / 44100, sampleRate: 44100, channels: 1 } });
};

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function rows() { return $.libraryDisplay.children.filter(function (c) { return /lib-row/.test(c.className || ""); }); }
function rowText(r) { return r.textContent; }
function waitFor(cond, label, ms) {
  const t0 = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (cond()) { return resolve(); }
      if (Date.now() - t0 > (ms || 180000)) { return reject(new Error(label + " did not happen in time")); }
      setTimeout(poll, 100);
    })();
  });
}
function scanFinished() { return /Done|Everything|Stopped/.test($.libScanStatus.textContent) && $.libScanOverlay.hidden; }
function logText() { return $.log.textContent; }
function setFilter(el, value, evt) { el.value = value; el._fire(evt || "input"); }

let t0 = Date.now();
nextFolder = MUSIC;
$.libAddFolderBtn._fire("click");
waitFor(function () { return /Folder added/.test($.libScanStatus.textContent); }, "adding the music folder", 10000)
  .then(function () {
    // Adding only lists the files; the scan waits for Start scan.
    const waiting = rows();
    check("Add folder lists the audio files (subfolders too) as waiting, without scanning",
      waiting.length === 2 && waiting.every(function (x) { return /waiting for analysis/.test(rowText(x)); }) && $.libScanOverlay.hidden &&
      /Start scan \(2\)/.test($.libRescanBtn.textContent), $.libScanStatus.textContent + " | " + $.libRescanBtn.textContent);
    t0 = Date.now();
    $.libScanStatus.textContent = "";
    $.libRescanBtn._fire("click");
    return waitFor(scanFinished, "the music scan");
  })
  .then(function () {
    const r = rows();
    check("Start scan analyzes them", r.length === 2 && /^Start scan$/.test($.libRescanBtn.textContent),
      r.length + " rows in " + ((Date.now() - t0) / 1000).toFixed(1) + " s: " + $.libScanStatus.textContent);
    const a = r.find(function (x) { return /Track One/.test(rowText(x)); });
    const b = r.find(function (x) { return /Track Two/.test(rowText(x)); });
    check("each row shows length, tempo and key", a && /\d:\d\d .*BPM .*\d{1,2}[AB]/.test(rowText(a)) && b && /BPM/.test(rowText(b)),
      (a ? rowText(a) : "?") + " | " + (b ? rowText(b) : "?"));
    const saved = JSON.parse(fs.readFileSync(path.join(DOCS, "Downbeat", "sound-library.json"), "utf8"));
    check("the results are saved in Documents/Downbeat/sound-library.json",
      saved.folders.music.length === 1 && Object.keys(saved.files).length === 2 && Object.values(saved.files).every(function (f) { return f.status === "done"; }));

    const recA = Object.values(saved.files).find(function (f) { return /Track One/.test(f.name); });
    const recB = Object.values(saved.files).find(function (f) { return /Track Two/.test(f.name); });
    // Name search.
    setFilter($.libSearchInput, "one");
    check("search by name", rows().length === 1 && /Track One/.test(rowText(rows()[0])));
    setFilter($.libSearchInput, "");
    // Key: exact, then compatible.
    setFilter($.libKeySelect, recA.camelot, "change");
    check("key filter, exact: only files in that key", rows().length >= 1 && rows().every(function (x) { return x.textContent.indexOf(recA.camelot) !== -1; }),
      recA.camelot + ": " + rows().length + " row(s)");
    // A BPM search also matches half and double the detected tempo.
    setFilter($.libKeySelect, "", "change");
    setFilter($.libBpmInput, String((recA.bpm * 2).toFixed(1)));
    check("BPM filter counts half and double tempo", rows().some(function (x) { return /Track One/.test(rowText(x)); }),
      "searching " + $.libBpmInput.value + " BPM finds the " + recA.bpm.toFixed(1) + " BPM track");
    $.libHalfDoubleCheckbox.checked = false;
    $.libHalfDoubleCheckbox._fire("change");
    check("... and not when 1/2x-2x is off", !rows().some(function (x) { return /Track One/.test(rowText(x)); }));
    $.libHalfDoubleCheckbox.checked = true;
    $.libHalfDoubleCheckbox._fire("change");
    setFilter($.libBpmInput, String(recB.bpm.toFixed(1)));
    check("BPM filter: the closest tempo comes first", rows().length >= 1 && /Track Two/.test(rowText(rows()[0])), rowText(rows()[0] || { textContent: "none" }));
    $.libResetFiltersBtn._fire("click");
    check("Reset filters shows everything again", rows().length === 2);
    // Insert via the real host: A1 has a clip at 0-200 s, so A2 at 12 s.
    const target = rows().find(function (x) { return /Track One/.test(rowText(x)); });
    const insertBtn = target.children.find(function (c) { return /lib-insert/.test(c.className); });
    insertBtn._fire("click", { stopPropagation: function () {} });
    return waitFor(function () { return /Inserted|Could not/.test($.libScanStatus.textContent); }, "insert", 10000);
  })
  .then(function () {
    const a2 = fake.sequence.audioTracks[1].clips;
    check("Insert puts the file at the playhead on the free track A2",
      /Inserted .* on A2/.test($.libScanStatus.textContent) && a2.length === 1 && a2[0].start.seconds === 12,
      $.libScanStatus.textContent);
    // Rescan: nothing new.
    $.libRescanBtn._fire("click");
    return waitFor(scanFinished, "rescan", 20000);
  })
  .then(function () {
    check("Rescan with nothing new analyzes nothing", /Everything is analyzed \(2 files\)/.test($.libScanStatus.textContent), $.libScanStatus.textContent);
    // A changed file is analyzed again.
    const f = path.join(MUSIC, "Track One.mp3");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(f, later, later);
    $.libRescanBtn._fire("click");
    check("a scan covers the panel with its progress window", !$.libScanOverlay.hidden && /%/.test($.libScanPercent.textContent) &&
      /of 1 files/.test($.libScanDetail.textContent), $.libScanPercent.textContent + " " + $.libScanDetail.textContent);
    return waitFor(function () { return /Done/.test($.libScanStatus.textContent) && $.libScanOverlay.hidden; }, "rescan of the changed file", 120000);
  })
  .then(function () {
    check("a changed file is analyzed again, only that one", /Done: 1 file/.test($.libScanStatus.textContent) && $.libScanOverlay.hidden,
      $.libScanStatus.textContent);
    // Cancel: both files changed, cancel right away - nothing is marked
    // failed, both wait for the next Rescan, which then finishes them.
    const later2 = new Date(Date.now() + 9000);
    fs.utimesSync(path.join(MUSIC, "Track One.mp3"), later2, later2);
    fs.utimesSync(path.join(MUSIC, "sub", "Track Two.mp3"), later2, later2);
    $.libScanStatus.textContent = "";
    $.libRescanBtn._fire("click");
    return new Promise(function (r) { setTimeout(r, 1500); }).then(function () {
      $.libScanCancelBtn._fire("click");
      return waitFor(function () { return $.libScanOverlay.hidden; }, "cancel", 15000);
    }).then(function () {
      const c = window.BeatMarkerSoundLibrary.counts("music");
      check("Cancel stops at once and leaves the files waiting, not failed",
        /Stopped/.test($.libScanStatus.textContent) && c.error === 0 && c.pending >= 1, $.libScanStatus.textContent + " " + JSON.stringify(c));
      $.libScanStatus.textContent = "";
      $.libRescanBtn._fire("click");
      return waitFor(scanFinished, "rescan after cancel", 120000);
    }).then(function () {
      check("... and Rescan finishes them", /Done: [12] file/.test($.libScanStatus.textContent) &&
        window.BeatMarkerSoundLibrary.counts("music").done === 2, $.libScanStatus.textContent);
    });
  })
  .then(function () {
    // The folder list folds and unfolds.
    $.libFoldersToggleBtn._fire("click");
    const folded = $.libFolderList.children.length === 0 && /Folders \(1\)/.test($.libFoldersToggleBtn.textContent);
    $.libFoldersToggleBtn._fire("click");
    check("the folder list folds into one line and opens again", folded && $.libFolderList.children.length === 2,
      $.libFoldersToggleBtn.textContent); // "All folders" + the folder
    // Save a copy, clear everything, load the copy back: no rescan needed.
    const File = fake.context.File;
    const copy = path.join(WORK, "library copy.json");
    File.nextSave = copy;
    $.saveLibraryBackupBtn._fire("click");
    return waitFor(function () { return /Copy saved/.test($.libraryAdminStatus.textContent); }, "save a copy", 10000);
  })
  .then(function () {
    const saved = JSON.parse(fs.readFileSync(path.join(WORK, "library copy.json"), "utf8"));
    check("Save a copy writes the library to the chosen file",
      saved.format === "downbeat-library-backup" && Object.keys(saved.soundLibrary.files).length === 2, $.libraryAdminStatus.textContent);
    $.clearLibraryBtn._fire("click");
    const armed = rows().length === 2; // the first click only asks
    $.clearLibraryBtn._fire("click");
    check("Clear needs a second click, then empties the library (folders stay)",
      armed && rows().length === 0 && $.libFolderList.children.length === 2, $.libraryAdminStatus.textContent);
    fake.context.File.nextOpen = path.join(WORK, "library copy.json");
    $.loadLibraryBackupBtn._fire("click");
    return waitFor(function () { return /Copy loaded/.test($.libraryAdminStatus.textContent); }, "load the copy", 10000);
  })
  .then(function () {
    check("Load a copy brings the analyzed files back", rows().length === 2 && rows().every(function (r) { return /BPM/.test(rowText(r)); }),
      $.libraryAdminStatus.textContent);
    $.libScanStatus.textContent = "";
    $.libRescanBtn._fire("click");
    return waitFor(scanFinished, "rescan after loading", 20000);
  })
  .then(function () {
    check("... and a Rescan after loading analyzes nothing again", /Everything is analyzed \(2 files\)/.test($.libScanStatus.textContent),
      $.libScanStatus.textContent);
    const bogus = path.join(WORK, "not a copy.json");
    fs.writeFileSync(bogus, JSON.stringify({ hello: "world" }));
    fake.context.File.nextOpen = bogus;
    $.loadLibraryBackupBtn._fire("click");
    return waitFor(function () { return /not a Downbeat library copy/.test($.libraryAdminStatus.textContent); }, "reject a foreign file", 10000);
  })
  .then(function () {
    check("a file that is not a library copy is refused, library unchanged", rows().length === 2);
    const treeRow = function (name) {
      return $.libFolderList.children.find(function (r) {
        return r.children.some(function (c) { return /lib-tree-name/.test(c.className) && c.textContent === name; });
      });
    };
    const part = function (row, cls) { return row.children.find(function (c) { return new RegExp(cls).test(c.className); }); };
    check("the folder tree starts with All folders, then the folder and its file count",
      /All folders/.test(rowText($.libFolderList.children[0])) && treeRow("My Music") && part(treeRow("My Music"), "lib-tree-count").textContent === "2",
      $.libFolderList.children.map(rowText).join(" | "));
    part(treeRow("My Music"), "lib-tree-chev")._fire("click");
    check("the arrow opens the folder's subfolders", !!treeRow("sub") && part(treeRow("sub"), "lib-tree-count").textContent === "1",
      $.libFolderList.children.map(rowText).join(" | "));
    part(treeRow("sub"), "lib-tree-scope")._fire("click");
    check("a folder's square limits the list to that folder",
      rows().length === 1 && /Track Two/.test(rowText(rows()[0])) && /sub/.test($.libFoldersToggleBtn.textContent),
      rows().map(rowText).join(" | ") + " / " + $.libFoldersToggleBtn.textContent);
    const savedScope = JSON.parse(fs.readFileSync(path.join(DOCS, "Downbeat", "settings.json"), "utf8")).libraryFolderScope;
    check("... and the choice is remembered", savedScope && savedScope.music.length === 1 && /\/sub$/.test(savedScope.music[0]), JSON.stringify(savedScope));
    part(treeRow("My Music"), "lib-tree-scope")._fire("click");
    check("several squares can be on at once", rows().length === 2 && /2 in search/.test($.libFoldersToggleBtn.textContent),
      $.libFoldersToggleBtn.textContent);
    part(treeRow("sub"), "lib-tree-name")._fire("click");
    check("a click on a folder's name shows only that folder", rows().length === 1 && /Track Two/.test(rowText(rows()[0])));
    part(treeRow("sub"), "lib-tree-name")._fire("click");
    check("... and a second click shows everything again", rows().length === 2 && !/sub/.test($.libFoldersToggleBtn.textContent),
      $.libFoldersToggleBtn.textContent);
    part(treeRow("sub"), "lib-tree-scope")._fire("click");
    part($.libFolderList.children[0], "lib-tree-name")._fire("click");
    check("All folders clears the choice", rows().length === 2);
    part(treeRow("sub"), "lib-tree-scope")._fire("click");
    $.libResetFiltersBtn._fire("click");
    check("Reset clears it too", rows().length === 2 && !/sub/.test($.libFoldersToggleBtn.textContent), $.libFoldersToggleBtn.textContent);
    // Files that disappear. A moved file shows as not found, with play and
    // Insert off, and says so when used.
    const ctFile = path.join(MUSIC, "Track One.mp3");
    fs.renameSync(ctFile, ctFile + ".moved");
    return new Promise(function (r) { setTimeout(r, 3200); }).then(function () {
      $.libSearchInput._fire("input");
      const ct = rows().find(function (x) { return /Track One/.test(rowText(x)); });
      const btn = function (r, cls) { return r.children.find(function (c) { return new RegExp(cls).test(c.className); }); };
      check("a moved file shows as not found, play and Insert off",
        ct && /file not found/.test(rowText(ct)) && ct.classList.contains("is-missing") && btn(ct, "lib-play").disabled && btn(ct, "lib-insert").disabled,
        ct ? rowText(ct) : "no row");
      ct._fire("dblclick");
      check("... and using it says where the problem is, no host call", /not where it was/.test($.libScanStatus.textContent), $.libScanStatus.textContent);
      fs.renameSync(ctFile + ".moved", ctFile);
      // The whole folder gone (a drive unplugged): Start scan keeps its
      // sounds instead of forgetting them, the tree says not found.
      fs.renameSync(MUSIC, MUSIC + " (unplugged)");
      $.libScanStatus.textContent = "";
      $.libRescanBtn._fire("click");
      return new Promise(function (r) { setTimeout(r, 3200); });
    }).then(function () {
      $.libSearchInput._fire("input");
      const root = $.libFolderList.children.find(function (r) { return /My Music/.test(rowText(r)); });
      check("an unplugged folder keeps its analyzed sounds through Start scan",
        rows().length === 2 && rows().every(function (x) { return /file not found/.test(rowText(x)) && /BPM/.test(rowText(x)); }) &&
        /not there now/.test(logText()), rows().map(rowText).join(" | "));
      check("... and the folder tree marks it not found", root && /not found/.test(rowText(root)), root ? rowText(root) : "no root row");
      fs.renameSync(MUSIC + " (unplugged)", MUSIC);
      return new Promise(function (r) { setTimeout(r, 3200); });
    }).then(function () {
      $.libScanStatus.textContent = "";
      $.libRescanBtn._fire("click");
      return waitFor(scanFinished, "the scan after plugging back in", 20000);
    }).then(function () {
      check("plugged back in: nothing to analyze again, rows normal",
        /Everything is analyzed \(2 files\)/.test($.libScanStatus.textContent) && rows().every(function (x) { return !/file not found/.test(rowText(x)); }),
        $.libScanStatus.textContent);
    });
  })
  .then(function () {
    // An open dropdown (a focused <select>) pauses the selection poll: any
    // host call closes a native list in a CEP panel.
    document.activeElement = $.libKeySelect;
    const before = selectionPolls;
    panel.runIntervals();
    const whileOpen = selectionPolls - before;
    document.activeElement = null;
    panel.runIntervals();
    check("the selection poll waits while a dropdown is open, then carries on",
      whileOpen === 0 && selectionPolls > before, "calls while open: " + whileOpen + ", after: " + (selectionPolls - before));
    // SFX section: short sound, no tempo asked.
    $.libSectionSfxBtn._fire("click");
    check("the SFX section is separate and starts empty", rows().length === 0 && /sound effects/.test($.libraryDisplay.textContent));
    nextFolder = SFX;
    $.libScanStatus.textContent = ""; // the music rescan's "Done" must not count as this scan's
    $.libAddFolderBtn._fire("click");
    return waitFor(function () { return /Folder added/.test($.libScanStatus.textContent); }, "adding the SFX folder", 10000).then(function () {
      $.libScanStatus.textContent = "";
      $.libRescanBtn._fire("click");
      return waitFor(scanFinished, "the SFX scan", 60000);
    });
  })
  .then(function () {
    const r = rows();
    const tone = r.find(function (x) { return /tone A/.test(rowText(x)); });
    const noise = r.find(function (x) { return /wind noise/.test(rowText(x)); });
    check("the SFX folder is scanned into its own section", r.length === 2 && tone && noise && !/BPM/.test(rowText(tone)),
      r.map(rowText).join(" | ") || "no rows");
    check("... and a 440 Hz tone reads as a key with A in it", tone && /\d{1,2}[AB] A/.test(rowText(tone)), tone ? rowText(tone) : "");
    check("... while pink noise shows no key: no clear pitch", noise && /no clear pitch/.test(rowText(noise)) && !/\d{1,2}[AB]/.test(rowText(noise)),
      noise ? rowText(noise) : "");
    // Its detected "key" is not searchable either.
    const SLib = window.BeatMarkerSoundLibrary;
    const noiseRec = Object.values(SLib.getState().files).find(function (f) { return /wind noise/.test(f.name); });
    setFilter($.libKeySelect, noiseRec.camelot, "change");
    check("a key search skips a sound with no pitch", !rows().some(function (x) { return /wind noise/.test(rowText(x)); }),
      noiseRec.camelot + ": " + rows().map(rowText).join(" | "));
    setFilter($.libKeySelect, "", "change");
    // Row cap: 300 rows without a key, every match with one.
    const fakes = [];
    for (let i = 0; i < 350; i++) {
      const fp = path.join(SFX, "tone copy " + i + ".wav");
      fs.writeFileSync(fp, ""); // on disk, or the list shows it as not found
      fakes.push(fp);
      SLib.getState().files[fp] = { path: fp, section: "sfx", name: "tone copy " + i + ".wav", status: "done", v: 3, camelot: "5A",
        key: "C", scale: "minor", durationSec: 1, pitchCrest: 6, pitchFlatness: 0.001, strength: 0.9 };
    }
    $.libSearchInput._fire("input");
    const capped = rows().length;
    setFilter($.libKeySelect, "5A", "change");
    const withKey = rows().length;
    check("the list stops at 300 rows without a key, and shows every match once a key is chosen",
      capped === 300 && withKey === 350, capped + " rows without a key, " + withKey + " with 5A");
    setFilter($.libKeySelect, "", "change");
    // Navigation: Show N more, sort, favorites, pitched only, pack filter,
    // keyboard.
    const moreBtn = function () { return $.libraryDisplay.children.find(function (c) { return /lib-show-more/.test(c.className || ""); }); };
    const more = moreBtn();
    check("a capped list offers the rest with Show N more", more && /Show 52 more/.test(more.textContent), more ? more.textContent : "no button");
    if (more) { more._fire("click"); }
    check("... which adds them without starting over", rows().length === 352 && !moreBtn(), rows().length + " rows");
    setFilter($.libSortSelect, "length", "change");
    check("changing the sort starts from the first page again", rows().length === 300 && !!moreBtn());
    moreBtn()._fire("click");
    check("sort by length puts the 1 s copies before the 4 s noise and the 6 s tone",
      /tone copy/.test(rowText(rows()[0])) && /wind noise/.test(rowText(rows()[350])) && /tone A/.test(rowText(rows()[351])),
      rowText(rows()[350]) + " | " + rowText(rows()[351]));
    check("the SFX section offers no BPM sort", !$.libSortSelect.children.some(function (o) { return o.value === "bpm"; }));
    setFilter($.libSortSelect, "best", "change");
    const toneRow = rows().find(function (x) { return /tone A/.test(rowText(x)); });
    const star = toneRow.children.find(function (c) { return /lib-fav/.test(c.className); });
    star._fire("click", { stopPropagation: function () {} });
    $.libFavOnlyCheckbox.checked = true;
    $.libFavOnlyCheckbox._fire("change");
    check("a star makes a favorite, and ★ only shows just it",
      rows().length === 1 && /tone A/.test(rowText(rows()[0])) && Object.values(SLib.getState().files).some(function (f) { return f.fav && /tone A/.test(f.name); }));
    $.libFavOnlyCheckbox.checked = false;
    $.libFavOnlyCheckbox._fire("change");
    $.libPitchedOnlyCheckbox.checked = true;
    $.libPitchedOnlyCheckbox._fire("change");
    check("only sounds with a pitch drops the noise", !rows().some(function (x) { return /wind noise/.test(rowText(x)); }) && rows().some(function (x) { return /tone A/.test(rowText(x)); }));
    $.libPitchedOnlyCheckbox.checked = false;
    $.libPitchedOnlyCheckbox._fire("change");
    // Smarter search: UCS names give a category the search knows; synonyms
    // find files by other words.
    const ucsFakes = ["DSGNWhsh_Airy Pass_Example Audio_Airy Pack.wav", "FEETHmn_Boots On Gravel_Example Audio_Steps Pack.wav", "Fast Swish 01.wav"].map(function (n) {
      const fp = path.join(SFX, n);
      SLib.getState().files[fp] = { path: fp, section: "sfx", name: n, status: "done", v: 3, durationSec: 2, pitchCrest: 2, pitchFlatness: 0.1, strength: 0.2 };
      return fp;
    });
    $.libSearchInput._fire("input");
    setFilter($.libSearchInput, "steps pack");
    check("a pack's name in the file name is searchable", rows().length === 1 && /Boots On Gravel/.test(rowText(rows()[0])), rows().map(rowText).join(" | "));
    setFilter($.libSearchInput, "whoosh");
    check("\"whoosh\" also finds a Swish file and the WHOOSH category, not the rest",
      rows().length === 2 && rows().some(function (x) { return /Fast Swish/.test(rowText(x)); }) && rows().some(function (x) { return /Airy Pass/.test(rowText(x)); }),
      rows().map(rowText).join(" | "));
    check("next to the search, the synonyms it also uses", /^\+ .*swoosh/.test($.libSearchExpand.textContent), $.libSearchExpand.textContent);
    setFilter($.libSearchInput, "whoosh -swish");
    check("-word leaves files out", rows().length === 1 && /Airy Pass/.test(rowText(rows()[0])), rows().map(rowText).join(" | "));
    setFilter($.libSearchInput, "My SFX");
    check("the search looks in folder names too", rows().length === 300 && moreBtn() && /Show 55 more/.test(moreBtn().textContent),
      rows().length + " rows, " + (moreBtn() ? moreBtn().textContent : "no Show more"));
    setFilter($.libSearchInput, "");
    ucsFakes.forEach(function (fp) { delete SLib.getState().files[fp]; });
    $.libSearchInput._fire("input");
    // No tempo for sound effects: no BPM filter, and a row shows a tempo only
    // when the file name gives one.
    check("the SFX section has no BPM filter", $.libBpmRow.hidden === true);
    check("... and the scan asks no tempo of a long sound effect", SLib.excerptRange(20, "sfx").wantBpm === false && SLib.excerptRange(20, "music").wantBpm === true);
    const tempoFakes = [["Crash Swell 01.wav", { bpm: 110, bpmConfidence: 3 }], ["Drum Loop 120bpm.wav", { bpm: 120, bpmConfidence: null, bpmFrom: "name" }]].map(function (f) {
      const fp = path.join(SFX, f[0]);
      SLib.getState().files[fp] = Object.assign({ path: fp, section: "sfx", name: f[0], status: "done", v: 3, durationSec: 9 }, f[1]);
      return fp;
    });
    setFilter($.libSearchInput, "crash swell");
    check("a stored SFX tempo is never shown", rows().length === 1 && !/BPM/.test(rowText(rows()[0])), rows().map(rowText).join(" | "));
    setFilter($.libSearchInput, "drum loop");
    check("a tempo from the file name is", rows().length === 1 && /120\.0 BPM/.test(rowText(rows()[0])), rows().map(rowText).join(" | "));
    tempoFakes.forEach(function (fp) { delete SLib.getState().files[fp]; });
    setFilter($.libSearchInput, "");
    // Keyboard, on the Library tab.
    const libTab = panel.allEls.find(function (e) { return e._cls && e._cls["tab-btn"] && e.attrs["data-tab"] === "library"; });
    libTab._fire("click");
    check("the Library tab hides the \"select an audio clip\" line", $.selectionStatusRow.hidden === true);
    let played = null;
    $.libPreviewAudio.play = function () { played = $.libPreviewAudio.src; return Promise.resolve(); };
    $.libPreviewAudio.pause = function () {};
    document._fire("keydown", { key: "ArrowDown", target: document.body });
    document._fire("keydown", { key: "ArrowDown", target: document.body });
    const selectedRows = rows().filter(function (x) { return !!x._cls["is-selected"]; });
    check("↓ moves the selection down the list", selectedRows.length === 1 && selectedRows[0] === rows()[1]);
    document._fire("keydown", { key: " ", target: document.body });
    check("Space plays the selected file", played && played.indexOf(encodeURIComponent(rowText(rows()[1]).replace(/^▶|^‖/, "").split(/\d+:\d\d/)[0].trim()).slice(0, 10)) !== -1, played);
    document._fire("keydown", { key: "ArrowDown", target: $.libSearchInput });
    check("keys typed in the search box are left alone", rows().filter(function (x) { return !!x._cls["is-selected"]; })[0] === rows()[1]);
    // Premiere keeps the arrows unless a text field in the panel has the
    // focus: a click in the list focuses the hidden #libKeyCatcher, and keys
    // typed into it do move the selection.
    document._fire("keydown", { key: "ArrowDown", target: $.libKeyCatcher });
    check("keys arriving through the hidden key field move the selection", rows().filter(function (x) { return !!x._cls["is-selected"]; })[0] === rows()[2]);
    fakes.forEach(function (fp) { delete SLib.getState().files[fp]; fs.unlinkSync(fp); });
    $.libSearchInput._fire("input");
    // A SFX record with an outdated method version counts as waiting.
    const rec = Object.values(SLib.getState().files).find(function (f) { return /tone A/.test(f.name); });
    rec.v = 1;
    $.libSearchInput._fire("input"); // any redraw
    check("SFX results with an outdated key method are offered for a rescan",
      SLib.outdatedCount("sfx") === 1 && /Start scan \(1\)/.test($.libRescanBtn.textContent), $.libRescanBtn.textContent);
    rec.v = 3;
    // Back to Music: remove the folder.
    $.libSectionMusicBtn._fire("click");
    check("the Music section has the BPM filter", $.libBpmRow.hidden === false);
    const folderRow = $.libFolderList.children.find(function (r) {
      return r.children.some(function (c) { return /lib-folder-remove/.test(c.className); });
    });
    const removeBtn = folderRow.children.find(function (c) { return /lib-folder-remove/.test(c.className); });
    removeBtn._fire("click");
    check("removing the folder empties the section, the files stay on disk",
      rows().length === 0 && fs.existsSync(path.join(MUSIC, "Track One.mp3")), $.libraryDisplay.textContent.slice(0, 60));
    const tmpLeft = fs.readdirSync(path.join(DOCS, "Downbeat", "tmp")).filter(function (n) { return /^library-/.test(n); });
    check("no scan temp files left behind", tmpLeft.length === 0, tmpLeft.join(", "));
  })
  .catch(function (e) { failures++; console.error("FAIL " + e.message); })
  .then(function () {
    fs.rmSync(WORK, { recursive: true, force: true }); // throwaway fixture made above
    if (failures) {
      console.error("\n" + failures + " Library tab check(s) failed");
      process.exit(1);
    }
    console.log("\nthe Library tab scans, searches and inserts");
    process.exit(0);
  });
