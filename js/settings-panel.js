// Settings and diagnostics: the settings popover, Copy log, Guide / License /
// third-party notices in the text viewer (with its small Markdown renderer),
// the external-link confirmation, Delete my data and the plugin version.
(function (global) {
  "use strict";
  // ctx - what this part needs from main.js: its shared helpers, the Library
  // part (Delete my data empties it), and getters for what main.js sets up
  // after this part: the host / worker bridge, csInterface and the loaded
  // settings.
  function create(ctx) {
    var I18n = ctx.I18n;
    var log = ctx.log;
    var logEl = ctx.logEl;
    var setTranslatedText = ctx.setTranslatedText;
    var showBusy = ctx.showBusy;
    var hideBusy = ctx.hideBusy;
    var persistSettings = ctx.persistSettings;
    var _library = ctx.library;
    function copyTextFallback(text) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(textarea);
      return ok;
    }
    // The result shows on the button itself for two seconds - "Copied" in
    // place of "Copy log".
    var copyLogBtn = document.getElementById("copyLogBtn");
    var _copyLogTimer = null;
    function showCopyStatus(ok) {
      var key = ok ? "settings.copied" : "settings.copyFailed";
      copyLogBtn.setAttribute("data-i18n", key);
      setTranslatedText(copyLogBtn, key);
      copyLogBtn.classList.toggle("is-done", ok);
      copyLogBtn.classList.toggle("is-failed", !ok);
      if (_copyLogTimer) { clearTimeout(_copyLogTimer); }
      _copyLogTimer = setTimeout(function () {
        _copyLogTimer = null;
        copyLogBtn.setAttribute("data-i18n", "settings.copyLog");
        setTranslatedText(copyLogBtn, "settings.copyLog");
        copyLogBtn.classList.remove("is-done", "is-failed");
      }, 2000);
    }
    copyLogBtn.addEventListener("click", function () {
      var text = logEl.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function () {
            showCopyStatus(true);
          })
          .catch(function () {
            showCopyStatus(copyTextFallback(text));
          });
      } else {
        showCopyStatus(copyTextFallback(text));
      }
    });
    // Popover: closed only by a backdrop click, the close button or Escape -
    // not by blur, an outside click or a tab switch, so that scripted clicks
    // on its buttons (for example in tests) are not interrupted.
    var settingsPanel = document.getElementById("settingsPanel");
    var settingsBackdrop = document.getElementById("settingsBackdrop");
    // The tour lets clicks through (its Settings step points at the gear):
    // while Settings is open the tour steps aside, so Settings is not under
    // its dark layer and box, and it comes back when Settings closes.
    function _tourSetAside(on) {
      if (global.BeatMarkerTour && global.BeatMarkerTour.setAside) { global.BeatMarkerTour.setAside(on); }
    }
    function openSettingsPanel() {
      settingsPanel.hidden = false;
      settingsBackdrop.hidden = false;
      _tourSetAside(true);
    }
    function closeSettingsPanel() {
      settingsPanel.hidden = true;
      settingsBackdrop.hidden = true;
      _tourSetAside(false);
    }
    document.getElementById("settingsGearBtn").addEventListener("click", function () {
      if (settingsPanel.hidden) { openSettingsPanel(); } else { closeSettingsPanel(); }
    });
    document.getElementById("settingsCloseBtn").addEventListener("click", closeSettingsPanel);
    settingsBackdrop.addEventListener("click", closeSettingsPanel);
    // Esc closes the dialog on top first (Delete my data and the link
    // question as Cancel), and Settings only when nothing is over it.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") {
        return;
      }
      if (!deleteDataOverlay.hidden) {
        deleteDataOverlay.hidden = true;
      } else if (!externalLinkOverlay.hidden) {
        _pendingExternalUrl = null;
        externalLinkOverlay.hidden = true;
      } else if (!textViewerOverlay.hidden) {
        _closeTextViewer();
      } else if (!settingsPanel.hidden) {
        closeSettingsPanel();
      }
    });
    // Reads ExtensionBundleVersion from CSXS/manifest.xml instead of keeping a
    // second copy of the version in JS.
    function getPluginVersion() {
      try {
        var extensionRoot = ctx.csInterface().getSystemPath(SystemPath.EXTENSION);
        var manifestPath = extensionRoot + "/CSXS/manifest.xml";
        var fs = window.cep_node.require("fs");
        var manifestText = fs.readFileSync(manifestPath, "utf8");
        var match = manifestText.match(/ExtensionBundleVersion="([^"]*)"/);
        return match ? match[1] : "unknown (no ExtensionBundleVersion found)";
      } catch (e) {
        return "unknown (" + e.message + ")";
      }
    }
    // Reads a text file from the extension's install folder (next to CSXS/),
    // the same way getPluginVersion() does. GUIDE*.md, LICENSE and NOTICE.md
    // are copied there by scripts/build-zxp.sh.
    function _readExtensionTextFile(relativeName) {
      var extensionRoot = ctx.csInterface().getSystemPath(SystemPath.EXTENSION);
      var fs = window.cep_node.require("fs");
      return fs.readFileSync(extensionRoot + "/" + relativeName, "utf8");
    }
    // TEXT VIEWER modal, shared by Guide/FAQ, License and Third-party
    // notices.
    var textViewerOverlay = document.getElementById("textViewerOverlay");
    var textViewerTitle = document.getElementById("textViewerTitle");
    var textViewerBody = document.getElementById("textViewerBody");
    function _showTextViewer(title, content, asMarkdown) {
      textViewerTitle.textContent = title;
      textViewerBody.textContent = "";
      textViewerBody.classList.toggle("is-doc", !!asMarkdown);
      if (asMarkdown) {
        _renderMarkdownInto(textViewerBody, content);
      } else {
        textViewerBody.textContent = content;
      }
      textViewerOverlay.hidden = false;
    }
    // Handles just what those files use: #/##/### headings, paragraphs, "-"
    // and "1." lists (with indented continuation lines), | tables |,
    // **bold**, `code`, and [text](link) shown as its text. Builds DOM nodes
    // with textContent only - never innerHTML - so nothing in a file can
    // inject markup.
    function _appendInline(parent, text) {
      var re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
      var last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) {
          parent.appendChild(document.createTextNode(text.slice(last, m.index)));
        }
        var token = m[0], el;
        if (token.charAt(0) === "*") {
          el = document.createElement("strong");
          el.textContent = token.slice(2, -2);
        } else if (token.charAt(0) === "`") {
          el = document.createElement("code");
          el.textContent = token.slice(1, -1);
        } else {
          el = document.createElement("span");
          el.textContent = token.slice(1, token.indexOf("]"));
        }
        parent.appendChild(el);
        last = re.lastIndex;
      }
      if (last < text.length) {
        parent.appendChild(document.createTextNode(text.slice(last)));
      }
    }
    function _renderMarkdownInto(container, text) {
      var lines = String(text).replace(/\r\n/g, "\n").split("\n");
      var i = 0;
      function isTableRow(l) { return /^\s*\|.*\|\s*$/.test(l); }
      function isBullet(l) { return /^\s*(- |\* |\d+\. )/.test(l); }
      while (i < lines.length) {
        var line = lines[i];
        if (!line.trim()) { i++; continue; }
        if (/^\s*```/.test(line)) { // fenced block (NOTICE.md's hash lists): shown as-is
          var code = [];
          i++;
          while (i < lines.length && !/^\s*```/.test(lines[i])) {
            code.push(lines[i]);
            i++;
          }
          i++;
          var pre = document.createElement("pre");
          pre.textContent = code.join("\n");
          container.appendChild(pre);
          continue;
        }
        var h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          var he = document.createElement(h[1].length === 1 ? "h3" : (h[1].length === 2 ? "h4" : "h5"));
          _appendInline(he, h[2]);
          container.appendChild(he);
          i++;
          continue;
        }
        if (isTableRow(line)) {
          var table = document.createElement("table");
          var first = true;
          while (i < lines.length && isTableRow(lines[i])) {
            var cells = lines[i].trim().replace(/^\||\|$/g, "").split("|");
            if (!/^[\s:|-]+$/.test(lines[i])) { // skip the |---| separator row
              var tr = document.createElement("tr");
              cells.forEach(function (c) {
                var td = document.createElement(first ? "th" : "td");
                _appendInline(td, c.trim());
                tr.appendChild(td);
              });
              table.appendChild(tr);
              first = false;
            }
            i++;
          }
          container.appendChild(table);
          continue;
        }
        if (isBullet(line)) {
          var ordered = /^\s*\d+\. /.test(line);
          var list = document.createElement(ordered ? "ol" : "ul");
          // A list that starts later than 1 shows the file's own number.
          var firstNumber = ordered ? parseInt(line.match(/\d+/)[0], 10) : 1;
          if (firstNumber > 1) { list.start = firstNumber; }
          var lastLi = null;
          var nested = null;
          var isContinuation = function (l) { return /^\s{2,}\S/.test(l) && !isBullet(l) && !/^\s*```/.test(l); };
          while (i < lines.length) {
            if (!isBullet(lines[i])) {
              // A blank line and then an indented paragraph still belong to
              // the step above, so the list goes on after it and the next
              // step keeps its number instead of starting again at 1.
              var j = i;
              while (j < lines.length && !lines[j].trim()) { j++; }
              if (!lastLi || j === i || j >= lines.length || !isContinuation(lines[j])) {
                break;
              }
              var more = [];
              while (j < lines.length && isContinuation(lines[j])) {
                more.push(lines[j].trim());
                j++;
              }
              var cont = document.createElement("p");
              _appendInline(cont, more.join(" "));
              lastLi.appendChild(cont);
              nested = null;
              i = j;
              continue;
            }
            // An indented bullet under a numbered step is its sub-list,
            // not the next step.
            var indented = /^\s+/.test(lines[i]) && lastLi !== null;
            var item = lines[i].replace(/^\s*(- |\* |\d+\. )/, "");
            i++;
            while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !isBullet(lines[i]) && !/^\s*```/.test(lines[i])) {
              item += " " + lines[i].trim();
              i++;
            }
            var li = document.createElement("li");
            _appendInline(li, item);
            if (indented) {
              if (!nested) {
                nested = document.createElement("ul");
                lastLi.appendChild(nested);
              }
              nested.appendChild(li);
            } else {
              list.appendChild(li);
              lastLi = li;
              nested = null;
            }
          }
          container.appendChild(list);
          continue;
        }
        var para = [];
        while (i < lines.length && lines[i].trim() && !/^#{1,3}\s/.test(lines[i]) && !isTableRow(lines[i]) && !isBullet(lines[i]) && !/^\s*```/.test(lines[i])) {
          para.push(lines[i].trim());
          i++;
        }
        var p = document.createElement("p");
        _appendInline(p, para.join(" "));
        container.appendChild(p);
      }
    }
    function _closeTextViewer() {
      textViewerOverlay.hidden = true;
    }
    document.getElementById("textViewerCloseBtn").addEventListener("click", _closeTextViewer);
    textViewerOverlay.addEventListener("click", function (evt) {
      if (evt.target === textViewerOverlay) { _closeTextViewer(); } // backdrop click only, not clicks inside the card
    });
    function _showTextFileOrError(title, relativeName) {
      try {
        _showTextViewer(title, _readExtensionTextFile(relativeName), /\.md$/.test(relativeName));
      } catch (e) {
        log("Could not open " + relativeName + ": " + (e && e.message ? e.message : e));
        _showTextViewer(title, "Could not load " + relativeName + " (" + (e && e.message ? e.message : e) + ").");
      }
    }
    // The guide in the panel's language: GUIDE.ru.md / GUIDE.es.md, English
    // for anything else or if a translation is missing.
    document.getElementById("guideBtn").addEventListener("click", function () {
      var lang = I18n.getLanguage();
      var name = "GUIDE.md";
      if (lang !== "en") {
        try {
          var fs = window.cep_node.require("fs");
          if (fs.existsSync(ctx.csInterface().getSystemPath(SystemPath.EXTENSION) + "/GUIDE." + lang + ".md")) {
            name = "GUIDE." + lang + ".md";
          }
        } catch (e) {
          name = "GUIDE.md";
        }
      }
      _showTextFileOrError(I18n.t("settings.guide"), name);
    });
    document.getElementById("licenseBtn").addEventListener("click", function () {
      _showTextFileOrError(I18n.t("settings.license"), "LICENSE");
    });
    document.getElementById("thirdPartyNoticesBtn").addEventListener("click", function () {
      _showTextFileOrError(I18n.t("settings.thirdPartyNotices"), "NOTICE.md");
    });
    // "Remember my choice" is stored in the settings
    // (initialSettings.skipExternalLinkConfirm) through persistSettings().
    var externalLinkOverlay = document.getElementById("externalLinkOverlay");
    var externalLinkMessage = document.getElementById("externalLinkMessage");
    var externalLinkRememberCheckbox = document.getElementById("externalLinkRememberCheckbox");
    var _pendingExternalUrl = null;
    function _confirmAndOpenUrl(url) {
      if (ctx.initialSettings().skipExternalLinkConfirm) {
        ctx.csInterface().openURLInDefaultBrowser(url);
        return;
      }
      _pendingExternalUrl = url;
      setTranslatedText(externalLinkMessage, "settings.externalLinkMessage", { url: url });
      externalLinkRememberCheckbox.checked = false;
      externalLinkOverlay.hidden = false;
    }
    document.getElementById("externalLinkCancelBtn").addEventListener("click", function () {
      _pendingExternalUrl = null;
      externalLinkOverlay.hidden = true;
    });
    document.getElementById("externalLinkOpenBtn").addEventListener("click", function () {
      if (_pendingExternalUrl) {
        ctx.csInterface().openURLInDefaultBrowser(_pendingExternalUrl);
      }
      if (externalLinkRememberCheckbox.checked) {
        persistSettings({ skipExternalLinkConfirm: true });
      }
      _pendingExternalUrl = null;
      externalLinkOverlay.hidden = true;
    });
    document.getElementById("feedbackBtn").addEventListener("click", function () {
      _confirmAndOpenUrl("https://linktr.ee/nkolesov");
    });
    // Manual checks make one request; optional notices check every three days.
    // A newer release opens through the shared browser-link confirmation.
    // Download and installation are manual outside the panel.
    var UC = window.BeatMarkerUpdateCheck;
    var updateCheckCheckbox = document.getElementById("updateCheckCheckbox");
    var updateStatus = document.getElementById("updateStatus");
    var updateCheckNowBtn = document.getElementById("updateCheckNowBtn");
    var updateOpenBtn = document.getElementById("updateOpenBtn");
    var settingsGearBtn = document.getElementById("settingsGearBtn");
    var _updateUrl = null;
    var _updateBusy = false;
    var _updateGeneration = 0;
    function _showUpdateState(seen) {
      var current = getPluginVersion();
      var newer = !!(seen && UC.isNewer(seen.version, current));
      _updateUrl = newer ? seen.url : null;
      updateOpenBtn.hidden = !newer;
      if (updateOpenBtn.parentNode) { updateOpenBtn.parentNode.hidden = !newer; }
      settingsGearBtn.classList.toggle("has-update", newer);
      if (newer) {
        setTranslatedText(updateStatus, "settings.updateNew", { latest: seen.version, version: current });
      } else if (seen) {
        setTranslatedText(updateStatus, "settings.updateNone", { version: current });
      } else {
        updateStatus.textContent = "";
      }
    }
    function _runUpdateCheck() {
      if (_updateBusy) {
        return;
      }
      _updateBusy = true;
      setTranslatedText(updateStatus, "settings.updateChecking");
      var generation = _updateGeneration;
      UC.fetchLatest(function (err, latest) {
        if (generation !== _updateGeneration) { return; }
        _updateBusy = false;
        if (err) {
          log("Update check: " + err.message);
          // "It will try again later" only while the background check is
          // on; after Check now with it off nothing retries.
          // No connection at all is said in words; the code stays in the log.
          var failedKey = UC.isOffline(err) ? "settings.updateOffline" : "settings.updateFailed";
          setTranslatedText(updateStatus, updateCheckCheckbox.checked ? failedKey + "Retry" : failedKey, { error: err.message });
          return;
        }
        persistSettings({ lastUpdateCheck: Date.now(), latestRelease: latest });
        _showUpdateState(latest);
      });
    }
    updateCheckCheckbox.addEventListener("change", function () {
      persistSettings({ updateCheck: updateCheckCheckbox.checked });
      if (updateCheckCheckbox.checked) {
        _runUpdateCheck();
      } else {
        _updateGeneration++;
        _updateBusy = false;
        _showUpdateState(null);
      }
    });
    updateCheckNowBtn.addEventListener("click", _runUpdateCheck);
    updateOpenBtn.addEventListener("click", function () {
      if (_updateUrl) {
        _confirmAndOpenUrl(_updateUrl);
      }
    });
    var audioOutputMode = document.getElementById("audioOutputModeSelect");
    var audioOutputFolderBtn = document.getElementById("audioOutputFolderBtn");
    var audioOutputPath = document.getElementById("audioOutputPath");
    function showAudioOutput(settings) {
      var mode = /^(documents|project|custom)$/.test(settings.audioOutputMode) ? settings.audioOutputMode : "documents";
      audioOutputMode.value = mode;
      audioOutputFolderBtn.hidden = mode !== "custom";
      if (audioOutputFolderBtn.parentNode) { audioOutputFolderBtn.parentNode.hidden = audioOutputFolderBtn.hidden; }
      if (mode === "custom" && settings.audioOutputFolder) {
        audioOutputPath.removeAttribute("data-i18n");
        audioOutputPath.textContent = settings.audioOutputFolder;
      } else {
        setTranslatedText(audioOutputPath, mode === "project" ? "output.projectHint" : (mode === "custom" ? "output.folderMissing" : "output.documents"));
      }
    }
    function chooseAudioOutput() {
      return ctx.bridge().evalJson("pickOutputFolder(" + ctx.bridge().jsxJsonArg(I18n.t("output.choose")) + ")")
        .then(function (picked) {
          if (picked.directory) {
            persistSettings({ audioOutputMode: "custom", audioOutputFolder: picked.directory });
          }
          showAudioOutput(ctx.initialSettings());
        }).catch(function (err) {
          showAudioOutput(ctx.initialSettings());
          log("Audio output folder: " + (err.message || String(err)));
        });
    }
    audioOutputMode.addEventListener("change", function () {
      var mode = audioOutputMode.value;
      if (mode === "custom" && !ctx.initialSettings().audioOutputFolder) { chooseAudioOutput(); return; }
      if (/^(documents|project|custom)$/.test(mode)) { persistSettings({ audioOutputMode: mode }); }
      showAudioOutput(ctx.initialSettings());
    });
    audioOutputFolderBtn.addEventListener("click", chooseAudioOutput);
    // Called by main.js once the saved settings are loaded.
    function applySettings(settings) {
      showAudioOutput(settings);
      var on = settings.updateCheck === true;
      updateCheckCheckbox.checked = on;
      updateCheckNowBtn.hidden = false;
      _showUpdateState(null);
      if (!on) {
        return;
      }
      _showUpdateState(settings.latestRelease && typeof settings.latestRelease.version === "string" ? settings.latestRelease : null);
      if (UC.isDue(settings.lastUpdateCheck, Date.now())) {
        _runUpdateCheck();
      }
    }
    // DELETE MY DATA (Settings). Every safety rule lives in
    // js/persistence.js's _listOwnFiles() - this handler only shows the user
    // the exact list of files first, and refuses while an analysis still has
    // a temp file in use (counted by js/bridge.js, tempFilesInFlight()).
    var deleteDataOverlay = document.getElementById("deleteDataOverlay");
    var deleteDataMessage = document.getElementById("deleteDataMessage");
    var deleteDataConfirmBtn = document.getElementById("deleteDataConfirmBtn");
    var deleteDataCancelBtn = document.getElementById("deleteDataCancelBtn");
    // The second click of a double click on Delete my data (or one before the
    // list of files can be read) is not an answer to the dialog, even when the
    // Delete button opens right under the pointer. Same rule as the Library's
    // Clear button.
    var DELETE_CONFIRM_MIN_MS = 600;
    var _deleteDataShownAt = 0;
    function _showDeleteDataDialog(message, canConfirm) {
      deleteDataMessage.textContent = message;
      deleteDataConfirmBtn.hidden = !canConfirm;
      setTranslatedText(deleteDataCancelBtn, canConfirm ? "settings.deleteDataCancel" : "settings.deleteDataClose");
      deleteDataOverlay.hidden = false;
      _deleteDataShownAt = Date.now();
    }
    document.getElementById("deleteDataBtn").addEventListener("click", function () {
      if (ctx.bridge().tempFilesInFlight() > 0) {
        _showDeleteDataDialog(I18n.t("settings.deleteDataBusy"), false);
        return;
      }
      var listing = window.BeatMarkerPersistence.listUserData(ctx.csInterface());
      if (!listing.ok) {
        _showDeleteDataDialog(I18n.t("settings.deleteDataRefused", { error: listing.error }), false);
        return;
      }
      if (listing.files.length === 0) {
        _showDeleteDataDialog(I18n.t("settings.deleteDataNothing", { path: listing.dataDir }), false);
        return;
      }
      // Leftover handoff files in the system's temp folder are shown with their full path.
      var names = listing.files.map(function (f) {
        return "\u2022 " + (f.indexOf(listing.dataDir + "/") === 0 ? f.slice(listing.dataDir.length + 1) : f);
      });
      var message = I18n.t("settings.deleteDataMessage", { files: names.join("\n"), path: listing.dataDir });
      if (listing.kept.length > 0) {
        message += I18n.t("settings.deleteDataKeptNote", { count: listing.kept.length });
      }
      _showDeleteDataDialog(message, true);
    });
    deleteDataCancelBtn.addEventListener("click", function () {
      deleteDataOverlay.hidden = true;
    });
    deleteDataConfirmBtn.addEventListener("click", function (evt) {
      if ((evt && evt.detail > 1) || Date.now() - _deleteDataShownAt < DELETE_CONFIRM_MIN_MS) {
        return;
      }
      if (ctx.bridge().tempFilesInFlight() > 0) {
        _showDeleteDataDialog(I18n.t("settings.deleteDataBusy"), false);
        return;
      }
      var result = window.BeatMarkerPersistence.deleteUserData(ctx.csInterface());
      var deleted = result.deleted || [];
      for (var i = 0; i < deleted.length; i++) {
        log("Deleted " + deleted[i]);
      }
      // The saved data is gone, so what the panel holds goes too - otherwise
      // the next analysis (or scan, star or settings change) would quietly
      // write every old entry back to disk. Also when some file could not be
      // deleted: the others are gone all the same.
      if (deleted.length > 0) {
        window.BeatMarkerLibrary.clear();
        _library.resetAfterDeleteData();
        if (ctx.resetSettingsAfterDelete) { ctx.resetSettingsAfterDelete(); }
      }
      if (!result.ok) {
        log("WARNING: Delete my data: " + (result.error || result.failed.join(", ")));
        _showDeleteDataDialog(result.error
          ? I18n.t("settings.deleteDataRefused", { error: result.error })
          : I18n.t("settings.deleteDataFailed", { error: result.failed.join("\n") }), false);
        return;
      }
      _showDeleteDataDialog(I18n.t("settings.deleteDataDone", { count: deleted.length }), false);
    });
    return {
      closeSettingsPanel: closeSettingsPanel,
      getPluginVersion: getPluginVersion,
      applySettings: applySettings
    };
  }
  global.BeatMarkerSettingsPanel = { create: create };
})(window);
