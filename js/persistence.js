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

  // ---- Deleting: the places this plugin removes anything it did not just
  // create itself are the startup temp sweep and the Settings "Delete my
  // data" button, plus one more below. Both use _listOwnFiles(), which
  // returns an explicit list of files that are provably this plugin's, and
  // nothing more:
  //  - only directly inside Documents/Downbeat/ and Documents/Downbeat/tmp/,
  //    never deeper, never outside;
  //  - only exact names this plugin writes: library.json, settings.json,
  //    sound-library.json, and the worker handoff files matching
  //    OWN_TEMP_FILE_PATTERN (samples-/beatthis-/skey-/library-<n>-<n>.raw,
  //    library-<n>-<n>.json);
  //  - only plain files.
  // Otherwise it refuses outright. The one more is a data file's kept copy
  // after a save Windows refused: only by the panel that holds its data and
  // has just saved it, only that exact name next to its data file, only a
  // plain file, and only while it is the file the panel read (see "A save
  // Windows refused"). The pattern must match the names the panel gives its
  // worker handoff files.
  var OWN_TEMP_FILE_PATTERN = /^((samples|beatthis|skey|library)-[0-9]+-[0-9]+\.raw|library-[0-9]+-[0-9]+\.json)$/;
  // In Documents/Downbeat itself: the new copy of a data file while it is
  // written (_writeAtomic), and the bytes of a data file that could not be
  // read (_keepUnreadable). Both are this plugin's own.
  var OWN_DATA_TEMP_PATTERN = /^(library|settings|sound-library)\.json\.tmp-[0-9]+-[0-9]+$/;
  var OWN_SET_ASIDE_PATTERN = /^(library|settings|sound-library)\.unreadable-[0-9]{8}-[0-9]{6}(-[0-9]+)?\.json$/;
  // The complete new copy of a data file whose save Windows refused
  // (_writeAtomic): never swept, taken in by every load, and removed by the
  // next successful save of a panel that took it in (see "A save Windows
  // refused").
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
  // A <name>.json.tmp-* file that parses may be the only complete copy of a
  // save Windows refused (see "A save Windows refused"): kept until a load
  // takes it in and the save after that removes it.
  function _holdsData(fs, f) {
    if (!OWN_DATA_TEMP_PATTERN.test(f.slice(f.lastIndexOf("/") + 1))) { return false; }
    try {
      JSON.parse(fs.readFileSync(f, "utf8"));
      return true;
    } catch (e) {
      return false;
    }
  }
  function clearLeftoverTempFiles(csInterface) {
    try {
      var fs = window.cep_node.require("fs");
      // Only files older than STALE_TEMP_MS: the other host may be working.
      var now = Date.now();
      var stale = _listOwnFiles(csInterface, false).files.filter(function (f) {
        try { return now - fs.lstatSync(f).mtimeMs > STALE_TEMP_MS && !_holdsData(fs, f); } catch (e) { return false; }
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
  // one. A file that is there but is not valid JSON is copied to
  // <name>.unreadable-<date>-<time>.json before anything can save over it,
  // and the caller tells the user (see "A save Windows refused" for what
  // replaces it). A file that cannot be read at all (locked, no
  // permission) is left alone, and saving over it is refused for the rest
  // of the session.
  var _saveBlocked = {}; // file path -> true
  // What each data file must hold to be read at all (a load, a kept copy).
  var VALIDATE = {
    library: function (value) {
      if (!Array.isArray(value)) { throw new Error("library.json did not contain a JSON array."); }
    },
    settings: function (value) {
      if (value !== null && (typeof value !== "object" || Array.isArray(value))) { throw new Error("settings.json did not contain a JSON object."); }
    },
    "sound-library": function (value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error("sound-library.json did not contain a JSON object."); }
    }
  };
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
    _cutByMe = {};
    _taken = {};
    _keepGeneration = {};
  }
  // After another host's Delete my data: every file this panel had synced
  // must be read again before it is saved over (it may hold the other
  // host's new data), and still counts as deleted while it is missing.
  // The panel drops what it holds, so no copy counts as taken any more.
  function _resyncAll() {
    for (var p in _synced) {
      if (_synced.hasOwnProperty(p)) { _synced[p] = "?"; }
    }
    _gen = {};
    _taken = {};
    _keepGeneration = {};
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
  // when it does not - unless the load found only kept copies of it (see
  // "A save Windows refused"): their generation goes on.
  function _generationForSave(fs, filePath) {
    var stat = _statState(fs, filePath);
    if (stat.error) {
      throw stat.error; // not saved over a file that could not be checked
    }
    if (stat.missing) {
      return _keepGeneration[filePath] && _gen[filePath] !== undefined ? _gen[filePath] : _newGeneration();
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
  // <data file>.<tag>-<date>-<time>[-n].json next to the data file.
  function _datedName(filePath, tag, n) {
    var d = new Date();
    var stamp = d.getFullYear() + _two(d.getMonth() + 1) + _two(d.getDate()) + "-" + _two(d.getHours()) + _two(d.getMinutes()) + _two(d.getSeconds());
    return filePath.replace(/\.json$/, "") + "." + tag + "-" + stamp + (n ? "-" + n : "") + ".json";
  }
  // Moves `from` to a free such name; returns the new path, or null. Only
  // for when a new file cannot be written (see _keepCompleteCopy).
  function _moveToDatedName(fs, from, filePath, tag) {
    for (var i = 0; i < 100; i++) {
      var target = _datedName(filePath, tag, i);
      if (fs.existsSync(target)) { continue; }
      try {
        fs.renameSync(from, target);
        return target;
      } catch (e) {
        return null;
      }
    }
    return null;
  }
  // Copies the file `fromFile` (when given and it can be copied) or writes
  // `text` to a new such name. The name is created exclusively, so two
  // hosts doing this in the same second never write over each other's file.
  // Returns the path, or null.
  function _writeDatedFile(fs, filePath, tag, text, fromFile) {
    for (var i = 0; i < 100; i++) {
      var target = _datedName(filePath, tag, i);
      if (fromFile) {
        try {
          fs.copyFileSync(fromFile, target, COPYFILE_EXCL);
          return target;
        } catch (copyErr) {
          if (copyErr && copyErr.code === "EEXIST") { continue; }
          // Not copied (held open, say): its text is written instead.
        }
      }
      var fd;
      try {
        fd = fs.openSync(target, "wx");
      } catch (openErr) {
        if (openErr && openErr.code === "EEXIST") { continue; }
        return null;
      }
      try {
        fs.writeFileSync(fd, text, "utf8");
        fs.closeSync(fd);
        return target;
      } catch (writeErr) {
        try { fs.closeSync(fd); } catch (e) { /* already closed */ }
        try { fs.unlinkSync(target); } catch (e2) { /* the open above created it: this plugin's own */ }
        return null;
      }
    }
    return null;
  }

  // Keeps the bytes of a data file that does not parse as
  // <name>.unreadable-<date>-<time>.json. The file itself stays where it
  // is: a moment with no data file would look like Delete my data to the
  // other host. Bytes already kept (the same file found at another start)
  // are not kept twice. Returns the kept file's path, or null.
  function _keepUnreadable(fs, filePath, raw) {
    var slash = filePath.lastIndexOf("/");
    var dir = filePath.slice(0, slash), prefix = filePath.slice(slash + 1).replace(/\.json$/, "") + ".unreadable-";
    var names = [];
    try { names = fs.readdirSync(dir); } catch (e) { /* nothing to compare with */ }
    for (var i = 0; i < names.length; i++) {
      var p = dir + "/" + names[i];
      try {
        if (names[i].indexOf(prefix) === 0 && OWN_SET_ASIDE_PATTERN.test(names[i]) && _pathKind(fs, p) === "file" &&
            fs.readFileSync(p, "utf8") === raw) {
          return p;
        }
      } catch (e2) { /* compared with the next one */ }
    }
    return _writeDatedFile(fs, filePath, "unreadable", raw, filePath);
  }

  // ---- A save Windows refused. Windows can refuse to replace a data file
  // another program holds open (OneDrive, an antivirus); the text is then
  // written in place, and that write can fail too - before anything is
  // written (the file stays whole but old) or half-way (the file is cut
  // short). Then:
  //   - the complete new text is kept next to it as
  //     <name>.unsaved-<date>-<time>.json, under a name no file had (if
  //     even that fails, its .tmp- file stays and counts the same way);
  //   - when the file was cut, this panel remembers it, so its next save may
  //     replace it: its memory holds everything the copy holds;
  //   - every load takes in all of a data file's kept copies: the newest of
  //     them and the data file is the data, and the two libraries take in
  //     the others as well (absorb), so when each host kept one, nothing is
  //     lost;
  //   - a load never writes over a data file that is whole. One that does
  //     not parse is kept aside (_keepUnreadable) and the newest kept copy
  //     is renamed over it: a rename happens or not, it cannot cut a file;
  //   - an open panel that finds a data file it cannot parse for over a
  //     minute (another host cut it and may be closed by now) does the same;
  //   - a copy is removed only after this panel saved successfully with its
  //     data in memory - a copy it kept, or one a load or check took in -
  //     by its exact name, as a plain file, and only while it is the file
  //     that was read (same time and size). Another host's temp file younger
  //     than a minute may be a save in progress and stays;
  //   - a new complete copy kept by this panel replaces those copies the
  //     same way: it holds everything they hold.
  var SETTLE_MS = 60 * 1000;
  var COPYFILE_EXCL = 1; // fs.constants.COPYFILE_EXCL: never over an existing file
  var _cutByMe = {}; // file path -> stamp of an unreadable data file this panel's next save replaces
  var _taken = {}; // file path -> [{ path, stamp, own }]: copies whose data this panel holds
  var _keepGeneration = {}; // file path -> true: no data file, so the next save keeps its copies' generation

  // Whether `path` is one of the kept copies or temp files of `filePath`.
  function _isCopyOf(filePath, path) {
    var slash = filePath.lastIndexOf("/"), pathSlash = path.lastIndexOf("/");
    if (path.slice(0, pathSlash) !== filePath.slice(0, slash)) { return false; }
    var n = path.slice(pathSlash + 1), name = filePath.slice(slash + 1);
    return (n.indexOf(name.replace(/\.json$/, "") + ".unsaved-") === 0 && OWN_UNSAVED_PATTERN.test(n)) ||
      (n.indexOf(name + ".tmp-") === 0 && OWN_DATA_TEMP_PATTERN.test(n));
  }
  function _isTempName(path) {
    return path.slice(path.lastIndexOf("/") + 1).indexOf(".tmp-") !== -1;
  }

  // This data file's kept copies and temp files that parse and pass
  // `validate`, newest first: { path, stamp, mtime, value }.
  function _validCopies(fs, filePath, validate) {
    var dir = filePath.slice(0, filePath.lastIndexOf("/"));
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    var found = [];
    for (var i = 0; i < names.length; i++) {
      var p = dir + "/" + names[i];
      try {
        if (!_isCopyOf(filePath, p) || _pathKind(fs, p) !== "file") { continue; }
        var st = fs.statSync(p);
        var value = JSON.parse(fs.readFileSync(p, "utf8"));
        if (validate) { validate(value); }
        found.push({ path: p, stamp: st.mtimeMs + ":" + st.size, mtime: st.mtimeMs, value: value });
      } catch (e2) { /* gone, or not a complete copy */ }
    }
    return found.sort(function (a, b) { return b.mtime - a.mtime; });
  }

  function _noteTaken(filePath, path, stamp, own) {
    var list = (_taken[filePath] || []).filter(function (c) { return c.path !== path; });
    list.push({ path: path, stamp: stamp, own: own });
    _taken[filePath] = list;
  }
  // Removes the copies whose data this panel holds, once that data is saved
  // (see the rules above).
  function _removeTakenCopies(fs, filePath) {
    var list = _taken[filePath] || [], left = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i], st;
      try {
        if (!_isCopyOf(filePath, c.path) || _pathKind(fs, c.path) !== "file") { continue; } // gone, or not a plain file: left alone
        st = fs.statSync(c.path);
      } catch (e) {
        continue;
      }
      if (st.mtimeMs + ":" + st.size !== c.stamp) { continue; } // changed since it was read: not this data
      if (!c.own && _isTempName(c.path) && Date.now() - st.mtimeMs < SETTLE_MS) {
        left.push(c); // maybe another host's save in progress
        continue;
      }
      try { fs.unlinkSync(c.path); } catch (e2) { left.push(c); }
    }
    _taken[filePath] = left;
  }

  // Keeps the complete new text of a refused save; returns where, or null
  // when only its .tmp- file holds it.
  function _keepCompleteCopy(fs, temp, filePath, text) {
    var kept = _writeDatedFile(fs, filePath, "unsaved", text, null);
    var tempLeft = !kept;
    if (kept) {
      try { fs.unlinkSync(temp); } catch (e) { tempLeft = true; }
    } else {
      kept = _moveToDatedName(fs, temp, filePath, "unsaved"); // no room for another file: the temp file becomes the copy
      tempLeft = !kept;
    }
    var where = kept || temp, st, whole = false;
    try {
      st = fs.statSync(where);
      whole = fs.readFileSync(where, "utf8") === text;
    } catch (e2) {
      return kept; // not read back: the copies taken before stay
    }
    if (whole) { _removeTakenCopies(fs, filePath); }
    _noteTaken(filePath, where, st.mtimeMs + ":" + st.size, true);
    if (tempLeft && kept) {
      try { var tst = fs.statSync(temp); _noteTaken(filePath, temp, tst.mtimeMs + ":" + tst.size, true); } catch (e3) { /* gone */ }
    }
    return kept;
  }

  // The data file's value (`base`: { path, value, mtime }, or null) with its
  // kept copies: the newest is the data, and the others are for the
  // libraries to take in as well (`takeIn`); settings (`newestOnly`) use the
  // newest alone. Every copy read is noted as taken. `keptCopies` lists the
  // copies whose data was used, `recoveredFrom` the first of them.
  function _combine(fs, filePath, base, copies, newestOnly, renamedFrom) {
    var all = (base ? [base] : []).concat(copies);
    all.sort(function (a, b) { return b.mtime - a.mtime || (a === base ? -1 : b === base ? 1 : 0); });
    for (var i = 0; i < copies.length; i++) { _noteTaken(filePath, copies[i].path, copies[i].stamp, false); }
    var used = (newestOnly ? all.slice(0, 1) : all).filter(function (c) { return c !== base; });
    var from = used.map(function (c) { return c.path; });
    if (renamedFrom) { from.unshift(renamedFrom); }
    _noteSynced(fs, filePath);
    _gen[filePath] = _generationOf((base || all[0]).value);
    return { existed: true, value: all[0].value, takeIn: newestOnly ? [] : all.slice(1).map(function (c) { return c.value; }),
      recoveredFrom: from.length ? from[0] : null, keptCopies: from.length ? from : null };
  }

  // A data file that does not parse (see the rules above). Returns null when
  // its bytes could not be kept (nothing may be saved over it then),
  // { setAside } when no complete copy exists (this panel's next save
  // replaces it), or what _combine returns, with setAside.
  function _recoverUnreadable(fs, filePath, stamp, raw, validate, newestOnly) {
    var aside = _keepUnreadable(fs, filePath, raw);
    if (!aside) { return null; }
    _cutByMe[filePath] = stamp;
    var copies = _validCopies(fs, filePath, validate);
    if (!copies.length) { return { setAside: aside }; }
    var base = null, renamedFrom = null, now = Date.now();
    for (var i = 0; i < copies.length; i++) {
      if (_isTempName(copies[i].path) && now - copies[i].mtime < SETTLE_MS) { continue; } // maybe a save in progress
      try {
        fs.renameSync(copies[i].path, filePath);
        delete _cutByMe[filePath];
        base = { path: filePath, value: copies[i].value, mtime: copies[i].mtime };
        renamedFrom = copies[i].path;
        copies.splice(i, 1);
      } catch (e) {
        // Refused: the unreadable file stays, and this panel's next save replaces it.
      }
      break;
    }
    var result = _combine(fs, filePath, base, copies, newestOnly, renamedFrom);
    result.setAside = aside;
    return result;
  }

  // { existed: false } when there is no file and no kept copy; else
  // { existed: true, value, takeIn, recoveredFrom, setAside } (see
  // _combine). Throws otherwise, with err.setAside (where the unreadable
  // file's bytes are kept) or err.blocked.
  function _readJsonFile(fs, filePath, validate, newestOnly) {
    var stat = _statState(fs, filePath);
    if (stat.error) {
      _saveBlocked[filePath] = true;
      stat.error.blocked = true;
      throw stat.error;
    }
    if (stat.missing) {
      // No data file, but complete copies kept by a save that failed: they
      // are the data, and the next save keeps their generation.
      var orphans = _validCopies(fs, filePath, validate);
      if (!orphans.length) {
        return { existed: false };
      }
      _keepGeneration[filePath] = true;
      return _combine(fs, filePath, null, orphans, newestOnly, null);
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
      var recovered = _recoverUnreadable(fs, filePath, stat.stamp, raw, validate, newestOnly);
      if (!recovered) {
        _saveBlocked[filePath] = true;
        parseErr.blocked = true;
        throw parseErr;
      }
      if (!recovered.existed) {
        parseErr.setAside = recovered.setAside;
        throw parseErr;
      }
      return recovered;
    }
    var copies = _validCopies(fs, filePath, validate);
    if (copies.length) {
      return _combine(fs, filePath, { path: filePath, value: value, mtime: parseFloat(stat.stamp) }, copies, newestOnly, null);
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
        writeErr.message = message + " - the new data is kept in " + (kept || temp) +
          "; the next start takes it in, and it is removed once a save works again";
        throw writeErr;
      }
      try { fs.unlinkSync(temp); } catch (e) { /* the sweep keeps it while it parses; the next load takes it in */ }
    }
    delete _cutByMe[filePath];
    delete _keepGeneration[filePath];
    _noteSynced(fs, filePath);
    _gen[filePath] = generation;
    _removeTakenCopies(fs, filePath);
  }

  // A data file this open panel cannot parse. For a minute it may be
  // another host's save in progress, so it only counts as not checked.
  // After that, a save that failed in another host (which may be closed by
  // now) cut it: it is recovered as a load would (_recoverUnreadable), and
  // the caller takes in `value` and `takeIn` and saves, which replaces it.
  function _takeOverUnreadable(fs, filePath, stamp, raw, kind) {
    if (!(Date.now() - parseFloat(stamp) >= SETTLE_MS)) {
      return { changed: false, unavailable: true };
    }
    var r = _recoverUnreadable(fs, filePath, stamp, raw, VALIDATE[kind], kind === "settings");
    if (!r) {
      return { changed: false, unavailable: true };
    }
    if (!r.existed) {
      return { changed: false, setAside: r.setAside };
    }
    return { changed: true, value: r.value, takeIn: r.takeIn, recoveredFrom: r.recoveredFrom, keptCopies: r.keptCopies, setAside: r.setAside };
  }

  // The file's content when another host saved it since this panel last
  // read or wrote it: { changed: true, value }; else { changed: false }.
  // { deleted: true } means Delete my data ran in the other host: the file
  // this panel had seen is gone, or came back with a new generation (then
  // `value` holds the new content as well). Every other file is then read
  // again before the caller's emptied state could be saved over it.
  // { unavailable: true } means the file could not be checked (a drive or
  // cloud folder failing for a moment): the caller does not save this time,
  // and nothing counts as deleted. After a recovery (_takeOverUnreadable)
  // the libraries take in `takeIn` too.
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
        return { changed: false }; // an unreadable file this panel may replace: its next save does
      }
      var raw = fs.readFileSync(filePath, "utf8");
      var value;
      try {
        value = JSON.parse(raw);
      } catch (parseErr) {
        return _takeOverUnreadable(fs, filePath, stat.stamp, raw, kind === "settings" || kind === "sound-library" ? kind : "library");
      }
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
      // Read errors (a drive or cloud folder failing for a moment): not
      // checked, so nothing is saved over it this time.
      return { changed: false, unavailable: true };
    }
  }

  // The log line for a load or a check that took in kept copies or kept an
  // unreadable data file aside; null when it did neither. `what` names the
  // file for the log ("settings.json", "The track library file").
  function recoveryNote(what, result) {
    if (!result || result.ok === false) {
      return null; // a load that failed is logged with its error
    }
    var copies = result.keptCopies ? result.keptCopies.join(", ") : result.recoveredFrom || "";
    if (result.setAside && copies) {
      return what + " could not be read (cut short by a save that failed); its bytes are kept as " + result.setAside +
        ", and the data was taken from the complete copies that save kept (" + copies + ").";
    }
    if (copies) {
      return what + ": took in the complete copies kept by a save that failed (" + copies + "); they are removed once a save works again.";
    }
    if (result.setAside) {
      return what + " could not be read; its bytes are kept as " + result.setAside + ", and this panel's next save replaces it.";
    }
    return null;
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
      var read = _readJsonFile(fs, filePath, VALIDATE.library, false);
      // takeIn: older kept copies, for BeatMarkerLibrary.absorb() after
      // loadEntries(entries) (see "A save Windows refused").
      return { ok: true, entries: read.existed ? read.value : [], takeIn: read.takeIn || [], path: filePath, existed: read.existed,
        recoveredFrom: read.recoveredFrom || null, keptCopies: read.keptCopies || null,
        setAside: read.setAside || null };
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
      var read = _readJsonFile(fs, filePath, VALIDATE.settings, true); // the newest of the file and its kept copies
      return { ok: true, settings: (read.existed && read.value) || {}, path: filePath, existed: read.existed,
        recoveredFrom: read.recoveredFrom || null, keptCopies: read.keptCopies || null,
        setAside: read.setAside || null };
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
      var read = _readJsonFile(fs, filePath, VALIDATE["sound-library"], false);
      // takeIn: older kept copies, for absorb() after loadState(state).
      return { ok: true, state: read.existed ? read.value : null, takeIn: read.takeIn || [], path: filePath, existed: read.existed,
        recoveredFrom: read.recoveredFrom || null, keptCopies: read.keptCopies || null,
        setAside: read.setAside || null };
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
    recoveryNote: recoveryNote,
    listUserData: listUserData,
    deleteUserData: deleteUserData
  };
})(window);
