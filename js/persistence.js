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
  // The start-up sweep leaves younger temp files alone: Premiere and After
  // Effects can both run Downbeat on one Documents/Downbeat, and a panel
  // starting in one must not remove files the other is still using.
  var STALE_TEMP_MS = 6 * 60 * 60 * 1000;
  function _pathKind(fs, path) {
    var stat;
    try {
      stat = fs.lstatSync(path);
    // lstat: describes a symlink itself, never what it points to
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
        continue;
      // looked at on its own below
      }
      var full = dataDir + "/" + names[i];
      var ownData = ownDataNames.indexOf(names[i]) !== -1 || OWN_SET_ASIDE_PATTERN.test(names[i]);
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
      listing.kept.push(tmpDir);
    // a tmp that is a link or a file is not ours to look into
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
  function clearLeftoverTempFiles(csInterface) {
    try {
      var fs = window.cep_node.require("fs");
      // Only files older than STALE_TEMP_MS: the other host may be working.
      var now = Date.now();
      var stale = _listOwnFiles(csInterface, false).files.filter(function (f) {
        try { return now - fs.lstatSync(f).mtimeMs > STALE_TEMP_MS; } catch (e) { return false; }
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
      _synced = {};
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

  function _stamp(fs, filePath) {
    try {
      var st = fs.statSync(filePath);
      return st.mtimeMs + ":" + st.size;
    } catch (e) {
      return null;
    }
  }
  function _noteSynced(fs, filePath) {
    var stamp = _stamp(fs, filePath);
    if (stamp) { _synced[filePath] = stamp; } else { delete _synced[filePath]; }
  }

  function _two(n) { return (n < 10 ? "0" : "") + n; }
  function _setAside(fs, filePath) {
    var d = new Date();
    var stamp = d.getFullYear() + _two(d.getMonth() + 1) + _two(d.getDate()) + "-" + _two(d.getHours()) + _two(d.getMinutes()) + _two(d.getSeconds());
    var base = filePath.replace(/\.json$/, "") + ".unreadable-" + stamp;
    for (var i = 0; i < 100; i++) {
      var target = base + (i ? "-" + i : "") + ".json";
      if (fs.existsSync(target)) {
        continue;
      }
      try {
        fs.renameSync(filePath, target);
        return target;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // { existed: false } when there is no file; { existed: true, value }
  // when it parsed and passed `validate`. Throws otherwise, with
  // err.setAside (where the bad file went) or err.blocked.
  function _readJsonFile(fs, filePath, validate) {
    if (!fs.existsSync(filePath)) {
      return { existed: false };
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
      var aside = _setAside(fs, filePath);
      if (aside) {
        parseErr.setAside = aside;
      } else {
        _saveBlocked[filePath] = true;
        parseErr.blocked = true;
      }
      throw parseErr;
    }
    _noteSynced(fs, filePath);
    return { existed: true, value: value };
  }
  function _loadFailure(e) {
    return { ok: false, error: e.message ? e.message : String(e), setAside: e.setAside || null, blocked: !!e.blocked };
  }

  function _writeAtomic(fs, filePath, text) {
    if (_saveBlocked[filePath]) {
      throw new Error("not saved: " + filePath + " could not be read when the panel started, so it is left as it is. Restart the host to try again.");
    }
    var temp = filePath + ".tmp-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    fs.writeFileSync(temp, text, "utf8");
    try {
      fs.renameSync(temp, filePath);
    } catch (renameErr) {
      // Windows can refuse to replace a file another program holds open;
      // the complete text is then written in place.
      try {
        fs.writeFileSync(filePath, text, "utf8");
      } finally {
        try { fs.unlinkSync(temp); } catch (e) { /* swept as a stale temp file */ }
      }
    }
    _noteSynced(fs, filePath);
  }

  // The file's content when another host saved it since this panel last
  // read or wrote it: { changed: true, value }; else { changed: false }.
  // Read errors count as unchanged - the next save simply writes ours.
  function readIfChanged(csInterface, kind) {
    var name = kind === "settings" ? SETTINGS_FILE_NAME : kind === "sound-library" ? SOUND_LIBRARY_FILE_NAME : FILE_NAME;
    try {
      var fs = window.cep_node.require("fs");
      var filePath = _getDataDir(csInterface) + "/" + name;
      var stamp = _stamp(fs, filePath);
      if (!stamp || stamp === _synced[filePath]) {
        return { changed: false };
      }
      var value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      _synced[filePath] = stamp;
      return { changed: true, value: value };
    } catch (e) {
      return { changed: false };
    }
  }

  // entries: the array from BeatMarkerLibrary.getAll(). `clipInfo` is
  // deliberately stripped before writing: it is the selected clip's current
  // timeline position, which can go stale between sessions. Everything else
  // (bpm, key, camelot, beatsArray, confidence, phase) is a property of the
  // audio file itself and safe to persist.
  function save(csInterface, entries) {
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
          fileIdentity: e.fileIdentity || null,
          detectedKey: e.detectedKey || null,
          confirmedKey: e.confirmedKey || null,
          confirmedBpm: e.confirmedBpm || null,
          intervalKeys: e.intervalKeys || [],
          material: e.material || null,
          updatedAt: e.updatedAt || null

        });
      }
      _writeAtomic(fs, filePath, JSON.stringify(stripped, null, 2));
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
      return { ok: true, entries: read.existed ? read.value : [], path: filePath, existed: read.existed };
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
      _writeAtomic(fs, filePath, JSON.stringify(settings, null, 2));
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
      return { ok: true, settings: (read.existed && read.value) || {}, path: filePath, existed: read.existed };
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
      _writeAtomic(fs, filePath, JSON.stringify(state));
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
      return { ok: true, state: read.existed ? read.value : null, path: filePath, existed: read.existed };
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
