// In-memory library of analyzed clips, used for cross-track Camelot
// compatibility suggestions. Entries are keyed by media path, so
// re-analyzing the same clip updates its entry. js/persistence.js saves and
// loads the entries; loadEntries() puts loaded data back into the map.
(function (global) {
  "use strict";

  var entries = {}; // mediaPath -> { mediaPath, label, camelot, key, scale, strength, bpm }
  function _getOrCreate(mediaPath, label) {
    var entry = entries[mediaPath];
    if (!entry) {
      entry = { mediaPath: mediaPath, label: label };
      entries[mediaPath] = entry;
    }
    entry.label = label;
    return entry;
  }

  function upsertKey(mediaPath, label, keyResult) {
    var entry = _getOrCreate(mediaPath, label);
    entry.key = keyResult.key;
    entry.scale = keyResult.scale;
    entry.strength = keyResult.strength;
    entry.camelot = keyResult.camelot;
    // "music" or "sfx" - which Library section lists this clip.
    entry.material = keyResult.material || entry.material || null;
  }
  // analysisData: { bpm, beatsArray, confidence, phase, clipInfo }, the same
  // shape js/main.js holds in lastAnalysis after a successful Analyze.
  // Returns { clipInfoChanged, previousClipInfo }. Entries are keyed by media
  // path only, so the same audio file placed on two tracks shares one entry,
  // and re-analyzing the second instance repoints it. That is allowed; the
  // flag lets js/main.js report it.
  function upsertAnalysis(mediaPath, label, analysisData) {
    var entry = _getOrCreate(mediaPath, label);
    var previousClipInfo = entry.clipInfo || null;
    entry.bpm = analysisData.bpm;
    entry.beatsArray = analysisData.beatsArray;
    entry.confidence = analysisData.confidence;
    entry.phase = analysisData.phase;
    entry.clipInfo = analysisData.clipInfo;
    // Beat This! downbeats when they drive placement (null for an
    // essentia-only grid).
    entry.downbeatTimes = analysisData.downbeatTimes || null;

    var clipInfoChanged = false;
    if (previousClipInfo && analysisData.clipInfo &&
        (previousClipInfo.trackIndex !== analysisData.clipInfo.trackIndex ||
         Math.abs(previousClipInfo.clipStartSeconds - analysisData.clipInfo.clipStartSeconds) > 0.5)) {
      clipInfoChanged = true;
    }
    return { clipInfoChanged: clipInfoChanged, previousClipInfo: previousClipInfo };
  }
  // Single-entry lookup by media path (null when absent).
  function get(mediaPath) {
    return entries[mediaPath] || null;
  }

  function getAll() {
    var list = [];
    for (var path in entries) {
      if (entries.hasOwnProperty(path)) {
        list.push(entries[path]);
      }
    }
    return list;
  }

  function remove(mediaPath) {
    delete entries[mediaPath];
  }

  function clear() {
    entries = {};
  }
  // Replaces the in-memory map with entries loaded from disk (see
  // js/persistence.js load()). Loaded entries never have `clipInfo`: it is
  // timeline-position data and is not persisted, so callers read a clip's
  // current position fresh from the host.
  function loadEntries(list) {
    entries = {};
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].mediaPath) {
        entries[list[i].mediaPath] = list[i];
      }
    }
  }

  global.BeatMarkerLibrary = {
    upsertKey: upsertKey,
    upsertAnalysis: upsertAnalysis,
    get: get,
    getAll: getAll,
    remove: remove,
    clear: clear,
    loadEntries: loadEntries
  };
})(window);
