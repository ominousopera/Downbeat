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
    function openSettingsPanel() {
      settingsPanel.hidden = false;
      settingsBackdrop.hidden = false;
    }
    function closeSettingsPanel() {
      settingsPanel.hidden = true;
      settingsBackdrop.hidden = true;
    }
    document.getElementById("settingsGearBtn").addEventListener("click", function () {
      if (settingsPanel.hidden) { openSettingsPanel(); } else { closeSettingsPanel(); }
    });
    document.getElementById("settingsCloseBtn").addEventListener("click", closeSettingsPanel);
    settingsBackdrop.addEventListener("click", closeSettingsPanel);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !settingsPanel.hidden) { closeSettingsPanel(); }
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
          while (i < lines.length && isBullet(lines[i])) {
            var item = lines[i].replace(/^\s*(- |\* |\d+\. )/, "");
            i++;
            while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !isBullet(lines[i]) && !/^\s*```/.test(lines[i])) {
              item += " " + lines[i].trim();
              i++;
            }
            var li = document.createElement("li");
            _appendInline(li, item);
            list.appendChild(li);
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
    // UPDATE NOTICE (Settings > Updates). Off until the user turns it on;
    // then, at most once every three days (and when it is switched on or
    // "Check now" is pressed), js/update-check.js asks GitHub for the latest
    // release number. The answer is remembered in the settings, so a newer
    // version is announced again on the next start without another request.
    // The release page opens behind the usual link confirmation. The
    // download button (only when the release carries a package for this
    // computer) fetches the package, checks it against the checksum
    // published with it, saves it in Downloads and opens it, so the user's
    // ZXP installer takes over: Downbeat never installs anything itself.
    var UC = window.BeatMarkerUpdateCheck;
    var updateCheckCheckbox = document.getElementById("updateCheckCheckbox");
    var updateStatus = document.getElementById("updateStatus");
    var updateCheckNowBtn = document.getElementById("updateCheckNowBtn");
    var updateOpenBtn = document.getElementById("updateOpenBtn");
    var updateDownloadBtn = document.getElementById("updateDownloadBtn");
    var settingsGearBtn = document.getElementById("settingsGearBtn");
    var _updateUrl = null;
    var _updateLatest = null;
    var _updateBusy = false;
    var _updateDownloading = false;
    function _nodePlatform() {
      try {
        return window.cep_node.require("os").platform();
      } catch (e) {
        return null;
      }
    }
    // Downloads, else the home folder when there is no such folder.
    function _downloadsDir() {
      var os = window.cep_node.require("os");
      var fs = window.cep_node.require("fs");
      var path = window.cep_node.require("path");
      var dir = path.join(os.homedir(), "Downloads");
      try {
        if (fs.statSync(dir).isDirectory()) {
          return dir;
        }
      } catch (e) {
        /* no Downloads folder: fall through */
      }
      return os.homedir();
    }
    // Hands the saved package to the system, which opens it with whatever
    // the user has for .zxp files (a ZXP installer). Detached, no shell: the
    // path is passed as one argument.
    function _openDownloadedFile(filePath) {
      var cp = window.cep_node.require("child_process");
      var platform = _nodePlatform();
      var child = platform === "win32"
        ? cp.spawn("explorer.exe", [filePath], { detached: true, stdio: "ignore" })
        : cp.spawn("open", [filePath], { detached: true, stdio: "ignore" });
      child.on("error", function () { /* reported by the status line below */ });
      child.unref();
    }
    function _showUpdateState(seen) {
      var current = getPluginVersion();
      var newer = !!(seen && UC.isNewer(seen.version, current));
      _updateUrl = newer ? seen.url : null;
      _updateLatest = newer ? seen : null;
      updateOpenBtn.hidden = !newer;
      var pkg = newer ? UC.packageFor(seen, _nodePlatform()) : null;
      updateDownloadBtn.hidden = !pkg || _updateDownloading;
      if (pkg) {
        setTranslatedText(updateDownloadBtn, "settings.updateDownload", { size: Math.max(1, Math.round(pkg.size / (1024 * 1024))) });
      }
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
      UC.fetchLatest(function (err, latest) {
        _updateBusy = false;
        if (err) {
          log("Update check: " + err.message);
          setTranslatedText(updateStatus, "settings.updateFailed", { error: err.message });
          return;
        }
        persistSettings({ lastUpdateCheck: Date.now(), latestRelease: latest });
        _showUpdateState(latest);
      });
    }
    updateCheckCheckbox.addEventListener("change", function () {
      persistSettings({ updateCheck: updateCheckCheckbox.checked });
      updateCheckNowBtn.hidden = !updateCheckCheckbox.checked;
      if (updateCheckCheckbox.checked) {
        _runUpdateCheck();
      } else {
        _showUpdateState(null);
      }
    });
    updateCheckNowBtn.addEventListener("click", _runUpdateCheck);
    updateDownloadBtn.addEventListener("click", function () {
      if (_updateDownloading || !_updateLatest) {
        return;
      }
      var latest = _updateLatest;
      _updateDownloading = true;
      updateDownloadBtn.hidden = true;
      setTranslatedText(updateStatus, "settings.updateDownloading", { percent: "0" });
      var lastShown = -1;
      UC.downloadPackage(latest, {
        platform: _nodePlatform(),
        dir: _downloadsDir(),
        modules: { open: _openDownloadedFile },
        onProgress: function (fraction) {
          var percent = Math.floor(fraction * 100);
          if (percent !== lastShown) {
            lastShown = percent;
            setTranslatedText(updateStatus, "settings.updateDownloading", { percent: String(percent) });
          }
        }
      }, function (err, saved) {
        _updateDownloading = false;
        _showUpdateState(latest);
        if (err) {
          log("Update download: " + err.message);
          setTranslatedText(updateStatus, "settings.updateDownloadFailed", { error: err.message });
          return;
        }
        log("Update download: saved and checked " + saved.path + " (sha256 " + saved.sha256 + ")" + (saved.openError ? "; opening it failed: " + saved.openError : "") + ".");
        setTranslatedText(updateStatus, saved.openError ? "settings.updateDownloadedNoOpen" : "settings.updateDownloaded", { name: saved.name });
      });
    });
    updateOpenBtn.addEventListener("click", function () {
      if (_updateUrl) {
        _confirmAndOpenUrl(_updateUrl);
      }
    });
    // Called by main.js once the saved settings are loaded.
    function applySettings(settings) {
      var on = settings.updateCheck === true;
      updateCheckCheckbox.checked = on;
      updateCheckNowBtn.hidden = !on;
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
    function _showDeleteDataDialog(message, canConfirm) {
      deleteDataMessage.textContent = message;
      deleteDataConfirmBtn.hidden = !canConfirm;
      setTranslatedText(deleteDataCancelBtn, canConfirm ? "settings.deleteDataCancel" : "settings.deleteDataClose");
      deleteDataOverlay.hidden = false;
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
      var names = listing.files.map(function (f) { return "\u2022 " + f.slice(listing.dataDir.length + 1); });
      var message = I18n.t("settings.deleteDataMessage", { files: names.join("\n"), path: listing.dataDir });
      if (listing.kept.length > 0) {
        message += I18n.t("settings.deleteDataKeptNote", { count: listing.kept.length });
      }
      _showDeleteDataDialog(message, true);
    });
    deleteDataCancelBtn.addEventListener("click", function () {
      deleteDataOverlay.hidden = true;
    });
    deleteDataConfirmBtn.addEventListener("click", function () {
      if (ctx.bridge().tempFilesInFlight() > 0) {
        _showDeleteDataDialog(I18n.t("settings.deleteDataBusy"), false);
        return;
      }
      var result = window.BeatMarkerPersistence.deleteUserData(ctx.csInterface());
      var deleted = result.deleted || [];
      for (var i = 0; i < deleted.length; i++) {
        log("Deleted " + deleted[i]);
      }
      if (!result.ok) {
        log("WARNING: Delete my data: " + (result.error || result.failed.join(", ")));
        _showDeleteDataDialog(result.error
          ? I18n.t("settings.deleteDataRefused", { error: result.error })
          : I18n.t("settings.deleteDataFailed", { error: result.failed.join("\n") }), false);
        return;
      }
      window.BeatMarkerLibrary.clear();
      _library.resetAfterDeleteData();
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
