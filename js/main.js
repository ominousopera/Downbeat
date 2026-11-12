// The panel's main script. It starts the panel (language, look, tabs, the
// first-run tour) and runs the Analyze and Key tabs: the analysis pipeline
// (essentia, then Beat This!), the tempo and "1" controls, marker placement,
// Shift, Detect key and the pitch calculator. It also runs the selection poll
// that follows the clip selected in the host. It owns
// the panel's shared state (the current analysis, key and settings) and hands
// it to the parts that live in their own files:
//   js/bridge.js          host calls (jsx/host.jsx) and the analysis workers
//   js/settings-panel.js  settings, diagnostics, Guide / licenses, Delete my
//                         data
//   js/library-tab.js     the Library tab (folders, scan, search, preview,
//                         In key)
//   js/beat-preview.js    the Analyze tab's waveform player and its notes
//   js/self-test.js       the built-in self-test
// Each of them gets what it needs from here through a small ctx object;
// main.js reaches them through the functions next to each create() call.
(function () {
  "use strict";
  var statusEl = document.getElementById("status");
  var logEl = document.getElementById("log");
  var I18n = window.BeatMarkerI18n;
  // Text the script (not the markup) puts on screen through a translation
  // key, remembered per element so a language switch re-translates it.
  var _translatedTexts = [];
  function setTranslatedText(el, key, vars) {
    var text = I18n.t(key, vars);
    el.textContent = text;
    for (var i = 0; i < _translatedTexts.length; i++) {
      if (_translatedTexts[i].el === el) {
        _translatedTexts.splice(i, 1);
        break;
      }
    }
    _translatedTexts.push({ el: el, key: key, vars: vars, text: text });
  }
  // "A minor" keeps its note letter; only the scale word follows the panel
  // language (Russian "minor"/"major" words, Spanish "A menor").
  function _localKeyName(key, scale) {
    return key + " " + I18n.t(scale === "minor" ? "key.scaleMinor" : "key.scaleMajor");
  }
  function _retranslateTexts() {
    for (var i = 0; i < _translatedTexts.length; i++) {
      var r = _translatedTexts[i];
      if (r.el.textContent !== r.text) {
        continue; // written to by something else since - not ours to restore
      }
      r.text = I18n.t(r.key, r.vars);
      r.el.textContent = r.text;
    }
  }
  // Busy overlay: shown for the duration of any operation that talks to
  // Premiere or essentia (evalScript round-trips, decode, analysis), so a
  // working panel cannot be mistaken for a frozen one. Text is looked up by
  // i18n key so it is translated with everything else.
  var busyOverlay = document.getElementById("busyOverlay");
  var busyOverlayText = document.getElementById("busyOverlayText");
  var busyDismissBtn = document.getElementById("busyDismissBtn");
  var busyStuckTimer = null;
  var _busyDepth = 0;
  function showBusy(textKey) {
    _busyDepth++;
    setTranslatedText(busyOverlayText, textKey || "busy.default");
    busyOverlay.hidden = false;
    busyOverlay.classList.remove("is-stuck");
    clearTimeout(busyStuckTimer);
    busyStuckTimer = setTimeout(function () {
      busyOverlay.classList.add("is-stuck");
    }, 15000);
  }
  function hideBusy() {
    _busyDepth = Math.max(0, _busyDepth - 1);
    if (_busyDepth > 0) {
      return; // at least one other operation is still in flight - keep the overlay up
    }
    clearTimeout(busyStuckTimer);
    busyOverlay.hidden = true;
    busyOverlay.classList.remove("is-stuck");
  }
  busyDismissBtn.addEventListener("click", function () {
    _busyDepth = 0; // explicit user override - force-clear regardless of how many operations are believed to still be in flight
    hideBusy();
    log("WARNING: busy overlay dismissed manually after taking a long time - the underlying operation may still be running in the background and could still finish or fail later.");
  });
  function log(message) {
    var line = "[" + new Date().toLocaleTimeString() + "] " + message;
    console.log(line);
    logEl.textContent += line + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }
  // Loud warning when most events were dropped for being outside the
  // selected clip's in/out range; the "dropped" count at the end of a normal
  // log line is easy to miss.
  function warnIfMostlyDropped(requestedCount, droppedCount) {
    var total = requestedCount + droppedCount;
    if (total > 0 && droppedCount / total > 0.5) {
      log("WARNING: " + droppedCount + " of " + total + " events were outside the selected " +
          "clip's range and dropped. Likely cause: the selected clip is a small fragment " +
          "(e.g. a piece left over from a previous cut), not the full track - select the " +
          "clip/range you actually meant to use and try again.");
    }
  }
  function basename(path) {
    var parts = path.split(/[\\/]/);
    return parts[parts.length - 1];
  }
  function _formatPlayerTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) { seconds = 0; }
    var total = Math.floor(seconds);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  }
  // Fire-and-log save - called after every library mutation.
  function persistLibrary() {
    // One host saves at a time (see "One save at a time" in
    // js/persistence.js): a later run of the save takes in what the other
    // host kept meanwhile.
    window.BeatMarkerPersistence.inTurn(csInterface, "library", _saveLibraryNow);
  }
  function _saveLibraryNow() {
    // Another host may have saved since (Premiere and After Effects share
    // Documents/Downbeat): its newer entries are taken in first.
    var fresh = window.BeatMarkerPersistence.readIfChanged(csInterface, "library");
    if (fresh.unavailable) {
      log("WARNING: the track library file could not be checked just now (Documents/Downbeat); not saved this time, nothing changed on disk.");
      return;
    }
    if (fresh.deleted) {
      _library.dataDeletedElsewhere();
      if (!fresh.changed) {
        return; // Delete my data ran in the other host: nothing is written back
      }
    }
    if (fresh.changed) {
      window.BeatMarkerLibrary.absorb(fresh.value);
    }
    _takeInKeptCopies("The track library file", fresh, window.BeatMarkerLibrary.absorb);
    var result = window.BeatMarkerPersistence.save(csInterface, window.BeatMarkerLibrary.getAll(), window.BeatMarkerLibrary.meta());
    noteSaveResult("library", result);
    if (!result.ok) {
      log("WARNING: could not save the track library to disk: " + result.error);
    } else if (result.keptIn) {
      log("The other host was saving library.json; this change is kept in " + result.keptIn + " and taken in by the next save.");
    }
  }

  // SAVED DATA PROBLEMS: the log is hidden, so a save that failed, or a
  // settings.json that could not be read, is said in one line under the
  // header, on every tab. A failed save is said until that file saves again;
  // a save that kept a complete copy lost nothing (the next start takes it
  // in) and is only logged.
  var _saveFailed = {}; // "settings" | "library" | "sound-library" -> true
  var _settingsReadProblem = null; // { key, vars, blocked } until the panel is reopened
  function _showDataProblem() {
    var row = document.getElementById("dataProblemRow");
    var line = document.getElementById("dataProblemStatus");
    if (!row || !line) {
      return;
    }
    var failed = Object.keys(_saveFailed).length > 0;
    if (failed) {
      setTranslatedText(line, "settings.saveFailed");
    } else if (_settingsReadProblem) {
      setTranslatedText(line, _settingsReadProblem.key, _settingsReadProblem.vars);
    } else {
      line.textContent = "";
    }
    line.classList.toggle("is-error", failed || !!(_settingsReadProblem && _settingsReadProblem.blocked));
    row.hidden = !failed && !_settingsReadProblem;
  }
  function noteSaveResult(kind, result) {
    var failed = !!result && !result.ok && !result.keptCopy &&
      // A settings.json that could not be opened is said already.
      !(kind === "settings" && _settingsReadProblem && _settingsReadProblem.blocked);
    if (failed === !!_saveFailed[kind]) {
      return;
    }
    if (failed) {
      _saveFailed[kind] = true;
    } else {
      delete _saveFailed[kind];
    }
    _showDataProblem();
  }
  // After a load or a check that recovered a data file (see "A save Windows
  // refused" in js/persistence.js): the older kept copies are taken in too,
  // and the log says what was used.
  function _takeInKeptCopies(what, result, absorb) {
    (result.takeIn || []).forEach(function (value) { absorb(value); });
    var note = window.BeatMarkerPersistence.recoveryNote(what, result);
    if (note) {
      log(note);
    }
  }
  var activeTabId = "analyze"; // kept by switchTab(); the Library keys only act on the Library tab
  // LIBRARY TAB: js/library-tab.js - the Music / SFX sections, folders and
  // scan, search, the list, the preview pane and In key. It reads what
  // main.js owns through the getters below; main.js reaches it through the
  // functions after.
  var _library = window.BeatMarkerLibraryTab.create({
    I18n: I18n,
    log: log,
    basename: basename,
    setTranslatedText: setTranslatedText,
    showBusy: showBusy,
    hideBusy: hideBusy,
    evalJson: evalJson,
    persistSettings: persistSettings,
    persistLibrary: persistLibrary,
    formatPlayerTime: _formatPlayerTime,
    localKeyName: _localKeyName,
    jsxJsonArg: _jsxJsonArg,
    jsxStringArg: _jsxStringArg,
    resolveNodeExecutable: _resolveNodeExecutable,
    activeTabId: function () { return activeTabId; },
    csInterface: function () { return csInterface; },
    hostIsAe: function () { return hostIsAe; },
    initialSettings: function () { return initialSettings; },
    noteSaveResult: noteSaveResult,
    selectedPlayback: _selectedPlayback,
    tempFileStarted: function () { _bridge.tempFileStarted(); },
    tempFileDone: function () { _bridge.tempFileDone(); },
    translateHostReason: function (message) { return _translateHostReason(message); },
    failureReason: function (message) { return _failureReason(message); }
  });
  var SL = window.BeatMarkerSoundLibrary;
  var LP = window.BeatMarkerLibPreview;
  function renderLibrary() {
    if (keyResultDisplay) { _refreshPlaybackConsumers(); }
    return _library.renderLibrary.apply(null, arguments);
  }
  function renderLibraryKeySelect() {
    return _library.renderLibraryKeySelect.apply(null, arguments);
  }
  function renderLibrarySortSelect() {
    return _library.renderLibrarySortSelect.apply(null, arguments);
  }
  function loadSoundLibrary() {
    return _library.loadSoundLibrary.apply(null, arguments);
  }
  function _libFocusKeys() {
    return _library.focusKeys.apply(null, arguments);
  }
  // SETTINGS AND DIAGNOSTICS: js/settings-panel.js - the popover, Copy log,
  // the text viewer for the Guide and the licenses, external links, Delete my
  // data and the plugin version.
  var _settingsPanel = window.BeatMarkerSettingsPanel.create({
    I18n: I18n,
    log: log,
    logEl: logEl,
    setTranslatedText: setTranslatedText,
    showBusy: showBusy,
    hideBusy: hideBusy,
    persistSettings: persistSettings,
    library: _library,
    bridge: function () { return _bridge; },
    csInterface: function () { return csInterface; },
    initialSettings: function () { return initialSettings; },
    resetSettingsAfterDelete: resetSettingsAfterDelete,
    dialogsChanged: function () { _registerKeyInterest(); }
  });
  function closeSettingsPanel() {
    return _settingsPanel.closeSettingsPanel.apply(null, arguments);
  }
  function getPluginVersion() {
    return _settingsPanel.getPluginVersion.apply(null, arguments);
  }
  var csInterface = new CSInterface();
  // Host and worker calls (js/bridge.js) - made first, before anything that
  // might reach the host.
  var _bridge = window.BeatMarkerBridge.create({ csInterface: csInterface });
  // Language: applied before anything else renders, so the first paint (and
  // every log line and UI string after it) is already in the right language.
  // loadSettings() is synchronous, so this can run inline before the rest of
  // startup.
  var loadedSettings = window.BeatMarkerPersistence.loadSettings(csInterface);
  var initialSettings = (loadedSettings.ok && loadedSettings.settings) ? loadedSettings.settings : {};
  // An unreadable settings.json was set aside (or, when it could not be
  // read at all, is left alone and not saved over); logged once the log
  // exists, and said on screen (_showDataProblem) once the language is set.
  var _settingsLoadProblem = loadedSettings.ok ? null : loadedSettings;
  if (_settingsLoadProblem) {
    _settingsReadProblem = _settingsLoadProblem.setAside
      ? { key: "settings.loadSetAside", vars: { file: basename(_settingsLoadProblem.setAside) } }
      : { key: "settings.loadBlocked", blocked: true };
  }
  // Saved Library choices that live in code loaded above (this part of
  // main.js runs after the Library's own setup).
  if (window.BeatMarkerSfxSearch) {
    window.BeatMarkerSfxSearch.setSynonyms(initialSettings.librarySynonyms !== false);
  }
  _library.applySettings(initialSettings); // folder scope, preview volume
  _settingsPanel.applySettings(initialSettings); // the update notice
  var isFirstRun = loadedSettings.ok ? !loadedSettings.existed : !!loadedSettings.setAside;
  function persistSettings(overrides) {
    // Takes in what another host saved since, key by key: every key this
    // panel changes is stamped, and each key comes from whichever side
    // changed it last, so a change this panel could not save yet is not
    // lost either (see mergeSettings in js/persistence.js).
    // One host saves at a time (see "One save at a time" in
    // js/persistence.js): a later run of the save only takes in what the
    // other host kept meanwhile.
    var changes = overrides;
    window.BeatMarkerPersistence.inTurn(csInterface, "settings", function () {
      _saveSettingsNow(changes);
      changes = {};
    });
  }
  // Settings that are maps of one entry per song or clip (Shift values,
  // where Place last put timeline markers). Both hosts write them, so a save
  // sends only the entries this panel changed, on top of the map just read
  // from disk: the other host's entries stay (a whole map would replace
  // the other host's). Any entry shape is compared as a whole.
  var PER_ENTRY_SETTINGS = ["markerNudgeMs", "placedTimeline"];
  var _pendingEntryChanges = {}; // setting -> { entry key -> { value } | { removed: true } }, until a save works
  function _isPlainMap(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  // Notes, per entry, how `overrides` changes this panel's maps, and takes
  // those settings out of `overrides` (a copy is returned).
  function _takeEntryChanges(overrides) {
    var rest = {};
    for (var k in overrides) {
      if (!overrides.hasOwnProperty(k)) { continue; }
      if (PER_ENTRY_SETTINGS.indexOf(k) === -1 || !_isPlainMap(overrides[k])) {
        rest[k] = overrides[k];
        continue;
      }
      var before = _isPlainMap(initialSettings[k]) ? initialSettings[k] : {};
      var after = overrides[k];
      var pending = _pendingEntryChanges[k] || {};
      var e;
      for (e in after) {
        if (after.hasOwnProperty(e) && e !== "__proto__" &&
            (!before.hasOwnProperty(e) || JSON.stringify(before[e]) !== JSON.stringify(after[e]))) {
          pending[e] = { value: after[e] };
        }
      }
      for (e in before) {
        if (before.hasOwnProperty(e) && !after.hasOwnProperty(e)) { pending[e] = { removed: true }; }
      }
      if (Object.keys(pending).length) { _pendingEntryChanges[k] = pending; }
    }
    return rest;
  }
  // The map `name` of `base` with this panel's changed entries applied.
  function _withEntryChanges(base, name) {
    var map = {}, src = _isPlainMap(base[name]) ? base[name] : {}, e;
    for (e in src) {
      if (src.hasOwnProperty(e) && e !== "__proto__") { map[e] = src[e]; }
    }
    var pending = _pendingEntryChanges[name];
    for (e in pending) {
      if (pending.hasOwnProperty(e)) {
        if (pending[e].removed) { delete map[e]; } else { map[e] = pending[e].value; }
      }
    }
    return map;
  }
  function _entryChangeOverrides(base, overrides) {
    var out = {};
    for (var k in overrides) {
      if (overrides.hasOwnProperty(k)) { out[k] = overrides[k]; }
    }
    for (var name in _pendingEntryChanges) {
      if (_pendingEntryChanges.hasOwnProperty(name)) { out[name] = _withEntryChanges(base, name); }
    }
    return out;
  }
  function _saveSettingsNow(overrides) {
    overrides = _takeEntryChanges(overrides || {});
    var fresh = window.BeatMarkerPersistence.readIfChanged(csInterface, "settings");
    var changedAt = Date.now();
    if (fresh.unavailable) {
      log("WARNING: settings.json could not be checked just now; this change is kept in the panel and saved next time.");
      _applySettingsChanges(initialSettings, _entryChangeOverrides(initialSettings, overrides), changedAt);
      return;
    }
    if (fresh.deleted) {
      initialSettings = {}; // Delete my data ran in the other host: start from defaults
      // Only the first file read after it reports the deletion, and that
      // can be this one: the libraries in memory must go too, or their next
      // save would take the other host's new file in and write the deleted
      // entries back with it.
      _library.dataDeletedElsewhere();
    }
    _takeInKeptCopies("settings.json", fresh, function () {});
    var otherSaved = fresh.changed && fresh.value && typeof fresh.value === "object" && !Array.isArray(fresh.value);
    var base = otherSaved ? window.BeatMarkerPersistence.mergeSettings(initialSettings, fresh.value) : initialSettings;
    var merged = {};
    for (var existingKey in base) {
      if (base.hasOwnProperty(existingKey)) {
        merged[existingKey] = base[existingKey];
      }
    }
    merged.language = !otherSaved || !merged.language ? I18n.getLanguage() : merged.language;
    if (merged.onboardingCompleted === undefined) {
      merged.onboardingCompleted = false;
    }
    // The changed entries go on top of the other host's map when it saved
    // since (its map is the newest on disk), else on top of this panel's.
    var mapsFrom = {};
    for (var pm = 0; pm < PER_ENTRY_SETTINGS.length; pm++) {
      var mapName = PER_ENTRY_SETTINGS[pm];
      mapsFrom[mapName] = otherSaved && _isPlainMap(fresh.value[mapName]) ? fresh.value[mapName] : merged[mapName];
    }
    _applySettingsChanges(merged, _entryChangeOverrides(mapsFrom, overrides), changedAt);
    initialSettings = merged;
    _nudgeByPath = _isPlainMap(merged.markerNudgeMs) ? merged.markerNudgeMs : {};
    var result = window.BeatMarkerPersistence.saveSettings(csInterface, merged);
    noteSaveResult("settings", result);
    if (result.ok || result.keptCopy || result.keptIn) {
      _pendingEntryChanges = {}; // on disk, or in a copy the next save or start takes in
    }
    if (!result.ok) {
      log("WARNING: could not save settings to disk: " + result.error);
    } else if (result.keptIn) {
      log("The other host was saving settings.json; this change is kept in " + result.keptIn + " and taken in by the next save.");
    }
  }

  // Delete my data removed settings.json (or some of the files): the
  // settings in memory go too, or the next change would write every old one
  // back. Only the panel language and "tour done" stay, so the panel does
  // not change under the user; Settings shows the defaults again.
  function resetSettingsAfterDelete() {
    initialSettings = { language: I18n.getLanguage(), onboardingCompleted: initialSettings.onboardingCompleted === true };
    _pendingEntryChanges = {};
    _nudgeByPath = {};
    _updateNudgeUi();
    _settingsPanel.applySettings(initialSettings);
    // The unreadable settings.json and its kept bytes went with the rest.
    if (_settingsReadProblem) {
      _settingsReadProblem = null;
      _showDataProblem();
    }
  }
  // Sets `overrides` on a settings object and stamps each of those keys
  // in its settingsChangedAt (see persistSettings).
  function _applySettingsChanges(target, overrides, at) {
    var times = {};
    var old = target.settingsChangedAt;
    if (old && typeof old === "object" && !Array.isArray(old)) {
      for (var o in old) {
        if (o !== "__proto__" && old.hasOwnProperty(o)) { times[o] = old[o]; }
      }
    }
    for (var k in overrides) {
      if (overrides.hasOwnProperty(k)) {
        target[k] = overrides[k];
        times[k] = at;
      }
    }
    target.settingsChangedAt = times;
  }
  var isPanelReady = false;
  function refreshDynamicTranslations() {
    _retranslateTexts();
    if (window.BeatMarkerTour && window.BeatMarkerTour.refresh) { window.BeatMarkerTour.refresh(); } // an open tour step
    populatePitchSelects(); // option labels carry translated scale names
    renderLibraryKeySelect(); // same
    renderLibrarySortSelect(); // same
    renderLibrary();
    renderKeyResult();
    if (isPanelReady) {
      setTranslatedText(statusEl, "status.ready");
    }
    _rebuildSelectionStatus();
  }
  function setActiveLanguageButtons(lang) {
    var buttons = document.querySelectorAll(".lang-btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-active", buttons[i].getAttribute("data-lang") === lang);
    }
  }
  function applyLanguage(lang, isInitialBoot) {
    I18n.setLanguage(lang);
    I18n.applyStaticTranslations();
    setActiveLanguageButtons(lang);
    // Texts set before the first call, while the saved settings are applied
    // (Settings' audio output line), are translated again here.
    _retranslateTexts();
    if (!isInitialBoot) {
      refreshDynamicTranslations();
      persistSettings({ language: lang });
    }
  }
  (function () {
    // Button labels are the native name of each language (in its own script,
    // not translated), set here from I18n.LANGUAGE_NAMES so index.html itself
    // stays plain ASCII.
    var buttons = document.querySelectorAll(".lang-btn");
    for (var i = 0; i < buttons.length; i++) {
      var lang = buttons[i].getAttribute("data-lang");
      buttons[i].textContent = I18n.LANGUAGE_NAMES[lang] || lang;
      buttons[i].addEventListener("click", function () {
        applyLanguage(this.getAttribute("data-lang"));
        document.getElementById("langPickOverlay").hidden = true;
      });
    }
  })();
  var initialLanguage = initialSettings.language && I18n.LANGUAGES.indexOf(initialSettings.language) !== -1
    ? initialSettings.language
    : "en";
  applyLanguage(initialLanguage, true);
  // The host's panel color (appSkinInfo.panelBackgroundColor) becomes --bg,
  // with the other surfaces a few steps lighter or darker, set on <body>; it
  // follows the host's brightness setting (ThemeColorChanged). Only for a
  // dark host: the panel's light text needs a dark background, so a light
  // host keeps the panel's own near-black.
  var HOST_BG_VARS = ["--bg", "--bg-panel", "--bg-raised", "--bg-well", "--border", "--rule"];
  function applyHostBackground() {
    var st = document.body && document.body.style;
    if (!st || typeof st.setProperty !== "function") {
      return;
    }
    HOST_BG_VARS.forEach(function (v) { st.removeProperty(v); });
    var rgb = null;
    try {
      var skin = csInterface.getHostEnvironment().appSkinInfo;
      var c = skin && skin.panelBackgroundColor && skin.panelBackgroundColor.color;
      if (c && typeof c.red === "number") {
        rgb = [Math.round(c.red), Math.round(c.green), Math.round(c.blue)];
      }
    } catch (skinErr) {
      rgb = null;
    }
    var useHost = !!rgb && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 <= 0.4;
    var bg = useHost ? rgb : [14, 14, 14]; // the panel's own near-black otherwise
    if (useHost) {
      var shade = function (d) {
        return "rgb(" + rgb.map(function (v) { return Math.max(0, Math.min(255, v + d)); }).join(", ") + ")";
      };
      st.setProperty("--bg", shade(0));
      st.setProperty("--bg-panel", shade(5));
      st.setProperty("--bg-raised", shade(9));
      st.setProperty("--bg-well", shade(-6));
      st.setProperty("--border", shade(12));
      st.setProperty("--rule", shade(26));
    }
    // Text levels by contrast against the actual background. Secondary text
    // (labels, inactive choices) 7:1, hints 4.5:1 (WCAG's minimum for small
    // text), control outlines 3:1.
    st.setProperty("--text-dim", _grayForContrast(bg, 7));
    st.setProperty("--text-faint", _grayForContrast(bg, 4.5));
    st.setProperty("--border-bright", _grayForContrast(bg, 3));
  }
  // The lightest-needed gray that reaches `ratio` against `bgRgb` (WCAG
  // relative luminance), as "rgb(g, g, g)".
  function _grayForContrast(bgRgb, ratio) {
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var bgL = 0.2126 * lin(bgRgb[0]) + 0.7152 * lin(bgRgb[1]) + 0.0722 * lin(bgRgb[2]);
    var target = Math.min(1, ratio * (bgL + 0.05) - 0.05);
    var c = target <= 0.0031308 ? target * 12.92 : 1.055 * Math.pow(target, 1 / 2.4) - 0.055;
    var g = Math.max(0, Math.min(255, Math.ceil(c * 255)));
    return "rgb(" + g + ", " + g + ", " + g + ")";
  }
  applyHostBackground();
  if (typeof csInterface.addEventListener === "function") {
    csInterface.addEventListener("com.adobe.csxs.events.ThemeColorChanged", applyHostBackground);
  }
  // Tabs are matched by a data-tab attribute shared between each .tab-btn and
  // its .tab-content.
  var tabButtons = document.querySelectorAll(".tab-btn");
  var tabContents = document.querySelectorAll(".tab-content");
  // Keys the panel takes from the host: while the Library tab is shown the
  // arrows, Space and Return / Enter, for its keyboard navigation (other
  // tabs give them back); while Settings or one of its dialogs is open, Esc,
  // which closes the one on top (settings-panel.js) - without it Premiere
  // and After Effects keep Esc even with the panel in front. Key codes are
  // the system's own, and one system's codes are other keys on the other
  // (Windows reads 76 as L), so each gets its own. "" when none: CEP
  // rejects "[]".
  function _keyInterest(tabId) {
    var osName = "";
    try { osName = String(csInterface.getOSInformation() || ""); } catch (osErr) { osName = ""; }
    if (!osName && typeof navigator !== "undefined") {
      osName = String(navigator.platform || "");
    }
    var win = /^\s*win/i.test(osName);
    var codes = tabId === "library" ? (win ? [38, 40, 32, 13] : [126, 125, 49, 36, 76]) : [];
    if (_panelDialogOpen()) {
      codes.push(win ? 27 : 53);
    }
    return codes.length ? JSON.stringify(codes.map(function (c) { return { keyCode: c }; })) : "";
  }
  function _panelDialogOpen() {
    var ids = ["settingsPanel", "textViewerOverlay", "externalLinkOverlay", "deleteDataOverlay"];
    for (var d = 0; d < ids.length; d++) {
      var el = document.getElementById(ids[d]);
      if (el && !el.hidden) {
        return true;
      }
    }
    return false;
  }
  // Asked again only when the keys change: closing a dialog with Esc while
  // Settings stays open asks for the same Esc, and asking again during the
  // key press can leave a floating panel window without the keyboard, so a
  // second Esc would not reach Settings.
  var _keyInterestAsked = null;
  function _registerKeyInterest() {
    var interest = _keyInterest(activeTabId);
    if (interest === _keyInterestAsked) {
      return;
    }
    if (typeof csInterface !== "undefined" && csInterface && typeof csInterface.registerKeyEventsInterest === "function") {
      try {
        csInterface.registerKeyEventsInterest(interest);
        _keyInterestAsked = interest;
      } catch (keyErr) {
        log("Keyboard keys could not be requested from the host: " + keyErr);
      }
    }
  }
  // Idempotent: switching to the tab that is already active does nothing
  // (no scroll reset). That matters because js/tour.js calls this on every
  // step that has a `tab`, even consecutive steps on the same tab, and each
  // Next click must not scroll to the top.
  function switchTab(tabId) {
    activeTabId = tabId;
    // The Library fills the panel's height (css body.on-library), and its
    // list takes the keyboard (the arrows go to Premiere's timeline unless a
    // panel field has the focus - see _libFocusKeys).
    if (document.body && document.body.classList) {
      document.body.classList.toggle("on-library", tabId === "library");
    }
    if (tabId === "library") {
      setTimeout(function () { _libFocusKeys(); }, 0);
    }
    // The "select an audio clip" line is about Analyze and Key; the Library
    // tab hides it.
    var selectionRow = document.getElementById("selectionStatusRow");
    if (selectionRow) {
      selectionRow.hidden = tabId === "library";
    }
    // The clip line sits on the right of the tab's first heading
    // ("01 / Clip song.wav"), moved into that tab's .g-clip-slot; the Library
    // has none.
    var clipLine = document.getElementById("selectionStatusDisplay");
    var slot = tabId === "analyze" ? document.getElementById("analyzeClipSlot")
      : tabId === "key" ? document.getElementById("keyClipSlot") : null;
    if (clipLine && slot && clipLine.parentNode !== slot && typeof slot.appendChild === "function") {
      slot.appendChild(clipLine);
    }
    _registerKeyInterest();
    var alreadyActive = false;
    for (var i = 0; i < tabContents.length; i++) {
      var isMatch = tabContents[i].getAttribute("data-tab") === tabId;
      if (isMatch && tabContents[i].classList.contains("is-active")) {
        alreadyActive = true;
      }
      tabContents[i].classList.toggle("is-active", isMatch);
    }
    for (var j = 0; j < tabButtons.length; j++) {
      tabButtons[j].classList.toggle("is-active", tabButtons[j].getAttribute("data-tab") === tabId);
    }
    if (!alreadyActive) {
      window.scrollTo(0, 0); // each newly-selected tab starts at its own top, not wherever the previous tab happened to be scrolled to
    }
  }
  (function () {
    for (var i = 0; i < tabButtons.length; i++) {
      tabButtons[i].addEventListener("click", function () {
        switchTab(this.getAttribute("data-tab"));
      });
    }
  })();
  switchTab("analyze"); // default tab on every load; deliberately not persisted
  window.BeatMarkerTabs = { switchTab: switchTab };
  statusEl.removeAttribute("data-i18n"); // from here on "ready" is tracked via isPanelReady/refreshDynamicTranslations, not the generic static pass
  isPanelReady = true;
  setTranslatedText(statusEl, "status.ready");
  statusEl.classList.add("is-ready");
  window.BeatMarkerWheel.renderWheel(document.getElementById("camelotWheel"), null);
  renderLibrary(); // sets the translated empty-state text - otherwise a fresh install (no library.json yet) shows the raw English HTML fallback until the first Analyze/Detect key
  window.BeatMarkerSelect.enhanceAll(); // drawn dropdowns over every <select> - see js/ui-select.js
  log("panel loaded");
  log("Downbeat version: " + getPluginVersion());
  log("host app: " + csInterface.getHostEnvironment().appName + " " + csInterface.getHostEnvironment().appVersion);
  log("userAgent: " + navigator.userAgent);
  setTranslatedText(document.getElementById("settingsFooterText"), "settings.footer", { version: getPluginVersion() });
  // First-run onboarding: the language picker (on the very first launch,
  // when no settings.json existed yet) and then the guided tour. It is not
  // shown again automatically; "Replay the tour" in Settings shows it on
  // purpose.
  window.BeatMarkerTour.wireButtons();
  document.getElementById("replayTourBtn").addEventListener("click", function () {
    closeSettingsPanel();
    window.BeatMarkerTour.start(function () {
      persistSettings({ onboardingCompleted: true });
    });
  });
  // One question, asked once: whether to switch on the update notice. Asked
  // on the first run (after the language) and once for anyone who has not
  // answered yet. Either answer is saved, so it is never asked again.
  function askAboutUpdateNotice(then) {
    if (typeof initialSettings.updateCheck === "boolean") {
      then();
      return;
    }
    var overlay = document.getElementById("updatePickOverlay");
    overlay.hidden = false;
    function answer(on) {
      overlay.hidden = true;
      persistSettings({ updateCheck: on });
      _settingsPanel.applySettings(initialSettings);
      then();
    }
    document.getElementById("updatePickYesBtn").addEventListener("click", function () { answer(true); }, { once: true });
    document.getElementById("updatePickNoBtn").addEventListener("click", function () { answer(false); }, { once: true });
  }
  function startTourOnce() {
    window.BeatMarkerTour.start(function () {
      persistSettings({ onboardingCompleted: true });
    });
  }
  if (isFirstRun) {
    document.getElementById("langPickOverlay").hidden = false;
    var onLangPicked = function () {
      document.getElementById("langPickOverlay").hidden = true;
      askAboutUpdateNotice(startTourOnce);
    };
    var pickButtons = document.querySelectorAll("#langPickOverlay .lang-btn");
    for (var pb = 0; pb < pickButtons.length; pb++) {
      pickButtons[pb].addEventListener("click", onLangPicked, { once: true });
    }
  } else if (_settingsReadProblem && _settingsReadProblem.blocked) {
    // settings.json is there but could not be opened: not a first run, and
    // no answer could be saved, so nothing is asked and no tour starts.
  } else if (!initialSettings.onboardingCompleted) {
    askAboutUpdateNotice(startTourOnce);
  } else {
    askAboutUpdateNotice(function () {});
  }
  _takeInKeptCopies("settings.json", loadedSettings, function () {});
  if (_settingsLoadProblem) {
    log("WARNING: could not read settings.json (" + _settingsLoadProblem.error + ")" +
        (_settingsLoadProblem.setAside ? " - kept as " + _settingsLoadProblem.setAside + "; starting with default settings." :
          " - it is left as it is and settings are not saved until the host restarts."));
    _showDataProblem();
  }

  (function sweepLeftoverTempFiles() {
    var result = window.BeatMarkerPersistence.clearLeftoverTempFiles(csInterface);
    if (!result.ok) {
      log("WARNING: could not clear leftover temp files: " + result.error);
    } else if (result.removed > 0) {
      log("Removed " + result.removed + " leftover temp file(s) from an interrupted analysis.");
    }
  })();
  (function loadPersistedLibrary() {
    var result = window.BeatMarkerPersistence.load(csInterface);
    if (!result.ok) {
      log("WARNING: could not load the saved track library: " + result.error +
          (result.setAside ? " - kept as " + result.setAside + "." : " - it is left as it is and not saved over until the host restarts."));
      _library.reportLoadProblem(result);
      return;
    }
    if (!result.existed) {
      log("No saved track library yet (Documents/Downbeat/" + basename(result.path) + ").");
      return;
    }
    window.BeatMarkerLibrary.loadEntries(result.entries);
    _takeInKeptCopies("The track library file", result, window.BeatMarkerLibrary.absorb);
    log("Loaded " + window.BeatMarkerLibrary.getAll().length + " track(s) from a previous session (Documents/Downbeat/" + basename(result.path) + ").");
  })();
  loadSoundLibrary();
  // HOST AND WORKER CALLS: js/bridge.js. _bridge is made right after
  // csInterface (above); these thin wrappers forward to it.
  function _jsxJsonArg() {
    return _bridge.jsxJsonArg.apply(null, arguments);
  }
  function _jsxStringArg() {
    return _bridge.jsxStringArg.apply(null, arguments);
  }
  function evalJson() {
    return _bridge.evalJson.apply(null, arguments);
  }
  var selectedClipInfo = null;
  function getClipInfo() {
    return _bridge.getClipInfo.apply(null, arguments).then(function (clip) {
      selectedClipInfo = clip;
      return clip;
    }, function (error) {
      selectedClipInfo = null;
      throw error;
    });
  }
  function _selectedPlayback() {
    var clip = selectedClipInfo;
    if (!clip) { return null; }
    var entry = window.BeatMarkerLibrary.get(clip.mediaPath);
    var scope = _keyScopeFor(clip);
    var key = lastKeyResult && lastKeyResult.mediaPath === clip.mediaPath && lastKeyResult.scopeKey === scope ? lastKeyResult :
      window.BeatMarkerLibrary.getKey(clip.mediaPath, scope);
    var bpm = entry && (entry.confirmedBpm ? entry.confirmedBpm.value : entry.bpm);
    var view = window.BeatMarkerPitch.playback(clip.speed || 1, bpm, key && key.camelot);
    if (!view) { return null; }
    view.clip = clip;
    // What the plan on screen depends on. The clip's place and track are
    // left out: moving it, or a layer added above it, changes no number of
    // the plan, and the host checks the exact clip again before it acts.
    view.signature = JSON.stringify([clip.mediaPath, clip.inPointSeconds,
      clip.outPointSeconds, clip.speed, !!clip.reversed, scope, window.BeatMarkerLibrary.identityKey(clip.mediaPath),
      view.sourceCamelot, view.sourceBpm]);
    return view;
  }
  function _resolveNodeExecutable() {
    return _bridge.resolveNodeExecutable.apply(null, arguments);
  }
  var _bpmPassCache = window.BeatMarkerAnalysisCache.create(4);
  function runAnalyzeWorker(mode, samples, audioPath, constraint, material) {
    var args = arguments;
    if (mode === "beats" && constraint) {
      return _bpmPassCache.run(samples, audioPath, constraint, function () {
        return _bridge.runAnalyzeWorker.apply(null, args);
      });
    }
    return _bridge.runAnalyzeWorker(mode, samples, audioPath, constraint, material);
  }
  function runBeatThisWorker() {
    return _bridge.runBeatThisWorker.apply(null, arguments);
  }
  function runSkeyWorker() {
    return _bridge.runSkeyWorker.apply(null, arguments);
  }

  // Reject a result if its source changed while work was running.
  function _assertAudioUnchanged(clipInfo) {
    if (clipInfo.fileIdentity && !window.BeatMarkerLibrary.sameIdentity(
        clipInfo.fileIdentity, window.BeatMarkerLibrary.fileIdentity(clipInfo.mediaPath))) {
      throw new Error(I18n.t("analysis.fileChanged"));
    }
  }
  // Music keys combine the profile vote with S-KEY. On a long track whose
  // profile vote and S-KEY agree, the chord pass is skipped; when they
  // disagree, the chord pass runs and the three results go through the same
  // vote. If the S-KEY worker fails, the full detector (profile + chords) is
  // used instead. Short audio and sound effects keep their complete analysis.
  function _detectKey(samples44100, material, adaptive) {

    var conditional = material === "music" && adaptive !== false && samples44100.length >= 120 * 44100;
    var keyPromise = runAnalyzeWorker(conditional ? "keyVote" : "key", samples44100, null, null, material);
    var skeyPromise = material === "music"
      ? window.BeatMarkerAudio.resampleMono(samples44100, window.BeatMarkerAudio.TARGET_SAMPLE_RATE, 22050)
        .then(runSkeyWorker)
        .catch(function (err) {
          log("S-KEY (third key opinion) unavailable: " + (err && err.message ? err.message : err));
          return null;
        })
      : Promise.resolve(null);
    return Promise.all([keyPromise, skeyPromise]).then(function (both) {
      var result = both[0], skey = both[1];
      if (conditional && (!skey || !result.camelot)) {
        return runAnalyzeWorker("key", samples44100, null, null, material);
      }
      if (!skey || !result.camelot) { return result; }
      var skeyCamelot = window.BeatMarkerCamelot.toCamelotCode(skey.key, skey.scale);
      if (conditional && !skeyCamelot) { return runAnalyzeWorker("key", samples44100, null, null, material); }
      if (conditional && skeyCamelot !== result.camelot) {
        return runAnalyzeWorker("keyChord", samples44100, null, null, material).then(function (chords) {
          result.chordCamelot = chords.chordCamelot;
          result.witnessAvailable = !!chords.chordCamelot;
          result.corroborated = chords.chordCamelot === result.camelot;
          return finishKey(result, skey, skeyCamelot);
        }).catch(function () {
          return runAnalyzeWorker("key", samples44100, null, null, material).then(function (full) {
            return finishKey(full, skey, skeyCamelot);
          });
        });
      }
      if (conditional) { result.witnessSkipped = true; }
      return finishKey(result, skey, skeyCamelot);
    });
    function finishKey(result, skey, skeyCamelot) {
      var decision = window.BeatMarkerKeyCombine.combineMusicKey(result.camelot, result.chordCamelot, skeyCamelot);
      result.skeyCamelot = skeyCamelot;
      result.voteCamelot = result.camelot;
      result.agreement3 = decision.agreement;
      result.dissent = decision.dissent;
      result.keySource = decision.source;
      if (decision.camelot !== result.camelot) {
        result.camelot = decision.camelot;
        result.key = skey.key;
        result.scale = skey.scale;
        result.strength = null;
      }
      return result;
    }
  }
  // Builds a click track of `durationSec` seconds with one short decaying
  // click per beat at `bpm`, used by the Test essentia diagnostic.
  function buildSyntheticClickTrack(durationSec, bpm) {
    var sampleRate = window.BeatMarkerAudio.TARGET_SAMPLE_RATE;
    var n = Math.round(durationSec * sampleRate);
    var samples = new Float32Array(n);
    var beatIntervalSec = 60 / bpm;
    var beatCount = Math.floor(durationSec / beatIntervalSec);
    for (var beat = 0; beat < beatCount; beat++) {
      var startSample = Math.round(beat * beatIntervalSec * sampleRate);
      for (var k = 0; k < 400 && startSample + k < n; k++) {
        samples[startSample + k] = 0.8 * Math.exp(-k / 40);
      }
    }
    return samples;
  }
  // Isolates essentia.js and the subprocess machinery from real-file
  // read/decode: needs no clip selection, and runs a synthesized 60 s /
  // 120 BPM click track through the same runAnalyzeWorker("beats", ...) that
  // a real Analyze click uses.
  var testEssentiaBtn = document.getElementById("testEssentiaBtn");
  testEssentiaBtn.addEventListener("click", function () {
    testEssentiaBtn.disabled = true;
    showBusy("busy.default");
    var startedAt = Date.now();
    log("TEST ESSENTIA: building a synthetic 60s/120bpm click track (~120 beats) and running it through the real analysis pipeline (no file involved)...");
    var samples = buildSyntheticClickTrack(60, 120);
    runAnalyzeWorker("beats", samples, "synthetic-test-signal")
      .then(function (analysis) {
        var elapsedMs = Date.now() - startedAt;
        var usedBundled = typeof _bridge.nodeExecutable() === "string" &&
          _bridge.nodeExecutable().indexOf("/runtime/node/") !== -1;
        log("TEST ESSENTIA: ok in " + elapsedMs + "ms - bpm=" + analysis.cuesheet.bpm +
            ", " + analysis.beatsArray.length + " beats, phase " + analysis.phase +
            ". essentia and the analysis subprocess work here.");
        log("TEST ESSENTIA: Node executable used: " + _bridge.nodeExecutable() +
            (usedBundled
              ? " (bundled runtime - as expected on a real install)"
              : " (not the bundled runtime: a system Node.js was found instead)"));
      })
      .catch(function (err) {
        var elapsedMs = Date.now() - startedAt;
        log("TEST ESSENTIA: failed after " + elapsedMs + "ms - " + (err && err.message ? err.message : err));
      })
      .then(function () {
        testEssentiaBtn.disabled = false;
        hideBusy();
      });
  });
  var getInfoBtn = document.getElementById("getInfoBtn");
  getInfoBtn.addEventListener("click", function () {
    getInfoBtn.disabled = true;
    showBusy("busy.default");
    getClipInfo()
      .then(function (data) {
        log("getSelectedAudioInfo ok:");
        log("  mediaPath: " + data.mediaPath);
        log("  clipStartSeconds: " + data.clipStartSeconds);
        log("  inPointSeconds: " + data.inPointSeconds);
        log("  outPointSeconds: " + data.outPointSeconds);
        log("  frameRate: " + data.frameRate);
      })
      .catch(function (err) {
        log("getSelectedAudioInfo failed: " + err);
      })
      .then(function () {
        getInfoBtn.disabled = false;
        hideBusy();
      });
  });
  var placeTestBtn = document.getElementById("placeTestBtn");
  placeTestBtn.addEventListener("click", function () {
    placeTestBtn.disabled = true;
    showBusy("busy.default");
    getClipInfo()
      .then(function (clipInfo) {
        log("Placing 8 test markers (120 BPM, starting 1 s into the source)...");
        return window.BeatMarkerPlace.placeCuesheetMarkers(
          csInterface, window.BeatMarkerCuesheet.TEST_CUESHEET, clipInfo, "beats"
        );
      })
      .then(function (result) {
        if (!result.ok) {
          log("Placement failed: " + result.error);
          return;
        }
        log("Placement ok: requested " + result.data.requested +
            ", created " + result.data.created +
            ", dropped (outside clip in/out range) " + result.data.droppedCount + ".");
        if (result.data.created !== result.data.requested) {
          log("WARNING: fewer markers were created than requested - check the Marker panel in Premiere.");
        } else {
          log("Check Premiere's timeline/Marker panel now: markers should sit exactly 0.5s apart, first one 1s after the clip's start position.");
        }
      })
      .catch(function (err) {
        log("Placement failed: " + err);
      })
      .then(function () {
        placeTestBtn.disabled = false;
        hideBusy();
      });
  });
  var razorTestBtn = document.getElementById("razorTestBtn");
  var razorOffsetInput = document.getElementById("razorOffsetSeconds");
  razorTestBtn.addEventListener("click", function () {
    razorTestBtn.disabled = true;
    showBusy("busy.default");
    getClipInfo()
      .then(function (clipInfo) {
        var offset = parseFloat(razorOffsetInput.value);
        if (isNaN(offset)) {
          offset = 2;
        }
        var targetSeconds = clipInfo.clipStartSeconds + offset;
        log("Test cut: cutting the selected clip's track at " + targetSeconds.toFixed(3) +
            "s (clip start + " + offset + "s).");
        return evalJson("testRazorAtSeconds(" + targetSeconds + ")");
      })
      .then(function (data) {
        log("Cut call returned - check the result on the timeline:");
        log("  requestedSeconds: " + data.requestedSeconds);
        log("  timecodeSent: " + data.timecodeSent);
        log("  razorReturnValue: " + data.razorReturnValue);
        log("  clipCountOnTrackAfter: " + data.clipCountOnTrackAfter);
        log("  nearbyClipsAfterCut: " + JSON.stringify(data.nearbyClipsAfterCut));
      })
      .catch(function (err) {
        log("Test cut failed: " + err);
      })
      .then(function () {
        razorTestBtn.disabled = false;
        hideBusy();
      });
  });
  // Counts Analyze / Detect key runs: a result that arrives after a newer run
  // has started is dropped.
  var _activeOperationGeneration = 0;
  // Cached after a successful analysis so the phase-shift buttons can
  // re-derive "downbeats" and re-place markers without re-running essentia.
  var lastAnalysis = null; // { beatsArray, confidence, clipInfo, audioPath }
  var lastDecodedSamples = null; // Float32Array @ 44100Hz from the most recent Analyze/Detect key decode - reused by the beat-click preview and phase re-picks
  var lastDecodedSamplesPath = null;
  var phaseDisplay = document.getElementById("phaseDisplay");
  var bpmDisplay = document.getElementById("bpmDisplay");
  var beatCountDisplay = document.getElementById("beatCountDisplay");
  var heardTempoRow = document.getElementById("heardTempoRow");
  var heardTempoHint = document.getElementById("heardTempoHint");
  var heardKeyRow = document.getElementById("heardKeyRow");
  var heardKeyHint = document.getElementById("heardKeyHint");
  // Supplemental playback hints accompany the source BPM and key values.
  // At 100% they are hidden; the main Key result always shows the selected
  // clip's calculated timeline key. BPM writes refresh both hints.
  function _setBpmText(text) {
    bpmDisplay.textContent = text;
    _renderHeard();
  }
  // The BPM the panel shows and stores: the tempo of the beats the markers
  // use (js/cuesheet.js tempoFromBeats), or `fallbackBpm` (essentia's) when
  // the grid has no even 8-beat span. The half-time hint and its automatic
  // correction read essentia's own BPM (analysis.cuesheet.bpm), the value
  // their thresholds are set for.
  function _gridBpm(beatsArray, fallbackBpm) {
    var bpm = window.BeatMarkerCuesheet.tempoFromBeats(beatsArray);
    return bpm > 0 ? bpm : fallbackBpm;
  }
  function _renderHeard() {
    _renderHeardTempo();
    _renderHeardKey();
  }
  function _clipSpeed() {
    var ci = lastAnalysis && lastAnalysis.clipInfo;
    var fromAnalysis = ci && Number(ci.speed) > 0 ? Number(ci.speed) : null;
    var fromKey = lastKeyResult && Number(lastKeyResult.clipSpeed) > 0 ? Number(lastKeyResult.clipSpeed) : null;
    return fromAnalysis || fromKey || null;
  }
  function _speedPct(speed) {
    var pct = speed * 100;
    return (Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1));
  }
  function _renderHeardTempo() {
    var bpm = parseFloat(bpmDisplay.textContent);
    var heard = isNaN(bpm) ? null : window.BeatMarkerPitch.heardOnTimeline(_clipSpeed(), bpm, null);
    // No tempo measured yet (the BPM reads "-"), nothing to re-state.
    if (!heard || !heard.bpm) {
      heardTempoRow.hidden = true;
      return;
    }
    heardTempoRow.hidden = false;
    setTranslatedText(heardTempoHint, "analyze.heardTempo", {
      bpm: heard.bpm.toFixed(2),
      pct: _speedPct(heard.speed)
    });
  }
  function _refreshPlaybackConsumers() {
    renderKeyResult();
    if (_library) { _library.refreshPlayback(); }
  }
  function _renderHeardKey() {
    var playback = _selectedPlayback();
    var camelot = playback && playback.sourceCamelot;
    var heard = playback && playback.heard;
    // A speed that rounds to 0 semitones (say 100.2%) moves no key, so
    // there is nothing to say about the key.
    if (!heard || !camelot || (heard.onSemitone && heard.semitones === 0)) {
      heardKeyRow.hidden = true;
      return;
    }
    heardKeyRow.hidden = false;
    var pct = _speedPct(heard.speed);
    var sign = heard.exactSemitones > 0 ? "+" : "-";
    if (heard.camelot && heard.key) {
      setTranslatedText(heardKeyHint, "key.heardKey", {
        key: heard.camelot + " - " + _localKeyName(heard.key.key, heard.key.scale),
        shift: _formatSemitones((heard.exactSemitones > 0 ? 1 : -1) * Math.abs(heard.semitones)),
        pct: pct
      });
    } else {
      setTranslatedText(heardKeyHint, "key.heardKeyBetween", {
        sign: sign,
        semitones: Math.abs(heard.exactSemitones).toFixed(1),
        pct: pct
      });
    }
  }
  var phaseUncertainRow = document.getElementById("phaseUncertainRow");
  var phaseAgreementRow = document.getElementById("phaseAgreementRow");
  var phaseAgreementHint = document.getElementById("phaseAgreementHint");
  var gridConfidenceRow = document.getElementById("gridConfidenceRow");
  var beatThisRow = document.getElementById("beatThisRow");
  var beatThisBtn = document.getElementById("beatThisBtn");
  var beatThisHintText = document.getElementById("beatThisHintText");
  var gridRefinedBtn = document.getElementById("gridRefinedBtn");
  var gridBasicBtn = document.getElementById("gridBasicBtn");
  var manualBpmIntroText = document.getElementById("manualBpmIntroText");
  var retempoRow = document.getElementById("retempoRow");
  var retempoHalfBtn = document.getElementById("retempoHalfBtn");
  var retempoDoubleBtn = document.getElementById("retempoDoubleBtn");
  var PHASE_MARGIN_UNCERTAIN_THRESHOLD = 0.18;
  // The same row also warns when the second detector was unsure where the
  // bars start: its grids have no margin, so the margin line never shows
  // for them. barsUnsure is set where Beat This! is applied (see
  // _runBeatThisOnCurrentAnalysis) and saved with the library entry.
  // Analyses without it (the bar decoder did not run, or the saved entry
  // has no flag) fall back to the uneven-"1"s test (downbeatsLookUneven in
  // js/cuesheet.js) on the placed "1"s. The text asks to listen and points
  // to the "1" buttons first, then to the Basic grid.
  var phaseUncertainHint = document.getElementById("phaseUncertainHint");
  function _updatePhaseUncertainHint(marginRatio) {
    var uncertain = typeof marginRatio === "number" && marginRatio < PHASE_MARGIN_UNCERTAIN_THRESHOLD;
    var barsUnsure = !uncertain && !!lastAnalysis && !!lastAnalysis.downbeatTimes &&
      (typeof lastAnalysis.barsUnsure === "boolean"
        ? lastAnalysis.barsUnsure
        : window.BeatMarkerCuesheet.downbeatsLookUneven(lastAnalysis.downbeatTimes));
    var key = barsUnsure ? "analyze.barsUnsure" : "analyze.phaseUncertain";
    phaseUncertainHint.setAttribute("data-i18n", key);
    setTranslatedText(phaseUncertainHint, key);
    phaseUncertainRow.style.display = (uncertain || barsUnsure) ? "" : "none";
  }
  var GRID_CONFIDENCE_LOW_THRESHOLD = 1.0;
  function _updateGridConfidenceHint(confidence) {
    var low = typeof confidence === "number" && confidence < GRID_CONFIDENCE_LOW_THRESHOLD;
    gridConfidenceRow.style.display = low ? "" : "none";
    // Text/button label swap to the revert framing via _setBeatThisRowMode()
    // below, not here - this function only ever decides visibility. It offers
    // "try it" only after a revert, or on a low-confidence grid where the
    // automatic run did not happen - never after a guard rejected this grid
    // (it would just reject again).
    // A run that did not finish keeps the row up too, with its own note.
    var applied = !!(lastAnalysis && lastAnalysis.beatThisApplied);
    var rejected = !!(lastAnalysis && lastAnalysis.beatThisRejected);
    var reverted = !!(lastAnalysis && lastAnalysis.beatThisReverted);
    var failed = !applied && !!(lastAnalysis && lastAnalysis.beatThisFailed);
    beatThisRow.style.display = (applied || failed || (!rejected && (low || reverted))) ? "" : "none";
    _setBeatThisRowMode(applied, reverted, failed);
    _setManualBpmMode(!!(lastAnalysis && lastAnalysis.manualBpm));
  }
  // The Beat grid line: Refined (Beat This! applied) or Basic (the first
  // detector only), the chosen word lit. Both words drive the hidden
  // #beatThisBtn (_chooseBeatGrid below), so apply and revert work through
  // the same button.
  function _setBeatThisRowMode(applied, reverted, failed) {
    var hintKey = failed ? "analyze.refinedFailed" : (applied || reverted) ? "analyze.gridHelp" : "analyze.beatThisSuggest";
    var btnKey = applied ? "analyze.revertBtn" : "analyze.beatThisBtn";
    beatThisHintText.setAttribute("data-i18n", hintKey);
    setTranslatedText(beatThisHintText, hintKey);
    beatThisBtn.setAttribute("data-i18n", btnKey);
    setTranslatedText(beatThisBtn, btnKey);
    gridRefinedBtn.classList.toggle("is-active", applied);
    gridBasicBtn.classList.toggle("is-active", !applied);
    gridRefinedBtn.setAttribute("aria-pressed", applied ? "true" : "false");
    gridBasicBtn.setAttribute("aria-pressed", applied ? "false" : "true");
  }
  // Same one-click-undo shape as _setBeatThisRowMode above, for Set BPM. This
  // row is always visible (unlike beatThisRow, which is gated on low
  // confidence) - only the text/button label swap here.
  function _setManualBpmMode(applied) {
    var hintKey = applied ? "analyze.manualBpmAppliedHint" : "analyze.manualBpmIntro";
    var btnKey = applied ? "analyze.revertManualBpmBtn" : "analyze.manualBpmBtn";
    manualBpmIntroText.setAttribute("data-i18n", hintKey);
    setTranslatedText(manualBpmIntroText, hintKey);
    manualBpmBtn.setAttribute("data-i18n", btnKey);
    setTranslatedText(manualBpmBtn, btnKey);
  }
  // Half-time hint: warns when the detected tempo is probably half the real
  // one. It needs the BPM in RETEMPO_HINT_BPM_LOW..HIGH and three signals:
  // "onsetRatio" - the onset rate over the beat rate (many onsets per detected
  // beat); "confRatio" - the confidence of a forced-fast constrained-window
  // re-run (the same mechanism the half/double buttons use,
  // _forcedTempoWindow()) over the free run's confidence, which tells whether
  // the fast reading holds up when the tracker is forced to commit to it; and
  // "lowContrast" - bass energy on the beats vs. between them (see
  // js/analyze.js). The thresholds are tuned values.
  var RETEMPO_HINT_BPM_LOW = 55;
  var RETEMPO_HINT_BPM_HIGH = 100;
  var RETEMPO_HINT_ONSET_RATIO_THRESHOLD = 3.0;
  var RETEMPO_HINT_CONF_RATIO_THRESHOLD = 0.7;
  var RETEMPO_HINT_LOW_CONTRAST_THRESHOLD = 2.2;
  var retempoHint = document.getElementById("retempoHint");
  function _updateRetempoLikelyHint(bpm, onsetRate, confRatio, lowContrast) {
    var inZone = typeof bpm === "number" && bpm >= RETEMPO_HINT_BPM_LOW && bpm <= RETEMPO_HINT_BPM_HIGH;
    var onsetRatio = (inZone && typeof onsetRate === "number") ? onsetRate / (bpm / 60) : 0;
    var likely = inZone && onsetRatio >= RETEMPO_HINT_ONSET_RATIO_THRESHOLD &&
      typeof confRatio === "number" && confRatio >= RETEMPO_HINT_CONF_RATIO_THRESHOLD &&
      typeof lowContrast === "number" && lowContrast <= RETEMPO_HINT_LOW_CONTRAST_THRESHOLD;
    if (likely) {
      setTranslatedText(retempoHint, "analyze.retempoLikelyHalf", { bpm: bpm.toFixed(1) });
      retempoHint.classList.add("is-error");
    } else {
      // Empty: the "Half / double" label says what the buttons do; the line
      // under them is only for the half-time warning.
      retempoHint.textContent = "";
      retempoHint.classList.remove("is-error");
    }
    return likely;
  }
  // Forces RhythmExtractor2013 to commit to roughly one tempo (within
  // NARROW_WINDOW_MARGIN of it). Unlike _forcedTempoWindow() (below), which
  // re-derives for the half/double buttons, this is used to compare two tempo
  // candidates by their confidence. A track with an unstable tempo favors
  // neither, stays inside RETEMPO_AUTOCORRECT_MARGIN and is left as a manual
  // suggestion.
  var NARROW_WINDOW_MARGIN = 0.15;
  var NARROW_WINDOW_MIN_WIDTH = 22;
  function _narrowForcedWindow(candidateBpm) {
    var minT = Math.min(180, Math.max(40, candidateBpm * (1 - NARROW_WINDOW_MARGIN)));
    var maxT = Math.max(60, Math.min(250, candidateBpm * (1 + NARROW_WINDOW_MARGIN)));
    if (maxT - minT < NARROW_WINDOW_MIN_WIDTH) {
      var center = (minT + maxT) / 2;
      minT = Math.min(180, Math.max(40, center - NARROW_WINDOW_MIN_WIDTH / 2));
      maxT = Math.min(250, minT + NARROW_WINDOW_MIN_WIDTH);
    }
    return { minTempo: minT, maxTempo: maxT };
  }
  var RETEMPO_AUTOCORRECT_MARGIN = 1.1;
  function _tryAutoCorrectHalfTempo(bpm, monoSamples, audioPath) {
    var origin = lastAnalysis, generation = _activeOperationGeneration;
    return Promise.all([
      runAnalyzeWorker("beats", monoSamples, audioPath, _narrowForcedWindow(bpm)),
      runAnalyzeWorker("beats", monoSamples, audioPath, _narrowForcedWindow(bpm * 2))
    ]).then(function (results) {
      if (generation !== _activeOperationGeneration || lastAnalysis !== origin) { return false; }
      _assertAudioUnchanged(origin.clipInfo);
      var slowResult = results[0], fastResult = results[1];
      var slowConf = slowResult.confidence, fastConf = fastResult.confidence;
      if (fastConf > 0 && (slowConf / fastConf) >= RETEMPO_AUTOCORRECT_MARGIN) {
        log("Half-time auto-correction: the slower reading is clearly the weaker one (confidence " +
            slowConf.toFixed(2) + " vs " + fastConf.toFixed(2) + " at " + slowResult.cuesheet.bpm.toFixed(2) +
            " BPM) - correcting to " + fastResult.cuesheet.bpm.toFixed(2) + " BPM.");
        _applyRecomputedBeatsAnalysis(fastResult, "Auto-corrected (half-time error): now ");
        return true;
      }
      log("Half-time hint shown; the two tempo readings are too close to correct automatically (confidence " +
          slowConf.toFixed(2) + " vs " + fastConf.toFixed(2) + ") - leaving it as a manual suggestion.");
      return false;
    }).catch(function (err) {
      log("Half-time auto-correction check failed (" + (err && err.message ? err.message : err) + ") - leaving it as a manual suggestion.");
      return false;
    });
  }
  // Silent when they agree: agreement is not proof that either is right, so
  // showing it as reassurance would overstate the confidence.
  function _updatePhaseAgreementHint(analysis) {
    if (!analysis || analysis.phaseAgreement !== "disagree") {
      phaseAgreementRow.style.display = "none";
      return;
    }
    setTranslatedText(phaseAgreementHint, "analyze.phaseAgreementDisagree", { phase: analysis.phase });
    phaseAgreementRow.style.display = "";
  }
  // BEAT CLICK PREVIEW and the music video note: js/beat-preview.js. It reads
  // the current analysis through the getters below and gives back refresh /
  // hide.
  var _beatPreview = window.BeatMarkerBeatPreview.create({
    log: log,
    basename: basename,
    formatPlayerTime: _formatPlayerTime,
    retempoRow: retempoRow,
    lastAnalysis: function () { return lastAnalysis; },
    lastDecodedSamples: function () { return lastDecodedSamples; },
    lastDecodedSamplesPath: function () { return lastDecodedSamplesPath; }
  });
  function _refreshBeatClickPreview() {
    _beatPreview.refresh();
  }
  function _hideBeatClickPreview() {
    _beatPreview.hide();
  }
  // MARKER TOOLS: a collapsible section (Copy / paste markers).
  var markerToolsToggleBtn = document.getElementById("markerToolsToggleBtn");
  var markerToolsSection = document.getElementById("markerToolsSection");
  markerToolsToggleBtn.addEventListener("click", function () {
    markerToolsSection.hidden = !markerToolsSection.hidden;
    markerToolsToggleBtn.setAttribute("aria-expanded", markerToolsSection.hidden ? "false" : "true");
  });
  // Median beat-to-beat interval, not mean: a few missed or extra detected
  // beats would skew a mean but barely move a median. Used by the half /
  // double tempo recompute; it is not fed back into the analysis.
  function _estimateBpmFromBeats(beatsArray) {
    if (!beatsArray || beatsArray.length < 2) {
      return 0;
    }
    var diffs = [];
    for (var i = 1; i < beatsArray.length; i++) {
      diffs.push(beatsArray[i] - beatsArray[i - 1]);
    }
    diffs.sort(function (a, b) { return a - b; });
    var median = diffs[Math.floor(diffs.length / 2)];
    return median > 0 ? 60 / median : 0;
  }
  // "Simple" = downbeats only (buildDownbeatsTrack); "Detailed" = every beat,
  // each one labeled D (downbeat) or b (regular beat); see
  // js/cuesheet.js buildLabeledBeatsTrack().
  function getSelectedCutMode() {
    var checked = document.querySelector('input[name="cutMode"]:checked');
    return checked ? checked.value : "simple";
  }
  // Where Place markers puts them: "clip" - markers belong to the media and
  // move with it - or "sequence" - timeline markers (composition markers in
  // After Effects). Remembered across sessions.
  var markerTargetRadios = document.querySelectorAll('input[name="markerTarget"]');
  function getMarkerTarget() {
    var checked = document.querySelector('input[name="markerTarget"]:checked');
    return checked && checked.value === "sequence" ? "sequence" : "clip";
  }
  for (var mtr = 0; mtr < markerTargetRadios.length; mtr++) {
    markerTargetRadios[mtr].checked = markerTargetRadios[mtr].value === (initialSettings.markerTarget === "sequence" ? "sequence" : "clip");
    markerTargetRadios[mtr].addEventListener("change", function () {
      persistSettings({ markerTarget: getMarkerTarget() });
    });
  }
  // Timing: "frame" snaps marker times to the start of the video frame they
  // fall in; "exact" keeps the detected times. Remembered as
  // settings.markerTiming.
  var markerTimingRadios = document.querySelectorAll('input[name="markerTiming"]');
  function getMarkerTiming() {
    // After Effects always places on the frame: its playhead and Split Layer
    // work in whole frames. A saved "exact" (from Premiere) is ignored there.
    if (hostIsAe) {
      return "frame";
    }
    var checked = document.querySelector('input[name="markerTiming"]:checked');
    return checked && checked.value === "exact" ? "exact" : "frame";
  }
  for (var mti = 0; mti < markerTimingRadios.length; mti++) {
    markerTimingRadios[mti].checked = markerTimingRadios[mti].value === (initialSettings.markerTiming === "exact" ? "exact" : "frame");
    markerTimingRadios[mti].addEventListener("change", function () {
      persistSettings({ markerTiming: getMarkerTiming() });
    });
  }
  // True when the host is After Effects (appName AEFT).
  var hostIsAe = csInterface.getHostEnvironment().appName === "AEFT";
  // The Show Audio Time Units tip is about Premiere's timeline. Shown only
  // while Timing is Exact: it is the setting the tip is about.
  var audioUnitsTipRow = document.getElementById("audioUnitsTipRow");
  function _updateAudioUnitsTip() {
    var checked = document.querySelector('input[name="markerTiming"]:checked');
    var exact = !hostIsAe && !!(checked && checked.value === "exact");
    audioUnitsTipRow.hidden = !exact;
    var aeNote = document.getElementById("aeNote");
    if (aeNote) {
      aeNote.hidden = !hostIsAe || !!initialSettings.aeNoteDismissed;
    }
    ["timingKey", "timingOpts"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.hidden = hostIsAe; }
    });
    // Shift − / + only means something between frames.
    ["nudgeKey", "nudgeOpts", "nudgeHintRow"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.hidden = !exact; }
    });
  }
  var aeNoteDismiss = document.getElementById("aeNoteDismiss");
  if (aeNoteDismiss) {
    aeNoteDismiss.addEventListener("click", function () {
      document.getElementById("aeNote").hidden = true;
      initialSettings.aeNoteDismissed = true;
      persistSettings({ aeNoteDismissed: true });
    });
  }
  for (var mtt = 0; mtt < markerTimingRadios.length; mtt++) {
    markerTimingRadios[mtt].addEventListener("change", _updateAudioUnitsTip);
  }
  _updateAudioUnitsTip();
  // The track Place markers uses: downbeats, or every beat labeled D / b.
  // The markers' times are evened out along the local tempo line: Beat
  // This! times sit on a 20 ms grid, up to 10 ms off the beat each. A typed
  // BPM's grid is even already.
  var _lastEvenOut = null;
  function buildDownbeatsCuesheet(phase, modeOverride, clipOverride) {
    var mode = modeOverride || getSelectedCutMode();
    _coverCustomGrid(lastAnalysis, clipOverride || lastAnalysis.clipInfo);
    // Both modes use lastAnalysis.downbeatTimes when present (Beat This!
    // applied), so the detailed mode puts its D markers on exactly the
    // downbeats the simple mode does. It is null for essentia-only analyses,
    // which use every 4th beat from `phase` in both.
    var downbeatsTrack = mode === "detailed"
      ? window.BeatMarkerCuesheet.buildLabeledBeatsTrack(lastAnalysis.beatsArray, lastAnalysis.confidence, phase, lastAnalysis.downbeatTimes)
      : window.BeatMarkerCuesheet.buildDownbeatsTrack(lastAnalysis.beatsArray, lastAnalysis.confidence, phase, lastAnalysis.downbeatTimes);
    var events = downbeatsTrack.events;
    _lastEvenOut = null;
    if (!lastAnalysis.manualBpm && events.length >= 5) {
      // The downbeats ("D") are evened as their own series, so both modes put
      // them on exactly the same times; in the detailed mode the other beats
      // come from the whole series (every beat, a wider window). A time that
      // evening would push across the clip's in or out point stays as
      // detected, so no marker is lost at the edges.
      var C = window.BeatMarkerCuesheet;
      var dIdx = [];
      events.forEach(function (ev, i) { if (ev.label === "D") { dIdx.push(i); } });
      var dEven = C.evenOutTimes(dIdx.map(function (i) { return events[i].t; }), 4);
      var allEven = mode === "detailed" ? C.evenOutTimes(events.map(function (ev) { return ev.t; }), 8) : null;
      var newT = events.map(function (ev) { return ev.t; });
      dIdx.forEach(function (i, j) { newT[i] = dEven.times[j]; });
      if (allEven) {
        events.forEach(function (ev, i) { if (ev.label !== "D") { newT[i] = allEven.times[i]; } });
      }
      var ci = clipOverride || lastAnalysis.clipInfo || {};
      var inPt = typeof ci.inPointSeconds === "number" ? ci.inPointSeconds : 0;
      var outPt = typeof ci.outPointSeconds === "number" ? ci.outPointSeconds : Infinity;
      var shifts = [];
      events = events.map(function (ev, i) {
        var copy = {};
        for (var key in ev) { if (Object.prototype.hasOwnProperty.call(ev, key)) { copy[key] = ev[key]; } }
        var wasIn = ev.t >= inPt && ev.t <= outPt;
        var isIn = newT[i] >= inPt && newT[i] <= outPt && newT[i] >= 0;
        if (wasIn === isIn || !wasIn) {
          copy.t = newT[i];
          if (Math.abs(newT[i] - ev.t) > 0.0001) { shifts.push(Math.abs(newT[i] - ev.t) * 1000); }
        }
        return copy;
      });
      shifts.sort(function (p, q) { return p - q; });
      _lastEvenOut = {
        moved: shifts.length,
        medianShiftMs: shifts.length ? shifts[Math.floor(shifts.length / 2)] : 0,
        maxShiftMs: shifts.length ? shifts[shifts.length - 1] : 0
      };
    }
    // The hand shift for this track (Shift − / +), after the evening. Only
    // under Timing: Exact, where its row is shown; under Frame (and always
    // in After Effects) a shift set earlier stays remembered but does not
    // move the markers.
    var nudgeSec = getMarkerTiming() === "exact" ? _nudgeMsFor(lastAnalysis.audioPath) / 1000 : 0;
    if (nudgeSec) {
      events = events.map(function (ev) {
        var copy = {};
        for (var key in ev) { if (Object.prototype.hasOwnProperty.call(ev, key)) { copy[key] = ev[key]; } }
        copy.t = ev.t + nudgeSec;
        return copy;
      });
    }
    downbeatsTrack = { id: "downbeats", type: "impulse", events: events };
    return {
      version: "1.0",
      source: "essentia",
      audio: { path: lastAnalysis.audioPath, sampleRate: window.BeatMarkerAudio.TARGET_SAMPLE_RATE, durationSec: null },
      bpm: null,
      tracks: [downbeatsTrack]
    };
  }
  // Render the selected analysis grid as a separate audio track.
  window.BeatMarkerMetronome.create({
    I18n: I18n, log: log, setText: setTranslatedText, showBusy: showBusy, hideBusy: hideBusy,
    analysis: function () { return lastAnalysis; }, settings: function () { return initialSettings; },
    getClipInfo: getClipInfo, evalJson: evalJson, jsxJsonArg: _jsxJsonArg,
    csInterface: csInterface, cuesheet: buildDownbeatsCuesheet,
    translateHostReason: function (message) { return _translateHostReason(message); }
  });
  // Where the host put the first markers, next to what was asked - shows
  // whether marker times are rounded to video frames.
  function _logStoredMarkerTimes(data) {
    if (!data.stored || !data.stored.length) {
      return;
    }
    var fps = lastAnalysis.clipInfo && lastAnalysis.clipInfo.frameRate;
    var parts = data.stored.map(function (s) {
      return s.requested.toFixed(4) + " -> " + (typeof s.stored === "number" ? s.stored.toFixed(4) : "?") + " s";
    });
    var rounded = data.stored.some(function (s) { return typeof s.stored === "number" && Math.abs(s.stored - s.requested) > 0.0005; });
    log("Marker times as stored by the host (asked -> stored): " + parts.join(", ") +
        (rounded ? " - the host moved them" + (fps ? " (a frame is " + (1000 / fps).toFixed(1) + " ms at " + fps + " fps)" : "") + "."
                 : " - exact, not rounded to frames."));
  }
  function placeDownbeatsAtPhase(phase) {
    return getClipInfo().then(function (fresh) {
      if (!lastAnalysis || fresh.mediaPath !== lastAnalysis.audioPath) {
        throw new Error(I18n.t("selection.sourceChanged"));
      }
      _assertAudioUnchanged(lastAnalysis.clipInfo);
      fresh.fileIdentity = lastAnalysis.clipInfo.fileIdentity;
      lastAnalysis.clipInfo = fresh;
      return _placeDownbeatsOnCurrentClip(phase);
    });
  }

  function _placeDownbeatsOnCurrentClip(phase) {
    var analysis = lastAnalysis;
    var cuesheet = buildDownbeatsCuesheet(phase);
    var nudgeMs = _nudgeMsFor(lastAnalysis.audioPath);
    if (nudgeMs) {
      log("Shifted by hand for this track: " + (nudgeMs > 0 ? "+" : "") + nudgeMs + " ms.");
    }
    if (_lastEvenOut && _lastEvenOut.moved) {
      log("Evened out: " + _lastEvenOut.moved + " of " + cuesheet.tracks[0].events.length +
          " markers moved onto the track's tempo line (by " + _lastEvenOut.medianShiftMs.toFixed(1) + " ms typically, " +
          _lastEvenOut.maxShiftMs.toFixed(1) + " ms at most) - the detector reports beats in 20 ms steps.");
    }
    var downbeatsTrack = cuesheet.tracks[0];
    var target = getMarkerTarget();
    var markerType = target === "sequence" ? "timeline" : "clip";
    var placeFn = target === "sequence" ? window.BeatMarkerPlace.placeSequenceMarkers : window.BeatMarkerPlace.placeClipMarkers;
    // "at phase N" only means something when buildDownbeatsCuesheet() used
    // the every-4th-beat grid. With native downbeatTimes active (Beat This!
    // applied, simple mode) `phase` is only a fallback value the track
    // construction ignored, so the log says so instead of implying a phase
    // index drove placement.
    var usedNativeTimes = lastAnalysis.downbeatTimes && lastAnalysis.downbeatTimes.length;
    var snapToFrame = getMarkerTiming() === "frame";
    log("Placing " + downbeatsTrack.events.length + " " + markerType + " downbeat markers" +
        (snapToFrame ? " on the start of each beat's video frame" : " at exact times") +
        (usedNativeTimes ? " (native downbeats)" : " at phase " + phase) + "...");
    return placeFn(csInterface, cuesheet, lastAnalysis.clipInfo, "downbeats", { snapToFrame: snapToFrame, knownPlaced: _placedTimelineJson() })
      .then(function (result) {
        if (!result.ok) {
          log("Placement failed: " + result.error);
          return result;
        }
        _rememberPlacedTimeline(result.data);
        log("Done: requested " + result.data.requested + ", created " + result.data.created +
            ", dropped (outside clip range) " + result.data.droppedCount +
            (result.data.replaced ? ", replaced " + result.data.replaced + " earlier Downbeat marker(s)" : "") +
            (result.data.framesMerged ? ", " + result.data.framesMerged + " merged into a marker in the same frame" : "") +
            (result.data.kept ? ", " + result.data.kept + " left out where your own marker already sits" : "") + ".");
        warnIfMostlyDropped(result.data.requested, result.data.droppedCount);
        _logStoredMarkerTimes(result.data);
        _rememberPhase(phase, analysis);
        return result;
      });
  }
  // The "1" now in use, shown and saved with the clip's analysis, so
  // selecting the clip again later brings back the same downbeats (not the
  // pre-shift ones). The "1" buttons set lastAnalysis.phase when clicked
  // (shiftPhase), so an answer that comes after a newer click leaves the
  // newer one in place.
  function _rememberPhase(phase, analysis) {
    analysis = analysis || lastAnalysis;
    if (analysis === lastAnalysis) {
      _updatePhaseShiftUi();
      _refreshBeatClickPreview();
    }
    var entry = window.BeatMarkerLibrary.get(analysis.audioPath);
    if (entry && entry.beatsArray) {
      window.BeatMarkerLibrary.upsertAnalysis(analysis.audioPath, entry.label, {
        bpm: entry.bpm, beatsArray: analysis.beatsArray, confidence: analysis.confidence,
        phase: phase, downbeatTimes: analysis.downbeatTimes, barsUnsure: analysis.barsUnsure,
        clipInfo: analysis.clipInfo
      });
      persistLibrary();
    }
  }

  // Where Place last put timeline (composition) markers for each clip, so a
  // host restart does not lose it: jsx/host.jsx keeps it per engine session
  // (_dbPlacedTimeline) and returns placedKey + placedTimes with every
  // placement; the panel stores them in settings.json and sends them back
  // with every Place and Clear, so the set of a clip moved after a restart
  // is still found. The newest 40 clips.
  // Per clip: { t: times, g: Premiere's marker ids, at }; the ids tell the
  // set from another clip's markers on the same frames. An entry without g
  // is sent as times only.
  var PLACED_TIMELINE_KEEP = 40;
  function _placedTimelineMemory() {
    var m = initialSettings.placedTimeline;
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  }
  function _placedTimelineJson() {
    var m = _placedTimelineMemory();
    var out = {};
    for (var k in m) {
      if (m.hasOwnProperty(k) && m[k] && m[k].t && m[k].t.length) {
        out[k] = m[k].g && m[k].g.length === m[k].t.length ? { t: m[k].t, g: m[k].g } : m[k].t;
      }
    }
    return out;
  }
  // data: a host answer with placedKey (+ placedTimes / placedIds for a new
  // set; without times the set is forgotten) and forgetKeys (sets the host
  // removed or handed on).
  function _rememberPlacedTimeline(data) {
    if (!data || (!data.placedKey && !(data.forgetKeys && data.forgetKeys.length))) { return; }
    var m = _placedTimelineMemory();
    var drop = {};
    if (data.placedKey) { drop[data.placedKey] = true; }
    (data.forgetKeys || []).forEach(function (key) { drop[key] = true; });
    var next = {};
    var changed = false;
    for (var k in m) {
      if (!m.hasOwnProperty(k)) { continue; }
      if (drop[k]) { changed = true; } else { next[k] = m[k]; }
    }
    if (data.placedKey && data.placedTimes && data.placedTimes.length) {
      next[data.placedKey] = { t: data.placedTimes, at: Date.now() };
      if (data.placedIds && data.placedIds.length === data.placedTimes.length) { next[data.placedKey].g = data.placedIds; }
      changed = true;
    }
    if (!changed) {
      return; // nothing to forget
    }
    var keys = Object.keys(next).sort(function (a, b) { return (next[b].at || 0) - (next[a].at || 0); });
    var kept = {};
    for (var i = 0; i < keys.length && i < PLACED_TIMELINE_KEEP; i++) { kept[keys[i]] = next[keys[i]]; }
    persistSettings({ placedTimeline: kept });
  }
  // Shift and the "1" buttons change where the markers go. They put the
  // markers down again only when Downbeat's markers are already on the
  // clip (with none there, Shift would place a fresh set by itself);
  // otherwise the change is kept and Place markers uses it.
  // `edit` (optional) is the change being made: edit.undo() puts the shown
  // "1" back when nothing was placed - a refused placement would otherwise
  // leave the beat buttons and the markers on the clip disagreeing - and
  // edit.confirm() records that it reached the clip. The change belongs
  // to the clip selected when it was made: one made before the panel
  // noticed another selection is refused, not stored for the previous clip.
  function _replaceMarkersIfPlaced(phase, what, edit) {
    var analysis = lastAnalysis;
    function failed(message, logText) {
      log(what + " failed: " + (logText || message));
      if (edit) { edit.undo(); }
      _flashSelectionError(_placeFailureText(message));
    }
    function reached() {
      if (edit) { edit.confirm(); }
    }
    return getClipInfo().then(function (fresh) {
      if (lastAnalysis !== analysis || fresh.mediaPath !== analysis.audioPath) {
        failed(I18n.t("selection.clipChanged"));
        return null;
      }
      return evalJson("countOwnMarkersForSelectedClip(" + JSON.stringify(JSON.stringify(_placedTimelineJson())) + ")").then(function (data) {
        if (!data || !data.count) {
          _rememberPhase(phase, analysis);
          reached();
          log(what + ": no Downbeat markers on this clip, so none were placed - Place markers will use it.");
          return null;
        }
        showBusy("busy.default");
        return placeDownbeatsAtPhase(phase).then(function (result) {
          hideBusy();
          if (result && !result.ok) { failed(result.error); } else { reached(); }
        }, function (err) {
          hideBusy();
          failed(err && err.message ? err.message : String(err));
        });
      }, function (err) {
        var message = err && err.message ? err.message : String(err);
        failed(message, "could not check the clip's markers (" + message + "), so none were placed");
      });
    }, function (err) {
      failed(err && err.message ? err.message : String(err));
    });
  }
  // The placement refusal the panel itself gives, in the panel's language;
  // other texts go through _flashSelectionError's own translation.
  function _placeFailureText(message) {
    return /^No events fall within the clip's in\/out range/.test(String(message)) ? I18n.t("markers.noneInClip") : message;
  }
  // What the "1" buttons change, to put it back.
  function _phaseState(analysis) {
    analysis = analysis || lastAnalysis;
    return { phase: analysis.phase, phaseShift: analysis.phaseShift, originalPhase: analysis._originalPhase,
      originalDownbeatTimes: analysis._originalDownbeatTimes, downbeatTimes: analysis.downbeatTimes, analysis: analysis };
  }
  // Put back on the analysis it was taken from, also when another clip is
  // on screen by now, so that analysis keeps the "1" its markers have.
  function _restorePhaseState(saved) {
    var a = saved.analysis;
    a.phase = saved.phase;
    a.phaseShift = saved.phaseShift;
    a._originalPhase = saved.originalPhase;
    a._originalDownbeatTimes = saved.originalDownbeatTimes;
    a.downbeatTimes = saved.downbeatTimes;
    if (a === lastAnalysis) {
      _updatePhaseShiftUi();
      _refreshBeatClickPreview();
    }
  }
  // A "1" change is shown and set at once and reaches the clip after the
  // host answers, so a second click can come before the first is answered.
  // A refused change goes back to the "1" of the last change that reached
  // the clip, and only when no newer change is on its way: the newest one
  // decides what the cells and the markers end with.
  function _startPhaseEdit() {
    var a = lastAnalysis;
    if (!a._phaseEditsPending) { a._phaseReached = _phaseState(a); }
    a._phaseEditsPending = (a._phaseEditsPending || 0) + 1;
    var serial = a._phaseEditSerial = (a._phaseEditSerial || 0) + 1;
    var made = null;
    return {
      made: function () { made = _phaseState(a); },
      confirm: function () {
        a._phaseEditsPending--;
        a._phaseReached = made;
      },
      undo: function () {
        a._phaseEditsPending--;
        if (serial === a._phaseEditSerial) { _restorePhaseState(a._phaseReached); }
      }
    };
  }
  // Places downbeats via placeDownbeatsAtPhase() with the current phase (the
  // same path the phase-shift buttons use). The marker settings apply
  // automatically because buildDownbeatsCuesheet() reads all of them.
  var placeMarkersBtn = document.getElementById("placeMarkersBtn");
  placeMarkersBtn.addEventListener("click", function () {
    if (!lastAnalysis) {
      _flashSelectionError(I18n.t("selection.needAnalyze"));
      return;
    }
    placeMarkersBtn.disabled = true;
    showBusy("busy.default");
    // A Place that puts nothing down says why, in the clip line.
    placeDownbeatsAtPhase(lastAnalysis.phase)
      .then(function (result) {
        placeMarkersBtn.disabled = false;
        hideBusy();
        if (result && !result.ok) {
          _flashSelectionError(_placeFailureText(result.error));
        }
      }, function (err) {
        var message = err && err.message ? err.message : String(err);
        log("Place markers failed: " + message);
        placeMarkersBtn.disabled = false;
        hideBusy();
        _flashSelectionError(_placeFailureText(message));
      });
  });
  var analyzeBtn = document.getElementById("analyzeBtn");
  analyzeBtn.addEventListener("click", function () {
    _analyzeSelectedClip();
  });
  // The beat tracker refuses audio it cannot read (js/analyze.js
  // audioUnfitForBeats) with a code; the panel says it in its language.
  var _unfitAudioKeys = { "DOWNBEAT_AUDIO_TOO_SHORT": "analyze.tooShort", "DOWNBEAT_AUDIO_SILENT": "analyze.silent" };
  function _unfitAudioText(message) {
    var code = /DOWNBEAT_AUDIO_[A-Z_]+/.exec(String(message));
    return code && _unfitAudioKeys[code[0]] ? I18n.t(_unfitAudioKeys[code[0]]) : null;
  }
  function _analyzeSelectedClip() {
    analyzeBtn.disabled = true;
    showBusy("busy.analyze");
    var myGeneration = ++_activeOperationGeneration;
    var clipInfoForPlacement = null;
    var monoSamplesForOnsets = null;
    var decodedSeconds = 0;
    return getClipInfo()
      .then(function (clipInfo) {
        clipInfoForPlacement = clipInfo;
        clipInfo.fileIdentity = window.BeatMarkerLibrary.fileIdentity(clipInfo.mediaPath);
        log("Reading file: " + clipInfo.mediaPath);
        return window.BeatMarkerAudio.decodeFileToMono44100(clipInfo.mediaPath, {
          onRead: function (bytes) { log("Read " + bytes + " bytes. Decoding..."); },
          onFallback: function () { log("The panel's decoder could not read this file; using the plugin's own WAV / AIFF reader."); }
        });
      })
      .then(function (decoded) {
        decodedSeconds = decoded.original.durationSec || 0;
        log("Decoded: " + decoded.original.durationSec.toFixed(2) + "s, " +
            decoded.original.sampleRate + "Hz, " + decoded.original.channels + "ch (source) -> " +
            decoded.samples.length + " mono samples at 44100Hz.");
        monoSamplesForOnsets = decoded.samples;
        if (myGeneration === _activeOperationGeneration) {
          lastDecodedSamples = decoded.samples; // reused later without a re-decode
          lastDecodedSamplesPath = clipInfoForPlacement.mediaPath;
        }
        log("Initializing essentia.js, running RhythmExtractor2013 + BeatsLoudness (this may take a moment)...");
        return runAnalyzeWorker("beats", decoded.samples, clipInfoForPlacement.mediaPath);
      })
      .then(function (analysis) {
        _assertAudioUnchanged(clipInfoForPlacement);
        var beatCount = analysis.beatsArray.length;
        log("Analysis ok: bpm=" + analysis.cuesheet.bpm + ", " + beatCount + " beats detected.");
        var shownBpm = _gridBpm(analysis.beatsArray, analysis.cuesheet.bpm);
        if (Math.abs(shownBpm - analysis.cuesheet.bpm) >= 0.005) {
          log("Tempo of the beats: " + shownBpm.toFixed(2) + " BPM (shown instead of the tracker's " +
              analysis.cuesheet.bpm.toFixed(2) + ").");
        }
        log("Downbeat phase picked: " + analysis.phase +
            " (average energy by phase: " + analysis.phaseAverages.map(function (v) { return v.toFixed(4); }).join(", ") + ")");
        // The library cache write is unconditional (see
        // _activeOperationGeneration): this clip's analysis is worth keeping
        // even if a newer Analyze/Detect key started on a different clip
        // meanwhile.
        var upsertResult = window.BeatMarkerLibrary.upsertAnalysis(
          clipInfoForPlacement.mediaPath, basename(clipInfoForPlacement.mediaPath),
          {
            bpm: shownBpm,
            beatsArray: analysis.beatsArray,
            confidence: analysis.confidence,
            phase: analysis.phase,
            beatGrid: "basic", // Beat This! comes next and renames it
            clipInfo: clipInfoForPlacement
          }
        );
        if (upsertResult.clipInfoChanged) {
          log("Note: " + basename(clipInfoForPlacement.mediaPath) + " was previously analyzed on a different " +
              "track/position (track " + upsertResult.previousClipInfo.trackIndex + "). The library now points at " +
              "THIS instance (track " + clipInfoForPlacement.trackIndex + ").");
        }
        renderLibrary();
        persistLibrary();
        if (myGeneration !== _activeOperationGeneration) {
          log("Analyze: a newer Analyze/Detect key was started before this one finished - " +
              "cached its result, but not showing it since a different clip is now selected.");
          return;
        }
        lastAnalysis = {
          beatsArray: analysis.beatsArray,
          confidence: analysis.confidence,
          clipInfo: clipInfoForPlacement,
          audioPath: clipInfoForPlacement.mediaPath,
          phase: analysis.phase, // the combined pick (normalized bass and chord scores blended, see js/analyze.js)
          phaseMarginRatio: analysis.phaseMarginRatio, // margin of the blended pick
          phaseSource: analysis.phaseSource, // "bass" (chord cue unavailable) or "blend" (both cues combined)
          bassPhase: analysis.bassPhase,
          bassPhaseMarginRatio: analysis.bassPhaseMarginRatio,
          chordPhase: analysis.chordPhase,
          chordPhaseMarginRatio: analysis.chordPhaseMarginRatio,
          chordPhaseAvailable: analysis.chordPhaseAvailable,
          phaseAgreement: analysis.phaseAgreement,
          chordChangeEvents: analysis.chordChangeEvents || [],
          lowContrast: analysis.lowContrast,
          tempoChangeRegions: analysis.tempoChangeRegions || []
        };
        _updatePhaseShiftUi();
        _setBpmText(shownBpm.toFixed(2));
        beatCountDisplay.textContent = String(beatCount);
        _updatePhaseUncertainHint(analysis.phaseMarginRatio);
        _updatePhaseAgreementHint(analysis);
        _updateGridConfidenceHint(analysis.confidence);
        _updateRetempoLikelyHint(analysis.cuesheet.bpm, null); // neutral text until/unless the onset pass below (if it runs) upgrades it
        _refreshBeatClickPreview();
        // Onsets feed the half-time hint above when the detected BPM falls in
        // RETEMPO_HINT_BPM_LOW..HIGH.
        var wantsOnsetsForRetempoHint = analysis.cuesheet.bpm >= RETEMPO_HINT_BPM_LOW && analysis.cuesheet.bpm <= RETEMPO_HINT_BPM_HIGH;
        if (!wantsOnsetsForRetempoHint) {
          return;
        }
        // The hint's third signal (confRatio) needs the confidence of a
        // forced-fast constrained re-run (same mechanism as the half/double
        // buttons, _forcedTempoWindow()). It runs as an extra essentia pass
        // alongside the onset pass (Promise.all, since they are independent
        // subprocess calls), and only when the hint's BPM zone already
        // applies, so it never runs for a track outside the ambiguous range.
        var confRatioPromise = wantsOnsetsForRetempoHint
          ? runAnalyzeWorker("beats", monoSamplesForOnsets, clipInfoForPlacement.mediaPath, _forcedTempoWindow(analysis.cuesheet.bpm, 2))
            .then(function (forced) { return forced.confidence; })
            .catch(function () { return null; })
          : Promise.resolve(null);
        return Promise.all([runAnalyzeWorker("onsets", monoSamplesForOnsets), confRatioPromise]).then(function (results) {
          var onsetResult = results[0];
          var confB = results[1];
          if (myGeneration !== _activeOperationGeneration) {
            return; // superseded while the onset pass was running - lastAnalysis now belongs to a newer generation, don't write onto it
          }
          {
            var confRatio = (confB !== null && analysis.confidence > 0) ? (confB / analysis.confidence) : null;
            var likely = _updateRetempoLikelyHint(analysis.cuesheet.bpm, onsetResult.onsetRate, confRatio, analysis.lowContrast);
            if (likely) {
              return _tryAutoCorrectHalfTempo(analysis.cuesheet.bpm, monoSamplesForOnsets, clipInfoForPlacement.mediaPath);
            }
          }
        });
      })
      .then(function () {
        // Beat This! as the last step of every Analyze - see
        // _runBeatThisOnCurrentAnalysis(). Skipped for a superseded run.
        if (myGeneration !== _activeOperationGeneration || !lastAnalysis ||
            lastDecodedSamplesPath !== lastAnalysis.audioPath) {
          return null;
        }
        showBusy("busy.refineGrid");
        return _runBeatThisOnCurrentAnalysis(true).then(function () {
          hideBusy();
          // The clip line names the new grid also when Analyze ended
          // between two selection checks.
          if (myGeneration === _activeOperationGeneration) { _refreshClipLine(); }
        });
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : err;
        log("Analyze pipeline failed: " + message);
        // essentia's beat tracker runs out of room on a file longer than
        // about 33 minutes and aborts with a stack trace; the editor gets
        // a plain message instead (key detection has no such limit). Any
        // other abort, on a shorter file, keeps its own text.
        var tooLong = /^abort\(/.test(String(message)) && decodedSeconds > 25 * 60;
        _flashSelectionError(tooLong ? I18n.t("analyze.tooLong") : (_unfitAudioText(message) || message));
      })
      .then(function () {
        analyzeBtn.disabled = false;
        hideBusy();
      });
  }
  // BEAT THIS! ALTERNATIVE ANALYSIS. It runs automatically as the last step
  // of Analyze (see _runBeatThisOnCurrentAnalysis()); the Beat grid line
  // reverts to essentia's grid or applies it again. _updateGridConfidenceHint
  // above decides when beatThisRow is offered.
  // First guard: the Beat This! beat count must be within this factor of
  // essentia's beat count (in either direction).
  var BEATTHIS_COUNT_RATIO_GUARD = 1.75;
  // Second guard: the mean model logit at the selected beat peaks
  // (worker/beatthis-worker.js's computeMeanPeakLogit(), computed from the
  // inference that already ran). Below this, the original grid is kept.
  var BEATTHIS_MIN_MEAN_PEAK_LOGIT = 3.0;
  // When essentia's grid is about twice as dense as Beat This!'s (beat-count
  // density ratio inside this window, see computeGridDensityRatio()), the
  // downbeats are interpolated to match.
  var BEATTHIS_DENSITY_RATIO_HALF_MIN = 0.45;
  var BEATTHIS_DENSITY_RATIO_HALF_MAX = 0.55;
  // Fields that Beat This! can change on lastAnalysis. They are snapshotted
  // before applying so a one-click revert can restore the essentia result
  // exactly, without re-running essentia. Kept as one list so
  // apply/snapshot/revert cannot drift out of sync. Phase is also retained
  // as a 0-3 fallback for grids without native downbeats and for persisted
  // analysis metadata.
  var BEAT_FIELD_KEYS = [
    "beatsArray", "downbeatTimes", "phase", "phaseMarginRatio", "phaseSource",
    "bassPhase", "bassPhaseMarginRatio", "chordPhase", "chordPhaseMarginRatio",
    "chordPhaseAvailable", "phaseAgreement", "chordChangeEvents", "tempoChangeRegions", "barsUnsure"
  ];
  // `analysis` is the one on screen, so the BPM shown belongs to its grid;
  // the snapshot keeps it for a grid that cannot be measured again
  // (_applyBeatFieldsAndRefreshUI).
  function _snapshotBeatFields(analysis) {
    var snapshot = {};
    for (var i = 0; i < BEAT_FIELD_KEYS.length; i++) {
      snapshot[BEAT_FIELD_KEYS[i]] = analysis[BEAT_FIELD_KEYS[i]];
    }
    snapshot.shownBpm = parseFloat(bpmDisplay.textContent);
    return snapshot;
  }
  function _applyBeatFieldsAndRefreshUI(fields, audioPath, clipInfo) {
    _assertAudioUnchanged(clipInfo);
    for (var i = 0; i < BEAT_FIELD_KEYS.length; i++) {
      lastAnalysis[BEAT_FIELD_KEYS[i]] = fields[BEAT_FIELD_KEYS[i]];
    }
    _forgetPhaseShift();
    _updatePhaseShiftUi();
    beatCountDisplay.textContent = String(lastAnalysis.beatsArray.length);
    // The BPM follows the grid just applied (Beat This!'s, or essentia's
    // again on Basic). When its beats have no even span: a restored grid
    // gets back the BPM it was shown with (its snapshot's), a new one keeps
    // the BPM on screen.
    var keptBpm = typeof fields.shownBpm === "number" && fields.shownBpm > 0
      ? fields.shownBpm : parseFloat(bpmDisplay.textContent);
    var gridBpm = _gridBpm(lastAnalysis.beatsArray, keptBpm);
    if (gridBpm > 0) {
      _setBpmText(gridBpm.toFixed(2));
    }
    _updatePhaseUncertainHint(lastAnalysis.phaseMarginRatio);
    _updatePhaseAgreementHint(lastAnalysis);
    _updateGridConfidenceHint(lastAnalysis.confidence);
    _refreshBeatClickPreview();
    window.BeatMarkerLibrary.upsertAnalysis(
      audioPath, basename(audioPath),
      {
        bpm: parseFloat(bpmDisplay.textContent),
        beatsArray: lastAnalysis.beatsArray,
        confidence: lastAnalysis.confidence,
        phase: lastAnalysis.phase,
        downbeatTimes: lastAnalysis.downbeatTimes,
        barsUnsure: lastAnalysis.barsUnsure,
        beatGrid: _beatGridOf(lastAnalysis),
        clipInfo: clipInfo
      }
    );
    renderLibrary();
    persistLibrary();
  }

  // The name of the grid on screen, saved with the entry so that selecting
  // the clip again shows the same Beat grid line (_applyCachedEntry).
  function _beatGridOf(analysis) {
    if (analysis.evenGridBpm) { return "custom"; }
    if (analysis.beatThisApplied) { return "refined"; }
    return analysis.beatThisRejected ? "kept" : "basic";
  }
  // ½× / 2× makes a grid of the first detector's kind: the Beat grid line
  // lights Basic, and Refined can be tried on the new grid. A grid with no
  // Beat grid line (Custom BPM, or Beat This! not run) stays without one.
  function _markGridBasic() {
    var a = lastAnalysis;
    if (a.beatThisApplied || a.beatThisRejected || a.beatThisFailed) {
      a.beatThisApplied = false;
      a.beatThisRejected = false;
      a.beatThisFailed = false;
      a.beatThisReverted = true;
      a._preBeatThisSnapshot = null;
    }
  }
  // Runs Beat This! on the current analysis and, if every guard passes,
  // applies its grid and native downbeats, snapshotting the essentia result
  // first so one click reverts. Resolves true when applied, false when a
  // guard kept the original grid or the run failed - never rejects, so it can
  // be chained onto Analyze without ever failing it.
  function _runBeatThisOnCurrentAnalysis(automatic) {
    var analysis = lastAnalysis;
    var audioPath = analysis.audioPath;
    var clipInfo = analysis.clipInfo;
    try { _assertAudioUnchanged(clipInfo); } catch (changed) { log(changed.message); return Promise.resolve(false); }
    var originalBeatsArray = analysis.beatsArray;
    var preSnapshot = _snapshotBeatFields(analysis);
    var samples44100 = lastDecodedSamples;
    log("Running alternative beat detector (Beat This!)" + (automatic ? " as part of Analyze" : "") + "...");
    return window.BeatMarkerAudio.resampleMono(samples44100, window.BeatMarkerAudio.TARGET_SAMPLE_RATE, 22050)
      .then(function (samples22050) {
        return runBeatThisWorker(samples22050, originalBeatsArray);
      })
      .then(function (btResult) {
        var newBeats = btResult.beatTimes;
        if (!newBeats || newBeats.length < 4) {
          throw _keptGridError("found too few beats (" + (newBeats ? newBeats.length : 0) + ") - keeping the original grid.", null);
        }
        var ratio = newBeats.length / originalBeatsArray.length;
        if (ratio > BEATTHIS_COUNT_RATIO_GUARD || ratio < 1 / BEATTHIS_COUNT_RATIO_GUARD) {
          throw _keptGridError(
            "beat count (" + newBeats.length + ") differs too much from the original (" + originalBeatsArray.length +
            ") to trust - keeping the original grid.", btResult
          );
        }
        if (typeof btResult.meanPeakLogit === "number" && btResult.meanPeakLogit < BEATTHIS_MIN_MEAN_PEAK_LOGIT) {
          throw _keptGridError(
            "model confidence too low (mean peak logit " + btResult.meanPeakLogit.toFixed(2) +
            " < " + BEATTHIS_MIN_MEAN_PEAK_LOGIT + ") - keeping the original grid.", btResult
          );
        }
        // downbeatTimes come from the same inference that produced newBeats:
        // the "1"s counted over the whole song (worker/beatthis-bars.js), or
        // the model's own when that did not run. The guard below looks at
        // the model's own "1"s.
        var modelDownbeatTimes = btResult.modelDownbeatTimes || btResult.downbeatTimes || [];
        if (modelDownbeatTimes.length < 2) {
          throw _keptGridError(
            "found too few native downbeats (" + modelDownbeatTimes.length + ") - keeping the original grid.", null
          );
        }
        var rawDownbeatTimes = btResult.downbeatTimes && btResult.downbeatTimes.length >= 2
          ? btResult.downbeatTimes
          : modelDownbeatTimes;
        var densityRatio = window.BeatMarkerCuesheet.computeGridDensityRatio(originalBeatsArray, newBeats);
        var halfTimeCorrected = densityRatio !== null &&
          densityRatio >= BEATTHIS_DENSITY_RATIO_HALF_MIN && densityRatio <= BEATTHIS_DENSITY_RATIO_HALF_MAX;
        var finalDownbeatTimes = halfTimeCorrected
          ? window.BeatMarkerCuesheet.interpolateDownbeatMidpoints(rawDownbeatTimes)
          : rawDownbeatTimes;
        // Fallback phase (see BEAT_FIELD_KEYS above), computed from the raw
        // (pre-interpolation) downbeats, since interpolated midpoints are not
        // beatsArray members and would only add noise to the vote.
        var nativePhase = window.BeatMarkerCuesheet.computeNativeDownbeatPhase(newBeats, rawDownbeatTimes);
        // Regularity of the model's own downbeats (see
        // computeDownbeatRegularity() in js/cuesheet.js), logged on the
        // model's own "1"s: the decoded ones are even by construction.
        var regularity = window.BeatMarkerCuesheet.computeDownbeatRegularity(modelDownbeatTimes);
        // A "1" less than 1.5 beats after another is dropped
        // (thinCloseDownbeats in js/cuesheet.js).
        var thinned = window.BeatMarkerCuesheet.thinCloseDownbeats(newBeats, finalDownbeatTimes);
        // The warning row (_updatePhaseUncertainHint): the decoder's own
        // "unsure" flag, or the model's own "1"s, placed the same way, too
        // uneven (downbeatsLookUneven).
        var modelUneven = window.BeatMarkerCuesheet.downbeatsLookUneven(
          window.BeatMarkerCuesheet.thinCloseDownbeats(newBeats, halfTimeCorrected
            ? window.BeatMarkerCuesheet.interpolateDownbeatMidpoints(modelDownbeatTimes)
            : modelDownbeatTimes).times);
        return {
          newBeats: newBeats,
          downbeatTimes: thinned.times,
          thinnedCount: thinned.dropped,
          nativePhase: nativePhase !== null ? nativePhase : 0,
          halfTimeCorrected: halfTimeCorrected,
          regularity: regularity,
          barsDecoded: btResult.barsDecoded === true,
          // null when the decoder did not run: the warning row then tests
          // the placed "1"s for unevenness.
          barsUnsure: btResult.barsDecoded === true ? (btResult.barsUnsure === true || modelUneven) : null,
          tempoChangeRegions: []
        };
      })
      .then(function (merged) {
        if (lastAnalysis !== analysis) {
          // A new Analyze, or a different clip, took over while Beat This!
          // was running - its result belongs to a grid that is gone.
          log("Alternative analysis finished after the clip changed - discarded.");
          return false;
        }
        _assertAudioUnchanged(clipInfo);
        lastAnalysis._preBeatThisSnapshot = preSnapshot;
        lastAnalysis.beatThisApplied = true;
        lastAnalysis.beatThisAuto = !!automatic;
        lastAnalysis.beatThisReverted = false;
        lastAnalysis.beatThisFailed = false;
        lastAnalysis._preRetempoSnapshot = null;
        _applyBeatFieldsAndRefreshUI({
          beatsArray: merged.newBeats,
          downbeatTimes: merged.downbeatTimes,
          phase: merged.nativePhase,
          phaseMarginRatio: null,
          phaseSource: "beatthis-native",
          bassPhase: null,
          bassPhaseMarginRatio: null,
          chordPhase: null,
          chordPhaseMarginRatio: null,
          chordPhaseAvailable: false,
          phaseAgreement: "native",
          chordChangeEvents: [],
          tempoChangeRegions: merged.tempoChangeRegions,
          barsUnsure: merged.barsUnsure
        }, audioPath, clipInfo);
        log("Alternative analysis applied: " + merged.newBeats.length + " beats, " +
            merged.downbeatTimes.length + " native downbeats" +
            (merged.halfTimeCorrected ? " (half-time grid corrected)" : "") + ".");
        log(merged.barsDecoded
          ? "Bars counted over the whole song: " + merged.downbeatTimes.length + " \"1\" markers" +
            (merged.barsUnsure ? " (the model was unsure where the bars start)." : ".")
          : "Bars: kept the model's own \"1\" markers (the bars could not be counted over this song).");
        if (merged.thinnedCount) {
          log("Removed " + merged.thinnedCount + " \"1\" markers that came less than 1.5 beats after another.");
        }
        if (merged.regularity) {
          // Logged for the record, on the model's own "1"s; the warning
          // row reads barsUnsure instead - see _updatePhaseUncertainHint.
          log("Model's own downbeat spacing regularity: " +
              Math.round((1 - merged.regularity.deviatingFraction) * 100) + "% of " +
              merged.regularity.intervalCount + " intervals within 20% of the median (" +
              merged.regularity.medianIntervalSec.toFixed(3) + "s).");
        }
        return true;
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : err;
        log("Alternative analysis: " + message);
        if (lastAnalysis === analysis && err && err.guard) {
          // A guard rejection is deterministic for this grid - offering the
          // same button again would only reject again.
          analysis.beatThisRejected = true;
          analysis.beatThisFailed = false;
          window.BeatMarkerLibrary.setBeatGrid(audioPath, "kept");
          persistLibrary();
          _updateGridConfidenceHint(analysis.confidence);
          if (err.gridBars) {
            _applyBarsOnKeptGrid(err.gridBars, originalBeatsArray, audioPath, clipInfo);
          }
        } else if (lastAnalysis === analysis) {
          // The detector did not finish (time limit, crash, missing model):
          // nothing was decided about this grid. Basic stays saved, the Beat
          // grid line says so and Refined can be tried again.
          analysis.beatThisFailed = true;
          _updateGridConfidenceHint(analysis.confidence);
        }
        return false;
      });
  }

  // When the count or the peak-logit guard turns Beat This!'s beats away,
  // the worker has already counted the bars on the grid that stays
  // (decodeBarsOnGrid in worker/beatthis-bars.js); those "1"s replace the
  // bass / chord phase. The two other guards (too few beats or "1"s) keep
  // that phase.
  // Every guard's refusal is marked, so a run that did not finish is not
  // saved as a refusal.
  function _keptGridError(message, btResult) {
    var err = new Error(message);
    err.guard = true;
    var g = btResult && btResult.gridBars;
    if (g && g.downbeatTimes && g.downbeatTimes.length >= 2) { err.gridBars = g; }
    return err;
  }

  // The warning row follows the same rule as on Beat This!'s grid: the
  // decoder's "unsure", or the model's own "1"s, placed on this grid, too
  // uneven. The phase margin describes the bass / chord pick, not these
  // "1"s, so phaseMarginRatio is cleared.
  function _applyBarsOnKeptGrid(gridBars, gridBeats, audioPath, clipInfo) {
    if (lastAnalysis.beatsArray !== gridBeats) {
      // ½x / 2x replaced the grid while Beat This! was running.
      log("Bars on the original grid: the grid changed meanwhile - kept its own \"1\" markers.");
      return;
    }
    try {
      var C = window.BeatMarkerCuesheet;
      var thinned = C.thinCloseDownbeats(gridBeats, gridBars.downbeatTimes);
      var own = gridBars.modelDownbeatTimes || [];
      var modelUneven = own.length < 2 || C.downbeatsLookUneven(C.thinCloseDownbeats(gridBeats, own).times);
      var phase = C.computeNativeDownbeatPhase(gridBeats, gridBars.downbeatTimes);
      var fields = _snapshotBeatFields(lastAnalysis);
      fields.downbeatTimes = thinned.times;
      fields.phase = phase !== null ? phase : 0;
      fields.phaseMarginRatio = null;
      fields.phaseSource = "bars-decoded";
      fields.bassPhase = null;
      fields.bassPhaseMarginRatio = null;
      fields.chordPhase = null;
      fields.chordPhaseMarginRatio = null;
      fields.chordPhaseAvailable = false;
      fields.phaseAgreement = "native";
      fields.chordChangeEvents = [];
      fields.barsUnsure = gridBars.unsure === true || modelUneven;
      _applyBeatFieldsAndRefreshUI(fields, audioPath, clipInfo);
      log("Bars counted over the whole song on the original grid: " + thinned.times.length + " \"1\" markers" +
          (fields.barsUnsure ? " (the model was unsure where the bars start)." : "."));
    } catch (e) {
      log("Bars on the original grid: " + (e && e.message ? e.message : e));
    }
  }
  beatThisBtn.addEventListener("click", function () {
    if (!lastAnalysis) {
      return;
    }
    // A grid opened from the saved list has neither the other grid nor the
    // decoded audio in memory: the switch analyzes the clip again, then
    // takes the grid asked for.
    var canRevert = lastAnalysis.beatThisApplied && lastAnalysis._preBeatThisSnapshot;
    var haveAudio = lastDecodedSamples && lastDecodedSamplesPath === lastAnalysis.audioPath;
    if (!canRevert && (lastAnalysis.beatThisApplied || !haveAudio)) {
      _reanalyzeForBeatGrid(!lastAnalysis.beatThisApplied);
      return;
    }
    var audioPath = lastAnalysis.audioPath;
    var clipInfo = lastAnalysis.clipInfo;
    try { _assertAudioUnchanged(clipInfo); } catch (changed) { log(changed.message); return; }
    // Second click after Beat This! was already applied = revert, not re-run
    // - restores the snapshot taken just before the first apply, no
    // essentia/Beat This! call needed.
    if (lastAnalysis.beatThisApplied && lastAnalysis._preBeatThisSnapshot) {
      var restored = lastAnalysis._preBeatThisSnapshot;
      lastAnalysis.beatThisApplied = false;
      lastAnalysis.beatThisReverted = true; // keeps the row up so it can be re-applied
      lastAnalysis._preBeatThisSnapshot = null;
      // Invalidated, not restored/merged; the user can always re-run retempo
      // fresh if they still want it.
      lastAnalysis._preRetempoSnapshot = null;
      _applyBeatFieldsAndRefreshUI(restored, audioPath, clipInfo);
      log("Reverted to the original analysis: " + lastAnalysis.beatsArray.length + " beats, phase " + lastAnalysis.phase + ".");
      return;
    }
    beatThisBtn.disabled = true;
    gridRefinedBtn.disabled = gridBasicBtn.disabled = true;
    showBusy("busy.default");
    _runBeatThisOnCurrentAnalysis(false).then(function () {
      beatThisBtn.disabled = false;
      gridRefinedBtn.disabled = gridBasicBtn.disabled = false;
      hideBusy();
    });
  });

  // Analyze applies Refined by itself; for Basic its result is switched
  // back right after. Not when another clip took over meanwhile.
  function _reanalyzeForBeatGrid(refined) {
    var audioPath = lastAnalysis.audioPath;
    log("Beat grid: analyzing the clip again to switch to " + (refined ? "Refined" : "Basic") + ".");
    beatThisBtn.disabled = true;
    gridRefinedBtn.disabled = gridBasicBtn.disabled = true;
    return _analyzeSelectedClip().then(function () {
      beatThisBtn.disabled = false;
      gridRefinedBtn.disabled = gridBasicBtn.disabled = false;
      if (!refined && lastAnalysis && lastAnalysis.audioPath === audioPath &&
          lastAnalysis.beatThisApplied && lastAnalysis._preBeatThisSnapshot) {
        beatThisBtn.click();
      }
    });
  }

  // Beat grid: Refined / Basic. Choosing the word that is not lit clicks the
  // hidden #beatThisBtn: from Refined to Basic it reverts (instant), from
  // Basic to Refined it runs the second detector (a few seconds).
  function _chooseBeatGrid(refined) {
    if (beatThisBtn.disabled) return;
    var applied = !!(lastAnalysis && lastAnalysis.beatThisApplied);
    if (refined !== applied) beatThisBtn.click();
  }
  gridRefinedBtn.addEventListener("click", function () { _chooseBeatGrid(true); });
  gridBasicBtn.addEventListener("click", function () { _chooseBeatGrid(false); });
  // MANUAL BPM MODE, for an editor who already knows the track's tempo and
  // does not want to run analysis. It skips decode and essentia: it builds a
  // synthetic, evenly spaced beatsArray covering the clip's in/out range
  // (padded on both sides, see MANUAL_BPM_GRID_PAD_BEATS) and stores it in
  // lastAnalysis in the same shape a real Analyze produces, so every
  // downstream consumer (Place markers, phase shift, the beat-click preview,
  // the track library) accepts it unchanged.
  var manualBpmInput = document.getElementById("manualBpmInput");
  var manualBpmBtn = document.getElementById("manualBpmBtn");
  // Extra beats generated before and after the clip's in/out range, so the
  // phase-shift buttons have real beats to move onto on either side; without
  // them, shifting near an edge would drop the first or last downbeat instead
  // of moving it. (A real analysis has beats across the whole source file.)
  var MANUAL_BPM_GRID_PAD_BEATS = 8;
  function _restoreManualBpmSnapshot(snap) {
    try {
      _assertAudioUnchanged(snap.clipInfo);
      if (snap.lastAnalysis) { _assertAudioUnchanged(snap.lastAnalysis.clipInfo); }
    } catch (changed) { log(changed.message); return; }
    lastAnalysis = snap.lastAnalysis;
    _setBpmText(snap.bpmText);
    beatCountDisplay.textContent = snap.beatCountText;
    _updatePhaseShiftUi();
    _updatePhaseUncertainHint(lastAnalysis ? lastAnalysis.phaseMarginRatio : null);
    _updatePhaseAgreementHint(lastAnalysis);
    _updateGridConfidenceHint(lastAnalysis ? lastAnalysis.confidence : null);
    _updateRetempoLikelyHint(null, null); // no cached onset rate to re-check against: neutral
    _refreshBeatClickPreview();
    var mediaPath = snap.clipInfo.mediaPath;
    // Decided now, not when Set BPM ran: a key set or detected since then
    // must survive the undo.
    var now = window.BeatMarkerLibrary.get(mediaPath);
    var keyDataNow = !!(now && (now.camelot || now.confirmedKey || now.confirmedBpm || now.detectedKey ||
      (Array.isArray(now.intervalKeys) && now.intervalKeys.length)));
    if (snap.libraryFields) {
      window.BeatMarkerLibrary.upsertAnalysis(mediaPath, basename(mediaPath), snap.libraryFields);
    } else if (snap.libraryHadOtherData || keyDataNow) {
      window.BeatMarkerLibrary.upsertAnalysis(mediaPath, basename(mediaPath),
        { bpm: undefined, beatsArray: undefined, confidence: undefined, phase: undefined, clipInfo: undefined });
    } else {
      window.BeatMarkerLibrary.remove(mediaPath);
    }
    renderLibrary();
    persistLibrary();
    _refreshClipLine();
    log(snap.lastAnalysis
      ? "Set BPM reverted - restored the previous analysis (" + snap.bpmText + " BPM, " + snap.lastAnalysis.beatsArray.length + " beats)."
      : "Set BPM reverted - back to no analysis for this clip.");
  }

  // A Custom BPM grid is even and covers the clip however it is trimmed
  // later: when the clip now ends past the grid, more beats are laid on at
  // the same tempo (its start already reaches back to the file's start).
  // The saved entry takes the longer grid when it held this one.
  function _coverCustomGrid(analysis, clipInfo) {
    var bpm = analysis && analysis.evenGridBpm;
    if (!(bpm > 0) || !clipInfo || typeof clipInfo.outPointSeconds !== "number" || !analysis.beatsArray.length) {
      return;
    }
    var beats = analysis.beatsArray;
    var interval = 60 / bpm;
    if (beats[beats.length - 1] >= clipInfo.outPointSeconds + interval) {
      return;
    }
    var longer = beats.slice();
    var end = clipInfo.outPointSeconds + MANUAL_BPM_GRID_PAD_BEATS * interval;
    for (var i = beats.length; beats[0] + i * interval <= end; i++) {
      longer.push(beats[0] + i * interval);
    }
    analysis.beatsArray = longer;
    var entry = window.BeatMarkerLibrary.get(analysis.audioPath);
    if (entry && entry.beatsArray === beats) {
      window.BeatMarkerLibrary.upsertAnalysis(analysis.audioPath, entry.label, {
        bpm: entry.bpm, beatsArray: longer, confidence: entry.confidence, phase: entry.phase,
        downbeatTimes: entry.downbeatTimes, barsUnsure: entry.barsUnsure, clipInfo: entry.clipInfo
      });
      persistLibrary();
    }
    if (analysis === lastAnalysis) {
      beatCountDisplay.textContent = String(longer.length);
    }
    log("Custom BPM grid laid on to the clip's new end: " + longer.length + " beats.");
  }
  manualBpmBtn.addEventListener("click", function () {
    // Second click while a manual BPM grid is showing undoes it instead of
    // re-applying - same one-click-undo shape as beatThisBtn above.
    if (lastAnalysis && lastAnalysis.manualBpm && lastAnalysis._preManualBpmSnapshot) {
      _restoreManualBpmSnapshot(lastAnalysis._preManualBpmSnapshot);
      return;
    }
    var bpm = parseFloat(manualBpmInput.value);
    if (!(bpm > 0) || bpm > 999) {
      log("Set BPM: enter a BPM between 0 and 999.");
      return;
    }
    manualBpmBtn.disabled = true;
    showBusy("busy.default");
    var myGeneration = ++_activeOperationGeneration;
    getClipInfo()
      .then(function (clipInfo) {
        if (myGeneration !== _activeOperationGeneration) {
          log("Set BPM: a newer Analyze/Detect key/Set BPM was started before this one finished - discarding this one.");
          return;
        }
        clipInfo.fileIdentity = window.BeatMarkerLibrary.fileIdentity(clipInfo.mediaPath);
        var libraryEntryBefore = window.BeatMarkerLibrary.get(clipInfo.mediaPath);
        var preSnapshot = {
          clipInfo: clipInfo,
          // Only this file's analysis comes back on Undo, also when another
          // clip was selected just before the click.
          lastAnalysis: lastAnalysis && lastAnalysis.audioPath === clipInfo.mediaPath ? lastAnalysis : null,
          bpmText: bpmDisplay.textContent,
          beatCountText: beatCountDisplay.textContent,
          phaseText: phaseDisplay.textContent,
          libraryFields: libraryEntryBefore ? {
            bpm: libraryEntryBefore.bpm,
            beatsArray: libraryEntryBefore.beatsArray,
            confidence: libraryEntryBefore.confidence,
            phase: libraryEntryBefore.phase,
            downbeatTimes: libraryEntryBefore.downbeatTimes,
            barsUnsure: libraryEntryBefore.barsUnsure,
            beatGrid: libraryEntryBefore.beatGrid || null,
            clipInfo: libraryEntryBefore.clipInfo
          } : null,
          libraryHadOtherData: !!(libraryEntryBefore && libraryEntryBefore.camelot)
        };
        // Counted from the clip's start where the BPM was typed: a beat and
        // a "1" fall there, and the grid reaches back to the file's start,
        // so a later trim of the clip's start keeps the same grid
        // (_coverCustomGrid lays it on past the end).
        var beatInterval = 60 / bpm;
        var anchor = clipInfo.inPointSeconds;
        var beatsBefore = Math.floor((anchor + 1e-9) / beatInterval);
        var gridEnd = clipInfo.outPointSeconds + MANUAL_BPM_GRID_PAD_BEATS * beatInterval;
        var beatsArray = [];
        for (var b = 0; anchor + (b - beatsBefore) * beatInterval <= gridEnd; b++) {
          beatsArray.push(Math.max(0, anchor + (b - beatsBefore) * beatInterval));
        }
        lastAnalysis = {
          beatsArray: beatsArray,
          confidence: 1.0,
          clipInfo: clipInfo,
          audioPath: clipInfo.mediaPath,
          phase: beatsBefore % 4,
          phaseMarginRatio: null,
          manualBpm: true,
          evenGridBpm: bpm,
          onsetsArray: null,
          chordPhaseAvailable: false,
          phaseAgreement: "unknown",
          _preManualBpmSnapshot: preSnapshot
        };
        _updatePhaseShiftUi();
        _setBpmText(bpm.toFixed(2));
        beatCountDisplay.textContent = String(beatsArray.length);
        _updatePhaseUncertainHint(null);
        _updatePhaseAgreementHint(null);
        _updateGridConfidenceHint(null); // manual/synthetic grid, no real detection confidence to show
        _updateRetempoLikelyHint(null, null);
        _refreshBeatClickPreview();
        log("BPM set manually to " + bpm.toFixed(2) + " - generated " + beatsArray.length +
            " synthetic beat markers (not detected from audio). Use the \"1\" buttons if the " +
            "\"one\" doesn't line up, then Place markers when ready. Click \"" + window.BeatMarkerI18n.t("analyze.revertManualBpmBtn") + "\" above to undo.");
        var upsertResult = window.BeatMarkerLibrary.upsertAnalysis(
          clipInfo.mediaPath, basename(clipInfo.mediaPath),
          { bpm: bpm, beatsArray: beatsArray, confidence: 1.0, phase: lastAnalysis.phase, beatGrid: "custom", clipInfo: clipInfo }
        );
        if (upsertResult.clipInfoChanged) {
          log("Note: " + basename(clipInfo.mediaPath) + " was previously analyzed on a different track/position " +
              "(track " + upsertResult.previousClipInfo.trackIndex + "). The library now points at THIS instance " +
              "(track " + clipInfo.trackIndex + ").");
        }
        renderLibrary();
        persistLibrary();
        _refreshClipLine();
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : err;
        log("Set BPM failed: " + message);
        _flashSelectionError(message);
      })
      .then(function () {
        manualBpmBtn.disabled = false;
        hideBusy();
      });
  });
  // HALF / DOUBLE TEMPO CORRECTION. RhythmExtractor2013's dominant failure
  // mode is the octave error: reporting half or double the true BPM (e.g. a
  // 174 BPM drum & bass track detected as 87). _forcedTempoWindow() builds the
  // forced minTempo/maxTempo window for the re-derive, clamped to these
  // floors and ceilings.
  var ESSENTIA_MIN_TEMPO_FLOOR = 40;
  var ESSENTIA_MIN_TEMPO_CEIL = 180;
  var ESSENTIA_MAX_TEMPO_FLOOR = 60;
  var ESSENTIA_MAX_TEMPO_CEIL = 250;
  var RETEMPO_WINDOW_MARGIN = 1.4;
  function _forcedTempoWindow(currentBpm, factor) {
    if (factor === 2) {
      return {
        minTempo: Math.min(ESSENTIA_MIN_TEMPO_CEIL, Math.max(ESSENTIA_MIN_TEMPO_FLOOR, Math.round(currentBpm * RETEMPO_WINDOW_MARGIN))),
        maxTempo: Math.min(ESSENTIA_MAX_TEMPO_CEIL, Math.max(208, Math.ceil(currentBpm * 2 * 1.05)))
      };
    }
    return {
      minTempo: ESSENTIA_MIN_TEMPO_FLOOR,
      maxTempo: Math.max(ESSENTIA_MAX_TEMPO_FLOOR, Math.min(ESSENTIA_MAX_TEMPO_CEIL, Math.round(currentBpm / RETEMPO_WINDOW_MARGIN)))
    };
  }
  function _applyRecomputedBeatsAnalysis(analysis, logPrefix) {
    var oldPhase = lastAnalysis.phase;
    var oldPhaseMarginRatio = lastAnalysis.phaseMarginRatio;
    lastAnalysis.beatsArray = analysis.beatsArray;
    lastAnalysis.downbeatTimes = null;
    lastAnalysis.confidence = analysis.confidence;
    lastAnalysis.phase = analysis.phase;
    lastAnalysis.phaseMarginRatio = analysis.phaseMarginRatio;
    lastAnalysis.phaseSource = analysis.phaseSource;
    lastAnalysis.bassPhase = analysis.bassPhase;
    lastAnalysis.bassPhaseMarginRatio = analysis.bassPhaseMarginRatio;
    lastAnalysis.chordPhase = analysis.chordPhase;
    lastAnalysis.chordPhaseMarginRatio = analysis.chordPhaseMarginRatio;
    lastAnalysis.chordPhaseAvailable = analysis.chordPhaseAvailable;
    lastAnalysis.phaseAgreement = analysis.phaseAgreement;
    lastAnalysis.chordChangeEvents = analysis.chordChangeEvents || [];
    lastAnalysis.lowContrast = analysis.lowContrast;
    // Onsets are not recomputed here (it would need another worker call).
    lastAnalysis.onsetsArray = null;
    lastAnalysis.evenGridBpm = null;
    _forgetPhaseShift();
    _markGridBasic();
    var newBpm = _gridBpm(analysis.beatsArray, analysis.cuesheet.bpm);
    _updatePhaseShiftUi();
    _setBpmText(newBpm.toFixed(2));
    beatCountDisplay.textContent = String(analysis.beatsArray.length);
    _updatePhaseUncertainHint(analysis.phaseMarginRatio);
    _updatePhaseAgreementHint(analysis);
    _updateGridConfidenceHint(analysis.confidence);
    _updateRetempoLikelyHint(null, null);
    _refreshBeatClickPreview();
    log(logPrefix + newBpm.toFixed(2) + " BPM, " + analysis.beatsArray.length +
        " beats, confidence " + analysis.confidence.toFixed(2) + ".");
    // Only fires on an actual phase CHANGE with a real confidence drop, not
    // on every recompute (½x/2x round trips that keep the same phase index,
    // or that land on an equally/more confident one, say nothing).
    if (typeof oldPhaseMarginRatio === "number" && typeof analysis.phaseMarginRatio === "number" &&
        oldPhase !== analysis.phase && analysis.phaseMarginRatio < oldPhaseMarginRatio) {
      log("Note: this recompute also re-picked the downbeat phase - was " + oldPhase + " at " +
          (oldPhaseMarginRatio * 100).toFixed(1) + "% margin, now " + analysis.phase + " at " +
          (analysis.phaseMarginRatio * 100).toFixed(1) + "% margin. If markers were already placed with the " +
          "old phase and sounded right, you may want to re-place with phase " + oldPhase +
          " using the \"1\" buttons (1 2 3 4) instead of this new pick.");
    }
    var upsertResult = window.BeatMarkerLibrary.upsertAnalysis(
      lastAnalysis.audioPath, basename(lastAnalysis.audioPath),
      { bpm: newBpm, beatsArray: analysis.beatsArray, confidence: analysis.confidence, phase: analysis.phase,
        downbeatTimes: lastAnalysis.downbeatTimes, barsUnsure: lastAnalysis.barsUnsure,
        beatGrid: _beatGridOf(lastAnalysis), clipInfo: lastAnalysis.clipInfo }
    );
    if (upsertResult.clipInfoChanged) {
      log("Note: " + basename(lastAnalysis.audioPath) + " was previously analyzed on a different track/position " +
          "(track " + upsertResult.previousClipInfo.trackIndex + ").");
    }
    renderLibrary();
    persistLibrary();
    _refreshClipLine();
  }
  // Two BPMs within this relative tolerance count as the same tempo (see
  // _maybePreserveBetterPhase()).
  var RETEMPO_BPM_SIMILAR_TOLERANCE = 0.05;
  function _maybePreserveBetterPhase(analysis, oldBpm) {
    var oldPhase = lastAnalysis.phase;
    var oldMargin = lastAnalysis.phaseMarginRatio;
    if (typeof oldMargin !== "number" || typeof analysis.phaseMarginRatio !== "number") {
      return;
    }
    if (oldPhase === analysis.phase || oldPhase === null || typeof oldPhase !== "number") {
      return;
    }
    var bpmRatio = analysis.cuesheet.bpm / oldBpm;
    var bpmSimilar = Math.abs(bpmRatio - 1) <= RETEMPO_BPM_SIMILAR_TOLERANCE;
    if (bpmSimilar && oldMargin > analysis.phaseMarginRatio) {
      log("Keeping the previous downbeat phase (" + oldPhase + ", " + (oldMargin * 100).toFixed(1) +
          "% margin) instead of this recompute's own pick (" + analysis.phase + ", " +
          (analysis.phaseMarginRatio * 100).toFixed(1) + "% margin) - the new BPM (" +
          analysis.cuesheet.bpm.toFixed(2) + ") is close enough to the old one (" + oldBpm.toFixed(2) +
          ") that this looks like re-analysis noise, not a real tempo correction.");
      analysis.phase = oldPhase;
      analysis.phaseMarginRatio = oldMargin;
      analysis.phaseSource = lastAnalysis.phaseSource;
      analysis.bassPhase = lastAnalysis.bassPhase;
      analysis.bassPhaseMarginRatio = lastAnalysis.bassPhaseMarginRatio;
      analysis.chordPhase = lastAnalysis.chordPhase;
      analysis.chordPhaseMarginRatio = lastAnalysis.chordPhaseMarginRatio;
      analysis.chordPhaseAvailable = lastAnalysis.chordPhaseAvailable;
      analysis.phaseAgreement = lastAnalysis.phaseAgreement;
    }
  }
  // Fields _applyRecomputedBeatsAnalysis() actually sets on lastAnalysis -
  // kept as one list (same reasoning as BEAT_FIELD_KEYS above) so the
  // round-trip snapshot/restore pair below can never drift out of sync with
  // what a forward retempo recompute touches.
  // The Beat grid state is part of it (_markGridBasic): the reverse click
  // brings back a Refined grid as Refined.
  var RETEMPO_FIELD_KEYS = [
    "beatsArray", "downbeatTimes", "confidence", "phase", "phaseMarginRatio",
    "phaseSource", "bassPhase", "bassPhaseMarginRatio", "chordPhase",
    "chordPhaseMarginRatio", "chordPhaseAvailable", "phaseAgreement",
    "chordChangeEvents", "lowContrast", "onsetsArray",
    "beatThisApplied", "beatThisRejected", "beatThisReverted", "beatThisFailed", "_preBeatThisSnapshot"
  ];
  function _snapshotRetempoFields() {
    var snap = {};
    for (var i = 0; i < RETEMPO_FIELD_KEYS.length; i++) {
      snap[RETEMPO_FIELD_KEYS[i]] = lastAnalysis[RETEMPO_FIELD_KEYS[i]];
    }
    return snap;
  }
  function _applyRetempoSnapshotAndRefreshUI(fields, bpmText) {
    for (var i = 0; i < RETEMPO_FIELD_KEYS.length; i++) {
      lastAnalysis[RETEMPO_FIELD_KEYS[i]] = fields[RETEMPO_FIELD_KEYS[i]];
    }
    _forgetPhaseShift();
    _updatePhaseShiftUi();
    _setBpmText(bpmText);
    beatCountDisplay.textContent = String(lastAnalysis.beatsArray.length);
    _updatePhaseUncertainHint(lastAnalysis.phaseMarginRatio);
    _updatePhaseAgreementHint(lastAnalysis);
    _updateGridConfidenceHint(lastAnalysis.confidence);
    _updateRetempoLikelyHint(null, null);
    _refreshBeatClickPreview();
    window.BeatMarkerLibrary.upsertAnalysis(
      lastAnalysis.audioPath, basename(lastAnalysis.audioPath),
      { bpm: parseFloat(bpmText), beatsArray: lastAnalysis.beatsArray, confidence: lastAnalysis.confidence,
        phase: lastAnalysis.phase, downbeatTimes: lastAnalysis.downbeatTimes, barsUnsure: lastAnalysis.barsUnsure,
        beatGrid: _beatGridOf(lastAnalysis), clipInfo: lastAnalysis.clipInfo }
    );
    renderLibrary();
    persistLibrary();
    _refreshClipLine();
  }
  // Needs the decoded audio of this clip (lastDecodedSamples, cached from
  // Analyze / Detect key); falls back to the naive path when it is not
  // available (manual BPM mode, or a stale cache from a different clip).
  // A recompute is not exactly reversible (e.g. half and then double need
  // not return the original beat count), so the previous result is kept as
  // _preRetempoSnapshot and the opposite click restores it. Only one undo
  // level is kept, like _preBeatThisSnapshot and _preManualBpmSnapshot. The
  // snapshot is invalidated if Beat This! is applied or reverted in between.
  function _retempoViaRecompute(factor, currentBpm) {
    var origin = lastAnalysis, generation = _activeOperationGeneration;
    try { _assertAudioUnchanged(origin.clipInfo); } catch (err) { log(err.message); return; }
    var reverseFactor = factor === 2 ? 0.5 : 2;

    var pending = lastAnalysis._preRetempoSnapshot;
    if (pending && pending.reverseFactor === factor) {
      lastAnalysis._preRetempoSnapshot = null;
      _applyRetempoSnapshotAndRefreshUI(pending.fields, pending.bpmText);
      log("Tempo re-derive: restored the pre-retempo grid exactly (" + pending.bpmText + " BPM, " +
          lastAnalysis.beatsArray.length + " beats) instead of re-deriving one that would merely " +
          "resemble it - this reverses the previous " + (factor === 2 ? "½×" : "2×") + " click.");
      return;
    }
    var preSnapshot = _snapshotRetempoFields();
    var preBpmText = bpmDisplay.textContent;
    var tempoWindow = _forcedTempoWindow(currentBpm, factor);
    log("Tempo re-derive (" + (factor === 2 ? "faster" : "slower") + "): re-running essentia constrained to " +
        tempoWindow.minTempo + "-" + tempoWindow.maxTempo + " BPM (not a plain ×2/÷2 of the old grid)...");
    retempoHalfBtn.disabled = true;
    retempoDoubleBtn.disabled = true;
    showBusy("busy.default");
    runAnalyzeWorker("beats", lastDecodedSamples, lastAnalysis.audioPath, tempoWindow)
      .then(function (analysis) {
        if (generation !== _activeOperationGeneration || lastAnalysis !== origin) { return; }
        _assertAudioUnchanged(origin.clipInfo);
        _maybePreserveBetterPhase(analysis, currentBpm);
        _applyRecomputedBeatsAnalysis(analysis, "Tempo re-derived (constrained re-analysis, not a naive ×2/÷2): now ");
        lastAnalysis._preRetempoSnapshot = { reverseFactor: reverseFactor, fields: preSnapshot, bpmText: preBpmText };
      })
      .catch(function (err) {
        if (generation !== _activeOperationGeneration || lastAnalysis !== origin) { return; }
        try { _assertAudioUnchanged(origin.clipInfo); } catch (changed) { log(changed.message); return; }
        log("Tempo re-derive failed (" + (err && err.message ? err.message : err) +
            ") - falling back to a plain ×2/÷2 of the existing grid instead.");
        _retempoNaive(factor);
      })
      .then(function () {
        retempoHalfBtn.disabled = false;
        retempoDoubleBtn.disabled = false;
        hideBusy();
      });
  }
  function _retempo(factor) {
    if (!lastAnalysis || !lastAnalysis.beatsArray || lastAnalysis.beatsArray.length < 2) {
      log("½×/2× tempo: run Analyze or Set BPM first.");
      return;
    }
    try { _assertAudioUnchanged(lastAnalysis.clipInfo); } catch (err) { log(err.message); return; }
    var canRecompute = !lastAnalysis.manualBpm && !lastAnalysis.evenGridBpm && lastDecodedSamples &&
      lastDecodedSamplesPath === lastAnalysis.audioPath;
    var currentBpm = canRecompute ? _estimateBpmFromBeats(lastAnalysis.beatsArray) : 0;
    if (canRecompute && currentBpm > 0) {
      _retempoViaRecompute(factor, currentBpm);
      return;
    }
    _retempoNaive(factor);
  }
  function _retempoNaive(factor) {
    var beats = lastAnalysis.beatsArray;
    var newBeats;
    if (factor === 2) {
      // Detected tempo was too SLOW (true tempo is double) - the real beat
      // grid has twice as many beats, so insert the midpoint between every
      // consecutive detected pair.
      newBeats = [];
      for (var i = 0; i < beats.length; i++) {
        newBeats.push(beats[i]);
        if (i < beats.length - 1) {
          newBeats.push((beats[i] + beats[i + 1]) / 2);
        }
      }
    } else {
      // factor === 0.5: detected tempo was too FAST (true tempo is half) -
      // every other detected "beat" was actually a real beat, the rest were
      // spurious subdivisions - keep only every other one.
      newBeats = [];
      for (var h = 0; h < beats.length; h += 2) {
        newBeats.push(beats[h]);
      }
      if (newBeats.length < 4) {
        log("½× tempo: not enough beats left after halving - skipped.");
        return;
      }
    }
    var spacings = [];
    for (var s = 1; s < newBeats.length; s++) {
      spacings.push(newBeats[s] - newBeats[s - 1]);
    }
    var meanInterval = spacings.reduce(function (a, b) { return a + b; }, 0) / spacings.length;
    var newBpm = meanInterval > 0 ? 60 / meanInterval : 0;
    lastAnalysis.beatsArray = newBeats;
    lastAnalysis.downbeatTimes = null;
    lastAnalysis.phase = 0;
    lastAnalysis.phaseMarginRatio = null;
    lastAnalysis.chordPhaseAvailable = false;
    lastAnalysis.phaseAgreement = "unknown";
    // A Custom BPM grid halved or doubled is still even.
    if (lastAnalysis.evenGridBpm) { lastAnalysis.evenGridBpm *= factor; }
    _forgetPhaseShift();
    _markGridBasic();
    _updatePhaseShiftUi();
    _setBpmText(newBpm.toFixed(2));
    beatCountDisplay.textContent = String(newBeats.length);
    _updatePhaseUncertainHint(null);
    _updatePhaseAgreementHint(null);
    _updateGridConfidenceHint(null); // naive rescale has no fresh confidence measurement for the new synthetic grid
    _updateRetempoLikelyHint(null, null); // no onsetRate cached to re-check against the new bpm - neutral until the next full Analyze, better than a stale warning based on the bpm just changed away from
    _refreshBeatClickPreview();
    log("Tempo re-derived (" + (factor === 2 ? "doubled" : "halved") + "): now " + newBpm.toFixed(2) +
        " BPM, " + newBeats.length + " beats. Downbeat phase was reset - pick the real \"one\" with the 1 2 3 4 buttons.");
    // Saved like any other grid, so the BPM shown and saved follows ½× / 2×
    // after a trim or another selection too.
    window.BeatMarkerLibrary.upsertAnalysis(
      lastAnalysis.audioPath, basename(lastAnalysis.audioPath),
      { bpm: newBpm, beatsArray: newBeats, confidence: lastAnalysis.confidence, phase: 0, downbeatTimes: null,
        barsUnsure: lastAnalysis.barsUnsure, beatGrid: _beatGridOf(lastAnalysis), clipInfo: lastAnalysis.clipInfo }
    );
    renderLibrary();
    persistLibrary();
    _refreshClipLine();
  }
  retempoHalfBtn.addEventListener("click", function () { _retempo(0.5); });
  retempoDoubleBtn.addEventListener("click", function () { _retempo(2); });
  // The "1" buttons (1 2 3 4) show how far the user moved the "1" from
  // where the analysis put it (0, +1, +2, -1 - four beats a bar); 1 puts it
  // back. Counted on lastAnalysis.phaseShift; any new grid
  // (Analyze, Beat This! apply / revert, ½× / 2×) starts again at 0.
  function _forgetPhaseShift() {
    if (lastAnalysis) {
      lastAnalysis.phaseShift = 0;
      lastAnalysis._originalPhase = undefined;
      lastAnalysis._originalDownbeatTimes = null;
    }
  }
  // Hand nudge (Shift - / +): 1 ms per click, -30 to +30 ms, remembered per
  // audio file in settings.markerNudgeMs.
  var NUDGE_LIMIT_MS = 30;
  var _nudgeByPath = (initialSettings.markerNudgeMs && typeof initialSettings.markerNudgeMs === "object") ? initialSettings.markerNudgeMs : {};
  var nudgeEarlierBtn = document.getElementById("nudgeEarlierBtn");
  var nudgeLaterBtn = document.getElementById("nudgeLaterBtn");
  var nudgeValue = document.getElementById("nudgeValue");
  var nudgeNumber = document.getElementById("nudgeNumber");
  var _nudgeTimer = null;
  function _nudgeMsFor(audioPath) {
    var v = (audioPath && _nudgeByPath) ? _nudgeByPath[audioPath] : 0;
    return typeof v === "number" && isFinite(v) ? v : 0;
  }
  function _updateNudgeUi() {
    if (!nudgeNumber) {
      return; // called by _updatePhaseShiftUi before this part of boot ran
    }
    var ms = lastAnalysis ? _nudgeMsFor(lastAnalysis.audioPath) : 0;
    nudgeNumber.textContent = (ms > 0 ? "+" : ms < 0 ? "\u2212" : "") + Math.abs(ms);
    nudgeValue.classList.toggle("is-set", ms !== 0);
    nudgeEarlierBtn.disabled = !lastAnalysis || ms <= -NUDGE_LIMIT_MS;
    nudgeLaterBtn.disabled = !lastAnalysis || ms >= NUDGE_LIMIT_MS;
  }
  // A click counts for the clip selected when it is made: one that comes
  // before the panel noticed another selection changes nothing.
  function _nudgeMarkers(deltaMs) {
    if (!lastAnalysis) {
      return;
    }
    var analysis = lastAnalysis;
    getClipInfo().then(function (fresh) {
      if (lastAnalysis !== analysis || fresh.mediaPath !== analysis.audioPath) {
        log("Shift: another clip is selected now - nothing changed.");
        _flashSelectionError(I18n.t("selection.clipChanged"));
        return;
      }
      _applyNudge(analysis.audioPath, deltaMs);
    }, function (err) {
      _flashSelectionError(err && err.message ? err.message : String(err));
    });
  }
  function _setNudgeMs(path, ms) {
    var copy = {};
    for (var k in _nudgeByPath) { if (Object.prototype.hasOwnProperty.call(_nudgeByPath, k)) { copy[k] = _nudgeByPath[k]; } }
    if (ms) { copy[path] = ms; } else { delete copy[path]; }
    var keys = Object.keys(copy);
    if (keys.length > 300) { delete copy[keys[0]]; } // oldest first; a few hundred tracks is plenty
    _nudgeByPath = copy;
    persistSettings({ markerNudgeMs: copy });
    _updateNudgeUi();
  }
  var _nudgeBefore = null; // { path, ms } before the clicks the next re-place carries
  function _applyNudge(path, deltaMs) {
    if (!_nudgeBefore || _nudgeBefore.path !== path) {
      _nudgeBefore = { path: path, ms: _nudgeMsFor(path) };
    }
    _setNudgeMs(path, Math.max(-NUDGE_LIMIT_MS, Math.min(NUDGE_LIMIT_MS, _nudgeMsFor(path) + deltaMs)));
    if (_nudgeTimer) { clearTimeout(_nudgeTimer); }
    _nudgeTimer = setTimeout(function () {
      _nudgeTimer = null;
      var before = _nudgeBefore;
      _nudgeBefore = null;
      if (!lastAnalysis || lastAnalysis.audioPath !== path) {
        return;
      }
      // A refused re-place puts the number back, so it matches the markers
      // (unless newer clicks changed it meanwhile).
      var sent = _nudgeMsFor(path);
      _replaceMarkersIfPlaced(lastAnalysis.phase, "Shift", {
        confirm: function () {},
        undo: function () { if (before && _nudgeMsFor(path) === sent) { _setNudgeMs(path, before.ms); } }
      });
    }, 400);
  }
  nudgeEarlierBtn.addEventListener("click", function () { _nudgeMarkers(-1); });
  nudgeLaterBtn.addEventListener("click", function () { _nudgeMarkers(1); });
  _updateNudgeUi();
  var PHASE_CELL_IDS = ["phaseBeat1", "phaseBeat2", "phaseBeat3", "phaseBeat4"];
  function _phaseShiftIndex() {
    return lastAnalysis ? ((((lastAnalysis.phaseShift || 0) % 4) + 4) % 4) : 0;
  }
  function _updatePhaseShiftUi() {
    _updateNudgeUi();
    var display = document.getElementById("phaseDisplay");
    var n = _phaseShiftIndex();
    if (display) {
      display.textContent = !lastAnalysis ? "–" : (n === 0 ? "0" : n === 1 ? "+1" : n === 2 ? "+2" : "−1");
    }
    for (var c = 0; c < PHASE_CELL_IDS.length; c++) {
      var cell = document.getElementById(PHASE_CELL_IDS[c]);
      if (cell) {
        cell.classList.toggle("is-active", !!lastAnalysis && c === n);
        cell.disabled = !lastAnalysis;
      }
    }
  }
  function shiftPhase(delta) {
    if (!lastAnalysis) {
      log("Shift phase: run Analyze selected audio first.");
      return;
    }
    var edit = _startPhaseEdit();
    // The first shift remembers the grid as the analysis found it, so Reset
    // can bring it back exactly (Beat This!'s downbeats included - shifting
    // them snaps interpolated ones onto beats, so shifting back would not
    // restore them).
    if (!lastAnalysis.phaseShift) {
      lastAnalysis._originalPhase = lastAnalysis.phase;
      lastAnalysis._originalDownbeatTimes = lastAnalysis.downbeatTimes ? lastAnalysis.downbeatTimes.slice() : null;
    }
    lastAnalysis.phaseShift = (lastAnalysis.phaseShift || 0) + delta;
    // Native downbeat mode (Beat This! applied, see BEAT_FIELD_KEYS): no 0-3
    // phase index drives placement, so shifting moves the whole
    // downbeat-times array by `delta` real beats. shiftDownbeatTimes() in
    // js/cuesheet.js remaps each downbeat (including interpolated midpoints,
    // which are not beatsArray members) to its nearest beatsArray index +
    // delta. `phase` itself is left unchanged: buildDownbeatsCuesheet()
    // ignores it whenever downbeatTimes is present, so re-placing at the same
    // `lastAnalysis.phase` picks up the shifted array.
    // Otherwise the phase index itself moves, set here at once so a second
    // click or Shift's re-place before the host's answer starts from it.
    if (lastAnalysis.downbeatTimes && lastAnalysis.downbeatTimes.length) {
      lastAnalysis.downbeatTimes = window.BeatMarkerCuesheet.shiftDownbeatTimes(
        lastAnalysis.downbeatTimes, lastAnalysis.beatsArray, delta
      );
    } else {
      lastAnalysis.phase = ((lastAnalysis.phase + delta) % 4 + 4) % 4;
    }
    edit.made();
    _updatePhaseShiftUi();
    _refreshBeatClickPreview();
    _replaceMarkersIfPlaced(lastAnalysis.phase, "Shift phase", edit);
  }
  // Back to the "1" the analysis found, and markers placed there.
  function resetPhaseShift() {
    if (!lastAnalysis || !lastAnalysis.phaseShift) {
      return;
    }
    var edit = _startPhaseEdit();
    if (lastAnalysis._originalDownbeatTimes) {
      lastAnalysis.downbeatTimes = lastAnalysis._originalDownbeatTimes.slice();
    }
    var phase = typeof lastAnalysis._originalPhase === "number" ? lastAnalysis._originalPhase : lastAnalysis.phase;
    _forgetPhaseShift();
    lastAnalysis.phase = phase;
    edit.made();
    _updatePhaseShiftUi();
    _refreshBeatClickPreview();
    _replaceMarkersIfPlaced(phase, "Reset phase", edit);
  }
  // A beat button: 1 puts the "1" back exactly (resetPhaseShift); 2-4 shift
  // by the shortest way there (+1, +2, or -1 for 4).
  function _choosePhaseBeat(target) {
    if (!lastAnalysis) {
      _flashSelectionError(I18n.t("selection.needAnalyze"));
      return;
    }
    var n = _phaseShiftIndex();
    if (target === n) {
      // After the host's Undo the markers can sit on another beat than the
      // lit cell: a click on it puts Downbeat's markers back where it says
      // (with none on the clip it changes nothing).
      var analysis = lastAnalysis;
      evalJson("countOwnMarkersForSelectedClip(" + JSON.stringify(JSON.stringify(_placedTimelineJson())) + ")").then(function (data) {
        if (data && data.count && lastAnalysis === analysis) { _replaceMarkersIfPlaced(analysis.phase, "Choose the 1"); }
      }, function () { /* nothing to put back */ });
      return;
    }
    if (target === 0) {
      resetPhaseShift();
      return;
    }
    var delta = target - n;
    if (delta > 2) {
      delta -= 4;
    } else if (delta < -1) {
      delta += 4;
    }
    shiftPhase(delta);
  }
  [document.getElementById("phaseBeat1"), document.getElementById("phaseBeat2"),
   document.getElementById("phaseBeat3"), document.getElementById("phaseBeat4")].forEach(function (cell, k) {
    cell.addEventListener("click", function () { _choosePhaseBeat(k); });
  });
  _updatePhaseShiftUi();
  // Cleanup companion to Place markers: removes the markers this plugin
  // placed on and around the selected clip (both sequence and clip markers;
  // see jsx/host.jsx clearMarkersForSelectedClip() for the exact scope).
  var clearMarkersBtn = document.getElementById("clearMarkersBtn");
  clearMarkersBtn.addEventListener("click", function () {
    clearMarkersBtn.disabled = true;
    showBusy("busy.clearMarkers");
    log("Clearing Downbeat's markers for the selected clip (your own markers stay)...");
    evalJson("clearMarkersForSelectedClip(true, " + JSON.stringify(JSON.stringify(_placedTimelineJson())) + ")")
      .then(function (data) {
        _rememberPlacedTimeline({ placedKey: data.placedKey, placedTimes: null, forgetKeys: data.forgetKeys });
        log("Cleared " + data.sequenceMarkersRemoved + " sequence marker(s) between " +
            data.clipStartSeconds.toFixed(3) + "s and " + data.clipEndSeconds.toFixed(3) + "s" +
            (data.clipMarkersAttempted
              ? ", and " + data.clipMarkersRemoved + " clip marker(s)."
              : " (clip markers not attempted - see log)."));
      })
      .catch(function (err) {
        log("Clear markers failed: " + err);
        _flashSelectionError(err && err.message ? err.message : err);
      })
      .then(function () {
        clearMarkersBtn.disabled = false;
        hideBusy();
      });
  });
  // COPY / PASTE MARKERS: moves a clip's markers between sequences.
  var copyMarkersBtn = document.getElementById("copyMarkersBtn");
  var pasteMarkersBtn = document.getElementById("pasteMarkersBtn");
  var copyMarkersStatus = document.getElementById("copyMarkersStatus");
  var _copiedMarkers = null; // { clipName, sequenceMarkers: [{localSeconds,label}], clipMarkers: [{localSeconds,label}] }
  function _flashCopyMarkersStatus(message) {
    copyMarkersStatus.textContent = message;
    setTimeout(function () { copyMarkersStatus.textContent = ""; }, 4000);
  }
  copyMarkersBtn.addEventListener("click", function () {
    copyMarkersBtn.disabled = true;
    showBusy("busy.default");
    evalJson("getMarkersDataForSelectedClip()")
      .then(function (data) {
        var total = data.sequenceMarkers.length + data.clipMarkers.length;
        if (total === 0) {
          _copiedMarkers = null;
          log("Copy markers: no markers found on the selected clip.");
          _flashCopyMarkersStatus(I18n.t("analyze.copyMarkersNone"));
          return Promise.resolve();
        }
        _copiedMarkers = data;
        log("Copied " + data.sequenceMarkers.length + " sequence marker(s) + " + data.clipMarkers.length +
            " clip marker(s) from \"" + data.clipName + "\".");
        _flashCopyMarkersStatus(I18n.t("analyze.copyMarkersDone", { count: String(total) }));
        return Promise.resolve();
      })
      .catch(function (err) {
        log("Copy markers failed: " + (err && err.message ? err.message : err));
        _flashSelectionError(err && err.message ? err.message : err);
      })
      .then(function () {
        copyMarkersBtn.disabled = false;
        hideBusy();
      });
  });
  pasteMarkersBtn.addEventListener("click", function () {
    if (!_copiedMarkers) {
      _flashCopyMarkersStatus(I18n.t("analyze.pasteMarkersNothing"));
      return;
    }
    pasteMarkersBtn.disabled = true;
    showBusy("busy.default");
    getClipInfo()
      .then(function (clipInfo) {
        return evalJson("pasteMarkersData(" + _jsxJsonArg(_copiedMarkers) + "," + _jsxJsonArg(clipInfo) + ")")
          .then(function (result) {
            log("Pasted " + result.created + " marker(s)" + (result.skipped ? "; skipped " + result.skipped + " outside the target" : "") +
              (result.kept ? "; " + result.kept + " already there (the same media's own markers, or the same marker at the same time)" : "") + ".");
            return result;
          });
      })
      .then(function (result) {
        _flashCopyMarkersStatus(I18n.t(result && !result.created && result.kept ? "analyze.pasteMarkersAlready" : "analyze.pasteMarkersDone"));
      })
      .catch(function (err) {
        log("Paste markers failed: " + (err && err.message ? err.message : err));
        _flashSelectionError(err && err.message ? err.message : err);
      })
      .then(function () {
        pasteMarkersBtn.disabled = false;
        hideBusy();
      });
  });
  // Key / tonality detection. Independent of Analyze / lastAnalysis above: it
  // works on any selected clip, music or sound effect (an effect with no
  // clear tonality gets a low `strength`, which is not an error), using the
  // same decode pipeline as beat analysis.
  var lastKeyResult = null; // { key, scale, strength, camelot, mediaPath, manual, material, corroborated, runnerUp, perProfile, ... }
  var keyResultDisplay = document.getElementById("keyResultDisplay");
  var compatibleKeysRow = document.getElementById("compatibleKeysRow");
  var compatibleKeysDisplay = document.getElementById("compatibleKeysDisplay");
  var keyAgreementRow = document.getElementById("keyAgreementRow");
  var keyAgreementDisplay = document.getElementById("keyAgreementDisplay");
  // The calculator uses the selected playback key and current BPM. Each shift
  // composes with the clip's existing rate to produce a final source-file rate.
  var pitchFromSelect = document.getElementById("pitchFromSelect");
  var pitchToSelect = document.getElementById("pitchToSelect");
  var pitchSemitonesEl = document.getElementById("pitchSemitones");
  var pitchUnitsEl = document.getElementById("pitchUnits");
  var pitchAltEl = document.getElementById("pitchAlt");
  var pitchNoteEl = document.getElementById("pitchNote");
  function populatePitchSelects() {
    var previousFrom = pitchFromSelect.value;
    var previousTo = pitchToSelect.value;
    // Camelot code plus the plain key name in every option: some editors
    // think in "4A", others in "F minor".
    var codes = window.BeatMarkerPitch.allCodes();
    var html = "";
    for (var i = 0; i < codes.length; i++) {
      var name = window.BeatMarkerCamelot.fromCamelotCode(codes[i]);
      html += '<option value="' + codes[i] + '">' + codes[i] + "  \u00b7  " + _localKeyName(name.key, name.scale) + "</option>";
    }
    pitchFromSelect.innerHTML = html;
    pitchToSelect.innerHTML = html;
    pitchFromSelect.value = previousFrom || "8A";
    pitchToSelect.value = previousTo || "8A";
  }
  populatePitchSelects();
  function _formatSemitones(n) {
    if (n === 0) {
      return I18n.t("key.pitchNoShift");
    }
    var category = "other";
    try {
      category = new Intl.PluralRules(I18n.getLanguage()).select(Math.abs(n));
    } catch (e) {
    }
    var vars = { n: (n > 0 ? "+" : "") + n };
    var key = "key.pitchSemitones_" + category;
    var text = I18n.t(key, vars);
    return text === key ? I18n.t("key.pitchSemitones_other", vars) : text;
  }
  function _pitchTempoBpm() {
    if (!lastKeyResult || !lastKeyResult.mediaPath) {
      return null;
    }
    var entry = window.BeatMarkerLibrary.get(lastKeyResult.mediaPath);
    return (entry && typeof entry.bpm === "number" && entry.bpm > 0) ? entry.bpm : null;
  }
  function _keyNameOf(code) {
    var name = window.BeatMarkerCamelot.fromCamelotCode(code);
    return name ? _localKeyName(name.key, name.scale) : code;
  }
  var pitchApplyBtn = document.getElementById("pitchApplyBtn");
  var pitchApplyStatus = document.getElementById("pitchApplyStatus");
  var displayedPitchSignature = null;
  function renderPitch() {
    var view = _selectedPlayback();
    var bpm = view && view.bpm || _pitchTempoBpm();
    var plan = window.BeatMarkerPitch.playbackPlan(view ? view.speed : 1, pitchFromSelect.value, pitchToSelect.value,
      view ? view.sourceBpm : bpm);
    displayedPitchSignature = view ? view.signature : null;
    pitchApplyBtn.disabled = !view || !view.camelot || !plan || !plan.primary.semitones;
    pitchNoteEl.className = "pitch-note";
    if (!plan) {
      pitchSemitonesEl.textContent = "-";
      pitchUnitsEl.textContent = "";
      pitchAltEl.textContent = "";
      pitchNoteEl.textContent = "";
      return;
    }
    var p = plan.primary;
    pitchSemitonesEl.textContent = _formatSemitones(p.semitones);
    if (p.semitones === 0) {
      setTranslatedText(pitchUnitsEl, "key.pitchAlready");
      pitchAltEl.textContent = "";
    } else {
      setTranslatedText(pitchUnitsEl, "key.pitchUnits", {
        cents: (p.cents > 0 ? "+" : "") + p.cents,
        speed: (plan.finalSpeed * 100).toFixed(2)
      });
      var altText = "";
      if (plan.alternative) {
        altText = I18n.t(plan.alternative.semitones < 0 ? "key.pitchOctaveLower" : "key.pitchOctaveHigher",
          { shift: _formatSemitones(plan.alternative.semitones) }) + " ";
      }
      // Only resampling shifters change the length; saying which kind does
      // stops this reading as a contradiction of the speed figure above.
      altText += I18n.t("key.pitchResample", {
        percent: p.timeStretchPercent.toFixed(1),
        tempo: p.newBpm ? I18n.t("key.pitchTempo", { from: bpm.toFixed(2), to: p.newBpm.toFixed(2) }) : ""
      });
      pitchAltEl.textContent = altText;
    }
    // Transposition keeps the mode, so a target in the other mode is not
    // reachable - say where the shift really lands instead of implying it
    // worked.
    var note = "";
    if (plan.modeChanges) {
      pitchNoteEl.className = "pitch-note is-caveat";
      note = I18n.t("key.pitchModeKept", {
        shift: _formatSemitones(p.semitones), landing: plan.landing,
        landingName: _keyNameOf(plan.landing), target: plan.to
      });
      if (plan.alreadyCompatible) {
        note += I18n.t("key.pitchAlreadyMixes", { from: plan.from, target: plan.to });
      } else if (plan.landingMixesWithTarget) {
        note += I18n.t("key.pitchLandingMixes", { target: plan.to });
      }
    } else if (plan.alreadyCompatible && p.semitones !== 0) {
      note = I18n.t("key.pitchCompatibleNoShift", { from: plan.from, target: plan.to });
    }
    if (view && view.camelot && pitchFromSelect.value !== view.camelot) {
      note += (note ? " " : "") + I18n.t("key.pitchAssumedFrom");
    }
    pitchNoteEl.textContent = note;
  }
  pitchFromSelect.addEventListener("change", renderPitch);
  pitchToSelect.addEventListener("change", renderPitch);
  // Pitch the selected clip: the clip's own file, the same part of it, placed
  // at the clip's place on a free track at the speed that gives the shift
  // (pitch with it, like a sampler - js/bridge.js and host.jsx
  // insertAudioAtPlayhead), and the original switched off.
  pitchApplyBtn.addEventListener("click", function () {
    var view = _selectedPlayback();
    var plan = view && window.BeatMarkerPitch.playbackPlan(view.speed, pitchFromSelect.value, pitchToSelect.value, view.sourceBpm);
    var signature = displayedPitchSignature;
    var st = plan ? plan.primary.semitones : 0;
    if (!st) {
      return;
    }
    pitchApplyStatus.textContent = "";
    pitchApplyBtn.disabled = true;
    showBusy("busy.default");
    getClipInfo()
      .then(function (clip) {
        // A switched-off clip is usually the original of an earlier pitch,
        // and that copy still plays: a new copy would play along with it.
        if (clip.disabled) {
          throw new Error(I18n.t("key.pitchClipOff"));
        }
        var fresh = _selectedPlayback();
        if (!fresh || !fresh.camelot || fresh.signature !== signature) {
          _restoreCachedKey(clip);
          throw new Error(I18n.t("key.pitchSelectionChanged"));
        }
        var inSec = Math.max(0, clip.inPointSeconds || 0);
        var outSec = typeof clip.outPointSeconds === "number" && clip.outPointSeconds > inSec ? clip.outPointSeconds : null;
        var opts = { atSeconds: clip.clipStartSeconds, muteSelected: true, selectInserted: true, inSec: inSec, speed: plan.finalSpeed, reverse: !!clip.reversed, pitchReference: clip,
          knownPlaced: _placedTimelineJson() };
        if (outSec !== null) {
          opts.outSec = outSec;
        }
        return evalJson("insertAudioAtPlayhead(" + _jsxJsonArg(clip.mediaPath) + ", " + (outSec || 0) + ", " +
                        _jsxJsonArg(opts) + ")").then(function (data) {
          if (data.pictureFailed) {
            throw new Error(I18n.t("key.pitchPictureFailed"));
          }
          if (data.speedFailed || data.trimFailed) {
            throw new Error(I18n.t("library.speedFailed", { name: basename(clip.mediaPath) }));
          }
          _rememberPlacedTimeline(data.placedTimeline); // the original's timeline set now belongs to the pitched clip
          setTranslatedText(pitchApplyStatus, data.muted ? "key.pitchApplyDone" : "key.pitchApplyNotMuted", { where: data.where });
          if (!data.selected) {
            pitchApplyStatus.textContent += " " + I18n.t("key.pitchSelectNew");
          }
          log("Key: " + basename(clip.mediaPath) + " placed " + (st > 0 ? "+" : "") + st + " st at " + Number(data.startSeconds).toFixed(2) +
              " s on " + data.where + " (the file itself, at speed " + opts.speed.toFixed(4) + ")" +
              (data.muted ? "; the original is switched off." : "; the original could not be switched off - do it by hand."));
          log(data.selected ? "Key: the pitched clip is selected for further analysis." :
            "Key: select the new pitched clip before further analysis; automatic selection was not confirmed.");
          return getClipInfo().then(function (inserted) {
            // The copy plays the same part of the file; its in / out can
            // read back a frame off, so a Selected-clip key goes with it.
            if (inserted.mediaPath === clip.mediaPath && Math.abs(inserted.inPointSeconds - clip.inPointSeconds) < 0.1 &&
                Math.abs(inserted.outPointSeconds - clip.outPointSeconds) < 0.1 &&
                window.BeatMarkerLibrary.carryKey(clip.mediaPath, _keyScopeFor(clip), _keyScopeFor(inserted))) {
              persistLibrary();
            }
            _restoreCachedKey(inserted);
          }).catch(function () { selectedClipInfo = null; _clearSelectionDependentState(); });
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        setTranslatedText(pitchApplyStatus, "key.pitchApplyFailed", { error: _translateHostReason(msg) || msg });
        log("Key: could not pitch the clip: " + msg);
      })
      .then(function () {
        hideBusy();
        renderPitch();
      });
  });
  renderPitch();

  function renderKeyResult() {
    var reset = document.getElementById("clearKeyOverrideBtn");
    reset.hidden = !(lastKeyResult && lastKeyResult.manual);
    if (!lastKeyResult) {
      keyResultDisplay.textContent = "-";
      document.getElementById("playbackKeyDisplay").textContent = "-";
      _renderHeardKey();
      compatibleKeysRow.style.display = "none";
      keyAgreementRow.style.display = "none";
      window.BeatMarkerWheel.renderWheel(document.getElementById("camelotWheel"), null);
      renderPitch();
      return;
    }
    var playback = _selectedPlayback();
    var playbackCode = playback && playback.camelot;
    if (playbackCode) { pitchFromSelect.value = playbackCode; }
    document.getElementById("playbackKeyDisplay").textContent = playbackCode ? playbackCode + " - " + _keyNameOf(playbackCode) : I18n.t("key.playbackUnknown");
    renderPitch();
    var text = lastKeyResult.camelot || "?";
    if (lastKeyResult.camelot) {
      var openKeyCode = window.BeatMarkerCamelot.toOpenKeyCode(lastKeyResult.camelot);
      var enharmonic = window.BeatMarkerCamelot.getEnharmonicSpelling(lastKeyResult.camelot);
      if (openKeyCode) {
        text += " / " + openKeyCode;
      }
      if (enharmonic) {
        text += " (" + enharmonic + ")";
      }
    }
    if (!lastKeyResult.manual) {
      // Name only: the raw KeyExtractor strength (0-1) is not a confidence
      // figure. It stays in the log; the confidence line below is what to go
      // by.
      text += " - " + _localKeyName(lastKeyResult.key, lastKeyResult.scale);
    } else {
      text += " " + I18n.t("key.manuallySet");
    }
    keyResultDisplay.textContent = text;
    _renderHeardKey();
    window.BeatMarkerWheel.renderWheel(document.getElementById("camelotWheel"), playbackCode);
    // The direct answer to "which key should the OTHER track / riser / SFX be
    // for this to sound good with it", shown as plain key names alongside the
    // Camelot codes, for users who do not know Camelot notation.
    if (playbackCode) {
      var compatibleCodes = window.BeatMarkerCamelot.getCompatibleCodes(playbackCode);
      var parts = [];
      for (var i = 0; i < compatibleCodes.length; i++) {
        var friendly = window.BeatMarkerCamelot.fromCamelotCode(compatibleCodes[i]);
        parts.push(compatibleCodes[i] + (friendly ? " (" + _localKeyName(friendly.key, friendly.scale) + ")" : ""));
      }
      compatibleKeysDisplay.textContent = parts.join(", ");
      compatibleKeysRow.style.display = "";
    } else {
      compatibleKeysRow.style.display = "none";
    }
    // A cached library entry or a manual override has none of these fields
    // and hides the row.
    var confidence = _describeKeyConfidence(lastKeyResult);
    if (confidence) {
      keyAgreementDisplay.textContent = confidence.text;
      keyAgreementDisplay.className = "hint" + (confidence.warn ? " is-error" : "");
      keyAgreementRow.style.display = "";
    } else {
      keyAgreementRow.style.display = "none";
    }
  }
  function _describeKeyConfidence(r) {
    if (!r || r.manual || !r.perProfile) {
      return null;
    }
    if (r.shortClip) {
      return { text: I18n.t("key.confShort", { sec: r.durationSec.toFixed(1) }), warn: false };
    }
    if (r.witnessSkipped) { return { text: I18n.t("key.confTwoChecked"), warn: false }; }
    if (r.material === "music" && r.agreement3) {
      var other = r.dissent ? r.dissent : null;
      if (r.agreement3 === "all3") {
        return { text: I18n.t("key.confAll3"), warn: false };
      }
      if (r.agreement3 === "two") {
        return { text: I18n.t("key.confTwo", { alt: other ? I18n.t("key.confTwoAlt", { code: other }) : "" }), warn: false };
      }
      return { text: I18n.t("key.confNone", { alt: other ? I18n.t("key.confNoneAlt", { code: other }) : "" }), warn: true };
    }
    if (r.corroborated) {
      return { text: I18n.t("key.confCorroborated"), warn: false };
    }
    if (r.witnessAvailable) {
      var alt = r.runnerUp ? I18n.t("key.confDisagreesAlt", { code: r.runnerUp.camelot }) : "";
      return { text: I18n.t("key.confDisagrees", { alt: alt }), warn: true };
    }
    // No witness at all - fall back to what the profiles alone can say
    // (nothing, with SFX mode's single profile).
    if (!(r.totalProfiles > 1)) {
      return null;
    }
    if (r.profileAgreement === "agreed") {
      return { text: I18n.t("key.confAllAgree", { n: r.totalProfiles }), warn: false };
    }
    if (r.profileAgreement === "compatible") {
      return { text: I18n.t("key.confCompatible"), warn: false };
    }
    return {
      text: I18n.t("key.confUncertain", { alt: r.runnerUp ? I18n.t("key.confUncertainAlt", { code: r.runnerUp.camelot }) : "" }),
      warn: true
    };
  }
  // Music / SFX switch - which profile set Detect key uses (js/analyze.js's
  // KEY_PROFILE_SETS). Remembered across sessions. Buttons are told apart by
  // id rather than data-material so scripts/test-panel-boot.js's stub DOM can
  // click them too.
  var keyMaterialMusicBtn = document.getElementById("keyMaterialMusicBtn");
  var keyMaterialSfxBtn = document.getElementById("keyMaterialSfxBtn");
  var keyMaterial = "music";
  function applyKeyMaterial(material, isInitialBoot) {
    keyMaterial = material === "sfx" ? "sfx" : "music";
    keyMaterialMusicBtn.classList.toggle("is-active", keyMaterial === "music");
    keyMaterialSfxBtn.classList.toggle("is-active", keyMaterial === "sfx");
    if (!isInitialBoot) {
      persistSettings({ keyMaterial: keyMaterial });
      getClipInfo().then(_restoreCachedKey).catch(function () {
        lastKeyResult = null; renderKeyResult();
      });
    }
  }
  keyMaterialMusicBtn.addEventListener("click", function () { applyKeyMaterial("music"); });
  keyMaterialSfxBtn.addEventListener("click", function () { applyKeyMaterial("sfx"); });
  applyKeyMaterial(initialSettings.keyMaterial, true);

  var keyScopeSelect = document.getElementById("keyScopeSelect");
  var keyScope = initialSettings.keyScope === "clip" ? "clip" : "file";
  keyScopeSelect.value = keyScope;
  function _keyScopeFor(clipInfo, scope, material) {
    return window.BeatMarkerAnalysisCache.scopeKey(scope || keyScope, material || keyMaterial,
      clipInfo, window.BeatMarkerAudio.TARGET_SAMPLE_RATE);
  }
  function _restoreCachedKey(clipInfo) {
    var cached = window.BeatMarkerLibrary.getKey(clipInfo.mediaPath, _keyScopeFor(clipInfo));
    selectedClipInfo = clipInfo;
    lastKeyResult = cached ? Object.assign({}, cached, { mediaPath: clipInfo.mediaPath,
      scopeKey: _keyScopeFor(clipInfo), clipSpeed: Number(clipInfo.speed) > 0 ? Number(clipInfo.speed) : 1 }) : null;
    _refreshPlaybackConsumers();
  }
  keyScopeSelect.addEventListener("change", function () {
    keyScope = keyScopeSelect.value === "clip" ? "clip" : "file";
    persistSettings({ keyScope: keyScope });
    getClipInfo().then(_restoreCachedKey).catch(function () { lastKeyResult = null; renderKeyResult(); });
  });

  var detectKeyBtn = document.getElementById("detectKeyBtn");
  detectKeyBtn.addEventListener("click", function () {
    detectKeyBtn.disabled = true;
    showBusy("busy.detectKey");
    var myGeneration = ++_activeOperationGeneration;
    var clipInfoForKey = null;
    var requestedScope = keyScope, requestedMaterial = keyMaterial;
    getClipInfo()
      .then(function (clipInfo) {
        clipInfoForKey = clipInfo;
        clipInfo.fileIdentity = window.BeatMarkerLibrary.fileIdentity(clipInfo.mediaPath);
        log("Reading file for key detection: " + clipInfo.mediaPath);
        log("Key selected clip: playback speed " + ((Number(clipInfo.speed) > 0 ? Number(clipInfo.speed) : 1) * 100).toFixed(2) +
            "%, timeline start " + Number(clipInfo.clipStartSeconds || 0).toFixed(2) + "s; detector reads source audio.");
        return window.BeatMarkerAudio.decodeFileToMono44100(clipInfo.mediaPath, {
          onFallback: function () { log("The panel's decoder could not read this file; using the plugin's own WAV / AIFF reader."); }
        });
      })
      .then(function (decoded) {
        log("Decoded (" + decoded.original.durationSec.toFixed(2) + "s). Running KeyExtractor...");
        if (myGeneration === _activeOperationGeneration) {
          lastDecodedSamples = decoded.samples;
          lastDecodedSamplesPath = clipInfoForKey.mediaPath;
        }
        var input = decoded.samples;
        if (requestedScope === "clip") {
          try {
            input = window.BeatMarkerAnalysisCache.interval(decoded.samples,
              window.BeatMarkerAudio.TARGET_SAMPLE_RATE, clipInfoForKey).samples;
          } catch (intervalError) { throw new Error(I18n.t("key.scopeInvalid")); }
        }
        log("Key analysis scope: " + requestedScope + ", " + (input.length / 44100).toFixed(2) + "s.");
        return _detectKey(input, requestedMaterial);
      })
      .then(function (result) {
        _assertAudioUnchanged(clipInfoForKey);
        result.scopeKey = _keyScopeFor(clipInfoForKey, requestedScope, requestedMaterial);

        if (myGeneration !== _activeOperationGeneration || requestedScope !== keyScope || requestedMaterial !== keyMaterial) {
          log("Detect key: a newer Analyze/Detect key was started before this one finished - " +
              "cached its result, but not showing it since a different clip is now selected.");
          if (result.camelot) {
            window.BeatMarkerLibrary.upsertKey(clipInfoForKey.mediaPath, basename(clipInfoForKey.mediaPath), result);
            renderLibrary();
            persistLibrary();
          }
          return;
        }
        lastKeyResult = {
          key: result.key,
          scale: result.scale,
          strength: result.strength,
          camelot: result.camelot,
          mediaPath: clipInfoForKey.mediaPath,
          // The clip's speed, so the key can also be shown as the
          // timeline plays it.
          clipSpeed: Number(clipInfoForKey.speed) > 0 ? Number(clipInfoForKey.speed) : 1,
          scopeKey: result.scopeKey,
          manual: false,
          // Music/SFX vote + chord witness - see js/analyze.js's detectKey().
          // Not persisted to the library, so a cached entry simply shows no
          // confidence line.
          material: result.material,
          corroborated: result.corroborated,
          witnessAvailable: result.witnessAvailable,
          chordCamelot: result.chordCamelot,
          profileAgreement: result.profileAgreement,
          runnerUp: result.runnerUp,
          durationSec: result.durationSec,
          shortClip: result.shortClip,
          votes: result.votes,
          totalProfiles: result.totalProfiles,
          perProfile: result.perProfile,
          // S-KEY third opinion (Music mode, js/key-combine.js)
          witnessSkipped: result.witnessSkipped || false,
          skeyCamelot: result.skeyCamelot || null,
          voteCamelot: result.voteCamelot || null,
          agreement3: result.agreement3 || null,
          dissent: result.dissent || null,
          keySource: result.keySource || "vote"
        };
        if (!result.camelot) {
          log("Key detected: " + result.key + " " + result.scale +
              " - this key name has no Camelot code, so it is shown without one.");
        } else {
          log("Key detected: " + result.key + " " + result.scale + " -> Camelot " + result.camelot +
              (typeof result.strength === "number" ? " (strength " + result.strength.toFixed(4) + " - lower means less confident; " : " (") +
              "a low strength is normal for sounds without a clear pitch). " +
              result.material + " profiles: " + result.perProfile.map(function (r) { return r.profile + "=" + r.camelot; }).join(", ") +
              " (" + result.votes + "/" + result.totalProfiles + " votes, " + result.profileAgreement + "). " +
              "Chord witness: " + (result.witnessSkipped ? "not run (vote and S-KEY agree)" : result.witnessAvailable ? result.chordCamelot + (result.corroborated ? " (agrees)" : " (disagrees)") : "unavailable") +
              ". " + (result.skeyCamelot ? "S-KEY: " + result.skeyCamelot + " -> " + result.agreement3 + " agree" +
                (result.keySource !== "vote" ? " (S-KEY + chords outvoted the profile vote " + result.voteCamelot + ")" : "") + ". " : "") +
              result.durationSec.toFixed(1) + "s" + (result.shortClip ? " - short clip, flagged as unreliable." : "."));
          window.BeatMarkerLibrary.upsertKey(
            clipInfoForKey.mediaPath, basename(clipInfoForKey.mediaPath), result
          );
          renderLibrary();
          persistLibrary();
          var confirmed = window.BeatMarkerLibrary.getKey(clipInfoForKey.mediaPath, result.scopeKey);
          if (confirmed && confirmed.manual) { lastKeyResult = Object.assign({}, lastKeyResult, confirmed); }
        }
        _refreshPlaybackConsumers();
        var playback = _selectedPlayback();
        log("Key source: " + result.camelot + "; selected playback: " + (playback && playback.camelot || "between keys or unavailable") +
          "; speed " + (playback ? (playback.speed * 100).toFixed(2) : "unknown") + "% (calculated from speed).");
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : err;
        log("Key detection failed: " + message);
        _flashSelectionError(message);
      })
      .then(function () {
        detectKeyBtn.disabled = false;
        hideBusy();
      });
  });
  document.getElementById("applyKeyOverrideBtn").addEventListener("click", function () {
    var raw = document.getElementById("keyOverrideInput").value.trim().toUpperCase();
    var isValidCode = /^([1-9]|1[0-2])[AB]$/.test(raw);
    if (!isValidCode) {
      log("Key override: '" + raw + "' isn't a valid Camelot code (expected like '8A' or '11B').");
      _flashSelectionError(I18n.t("key.overrideInvalid"));
      return;
    }
    var scope = keyScope, material = keyMaterial;
    var overrideButton = document.getElementById("applyKeyOverrideBtn");
    overrideButton.disabled = true;
    getClipInfo().then(function (clipInfo) {
      var scopeKey = _keyScopeFor(clipInfo, scope, material);
      window.BeatMarkerLibrary.confirmKey(clipInfo.mediaPath, basename(clipInfo.mediaPath), raw, scopeKey);
      _restoreCachedKey(clipInfo);
      renderLibrary();
      persistLibrary();
      log("Key confirmed by user: " + raw + " (" + scope + ").");
    }).catch(function (err) { _flashSelectionError(err.message || String(err)); })
      .then(function () { overrideButton.disabled = false; });
  });
  document.getElementById("clearKeyOverrideBtn").addEventListener("click", function () {
    var resetButton = document.getElementById("clearKeyOverrideBtn");
    resetButton.disabled = true;
    getClipInfo().then(function (clipInfo) {
      window.BeatMarkerLibrary.clearConfirmedKey(clipInfo.mediaPath, _keyScopeFor(clipInfo));
      _restoreCachedKey(clipInfo);
      renderLibrary();
      persistLibrary();
    }).catch(function (err) { _flashSelectionError(err.message || String(err)); })
      .then(function () { resetButton.disabled = false; });
  });
  function _resetResultsForSelfTest() {
    lastAnalysis = null;
    lastKeyResult = null;
  }
  // SELF-TEST: js/self-test.js. It clicks and reads main.js's controls
  // through the getters below.
  var _selfTest = window.BeatMarkerSelfTest.create({
    log: log,
    getPluginVersion: getPluginVersion,
    resetResults: _resetResultsForSelfTest,
    PHASE_MARGIN_UNCERTAIN_THRESHOLD: function () { return PHASE_MARGIN_UNCERTAIN_THRESHOLD; },
    _bridge: function () { return _bridge; },
    _copiedMarkers: function () { return _copiedMarkers; },
    analyzeBtn: function () { return analyzeBtn; },
    beatThisBtn: function () { return beatThisBtn; },
    bpmDisplay: function () { return bpmDisplay; },
    clearMarkersBtn: function () { return clearMarkersBtn; },
    copyMarkersBtn: function () { return copyMarkersBtn; },
    csInterface: function () { return csInterface; },
    detectKeyBtn: function () { return detectKeyBtn; },
    getInfoBtn: function () { return getInfoBtn; },
    keyAgreementDisplay: function () { return keyAgreementDisplay; },
    keyAgreementRow: function () { return keyAgreementRow; },
    keyMaterial: function () { return keyMaterial; },
    keyResultDisplay: function () { return keyResultDisplay; },
    lastAnalysis: function () { return lastAnalysis; },
    lastKeyResult: function () { return lastKeyResult; },
    manualBpmBtn: function () { return manualBpmBtn; },
    pasteMarkersBtn: function () { return pasteMarkersBtn; },
    placeMarkersBtn: function () { return placeMarkersBtn; },
    placeTestBtn: function () { return placeTestBtn; },
    razorTestBtn: function () { return razorTestBtn; },
    retempoDoubleBtn: function () { return retempoDoubleBtn; },
    retempoHalfBtn: function () { return retempoHalfBtn; },
    retempoHint: function () { return retempoHint; },
    testEssentiaBtn: function () { return testEssentiaBtn; }
  });
  function _summaryLine() {
    return _selfTest.summaryLine.apply(null, arguments);
  }
  // Premiere/CEP has no push event that tells the panel the timeline
  // selection changed, so this polls getSelectedAudioInfo() on a plain
  // interval. One evalScript round-trip (no decode, no WASM) is cheap next to
  // the analysis it guards.
  var selectionStatusDisplay = document.getElementById("selectionStatusDisplay");
  var lastSelectionKey = null; // mediaPath|inPoint|outPoint, or null when nothing valid is selected
  var wasBusy = false; // true while a real Analyze/Detect key run is in flight
  var _lastHostRefusal = null; // the host's refusal at the last poll; null after a usable clip
  // `text` may be a function that builds the line, so a language switch can
  // rebuild it (refreshDynamicTranslations -> _rebuildSelectionStatus);
  // "already analyzed" / "not analyzed yet" are translated parts of it.
  // Transient error flashes pass a plain string and are not rebuilt.
  var _selectionStatusBuilder = null;
  var _selectionErrorShown = false; // an error is on the line (_flashSelectionError)
  function _setSelectionStatus(text, extraClass) {
    _selectionStatusBuilder = typeof text === "function" ? text : null;
    _writeSelectionStatus(_selectionStatusBuilder ? _selectionStatusBuilder() : text);
    selectionStatusDisplay.className = "selection-status" + (extraClass ? " " + extraClass : "");
    // An error is shown whole: on a line of its own under the heading,
    // wrapped instead of cut with "..." (css .g-clip-slot.has-error), in
    // whichever tab's heading holds the line.
    _selectionErrorShown = extraClass === "is-error";
    ["analyzeClipSlot", "keyClipSlot"].forEach(function (id) {
      var slot = document.getElementById(id);
      if (!slot) { return; }
      slot.classList.toggle("has-error", _selectionErrorShown);
      if (slot.parentNode && slot.parentNode.classList) {
        slot.parentNode.classList.toggle("has-clip-error", _selectionErrorShown);
      }
    });
  }
  function _rebuildSelectionStatus() {
    if (_selectionStatusBuilder) {
      _writeSelectionStatus(_selectionStatusBuilder());
    }
  }
  // "name — 102.7 BPM (already analyzed) — 6A": the file name and the rest in
  // separate spans, so a narrow heading shortens the name with "..." and
  // keeps the BPM / analyzed / key part whole. The whole line is the tooltip.
  function _writeSelectionStatus(line) {
    line = String(line);
    var cut = line.indexOf(" — ");
    selectionStatusDisplay.textContent = "";
    var name = document.createElement("span");
    name.className = "sel-name";
    name.textContent = cut === -1 ? line : line.slice(0, cut);
    selectionStatusDisplay.appendChild(name);
    if (cut !== -1) {
      var info = document.createElement("span");
      info.className = "sel-info";
      info.textContent = line.slice(cut);
      selectionStatusDisplay.appendChild(info);
    }
    selectionStatusDisplay.title = line;
  }
  function _selectionPlaceholder() {
    return I18n.t("selection.placeholder");
  }
  // The start text comes from index.html as plain text, which a
  // right-aligned line would cut from the left in a narrow panel. Written
  // like every other clip line, it is shortened with "..." at its end and
  // follows a language change.
  selectionStatusDisplay.removeAttribute("data-i18n");
  _setSelectionStatus(_selectionPlaceholder, "");
  // Flashes the actual error (already a specific, human-readable message
  // from the host, for example nothing selected, a video clip selected, or
  // more than one clip selected) into the selection-status
  // line, already visible on every tab, instead of adding a separate banner
  // per button.
  // The host throws fixed English texts; the ones the user meets most are
  // shown in the panel's language. A count in brackets is kept.
  var _hostReasonKeys = [
    ["Nothing selected. Select one audio clip on the timeline.", "selection.hostNothingClip"],
    ["Nothing selected. Select one audio layer in the composition.", "selection.hostNothingLayer"],
    ["Selection is video, not audio. Select an audio clip instead.", "selection.hostVideo"],
    // A nested sequence, a multicam or a merged clip has no media file.
    ["Could not resolve a media file path for the selected clip.", "selection.hostNoMediaFile"],
    ["The selected clip has no project item.", "selection.hostNoMediaFile"],
    ["More than one audio clip selected (", "selection.hostManyClips"],
    ["More than one layer with audio selected (", "selection.hostManyLayers"],
    ["No active sequence.", "selection.hostNoSequence"],
    ["No active composition. Open a composition and select a layer in its timeline.", "selection.hostNoComp"],
    ["The selected layer has no audio. Select an audio layer instead.", "selection.hostNoAudioLayer"],
    ["The selected layer is not a file (a precomp or a generated layer). Select the audio file's own layer.", "selection.hostNotFileLayer"],
    ["The selected layer's media file is missing. Relink it first.", "selection.hostMissingMedia"],
    ["The selected layer uses Time Remapping. Downbeat supports constant positive Time Stretch - turn Time Remap off first.", "selection.hostTimeRemap"],
    ["The selected layer has a reversed or invalid Time Stretch. Analysis supports positive constant Stretch values.", "selection.hostBadStretch"],
    // The metronome, Pitch the clip, the fades, clip and composition markers,
    // and the rare refusals of old host versions.
    ["The selected music changed. Select the analyzed clip and try again.", "selection.hostMusicChanged"],
    ["Invalid metronome duration.", "selection.hostMetronomeLength"],
    ["After Effects could not place the metronome below the music.", "selection.hostMetronomeNotPlaced"],
    ["The selected clip changed. Review the pitch plan and try again.", "key.pitchSelectionChanged"],
    ["Premiere cannot clear markers on the pitched media item.", "selection.hostPitchNoMarkers"],
    ["Premiere reused the original media item for pitch.", "selection.hostPitchReused"],
    ["Premiere did not clear the pitched clip markers.", "selection.hostPitchMarkersLeft"],
    ["The sequence or the inserted clip changed; the fades were not added.", "selection.hostFadesSkipped"],
    ["This Premiere version does not offer clip markers to scripts.", "selection.hostNoClipMarkers"],
    ["This After Effects version does not expose composition markers to scripts.", "selection.hostNoCompMarkers"],
    ["No project is open.", "selection.hostNoProject"],
    ["This Premiere version does not expose the editing API needed for cutting.", "selection.hostNoCutApi"],
    ["Premiere's editing API did not respond; cutting is not available here.", "selection.hostNoCutApi"]
  ];
  // The insert refusals (Library, Pitch the clip, the metronome) carry a
  // length, a track or a path, so they are matched by pattern.
  var _insertReasonKeys = [
    [/^No free audio track at the playhead for this ([0-9.]+) s sound\./, "library.insertNoFreeTrack", "seconds"],
    [/^No free audio track at the clip's place for this ([0-9.]+) s sound\./, "library.insertNoFreeTrackHere", "seconds"],
    [/^No free audio track at the playhead takes this ([0-9.]+) s sound:/, "library.insertNoFreeTrackKind", "seconds"],
    [/^No free audio track at the clip's place takes this ([0-9.]+) s sound:/, "library.insertNoFreeTrackKindHere", "seconds"],
    [/^Premiere keeps this file offline in the project\./, "library.insertOffline", null],
    [/^The file is not there any more: (.*)$/, "library.insertGone", "path"],
    [/^Premiere did not import the file\./, "library.insertNotImported", null],
    [/^Premiere did not place the clip on (A[0-9]+)\./, "library.insertNotPlaced", "track"],
    [/^Downbeat could not read how long this sound is/, "library.insertNoLength", null]
  ];
  function _translateHostReason(message) {
    var text = String(message || "");
    for (var i = 0; i < _hostReasonKeys.length; i++) {
      if (text.indexOf(_hostReasonKeys[i][0]) === 0) {
        var count = /\((\d+)\)/.exec(text);
        return I18n.t(_hostReasonKeys[i][1], { count: count ? count[1] : "" });
      }
    }
    for (var k = 0; k < _insertReasonKeys.length; k++) {
      var m = _insertReasonKeys[k][0].exec(text);
      if (m) {
        var params = {};
        if (_insertReasonKeys[k][2]) { params[_insertReasonKeys[k][2]] = m[1]; }
        return I18n.t(_insertReasonKeys[k][1], params);
      }
    }
    return null;
  }
  // Failures of the analysis workers, of the host bridge and of reading a
  // file come with Node's own English, command lines and paths. The clip
  // line shows one short sentence in the panel's language instead; the
  // whole text stays in the log (Settings > Copy log). First match wins.
  var _failureReasonKeys = [
    [/this is the (Mac|Windows) package of Downbeat/, "selection.failWrongPackage"],
    [/could not find a Node\.js executable|Node(\.js)? (access )?is not available in this panel|Cannot find module/, "selection.failMissing"],
    [/timed out after \d+ ?s|the decoder did not answer within/, "selection.failTimeout"],
    [/failed: spawn (EPERM|EACCES|EBUSY|UNKNOWN)\b/, "selection.failBlocked"],
    [/^(EPERM|EACCES|EBUSY|ENOSPC|EROFS|ENOENT)\b.*(samples|beatthis|skey|library)-\d+-\d+\.(raw|json)/, "selection.failTempWrite"],
    [/^(analyze-worker|beatthis-worker|skey-worker)\b|^Unhandled worker error|^abort\(/, "selection.failStopped"],
    [/^Failed to read file '/, "selection.failFileUnreadable"],
    [/^This file's audio codec isn't supported/, "selection.failCodec"],
    [/^The host script could not run\./, "selection.failHostNoAnswer"],
    [/^The host's script engine answered unreadably|^Could not parse JSX response as JSON/, "selection.failHostUnreadable"]
  ];
  // { key, params } for setTranslatedText (the Library scan uses it too).
  function _failureReason(message) {
    var text = String(message || "");
    for (var i = 0; i < _failureReasonKeys.length; i++) {
      var m = _failureReasonKeys[i][0].exec(text);
      if (m) {
        var key = _failureReasonKeys[i][1];
        return { key: key, params: key === "selection.failWrongPackage"
          ? { pkg: m[1], want: m[1] === "Mac" ? "Windows (-win.zxp)" : "Mac (-mac.zxp)" }
          : { app: hostIsAe ? "After Effects" : "Premiere Pro" } };
      }
    }
    return null;
  }
  function _translateFailure(message) {
    var reason = _failureReason(message);
    return reason ? I18n.t(reason.key, reason.params) : null;
  }
  function _flashSelectionError(message) {
    var markerErrorKeys = {
      "The selected clip changed. Select the intended clip and try again.": "selection.clipChanged",
      "The selected clip timing changed. Try the operation again.": "selection.timingChanged",
      "Copy these markers again in this host before pasting.": "markers.copyAgain",
      "Invalid marker clipboard.": "markers.invalidData",
      "Invalid marker timing.": "markers.invalidData",
      "This marker type cannot be transferred safely.": "markers.unsupportedType",
      "Unsupported marker type.": "markers.unsupportedType",
      "Could not create a pasted marker.": "markers.createFailed",
      "The target does not expose markers.": "markers.unavailable"
    };
    if (markerErrorKeys[message]) { message = I18n.t(markerErrorKeys[message]); }
    else {
      var hostText = _translateHostReason(message);
      var failure = hostText ? null : _translateFailure(message);
      if (failure) { log("Clip line shows a short text for: " + message); }
      message = hostText || failure || message;
    }
    // Stays until the user's next click or key press in the panel, or a
    // new selection (see _clearSelectionError).
    _setSelectionStatus(message, "is-error");
  }
  function _clearSelectionError() {
    if (!_selectionErrorShown) {
      return;
    }
    lastSelectionKey = null; // next poll tick re-checks for real, instead of assuming this stale flash is still accurate
    _setSelectionStatus(_selectionPlaceholder, "");
  }
  // mousedown and keydown come before the click (or key) that may flash a
  // new error, so they clear only one that is already on screen.
  document.addEventListener("mousedown", _clearSelectionError, true);
  document.addEventListener("keydown", _clearSelectionError, true);
  function _clearSelectionDependentState() {
    selectedClipInfo = null;
    _rememberSessionAnalysis(lastAnalysis);
    lastAnalysis = null;
    _updatePhaseShiftUi();
    _setBpmText("-");
    beatCountDisplay.textContent = "-";
    _updatePhaseUncertainHint(null);
    _updatePhaseAgreementHint(null);
    _updateGridConfidenceHint(null);
    _updateRetempoLikelyHint(null, null);
    _hideBeatClickPreview();
    lastKeyResult = null;
    _refreshPlaybackConsumers();
  }

  // The analyses shown earlier since the panel opened, by file. Selecting a clip of
  // the same file again - after a trim, or after another clip - brings back
  // the grid that was on screen with its chosen "1", Custom BPM's Undo and
  // Basic / Refined, instead of one rebuilt from the saved entry.
  var SESSION_ANALYSES_KEEP = 12;
  var _sessionAnalyses = {};
  var _sessionAnalysisOrder = [];
  function _rememberSessionAnalysis(analysis) {
    if (!analysis || !analysis.audioPath) {
      return;
    }
    var path = analysis.audioPath;
    var at = _sessionAnalysisOrder.indexOf(path);
    if (at !== -1) { _sessionAnalysisOrder.splice(at, 1); }
    _sessionAnalyses[path] = analysis;
    _sessionAnalysisOrder.push(path);
    while (_sessionAnalysisOrder.length > SESSION_ANALYSES_KEEP) {
      delete _sessionAnalyses[_sessionAnalysisOrder.shift()];
    }
  }
  // Only while the saved entry still holds that very grid and the file is
  // unchanged; otherwise the saved entry decides.
  function _sessionAnalysisFor(entry, clipInfo) {
    if (!entry || !entry.beatsArray) {
      return null;
    }
    var identity = window.BeatMarkerLibrary.fileIdentity(clipInfo.mediaPath);
    var candidates = [lastAnalysis, _sessionAnalyses[clipInfo.mediaPath]];
    for (var i = 0; i < candidates.length; i++) {
      var a = candidates[i];
      if (a && a.audioPath === clipInfo.mediaPath && a.beatsArray === entry.beatsArray && a.clipInfo &&
          window.BeatMarkerLibrary.sameIdentity(a.clipInfo.fileIdentity, identity)) {
        return a;
      }
    }
    return null;
  }

  // The clip line: the file's name - in After Effects with the composition
  // that will be changed, which need not be the one on screen - the BPM of
  // the grid saved for it, and the key.
  function _clipLineName(clipInfo) {
    var name = basename(clipInfo.mediaPath);
    return clipInfo.compName ? clipInfo.compName + " > " + name : name;
  }
  function _showClipLine(clipInfo, entry) {
    var statusParts = [_clipLineName(clipInfo)];
    if (entry && entry.beatsArray && entry.bpm) {
      var bpmText = entry.bpm.toFixed(1);
      statusParts.push(function () { return bpmText + " BPM (" + I18n.t("selection.alreadyAnalyzed") + ")"; });
    }
    var playback = _selectedPlayback();
    if (playback && playback.camelot) { statusParts.push(playback.camelot); }
    if (!entry) {
      statusParts.push(function () { return I18n.t("selection.notAnalyzed"); });
    }
    _setSelectionStatus(function () {
      return statusParts.map(function (part) { return typeof part === "function" ? part() : part; }).join(" — ");
    }, entry ? "has-cache" : "has-clip");
  }
  // After the grid changed with the same clip selected (Analyze, Custom BPM,
  // ½× / 2×): the line names the new grid.
  function _refreshClipLine() {
    if (selectedClipInfo) {
      _showClipLine(selectedClipInfo, window.BeatMarkerLibrary.get(selectedClipInfo.mediaPath));
    }
  }

  function _applyCachedEntry(entry, freshClipInfo) {
    var kept = _sessionAnalysisFor(entry, freshClipInfo);
    if (lastAnalysis !== kept) {
      _rememberSessionAnalysis(lastAnalysis);
    }
    freshClipInfo.fileIdentity = kept ? kept.clipInfo.fileIdentity : (entry ? entry.fileIdentity : null);
    if (!entry && lastDecodedSamplesPath === freshClipInfo.mediaPath) {
      lastDecodedSamples = null;
      lastDecodedSamplesPath = null;
      _bpmPassCache.clear();
    }

    if (kept) {
      kept.clipInfo = freshClipInfo; // the live position and trim
      lastAnalysis = kept;
      _coverCustomGrid(kept, freshClipInfo);
      _updatePhaseShiftUi();
      _setBpmText(entry.bpm.toFixed(2));
      beatCountDisplay.textContent = String(kept.beatsArray.length);
    } else if (entry && entry.beatsArray) {
      // Also an entry saved before the panel opened or by the other host:
      // the grid is kept in the file's own seconds, so it is laid on the
      // clip's live position like any other (no clipInfo is saved).
      lastAnalysis = {
        beatsArray: entry.beatsArray,
        confidence: entry.confidence,
        clipInfo: freshClipInfo, // the LIVE position, not the cached one - the clip may have moved since it was analyzed
        audioPath: entry.mediaPath,
        phase: entry.phase,
        // Beat This! downbeats, when they were in use, thinned the same way
        // as a fresh analysis (thinning thinned times changes nothing).
        downbeatTimes: entry.downbeatTimes && entry.downbeatTimes.length
          ? window.BeatMarkerCuesheet.thinCloseDownbeats(entry.beatsArray, entry.downbeatTimes).times
          : null,
        // The saved warning flag of decoded bars; null when the entry has none,
        // which then get the uneven test (see _updatePhaseUncertainHint).
        barsUnsure: typeof entry.barsUnsure === "boolean" ? entry.barsUnsure : null,
        // Which grid this is (_beatGridOf), so the Beat grid line lights the
        // same word as after Analyze. The other grid is not saved: switching
        // analyzes the clip again (beatThisBtn).
        beatThisApplied: entry.beatGrid === "refined",
        beatThisRejected: entry.beatGrid === "kept",
        beatThisReverted: entry.beatGrid === "basic",
        // A Custom BPM grid stays even, so it can be laid on further.
        evenGridBpm: entry.beatGrid === "custom" ? entry.bpm : null
      };
      _coverCustomGrid(lastAnalysis, freshClipInfo);
      _updatePhaseShiftUi();
      _setBpmText(entry.bpm.toFixed(2));
      beatCountDisplay.textContent = String(lastAnalysis.beatsArray.length);
    } else {
      lastAnalysis = null;
      _updatePhaseShiftUi();
      _setBpmText("-");
      beatCountDisplay.textContent = "-";
    }
    // The phase warning needs values the library does not save, so it shows
    // only for a grid kept since the panel opened. The saved confidence shows
    // the grid warning only while that grid is on screen, so the Beat grid
    // line never offers a switch with no grid behind it.
    _updatePhaseUncertainHint(kept ? kept.phaseMarginRatio : null);
    _updatePhaseAgreementHint(kept);
    _updateGridConfidenceHint(lastAnalysis ? lastAnalysis.confidence : null);
    _updateRetempoLikelyHint(null, null);
    _refreshBeatClickPreview();

    _restoreCachedKey(freshClipInfo);
    _showClipLine(freshClipInfo, entry);
  }
  function pollSelection() {
    if (document.activeElement && document.activeElement.tagName === "SELECT") {
      return;
    }
    var busy = analyzeBtn.disabled || detectKeyBtn.disabled;
    if (busy) {
      wasBusy = true;
      return;
    }
    if (wasBusy) {
      // An Analyze/Detect key run just finished and its own handler already
      // applied fresh state (bpmDisplay, lastAnalysis, lastKeyResult, ...).
      // Resync the tracked selection key and status line so this is not
      // mistaken for a new selection change on the next tick, which would
      // re-apply cached data over the fresh result.
      wasBusy = false;
      getClipInfo()
        .then(function (clipInfo) {
          if ((lastKeyResult && (lastKeyResult.mediaPath !== clipInfo.mediaPath || lastKeyResult.scopeKey !== _keyScopeFor(clipInfo))) ||
              (lastAnalysis && lastAnalysis.audioPath !== clipInfo.mediaPath)) {
            _applyCachedEntry(window.BeatMarkerLibrary.get(clipInfo.mediaPath), clipInfo);
          }
          var currentSpeed = Number(clipInfo.speed) > 0 ? Number(clipInfo.speed) : 1;
          if (lastKeyResult && lastKeyResult.mediaPath === clipInfo.mediaPath && lastKeyResult.scopeKey === _keyScopeFor(clipInfo)) {
            lastKeyResult.clipSpeed = currentSpeed;
          }
          if (lastAnalysis && lastAnalysis.audioPath === clipInfo.mediaPath && lastAnalysis.clipInfo) {
            lastAnalysis.clipInfo.speed = currentSpeed;
          }
          _renderHeard();
          _refreshPlaybackConsumers();
          lastSelectionKey = _selectionKeyOf(clipInfo);
          var entry = window.BeatMarkerLibrary.get(clipInfo.mediaPath);
          var parts = [_clipLineName(clipInfo)];
          if (entry && entry.bpm) {
            parts.push(entry.bpm.toFixed(1) + " BPM");
          }
          var playback = _selectedPlayback();
          if (playback && playback.camelot) { parts.push(playback.camelot); }
          if (!_selectionErrorShown) { // the run's own error stays until the user's next action
            _setSelectionStatus(parts.join(" — "), "has-cache");
          }
        })
        .catch(function () {
          lastSelectionKey = null;
        });
      return;
    }
    getClipInfo()
      .then(function (clipInfo) {
        _lastHostRefusal = null;
        var key = _selectionKeyOf(clipInfo);
        if (key === lastSelectionKey) {
          return;
        }
        lastSelectionKey = key;
        var entry = window.BeatMarkerLibrary.get(clipInfo.mediaPath);
        _applyCachedEntry(entry, clipInfo);
      })
      .catch(function (err) {
        // A reason the host gave (video selected, two clips, no sequence)
        // is more useful than the placeholder; shown in the panel's language.
        var raw = err && err.message ? err.message : String(err);
        var reason = _translateHostReason(raw);
        // A refusal different from the one at the last poll means another
        // selection (a Time Remap layer after a precomp): its reason replaces
        // even an error an action showed for the layer selected before.
        var otherRefusal = _lastHostRefusal !== null && raw !== _lastHostRefusal;
        _lastHostRefusal = raw;
        if (lastSelectionKey !== null) {
          lastSelectionKey = null;
          _clearSelectionDependentState();
        } else {
          // Still nothing usable: the reason is written again when it is
          // another one (a Time Remap layer after nothing selected, or after
          // a message went away), never over a message on show, and the
          // start text stays while nothing is selected.
          var shown = selectionStatusDisplay.title || selectionStatusDisplay.textContent;
          var startText = _selectionPlaceholder();
          if ((/\bis-error\b/.test(selectionStatusDisplay.className) && !otherRefusal) || shown === (reason || startText) ||
              (shown === startText && (!reason || /^Nothing selected\./.test(raw)))) {
            return;
          }
        }
        _setSelectionStatus(reason || _selectionPlaceholder, "");
      });
  }
  // In After Effects the composition is part of the selection: the same
  // layer in another composition is another clip.
  function _selectionKeyOf(clipInfo) {
    return clipInfo.mediaPath + "|" + clipInfo.inPointSeconds + "|" + clipInfo.outPointSeconds + "|" + clipInfo.speed + "|" +
      window.BeatMarkerLibrary.identityKey(clipInfo.mediaPath) + (clipInfo.compId !== undefined ? "|" + clipInfo.compId : "");
  }
  pollSelection();
  document.addEventListener("change", function (evt) {
    if (evt.target && evt.target.tagName === "SELECT" && typeof evt.target.blur === "function") {
      evt.target.blur(); // lets pollSelection run again (see its first lines)
    }
  }, true);
  setInterval(pollSelection, 1500);
})();
