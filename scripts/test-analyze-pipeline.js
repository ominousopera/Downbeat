"use strict";
// A real Analyze through the real workers. Only the host and the browser's
// audio decoding are stood in for: "Premiere" reports a selected clip, and
// ffmpeg decodes the file in place of Web Audio. Needs ffmpeg and the local
// test tracks; skips (exit 0) without them, so it can sit in the build on any
// machine. Run: node scripts/test-analyze-pipeline.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TRACK_APPLIES = require("./test-tracks.js").named("applies");
const TRACK_REJECTED = require("./test-tracks.js").named("rejected");

function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; }
}
if (!fs.existsSync(TRACK_APPLIES) || !fs.existsSync(TRACK_REJECTED) || !hasFfmpeg()) {
  console.log("skip - needs ffmpeg and the two test tracks in the test-music folder (see scripts/test-tracks.js)");
  process.exit(0);
}

function decode(file, rate) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ar", String(rate), "-ac", "1", "-"],
    { maxBuffer: 600 * 1024 * 1024 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
// The "currently selected clip" - switched between the two tracks below.
let current = null;
function selectTrack(file) {
  const samples44 = decode(file, 44100);
  current = {
    samples44: samples44,
    samples22: decode(file, 22050),
    durationSec: samples44.length / 44100,
    clip: { mediaPath: file, clipStartSeconds: 0, inPointSeconds: 0, outPointSeconds: samples44.length / 44100, frameRate: 25, trackIndex: 0 }
  };
}

const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-pipeline-"));
fs.mkdirSync(path.join(DOCS, "Downbeat"));
fs.writeFileSync(path.join(DOCS, "Downbeat", "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));
// "Premiere": one audio clip selected, the whole file on track 1.
const sentScripts = [];
let ownMarkers = 0;
function evalScript(script, callback) {
  let reply = { ok: false, error: "not stubbed: " + script.slice(0, 40), data: null };
  if (/^getSelectedAudioInfo\(\)/.test(script)) { reply = { ok: true, error: null, data: current.clip }; }
  if (/create(Clip)?Markers\(/.test(script)) {
    sentScripts.push(script);
    const times = JSON.parse(JSON.parse(script.match(/create(?:Clip)?Markers\((".*?[^\\]"),/)[1]));
    ownMarkers = times.length;
    reply = { ok: true, error: null, data: { requested: times.length, created: times.length } };
  }
  // Downbeat's markers on the clip, as the host counts them.
  if (/^countOwnMarkersForSelectedClip\(\)/.test(script)) { reply = { ok: true, error: null, data: { count: ownMarkers } }; }
  if (callback) { setImmediate(function () { callback(JSON.stringify(reply)); }); }
}

const { bootPanel } = require("./panel-harness.js");
const panel = bootPanel({ docsDir: DOCS, evalScript: evalScript, realTimeouts: true });
const $ = panel.registry;
// Web Audio stand-ins: the samples ffmpeg already decoded.
window.BeatMarkerAudio.readFileAsArrayBuffer = function () { return Promise.resolve(new ArrayBuffer(8)); };
window.BeatMarkerAudio.decodeToMono44100 = function () {
  return Promise.resolve({ samples: current.samples44, original: { durationSec: current.durationSec, sampleRate: 44100, channels: 2 } });
};
window.BeatMarkerAudio.decodeFileToMono44100 = function (path, opts) {
  if (opts && opts.onRead) { opts.onRead(8); }
  return window.BeatMarkerAudio.decodeToMono44100();
};
window.BeatMarkerAudio.resampleMono = function (samples, from, to) {
  return Promise.resolve(to === 22050 ? current.samples22 : samples);
};

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function logText() { return $.log.textContent; }
function waitUntilEnabled(btn, label) {
  const started = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (!btn.disabled && Date.now() - started > 50) { return resolve(); }
      if (Date.now() - started > 180000) { return reject(new Error(label + " did not finish within 3 minutes")); }
      setTimeout(poll, 100);
    })();
  });
}
function finish() {
  fs.rmSync(DOCS, { recursive: true, force: true }); // throwaway fixture made above
  if (failures) {
    console.error("\n" + failures + " pipeline check(s) failed");
    process.exit(1);
  }
  console.log("\nThe Analyze pipeline places markers, shifts them and detects keys end to end");
  process.exit(0);
}

function analyze(label) {
  const t0 = Date.now();
  const logBefore = logText().length;
  $.analyzeBtn._fire("click");
  return waitUntilEnabled($.analyzeBtn, "Analyze").then(function () {
    const newLog = logText().slice(logBefore);
    check(label + ": Analyze finished", !/Analyze pipeline failed/.test(newLog),
      ((Date.now() - t0) / 1000).toFixed(1) + " s for a " + current.durationSec.toFixed(0) + " s track");
    return newLog;
  });
}

selectTrack(TRACK_APPLIES);
analyze("track 1")
  .then(function (newLog) {
    check("track 1: Beat This! was applied as part of Analyze", /Alternative analysis applied/.test(newLog));
    // The Beat grid line: Refined / Basic, the chosen word lit; both words
    // drive the hidden #beatThisBtn.
    check("track 1: the panel says so - Beat grid: Refined is lit", $.beatThisRow.style.display !== "none" &&
      $.gridRefinedBtn.classList.contains("is-active") && !$.gridBasicBtn.classList.contains("is-active") &&
      /second detector/.test($.beatThisHintText.textContent), "'" + $.beatThisHintText.textContent + "'");
    const appliedBeats = $.beatCountDisplay.textContent;
    let logBefore = logText().length;
    $.gridRefinedBtn._fire("click"); // already chosen - nothing happens
    check("track 1: clicking the lit word does nothing", logText().length === logBefore &&
      $.gridRefinedBtn.classList.contains("is-active"));
    $.gridBasicBtn._fire("click"); // revert - synchronous
    check("track 1: Basic reverts to essentia's grid", /Reverted to the original analysis/.test(logText().slice(logBefore)),
      appliedBeats + " beats -> " + $.beatCountDisplay.textContent);
    check("track 1: after a revert Basic is lit and the line stays", $.beatThisRow.style.display !== "none" &&
      $.gridBasicBtn.classList.contains("is-active") && !$.gridRefinedBtn.classList.contains("is-active") &&
      /second detector/.test($.beatThisHintText.textContent));
    $.gridRefinedBtn._fire("click"); // re-apply - async, runs the worker again
    check("track 1: both words wait while it runs", $.gridRefinedBtn.disabled && $.gridBasicBtn.disabled);
    return waitUntilEnabled($.beatThisBtn, "re-apply").then(function () {
      check("track 1: Refined again gives the same grid", $.beatCountDisplay.textContent === appliedBeats &&
        $.gridRefinedBtn.classList.contains("is-active") && !$.gridRefinedBtn.disabled,
        $.beatCountDisplay.textContent + " beats");
    });
  })
  .then(function () {
    // The preview follows playback when zoomed in (page-style), stops
    // following after a manual pan away, and resumes on Play.
    const audio = $.beatClickAudio;
    let tick = null;
    const node = function () { return { connect: function () {}, gain: { value: 1 }, start: function () {}, stop: function () {} }; };
    window.AudioContext = function () {
      return { sampleRate: 44100, currentTime: 0, state: "running", destination: {},
        createMediaElementSource: node, createGain: node, createBufferSource: node,
        createBuffer: function (ch, n) { const d = new Float32Array(n); return { getChannelData: function () { return d; } }; } };
    };
    global.requestAnimationFrame = function (fn) { tick = fn; return 1; };
    audio.duration = current.durationSec;
    audio._fire("loadedmetadata");
    const pan = function () { return parseFloat($.beatClickPanInput.value); };
    const viewSec = current.durationSec / 5; // the default zoom is 5x
    audio.paused = false;
    audio.currentTime = viewSec * 0.95; // near the right edge of the first page
    audio._fire("play");
    tick();
    const paged = pan();
    check("preview: during playback the view pages along with the playhead",
      Math.abs(paged - (audio.currentTime - viewSec * 0.1)) < 0.05, "view now starts at " + paged.toFixed(2) + " s, playhead " + audio.currentTime.toFixed(2) + " s");
    audio.currentTime = viewSec * 2.5; // playback moves on to a later page...
    tick();
    $.beatClickPanInput.value = "0"; // ...and the user pans back to the start to look at something
    $.beatClickPanInput._fire("input");
    audio.currentTime += 1;
    tick();
    check("preview: a manual pan away is not undone while playing", pan() === 0, "view stays at " + pan() + " s");
    audio._fire("play");
    tick();
    check("preview: Play brings the view back to the playhead", pan() > 0 && audio.currentTime >= pan() && audio.currentTime <= pan() + viewSec,
      "view at " + pan().toFixed(2) + " s");
    audio.paused = true;
    audio._fire("pause");
    audio.currentTime = 0;
  })
  .then(function () {
    // Place, select another clip, come back, place again: same markers both
    // times.
    const native = +((logText().match(/Alternative analysis applied: \d+ beats, (\d+) native downbeats/g) || []).pop() || "").replace(/.*beats, (\d+) native.*/, "$1");
    function placeAndCount(label) {
      const before = sentScripts.length;
      const logBefore = logText().length;
      $.placeMarkersBtn._fire("click");
      return waitUntilEnabled($.placeMarkersBtn, label).then(function () {
        const sent = sentScripts.slice(before).join("\n");
        const times = sent.match(/create(Clip)?Markers\((".*?[^\\]"), (".*?[^\\]")(?:, true)?\)/);
        const list = times ? JSON.parse(JSON.parse(times[2])) : [];
        const labels = times ? JSON.parse(JSON.parse(times[3])) : [];
        return { onClip: /createClipMarkers\(/.test(sent), replaces: /createClipMarkers\(.*, true\)/.test(sent),
                 onTimeline: /(^|[^p])createMarkers\(.*, true\)/.test(sent), count: list.length, times: list, labels: labels,
                 native: /native downbeats/.test(logText().slice(logBefore)) };
      });
    }
    function setTiming(value) {
      panel.allEls.forEach(function (e) {
        if (e.attrs && e.attrs.name === "markerTiming") { e.checked = e.attrs.value === value; if (e.checked) { e._fire("change"); } }
      });
    }
    function nudgeAndCapture(btn, label) {
      const before = sentScripts.length;
      btn._fire("click");
      btn._fire("click");
      const t0 = Date.now();
      return new Promise(function (resolve, reject) {
        (function poll() {
          const sent = sentScripts.slice(before).join("\n");
          const m = sent.match(/createClipMarkers\((".*?[^\\]"), (".*?[^\\]")(?:, true)?\)/);
          if (m) { return resolve({ times: JSON.parse(JSON.parse(m[1])), places: (sent.match(/createClipMarkers\(/g) || []).length }); }
          if (Date.now() - t0 > 5000) { return reject(new Error(label + ": no re-placement")); }
          setTimeout(poll, 50);
        })();
      });
    }
    const settingsFile = path.join(DOCS, "Downbeat", "settings.json");
    // Shift with no Downbeat markers on the clip: the value is kept for Place
    // markers, and nothing is placed.
    const sentBefore = sentScripts.length;
    const logBeforeShift = logText().length;
    $.nudgeLaterBtn._fire("click");
    return new Promise(function (r) { setTimeout(r, 700); }).then(function () {
      check("Shift with no markers on the clip places none and keeps the value",
        sentScripts.length === sentBefore && /\+1/.test($.nudgeNumber.textContent) &&
        /no Downbeat markers on this clip/.test(logText().slice(logBeforeShift)), $.nudgeNumber.textContent);
      $.nudgeEarlierBtn._fire("click");
      return new Promise(function (r) { setTimeout(r, 700); });
    }).then(function () {
      check("... and back to 0, still nothing placed", sentScripts.length === sentBefore && $.nudgeNumber.textContent === "0", $.nudgeNumber.textContent);
      return placeAndCount("Place markers");
    }).then(function (first) {
      check("track 1: markers go on the clip, from Beat This!'s own downbeats",
        first.onClip && first.native && first.count === native, first.count + " markers, " + native + " native downbeats");
      check("track 1: placing asks the host to replace Downbeat's earlier markers, not add a second set", first.replaces);
      check("Shift is hidden with Timing: Frame (a 1 ms shift rarely changes the frame)", $.nudgeOpts.hidden && $.nudgeKey.hidden);
      setTiming("exact");
      check("and shown with Timing: Exact", !$.nudgeOpts.hidden && !$.nudgeKey.hidden && !$.nudgeHintRow.hidden);
      return placeAndCount("Place markers, exact").then(function (exactFirst) {
        first = exactFirst;
        return nudgeAndCapture($.nudgeLaterBtn, "Shift +");
      }).then(function (later) {
        const diffs = later.times.map(function (t, i) { return (t - first.times[i]) * 1000; });
        let saved = {};
        try { saved = JSON.parse(fs.readFileSync(settingsFile, "utf8")).markerNudgeMs || {}; } catch (e) { saved = {}; }
        check("Shift +, twice: every marker 2 ms later, placed once, remembered for the track",
          later.times.length === first.times.length && diffs.every(function (d) { return Math.abs(d - 2) < 0.001; }) && later.places === 1 &&
          $.nudgeNumber.textContent === "+2" && Object.keys(saved).some(function (k) { return saved[k] === 2; }),
          "diffs " + diffs.slice(0, 3).map(function (d) { return d.toFixed(3); }).join(", ") + "; shows " + $.nudgeNumber.textContent + "; saved " + JSON.stringify(saved).slice(0, 80));
        return nudgeAndCapture($.nudgeEarlierBtn, "Shift −");
      }).then(function (back) {
        check("Shift −, twice: back where they were, 0 shown",
          back.times.every(function (t, i) { return Math.abs(t - first.times[i]) < 1e-9; }) && $.nudgeNumber.textContent === "0",
          "shows " + $.nudgeNumber.textContent);
        setTiming("frame");
        return placeAndCount("Place markers, frame again");
      });
    }).then(function (first) {
      selectTrack(TRACK_REJECTED); // another clip is selected in Premiere...
      panel.runIntervals();
      return new Promise(function (r) { setTimeout(r, 300); }).then(function () {
        check("the panel noticed the other clip (selection polling ran)",
          require("path").basename(TRACK_REJECTED).length > 0 && $.selectionStatusDisplay.textContent.indexOf(require("path").basename(TRACK_REJECTED).slice(0, 12)) !== -1, $.selectionStatusDisplay.textContent.slice(0, 50));
        selectTrack(TRACK_APPLIES); // ...and then this one again
        panel.runIntervals();
        return new Promise(function (r) { setTimeout(r, 300); });
      }).then(function () {
        return placeAndCount("Place markers after re-selecting");
      }).then(function (again) {
        check("track 1: after re-selecting the clip, the same downbeats come back",
          again.native && again.count === first.count, again.count + " markers (was " + first.count + ")");
        // Shift the "1": the number shows how far it moved, and Reset puts
        // back exactly what the analysis found (Beat This!'s downbeats here,
        // which shifting snaps onto beats).
        function clickAndCapture(btn, label) {
          const before = sentScripts.length;
          btn._fire("click");
          return new Promise(function (resolve, reject) {
            const t0 = Date.now();
            (function poll() {
              const sent = sentScripts.slice(before).join("\n");
              const m = sent.match(/create(Clip)?Markers\((".*?[^\\]"), (".*?[^\\]")(?:, true)?\)/);
              if (m) { setTimeout(function () { resolve(JSON.parse(JSON.parse(m[2]))); }, 100); return; }
              if (Date.now() - t0 > 15000) { reject(new Error(label + " placed no markers")); return; }
              setTimeout(poll, 50);
            })();
          });
        }
        return clickAndCapture($.phaseBeat2, "The 1 is beat 2").then(function (shifted) {
          check("choosing beat 2 as the \"1\" marks it and moves the markers",
            $.phaseBeat2._cls["is-active"] && !$.phaseBeat1._cls["is-active"] && $.phaseDisplay.textContent === "+1" &&
            shifted.length > 0 && Math.abs(shifted[0] - first.times[0]) > 1e-6,
            $.phaseDisplay.textContent);
          return clickAndCapture($.phaseBeat1, "The 1 is beat 1 again");
        }).then(function (back) {
          check("beat 1 brings back exactly the analysis's markers",
            $.phaseBeat1._cls["is-active"] && $.phaseDisplay.textContent === "0" && back.length === first.times.length &&
            back.every(function (t, i) { return Math.abs(t - first.times[i]) < 1e-6; }),
            back.length + " markers (analysis: " + first.times.length + "), shift " + $.phaseDisplay.textContent);
        });
      }).then(function () {
        // "Downbeats + beat grid": the D markers are exactly the
        // downbeats-only mode's, every other beat is a "b".
        function setCutMode(value) {
          panel.allEls.forEach(function (e) {
            if (e.attrs && e.attrs.name === "cutMode") { e.checked = e.attrs.value === value; }
          });
        }
        setCutMode("detailed");
        return placeAndCount("Place markers, downbeats + beat grid").then(function (grid) {
          setCutMode("simple");
          const gridDowns = grid.times.filter(function (t, i) { return grid.labels[i] === "D"; });
          const sameDowns = gridDowns.length === first.times.length &&
            gridDowns.every(function (t, i) { return Math.abs(t - first.times[i]) < 1e-6; });
          const beats = grid.labels.filter(function (l) { return l === "b"; }).length;
          check("'Downbeats + beat grid' marks the same downbeats, plus every other beat",
            sameDowns && beats > 2 * gridDowns.length && grid.count > 2 * first.count,
            gridDowns.length + " D (downbeats mode: " + first.times.length + "), " + beats + " b, " + grid.count + " in all");
          function setMarkerTarget(value) {
            panel.allEls.forEach(function (e) {
              if (e.attrs && e.attrs.name === "markerTarget") { e.checked = e.attrs.value === value; }
            });
          }
          setMarkerTarget("sequence");
          return placeAndCount("Place markers on the timeline").then(function (tl) {
            setMarkerTarget("clip");
            check("'The timeline' places timeline markers instead, replacing Downbeat's earlier set",
              !tl.onClip && tl.onTimeline && tl.count === first.count, tl.count + " markers (on the clip: " + first.count + ")");
          });
        });
      });
    });
  })
  .then(function () {
    // Detect key, Music mode: essentia + S-KEY as the third opinion.
    const logBefore = logText().length;
    $.keyMaterialMusicBtn._fire("click");
    $.detectKeyBtn._fire("click");
    return waitUntilEnabled($.detectKeyBtn, "Detect key (music)").then(function () {
      const newLog = logText().slice(logBefore);
      const line = (newLog.match(/Key detected:[^\n]*/) || [""])[0];
      check("track 1: Music mode asks S-KEY for a third opinion", /S-KEY: \d{1,2}[AB] -> (all3|two|none) agree/.test(line),
        (line.match(/S-KEY:[^.]*/) || ["no S-KEY in the log"])[0]);
      check("track 1: the confidence line uses the three-way levels",
        /(Three independent analyses agree|Two of three analyses agree|The three analyses disagree)/.test($.keyAgreementDisplay.textContent),
        $.keyAgreementDisplay.textContent.slice(0, 60));
      const sfxLogBefore = logText().length;
      $.keyMaterialSfxBtn._fire("click");
      $.detectKeyBtn._fire("click");
      return waitUntilEnabled($.detectKeyBtn, "Detect key (sfx)").then(function () {
        const sfxLog = logText().slice(sfxLogBefore);
        check("track 1: SFX mode does not use S-KEY", /Key detected:/.test(sfxLog) && !/S-KEY:/.test(sfxLog));
        $.keyMaterialMusicBtn._fire("click");
      });
    });
  })
  .then(function () {
    check("track 1: no music video note for a plain track name", $.musicVideoNote.hidden);
    // Track 2 under a music video's file name: same audio, so the same guard
    // result, plus the note about the intro and ending.
    const asVideo = path.join(DOCS, "Some Artist - Some Song (Official Music Video) [abcdefghijk].mp3");
    fs.copyFileSync(TRACK_REJECTED, asVideo);
    selectTrack(asVideo);
    return analyze("track 2");
  })
  .then(function (newLog) {
    check("track 2: the guard kept essentia's grid", /differs too much from the original/.test(newLog) &&
      !/Alternative analysis applied/.test(newLog), $.beatCountDisplay.textContent + " beats");
    check("track 2: no pointless retry offered", $.beatThisRow.style.display === "none");
    check("track 2: a music video's file name gets the note about its intro and ending",
      !$.musicVideoNote.hidden && /looks like a music video/.test(newLog));
  })
  .catch(function (e) { failures++; console.error("FAIL " + e.message); })
  .then(finish);
