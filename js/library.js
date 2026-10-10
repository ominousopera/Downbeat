// In-memory library of analyzed clips, used for cross-track Camelot
// compatibility suggestions. Entries are keyed by media path, so
// re-analyzing the same clip updates its entry. js/persistence.js saves and
// loads the entries; loadEntries() puts loaded data back into the map.
(function (global) {
  "use strict";

  var entries = {}; // mediaPath -> { mediaPath, label, camelot, key, scale, strength, bpm }
  // Verify cached analysis against the current media file.
  function fileIdentity(mediaPath) {
    try {
      var stat = global.cep_node.require("fs").statSync(mediaPath);
      return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
    } catch (err) { return null; }
  }
  function sameIdentity(a, b) {
    return !!(a && b && typeof a.size === "number" && isFinite(a.size) &&
      typeof a.mtimeMs === "number" && isFinite(a.mtimeMs) &&
      a.size === b.size && a.mtimeMs === b.mtimeMs);
  }
  function identityKey(mediaPath) {
    var id = fileIdentity(mediaPath);
    return id ? id.size + ":" + id.mtimeMs : "missing";
  }

  function _getOrCreate(mediaPath, label) {
    var entry = get(mediaPath);
    if (!entry) {
      entry = { mediaPath: mediaPath, label: label, fileIdentity: fileIdentity(mediaPath) };
      entries[mediaPath] = entry;
    }
    entry.label = label;
    return entry;
  }

  function _keySlot(entry, scopeKey, create) {
    if (!scopeKey || scopeKey.indexOf(":") < 0) { return entry; }
    entry.intervalKeys = Array.isArray(entry.intervalKeys) ? entry.intervalKeys : [];
    var slot = entry.intervalKeys.filter(function (r) { return r.scopeKey === scopeKey; })[0];
    if (!slot && create) {
      slot = { scopeKey: scopeKey };
      entry.intervalKeys.push(slot);
      if (entry.intervalKeys.length > 12) { entry.intervalKeys.shift(); }
    }
    return slot || null;
  }
  function _applyKey(slot) {
    var result = slot.detectedKey || {};
    if (slot.confirmedKey) {
      var name = global.BeatMarkerCamelot.fromCamelotCode(slot.confirmedKey.camelot);
      result = { key: name.key, scale: name.scale, strength: null, camelot: slot.confirmedKey.camelot, material: slot.material };
    }
    ["key", "scale", "strength", "camelot", "material"].forEach(function (k) { slot[k] = result[k] === undefined ? null : result[k]; });
  }
  function upsertKey(mediaPath, label, keyResult) {
    var entry = _getOrCreate(mediaPath, label);
    var slot = _keySlot(entry, keyResult.scopeKey, true);
    slot.material = keyResult.material || slot.material || null;
    slot.detectedKey = { key: keyResult.key, scale: keyResult.scale,
      strength: keyResult.strength, camelot: keyResult.camelot, material: slot.material };
    _applyKey(slot);
  }
  function getKey(mediaPath, scopeKey) {
    var entry = get(mediaPath);
    var slot = entry && _keySlot(entry, scopeKey, false);
    if (scopeKey && scopeKey.indexOf(":") < 0 && slot && slot.material && slot.material !== scopeKey) { return null; }
    return slot && slot.camelot ? Object.assign({}, slot, { manual: !!slot.confirmedKey }) : null;
  }
  function confirmKey(mediaPath, label, code, scopeKey) {
    if (!/^([1-9]|1[0-2])[AB]$/.test(code)) { throw new Error("Invalid Camelot code."); }
    var entry = _getOrCreate(mediaPath, label), slot = _keySlot(entry, scopeKey, true);
    if (!slot.detectedKey && slot.camelot) {
      slot.detectedKey = {};
      ["key", "scale", "strength", "camelot", "material"].forEach(function (k) { slot.detectedKey[k] = slot[k]; });
    }
    slot.material = String(scopeKey || "music").split(":")[0];
    slot.confirmedKey = { camelot: code, source: "user" };
    _applyKey(slot);
  }
  function clearConfirmedKey(mediaPath, scopeKey) {
    var entry = get(mediaPath), slot = entry && _keySlot(entry, scopeKey, false);
    if (slot) { slot.confirmedKey = null; _applyKey(slot); }
  }

  function confirmBpm(mediaPath, label, bpm) {
    if (typeof bpm !== "number" || !isFinite(bpm) || bpm <= 0 || bpm > 999) { throw new Error("Invalid BPM."); }
    var entry = _getOrCreate(mediaPath, label);
    entry.confirmedBpm = { value: bpm, source: "user" };
  }
  function clearConfirmedBpm(mediaPath) {
    var entry = get(mediaPath);
    if (entry) { entry.confirmedBpm = null; }
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
    var entry = entries[mediaPath];
    if (!entry) { return null; }
    var current = fileIdentity(mediaPath);
    if ((entry.fileIdentity || current) && !sameIdentity(entry.fileIdentity, current)) {
      delete entries[mediaPath];
      return null;
    }
    return entry;
  }

  function getAll() {
    var list = [];
    for (var path in entries) {
      if (entries.hasOwnProperty(path)) {
        var entry = get(path);
        if (entry) { list.push(entry); }
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
    if (!Array.isArray(list)) { return; }
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i].mediaPath === "string" && list[i].mediaPath) {
        var entry = Object.assign({}, list[i]);
        entry.bpm = typeof entry.bpm === "number" && isFinite(entry.bpm) && entry.bpm > 0 ? entry.bpm : null;
        entry.beatsArray = entry.bpm ? validTimes(entry.beatsArray) : null;
        entry.downbeatTimes = entry.beatsArray ? validTimes(entry.downbeatTimes) : null;
        entry.confidence = typeof entry.confidence === "number" && isFinite(entry.confidence) ? entry.confidence : null;
        entry.phase = Number.isInteger(entry.phase) && entry.phase >= 0 && entry.phase <= 3 ? entry.phase : 0;
        var slots = [entry].concat(Array.isArray(entry.intervalKeys) ? entry.intervalKeys.slice(-12) : []);
        entry.intervalKeys = slots.slice(1).filter(function (slot) { return slot && typeof slot.scopeKey === "string" && /^(music|sfx):[0-9]+:[0-9]+$/.test(slot.scopeKey); });
        slots.forEach(function (slot) {
          if (!slot || !slot.confirmedKey || slot.confirmedKey.source !== "user" ||
              !/^([1-9]|1[0-2])[AB]$/.test(slot.confirmedKey.camelot)) {
            if (slot) { slot.confirmedKey = null; }
          }
        });
        if (!entry.confirmedBpm || entry.confirmedBpm.source !== "user" ||
            typeof entry.confirmedBpm.value !== "number" || !isFinite(entry.confirmedBpm.value) ||
            entry.confirmedBpm.value <= 0 || entry.confirmedBpm.value > 999) { entry.confirmedBpm = null; }
        entries[entry.mediaPath] = entry;
      }
    }
  }

  // Validate the complete grid so removing a beat cannot alter phase.
  function validTimes(times) {
    if (!Array.isArray(times) || !times.length) { return null; }
    for (var i = 0; i < times.length; i++) {
      if (typeof times[i] !== "number" || !isFinite(times[i]) || times[i] < 0 ||
          (i > 0 && times[i] <= times[i - 1])) { return null; }
    }
    return times.slice();
  }

  global.BeatMarkerLibrary = {
    fileIdentity: fileIdentity,
    sameIdentity: sameIdentity,
    identityKey: identityKey,
    confirmBpm: confirmBpm,
    clearConfirmedBpm: clearConfirmedBpm,
    getKey: getKey,
    confirmKey: confirmKey,
    clearConfirmedKey: clearConfirmedKey,
    upsertKey: upsertKey,
    upsertAnalysis: upsertAnalysis,
    get: get,
    getAll: getAll,
    remove: remove,
    clear: clear,
    loadEntries: loadEntries
  };
})(window);
