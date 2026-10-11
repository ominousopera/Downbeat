// Folder libraries for the Library tab. This file holds the data and the
// search; js/library-tab.js does the scanning, the worker calls and the UI.
// State (saved as Documents/Downbeat/sound-library.json by
// js/persistence.js):
//   folders: { music: [dir...], sfx: [dir...] }
//   files: { <path>: record }
//   record: { path, section, name, size, mtimeMs, status, durationSec, bpm,
//             bpmConfidence, camelot, key, scale, strength, error }
//   status: "pending" (new or changed since its analysis) | "done" | "error"
// A file whose size or modification time changed is analyzed again; one that
// disappeared from disk is dropped on the next scan, unless its whole folder
// is offline (offlineFolders()).
(function (global) {
  "use strict";

  var SECTIONS = ["music", "sfx"];
  // What the scan can read: WAV and AIFF in the worker (worker/
  // wav-excerpt.js), the rest through Chromium's decodeAudioData.
  var AUDIO_EXT = /\.(mp3|wav|aif|aiff|m4a|aac|flac|ogg)$/i;
  // Files the worker reads itself, never loaded by the panel.
  var WORKER_READABLE_EXT = /\.(wav|aif|aiff)$/i;
  var MAX_FILES_PER_SCAN = 50000; // a guard against pointing it at a whole disk
  // Version of the analysis method that produced a record (rec.v; absent
  // counts as 1). A record made by a different version is marked pending
  // again by syncFiles(), so a changed method re-analyzes old results on the
  // next scan.
  var ANALYSIS_VERSION = { music: 3, sfx: 3 };

  var state = _emptyState();

  // Besides folders and files, the state keeps when things changed, so two
  // hosts sharing Documents/Downbeat (Premiere and After Effects open at
  // once) can merge each other's saves instead of the last one winning
  // (see absorb() below):
  //   record.updatedAt  - when the record last changed here or there;
  //   removed           - path -> when a gone file's record was dropped;
  //   folderAt          - "section\ndir" -> when the folder was added;
  //   removedFolders    - "section\ndir" -> when the folder was taken out;
  //   clearedAt         - section -> when Clear emptied its results.
  // A reader that does not know these fields ignores them; a missing time
  // counts as 0.
  function _emptyState() {
    return { version: 1, folders: { music: [], sfx: [] }, files: {},
      removed: {}, folderAt: {}, removedFolders: {}, clearedAt: { music: 0, sfx: 0 } };
  }
  var TOMBSTONE_DAYS = 90;
  var TOMBSTONE_MAX = 5000;
  function _now() {
    return Date.now();
  }
  function _touch(rec) {
    rec.updatedAt = _now();
  }
  function _time(v) {
    return typeof v === "number" && isFinite(v) && v > 0 ? v : 0;
  }
  // A { key: time } map from saved data: valid times only, none older than
  // TOMBSTONE_DAYS, at most TOMBSTONE_MAX of the newest.
  function _timeMap(saved) {
    var out = {};
    if (!saved || typeof saved !== "object") {
      return out;
    }
    var oldest = _now() - TOMBSTONE_DAYS * 86400000;
    var keys = Object.keys(saved).filter(function (k) { return k !== "__proto__" && _time(saved[k]) > oldest; });
    keys.sort(function (a, b) { return saved[b] - saved[a]; });
    keys.slice(0, TOMBSTONE_MAX).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function _folderKey(section, dir) {
    return section + "\n" + dir;
  }

  function _norm(dir) {
    var path = String(dir).replace(/\\/g, "/");
    if (/^\/+$/.test(path)) { return "/"; }
    if (/^[a-z]:\/+$/i.test(path)) { return path.slice(0, 2) + "/"; }
    return path.replace(/\/+$/, "");
  }

  function _under(path, dir) {
    var prefix = dir.slice(-1) === "/" ? dir : dir + "/";
    return path === dir || path.indexOf(prefix) === 0;
  }

  function loadState(saved) {
    state = _emptyState();
    if (!saved || typeof saved !== "object") {
      return;
    }
    for (var s = 0; s < SECTIONS.length; s++) {
      var list = saved.folders && saved.folders[SECTIONS[s]];
      state.folders[SECTIONS[s]] = Array.isArray(list) ? list.map(_norm) : [];
    }
    state.removed = _timeMap(saved.removed);
    state.folderAt = _timeMap(saved.folderAt);
    state.removedFolders = _timeMap(saved.removedFolders);
    SECTIONS.forEach(function (sec) { state.clearedAt[sec] = _time(saved.clearedAt && saved.clearedAt[sec]); });
    var files = saved.files || {};
    for (var p in files) {
      // "__proto__" as a key would replace state.files' prototype instead of
      // adding a record (a hand-edited or damaged file).
      if (p !== "__proto__" && files.hasOwnProperty(p) && files[p] && SECTIONS.indexOf(files[p].section) !== -1) {
        state.files[p] = files[p];
        // Records that have not been checked for name tags yet get them now,
        // without a rescan.
        if (files[p].status === "done" && files[p].nameChecked !== NAME_TAGS_VERSION) {
          applyNameTags(p);
        }
        _applyConfirmed(files[p]);
      }
    }
  }
  // Bumped when the name-tag rules change, so existing records are re-checked on load.
  var NAME_TAGS_VERSION = 1;
  function _baseAndFolder(path) {
    var parts = String(path).split("/");
    return { base: parts[parts.length - 1], folder: parts.length > 1 ? parts[parts.length - 2] : "" };
  }
  // Name tags win over detection: a producer's label is more reliable than an
  // estimate. Applied to a record after its analysis (or instead of it, see
  // nameTagsComplete). A root-only tag (no mode) keeps the root and takes the
  // mode from what was detected: the detected key itself when it has that
  // root, the matching one when detection found the relative major/minor,
  // else the detected scale.
  function applyNameTags(path) {
    var rec = state.files[path];
    if (!rec) {
      return null;
    }
    if (rec.detected && (rec.confirmedKey || rec.confirmedBpm)) {
      ["bpm", "bpmConfidence", "bpmFrom", "key", "scale", "camelot", "strength", "keyFrom", "keyAgreement"].forEach(function (k) { rec[k] = rec.detected[k]; });
    }
    var bf = _baseAndFolder(path);
    var tags = parseNameTags(bf.base, bf.folder);
    var CAM = global.BeatMarkerCamelot;
    if (tags.key && CAM) {
      rec.key = tags.key;
      rec.scale = tags.scale;
      rec.camelot = CAM.toCamelotCode(tags.key, tags.scale);
      rec.keyFrom = "name";
    } else if (tags.note && CAM) {
      var major = CAM.toCamelotCode(tags.note, "major");
      var minor = CAM.toCamelotCode(tags.note, "minor");
      var pick = null;
      if (rec.camelot === major || rec.camelot === minor) {
        pick = rec.camelot;
      } else if (rec.camelot && parseInt(rec.camelot, 10) === parseInt(major, 10)) {
        pick = major; // detection heard the relative minor of <note> major
      } else if (rec.camelot && parseInt(rec.camelot, 10) === parseInt(minor, 10)) {
        pick = minor;
      } else {
        pick = rec.scale === "minor" ? minor : major;
      }
      rec.key = tags.note;
      rec.scale = pick === minor ? "minor" : "major";
      rec.camelot = pick;
      rec.keyFrom = "name";
    }
    if (tags.bpm) {
      rec.bpm = tags.bpm;
      rec.bpmConfidence = null;
      rec.bpmFrom = "name";
    }
    rec.nameChecked = NAME_TAGS_VERSION;
    if (rec.confirmedKey || rec.confirmedBpm) {
      rec.detected = {};
      ["bpm", "bpmConfidence", "bpmFrom", "key", "scale", "camelot", "strength", "keyFrom", "keyAgreement"].forEach(function (k) { rec.detected[k] = rec[k]; });
      _applyConfirmed(rec);
    }
    return tags;
  }
  // True when the file name already states the key (and, for music, the BPM):
  // then the file is not analyzed at all.
  function nameTagsComplete(path, section) {
    var bf = _baseAndFolder(path);
    var tags = parseNameTags(bf.base, bf.folder);
    return !!(tags.key && (tags.bpm || section === "sfx"));
  }

  function getState() {
    return state;
  }
  // Adds a saved copy (Load a copy) to the current library without removing
  // anything. Records keep their size and modification time, so Rescan skips
  // files that did not change.
  function mergeState(saved) {
    var added = { folders: 0, files: 0 };
    if (!saved || typeof saved !== "object") {
      return added;
    }
    for (var s = 0; s < SECTIONS.length; s++) {
      var list = saved.folders && saved.folders[SECTIONS[s]];
      if (Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          if (typeof list[i] === "string" && addFolder(SECTIONS[s], list[i])) {
            added.folders++;
          }
        }
      }
    }
    var files = saved.files || {};
    for (var p in files) {
      if (p === "__proto__" || !files.hasOwnProperty(p)) {
        continue;
      }
      var rec = files[p];
      if (!rec || typeof rec !== "object" || SECTIONS.indexOf(rec.section) === -1 || rec.path !== p) {
        continue;
      }
      var mine = state.files[p];
      if ((mine && mine.section !== rec.section) || folderProblem(rec.section, p)) { continue; }
      if (!mine || (mine.status !== "done" && rec.status === "done")) {
        state.files[p] = rec;
        _applyConfirmed(rec);
        _touch(rec);
        delete state.removed[p];
        added.files++;
      }
    }
    return added;
  }

  function getFolders(section) {
    return state.folders[section].slice();
  }
  // The folder tree of a section: every added folder (listed even when empty)
  // and every subfolder holding files, each with how many of the section's
  // files it holds, subfolders included. [{ path, name, count, depth,
  // children }], names sorted at every level.
  function folderTree(section) {
    var roots = (state.folders[section] || []).slice();
    var nodes = {};
    var out = roots.map(function (root) {
      var n = { path: root, name: _basename(root) || root, count: 0, depth: 0, children: [] };
      nodes[root] = n;
      return n;
    });
    for (var p in state.files) {
      if (!state.files.hasOwnProperty(p) || state.files[p].section !== section) {
        continue;
      }
      for (var r = 0; r < roots.length; r++) {
        var root = roots[r];
        var base = root.slice(-1) === "/" ? root : root + "/"; // a drive root already ends in "/"
        if (p.indexOf(base) !== 0) {
          continue;
        }
        var node = nodes[root];
        node.count++;
        var parts = p.slice(base.length).split("/");
        var prefix = root;
        for (var d = 0; d < parts.length - 1; d++) {
          prefix = (prefix.slice(-1) === "/" ? prefix : prefix + "/") + parts[d];
          var child = nodes[prefix];
          if (!child) {
            child = { path: prefix, name: parts[d], count: 0, depth: d + 1, children: [] };
            nodes[prefix] = child;
            node.children.push(child);
          }
          child.count++;
          node = child;
        }
        break;
      }
    }
    (function sortAll(list) {
      list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      list.forEach(function (n) { sortAll(n.children); });
    })(out);
    return out;
  }
  // Whole drives, memory cards and network shares can be added; only the
  // system disk's root cannot. The panel names the Windows system drive
  // (setSystemDrive); without it C: counts as the system drive.
  var _systemRoots = ["/", "C:/"];
  function setSystemDrive(drive) {
    var m = /^([a-z]):/i.exec(String(drive || ""));
    if (m) { _systemRoots = ["/", m[1].toUpperCase() + ":/"]; }
  }
  // Why a folder cannot be added to `section` (an i18n key), or null. Each
  // path has one section-specific record, so folders of the two sections
  // must not overlap.
  function folderProblem(section, dir) {
    dir = _norm(dir);
    if (/^[a-z]:\/$/i.test(dir)) { dir = dir.charAt(0).toUpperCase() + ":/"; }
    if (!dir || _systemRoots.indexOf(dir) !== -1) {
      return "library.folderRoot";
    }
    var other = section === "music" ? "sfx" : "music";
    if ((state.folders[other] || []).some(function (d) { return _under(dir, d) || _under(d, dir); })) {
      return "library.folderConflict";
    }
    return null;
  }

  // Returns false for a folder already covered (the same folder, or one
  // inside a folder already in this section).
  function addFolder(section, dir) {
    dir = _norm(dir);
    if (folderProblem(section, dir)) { return false; }
    var list = state.folders[section];
    for (var i = 0; i < list.length; i++) {
      if (_under(dir, list[i])) {
        return false;
      }
    }
    // A new parent folder replaces the subfolders it now covers.
    state.folders[section] = list.filter(function (d) { return !_under(d, dir); });
    state.folders[section].push(dir);
    state.folderAt[_folderKey(section, dir)] = _now();
    return true;
  }
  // Forgets the folder and the results of files no other folder of the
  // section still covers. Never touches the files themselves.
  function removeFolder(section, dir) {
    dir = _norm(dir);
    state.folders[section] = state.folders[section].filter(function (d) { return d !== dir; });
    state.removedFolders[_folderKey(section, dir)] = _now();
    var remaining = state.folders[section];
    for (var p in state.files) {
      if (!state.files.hasOwnProperty(p)) {
        continue;
      }
      var rec = state.files[p];
      if (rec.section !== section || !_under(p, dir)) {
        continue;
      }
      var stillCovered = remaining.some(function (d) { return _under(p, d); });
      if (!stillCovered) {
        delete state.files[p];
      }
    }
  }
  // Every audio file under the section's folders: [{ path, size, mtimeMs }].
  // Hidden entries (".name") are skipped; symlinks are not followed.
  function listAudioFiles(fs, section) {
    var out = [];
    var seen = {};
    var folders = state.folders[section];
    var stack = folders.slice();
    out.incomplete = [];
    while (stack.length && out.length < MAX_FILES_PER_SCAN) {
      var dir = stack.pop();
      var names;
      try {
        names = fs.readdirSync(dir);
      } catch (e) {
        out.incomplete.push(dir);
        continue; // a folder that is gone or unreadable is just empty
      }
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        // Windows keeps these at a drive's root and never lets them be read.
        if (name.charAt(0) === "." || name === "__MACOSX" || name === "System Volume Information" || /^\$recycle\.bin$/i.test(name)) {
          continue;
        }
        var full = (dir.slice(-1) === "/" ? dir : dir + "/") + name;
        var st;
        try {
          st = fs.lstatSync(full);
        } catch (e2) {
          out.incomplete.push(full);
          continue;
        }
        if (st.isDirectory()) {
          stack.push(full);
        } else if (st.isFile() && AUDIO_EXT.test(name) && !seen[full]) {
          seen[full] = true;
          out.push({ path: full, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
          if (out.length >= MAX_FILES_PER_SCAN) {
            out.incomplete = folders.slice();
            return out;
          }
        }
      }
    }
    return out;
  }

  function _basename(p) {
    var parts = p.split("/");
    return parts[parts.length - 1];
  }
  // The section's folders that are not there right now - a drive that is not
  // connected, a folder renamed or moved. A scan keeps their records: an
  // unplugged drive must not make it forget thousands of analyzed sounds,
  // their keys and favorites.
  function offlineFolders(fs, section) {
    return (state.folders[section] || []).filter(function (dir) {
      try {
        return !fs.statSync(dir).isDirectory();
      } catch (e) {
        return true;
      }
    });
  }
  // Brings the section in line with what is on disk. Files under the offline
  // folders (offlineFolders above) are left as they are.
  function syncFiles(section, found, offline) {
    var result = { added: 0, changed: 0, removed: 0, pending: 0 };
    var present = {};
    for (var i = 0; i < found.length; i++) {
      var f = found[i];
      present[f.path] = true;
      var rec = state.files[f.path];
      if (rec && rec.section !== section) {
        continue; // retain records from older states with overlapping folders
      }
      if (!rec) {
        state.files[f.path] = { path: f.path, section: section, name: _basename(f.path), size: f.size, mtimeMs: f.mtimeMs, status: "pending", updatedAt: _now() };
        delete state.removed[f.path];
        result.added++;
      } else if (rec.size !== f.size || rec.mtimeMs !== f.mtimeMs) {
        rec.size = f.size;
        rec.mtimeMs = f.mtimeMs;
        rec.status = "pending";
        clearConfirmed(f.path);
        _touch(rec);
        result.changed++;
      } else if (rec.status === "error" || (rec.status === "done" && (rec.v || 1) !== ANALYSIS_VERSION[section])) {
        rec.status = "pending"; // analyzed by an older method
        _touch(rec);
        result.changed++;
      }
    }
    var keep = (offline || []).concat(found.incomplete || []);
    for (var p in state.files) {
      if (state.files.hasOwnProperty(p) && state.files[p].section === section && !present[p] &&
          !keep.some(function (d) { return _under(p, d); })) {
        delete state.files[p];
        state.removed[p] = _now();
        result.removed++;
      }
    }
    result.pending = pendingPaths(section).length;
    return result;
  }

  function pendingPaths(section) {
    var out = [];
    for (var p in state.files) {
      if (state.files.hasOwnProperty(p) && state.files[p].section === section && state.files[p].status === "pending") {
        out.push(p);
      }
    }
    out.sort();
    return out;
  }
  // result: the worker's answer for one file ({ ok, error, durationSec, bpm,
  // bpmConfidence, key, scale, camelot, strength }).
  function _applyConfirmed(rec) {
    var key = rec.confirmedKey, bpm = rec.confirmedBpm;
    if (key && key.source === "user" && /^([1-9]|1[0-2])[AB]$/.test(key.camelot)) {
      var name = global.BeatMarkerCamelot.fromCamelotCode(key.camelot);
      rec.camelot = key.camelot; rec.key = name.key; rec.scale = name.scale;
      rec.strength = null; rec.keyAgreement = null; rec.keyFrom = "user";
    } else { rec.confirmedKey = null; }
    if (bpm && bpm.source === "user" && typeof bpm.value === "number" && isFinite(bpm.value) && bpm.value > 0 && bpm.value <= 999) {
      rec.bpm = bpm.value; rec.bpmFrom = "user"; rec.bpmConfidence = null;
    } else { rec.confirmedBpm = null; }
  }
  function confirm(path, code, bpm) {
    var rec = state.files[path];
    if (!rec || rec.status !== "done") { throw new Error("Analyze this file first."); }
    if (code && !/^([1-9]|1[0-2])[AB]$/.test(code)) { throw new Error("Invalid Camelot code."); }
    if (bpm !== null && (typeof bpm !== "number" || !isFinite(bpm) || bpm <= 0 || bpm > 999)) { throw new Error("Invalid BPM."); }
    if (!code && bpm === null) { return; }
    if (!rec.detected) {
      rec.detected = {};
      ["bpm", "bpmConfidence", "bpmFrom", "key", "scale", "camelot", "strength", "keyFrom", "keyAgreement"].forEach(function (k) { rec.detected[k] = rec[k]; });
    }
    if (code) { rec.confirmedKey = { camelot: code, source: "user" }; }
    if (bpm !== null) { rec.confirmedBpm = { value: bpm, source: "user" }; }
    _applyConfirmed(rec);
    _touch(rec);
  }
  function clearConfirmed(path) {
    var rec = state.files[path];
    if (!rec) { return; }
    if (rec.detected) {
      ["bpm", "bpmConfidence", "bpmFrom", "key", "scale", "camelot", "strength", "keyFrom", "keyAgreement"].forEach(function (k) { rec[k] = rec.detected[k]; });
    }
    rec.confirmedKey = null; rec.confirmedBpm = null; rec.detected = null;
    _touch(rec);
  }

  function setResult(path, result) {
    var rec = state.files[path];
    if (!rec) {
      return;
    }
    _touch(rec);
    if (!result || !result.ok) {
      rec.status = "error";
      rec.error = result && result.error ? String(result.error) : "unknown error";
      return;
    }
    rec.status = "done";
    rec.error = null;
    rec.v = ANALYSIS_VERSION[rec.section];
    rec.durationSec = result.durationSec;
    rec.bpmFrom = null; rec.keyFrom = null;
    rec.bpm = result.bpm || null;
    rec.bpmConfidence = result.bpmConfidence === undefined ? null : result.bpmConfidence;
    rec.camelot = result.camelot || null;
    rec.key = result.key || null;
    rec.scale = result.scale || null;
    rec.strength = result.strength === undefined ? null : result.strength;
    rec.pitchCrest = result.pitchCrest === undefined ? null : result.pitchCrest;
    rec.pitchFlatness = result.pitchFlatness === undefined ? null : result.pitchFlatness;
    rec.keyAgreement = result.keyAgreement || null;
    if (rec.confirmedKey || rec.confirmedBpm) {
      rec.detected = {};
      ["bpm", "bpmConfidence", "bpmFrom", "key", "scale", "camelot", "strength", "keyFrom", "keyAgreement"].forEach(function (k) { rec.detected[k] = rec[k]; });
      _applyConfirmed(rec);
    }
  }
  // Does this record's key mean anything? An SFX has a pitch when one pitch
  // class stands out (crest) or its spectrum is peaky rather than noisy
  // (flatness), with a confident key vote: dense drones and chords. The
  // thresholds were tuned by hand; loosening them lets more noisy sounds through.
  // Music always has a key; so does a file whose name states one, and a
  // record without these measures (scanned without them, or a timeline clip).
  var PITCH_GATE = { crest: 3.9, flatness: 0.003, strength: 0.6 };
  function hasPitch(rec) {
    if (!rec || rec.section === "music" || (rec.keyFrom === "name" || rec.keyFrom === "user")) {
      return true;
    }
    if (typeof rec.pitchCrest !== "number" || typeof rec.pitchFlatness !== "number") {
      return true;
    }
    return rec.pitchCrest >= PITCH_GATE.crest ||
      (rec.pitchFlatness <= PITCH_GATE.flatness && (rec.strength || 0) >= PITCH_GATE.strength);
  }
  // Empties the section's analysis results; its folders stay, so Rescan
  // rebuilds it. A favourite or a confirmed key or tempo stays on its
  // record, which waits for analysis again.
  var ANALYSIS_FIELDS = ["status", "error", "v", "durationSec", "bpm", "bpmConfidence", "bpmFrom", "camelot", "key", "scale",
    "strength", "keyFrom", "keyAgreement", "pitchCrest", "pitchFlatness", "detected", "nameChecked"];
  function clearSection(section) {
    state.clearedAt[section] = _now();
    for (var p in state.files) {
      if (!state.files.hasOwnProperty(p) || state.files[p].section !== section) {
        continue;
      }
      var rec = state.files[p];
      if (!rec.fav && !rec.confirmedKey && !rec.confirmedBpm) {
        delete state.files[p];
        continue;
      }
      ANALYSIS_FIELDS.forEach(function (k) { delete rec[k]; });
      rec.status = "pending";
      _applyConfirmed(rec);
      rec.updatedAt = state.clearedAt[section];
    }
  }

  // Takes in what another host saved (the parsed sound-library.json) and
  // returns whether anything here changed. Per record the newer updatedAt
  // wins; a record gone here comes back only when it changed there after
  // it went (removed / its folder's removal / Clear); a folder is kept when
  // it was added after it was last removed. Never touches audio files.
  function absorb(saved) {
    if (!saved || typeof saved !== "object" || !saved.folders || !saved.files) {
      return false;
    }
    var changed = false;
    function maxInto(target, from) {
      var m = _timeMap(from);
      for (var k in m) {
        if (m.hasOwnProperty(k) && m[k] > _time(target[k])) { target[k] = m[k]; }
      }
    }
    maxInto(state.removed, saved.removed);
    maxInto(state.folderAt, saved.folderAt);
    maxInto(state.removedFolders, saved.removedFolders);
    SECTIONS.forEach(function (sec) {
      var t = _time(saved.clearedAt && saved.clearedAt[sec]);
      if (t > state.clearedAt[sec]) { state.clearedAt[sec] = t; }
    });
    SECTIONS.forEach(function (sec) {
      var theirs = Array.isArray(saved.folders[sec]) ? saved.folders[sec].filter(function (d) { return typeof d === "string"; }).map(_norm) : [];
      var all = state.folders[sec].concat(theirs.filter(function (d) { return state.folders[sec].indexOf(d) === -1; }));
      var alive = all.filter(function (d) {
        var key = _folderKey(sec, d);
        return _time(state.folderAt[key]) >= _time(state.removedFolders[key]) && !(_time(state.removedFolders[key]) && !_time(state.folderAt[key]));
      });
      var before = state.folders[sec].join("\n");
      var mineBefore = state.folders[sec].slice();
      state.folders[sec] = [];
      alive.forEach(function (d) {
        // Folders already here stay as they are (a saved list may hold a
        // drive root); ones from the other host pass the same rules as Add folder.
        var fromThere = mineBefore.indexOf(d) === -1;
        if (!(fromThere && folderProblem(sec, d)) && !state.folders[sec].some(function (x) { return _under(d, x); })) {
          state.folders[sec] = state.folders[sec].filter(function (x) { return !_under(x, d); });
          state.folders[sec].push(d);
        }
      });
      if (state.folders[sec].join("\n") !== before) { changed = true; }
    });
    function goneSince(path, section, updatedAt) {
      if (_time(state.removed[path]) >= updatedAt && _time(state.removed[path])) { return true; }
      if (updatedAt < state.clearedAt[section]) { return true; }
      if (state.folders[section].some(function (d) { return _under(path, d); })) { return false; }
      for (var key in state.removedFolders) {
        if (state.removedFolders.hasOwnProperty(key) && key.indexOf(section + "\n") === 0 &&
            _under(path, key.slice(section.length + 1)) && state.removedFolders[key] >= updatedAt) {
          return true;
        }
      }
      return false;
    }
    for (var p in saved.files) {
      if (p === "__proto__" || !saved.files.hasOwnProperty(p)) {
        continue;
      }
      var rec = saved.files[p];
      if (!rec || typeof rec !== "object" || rec.path !== p || SECTIONS.indexOf(rec.section) === -1) {
        continue;
      }
      var mine = state.files[p];
      var theirTime = _time(rec.updatedAt);
      if (mine) {
        if (mine.section === rec.section && theirTime > _time(mine.updatedAt)) {
          state.files[p] = rec;
          _applyConfirmed(rec);
          changed = true;
        }
      } else if (!goneSince(p, rec.section, theirTime) && !folderProblem(rec.section, p)) {
        state.files[p] = rec;
        _applyConfirmed(rec);
        changed = true;
      }
    }
    for (var q in state.files) {
      if (state.files.hasOwnProperty(q) && goneSince(q, state.files[q].section, _time(state.files[q].updatedAt))) {
        delete state.files[q];
        changed = true;
      }
    }
    return changed;
  }
  // Number of records made by a different analysis version; Start scan redoes them.
  function outdatedCount(section) {
    var n = 0;
    for (var p in state.files) {
      if (state.files.hasOwnProperty(p) && state.files[p].section === section &&
          state.files[p].status === "done" && (state.files[p].v || 1) !== ANALYSIS_VERSION[section]) {
        n++;
      }
    }
    return n;
  }

  function counts(section) {
    var c = { total: 0, done: 0, pending: 0, error: 0 };
    for (var p in state.files) {
      if (state.files.hasOwnProperty(p) && state.files[p].section === section) {
        c.total++;
        c[state.files[p].status]++;
      }
    }
    return c;
  }
  // Search. items: records of the section (folder files, plus the clips
  // analyzed on the timeline that the panel passes in). criteria:
  //   text     - words that must all appear in the file name
  //   camelot  - "8A" etc., or empty for any key
  //   keyMode  - "exact" or "compatible" (same key, +-1, relative major/minor)
  //   bpm      - target tempo, or empty
  //   tolPct   - allowed difference in percent (default 4)
  //   halfDouble - also accept half and double the target tempo
  // Returns the matches, best first: an exact key before a compatible one,
  // then the closest tempo, then by name.
  function search(items, criteria) {
    criteria = criteria || {};
    var words = String(criteria.text || "").toLowerCase().split(/\s+/).filter(function (w) { return w; });
    var targetKey = criteria.camelot || null;
    var compatible = targetKey && criteria.keyMode === "compatible"
      ? global.BeatMarkerCamelot.getCompatibleCodes(targetKey) : null;
    var bpm = parseFloat(criteria.bpm);
    var hasBpm = bpm > 0;
    var tol = parseFloat(criteria.tolPct);
    if (!(tol >= 0)) {
      tol = 4;
    }
    var targets = hasBpm ? (criteria.halfDouble ? [bpm, bpm / 2, bpm * 2] : [bpm]) : [];
    // The smarter text search: word starts in the name and folders, UCS
    // categories, synonyms, "-word" to exclude. Without that module (the
    // worker loads this file too), plain every-word-in-the-name matching.
    var smart = global.BeatMarkerSfxSearch && words.length ? global.BeatMarkerSfxSearch.compile(criteria.text) : null;

    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var textScore = 0;
      if (smart) {
        textScore = global.BeatMarkerSfxSearch.score(smart, it);
        if (textScore < 0) {
          continue;
        }
      } else {
        var name = String(it.name || "").toLowerCase();
        var ok = true;
        for (var w = 0; w < words.length && ok; w++) {
          ok = name.indexOf(words[w]) !== -1;
        }
        if (!ok) {
          continue;
        }
      }
      var keyRank = 0;
      if (targetKey) {
        if (!hasPitch(it)) {
          continue; // its "key" is noise, not something to match
        }
        if (it.camelot === targetKey) {
          keyRank = 0;
        } else if (compatible && it.camelot && compatible.indexOf(it.camelot) !== -1) {
          keyRank = 1;
        } else {
          continue;
        }
      }
      var bpmDiffPct = 0;
      if (hasBpm) {
        if (!(it.bpm > 0)) {
          continue;
        }
        var best = Infinity;
        for (var t = 0; t < targets.length; t++) {
          best = Math.min(best, Math.abs(it.bpm - targets[t]) / targets[t] * 100);
        }
        if (best > tol + 1e-9) {
          continue;
        }
        bpmDiffPct = best;
      }
      out.push({ item: it, keyRank: keyRank, bpmDiffPct: bpmDiffPct, textScore: textScore });
    }
    out.sort(function (a, b) {
      return (a.keyRank - b.keyRank) || (b.textScore - a.textScore) || (a.bpmDiffPct - b.bpmDiffPct) ||
        String(a.item.name).localeCompare(String(b.item.name));
    });
    return out.map(function (r) { return r.item; });
  }
  // KEY AND BPM FROM THE FILE NAME. Returns { key, scale, bpm, note } - any
  // of them null. `note` is a root with no mode ("Loopable D", a "G" folder
  // of piano pings); the scan takes the mode from detection.
  var ACC = "(#|b|\\u266f|\\u266d|[ -]?[Ss]harp|[ -]?[Ff]lat)?";
  var MODE_WORD = "([Mm]aj(?:or)?|[Mm]in(?:or)?|MAJ(?:OR)?|MIN(?:OR)?|[Mm]oll|[Dd]ur)";
  var RE_KEY_WORD = new RegExp("(?:^|[^A-Za-z])([A-G])" + ACC + "[ _-]?" + MODE_WORD + "(?![a-z])");
  var RE_KEY_PREFIX = new RegExp("(?:^|[^A-Za-z])[Kk][Ee][Yy](?: of)?[ :_-]*([A-G])" + ACC + "(m)?(?![A-Za-z])");
  var RE_SHORT_FENCED = new RegExp("(?:^|[_(\\[-])\\s?([A-G])" + ACC + "(m)?\\s?(?=$|[_)\\]-])");
  var RE_SHORT_SPACED = new RegExp("(?:^|[\\s_(\\[-])([A-G])" + ACC + "(m)?(?=$|[\\s_)\\]-])");
  var RE_BPM_AFTER = /(?:^|[^0-9.])(\d{2,3}(?:\.\d{1,2})?)\s?[-_]?\s?bpm(?![a-z])/i;
  var RE_BPM_BEFORE = /(?:^|[^a-z])bpm\s?[-_:]?\s?(\d{2,3}(?:\.\d{1,2})?)(?![0-9])/i;
  var RE_CAMELOT = /(?:^|[(\[_-]\s?)(1[0-2]|[1-9])([AB])(?=\s?[)\]_-]|\s-\s)/; // "8A - 128 - Title" (Mixed In Key), "(8A)", "_8A_"
  var RE_MIK_BPM = /^(?:1[0-2]|[1-9])[AB]\s?-\s?(\d{2,3})\s?-/;
  var NOTE_FOLDER = /^([A-G])(#|b|♯|♭)?\s?(m|min|minor|maj|major)?$/;

  function _accidental(acc) {
    if (!acc) { return ""; }
    acc = acc.replace(/[ -]/g, "").toLowerCase();
    return (acc === "#" || acc === "♯" || acc === "sharp") ? "#" : "b";
  }
  function _mode(word) {
    return /^(min|moll)/i.test(word) ? "minor" : "major";
  }
  function _normalizeNote(letter, acc) {
    var names = { "Cb": "B", "Db": "C#", "D#": "D#", "Eb": "D#", "E#": "F", "Fb": "E", "Gb": "F#", "Ab": "G#", "A#": "A#", "Bb": "A#", "B#": "C" };
    var n = letter + _accidental(acc);
    return names[n] || n;
  }

  function parseNameTags(fileName, folderName) {
    var name = String(fileName).replace(/\.[^.]+$/, "");
    var out = { key: null, scale: null, bpm: null, note: null };
    var m = name.match(RE_BPM_AFTER) || name.match(RE_BPM_BEFORE) || name.match(RE_MIK_BPM);
    if (m) {
      var bpm = parseFloat(m[1]);
      if (bpm >= 40 && bpm <= 250) { out.bpm = bpm; }
    }
    var cam = name.match(RE_CAMELOT);
    if (cam && global.BeatMarkerCamelot) {
      var fk = global.BeatMarkerCamelot.fromCamelotCode(cam[1] + cam[2]);
      if (fk) { out.key = fk.key; out.scale = fk.scale; return out; }
    }
    if ((m = name.match(RE_KEY_WORD))) {
      out.key = _normalizeNote(m[1], m[2]); out.scale = _mode(m[3]); return out;
    }
    if ((m = name.match(RE_KEY_PREFIX))) {
      out.key = _normalizeNote(m[1], m[2]); out.scale = m[3] ? "minor" : "major"; return out;
    }
    if ((m = name.match(RE_SHORT_FENCED)) && m[3]) {
      out.key = _normalizeNote(m[1], m[2]); out.scale = "minor"; return out; // "_Am_", "(F#m)"
    }
    if (out.bpm && (m = name.match(RE_SHORT_SPACED))) {
      if (m[3]) { out.key = _normalizeNote(m[1], m[2]); out.scale = "minor"; return out; } // "Loop 120bpm Am"
      out.note = _normalizeNote(m[1], m[2]);
      return out;
    }
    var f = folderName ? String(folderName).match(NOTE_FOLDER) : null;
    if (f) {
      if (f[3]) { out.key = _normalizeNote(f[1], f[2]); out.scale = _mode(f[3] === "m" ? "min" : f[3]); }
      else { out.note = _normalizeNote(f[1], f[2]); } // a folder of sounds sorted by note
    }
    return out;
  }
  // Which part of a file the scan analyzes, for speed. SFX: the first 30 s,
  // and no tempo.
  function excerptRange(durationSec, section) {
    if (section === "sfx") {
      return { startSec: 0, lengthSec: Math.min(durationSec, 30), wantBpm: false };
    }
    if (durationSec <= 100) {
      return { startSec: 0, lengthSec: durationSec, wantBpm: true };
    }
    var startSec = Math.min(30, durationSec * 0.2);
    return { startSec: startSec, lengthSec: Math.min(90, durationSec - startSec), wantBpm: true };
  }
  // Favorites: a flag on the file's record, so it is saved with the library
  // and kept by Save / Load a copy.
  function setFavorite(path, on) {
    var rec = state.files[path];
    if (!rec) {
      return false;
    }
    if (on) {
      rec.fav = true;
    } else {
      delete rec.fav;
    }
    _touch(rec);
    return true;
  }

  function sectionItems(section) {
    var out = [];
    for (var p in state.files) {
      if (state.files.hasOwnProperty(p) && state.files[p].section === section) {
        out.push(state.files[p]);
      }
    }
    return out;
  }

  global.BeatMarkerSoundLibrary = {
    SECTIONS: SECTIONS,
    AUDIO_EXT: AUDIO_EXT,
    WORKER_READABLE_EXT: WORKER_READABLE_EXT,
    loadState: loadState,
    getState: getState,
    mergeState: mergeState,
    absorb: absorb,
    getFolders: getFolders,
    folderTree: folderTree,
    addFolder: addFolder,
    folderProblem: folderProblem,
    setSystemDrive: setSystemDrive,
    isUnder: function (path, dir) { return _under(String(path), _norm(dir)); },
    removeFolder: removeFolder,
    listAudioFiles: listAudioFiles,
    offlineFolders: offlineFolders,
    syncFiles: syncFiles,
    pendingPaths: pendingPaths,
    confirm: confirm,
    clearConfirmed: clearConfirmed,
    setResult: setResult,
    setFavorite: setFavorite,
    hasPitch: hasPitch,
    clearSection: clearSection,
    counts: counts,
    outdatedCount: outdatedCount,
    search: search,
    excerptRange: excerptRange,
    parseNameTags: parseNameTags,
    applyNameTags: applyNameTags,
    nameTagsComplete: nameTagsComplete,
    sectionItems: sectionItems
  };
})(typeof window !== "undefined" ? window : global);
