// Cuesheet -> marker placement in Premiere Pro and After Effects. Runs in
// the panel's Chromium context. The offset math lives in js/cuesheet.js;
// this file maps a cuesheet track to times and hands them to the thin
// loops in jsx/host.jsx (createMarkers, createClipMarkers).
(function (global) {
  "use strict";
  // Marker type code (see js/cuesheet.js) -> translation key of the marker's
  // explanation.
  var MARKER_COMMENT_KEYS = {
    "D": "marker.downbeat", "b": "marker.beat"
  };
  // JSON of { code: translated explanation }, with every non-ASCII character
  // escaped as \uXXXX so it survives the trip into ExtendScript whatever
  // encoding evalScript uses on the way.
  function _markerCommentsJson() {
    var map = {};
    for (var code in MARKER_COMMENT_KEYS) {
      if (MARKER_COMMENT_KEYS.hasOwnProperty(code)) {
        map[code] = global.BeatMarkerI18n.t(MARKER_COMMENT_KEYS[code]);
      }
    }
    return _asciiJson(map);
  }
  // JSON with every non-ASCII character escaped as \uXXXX, so text survives
  // the trip into ExtendScript.
  function _asciiJson(value) {
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (c) {
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }
  // Shared by placeCuesheetMarkers(), placeClipMarkers() and
  // placeSequenceMarkers(): maps one impulse
  // track's events with `mapFn`, then calls the named jsx function with the
  // JSON times and labels (plus extraArgs). Returns a Promise resolving to
  // { ok, error, data } (data has droppedCount and framesMerged merged in on
  // success). options.snapToFrame snaps the times to frame starts;
  // options.sourceTimes says the times are source-file time (clip markers),
  // not sequence time.
  function _mapAndCallJsx(csInterface, cuesheet, clipInfo, trackId, jsxFunctionName, mapFn, extraArgs, options) {
    return new Promise(function (resolve) {
      var mapped;
      try {
        mapped = mapFn(cuesheet, clipInfo, trackId || "beats");
      } catch (e) {
        resolve({ ok: false, error: "Could not work out the marker times: " + e.message, data: null });
        return;
      }

      if (mapped.times.length === 0) {
        resolve({
          ok: false,
          error: "No events fall within the clip's in/out range (dropped " + mapped.droppedCount + ").",
          data: null
        });
        return;
      }
      // Labels (short marker names "D" / "b", see js/cuesheet.js)
      // are always passed as a second argument, parallel to times.
      // createMarkers()/createClipMarkers() use them to name each marker.
      var framesMerged = 0;
      if (options && options.snapToFrame) {
        var snapped = global.BeatMarkerCuesheet.snapToFrameStart(mapped.times, mapped.labels || [], clipInfo, !!options.sourceTimes);
        mapped.times = snapped.times;
        mapped.labels = snapped.labels;
        framesMerged = snapped.merged;
      }
      var secondsJson = JSON.stringify(mapped.times);
      var labelsJson = _asciiJson(mapped.labels || []);
      // The explanation Premiere shows for each marker (its `comments`) is
      // sent in the panel's current language with every placement. host.jsx
      // keeps an English fallback.
      // options.knownPlaced: where Place last put timeline markers for each
      // clip, as the panel remembers it across host restarts (main.js
      // _placedTimelineMemory; jsx/host.jsx _dbSeedPlacedTimeline).
      var knownArg = options && options.knownPlaced ? ", " + JSON.stringify(JSON.stringify(options.knownPlaced)) : "";
      var script = "setMarkerComments(" + JSON.stringify(_markerCommentsJson()) + ");" +
        jsxFunctionName + "(" + JSON.stringify(secondsJson) + ", " + JSON.stringify(labelsJson) + (extraArgs || ", false") + ", " + JSON.stringify(_asciiJson(clipInfo)) + knownArg + ")";

      csInterface.evalScript(script, function (rawResult) {
        if (rawResult === "EvalScript error.") {
          resolve({
            ok: false,
            error: "The host script could not run " + jsxFunctionName + "(). Reload the panel and try again.",
            data: null
          });
          return;
        }
        var parsed;
        try {
          parsed = JSON.parse(rawResult);
        } catch (e) {
          resolve({ ok: false, error: "The host script returned an unreadable answer: " + e.message, data: null });
          return;
        }
        if (!parsed.ok) {
          resolve({ ok: false, error: parsed.error, data: null });
          return;
        }
        parsed.data.droppedCount = mapped.droppedCount;
        parsed.data.framesMerged = framesMerged;
        resolve({ ok: true, error: null, data: parsed.data });
      });
    });
  }
  // Places sequence markers for one impulse track of a cuesheet.
  function placeCuesheetMarkers(csInterface, cuesheet, clipInfo, trackId) {
    return _mapAndCallJsx(
      csInterface, cuesheet, clipInfo, trackId, "createMarkers",
      global.BeatMarkerCuesheet.mapEventsToSequenceSeconds
    );
  }
  // Places clip (source-time) markers on the selected clip.
  function placeClipMarkers(csInterface, cuesheet, clipInfo, trackId, options) {
    return _mapAndCallJsx(
      csInterface, cuesheet, clipInfo, trackId, "createClipMarkers",
      global.BeatMarkerCuesheet.filterEventsInClipRange, ", true",
      { snapToFrame: !!(options && options.snapToFrame), sourceTimes: true, knownPlaced: options && options.knownPlaced }
    );
  }
  // Places sequence markers, optionally snapped to frame starts.
  function placeSequenceMarkers(csInterface, cuesheet, clipInfo, trackId, options) {
    return _mapAndCallJsx(
      csInterface, cuesheet, clipInfo, trackId, "createMarkers",
      global.BeatMarkerCuesheet.mapEventsToSequenceSeconds, ", true",
      { snapToFrame: !!(options && options.snapToFrame), sourceTimes: false, knownPlaced: options && options.knownPlaced }
    );
  }

  global.BeatMarkerPlace = {
    placeCuesheetMarkers: placeCuesheetMarkers,
    placeSequenceMarkers: placeSequenceMarkers,
    placeClipMarkers: placeClipMarkers
  };
})(window);
