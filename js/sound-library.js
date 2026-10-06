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

  function _emptyState() {
    return { version: 1, folders: { music: [], sfx: [] }, files: {} };
  }

  function _norm(dir) {
    return String(dir).replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function _under(path, dir) {
    return path === dir || path.indexOf(dir + "/") === 0;
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
      if (!mine || (mine.status !== "done" && rec.status === "done")) {
        state.files[p] = rec;
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
        if (p.indexOf(root + "/") !== 0) {
          continue;
        }
        var node = nodes[root];
        node.count++;
        var parts = p.slice(root.length + 1).split("/");
        var prefix = root;
        for (var d = 0; d < parts.length - 1; d++) {
          prefix += "/" + parts[d];
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
  // Returns false for a folder already covered (the same folder, or one
  // inside a folder already in this section).
  function addFolder(section, dir) {
    dir = _norm(dir);
    var list = state.folders[section];
    for (var i = 0; i < list.length; i++) {
      if (_under(dir, list[i])) {
        return false;
      }
    }
    // A new parent folder replaces the subfolders it now covers.
    state.folders[section] = list.filter(function (d) { return !_under(d, dir); });
    state.folders[section].push(dir);
    return true;
  }
  // Forgets the folder and the results of files no other folder of the
  // section still covers. Never touches the files themselves.
  function removeFolder(section, dir) {
    dir = _norm(dir);
    state.folders[section] = state.folders[section].filter(function (d) { return d !== dir; });
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
    while (stack.length && out.length < MAX_FILES_PER_SCAN) {
      var dir = stack.pop();
      var names;
      try {
        names = fs.readdirSync(dir);
      } catch (e) {
        continue; // a folder that is gone or unreadable is just empty
      }
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        if (name.charAt(0) === "." || name === "__MACOSX") {
          continue;
        }
        var full = dir + "/" + name;
        var st;
        try {
          st = fs.lstatSync(full);
        } catch (e2) {
          continue;
        }
        if (st.isDirectory()) {
          stack.push(full);
        } else if (st.isFile() && AUDIO_EXT.test(name) && !seen[full]) {
          seen[full] = true;
          out.push({ path: full, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
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
      if (!rec || rec.section !== section) {
        state.files[f.path] = { path: f.path, section: section, name: _basename(f.path), size: f.size, mtimeMs: f.mtimeMs, status: "pending" };
        result.added++;
      } else if (rec.size !== f.size || rec.mtimeMs !== f.mtimeMs) {
        rec.size = f.size;
        rec.mtimeMs = f.mtimeMs;
        rec.status = "pending";
        result.changed++;
      } else if (rec.status === "done" && (rec.v || 1) !== ANALYSIS_VERSION[section]) {
        rec.status = "pending"; // analyzed by an older method
        result.changed++;
      }
    }
    var keep = offline || [];
    for (var p in state.files) {
      if (state.files.hasOwnProperty(p) && state.files[p].section === section && !present[p] &&
          !keep.some(function (d) { return _under(p, d); })) {
        delete state.files[p];
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
  function setResult(path, result) {
    var rec = state.files[path];
    if (!rec) {
      return;
    }
    if (!result || !result.ok) {
      rec.status = "error";
      rec.error = result && result.error ? String(result.error) : "unknown error";
      return;
    }
    rec.status = "done";
    rec.error = null;
    rec.v = ANALYSIS_VERSION[rec.section];
    rec.durationSec = result.durationSec;
    rec.bpm = result.bpm || null;
    rec.bpmConfidence = result.bpmConfidence === undefined ? null : result.bpmConfidence;
    rec.camelot = result.camelot || null;
    rec.key = result.key || null;
    rec.scale = result.scale || null;
    rec.strength = result.strength === undefined ? null : result.strength;
    rec.pitchCrest = result.pitchCrest === undefined ? null : result.pitchCrest;
    rec.pitchFlatness = result.pitchFlatness === undefined ? null : result.pitchFlatness;
    rec.keyAgreement = result.keyAgreement || null;
  }
  // Does this record's key mean anything? An SFX has a pitch when one pitch
  // class stands out (crest) or its spectrum is peaky rather than noisy
  // (flatness), with a confident key vote: dense drones and chords. The
  // thresholds were tuned by hand; loosening them lets more noisy sounds through.
  // Music always has a key; so does a file whose name states one, and a
  // record without these measures (scanned without them, or a timeline clip).
  var PITCH_GATE = { crest: 3.9, flatness: 0.003, strength: 0.6 };
  function hasPitch(rec) {
    if (!rec || rec.section === "music" || rec.keyFrom === "name") {
      return true;
    }
    if (typeof rec.pitchCrest !== "number" || typeof rec.pitchFlatness !== "number") {
      return true;
    }
    return rec.pitchCrest >= PITCH_GATE.crest ||
      (rec.pitchFlatness <= PITCH_GATE.flatness && (rec.strength || 0) >= PITCH_GATE.strength);
  }
  // Empties the section's results; its folders stay, so Rescan rebuilds it.
  function clearSection(section) {
    for (var p in state.files) {
      if (state.files.hasOwnProperty(p) && state.files[p].section === section) {
        delete state.files[p];
      }
    }
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
    return { startSec: Math.min(30, durationSec * 0.2), lengthSec: 90, wantBpm: true };
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
    getFolders: getFolders,
    folderTree: folderTree,
    addFolder: addFolder,
    removeFolder: removeFolder,
    listAudioFiles: listAudioFiles,
    offlineFolders: offlineFolders,
    syncFiles: syncFiles,
    pendingPaths: pendingPaths,
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
