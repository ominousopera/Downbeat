// In-memory library of analyzed clips, used for cross-track Camelot
// compatibility suggestions. Entries are keyed by media path, so
// re-analyzing the same clip updates its entry. js/persistence.js saves and
// loads the entries; loadEntries() puts loaded data back into the map.
(function (global) {
  "use strict";

  var entries = {}; // mediaPath -> { mediaPath, label, camelot, key, scale, strength, bpm }
  // When each entry last changed (entry.updatedAt), and which entries this
  // panel dropped since it started, so a save can take in another host's
  // newer entries without bringing dropped ones back. library.json stays a
  // plain array, so drops are kept in memory only, until the panel closes.
  var _removedAt = {}; // mediaPath -> time
  var _clearedAt = 0;
  function _touch(entry) {
    entry.updatedAt = Date.now();
  }
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
    _touch(entry);
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
    if (slot) { slot.confirmedKey = null; _applyKey(slot); _touch(entry); }
  }

  function confirmBpm(mediaPath, label, bpm) {
    if (typeof bpm !== "number" || !isFinite(bpm) || bpm <= 0 || bpm > 999) { throw new Error("Invalid BPM."); }
    var entry = _getOrCreate(mediaPath, label);
    entry.confirmedBpm = { value: bpm, source: "user" };
  }
  function clearConfirmedBpm(mediaPath) {
    var entry = get(mediaPath);
    if (entry) { entry.confirmedBpm = null; _touch(entry); }
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
  // The entry for a file that is there and unchanged. Only a file that IS
  // there with another size or modification time drops its entry (it was
  // replaced). A file that cannot be reached right now - an unplugged
  // drive, an offline share - keeps its entry, unused until it is back; an
  // entry saved without an identity takes the file's identity now. Neither
  // case may delete the entry, its beat grid or a hand-set key.
  function _check(mediaPath) {
    var entry = entries[mediaPath];
    if (!entry) { return { entry: null, usable: false }; }
    var current = fileIdentity(mediaPath);
    if (!current) {
      // Out of reach now. An entry with a recorded identity waits until the
      // file is back; one without (nothing to compare) stays usable as before.
      return { entry: entry, usable: !entry.fileIdentity };
    }
    if (!entry.fileIdentity) {
      entry.fileIdentity = current;
      return { entry: entry, usable: true };
    }
    if (!sameIdentity(entry.fileIdentity, current)) {
      delete entries[mediaPath];
      return { entry: null, usable: false };
    }
    return { entry: entry, usable: true };
  }
  function get(mediaPath) {
    var c = _check(mediaPath);
    return c.usable ? c.entry : null;
  }

  // Every entry worth keeping, including those whose file is out of reach
  // right now (saving must not drop them). `usableOnly` leaves those out,
  // for lists the user picks from.
  function getAll(usableOnly) {
    var list = [];
    for (var path in entries) {
      if (entries.hasOwnProperty(path)) {
        var c = _check(path);
        if (c.entry && (c.usable || !usableOnly)) { list.push(c.entry); }
      }
    }
    return list;
  }

  function remove(mediaPath) {
    delete entries[mediaPath];
    _removedAt[mediaPath] = Date.now();
  }

  // Settings > Clear: every analyzed clip goes. Only this map changes; no
  // file is touched. The time keeps another open host from writing the
  // entries back (see absorb()).
  function clear() {
    _clearedAt = Date.now();
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
      _takeMeta(list[i]);
      var entry = _normalized(list[i]);
      if (entry) { entries[entry.mediaPath] = entry; }
    }
  }

  // The clear and removal times travel in library.json as one element with
  // an empty mediaPath (a reader that does not know it skips it), so another
  // host knows what was cleared or removed here and does not write it back.
  // Removals older than 90 days, or past the newest 2000, are forgotten.
  function meta() {
    var oldest = Date.now() - 90 * 86400000;
    var keys = Object.keys(_removedAt).filter(function (k) { return _removedAt[k] > oldest; });
    keys.sort(function (a, b) { return _removedAt[b] - _removedAt[a]; });
    var removed = {};
    keys.slice(0, 2000).forEach(function (k) { removed[k] = _removedAt[k]; });
    return { clearedAt: _clearedAt, removed: removed };
  }
  function _takeMeta(raw) {
    var m = raw && raw.downbeatLibraryMeta;
    if (!m || typeof m !== "object") { return; }
    if (typeof m.clearedAt === "number" && isFinite(m.clearedAt) && m.clearedAt > _clearedAt) { _clearedAt = m.clearedAt; }
    if (m.removed && typeof m.removed === "object") {
      for (var k in m.removed) {
        if (k !== "__proto__" && m.removed.hasOwnProperty(k) && typeof m.removed[k] === "number" &&
            isFinite(m.removed[k]) && !(_removedAt[k] >= m.removed[k])) {
          _removedAt[k] = m.removed[k];
        }
      }
    }
  }
  function _goneHere(path, at) {
    return at < _clearedAt || _removedAt[path] >= at;
  }

  // Another host's saved list (library.json): an entry newer there
  // replaces this one (keeping this one's live clip position); an entry
  // not here comes in unless this panel dropped or cleared it after it
  // last changed there. Returns whether anything changed.
  function absorb(list) {
    if (!Array.isArray(list)) { return false; }
    var changed = false;
    for (var m = 0; m < list.length; m++) { _takeMeta(list[m]); }
    for (var i = 0; i < list.length; i++) {
      var theirs = _normalized(list[i]);
      if (!theirs) { continue; }
      var at = typeof theirs.updatedAt === "number" && isFinite(theirs.updatedAt) ? theirs.updatedAt : 0;
      var mine = entries[theirs.mediaPath];
      if (mine) {
        if (at > (mine.updatedAt || 0)) {
          theirs.clipInfo = mine.clipInfo;
          entries[theirs.mediaPath] = theirs;
          changed = true;
        }
      } else if (!_goneHere(theirs.mediaPath, at)) {
        entries[theirs.mediaPath] = theirs;
        changed = true;
      }
    }
    // What the other host cleared or removed after this one last changed it.
    for (var path in entries) {
      if (entries.hasOwnProperty(path) && _goneHere(path, entries[path].updatedAt || 0)) {
        delete entries[path];
        changed = true;
      }
    }
    return changed;
  }

  // One saved entry, checked field by field; null when it is unusable.
  function _normalized(raw) {
    if (raw && typeof raw.mediaPath === "string" && raw.mediaPath) {
      var entry = Object.assign({}, raw);
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
      return entry;
    }
    return null;
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
    loadEntries: loadEntries,
    absorb: absorb,
    meta: meta
  };
})(window);
