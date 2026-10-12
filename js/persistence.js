// Persists the track library (js/library.js), the settings and the Library
// tab's folder data to disk so they survive panel reloads. Runs in the
// panel's Chromium context, using window.cep_node's fs.
// Local only: plain JSON files in Documents/Downbeat/, no network and no
// sync. The data lives in Documents rather than inside the extension folder
// because adding files to a signed ZXP install invalidates its signature.
// SystemPath.MY_DOCUMENTS asks the host for the real Documents location, so a
// Documents folder redirected elsewhere (e.g. into OneDrive on Windows) still
// resolves correctly.
(function (global) {
  "use strict";
  var FILE_NAME = "library.json";
  var DATA_FOLDER_NAME = "Downbeat";
  var cachedDir = null;
  function _getDataDir(csInterface) {
    if (cachedDir) {
      return cachedDir;
    }
    var documentsDir = csInterface.getSystemPath(SystemPath.MY_DOCUMENTS);
    cachedDir = documentsDir + "/" + DATA_FOLDER_NAME;
    return cachedDir;
  }
  // Where the panel (js/bridge.js, js/library-tab.js) writes the decoded-samples
  // handoff files for its worker subprocesses. Created on demand; callers write into it directly.
  function getTempDir(csInterface) {
    var fs = window.cep_node.require("fs");
    var dir = _getDataDir(csInterface) + "/tmp";
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  // ---- Deleting: the only two places this plugin removes anything it did
  // not just create itself are the startup temp sweep and the Settings
  // "Delete my data" button. Both use _listOwnFiles(), which returns an
  // explicit list of files that are provably this plugin's, and nothing
  // more:
  //  - only directly inside Documents/Downbeat/ and Documents/Downbeat/tmp/,
  //    never deeper, never outside;
  //  - only exact names this plugin writes: library.json, settings.json,
  //    sound-library.json, and the worker handoff files matching
  //    OWN_TEMP_FILE_PATTERN (samples-/beatthis-/skey-/library-<n>-<n>.raw,
  //    library-<n>-<n>.json);
  //  - only plain files.
  // Otherwise it refuses outright. The pattern must match the names
  // the panel gives its worker handoff files.
  var OWN_TEMP_FILE_PATTERN = /^((samples|beatthis|skey|library)-[0-9]+-[0-9]+\.raw|library-[0-9]+-[0-9]+\.json)$/;
  // In Documents/Downbeat itself: the new copy of a data file while it is
  // written (_writeAtomic), and a data file set aside because it could not
  // be read (_setAside). Both are this plugin's own.
  var OWN_DATA_TEMP_PATTERN = /^(library|settings|sound-library)\.json\.tmp-[0-9]+-[0-9]+$/;
  var OWN_SET_ASIDE_PATTERN = /^(library|settings|sound-library)\.unreadable-[0-9]{8}-[0-9]{6}(-[0-9]+)?\.json$/;
  // The complete new copy of a data file whose save Windows refused
  // (_writeAtomic): kept, never swept, put back by the next load when it is
  // newer than the data file or the data file is cut, and removed by a
  // later successful save it is older than (see "A save Windows refused").
  var OWN_UNSAVED_PATTERN = /^(library|settings|sound-library)\.unsaved-[0-9]{8}-[0-9]{6}(-[0-9]+)?\.json$/;
  // The start-up sweep leaves younger temp files alone: Premiere and After
  // Effects can both run Downbeat on one Documents/Downbeat, and a panel
  // starting in one must not remove files the other is still using.
  var STALE_TEMP_MS = 6 * 60 * 60 * 1000;
  function _pathKind(fs, path) {
    var stat;
    try {
      stat = fs.lstatSync(path); // lstat: describes a symlink itself, never what it points to
    } catch (e) {
      if (e.code === "ENOENT") {
        return "missing";
      }
      throw e;
    }
    if (stat.isSymbolicLink()) {
      return "link";
    }
    if (stat.isDirectory()) {
      return "dir";
    }
    return stat.isFile() ? "file" : "other";
  }
  // Sanity check on what the host reports as Documents, before any delete. An
  // empty answer would otherwise turn Documents/Downbeat into /Downbeat.
  // Requires an absolute path with at least one folder below the root or
  // drive letter.
  function _looksLikeRealFolderPath(path) {
    if (typeof path !== "string") {
      return false;
    }
    var normalized = path.replace(/\\/g, "/");
    var isAbsolute = normalized.charAt(0) === "/" || /^[A-Za-z]:\//.test(normalized);
    var parts = normalized.split("/").filter(function (p) { return p && !/^[A-Za-z]:$/.test(p); });
    return isAbsolute && parts.length >= 1;
  }
  function _listOwnFiles(csInterface, includeDataFiles) {
    var fs = window.cep_node.require("fs");
    var documentsDir = csInterface.getSystemPath(SystemPath.MY_DOCUMENTS);
    if (!_looksLikeRealFolderPath(documentsDir)) {
      throw new Error("Refusing to delete anything: the Documents path reported by the host looks wrong (\"" + documentsDir + "\").");
    }
    var dataDir = _getDataDir(csInterface);
    var listing = { dataDir: dataDir, files: [], kept: [] };
    var dataDirKind = _pathKind(fs, dataDir);
    if (dataDirKind === "missing") {
      return listing;
    }
    if (dataDirKind !== "dir") {
      throw new Error("Refusing to delete anything: " + dataDir + " is not a plain folder (it is a " + dataDirKind + ").");
    }
    var ownDataNames = [FILE_NAME, SETTINGS_FILE_NAME, SOUND_LIBRARY_FILE_NAME];
    var names = fs.readdirSync(dataDir);
    for (var i = 0; i < names.length; i++) {
      if (names[i] === "tmp") {
        continue; // looked at on its own below
      }
      var full = dataDir + "/" + names[i];
      var ownData = ownDataNames.indexOf(names[i]) !== -1 || OWN_SET_ASIDE_PATTERN.test(names[i]) ||
        OWN_UNSAVED_PATTERN.test(names[i]);
      if (((includeDataFiles && ownData) || OWN_DATA_TEMP_PATTERN.test(names[i])) && _pathKind(fs, full) === "file") {
        listing.files.push(full);
      } else {
        listing.kept.push(full);
      }
    }
    var tmpDir = dataDir + "/tmp";
    var tmpKind = _pathKind(fs, tmpDir);
    if (tmpKind === "dir") {
      var tmpNames = fs.readdirSync(tmpDir);
      for (var j = 0; j < tmpNames.length; j++) {
        var tmpFull = tmpDir + "/" + tmpNames[j];
        if (OWN_TEMP_FILE_PATTERN.test(tmpNames[j]) && _pathKind(fs, tmpFull) === "file") {
          listing.files.push(tmpFull);
        } else {
          listing.kept.push(tmpFull);
        }
      }
    } else if (tmpKind !== "missing") {
      listing.kept.push(tmpDir); // a tmp that is a link or a file is not ours to look into
    }
    return listing;
  }
  function _deleteListedFiles(fs, files) {
    var deleted = [];
    var failed = [];
    for (var i = 0; i < files.length; i++) {
      try {
        fs.unlinkSync(files[i]);
        deleted.push(files[i]);
      } catch (e) {
        failed.push(files[i] + " (" + (e.code || e.message) + ")");
      }
    }
    return { deleted: deleted, failed: failed };
  }
  // rmdirSync refuses a folder that still holds anything, so this can only
  // ever remove a folder that is already empty.
  function _removeFolderIfEmpty(fs, dir) {
    if (_pathKind(fs, dir) !== "dir") {
      return false;
    }
    try {
      fs.rmdirSync(dir);
      return true;
    } catch (e) {
      return false;
    }
  }
  // Every temp file is deleted as soon as its worker exits, but a Premiere
  // crash mid-analysis would leave one behind. Raw samples are large (a
  // 3-minute track is about 30 MB), so leftovers are swept at startup.
  // A <name>.json.tmp-* file whose <name>.json does not parse may be the
  // only complete copy of a refused save (see "A save Windows refused"): kept.
  function _holdsDataOfCutFile(fs, f) {
    var name = f.slice(f.lastIndexOf("/") + 1);
    if (!OWN_DATA_TEMP_PATTERN.test(name)) { return false; }
    var dataFile = f.slice(0, f.lastIndexOf(".tmp-"));
    try {
      JSON.parse(fs.readFileSync(dataFile, "utf8"));
      return false;
    } catch (e) {
      return !(e && e.code === "ENOENT");
    }
  }
  function clearLeftoverTempFiles(csInterface) {
    try {
      var fs = window.cep_node.require("fs");
      // Only files older than STALE_TEMP_MS: the other host may be working.
      var now = Date.now();
      var stale = _listOwnFiles(csInterface, false).files.filter(function (f) {
        try { return now - fs.lstatSync(f).mtimeMs > STALE_TEMP_MS && !_holdsDataOfCutFile(fs, f); } catch (e) { return false; }
      });
      var result = _deleteListedFiles(fs, stale);
      return { ok: result.failed.length === 0, removed: result.deleted.length, error: result.failed.join(", ") };
    } catch (e) {
      return { ok: false, error: e.message ? e.message : String(e) };
    }
  }
  function listUserData(csInterface) {
    try {
      var listing = _listOwnFiles(csInterface, true);
      return { ok: true, dataDir: listing.dataDir, files: listing.files, kept: listing.kept };
    } catch (e) {
      return { ok: false, error: e.message ? e.message : String(e) };
    }
  }
  // Re-lists at the moment of deleting rather than trusting the list shown in
  // the dialog, so a file that changed in between is judged afresh.
  function deleteUserData(csInterface) {
    try {
      var fs = window.cep_node.require("fs");
      var listing = _listOwnFiles(csInterface, true);
      var result = _deleteListedFiles(fs, listing.files);
      _saveBlocked = {};
      _forgetSync();
      _removeFolderIfEmpty(fs, listing.dataDir + "/tmp");
      var folderRemoved = _removeFolderIfEmpty(fs, listing.dataDir);
      return {
        ok: result.failed.length === 0,
        dataDir: listing.dataDir,
        deleted: result.deleted,
        failed: result.failed,
        kept: listing.kept,
        folderRemoved: folderRemoved
      };
    } catch (e) {
      return { ok: false, error: e.message ? e.message : String(e) };
    }
  }
  // ---- Reading and writing the three data files. A save writes the new
  // text to a temp copy beside the file and renames it over the file, so
  // the file is always either the old or the new version, never a cut-off
  // one. A file that is there but is not valid JSON is renamed to
  // <name>.unreadable-<date>-<time>.json before anything can save, and the
  // caller tells the user. A file that cannot be read at all (locked, no
  // permission) is left alone, and saving over it is refused for the rest
  // of the session.
  var _saveBlocked = {}; // file path -> true
  // What this panel last read or wrote, to notice another host's save
  // (Premiere and After Effects can share Documents/Downbeat).
  var _synced = {}; // file path -> "mtimeMs:size"
  // Each data file carries a generation: a random ID written when the file
  // is created from nothing and kept by every later save. Delete my data in
  // one host followed by a fresh save there gives the file a new
  // generation, which tells the other host its copy is gone - noticing
  // only that the file was missing is not enough when the deleting host
  // saves again before the other one looks. A file without a generation
  // counts as "" and keeps it.
  var _gen = {}; // file path -> generation this panel last read or wrote
  function _forgetSync() {
    _synced = {};
    _gen = {};
  }
  // After another host's Delete my data: every file this panel had synced
  // must be read again before it is saved over (it may hold the other
  // host's new data), and still counts as deleted while it is missing.
  function _resyncAll() {
    for (var p in _synced) {
      if (_synced.hasOwnProperty(p)) { _synced[p] = "?"; }
    }
    _gen = {};
  }
  function _newGeneration() {
    return Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
  }
  function _generationOf(value) {
    if (Array.isArray(value)) {
      for (var i = value.length - 1; i >= 0; i--) {
        var meta = value[i] && value[i].downbeatLibraryMeta;
        if (meta && typeof meta === "object") { return typeof meta.generation === "string" ? meta.generation : ""; }
      }
      return "";
    }
    return value && typeof value === "object" && typeof value.dataGeneration === "string" ? value.dataGeneration : "";
  }
  // The generation a save writes: the file's own while it exists, a new one
  // when it does not.
  function _generationForSave(fs, filePath) {
    var stat = _statState(fs, filePath);
    if (stat.error) {
      throw stat.error; // not saved over a file that could not be checked
    }
    if (stat.missing) {
      return _newGeneration();
    }
    if (_gen[filePath] === undefined) {
      try { _gen[filePath] = _generationOf(JSON.parse(fs.readFileSync(filePath, "utf8"))); } catch (e) { _gen[filePath] = ""; }
    }
    return _gen[filePath];
  }

  // { stamp } for a file that is there, { missing: true } only when the
  // system says it does not exist, { error } for anything else - a drive or
  // cloud folder that briefly fails is not a deleted file.
  function _statState(fs, filePath) {
    try {
      var st = fs.statSync(filePath);
      return { stamp: st.mtimeMs + ":" + st.size };
    } catch (e) {
      if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) {
        return { missing: true };
      }
      return { error: e };
    }
  }
  function _stamp(fs, filePath) {
    return _statState(fs, filePath).stamp || null;
  }
  function _noteSynced(fs, filePath) {
    var stamp = _stamp(fs, filePath);
    if (stamp) { _synced[filePath] = stamp; } else { delete _synced[filePath]; }
  }

  // A shallow copy of `object` with its generation, so the caller's own
  // object is never changed.
  function _withGeneration(object, generation) {
    var out = {};
    for (var k in (object || {})) {
      if (object.hasOwnProperty(k)) { out[k] = object[k]; }
    }
    out.dataGeneration = generation;
    return out;
  }

  function _two(n) { return (n < 10 ? "0" : "") + n; }
  // A free <data file>.<tag>-<date>-<time>[-n].json next to the data file,
  // or null.
  function _freeDatedName(fs, filePath, tag) {
    var d = new Date();
    var stamp = d.getFullYear() + _two(d.getMonth() + 1) + _two(d.getDate()) + "-" + _two(d.getHours()) + _two(d.getMinutes()) + _two(d.getSeconds());
    var base = filePath.replace(/\.json$/, "") + "." + tag + "-" + stamp;
    for (var i = 0; i < 100; i++) {
      var target = base + (i ? "-" + i : "") + ".json";
      if (!fs.existsSync(target)) {
        return target;
      }
    }
    return null;
  }
  // Moves `from` to such a name, never over an existing file; returns the
  // new path, or null.
  function _moveToDatedName(fs, from, filePath, tag) {
    var target = _freeDatedName(fs, filePath, tag);
    if (!target) { return null; }
    try {
      fs.renameSync(from, target);
      return target;
    } catch (e) {
      return null;
    }
  }
  function _setAside(fs, filePath) {
    return _moveToDatedName(fs, filePath, filePath, "unreadable");
  }

  // ---- A save Windows refused. Windows can refuse to replace a data file
  // another program holds open (OneDrive, an antivirus); the text is then
  // written in place, and that write can fail too - before anything is
  // written (the file stays whole but old) or half-way (the file is cut
  // short). In both cases:
  //   - the complete new text stays next to it as
  //     <name>.unsaved-<date>-<time>.json (written afresh when the temp file
  //     cannot be renamed), which the start-up sweep never removes;
  //   - when the file was cut, this panel remembers it, so its next save may
  //     replace it: its memory holds everything the copy holds;
  //   - the next load puts the newest such copy back as the data file when
  //     it is newer than the data file, or when the data file is cut (then
  //     a copy made up to a minute before the cut counts, and the cut file
  //     is set aside);
  //   - a later successful save removes the copies of that file older than
  //     itself: their data is in the file now (only those exact names, only
  //     plain files - see _listOwnFiles for the plugin's own files);
  //   - a newer copy made by this panel replaces its own earlier copies of
  //     that file made while it is open: it holds everything they hold.
  var CUT_COPY_WINDOW_MS = 60 * 1000;
  var _cutByMe = {}; // file path -> stamp of the file this panel cut
  var _myCopies = {}; // file path -> the copy this panel kept last since it opened

  // This data file's own complete copies, newest first: its .unsaved-
  // copies, and with `withTemp` also its .tmp- files (left when even the
  // copy could not be written).
  function _ownCopies(fs, filePath, withTemp) {
    var slash = filePath.lastIndexOf("/");
    var dir = filePath.slice(0, slash), name = filePath.slice(slash + 1);
    var unsavedPrefix = name.replace(/\.json$/, "") + ".unsaved-", tempPrefix = name + ".tmp-";
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    var found = [];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var mine = (n.indexOf(unsavedPrefix) === 0 && OWN_UNSAVED_PATTERN.test(n)) ||
        (withTemp && n.indexOf(tempPrefix) === 0 && OWN_DATA_TEMP_PATTERN.test(n));
      if (!mine || _pathKind(fs, dir + "/" + n) !== "file") { continue; }
      try { found.push({ path: dir + "/" + n, mtime: fs.statSync(dir + "/" + n).mtimeMs }); } catch (e2) { /* gone */ }
    }
    return found.sort(function (a, b) { return b.mtime - a.mtime; });
  }
  // The newest of them made after `afterMs` that parses and passes
  // `validate`: { path, value }, or null.
  function _newestCopyAfter(fs, filePath, afterMs, withTemp, validate) {
    var found = _ownCopies(fs, filePath, withTemp);
    for (var j = 0; j < found.length; j++) {
      if (found[j].mtime <= afterMs) { break; }
      try {
        var value = JSON.parse(fs.readFileSync(found[j].path, "utf8"));
        if (validate) { validate(value); }
        return { path: found[j].path, value: value };
      } catch (e) { /* the next older one */ }
    }
    return null;
  }

  // Puts a complete copy back as the data file: renamed into place, or
  // written there and then removed when the rename is refused. If both
  // fail, the copy stays and its data is still used until the panel closes.
  function _putCopyBack(fs, filePath, copy) {
    try {
      fs.renameSync(copy.path, filePath);
      return true;
    } catch (renameErr) {
      try {
        var text = fs.readFileSync(copy.path, "utf8");
        fs.writeFileSync(filePath, text, "utf8");
        if (fs.readFileSync(filePath, "utf8") === text) {
          try { fs.unlinkSync(copy.path); } catch (e) { /* removed by the next successful save */ }
        }
        return true;
      } catch (writeErr) {
        return false;
      }
    }
  }

  // After a successful save: this file's own copies older than it.
  function _removeOlderCopies(fs, filePath) {
    var savedAt;
    try { savedAt = fs.statSync(filePath).mtimeMs; } catch (e) { return; }
    var found = _ownCopies(fs, filePath, false);
    for (var i = 0; i < found.length; i++) {
      if (found[i].mtime < savedAt) {
        try { fs.unlinkSync(found[i].path); } catch (e2) { /* tried again after the next save */ }
      }
    }
    delete _myCopies[filePath];
  }

  // Keeps the complete new text of a refused save; returns where, or null.
  function _keepCompleteCopy(fs, temp, filePath, text) {
    var kept = _moveToDatedName(fs, temp, filePath, "unsaved");
    if (!kept) {
      var target = _freeDatedName(fs, filePath, "unsaved");
      if (!target) { return null; }
      try {
        fs.writeFileSync(target, text, "utf8");
      } catch (e) {
        return null; // the .tmp- file still holds it; the sweep keeps it while the data file is cut
      }
      try { fs.unlinkSync(temp); } catch (e2) { /* the same text is in the copy */ }
      kept = target;
    }
    var earlier = _myCopies[filePath];
    if (earlier && earlier !== kept && OWN_UNSAVED_PATTERN.test(earlier.slice(earlier.lastIndexOf("/") + 1)) &&
        _pathKind(fs, earlier) === "file") {
      try { fs.unlinkSync(earlier); } catch (e3) { /* removed by the next successful save */ }
    }
    _myCopies[filePath] = kept;
    return kept;
  }

  // { existed: false } when there is no file; { existed: true, value }
  // when it parsed and passed `validate`. Throws otherwise, with
  // err.setAside (where the bad file went) or err.blocked.
  function _readJsonFile(fs, filePath, validate) {
    var stat = _statState(fs, filePath);
    if (stat.missing) {
      return { existed: false };
    }
    if (stat.error) {
      _saveBlocked[filePath] = true;
      stat.error.blocked = true;
      throw stat.error;
    }
    var raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (readErr) {
      _saveBlocked[filePath] = true;
      readErr.blocked = true;
      throw readErr;
    }
    var value;
    try {
      value = JSON.parse(raw);
      if (validate) { validate(value); }
    } catch (parseErr) {
      var cutMtime = null;
      try { cutMtime = fs.statSync(filePath).mtimeMs; } catch (e) { /* set aside below or blocked */ }
      var aside = _setAside(fs, filePath);
      // A save cut short leaves its complete copy next to it (see "A save
      // Windows refused" above): that copy is the data, and it goes back in
      // place.
      var copy = aside && cutMtime !== null ? _newestCopyAfter(fs, filePath, cutMtime - CUT_COPY_WINDOW_MS, true, validate) : null;
      if (copy) {
        if (_putCopyBack(fs, filePath, copy)) { _removeOlderCopies(fs, filePath); }
        _noteSynced(fs, filePath);
        _gen[filePath] = _generationOf(copy.value);
        return { existed: true, value: copy.value, setAside: aside, recoveredFrom: copy.path };
      }
      if (aside) {
        parseErr.setAside = aside;
      } else {
        _saveBlocked[filePath] = true;
        parseErr.blocked = true;
      }
      throw parseErr;
    }
    // A refused save may have left a newer complete copy (see "A save
    // Windows refused"): it is the data, and it goes back in place.
    var newer = _newestCopyAfter(fs, filePath, fs.statSync(filePath).mtimeMs, false, validate);
    if (newer) {
      if (_putCopyBack(fs, filePath, newer)) { _removeOlderCopies(fs, filePath); }
      _noteSynced(fs, filePath);
      _gen[filePath] = _generationOf(newer.value);
      return { existed: true, value: newer.value, recoveredFrom: newer.path };
    }
    _noteSynced(fs, filePath);
    _gen[filePath] = _generationOf(value);
    return { existed: true, value: value };
  }
  function _loadFailure(e) {
    return { ok: false, error: e.message ? e.message : String(e), setAside: e.setAside || null, blocked: !!e.blocked };
  }

  function _writeAtomic(fs, filePath, text, generation) {
    if (_saveBlocked[filePath]) {
      throw new Error("not saved: " + filePath + " could not be read when the panel started, so it is left as it is. Restart the host to try again.");
    }
    var temp = filePath + ".tmp-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    fs.writeFileSync(temp, text, "utf8");
    try {
      fs.renameSync(temp, filePath);
    } catch (renameErr) {
      // Windows can refuse to replace a file another program holds open;
      // the complete text is then written in place. If that write fails
      // too, see "A save Windows refused" above.
      var before = _stamp(fs, filePath);
      try {
        fs.writeFileSync(filePath, text, "utf8");
      } catch (writeErr) {
        var message = writeErr.message || String(writeErr);
        var after = _statState(fs, filePath);
        var kept = _keepCompleteCopy(fs, temp, filePath, text);
        if (after.stamp && after.stamp !== before) { _cutByMe[filePath] = after.stamp; }
        writeErr.message = message + (kept
          ? " - the new data is kept in " + kept + "; the next save or start puts it back"
          : " - the new data is still in " + temp + " and is read back at the next start");
        throw writeErr;
      }
      try { fs.unlinkSync(temp); } catch (e) { /* swept as a stale temp file */ }
    }
    delete _cutByMe[filePath];
    _noteSynced(fs, filePath);
    _gen[filePath] = generation;
    _removeOlderCopies(fs, filePath);
  }

  // The file's content when another host saved it since this panel last
  // read or wrote it: { changed: true, value }; else { changed: false }.
  // { deleted: true } means Delete my data ran in the other host: the file
  // this panel had seen is gone, or came back with a new generation (then
  // `value` holds the new content as well). Every other file is then read
  // again before the caller's emptied state could be saved over it.
  // { unavailable: true } means the file could not be checked (a drive or
  // cloud folder failing for a moment): the caller does not save this time,
  // and nothing counts as deleted.
  function readIfChanged(csInterface, kind) {
    var name = kind === "settings" ? SETTINGS_FILE_NAME : kind === "sound-library" ? SOUND_LIBRARY_FILE_NAME : FILE_NAME;
    try {
      var fs = window.cep_node.require("fs");
      var filePath = _getDataDir(csInterface) + "/" + name;
      var stat = _statState(fs, filePath);
      if (stat.error) {
        return { changed: false, unavailable: true };
      }
      if (stat.missing) {
        if (_synced[filePath]) {
          _resyncAll();
          delete _synced[filePath];
          return { changed: false, deleted: true };
        }
        return { changed: false };
      }
      if (stat.stamp === _synced[filePath]) {
        return { changed: false };
      }
      if (stat.stamp === _cutByMe[filePath]) {
        return { changed: false }; // the file this panel cut itself: its next save replaces it
      }
      var value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      var generation = _generationOf(value);
      var known = _gen[filePath];
      if (known !== undefined && generation !== "" && generation !== known) {
        _resyncAll();
        _synced[filePath] = stat.stamp;
        _gen[filePath] = generation;
        return { changed: true, deleted: true, value: value };
      }
      _synced[filePath] = stat.stamp;
      _gen[filePath] = generation;
      return { changed: true, value: value };
    } catch (e) {
      // Read or parse errors (another host mid-write on Windows, a damaged
      // file): not checked, so nothing is saved over it this time.
      return { changed: false, unavailable: true };
    }
  }

  // entries: the array from BeatMarkerLibrary.getAll(). `clipInfo` is
  // deliberately stripped before writing: it is the selected clip's current
  // timeline position, which can go stale between sessions. Everything else
  // (bpm, key, camelot, beatsArray, confidence, phase) is a property of the
  // audio file itself and safe to persist.
  // `meta` (optional): the track library's clear and removal times, saved
  // as one extra element with an empty mediaPath - a reader that does not
  // know it skips it.
  function save(csInterface, entries, meta) {
    try {
      if (!window.cep_node) {
        throw new Error("window.cep_node not available.");
      }
      var fs = window.cep_node.require("fs");
      var dir = _getDataDir(csInterface);
      fs.mkdirSync(dir, { recursive: true });
      var filePath = dir + "/" + FILE_NAME;
      var stripped = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        stripped.push({
          mediaPath: e.mediaPath,
          label: e.label,
          bpm: e.bpm,
          key: e.key,
          scale: e.scale,
          strength: e.strength,
          camelot: e.camelot,
          beatsArray: e.beatsArray,
          confidence: e.confidence,
          phase: e.phase,
          downbeatTimes: e.downbeatTimes || null,
          barsUnsure: typeof e.barsUnsure === "boolean" ? e.barsUnsure : null,
          fileIdentity: e.fileIdentity || null,
          detectedKey: e.detectedKey || null,
          confirmedKey: e.confirmedKey || null,
          confirmedBpm: e.confirmedBpm || null,
          intervalKeys: e.intervalKeys || [],
          material: e.material || null,
          updatedAt: e.updatedAt || null
        });
      }
      var generation = _generationForSave(fs, filePath);
      var metaOut = { generation: generation };
      for (var mk in (meta || {})) {
        if (meta.hasOwnProperty(mk) && mk !== "generation") { metaOut[mk] = meta[mk]; }
      }
      stripped.push({ mediaPath: "", downbeatLibraryMeta: metaOut });
      _writeAtomic(fs, filePath, JSON.stringify(stripped, null, 2), generation);
      return { ok: true, path: filePath, count: stripped.length };
    } catch (e) {
      return { ok: false, error: e.message ? e.message : String(e) };
    }
  }
  // Loaded entries never have `clipInfo` (see save() above). They still
  // appear in the track library display, since bpm/key/camelot are known.
  function load(csInterface) {
    try {
      if (!window.cep_node) {
        throw new Error("window.cep_node not available.");
      }
      var fs = window.cep_node.require("fs");
      var filePath = _getDataDir(csInterface) + "/" + FILE_NAME;
      var read = _readJsonFile(fs, filePath, function (value) {
        if (!Array.isArray(value)) {
          throw new Error("library.json did not contain a JSON array.");
        }
      });
      return { ok: true, entries: read.existed ? read.value : [], path: filePath, existed: read.existed,
        recoveredFrom: read.recoveredFrom || null, setAside: read.setAside || null };
    } catch (e) {
      return _loadFailure(e);
    }
  }
  // Panel-wide preferences (language, whether the onboarding tour has been
  // completed, ...) in a small separate file next to library.json. Same
  // directory and plain-JSON format as the library.
  var SETTINGS_FILE_NAME = "settings.json";
  function saveSettings(csInterface, settings) {
    try {
      if (!window.cep_node) {
        throw new Error("window.cep_node not available.");
      }
      var fs = window.cep_node.require("fs");
      var dir = _getDataDir(csInterface);
      fs.mkdirSync(dir, { recursive: true });
      var filePath = dir + "/" + SETTINGS_FILE_NAME;
      var generation = _generationForSave(fs, filePath);
      _writeAtomic(fs, filePath, JSON.stringify(_withGeneration(settings, generation), null, 2), generation);
      // Restricted to the current OS user (owner read/write only, 0600) so
      // another local account on a shared machine cannot read the file.
      // Not encrypted.
      try {
        fs.chmodSync(filePath, 0o600);
      } catch (chmodErr) {
      // Best-effort: never fail a settings save over permissions, and some
      // filesystems (network drives, FAT/exFAT mounts) have no Unix
      // permission bits.
      }
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message ? e.message : String(e) };
    }
  }
  function loadSettings(csInterface) {
    try {
      if (!window.cep_node) {
        throw new Error("window.cep_node not available.");
      }
      var fs = window.cep_node.require("fs");
      var filePath = _getDataDir(csInterface) + "/" + SETTINGS_FILE_NAME;
      var read = _readJsonFile(fs, filePath, function (value) {
        if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
          throw new Error("settings.json did not contain a JSON object.");
        }
      });
      return { ok: true, settings: (read.existed && read.value) || {}, path: filePath, existed: read.existed,
        recoveredFrom: read.recoveredFrom || null, setAside: read.setAside || null };
    } catch (e) {
      return _loadFailure(e);
    }
  }
  // The Library tab's folder libraries: which folders were added and what
  // each file analyzed to (see js/sound-library.js). Kept in its own file so
  // the timeline-clip library keeps its format. Paths of the user's audio
  // files are stored; the files themselves are never touched.
  var SOUND_LIBRARY_FILE_NAME = "sound-library.json";
  function saveSoundLibrary(csInterface, state) {
    try {
      if (!window.cep_node) {
        throw new Error("window.cep_node not available.");
      }
      var fs = window.cep_node.require("fs");
      var dir = _getDataDir(csInterface);
      fs.mkdirSync(dir, { recursive: true });
      var filePath = dir + "/" + SOUND_LIBRARY_FILE_NAME;
      var generation = _generationForSave(fs, filePath);
      _writeAtomic(fs, filePath, JSON.stringify(_withGeneration(state, generation)), generation);
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message ? e.message : String(e) };
    }
  }
  function loadSoundLibrary(csInterface) {
    try {
      if (!window.cep_node) {
        throw new Error("window.cep_node not available.");
      }
      var fs = window.cep_node.require("fs");
      var filePath = _getDataDir(csInterface) + "/" + SOUND_LIBRARY_FILE_NAME;
      var read = _readJsonFile(fs, filePath, function (value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("sound-library.json did not contain a JSON object.");
        }
      });
      return { ok: true, state: read.existed ? read.value : null, path: filePath, existed: read.existed,
        recoveredFrom: read.recoveredFrom || null, setAside: read.setAside || null };
    } catch (e) {
      return _loadFailure(e);
    }
  }
  global.BeatMarkerPersistence = {
    getDataDir: _getDataDir,
    save: save,
    load: load,
    saveSoundLibrary: saveSoundLibrary,
    loadSoundLibrary: loadSoundLibrary,
    saveSettings: saveSettings,
    loadSettings: loadSettings,
    getTempDir: getTempDir,
    clearLeftoverTempFiles: clearLeftoverTempFiles,
    readIfChanged: readIfChanged,
    listUserData: listUserData,
    deleteUserData: deleteUserData
  };
})(window);
