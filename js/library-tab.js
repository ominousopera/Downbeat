// The Library tab: the Music and SFX sections, their folders and scan, the
// search and filters, the list, the preview pane and In key. Data and search
// live in js/sound-library.js and js/sfx-search.js, the preview's sound in
// js/lib-preview.js.
(function (global) {
  "use strict";
  // ctx - what this part needs from main.js: its shared helpers (log,
  // translations, the busy overlay, host calls, settings and library saving),
  // getters for what main.js owns and keeps changing (the active tab, the
  // current analysis and key, csInterface and the settings, which main.js
  // sets up after this part), and tempFileStarted / tempFileDone for
  // main.js's count of temp files in use (Delete my data waits on it).
  function create(ctx) {
    var I18n = ctx.I18n;
    var log = ctx.log;
    var basename = ctx.basename;
    var setTranslatedText = ctx.setTranslatedText;
    var showBusy = ctx.showBusy;
    var hideBusy = ctx.hideBusy;
    var evalJson = ctx.evalJson;
    var persistSettings = ctx.persistSettings;
    var persistLibrary = ctx.persistLibrary;
    var _formatPlayerTime = ctx.formatPlayerTime;
    var _localKeyName = ctx.localKeyName;
    var _jsxJsonArg = ctx.jsxJsonArg;
    var _jsxStringArg = ctx.jsxStringArg;
    var _resolveNodeExecutable = ctx.resolveNodeExecutable;
    // LIBRARY TAB. Data and search: js/sound-library.js. Clips analyzed on
    // the timeline (js/library.js) are listed too, in the section their key
    // material says.
    var SL = window.BeatMarkerSoundLibrary;
    var libraryDisplay = document.getElementById("libraryDisplay");
    var libSectionButtons = document.querySelectorAll(".lib-section-btn");
    var libFolderList = document.getElementById("libFolderList");
    var libAddFolderBtn = document.getElementById("libAddFolderBtn");
    var libRescanBtn = document.getElementById("libRescanBtn");
    var libScanStatus = document.getElementById("libScanStatus");
    var libSearchInput = document.getElementById("libSearchInput");
    var libSearchExpand = document.getElementById("libSearchExpand");
    var libKeySelect = document.getElementById("libKeySelect");
    var libKeyModeSelect = document.getElementById("libKeyModeSelect");
    var libBpmInput = document.getElementById("libBpmInput");
    var libBpmTolInput = document.getElementById("libBpmTolInput");
    var libHalfDoubleCheckbox = document.getElementById("libHalfDoubleCheckbox");
    var libBpmRow = document.getElementById("libBpmRow"); // Music only
    var libMatchClipBtn = document.getElementById("libMatchClipBtn");
    var libResetFiltersBtn = document.getElementById("libResetFiltersBtn");
    var libResultCount = document.getElementById("libResultCount");
    var libPreviewAudio = document.getElementById("libPreviewAudio");
    var LIB_MAX_ROWS = 300; // more rows than this makes the panel sluggish; the count says how many matched
    // With a key chosen the user wants every match, not just the first 300: a
    // key already narrows a large library to a manageable list, so the list
    // goes up to this, added in one fragment.
    var LIB_MAX_ROWS_WITH_KEY = 3000;
    // Navigation: sort, favorites, pitched sounds only, "Show N more", and a
    // keyboard / click selection.
    var libSortSelect = document.getElementById("libSortSelect");
    var libFavOnlyCheckbox = document.getElementById("libFavOnlyCheckbox");
    var libPitchedOnlyCheckbox = document.getElementById("libPitchedOnlyCheckbox");
    var libPitchedOnlyLabel = document.getElementById("libPitchedOnlyLabel");
    var LIB_MORE_STEP = 300;
    var libExtraRows = 0; // added by "Show N more"; any filter change resets it
    var libSelectedPath = null;
    var _libShown = []; // [{ item, row, play }] in list order
    var _libMatches = [];
    var _libItemCount = 0;
    var libSection = "music";
    var libScan = { running: false, stop: false, section: null, done: 0, total: 0, failed: 0, fromName: 0 };
    var libPlayingPath = null;
    var _libPersistTimer = null;
    function loadSoundLibrary() {
      var loaded = window.BeatMarkerPersistence.loadSoundLibrary(ctx.csInterface());
      if (loaded.ok) {
        SL.loadState(loaded.state);
      } else {
        log("WARNING: could not read the folder library (" + loaded.error + ") - starting empty.");
      }
      if (ctx.initialSettings().librarySection === "sfx" || ctx.initialSettings().librarySection === "music") {
        libSection = ctx.initialSettings().librarySection;
      }
      if (typeof ctx.initialSettings().libraryFoldersOpen === "boolean") {
        libFoldersOpen = ctx.initialSettings().libraryFoldersOpen;
      }
      renderLibraryKeySelect();
      renderLibrarySortSelect();
      renderLibrary();
    }

    // File and folder dialogs. CEP's own dialog first: it is parented to
    // Premiere, so on Windows it opens in front and does not tie up the
    // host script engine (the ExtendScript dialog opened behind Premiere
    // there, and every host call stalled until it was found and closed).
    // The ExtendScript dialog stays as the fallback when CEP's is missing.
    // Both resolve like the host functions: { directory } / { path },
    // null when cancelled.
    function _nativeFs() {
      return (window.cep && window.cep.fs && typeof window.cep.fs.showOpenDialogEx === "function") ? window.cep.fs : null;
    }
    function _pickFolderDialog() {
      var nativeFs = _nativeFs();
      if (nativeFs) {
        var res = nativeFs.showOpenDialogEx(false, true, I18n.t("library.folderPick"), "");
        if (res && res.err === 0) {
          return Promise.resolve({ directory: res.data && res.data.length ? res.data[0] : null });
        }
      }
      return evalJson("pickFolder()");
    }
    function _pickOpenFileDialog(title) {
      var nativeFs = _nativeFs();
      if (nativeFs) {
        var res = nativeFs.showOpenDialogEx(false, false, title, "");
        if (res && res.err === 0) {
          return Promise.resolve({ path: res.data && res.data.length ? res.data[0] : null });
        }
      }
      return evalJson("pickOpenFile(" + _jsxStringArg(title) + ")");
    }
    function _pickSaveFileDialog(suggestedName, title) {
      var nativeFs = _nativeFs();
      if (nativeFs && typeof nativeFs.showSaveDialogEx === "function") {
        var res = nativeFs.showSaveDialogEx(title, "", ["json"], suggestedName);
        if (res && res.err === 0) {
          return Promise.resolve({ path: res.data || null });
        }
      }
      return evalJson("pickSaveFile(" + _jsxStringArg(suggestedName) + ", " + _jsxStringArg(title) + ")");
    }

    function persistSoundLibrary() {
      var result = window.BeatMarkerPersistence.saveSoundLibrary(ctx.csInterface(), SL.getState());
      if (!result.ok) {
        log("WARNING: could not save the folder library to disk: " + result.error);
      }
    }
    // During a scan results arrive every second or two; one write per few
    // seconds is plenty and keeps a big library from being rewritten nonstop.
    function _persistSoundLibrarySoon() {
      if (_libPersistTimer) {
        return;
      }
      _libPersistTimer = setTimeout(function () {
        _libPersistTimer = null;
        persistSoundLibrary();
      }, 3000);
    }
    // Timeline-analyzed clips shown in a section, unless a folder already
    // lists the same file.
    function _libTimelineItems(section) {
      var folderFiles = SL.getState().files;
      var out = [];
      var all = window.BeatMarkerLibrary.getAll();
      for (var i = 0; i < all.length; i++) {
        var e = all[i];
        if ((e.material === "sfx" ? "sfx" : "music") !== section || folderFiles[e.mediaPath]) {
          continue;
        }
        if (!e.bpm && !e.camelot) {
          continue;
        }
        out.push({ path: e.mediaPath, name: e.label, bpm: e.bpm || null, camelot: e.camelot || null,
                   key: e.key || null, scale: e.scale || null, status: "done", fromTimeline: true });
      }
      return out;
    }

    function _libCriteria() {
      return {
        text: libSearchInput.value,
        camelot: libKeySelect.value || null,
        keyMode: libKeyModeSelect.value,
        bpm: libSection === "sfx" ? "" : libBpmInput.value, // no tempo filter for sound effects
        tolPct: libBpmTolInput.value,
        halfDouble: libHalfDoubleCheckbox.checked,
        sort: libSortSelect.value || "best",
        favOnly: libFavOnlyCheckbox.checked,
        pitchedOnly: libSection === "sfx" && libPitchedOnlyCheckbox.checked
      };
    }
    // "best" keeps SL.search's order (exact key, closest tempo, name).
    function _libSort(list, how) {
      var last = 1e12; // no value sorts after every real one
      function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }
      if (how === "name") {
        return list.slice().sort(byName);
      }
      if (how === "length") {
        return list.slice().sort(function (a, b) { return ((a.durationSec || last) - (b.durationSec || last)) || byName(a, b); });
      }
      if (how === "bpm") {
        return list.slice().sort(function (a, b) { return ((_libShownBpm(a) || last) - (_libShownBpm(b) || last)) || byName(a, b); });
      }
      return list;
    }
    // The tempo a row shows and sorts by. A sound effect shows only a
    // tempo written in its name: a detected tempo is unreliable for one.
    function _libShownBpm(item) {
      if (!(item.bpm > 0)) {
        return null;
      }
      if (item.section === "sfx" && item.bpmFrom !== "name") {
        return null;
      }
      return item.bpm;
    }

    function _libFileUrl(path) {
      var p = String(path).replace(/\\/g, "/");
      if (/^[A-Za-z]:\//.test(p)) {
        p = "/" + p;
      }
      return "file://" + p.split("/").map(function (seg, i) {
        return (i === 1 && /^[A-Za-z]:$/.test(seg)) ? seg : encodeURIComponent(seg);
      }).join("/");
    }
    // The folder list folds into one "Folders (9)" line. Until the user opens
    // or closes it, it is open for up to 3 folders and folded beyond; after
    // that their choice is kept (settings.libraryFoldersOpen).
    var libFoldersToggleBtn = document.getElementById("libFoldersToggleBtn");
    var libFoldersOpen = null; // null = automatic, see above
    function _libFoldersShown(count) {
      return libFoldersOpen === null ? count <= 3 : libFoldersOpen;
    }
    libFoldersToggleBtn.addEventListener("click", function () {
      libFoldersOpen = !_libFoldersShown(SL.getFolders(libSection).length);
      persistSettings({ libraryFoldersOpen: libFoldersOpen });
      renderLibraryFolders();
    });
    // FOLDER BROWSER: the folder list is a tree - each added folder, its
    // subfolders (▸ / ▾), file counts. The square at the left of a row puts
    // that folder in the search scope; several can be on, and with any on
    // only their files are listed (none on = every folder). A click on a name
    // shows just that folder.
    var _libScope = { music: [], sfx: [] };
    var _libTreeOpen = {};
    function _libScopeList() {
      return (_libScope[libSection] || []).slice();
    }
    function _libSetScope(list) {
      _libScope[libSection] = list;
      persistSettings({ libraryFolderScope: _libScope });
      renderLibrary();
    }
    function _libInScope(path, scope) {
      for (var i = 0; i < scope.length; i++) {
        if (path.indexOf(scope[i] + "/") === 0) {
          return true;
        }
      }
      return false;
    }

    function renderLibraryFolders() {
      libFolderList.textContent = "";
      var folders = SL.getFolders(libSection);
      if (folders.length === 0) {
        libFoldersToggleBtn.hidden = true;
        var none = document.createElement("div");
        none.className = "hint";
        setTranslatedText(none, libSection === "sfx" ? "library.noFoldersSfx" : "library.noFoldersMusic");
        libFolderList.appendChild(none);
        return;
      }
      var scope = _libScopeList();
      var open = _libFoldersShown(folders.length);
      libFoldersToggleBtn.hidden = false;
      if (scope.length) {
        setTranslatedText(libFoldersToggleBtn, open ? "library.foldersOpenScoped" : "library.foldersClosedScoped", {
          count: folders.length,
          scope: scope.length === 1 ? basename(scope[0]) : I18n.t("library.foldersScoped", { count: scope.length })
        });
      } else {
        setTranslatedText(libFoldersToggleBtn, open ? "library.foldersOpen" : "library.foldersClosed", { count: folders.length });
      }
      if (!open) {
        return;
      }
      libFolderList.appendChild(_libTreeRow({ path: null, name: I18n.t("library.foldersAll"), count: SL.sectionItems(libSection).length, children: [] }, 0, scope, false));
      SL.folderTree(libSection).forEach(function (n) { _libTreeAdd(n, 0, scope, true); });
    }
    function _libTreeAdd(node, depth, scope, isRoot) {
      libFolderList.appendChild(_libTreeRow(node, depth, scope, isRoot));
      if (node.children.length && _libTreeOpen[node.path]) {
        node.children.forEach(function (c) { _libTreeAdd(c, depth + 1, scope, false); });
      }
    }
    function _libTreeRow(node, depth, scope, isRoot) {
      var row = document.createElement("div");
      var isAll = node.path === null;
      var on = isAll ? scope.length === 0 : scope.indexOf(node.path) !== -1;
      row.className = "lib-tree-row" + (isAll ? " is-all" : "") + (on ? " is-scoped" : "") + (!isAll && !on && _libInScope(node.path, scope) ? " is-inside" : "");
      row.style.paddingLeft = (4 + depth * 14) + "px";
      if (!isAll) {
        var mark = document.createElement("button");
        mark.type = "button";
        mark.className = "lib-tree-scope" + (on ? " is-on" : "");
        mark.setAttribute("aria-pressed", on ? "true" : "false");
        mark.title = I18n.t("library.folderScopeTitle");
        mark.addEventListener("click", function (evt) {
          if (evt && evt.stopPropagation) { evt.stopPropagation(); }
          var list = _libScopeList();
          var i = list.indexOf(node.path);
          if (i === -1) { list.push(node.path); } else { list.splice(i, 1); }
          _libSetScope(list);
        });
        row.appendChild(mark);
      }
      var chev = document.createElement("button");
      chev.type = "button";
      chev.className = "lib-tree-chev";
      chev.textContent = node.children.length ? (_libTreeOpen[node.path] ? "\u25BE" : "\u25B8") : "";
      chev.disabled = !node.children.length;
      chev.addEventListener("click", function (evt) {
        if (evt && evt.stopPropagation) { evt.stopPropagation(); }
        _libTreeOpen[node.path] = !_libTreeOpen[node.path];
        renderLibraryFolders();
      });
      row.appendChild(chev);
      var name = document.createElement("span");
      name.className = "lib-tree-name";
      name.textContent = node.name;
      name.title = isAll ? "" : node.path + " - " + I18n.t("library.folderOnlyTitle");
      if (isRoot && !_libFileThere(node.path)) {
        // An added folder that is not there now: its sounds stay listed,
        // marked not found, until it is back.
        row.classList.add("is-missing");
        name.textContent = node.name + " \u2014 " + I18n.t("library.folderMissing");
        name.title = node.path + " - " + I18n.t("library.folderMissingTitle");
      }
      name.addEventListener("click", function () {
        if (isAll) {
          _libSetScope([]);
          return;
        }
        var list = _libScopeList();
        _libSetScope(list.length === 1 && list[0] === node.path ? [] : [node.path]);
      });
      row.appendChild(name);
      var count = document.createElement("span");
      count.className = "lib-tree-count";
      count.textContent = String(node.count);
      row.appendChild(count);
      if (isRoot) {
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ghost lib-folder-remove";
        remove.textContent = "×";
        remove.title = I18n.t("library.removeFolder");
        remove.addEventListener("click", function (evt) {
          if (evt && evt.stopPropagation) { evt.stopPropagation(); }
          if (libScan.running) {
            return;
          }
          SL.removeFolder(libSection, node.path);
          _libScope[libSection] = _libScopeList().filter(function (p) { return p !== node.path && p.indexOf(node.path + "/") !== 0; });
          persistSettings({ libraryFolderScope: _libScope });
          persistSoundLibrary();
          renderLibrary();
        });
        row.appendChild(remove);
      }
      return row;
    }
    // Is the file still where the library says? Asked for the rows on screen,
    // so a moved or deleted file, or one on a drive that is not connected,
    // shows as not found instead of failing when played or inserted. Answers
    // are kept for 3 s: a list repaint asks for up to a few hundred files.
    var _libExistsCache = {};
    var _libExistsAt = 0;
    function _libFileThere(path, fresh) {
      var now = Date.now();
      if (fresh || now - _libExistsAt > 3000) {
        _libExistsCache = {};
        _libExistsAt = now;
      }
      if (!Object.prototype.hasOwnProperty.call(_libExistsCache, path)) {
        try {
          _libExistsCache[path] = window.cep_node.require("fs").existsSync(path);
        } catch (e) {
          _libExistsCache[path] = true; // cannot tell - let the host decide
        }
      }
      return _libExistsCache[path];
    }
    // Says so when a file is not there any more, and repaints its row.
    function _libMissing(path) {
      if (_libFileThere(path, true)) {
        return false;
      }
      setTranslatedText(libScanStatus, "library.missingFile", { name: basename(path) });
      log("Library: " + path + " is not there now (moved, deleted, or on a drive that is not connected).");
      renderLibrary(true);
      return true;
    }

    function _libRow(item) {
      var row = document.createElement("div");
      row.className = "lib-row" + (libPlayingPath === item.path ? " is-playing" : "") + (libSelectedPath === item.path ? " is-selected" : "");
      var play = document.createElement("button");
      play.type = "button";
      play.className = "ghost lib-play";
      play.textContent = libPlayingPath === item.path ? "‖" : "▶";
      play.title = I18n.t("library.listen");
      play.addEventListener("click", function (evt) {
        evt.stopPropagation();
        _libBlur(play);
        _libSelect(item.path, false);
        _libTogglePreview(item.path);
      });
      var main = document.createElement("div");
      main.className = "lib-row-main";
      var name = document.createElement("div");
      name.className = "lib-row-name";
      name.textContent = item.name;
      name.title = item.path;
      var meta = document.createElement("div");
      meta.className = "lib-row-meta";
      var parts = [];
      var keyPart = -1; // index of the key in parts, if any
      var missing = !_libFileThere(item.path);
      if (missing) {
        row.classList.add("is-missing");
        meta.classList.add("is-error");
        meta.title = I18n.t("library.missingTitle");
        parts.push(I18n.t("library.missing"));
      }
      if (item.status === "pending") {
        parts.push(I18n.t("library.waiting"));
      } else if (item.status === "error") {
        meta.classList.add("is-error");
        parts.push(I18n.t("library.unreadable"));
        meta.title = item.error || "";
      } else {
        if (item.durationSec) {
          parts.push(_formatPlayerTime(item.durationSec));
        }
        var bpm = _libShownBpm(item);
        if (bpm) {
          parts.push(bpm.toFixed(1) + " BPM");
        }
        if (item.camelot && !SL.hasPitch(item)) {
          parts.push(I18n.t("library.noPitch")); // a sound with no pitch: its detected "key" is noise
        } else if (item.camelot) {
          keyPart = parts.length;
          var friendly = window.BeatMarkerCamelot.fromCamelotCode(item.camelot);
          parts.push(item.camelot + (friendly ? " " + _localKeyName(friendly.key, friendly.scale) : ""));
        }
        if (item.keyFrom === "name" || item.bpmFrom === "name") {
          parts.push(I18n.t("library.fromName"));
        }
        if (item.fromTimeline) {
          parts.push(I18n.t("library.fromTimeline"));
        }
      }
      meta.textContent = "";
      parts.forEach(function (text, k) {
        if (k > 0) {
          var sep = document.createElement("span");
          sep.textContent = "  ·  ";
          meta.appendChild(sep);
        }
        var part = document.createElement("span");
        if (k === keyPart) {
          part.className = "lib-row-key";
        }
        part.textContent = text;
        meta.appendChild(part);
      });
      main.appendChild(name);
      main.appendChild(meta);
      var insert = document.createElement("button");
      insert.type = "button";
      insert.className = "ghost lib-insert";
      setTranslatedText(insert, "library.insert");
      insert.title = I18n.t("library.insertTitle");
      insert.addEventListener("click", function (evt) {
        evt.stopPropagation();
        _libBlur(insert);
        _libSelect(item.path, false);
        _libInsert(item);
      });
      row.addEventListener("click", function () {
        _libSelect(item.path, false);
        _libFocusKeys();
      });
      row.addEventListener("dblclick", function () { _libInsert(item); });
      if (missing) {
        play.disabled = true;
        insert.disabled = true;
      }
      row.appendChild(play);
      row.appendChild(main);
      if (!item.fromTimeline) {
        var fav = document.createElement("button");
        fav.type = "button";
        fav.className = "ghost lib-fav" + (item.fav ? " is-on" : ""); // the star is drawn by CSS
        fav.setAttribute("aria-pressed", item.fav ? "true" : "false");
        fav.title = I18n.t(item.fav ? "library.favRemove" : "library.favAdd");
        fav.addEventListener("click", function (evt) {
          evt.stopPropagation();
          _libBlur(fav);
          _libToggleFavorite(item, fav);
        });
        row.appendChild(fav);
      }
      row.appendChild(insert);
      _libShown.push({ item: item, row: row, play: play });
      return row;
    }
    // Premiere sends ↑ ↓ / Space / Enter to its own timeline unless a text
    // field in the panel has the keyboard focus. So a click in the list moves
    // the focus into an invisible field (#libKeyCatcher), and the keys then
    // reach the list's handling below. A clicked row button also gives its
    // focus to it, so Space does not press that button again.
    var libKeyCatcher = document.getElementById("libKeyCatcher");
    function _libFocusKeys() {
      if (libKeyCatcher && typeof libKeyCatcher.focus === "function") {
        try {
          libKeyCatcher.focus({ preventScroll: true });
        } catch (focusErr) {
          libKeyCatcher.focus();
        }
      }
    }
    if (libKeyCatcher) {
      libKeyCatcher.addEventListener("input", function () { libKeyCatcher.value = ""; });
    }
    // Any click on the Library tab (except into a field where one types), and
    // the panel getting the focus back, put the focus on the catcher again.
    function _libIsTypingField(t) {
      var tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      if (tag === "textarea" || tag === "select") {
        return true;
      }
      return tag === "input" && /^(text|number|search|password|email|url)$/i.test(t.type || "text") && t !== libKeyCatcher;
    }
    document.addEventListener("click", function (evt) {
      if (ctx.activeTabId() !== "library" || _libIsTypingField(evt && evt.target)) {
        return;
      }
      var tab = document.getElementById("tabContentLibrary");
      if (tab && typeof tab.contains === "function" && evt && evt.target && !tab.contains(evt.target)) {
        return; // Settings, dialogs: not the list's business
      }
      setTimeout(function () { _libFocusKeys(); }, 0);
    });
    window.addEventListener("focus", function () {
      if (ctx.activeTabId() === "library" && !_libIsTypingField(document.activeElement)) {
        _libFocusKeys();
      }
    });
    function _libBlur(el) {
      if (el && typeof el.blur === "function") {
        el.blur();
      }
      _libFocusKeys();
    }

    function _libToggleFavorite(item, btn) {
      var on = !item.fav;
      if (!SL.setFavorite(item.path, on)) {
        return;
      }
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.title = I18n.t(on ? "library.favRemove" : "library.favAdd");
      _persistSoundLibrarySoon();
      if (libFavOnlyCheckbox.checked && !on) {
        renderLibrary(true);
      }
    }
    // Playing / selected marks on the rows already shown - no rebuild, so the
    // scroll position and a long list stay put.
    function _libUpdateRowStates() {
      for (var i = 0; i < _libShown.length; i++) {
        var e = _libShown[i];
        var playing = libPlayingPath === e.item.path;
        e.row.classList.toggle("is-playing", playing);
        e.row.classList.toggle("is-selected", libSelectedPath === e.item.path);
        e.play.textContent = playing ? "‖" : "▶";
      }
    }

    function _libShownIndex(path) {
      for (var i = 0; i < _libShown.length; i++) {
        if (_libShown[i].item.path === path) {
          return i;
        }
      }
      return -1;
    }

    function _libSelect(path, scroll) {
      libSelectedPath = path;
      _libUpdateRowStates();
      _libPaneSelect(path);
      var i = _libShownIndex(path);
      if (scroll && i >= 0 && typeof _libShown[i].row.scrollIntoView === "function") {
        _libShown[i].row.scrollIntoView({ block: "nearest" });
      }
    }
    // ↑ / ↓. While something is playing, the newly chosen file plays instead,
    // so a list can be auditioned with the arrows alone.
    function _libMoveSelection(delta) {
      if (_libShown.length === 0) {
        return;
      }
      var i = _libShownIndex(libSelectedPath);
      var next = i === -1 ? (delta > 0 ? 0 : _libShown.length - 1) : Math.max(0, Math.min(_libShown.length - 1, i + delta));
      var path = _libShown[next].item.path;
      var wasPlaying = !!libPlayingPath;
      _libSelect(path, true);
      if (wasPlaying && libPlayingPath !== path) {
        _libTogglePreview(path);
      }
    }
    // The section's files plus its timeline clips, and those passing the
    // filters, best match first.
    function _libCurrentMatches() {
      var items = SL.sectionItems(libSection).concat(_libTimelineItems(libSection));
      var criteria = _libCriteria();
      var filtering = !!(String(criteria.text).trim() || criteria.camelot || parseFloat(criteria.bpm) > 0);
      // A SFX without a trustworthy tempo drops out of a BPM search.
      var searchable = items.map(function (it) {
        var copy = {};
        for (var k in it) { if (it.hasOwnProperty(k)) { copy[k] = it[k]; } }
        copy.bpm = _libShownBpm(it);
        copy._source = it;
        return copy;
      });
      var matches = SL.search(searchable, criteria).map(function (c) { return c._source; });
      if (filtering) {
        matches = matches.filter(function (it) { return it.status === "done"; });
      }
      if (criteria.favOnly) {
        matches = matches.filter(function (it) { return !!it.fav; });
      }
      if (criteria.pitchedOnly) {
        matches = matches.filter(function (it) { return it.status === "done" && !!it.camelot && SL.hasPitch(it); });
      }
      var scope = _libScopeList();
      if (scope.length) {
        matches = matches.filter(function (it) { return !it.fromTimeline && _libInScope(it.path, scope); });
      }
      return { items: items, matches: _libSort(matches, criteria.sort) };
    }
    // Next to the search field: the other words the search also looks for
    // ("+ uplifter, swell" for "riser"; js/sfx-search.js's thesaurus and UCS
    // names). The first three are shown.
    var libSynToggle = document.getElementById("libSynToggle");
    function _libShowSearchExpansions() {
      var words = [];
      var text = libSearchInput.value;
      var synOn = !window.BeatMarkerSfxSearch || window.BeatMarkerSfxSearch.synonymsOn();
      if (window.BeatMarkerSfxSearch && text && text.trim()) {
        window.BeatMarkerSfxSearch.compile(text).include.forEach(function (t) {
          t.expand.forEach(function (w) {
            if (words.indexOf(w) === -1) {
              words.push(w);
            }
          });
        });
      }
      libSearchExpand.textContent = words.length ? "+ " + words.slice(0, 3).join(", ") : "";
      // ✕ next to the synonyms turns them off; with them off, a typed search
      // offers "+ synonyms" to bring them back.
      var hasText = !!(text && text.trim());
      libSynToggle.hidden = !(synOn ? words.length : hasText);
      libSynToggle.textContent = synOn ? "\u2715" : I18n.t("library.synOn");
      libSynToggle.title = I18n.t(synOn ? "library.synOffTitle" : "library.synOnTitle");
      libSynToggle.classList.toggle("is-off", !synOn);
    }
    libSynToggle.addEventListener("click", function () {
      var on = !window.BeatMarkerSfxSearch.synonymsOn();
      window.BeatMarkerSfxSearch.setSynonyms(on);
      persistSettings({ librarySynonyms: on });
      renderLibrary();
      _libShowSearchExpansions();
    });

    // Re-filters and repaints the list. keepRows: leave "Show N more" as it
    // is; every other call starts from the first page.
    function renderLibrary(keepRows) {
      if (keepRows !== true) {
        libExtraRows = 0;
      }
      if (typeof _libUpdateMatchState === "function") {
        _libUpdateMatchState();
      }
      _libShowSearchExpansions();
      libPitchedOnlyLabel.hidden = libSection !== "sfx";
      libBpmRow.hidden = libSection === "sfx";
      for (var b = 0; b < libSectionButtons.length; b++) {
        libSectionButtons[b].classList.toggle("is-active", libSectionButtons[b].getAttribute("data-section") === libSection);
      }
      renderLibraryFolders();
      libRescanBtn.hidden = libScan.running || SL.getFolders(libSection).length === 0;
      var waiting = SL.counts(libSection).pending + SL.outdatedCount(libSection); // outdated: analyzed by an older method, redone by Start scan
      setTranslatedText(libRescanBtn, waiting > 0 ? "library.rescanCount" : "library.rescan", { count: waiting });
      libRescanBtn.classList.toggle("primary", waiting > 0);
      libRescanBtn.classList.toggle("ghost", waiting === 0);
      libAddFolderBtn.disabled = libScan.running;

      var current = _libCurrentMatches();
      var items = current.items;
      var matches = current.matches;
      _libMatches = matches;
      _libItemCount = items.length;
      _libShown = [];

      libraryDisplay.textContent = "";
      if (items.length === 0) {
        libraryDisplay.classList.add("is-empty");
        setTranslatedText(libResultCount, "library.countNone");
        setTranslatedText(libraryDisplay, libSection === "sfx" ? "library.emptySfx" : "library.emptyMusic");
        return;
      }
      if (matches.length === 0) {
        libraryDisplay.classList.add("is-empty");
        setTranslatedText(libResultCount, "library.count", { shown: 0, total: items.length });
        setTranslatedText(libraryDisplay, "library.noResults");
        return;
      }
      libraryDisplay.classList.remove("is-empty");
      _libAppendRows();
    }

    function _libMaxRows() {
      return (_libCriteria().camelot ? LIB_MAX_ROWS_WITH_KEY : LIB_MAX_ROWS) + libExtraRows;
    }
    // Adds the rows from _libShown.length up to the current limit, then the
    // count and, while matches remain, a "Show N more" button.
    function _libAppendRows() {
      var maxRows = _libMaxRows();
      var rowsFragment = document.createDocumentFragment();
      for (var i = _libShown.length; i < _libMatches.length && i < maxRows; i++) {
        rowsFragment.appendChild(_libRow(_libMatches[i]));
      }
      libraryDisplay.appendChild(rowsFragment);
      setTranslatedText(libResultCount, _libMatches.length > _libShown.length ? "library.countCapped" : "library.count",
        { shown: _libShown.length, matched: _libMatches.length, total: _libItemCount });
      var remaining = _libMatches.length - _libShown.length;
      if (remaining > 0) {
        var more = document.createElement("button");
        more.type = "button";
        more.className = "ghost lib-show-more";
        more.textContent = I18n.t("library.showMore", { n: Math.min(LIB_MORE_STEP, remaining) });
        more.addEventListener("click", function () {
          libraryDisplay.removeChild(more);
          libExtraRows += LIB_MORE_STEP;
          _libAppendRows();
        });
        libraryDisplay.appendChild(more);
      }
    }
    // BPM sorting is offered for music only: a sound effect shows a tempo
    // only when its file name gives one.
    function renderLibrarySortSelect() {
      var current = libSortSelect.value || "best";
      libSortSelect.textContent = "";
      var choices = ["best", "name", "length"];
      if (libSection === "music") {
        choices.push("bpm");
      }
      choices.forEach(function (value) {
        var opt = document.createElement("option");
        opt.value = value;
        opt.textContent = I18n.t({ best: "library.sortBest", name: "library.sortName", length: "library.sortLength", bpm: "library.sortBpm" }[value]);
        libSortSelect.appendChild(opt);
      });
      libSortSelect.value = choices.indexOf(current) !== -1 ? current : "best";
    }

    function renderLibraryKeySelect() {
      var current = libKeySelect.value;
      libKeySelect.textContent = "";
      var any = document.createElement("option");
      any.value = "";
      any.textContent = I18n.t("library.keyAny");
      libKeySelect.appendChild(any);
      for (var n = 1; n <= 12; n++) {
        ["A", "B"].forEach(function (letter) {
          var code = n + letter;
          var friendly = window.BeatMarkerCamelot.fromCamelotCode(code);
          var opt = document.createElement("option");
          opt.value = code;
          opt.textContent = code + (friendly ? " — " + _localKeyName(friendly.key, friendly.scale) : "");
          libKeySelect.appendChild(opt);
        });
      }
      libKeySelect.value = current || "";
    }

    function _libSetSection(section) {
      libSection = section;
      persistSettings({ librarySection: section });
      libSelectedPath = null;
      renderLibrarySortSelect();
      renderLibrary();
    }
    for (var lsb = 0; lsb < libSectionButtons.length; lsb++) {
      libSectionButtons[lsb].addEventListener("click", function () {
        _libSetSection(this.getAttribute("data-section"));
      });
    }
    [libBpmInput, libBpmTolInput].forEach(function (el) {
      el.addEventListener("input", function () { renderLibrary(); });
    });
    var _libSearchTimer = null;
    libSearchInput.addEventListener("input", function () {
      clearTimeout(_libSearchTimer);
      if (_libItemCount > 3000) {
        _libSearchTimer = setTimeout(function () { renderLibrary(); }, 150);
      } else {
        renderLibrary();
      }
    });
    [libKeySelect, libKeyModeSelect, libHalfDoubleCheckbox, libSortSelect, libFavOnlyCheckbox, libPitchedOnlyCheckbox].forEach(function (el) {
      el.addEventListener("change", function () { renderLibrary(); });
    });
    // "Match the current clip": the key and tempo of whatever was last
    // analyzed or key-detected on the timeline, as the filter. Match clip
    // works as a switch: on while the key / BPM filters still hold what it
    // put there; a second click clears them; changing either by hand turns it
    // off.
    var _libMatched = null; // { camelot, bpm } as Match clip set them
    function _libUpdateMatchState() {
      var on = !!_libMatched && libKeySelect.value === _libMatched.camelot &&
        libKeyModeSelect.value === "compatible" && libBpmInput.value === _libMatched.bpm;
      if (!on) {
        _libMatched = null;
      }
      libMatchClipBtn.classList.toggle("is-active", on);
      libMatchClipBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    // The key of the music clip on the timeline: what Detect key or Analyze
    // last found for it (the same source as Match clip and In key).
    function _libClipCamelot() {
      var entry = ctx.lastAnalysis() && ctx.lastAnalysis().audioPath ? window.BeatMarkerLibrary.get(ctx.lastAnalysis().audioPath) : null;
      return (ctx.lastKeyResult() && ctx.lastKeyResult().camelot) || (entry && entry.camelot) || null;
    }
    libMatchClipBtn.addEventListener("click", function () {
      if (_libMatched) {
        libKeySelect.value = "";
        libKeyModeSelect.value = "exact";
        libBpmInput.value = "";
        _libMatched = null;
        renderLibrary();
        return;
      }
      var entry = ctx.lastAnalysis() && ctx.lastAnalysis().audioPath ? window.BeatMarkerLibrary.get(ctx.lastAnalysis().audioPath) : null;
      var camelot = _libClipCamelot();
      var bpm = (entry && entry.bpm) || (ctx.lastAnalysis() ? parseFloat(ctx.bpmDisplay().textContent) : null) || null;
      if (!camelot && !bpm) {
        setTranslatedText(libScanStatus, "library.matchClipNone");
        return;
      }
      libKeySelect.value = camelot || "";
      libKeyModeSelect.value = "compatible";
      libBpmInput.value = bpm ? bpm.toFixed(1) : "";
      _libMatched = { camelot: libKeySelect.value, bpm: libBpmInput.value };
      renderLibrary();
      // What it took and from where, for the log.
      var keySource = ctx.lastKeyResult() && ctx.lastKeyResult().camelot ? "Detect key" : "the analysis";
      var keyFile = basename((ctx.lastKeyResult() && ctx.lastKeyResult().mediaPath) || (ctx.lastAnalysis() && ctx.lastAnalysis().audioPath) || "");
      log("Match clip: key " + (camelot ? camelot + " (+ compatible, from " + keySource + (keyFile ? " of " + keyFile : "") + ")" : "none") +
          (libSection === "music" ? ", BPM " + (libBpmInput.value || "none") : " (sound effects: no tempo filter)") +
          " - " + _libMatches.length + " of " + _libItemCount + " match.");
    });
    libResetFiltersBtn.addEventListener("click", function () {
      libSearchInput.value = "";
      libKeySelect.value = "";
      libBpmInput.value = "";
      libSortSelect.value = "best";
      libFavOnlyCheckbox.checked = false;
      libPitchedOnlyCheckbox.checked = false;
      _libScope[libSection] = [];
      persistSettings({ libraryFolderScope: _libScope });
      renderLibrary();
    });

    function _libTogglePreview(path) {
      if (_libMissing(path)) {
        return;
      }
      if (_libPlayer && !_libPaneCannot[path]) {
        _libPaneToggle(path);
        return;
      }
      _libPlainToggle(path);
    }
    // The plain <audio> preview: without Web Audio, or for a file the pane
    // cannot hold (too long) - it plays as is, no pitch or reverse.
    function _libPlainToggle(path) {
      if (_libPlayer && _libPlayer.isPlaying()) {
        _libPlayer.pause();
      }
      if (libPlayingPath === path) {
        libPreviewAudio.pause();
        libPlayingPath = null;
      } else {
        libPlayingPath = path;
        libPreviewAudio.src = _libFileUrl(path);
        var played = libPreviewAudio.play();
        if (played && typeof played.catch === "function") {
          played.catch(function (err) {
            log("Library preview could not play " + basename(path) + ": " + (err && err.message ? err.message : err));
            libPlayingPath = null;
            _libUpdateRowStates();
          });
        }
      }
      _libUpdateRowStates();
    }
    libPreviewAudio.addEventListener("ended", function () {
      libPlayingPath = null;
      _libUpdateRowStates();
    });
    // Inserts the file itself at the playhead. opts (optional) carries the
    // selected part, fades, pitch and Reverse from the preview pane; if the
    // host cannot apply them, it removes the clip again and the panel says so
    // (no copy is made).
    function _libInsert(item, opts) {
      if (_libMissing(item.path)) {
        return;
      }
      if (libPlayingPath) {
        libPreviewAudio.pause();
        libPlayingPath = null;
      }
      if (_libPlayer) {
        _libPlayer.pause();
        _libPaneRefresh();
      }
      showBusy("busy.default");
      evalJson("insertAudioAtPlayhead(" + _jsxJsonArg(item.path) + ", " + (item.durationSec || 0) +
               (opts ? ", " + _jsxJsonArg(opts) : "") + ")")
        .then(function (data) {
          // No copy ever stands in: when the host could not trim, pitch or
          // reverse the original, it took the clip away again and the panel
          // says so.
          if (data.trimFailed) {
            setTranslatedText(libScanStatus, "library.trimFailed", { name: item.name });
            log("Library: the host did not trim " + item.name + " (placed " + (data.placedLength || 0).toFixed(2) +
                " s from " + (data.placedIn || 0).toFixed(2) + " s) - it was taken away again, nothing inserted.");
            return;
          }
          if (data.speedFailed) {
            var sr = data.speedResult || {};
            setTranslatedText(libScanStatus, "library.speedFailed", { name: item.name });
            log("Library: the host did not apply the pitch / Reverse to " + item.name + " (speed " + sr.speed + ", reversed " +
                sr.reversed + ", length " + sr.length + (sr.error ? ", " + sr.error : "") + ") - the clip was taken out again, nothing inserted.");
            return;
          }
          if (data.speed) {
            log("Library: applied pitch / Reverse on the clip (speed " + data.speed.speed + ", reversed " + data.speed.reversed +
                ", " + Number(data.speed.length).toFixed(2) + " s).");
          }
          if (typeof data.stretch === "number" && data.stretch !== 100) {
            log("Library: pitch / Reverse applied as Time Stretch " + data.stretch.toFixed(2) + "%.");
          }
          if (data.fades) {
            var fd = data.fades;
            var side = function (label, x) {
              return x ? label + " " + x.transition + " " + x.frames + " frame(s)" + (x.asked ? "" : " (not added" + (x.why ? ": " + x.why : "") + ")") : "";
            };
            log("Library: fades as Premiere transitions - " + [side("in", fd.fadeIn), side("out", fd.fadeOut)].filter(Boolean).join(", ") +
                (fd.error ? " (" + fd.error + ")" : "") + ".");
          }
          setTranslatedText(libScanStatus, "library.inserted", { name: item.name, where: data.where });
          log("Library: inserted " + item.name + " at " + data.startSeconds.toFixed(2) + " s on " + data.where +
              (data.imported ? " (imported into the Downbeat bin)" : " (already in the project)") + ".");
        })
        .catch(function (err) {
          var msg = err && err.message ? err.message : String(err);
          setTranslatedText(libScanStatus, "library.insertFailed", { error: msg });
          log("Library: could not insert " + item.name + ": " + msg);
        })
        .then(function () {
          hideBusy();
          _libUpdateRowStates();
        });
    }
    // PREVIEW PANE: the selected file's waveform (click to jump), play, time,
    // Loop, Reverse, volume, Pitch in semitones (sampler-style: higher is
    // also faster) with Reset, and Add. Sound side in js/lib-preview.js.
    var LP = window.BeatMarkerLibPreview;
    var _libPlayer = LP ? LP.createPlayer() : null;
    var libPane = document.getElementById("libPane");
    var libPaneName = document.getElementById("libPaneName");
    var libPaneTime = document.getElementById("libPaneTime");
    var libPaneWave = document.getElementById("libPaneWave");
    var libPaneNote = document.getElementById("libPaneNote");
    var libPanePlayBtn = document.getElementById("libPanePlayBtn");
    var libPaneLoop = document.getElementById("libPaneLoop");
    var libPaneReverse = document.getElementById("libPaneReverse");
    var libPaneVolume = document.getElementById("libPaneVolume");
    var libPanePitchDown = document.getElementById("libPanePitchDown");
    var libPanePitchUp = document.getElementById("libPanePitchUp");
    var libPanePitchValue = document.getElementById("libPanePitchValue");
    var libPanePitchReset = document.getElementById("libPanePitchReset");
    var libPaneAddBtn = document.getElementById("libPaneAddBtn");
    var libPaneInKeyBtn = document.getElementById("libPaneInKeyBtn");
    var libPaneKey = document.getElementById("libPaneKey");
    var libPaneSel = document.getElementById("libPaneSel");
    var libPaneSelText = document.getElementById("libPaneSelText");
    var libPaneSelClear = document.getElementById("libPaneSelClear");
    // A decoded file is held whole (float samples): over this, the pane says
    // so and ▶ is not offered (a 10-minute 96 kHz stereo WAV is ~460 MB).
    var LIB_PANE_MAX_DECODED_BYTES = 300 * 1024 * 1024;
    var _libPaneItem = null; // the item shown (loaded or loading)
    var _libPaneReady = false; // its sound is decoded and loaded
    var _libPaneToken = 0;
    var _libPaneSelectTimer = null;
    var _libPanePeaks = null; // { min, max } for the canvas width, file order
    var _libPaneRaf = null;
    var _libPaneLoading = null; // the load in progress, a Promise
    var _libPaneCannot = {}; // path -> true: the pane could not load it; ▶ uses the plain preview
    var _libPaneWasPlaying = false;

    function _libPaneFindItem(path) {
      for (var i = 0; i < _libShown.length; i++) {
        if (_libShown[i].item.path === path) {
          return _libShown[i].item;
        }
      }
      return null;
    }

    function _libPaneNote(key, vars) {
      if (!key) {
        libPaneNote.hidden = true;
        libPaneNote.textContent = "";
        return;
      }
      libPaneNote.hidden = false;
      setTranslatedText(libPaneNote, key, vars || {});
    }
    // Decodes one file for the pane: WAV / AIFF with the plugin's own reader
    // (every channel, its own rate - AIFF plays here too, which the plain
    // preview cannot), anything else with the browser's decoder.
    function _libPaneDecode(path) {
      var ext = (String(path).split(".").pop() || "").toLowerCase();
      var fs = window.cep_node.require("fs");
      if (ext === "wav" || ext === "aif" || ext === "aiff" || ext === "aifc") {
        var reader = _libWavReader();
        try {
          var info = reader.probe(path);
          var fmt = info.header.fmt;
          if (info.durationSec * fmt.rate * fmt.channels * 4 > LIB_PANE_MAX_DECODED_BYTES) {
            return Promise.reject({ tooLong: true });
          }
          var data = reader.readChannels(path, info);
          return Promise.resolve(_libPlayer.createBuffer(data.channels, data.sampleRate));
        } catch (e) {
          if (!(e instanceof reader.UnsupportedWav) || ext !== "wav") {
            return Promise.reject(e);
          }
          // A WAV the reader does not support (compressed, ...): fall through
          // to the browser's decoder below.
        }
      }
      var size = 0;
      try { size = fs.statSync(path).size; } catch (statErr) { return Promise.reject(statErr); }
      if (size > LIB_PANE_MAX_DECODED_BYTES / 4) {
        return Promise.reject({ tooLong: true });
      }
      // Decoded at the file's own sample rate (read from its first bytes), so
      // nothing is resampled.
      var rate = null;
      try { rate = _libWavReader().nativeRate(path); } catch (rateErr) { rate = null; }
      return window.BeatMarkerAudio.readFileAsArrayBuffer(path).then(function (ab) {
        return window.BeatMarkerAudio.decodeToBuffer(ab, rate);
      });
    }
    // IN KEY: while on, every sound the pane loads is pitched into the music
    // clip's key, so browsing with the arrows already sounds in key and Add
    // places the file at that pitch. Same mode: the shortest shift to the
    // clip's key. A major sound on a minor clip (or the other way round) goes
    // to the clip's relative key - the same Camelot number, which mixes with
    // it - since no shift turns minor into major (js/pitch.js header).
    var _libInKey = false;
    var _libInKeyHintShown = false;
    function _libInKeyShift(itemCode, clipCode) {
      var item = window.BeatMarkerCamelot.fromCamelotCode(itemCode);
      var clip = window.BeatMarkerCamelot.fromCamelotCode(clipCode);
      if (!item || !clip) {
        return null;
      }
      var target = parseInt(clipCode, 10) + itemCode.slice(-1); // the clip's number, the sound's mode
      var shift = window.BeatMarkerPitch.shiftBetween(itemCode, target);
      return shift ? shift.shortest : null;
    }
    function _libApplyInKey() {
      var item = _libPaneItem;
      var clip = _libClipCamelot();
      if (!_libInKey || !_libPaneReady || !item || !clip || !item.camelot || !SL.hasPitch(item)) {
        return;
      }
      var st = _libInKeyShift(item.camelot, clip);
      if (st !== null) {
        _libPlayer.setPitch(Math.max(-LP.PITCH_LIMIT, Math.min(LP.PITCH_LIMIT, st)));
      }
    }

    function _libPaneLoad(item) {
      var token = ++_libPaneToken;
      _libPlayer.stop();
      libPlayingPath = null;
      _libPaneItem = item;
      _libPaneReady = false;
      _libPanePeaks = null;
      libPane.hidden = false;
      libPaneName.textContent = item.name;
      libPaneName.title = item.path;
      libPaneTime.textContent = "…";
      _libPaneNote(null);
      _libInKeyHintShown = false;
      // A new file starts at its own pitch, forwards; Loop and the volume
      // stay.
      libPaneReverse.checked = false;
      _libPaneDraw();
      _libPaneLoading = _libPaneDecode(item.path).then(function (buffer) {
        if (token !== _libPaneToken) {
          return false;
        }
        _libPlayer.load(buffer);
        _libPlayer.setPitch(0);
        _libPlayer.setReverse(false);
        _libPlayer.setLoop(libPaneLoop.checked);
        _libPaneReady = true;
        _libApplyInKey();
        _libPaneComputePeaks();
        _libPaneRefresh();
        return true;
      }, function (err) {
        if (token !== _libPaneToken) {
          return false;
        }
        if (!_libFileThere(item.path, true)) {
          // Not there now - not "unreadable": it can come back (a drive).
          _libPaneNote("library.missingFile", { name: item.name });
          _libPaneRefresh();
          return false;
        }
        _libPaneCannot[item.path] = true;
        if (err && err.tooLong) {
          _libPaneNote("library.paneTooLong");
        } else {
          _libPaneNote("library.paneUnreadable");
          log("Library preview could not read " + basename(item.path) + ": " + (err && err.message ? err.message : err));
        }
        _libPaneRefresh();
        return false;
      });
      _libUpdateRowStates();
      return _libPaneLoading;
    }
    function _libPaneSelect(path) {
      if (!_libPlayer || !path) {
        return;
      }
      if (_libPaneItem && _libPaneItem.path === path) {
        return;
      }
      var item = _libPaneFindItem(path);
      if (!item) {
        return;
      }
      if (_libPaneSelectTimer) { clearTimeout(_libPaneSelectTimer); }
      _libPaneSelectTimer = setTimeout(function () {
        _libPaneSelectTimer = null;
        if (libSelectedPath === path && (!_libPaneItem || _libPaneItem.path !== path)) {
          _libPaneLoad(item);
        }
      }, 120);
    }
    // ▶ on a row, Space, or the pane's own ▶.
    function _libPaneToggle(path) {
      var item = _libPaneFindItem(path) || (_libPaneItem && _libPaneItem.path === path ? _libPaneItem : null);
      if (!item) {
        return;
      }
      if (_libPaneSelectTimer) { clearTimeout(_libPaneSelectTimer); _libPaneSelectTimer = null; }
      var start = function () {
        if (!_libPaneReady || !_libPaneItem || _libPaneItem.path !== path) {
          return;
        }
        if (_libPlayer.isPlaying()) {
          _libPlayer.pause();
        } else {
          libPreviewAudio.pause(); // the plain preview, if it was playing another file
          _libPlayer.play();
        }
        _libPaneRefresh();
      };
      var orPlain = function (ok) {
        if (ok) { start(); } else if (_libPaneCannot[path]) { _libPlainToggle(path); }
      };
      if (!_libPaneItem || _libPaneItem.path !== path) {
        _libPaneLoad(item).then(orPlain);
      } else if (!_libPaneReady && _libPaneLoading) {
        _libPaneLoading.then(orPlain);
      } else {
        start();
      }
    }

    function _libPaneComputePeaks() {
      var width = Math.max(50, Math.round((libPaneWave.clientWidth || 300) * (window.devicePixelRatio || 1)));
      libPaneWave.width = width;
      libPaneWave.height = Math.round((libPaneWave.clientHeight || 44) * (window.devicePixelRatio || 1));
      _libPanePeaks = _libPaneReady ? LP.peaks(_libPlayer.channels(), width) : null;
    }

    function _libPaneColor(name, fallback) {
      try {
        var v = getComputedStyle(document.body).getPropertyValue(name);
        return v && v.trim() ? v.trim() : fallback;
      } catch (e) {
        return fallback;
      }
    }
    var LIB_PANE_HANDLE = 6; // size of the fade handles on the waveform, css px
    function _libPaneHandles() {
      var D = _libPlayer.duration();
      if (!D) {
        return null;
      }
      var seg = _libPlayer.segment();
      var f = _libPlayer.fades();
      return { inX: (seg.a + f.fadeIn) / D, outX: (seg.b - f.fadeOut) / D, a: seg.a / D, b: seg.b / D };
    }
    // The waveform in the heard direction: outside the selected part dim,
    // inside it the bars scaled by the fade gain (so a fade shows as the
    // sound thinning out), played part lighter, the gain curve in orange
    // while there are fades, the two fade handles (small squares at the top)
    // and the white playhead.
    function _libPaneDraw() {
      if (!libPaneWave.getContext) {
        return;
      }
      var g = libPaneWave.getContext("2d");
      if (!g) {
        return;
      }
      var w = libPaneWave.width, h = libPaneWave.height;
      g.clearRect(0, 0, w, h);
      if (!_libPanePeaks) {
        return;
      }
      var dpr = window.devicePixelRatio || 1;
      var prog = _libPlayer.progress();
      var reverse = libPaneReverse.checked;
      var D = _libPlayer.duration();
      var playedX = prog.fraction * w;
      var outside = _libPaneColor("--border", "#2a2a2a");
      var dim = _libPaneColor("--border-bright", "#626262");
      var lit = _libPaneColor("--text-dim", "#9c9c9c");
      var mid = h / 2;
      var hasFades = _libPlayer.fades().fadeIn > 0 || _libPlayer.fades().fadeOut > 0;
      var seg = _libPlayer.segment();
      for (var x = 0; x < w; x++) {
        var src = reverse ? w - 1 - x : x;
        var t = (x + 0.5) / w * D;
        var gain = _libPlayer.gainAt(t);
        var inside = t >= seg.a && t <= seg.b;
        var k = inside ? gain : 1;
        var top = mid - _libPanePeaks.max[src] * mid * k;
        var bottom = mid - _libPanePeaks.min[src] * mid * k;
        g.fillStyle = !inside ? outside : (x < playedX ? lit : dim);
        g.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
      if (hasFades) {
        g.strokeStyle = _libPaneColor("--accent", "#ff9f2e");
        g.lineWidth = Math.max(1, dpr);
        g.beginPath();
        var x0 = Math.floor(seg.a / D * w), x1 = Math.ceil(seg.b / D * w);
        for (var xx = x0; xx <= x1; xx++) {
          var yy = (1 - _libPlayer.gainAt(Math.min(seg.b, Math.max(seg.a, xx / w * D)))) * (h - 2) + 1;
          if (xx === x0) { g.moveTo(xx, yy); } else { g.lineTo(xx, yy); }
        }
        g.stroke();
      }
      var hd = _libPaneHandles();
      if (hd) {
        var size = Math.round(LIB_PANE_HANDLE * dpr);
        g.fillStyle = _libPaneColor("--text", "#e8e6e1");
        g.fillRect(Math.min(w - size, Math.round(hd.inX * w)), 0, size, size);
        g.fillRect(Math.max(0, Math.round(hd.outX * w) - size), 0, size, size);
      }
      g.fillStyle = _libPaneColor("--text", "#e8e6e1");
      g.fillRect(Math.min(w - 1, Math.round(playedX)), 0, Math.max(1, Math.round(dpr)), h);
    }

    function _libPaneSelectionText() {
      var region = _libPlayer.region();
      var f = _libPlayer.fades();
      if (!region && !f.fadeIn && !f.fadeOut) {
        return null;
      }
      var r = LP.semitoneRate(_libPlayer.settings().semitones);
      var secs = function (x) { return (x / r).toFixed(2) + " s"; };
      var parts = [];
      parts.push(region ? LP.formatTime(region.a / r) + " – " + LP.formatTime(region.b / r) + " (" + secs(region.b - region.a) + ")" : I18n.t("library.paneWhole"));
      var curveText = function (c) { return (c > 0 ? "+" : c < 0 ? "\u2212" : "") + Math.abs(c); };
      if (f.fadeIn) {
        parts.push(I18n.t("library.paneFadeIn", { len: secs(f.fadeIn), curve: curveText(f.curveIn) }));
      }
      if (f.fadeOut) {
        parts.push(I18n.t("library.paneFadeOut", { len: secs(f.fadeOut), curve: curveText(f.curveOut) }));
      }
      // What the timeline gets, when the fades go there as Premiere
      // transitions (no pitch, no Reverse): the closest of their shapes.
      var set = _libPlayer.settings();
      if (!ctx.hostIsAe() && (f.fadeIn || f.fadeOut) && !set.semitones && !set.reverse) {
        var names = [];
        if (f.fadeIn) { names.push(LP.transitionFor(f.curveIn)); }
        if (f.fadeOut && (!f.fadeIn || LP.transitionFor(f.curveOut) !== names[0])) { names.push(LP.transitionFor(f.curveOut)); }
        parts.push(I18n.t("library.paneTimeline", { names: names.join(" / ") }));
      }
      return parts.join(" · ");
    }
    // Button, time, pitch and row icons from the player's state; keeps
    // redrawing while it plays.
    function _libPaneRefresh() {
      if (!_libPlayer) {
        return;
      }
      var playing = _libPlayer.isPlaying();
      if (_libPaneReady || playing) {
        // (a file the pane could not load may still be playing in the plain preview)
        libPlayingPath = playing && _libPaneItem ? _libPaneItem.path : null;
      }
      libPanePlayBtn.textContent = playing ? "‖" : "▶";
      libPanePlayBtn.disabled = !_libPaneReady;
      libPaneAddBtn.disabled = !_libPaneItem || (!_libPaneReady && _libPaneHasEdits());
      var st = _libPlayer.settings().semitones;
      libPanePitchValue.textContent = (st > 0 ? "+" : st < 0 ? "−" : "") + Math.abs(st);
      libPanePitchValue.classList.toggle("is-set", st !== 0);
      libPanePitchDown.disabled = !_libPaneReady || st <= -LP.PITCH_LIMIT;
      libPanePitchUp.disabled = !_libPaneReady || st >= LP.PITCH_LIMIT;
      libPanePitchReset.hidden = st === 0;
      var selText = _libPaneReady ? _libPaneSelectionText() : null;
      libPaneSel.hidden = !selText;
      libPaneSelText.textContent = selText || "";
      // The key or note the pitch turns it into (js/pitch.js transpose) -
      // only for a sound with one: not for "no clear pitch" SFX.
      var keyItem = _libPaneItem;
      var itemHasKey = !!(keyItem && keyItem.camelot && SL.hasPitch(keyItem));
      var newCode = (st && itemHasKey) ? window.BeatMarkerPitch.transpose(keyItem.camelot, st) : null;
      var clipCode = _libClipCamelot();
      libPaneInKeyBtn.classList.toggle("is-active", _libInKey);
      libPaneInKeyBtn.setAttribute("aria-pressed", _libInKey ? "true" : "false");
      setTranslatedText(libPaneInKeyBtn, _libInKey && clipCode ? "library.paneInKeyTo" : "library.paneInKey", { code: clipCode || "" });
      libPaneKey.hidden = !newCode && !(_libInKey && keyItem && _libPaneReady);
      if (newCode) {
        var keyText = function (code) {
          var f = window.BeatMarkerCamelot.fromCamelotCode(code);
          return code + (f ? " " + _localKeyName(f.key, f.scale) : "");
        };
        setTranslatedText(libPaneKey, "library.paneKeyShift", { from: keyText(keyItem.camelot), to: keyText(newCode) });
      } else if (_libInKey && keyItem && _libPaneReady) {
        setTranslatedText(libPaneKey, itemHasKey ? "library.paneInKeyAlready" : "library.paneInKeyNoKey");
      }
      if (_libPaneReady) {
        var p = _libPlayer.progress();
        libPaneTime.textContent = LP.formatTime(p.nowSec) + " / " + LP.formatTime(p.totalSec);
      } else if (!libPaneNote.hidden) {
        libPaneTime.textContent = "";
      }
      _libPaneDraw();
      if (playing !== _libPaneWasPlaying) {
        _libPaneWasPlaying = playing;
        _libUpdateRowStates(); // row icons only when it starts or stops - not every frame
      }
      if (playing && !_libPaneRaf && typeof requestAnimationFrame === "function") {
        _libPaneRaf = requestAnimationFrame(function () {
          _libPaneRaf = null;
          _libPaneRefresh();
        });
      }
    }

    if (_libPlayer) {
      _libPlayer.onEnded(_libPaneRefresh);
      _libPlayer.setVolume(Number(libPaneVolume.value) / 100);
      libPaneVolume.addEventListener("input", function () {
        _libPlayer.setVolume(Number(libPaneVolume.value) / 100);
      });
      libPaneVolume.addEventListener("change", function () {
        persistSettings({ libPreviewVolume: Number(libPaneVolume.value) });
      });
      libPanePlayBtn.addEventListener("click", function () {
        if (_libPaneItem) {
          _libPaneToggle(_libPaneItem.path);
        }
      });
      libPaneLoop.addEventListener("change", function () {
        _libPlayer.setLoop(libPaneLoop.checked);
      });
      libPaneReverse.addEventListener("change", function () {
        _libPlayer.setReverse(libPaneReverse.checked);
        _libPaneRefresh();
      });
      var nudgePitch = function (delta) {
        _libPlayer.setPitch(_libPlayer.settings().semitones + delta);
        _libPaneRefresh();
      };
      libPanePitchDown.addEventListener("click", function () { nudgePitch(-1); });
      libPanePitchUp.addEventListener("click", function () { nudgePitch(1); });
      libPanePitchReset.addEventListener("click", function () {
        _libPlayer.setPitch(0);
        _libPaneRefresh();
      });
      libPaneInKeyBtn.addEventListener("click", function () {
        if (!_libInKey && !_libClipCamelot()) {
          _libPaneNote("library.paneInKeyNone");
          _libInKeyHintShown = true;
          return;
        }
        if (_libInKeyHintShown) {
          _libPaneNote(null);
          _libInKeyHintShown = false;
        }
        _libInKey = !_libInKey;
        if (_libInKey) {
          _libApplyInKey();
        } else if (_libPaneReady) {
          _libPlayer.setPitch(0);
        }
        _libPaneRefresh();
      });
      // Mouse on the waveform: a click jumps (and drops a selection it is
      // outside of); a drag selects a part; a drag that starts on a fade
      // handle (top band) sets that fade. Moves and the release are followed
      // on the document, so a drag may leave the canvas.
      var paneDrag = null;
      var paneFrac = function (evt) {
        var rect = libPaneWave.getBoundingClientRect();
        return { f: Math.max(0, Math.min(1, (evt.clientX - rect.left) / Math.max(1, rect.width))), y: evt.clientY - rect.top, w: Math.max(1, rect.width) };
      };
      libPaneWave.addEventListener("mousedown", function (evt) {
        if (!_libPaneReady) {
          return;
        }
        var p = paneFrac(evt);
        var hd = _libPaneHandles();
        var mode = "select";
        if (hd && p.y <= LIB_PANE_HANDLE * 2.5) {
          var dIn = Math.abs(p.f - hd.inX) * p.w, dOut = Math.abs(p.f - hd.outX) * p.w;
          if (Math.min(dIn, dOut) <= LIB_PANE_HANDLE * 1.5) {
            mode = dIn <= dOut ? "fadeIn" : "fadeOut";
          }
        }
        var fd0 = _libPlayer.fades();
        paneDrag = { mode: mode, f0: p.f, y0: evt.clientY, moved: false, w: p.w, curve0: mode === "fadeIn" ? fd0.curveIn : fd0.curveOut,
          fadeIn0: fd0.fadeIn, fadeOut0: fd0.fadeOut };
        if (evt.preventDefault) { evt.preventDefault(); }
      });
      document.addEventListener("mousemove", function (evt) {
        if (!paneDrag) {
          return;
        }
        var p = paneFrac(evt);
        if (Math.abs(p.f - paneDrag.f0) * paneDrag.w > 3 || Math.abs(evt.clientY - paneDrag.y0) > 3) {
          paneDrag.moved = true;
        }
        if (!paneDrag.moved) {
          return;
        }
        var D = _libPlayer.duration();
        var seg = _libPlayer.segment();
        var fd = _libPlayer.fades();
        if (paneDrag.mode === "select") {
          _libPlayer.setRegion(Math.min(paneDrag.f0, p.f) * D, Math.max(paneDrag.f0, p.f) * D);
        } else {
          // Like the fade handle on a clip in Premiere: sideways the length,
          // up / down the curve (-100..100; 2.5 per px, up = louder longer).
          // Moves count from where the handle was taken, so grabbing it a
          // pixel off its centre does not make it jump.
          var curve = LP.clampCurve(paneDrag.curve0 - (evt.clientY - paneDrag.y0) * 2.5);
          var dSec = (p.f - paneDrag.f0) * D;
          if (paneDrag.mode === "fadeIn") {
            _libPlayer.setFades(paneDrag.fadeIn0 + dSec, fd.fadeOut, curve, null);
          } else {
            _libPlayer.setFades(fd.fadeIn, paneDrag.fadeOut0 - dSec, null, curve);
          }
        }
        _libPaneRefresh();
      });
      document.addEventListener("mouseup", function (evt) {
        if (!paneDrag) {
          return;
        }
        var drag = paneDrag;
        paneDrag = null;
        if (drag.mode === "select" && !drag.moved) {
          var p = paneFrac(evt);
          var D = _libPlayer.duration();
          var region = _libPlayer.region();
          if (region && (p.f * D < region.a || p.f * D > region.b)) {
            _libPlayer.setRegion(null, null);
          }
          _libPlayer.seek(p.f);
        }
        _libPaneRefresh();
      });
      libPaneWave.addEventListener("dblclick", function (evt) {
        var p = paneFrac(evt);
        var hd = _libPaneHandles();
        if (!hd || p.y > LIB_PANE_HANDLE * 2.5) {
          return;
        }
        var fd = _libPlayer.fades();
        var nearIn = Math.abs(p.f - hd.inX) <= Math.abs(p.f - hd.outX);
        _libPlayer.setFades(fd.fadeIn, fd.fadeOut, nearIn ? 0 : null, nearIn ? null : 0);
        _libPaneRefresh();
      });
      libPaneSelClear.addEventListener("click", function () {
        _libPlayer.setRegion(null, null);
        _libPlayer.setFades(0, 0, 0, 0);
        _libPaneRefresh();
      });
      window.addEventListener("resize", function () {
        if (_libPaneReady) {
          _libPaneComputePeaks();
          _libPaneDraw();
        }
      });
      libPaneAddBtn.addEventListener("click", _libPaneAdd);
    }
    // Whether Add carries edits from the pane: a pitch, Reverse, a selected
    // part or fades (then the pane's sound must be loaded first).
    function _libPaneHasEdits() {
      if (!_libPlayer) {
        return false;
      }
      var set = _libPlayer.settings();
      var f = _libPlayer.fades();
      return !!(set.semitones || set.reverse || _libPlayer.region() || f.fadeIn || f.fadeOut);
    }
    // Add: the original, trimmed to the selected part, with fades the editor
    // can still change (Premiere transitions, After Effects Audio Levels
    // keyframes), and the pitch and Reverse made by the host on the clip
    // itself - speed without keeping the pitch in Premiere, Time Stretch in
    // After Effects, exactly the sampler-style pitch the pane plays. The part
    // and the fades are set in the file's own seconds; at a pitch the
    // timeline runs 2^(st/12) times faster, so the fades are sent in timeline
    // seconds.
    function _libPaneAdd() {
      var item = _libPaneItem;
      if (!item) {
        return;
      }
      if (!_libPaneHasEdits()) {
        _libInsert(item);
        return;
      }
      if (!_libPaneReady) {
        return;
      }
      var set = _libPlayer.settings();
      var region = _libPlayer.region();
      var f = _libPlayer.fades();
      var whole = _libPlayer.duration();
      var speed = LP.semitoneRate(set.semitones);
      // The part is sent only when one is selected: with none, the host takes
      // the whole file as Premiere knows it (an MP3's decoded length here can
      // differ from Premiere's by tens of milliseconds, which it would take
      // for a failed trim).
      var opts = {
        fadeInSec: f.fadeIn / speed,
        fadeOutSec: f.fadeOut / speed,
        curveIn: f.curveIn,
        curveOut: f.curveOut,
        transitionIn: LP.transitionFor(f.curveIn),
        transitionOut: LP.transitionFor(f.curveOut)
      };
      if (region) {
        // The pane counts the part in the HEARD direction; with Reverse on
        // that is the file read backwards, so the part of the file itself
        // is the mirror image of it.
        opts.inSec = set.reverse ? whole - region.b : region.a;
        opts.outSec = set.reverse ? whole - region.a : region.b;
      }
      if (set.semitones) {
        opts.speed = speed;
      }
      if (set.reverse) {
        opts.reverse = true;
      }
      _libInsert({ path: item.path, name: item.name, durationSec: whole }, opts);
    }
    // Keyboard: ↑ ↓ choose a file, Space listens, Enter inserts - on the
    // Library tab, and not while typing in a field. The panel asks the host
    // for these keys only while that tab is shown (see switchTab), so
    // elsewhere Premiere's own Space / arrows keep working.
    document.addEventListener("keydown", function (evt) {
      if (ctx.activeTabId() !== "library") {
        return;
      }
      var t = evt.target;
      var tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      var isCatcher = t === libKeyCatcher;
      if (!isCatcher && (tag === "textarea" || tag === "select" || (tag === "input" && t.type !== "checkbox" && t.type !== "radio"))) {
        return;
      }
      if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
        _libMoveSelection(evt.key === "ArrowDown" ? 1 : -1);
        evt.preventDefault();
      } else if ((evt.key === " " || evt.key === "Spacebar") && libSelectedPath) {
        _libTogglePreview(libSelectedPath);
        evt.preventDefault();
      } else if (evt.key === "Enter" && libSelectedPath) {
        var i = _libShownIndex(libSelectedPath);
        if (i >= 0 && _libShown[i].item.status === "done") {
          _libInsert(_libShown[i].item);
          evt.preventDefault();
        }
      }
    });

    libAddFolderBtn.addEventListener("click", function () {
      _pickFolderDialog()
        .then(function (picked) {
          if (!picked.directory) {
            return; // cancelled
          }
          if (!SL.addFolder(libSection, picked.directory)) {
            setTranslatedText(libScanStatus, "library.folderAlready");
            return;
          }
          // Adding only lists the folder's audio files (they show as "waiting
          // for analysis"); the scan itself starts with Start scan.
          var addFs = window.cep_node.require("fs");
          var sync = SL.syncFiles(libSection, SL.listAudioFiles(addFs, libSection), SL.offlineFolders(addFs, libSection));
          persistSoundLibrary();
          renderLibrary();
          setTranslatedText(libScanStatus, "library.folderAdded", { pending: sync.pending });
        })
        .catch(function (err) {
          log("Add folder failed: " + (err && err.message ? err.message : err));
        });
    });
    libRescanBtn.addEventListener("click", function () { _libStartScan(libSection); });
    // The scan overlay: the panel is covered while a scan runs - it keeps
    // every core busy - with progress, time left and Cancel.
    var libScanOverlay = document.getElementById("libScanOverlay");
    var libScanBarFill = document.getElementById("libScanBarFill");
    var libScanPercent = document.getElementById("libScanPercent");
    var libScanDetail = document.getElementById("libScanDetail");
    var libScanEta = document.getElementById("libScanEta");
    var libScanCancelBtn = document.getElementById("libScanCancelBtn");
    var libScanChildren = []; // running worker processes, for Cancel
    libScanCancelBtn.addEventListener("click", function () {
      libScan.stop = true;
      libScanCancelBtn.disabled = true;
      setTranslatedText(libScanCancelBtn, "library.stopping");
      libScanChildren.forEach(function (child) {
        try { child.kill(); } catch (e) { /* already finished */ }
      });
    });
    function _libEtaText(done, total, elapsedMs) {
      if (done < 3 || elapsedMs < 4000) {
        return I18n.t("library.etaEstimating");
      }
      var secLeft = Math.round((total - done) * (elapsedMs / 1000) / done);
      if (secLeft < 60) {
        return I18n.t("library.etaSeconds", { n: Math.max(1, secLeft) });
      }
      if (secLeft < 3600) {
        return I18n.t("library.etaMinutes", { n: Math.round(secLeft / 60) });
      }
      return I18n.t("library.etaHours", { h: Math.floor(secLeft / 3600), m: Math.round((secLeft % 3600) / 60) });
    }

    function _libShowScanProgress(startedAt) {
      var pct = libScan.total ? Math.floor(100 * libScan.done / libScan.total) : 0;
      libScanBarFill.style.width = pct + "%";
      libScanPercent.textContent = pct + "%";
      // Files on one line, the time left under it.
      libScanDetail.textContent = I18n.t("library.scanProgress", { done: libScan.done, total: libScan.total });
      libScanEta.textContent = libScan.stop ? "" : _libEtaText(libScan.done, libScan.total, Date.now() - startedAt);
    }
    // Runs the worker's "library" mode on one manifest of already-written
    // excerpt files.
    function _runLibraryWorker(manifestPath, itemCount) {
      return new Promise(function (resolve, reject) {
        var fs = window.cep_node.require("fs");
        var os = window.cep_node.require("os");
        var childProcess = window.cep_node.require("child_process");
        var extensionRoot = ctx.csInterface().getSystemPath(SystemPath.EXTENSION);
        var child = childProcess.execFile(
          _resolveNodeExecutable(fs, os, extensionRoot),
          [extensionRoot + "/worker/analyze-worker.js", "library", manifestPath],
          { maxBuffer: 20 * 1024 * 1024, timeout: 30000 + itemCount * 5000 },
          function (err, stdout, stderr) {
            libScanChildren = libScanChildren.filter(function (c) { return c !== child; });
            if (err) {
              reject(new Error(err.killed ? "timed out" : (err.message || String(err)) + (stderr ? " | " + String(stderr).slice(0, 300) : "")));
              return;
            }
            try {
              var parsed = JSON.parse(stdout);
              if (!parsed.ok) {
                throw new Error(parsed.error || "the worker reported a failure");
              }
              resolve(parsed.data.results);
            } catch (e) {
              reject(e);
            }
          }
        );
        libScanChildren.push(child);
      });
    }
    // The worker's WAV/AIFF header reader, reused here for the length of a
    // file whose key comes from its name (no analysis, so no worker call).
    var _libWavReaderModule = null;
    function _libWavReader() {
      if (!_libWavReaderModule) {
        _libWavReaderModule = window.cep_node.require(ctx.csInterface().getSystemPath(SystemPath.EXTENSION) + "/worker/wav-excerpt.js");
      }
      return _libWavReaderModule;
    }
    // A file over LIB_SOLO_DECODE_BYTES (e.g. a long high-bitrate MP3, most
    // FLACs, a DJ mix) waits for the others to finish and decodes alone.
    // Files above LIB_MAX_PANEL_DECODE_BYTES are not decoded here at all (a
    // 300 MB compressed file is hours of audio).
    var LIB_MAX_PANEL_DECODE_BYTES = 300 * 1024 * 1024;
    var LIB_SOLO_DECODE_BYTES = 16 * 1024 * 1024;
    var LIB_PANEL_DECODES_AT_ONCE = 2;
    var _libDecodeQueue = [];
    var _libDecodesActive = 0;
    var _libDecodeSoloActive = false;
    // First come, first served: a big file at the head of the queue holds
    // back the small ones behind it rather than being overtaken forever.
    function _libDecodePump() {
      while (_libDecodeQueue.length) {
        var next = _libDecodeQueue[0];
        var fits = _libDecodesActive === 0 ||
          (!next.solo && !_libDecodeSoloActive && _libDecodesActive < LIB_PANEL_DECODES_AT_ONCE);
        if (!fits) {
          return;
        }
        _libDecodeQueue.shift();
        _libDecodesActive++;
        _libDecodeSoloActive = next.solo;
        next.start();
      }
    }
    function _libDecodeInPanel(path) {
      return new Promise(function (resolve, reject) {
        var size;
        try {
          size = window.cep_node.require("fs").statSync(path).size;
        } catch (statErr) {
          reject(statErr);
          return;
        }
        if (size > LIB_MAX_PANEL_DECODE_BYTES) {
          reject(new Error("too large to analyze here (" + Math.round(size / 1048576) + " MB)"));
          return;
        }
        var solo = size > LIB_SOLO_DECODE_BYTES;
        _libDecodeQueue.push({
          solo: solo,
          start: function () {
            function finish() {
              _libDecodesActive--;
              if (solo) {
                _libDecodeSoloActive = false;
              }
              _libDecodePump();
            }
            window.BeatMarkerAudio.readFileAsArrayBuffer(path)
              .then(function (buffer) { return window.BeatMarkerAudio.decodeToMono44100(buffer); })
              .then(function (decoded) { finish(); resolve(decoded); },
                    function (err) { finish(); reject(err); });
          }
        });
        _libDecodePump();
      });
    }
    // One batch. WAV files - most of any SFX library - go to the worker as
    // paths: it reads just the excerpt from disk itself (worker/
    // wav-excerpt.js), so the panel never loads them. Other formats are
    // decoded here (two at a time, a big file alone - _libDecodePump) and their
    // excerpt handed over as a temp file.
    function _libAnalyzeBatch(section, paths, forcePanelDecode) {
      var fs = window.cep_node.require("fs");
      var tmpDir = window.BeatMarkerPersistence.getTempDir(ctx.csInterface());
      var items = [];
      var tmpFiles = [];
      var fallbacks = [];
      ctx.tempFileStarted();
      var chain = Promise.resolve();
      paths.forEach(function (path) {
        chain = chain.then(function () {
          if (libScan.stop) {
            return null;
          }
          // Key (and for music, BPM) already in the file name: nothing to
          // analyze. Length only - from the WAV/AIFF header when there is
          // one, which costs nothing.
          if (!forcePanelDecode && SL.nameTagsComplete(path, section)) {
            var durationSec = null;
            if (SL.WORKER_READABLE_EXT.test(path)) {
              try {
                durationSec = _libWavReader().probe(path).durationSec;
              } catch (probeErr) {
                durationSec = null;
              }
            }
            SL.setResult(path, { ok: true, durationSec: durationSec, bpm: null, bpmConfidence: null });
            SL.applyNameTags(path);
            libScan.done++;
            libScan.fromName++;
            return null;
          }
          if (!forcePanelDecode && SL.WORKER_READABLE_EXT.test(path)) {
            items.push({ path: path, wav: path, material: section });
            return null;
          }
          return _libDecodeInPanel(path)
            .then(function (decoded) {
              var rate = window.BeatMarkerAudio.TARGET_SAMPLE_RATE;
              var durationSec = decoded.samples.length / rate;
              var range = SL.excerptRange(durationSec, section);
              var part = decoded.samples.subarray(Math.floor(range.startSec * rate), Math.floor((range.startSec + range.lengthSec) * rate));
              var raw = tmpDir + "/library-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
              fs.writeFileSync(raw, part); // Node writes exactly the view's bytes
              tmpFiles.push(raw);
              items.push({ path: path, raw: raw, material: section, bpm: range.wantBpm, durationSec: durationSec });
            })
            .catch(function (err) {
              SL.setResult(path, { ok: false, error: "could not decode: " + (err && err.message ? err.message : err) });
              libScan.failed++;
              libScan.done++;
            });
        });
      });
      return chain.then(function () {
        if (items.length === 0) {
          return null;
        }
        var manifest = tmpDir + "/library-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".json";
        tmpFiles.push(manifest);
        fs.writeFileSync(manifest, JSON.stringify({ items: items.map(function (it) {
          return it.wav ? { wav: it.wav, material: it.material }
                        : { raw: it.raw, material: it.material, bpm: it.bpm, durationSec: it.durationSec };
        }) }));
        return _runLibraryWorker(manifest, items.length).then(function (results) {
          items.forEach(function (it, i) {
            if (results[i] && results[i].fallback) {
              fallbacks.push(it.path);
              return;
            }
            SL.setResult(it.path, results[i]);
            if (!results[i] || !results[i].ok) {
              libScan.failed++;
            } else {
              SL.applyNameTags(it.path); // whatever the name does say wins over detection
            }
            libScan.done++;
          });
        }, function (err) {
          if (libScan.stop) {
            return; // killed by Cancel: these files stay pending for the next scan
          }
          items.forEach(function (it) {
            SL.setResult(it.path, { ok: false, error: err && err.message ? err.message : String(err) });
            libScan.failed++;
            libScan.done++;
          });
        });
      }).then(function () {
        tmpFiles.forEach(function (f) {
          try { fs.unlinkSync(f); } catch (e) { /* swept on next start */ }
        });
        ctx.tempFileDone();
        if (fallbacks.length && !libScan.stop) {
          return _libAnalyzeBatch(section, fallbacks, true);
        }
        return null;
      });
    }
    function _libStartScan(section) {
      if (libScan.running) {
        return;
      }
      var fs = window.cep_node.require("fs");
      var os = window.cep_node.require("os");
      var offline = SL.offlineFolders(fs, section);
      offline.forEach(function (dir) {
        log("Library scan (" + section + "): " + dir + " is not there now (a drive that is not connected?) - its sounds stay in the library as they are.");
      });
      var sync = SL.syncFiles(section, SL.listAudioFiles(fs, section), offline);
      var queue = SL.pendingPaths(section);
      persistSoundLibrary();
      if (queue.length === 0) {
        setTranslatedText(libScanStatus, "library.upToDate", { count: SL.counts(section).total });
        renderLibrary();
        return;
      }
      libScan = { running: true, stop: false, section: section, done: 0, total: queue.length, failed: 0, fromName: 0 };
      log("Library scan (" + section + "): " + queue.length + " file(s) to analyze (" + sync.added + " new, " + sync.changed +
          " changed, " + sync.removed + " gone).");
      var startedAt = Date.now();
      // All cores but two, up to 12. SFX go in bigger batches: each file takes
      // only tens of milliseconds, so starting a worker per few files would
      // dominate. Music batches are 3: each file takes seconds, and
      // smaller batches keep the panel's decodes and the workers overlapping
      // and shorten the wait on the last batches.
      var cores = (os.cpus().length || 4) - 2;
      var ramWorkers = Math.floor(os.totalmem() / (3 * 1024 * 1024 * 1024));
      var workers = Math.max(1, section === "sfx" ? Math.min(12, cores) : Math.min(12, cores, ramWorkers));
      var batchSize = section === "sfx" ? 24 : 3;
      function progress() {
        _libShowScanProgress(startedAt);
      }
      libScanCancelBtn.disabled = false;
      setTranslatedText(libScanCancelBtn, "library.scanCancel");
      libScanOverlay.hidden = false;
      function runner() {
        if (libScan.stop || queue.length === 0) {
          return Promise.resolve();
        }
        var batch = queue.splice(0, batchSize);
        return _libAnalyzeBatch(section, batch).then(function () {
          _persistSoundLibrarySoon();
          progress();
          return runner();
        });
      }
      progress();
      var runners = [];
      for (var w = 0; w < workers; w++) {
        runners.push(runner());
      }
      Promise.all(runners).then(function () {
        var stopped = libScan.stop;
        var summary = { done: libScan.done - libScan.failed, failed: libScan.failed, seconds: Math.round((Date.now() - startedAt) / 1000) };
        libScan.running = false;
        libScan.stop = false;
        libScanChildren = [];
        libScanOverlay.hidden = true;
        persistSoundLibrary();
        setTranslatedText(libScanStatus, stopped ? "library.scanStopped" : (summary.failed ? "library.scanDoneFailed" : "library.scanDone"), summary);
        log("Library scan (" + section + ") " + (stopped ? "stopped" : "finished") + ": " + summary.done + " analyzed (" +
            libScan.fromName + " straight from the file name), " + summary.failed + " unreadable, " + summary.seconds + " s.");
        renderLibrary();
      });
    }
    // Library-wide actions (Clear, Save a copy, Load a copy): no section is
    // current here, so they act on the whole library, Music and SFX. Clear
    // forgets every analysis result - a large library takes minutes to
    // rescan - so it needs a second click within 4 s.
    var clearLibraryBtn = document.getElementById("clearLibraryBtn");
    var libraryAdminStatus = document.getElementById("libraryAdminStatus");
    var _libClearArmedTimer = null;
    clearLibraryBtn.addEventListener("click", function () {
      if (libScan.running) {
        setTranslatedText(libraryAdminStatus, "library.busyScanning");
        return;
      }
      if (!_libClearArmedTimer) {
        setTranslatedText(clearLibraryBtn, "library.clearConfirm");
        _libClearArmedTimer = setTimeout(function () {
          _libClearArmedTimer = null;
          setTranslatedText(clearLibraryBtn, "library.clear");
        }, 4000);
        return;
      }
      clearTimeout(_libClearArmedTimer);
      _libClearArmedTimer = null;
      setTranslatedText(clearLibraryBtn, "library.clear");
      SL.SECTIONS.forEach(function (section) { SL.clearSection(section); });
      window.BeatMarkerLibrary.clear();
      persistSoundLibrary();
      persistLibrary();
      renderLibrary();
      setTranslatedText(libraryAdminStatus, "library.cleared");
      log("Library cleared (Music and SFX) - the folders stay; Rescan analyzes them again.");
    });
    // Save a copy / Load a copy. The copy is one JSON file: the folder
    // library as is (records keep size and modification time, so a Rescan
    // after loading skips unchanged files) plus the timeline-analyzed clips'
    // tempo and key. Loading ADDS to the current library - see
    // js/sound-library.js's mergeState() - so it can never wipe anything.
    var BACKUP_FORMAT = "downbeat-library-backup";
    document.getElementById("saveLibraryBackupBtn").addEventListener("click", function () {
      var tracks = window.BeatMarkerLibrary.getAll().map(function (e) {
        return { mediaPath: e.mediaPath, label: e.label, bpm: e.bpm || null, key: e.key || null, scale: e.scale || null,
                 strength: e.strength === undefined ? null : e.strength, camelot: e.camelot || null, material: e.material || null };
      });
      var fileCount = Object.keys(SL.getState().files).length;
      if (fileCount === 0 && tracks.length === 0) {
        setTranslatedText(libraryAdminStatus, "library.exportEmpty");
        return;
      }
      _pickSaveFileDialog("downbeat-library-copy.json", I18n.t("library.backupSave"))
        .then(function (picked) {
          if (!picked.path) {
            return; // cancelled
          }
          var backup = { format: BACKUP_FORMAT, version: 1, savedAt: new Date().toISOString(),
                         soundLibrary: SL.getState(), trackLibrary: tracks };
          window.cep_node.require("fs").writeFileSync(picked.path, JSON.stringify(backup), "utf8");
          setTranslatedText(libraryAdminStatus, "library.backupSaved", { files: fileCount + tracks.length });
          log("Library copy saved to " + picked.path + " (" + fileCount + " folder file(s), " + tracks.length + " timeline clip(s)).");
        })
        .catch(function (err) {
          log("Save a copy failed: " + (err && err.message ? err.message : err));
          setTranslatedText(libraryAdminStatus, "library.backupFailed", { error: err && err.message ? err.message : String(err) });
        });
    });

    document.getElementById("loadLibraryBackupBtn").addEventListener("click", function () {
      if (libScan.running) {
        setTranslatedText(libraryAdminStatus, "library.busyScanning");
        return;
      }
      _pickOpenFileDialog(I18n.t("library.backupPick"))
        .then(function (picked) {
          if (!picked.path) {
            return; // cancelled
          }
          var backup;
          try {
            backup = JSON.parse(window.cep_node.require("fs").readFileSync(picked.path, "utf8"));
          } catch (e) {
            backup = null;
          }
          if (!backup || backup.format !== BACKUP_FORMAT) {
            setTranslatedText(libraryAdminStatus, "library.backupInvalid");
            return;
          }
          var added = SL.mergeState(backup.soundLibrary);
          var current = window.BeatMarkerLibrary.getAll();
          var have = {};
          current.forEach(function (e) { have[e.mediaPath] = true; });
          var newTracks = (Array.isArray(backup.trackLibrary) ? backup.trackLibrary : []).filter(function (e) {
            return e && typeof e.mediaPath === "string" && !have[e.mediaPath];
          });
          window.BeatMarkerLibrary.loadEntries(current.concat(newTracks));
          persistSoundLibrary();
          persistLibrary();
          renderLibrary();
          setTranslatedText(libraryAdminStatus, "library.backupLoaded",
            { files: added.files + newTracks.length, folders: added.folders });
          log("Library copy loaded from " + picked.path + ": " + added.files + " folder file(s), " + newTracks.length +
              " timeline clip(s), " + added.folders + " folder(s) added.");
        })
        .catch(function (err) {
          log("Load a copy failed: " + (err && err.message ? err.message : err));
          setTranslatedText(libraryAdminStatus, "library.backupFailed", { error: err && err.message ? err.message : String(err) });
        });
    });
    // After Delete my data the saved Music / SFX library is empty, so the
    // in-memory one is reset too (main.js clears the track library itself).
    function resetAfterDeleteData() {
      clearTimeout(_libPersistTimer);
      _libPersistTimer = null;
      SL.loadState(null);
      libSelectedPath = null;
      renderLibrary();
    }
    function applySettings(settings) {
      if (settings.libraryFolderScope && typeof settings.libraryFolderScope === "object") {
        ["music", "sfx"].forEach(function (sec) {
          var list = settings.libraryFolderScope[sec];
          _libScope[sec] = Array.isArray(list) ? list.filter(function (p) { return typeof p === "string"; }) : [];
        });
      }
      if (_libPlayer && typeof settings.libPreviewVolume === "number") {
        libPaneVolume.value = String(settings.libPreviewVolume);
        _libPlayer.setVolume(settings.libPreviewVolume / 100);
      }
    }

    return {
      renderLibrary: renderLibrary,
      renderLibraryKeySelect: renderLibraryKeySelect,
      renderLibrarySortSelect: renderLibrarySortSelect,
      loadSoundLibrary: loadSoundLibrary,
      focusKeys: _libFocusKeys,
      resetAfterDeleteData: resetAfterDeleteData,
      applySettings: applySettings
    };
  }

  global.BeatMarkerLibraryTab = { create: create };
})(window);
