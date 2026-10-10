// The optional "new version" notice: asks GitHub for the number of the
// latest Downbeat release and compares it with the installed version. It is
// the only module that goes online, after an explicit check/download or
// when periodic notices are enabled, with no audio or project content - a plain
// GET for the public release record. Nothing is ever installed by Downbeat
// itself: a signed package cannot be changed in place. When a newer version
// is out, a button can fetch its package from the release, check it against
// the checksum published with it, save it to the Downloads folder and open
// it, so the user's ZXP installer takes it from there.
(function (global) {
  "use strict";
  var HOST = "api.github.com";
  var PATH = "/repos/ominousopera/Downbeat/releases/latest";
  var RELEASES_URL = "https://github.com/ominousopera/Downbeat/releases/latest";
  var PAGE_HOST = "github.com";
  var PAGE_PATH = "/ominousopera/Downbeat/releases/latest";
  var PAGE_PREFIX = "https://github.com/ominousopera/Downbeat/";
  var INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
  var TIMEOUT_MS = 10000;
  var MAX_BYTES = 1024 * 1024;
  // "v1.2.3" or "1.2.3" -> [1, 2, 3]; anything else (a pre-release suffix, a
  // missing part) -> null, so a malformed answer is never taken for a version.
  function parseVersion(text) {
    var m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(text || "").trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }
  function isNewer(latest, current) {
    var a = parseVersion(latest);
    var b = parseVersion(current);
    if (!a || !b) {
      return false;
    }
    for (var i = 0; i < 3; i++) {
      if (a[i] !== b[i]) {
        return a[i] > b[i];
      }
    }
    return false;
  }
  // Due when there was no check yet, the last one is older than the interval,
  // or the clock went backwards.
  function isDue(lastCheckMs, nowMs) {
    if (typeof lastCheckMs !== "number" || !isFinite(lastCheckMs)) {
      return true;
    }
    return nowMs < lastCheckMs || nowMs - lastCheckMs >= INTERVAL_MS;
  }
  // The release page to open: the one GitHub names when it belongs to this
  // project, else the project's own latest-release page.
  function pageFor(record) {
    var url = record && typeof record.html_url === "string" ? record.html_url : "";
    return url.indexOf(PAGE_PREFIX) === 0 ? url : RELEASES_URL;
  }
  // callback(err, { version, url }). `httpsModule` is Node's https, taken
  // from the panel's Node context unless a test passes a stand-in.
  function fetchLatest(callback, httpsModule) {
    var https = null;
    try {
      https = httpsModule || global.cep_node.require("https");
    } catch (e) {
      callback(e, null);
      return;
    }
    fetchFromApi(https, function (err, value) {
      // GitHub's API allows few requests per hour from one address without
      // an account, and an address shared by many people (a provider, a
      // VPN) runs out: it answers 403 or 429. The release page itself has
      // no such limit and names the latest release in its forward, so ask
      // that instead before giving up.
      if (err && (err.status === 403 || err.status === 429)) {
        fetchFromPage(https, function (pageErr, pageValue) {
          if (pageErr) {
            callback(new Error(err.message + "; the release page did not answer either (" + pageErr.message + ")"), null);
            return;
          }
          callback(null, pageValue);
        });
        return;
      }
      callback(err, value);
    });
  }
  // The latest release from the project's release page: GitHub forwards
  // /releases/latest to /releases/tag/<tag>, and the forward is all that is
  // read. The packages are named the way every release names them, without
  // sizes (the download reads the length GitHub sends with the file).
  function fetchFromPage(https, callback) {
    var finished = false;
    function done(err, value) {
      if (!finished) {
        finished = true;
        callback(err, value);
      }
    }
    try {
      var req = https.get({
        host: PAGE_HOST,
        path: PAGE_PATH,
        headers: { "User-Agent": "Downbeat-update-check" },
        timeout: TIMEOUT_MS
      }, function (res) {
        res.resume();
        var where = res.headers && typeof res.headers.location === "string" ? res.headers.location : "";
        var m = /^https:\/\/github\.com\/ominousopera\/Downbeat\/releases\/tag\/(v?(\d{1,4})\.(\d{1,4})\.(\d{1,4}))$/.exec(where);
        if (res.statusCode < 300 || res.statusCode >= 400 || !m) {
          done(new Error("the release page answered " + res.statusCode), null);
          return;
        }
        var tag = m[1];
        var version = tag.replace(/^v/, "");
        var files = {};
        var names = { mac: "Downbeat-" + version + "-mac.zxp", win: "Downbeat-" + version + "-win.zxp", sums: SUMS_NAME };
        for (var key in names) {
          if (Object.prototype.hasOwnProperty.call(names, key)) {
            files[key] = { name: names[key], url: ASSET_PREFIX + tag + "/" + names[key], size: 0 };
          }
        }
        done(null, { version: version, url: where, files: files });
      });
      req.on("timeout", function () {
        req.destroy();
        done(new Error("no answer from GitHub in " + TIMEOUT_MS / 1000 + " s"), null);
      });
      req.on("error", function (e) { done(e, null); });
    } catch (e) {
      done(e, null);
    }
  }
  function fetchFromApi(https, callback) {
    var finished = false;
    function done(err, value) {
      if (!finished) {
        finished = true;
        callback(err, value);
      }
    }
    try {
      var req = https.get({
        host: HOST,
        path: PATH,
        headers: { "User-Agent": "Downbeat-update-check", "Accept": "application/vnd.github+json" },
        timeout: TIMEOUT_MS
      }, function (res) {
        if (res.statusCode !== 200) {
          res.resume();
          var limited = res.headers && String(res.headers["x-ratelimit-remaining"]) === "0";
          var httpErr = new Error("GitHub answered " + res.statusCode + (limited ? " (its limit of checks from this address is used up for now)" : ""));
          httpErr.status = res.statusCode;
          done(httpErr, null);
          return;
        }
        var text = "";
        if (typeof res.setEncoding === "function") {
          res.setEncoding("utf8");
        }
        res.on("data", function (chunk) {
          text += chunk.toString("utf8");
          if (text.length > MAX_BYTES) {
            req.destroy();
            done(new Error("the answer was too large"), null);
          }
        });
        res.on("end", function () {
          try {
            var record = JSON.parse(text);
            if (!parseVersion(record.tag_name)) {
              done(new Error("no version number in the answer"), null);
              return;
            }
            var version = String(record.tag_name).replace(/^v/, "");
            done(null, { version: version, url: pageFor(record), files: packageFiles(record, version) });
          } catch (e) {
            done(new Error("could not read the answer"), null);
          }
        });
        res.on("error", function (e) { done(e, null); });
      });
      req.on("timeout", function () {
        req.destroy();
        done(new Error("no answer from GitHub in " + TIMEOUT_MS / 1000 + " s"), null);
      });
      req.on("error", function (e) { done(e, null); });
    } catch (e) {
      done(e, null);
    }
  }
  // ---- the package of a release ---------------------------------------
  var ASSET_PREFIX = "https://github.com/ominousopera/Downbeat/releases/download/";
  var MAX_PACKAGE_BYTES = 400 * 1024 * 1024;
  var MAX_SUMS_BYTES = 64 * 1024;
  var MAX_REDIRECTS = 5;
  var DOWNLOAD_IDLE_MS = 30000;
  var SUMS_NAME = "SHA256SUMS.txt";
  // What the release holds that an update needs: the two packages and the
  // checksum list, each only when GitHub names it under this project's
  // release downloads and under the exact file name a release of this
  // version would use. Anything else in the record is ignored.
  function packageFiles(record, version) {
    var out = {};
    var assets = record && record.assets && record.assets.length ? record.assets : [];
    var wanted = {};
    wanted["Downbeat-" + version + "-mac.zxp"] = "mac";
    wanted["Downbeat-" + version + "-win.zxp"] = "win";
    wanted[SUMS_NAME] = "sums";
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a || typeof a.name !== "string" || typeof a.browser_download_url !== "string") {
        continue;
      }
      var slot = wanted[a.name];
      if (!slot || a.browser_download_url.indexOf(ASSET_PREFIX) !== 0) {
        continue;
      }
      var entry = { name: a.name, url: a.browser_download_url, size: Number(a.size) > 0 ? Number(a.size) : 0 };
      if (typeof a.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(a.digest)) {
        entry.sha256 = a.digest.slice(7);
      }
      out[slot] = entry;
    }
    return out;
  }
  // "mac" or "win" for Node's process.platform; null on anything else.
  function platformKey(nodePlatform) {
    if (nodePlatform === "darwin") { return "mac"; }
    if (nodePlatform === "win32") { return "win"; }
    return null;
  }
  // The package for this computer from the answer saved by fetchLatest, or
  // null when the release has none (an older answer, another system).
  function packageFor(latest, nodePlatform) {
    var key = platformKey(nodePlatform);
    var files = latest && latest.files;
    return key && files && files[key] ? files[key] : null;
  }
  // A line "<64 hex>  <name>" (or "<hex> *<name>") for `name` in the text of
  // a checksum list; null when it is not there.
  function sumFor(text, name) {
    var lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(lines[i]);
      if (m && m[2] === name) {
        return m[1].toLowerCase();
      }
    }
    return null;
  }
  // Only GitHub's own hosts may serve a file: the release page host and the
  // storage hosts it forwards downloads to.
  function isGithubFileHost(host) {
    return host === "github.com" || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.githubusercontent\.com$/.test(host);
  }
  // GET `urlText` over https, following GitHub's forwards. Calls
  // onResponse(res) for the final 200 answer, or onFail(err). Every hop must
  // be https on a GitHub host.
  function getFollowing(https, urlText, onResponse, onFail, hops, control) {
    control = control || { request: null, response: null, stopped: false, destroy: function () {
      this.stopped = true;
      if (this.request) { this.request.destroy(); }
      if (this.response && typeof this.response.destroy === "function") { this.response.destroy(); }
    } };
    var u;
    try { u = new URL(urlText); }
    catch (e) { onFail(new Error("not a web address")); return control; }
    if (u.protocol !== "https:" || !isGithubFileHost(u.hostname)) {
      onFail(new Error("the file is not on GitHub")); return control;
    }
    control.request = https.get({
      host: u.hostname,
      path: u.pathname + u.search,
      timeout: DOWNLOAD_IDLE_MS,
      headers: { "User-Agent": "Downbeat-update-check", "Accept": "application/octet-stream" }
    }, function (res) {
      if (control.stopped) { res.resume(); return; }
      control.response = res;
      res.on("error", onFail);
      res.on("aborted", function () { onFail(new Error("the response was interrupted")); });
      res.on("close", function () {
        if (res.complete === false) { onFail(new Error("the response ended before it was complete")); }
      });
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers && res.headers.location) {
        res.resume();
        if ((hops || 0) >= MAX_REDIRECTS) { onFail(new Error("too many forwards")); return; }
        var next;
        try { next = new URL(res.headers.location, u).toString(); }
        catch (e2) { onFail(new Error("a forward to nowhere")); return; }
        getFollowing(https, next, onResponse, onFail, (hops || 0) + 1, control);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume(); onFail(new Error("GitHub answered " + res.statusCode)); return;
      }
      onResponse(res);
    });
    control.request.on("error", onFail);
    control.request.on("timeout", function () { onFail(new Error("no response data from GitHub in 30 s")); });
    return control;
  }
  // Small text file (the checksum list) into a string.
  function fetchText(https, urlText, maxBytes, callback) {
    var finished = false;
    var control = null;
    var timer = setTimeout(function () { done(new Error("the checksum request timed out"), null); }, DOWNLOAD_IDLE_MS);
    function done(err, text) {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      if (err && control) { control.destroy(); }
      callback(err, text);
    }
    try {
      control = getFollowing(https, urlText, function (res) {
        var text = "";
        res.on("data", function (chunk) {
          if (finished) { return; }
          text += chunk.toString("utf8");
          if (text.length > maxBytes) { done(new Error("the checksum list was too large"), null); }
        });
        res.on("end", function () { done(null, text); });
      }, function (e) { done(e, null); }, 0);
    } catch (e) { done(e, null); }
  }
  // Check retained package bytes before passing them to an installer.
  function verifyDownloaded(saved, opts, callback) {
    var stream = null;
    var finished = false;
    function done(err) {
      if (finished) { return; }
      finished = true;
      if (err && stream) { stream.destroy(); }
      callback(err, err ? null : saved);
    }
    try {
      var m = opts && opts.modules || {};
      var req = global.cep_node.require;
      var fs = m.fs || req("fs"), path = m.path || req("path"), crypto = m.crypto || req("crypto");
      if (!saved || typeof saved.path !== "string" || !path.isAbsolute(saved.path) ||
          !/^Downbeat-\d{1,4}\.\d{1,4}\.\d{1,4}-(mac|win)(-\d+)?\.zxp$/.test(path.basename(saved.path)) ||
          !/^[a-f0-9]{64}$/.test(saved.sha256 || "")) { throw new Error("no verified update package is saved"); }
      var stat = fs.lstatSync(saved.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PACKAGE_BYTES ||
          (saved.size > 0 && stat.size !== saved.size)) { throw new Error("the saved package has changed"); }
      var hash = crypto.createHash("sha256");
      stream = fs.createReadStream(saved.path);
      stream.on("data", function (data) { hash.update(data); });
      stream.on("error", done);
      stream.on("end", function () {
        done(hash.digest("hex") === saved.sha256 ? null : new Error("the saved package does not match its verified checksum"));
      });
    } catch (e) { done(e); }
  }

  // Download to a uniquely owned temporary file, verify its release checksum,
  // then save without overwriting another package and hand it to the installer.
  // Without a published checksum no download begins; failed owned temporary
  // files are removed, while verified final files remain available for retry.
  function downloadPackage(latest, opts, callback) {
    var finished = false, ownedPath = null, out = null, response = null, control = null, idle = null;
    var fsMod = null;
    function done(err, value) {
      if (finished) { return; }
      finished = true;
      clearTimeout(idle);
      function cleanup() {
        if (err && ownedPath) { try { fsMod.unlinkSync(ownedPath); } catch (e) { /* already gone */ } }
        callback(err, value);
      }
      if (err) {
        if (control) { control.destroy(); }
        if (response && typeof response.destroy === "function") { response.destroy(); }
        if (out && !out.closed) { out.once("close", cleanup); out.destroy(); return; }
      }
      cleanup();
    }
    function armIdle() {
      clearTimeout(idle);
      idle = setTimeout(function () { done(new Error("the download stopped"), null); }, DOWNLOAD_IDLE_MS);
    }
    try {
      var req = global.cep_node.require;
      var m = opts.modules || {};
      var https = m.https || req("https"), path = m.path || req("path"), crypto = m.crypto || req("crypto");
      fsMod = m.fs || req("fs");
      var pkg = packageFor(latest, opts.platform);
      if (!pkg) { done(new Error("this release has no package for this computer"), null); return; }
      var name = pkg.name;
      if (!/^Downbeat-\d{1,4}\.\d{1,4}\.\d{1,4}-(mac|win)\.zxp$/.test(name)) {
        done(new Error("unexpected package name"), null); return;
      }
      if (pkg.size > MAX_PACKAGE_BYTES) { done(new Error("the package is larger than expected"), null); return; }
      var finalPath = path.join(opts.dir, name);
      function getExpected(next) {
        if (/^[a-f0-9]{64}$/.test(pkg.sha256 || "")) { next(null, pkg.sha256); return; }
        var sums = latest.files && latest.files.sums;
        if (!sums) { next(new Error("the release publishes no checksum for the package"), null); return; }
        fetchText(https, sums.url, MAX_SUMS_BYTES, function (err, text) {
          if (err) { next(err, null); return; }
          var sum = sumFor(text, name);
          next(sum ? null : new Error("the checksum list does not name the package"), sum);
        });
      }
      getExpected(function (expectErr, expected) {
        if (expectErr) { done(expectErr, null); return; }
        if (finished) { return; }
        var hash = crypto.createHash("sha256"), written = 0;
        armIdle();
        try {
          control = getFollowing(https, pkg.url, function (res) {
            if (finished) { res.resume(); return; }
            response = res;
            var fd = null;
            try {
              var partPath = finalPath + "." + crypto.randomBytes(12).toString("hex") + ".part";
              fd = fsMod.openSync(partPath, "wx", 384);
              ownedPath = partPath;
              out = fsMod.createWriteStream(partPath, { fd: fd });
            } catch (e) {
              if (fd !== null) { try { fsMod.closeSync(fd); } catch (closeErr) { /* closing anyway */ } }
              done(e, null); return;
            }
            out.on("error", function (e) { done(e, null); });
            out.on("drain", function () { if (!finished && typeof res.resume === "function") { res.resume(); } });
            res.on("data", function (chunk) {
              if (finished) { return; }
              armIdle();
              written += chunk.length;
              if (written > MAX_PACKAGE_BYTES) { done(new Error("the package is larger than expected"), null); return; }
              hash.update(chunk);
              if (!out.write(chunk) && typeof res.pause === "function") { res.pause(); }
              var total = pkg.size > 0 ? pkg.size : Number(res.headers && res.headers["content-length"]) || 0;
              if (typeof opts.onProgress === "function" && total > 0) { opts.onProgress(Math.min(1, written / total)); }
            });
            res.on("end", function () {
              if (finished) { return; }
              clearTimeout(idle);
              out.end();
            });
            out.on("close", function () {
              if (finished) { return; }
              var got = hash.digest("hex");
              if (got !== expected) { done(new Error("the downloaded file does not match its published checksum - it was deleted"), null); return; }
              if (pkg.size > 0 && written !== pkg.size) { done(new Error("the downloaded file is not the expected size - it was deleted"), null); return; }
              try {
                for (var suffix = 0; suffix < 100; suffix++) {
                  var target = suffix ? finalPath.replace(/\.zxp$/, "-" + suffix + ".zxp") : finalPath;
                  try { fsMod.copyFileSync(ownedPath, target, 1); finalPath = target; break; }
                  catch (copyErr) { if (copyErr.code !== "EEXIST" || suffix === 99) { throw copyErr; } }
                }
                fsMod.unlinkSync(ownedPath);
                ownedPath = null;
              } catch (e) { done(e, null); return; }
              finished = true;
              function finishOpen(error) {
                callback(null, { path: finalPath, name: path.basename(finalPath), sha256: got, size: written,
                  version: latest.version || null, openError: error ? (error.message || String(error)) : null });
              }
              try {
                Promise.resolve(typeof m.open === "function" ? m.open(finalPath) : null)
                  .then(function () { finishOpen(null); }, finishOpen);
              } catch (e) { finishOpen(e); }
            });
          }, function (e) { done(e, null); }, 0);
        } catch (e) { done(e, null); }
      });
    } catch (e) { done(e, null); }
  }
  global.BeatMarkerUpdateCheck = {
    parseVersion: parseVersion,
    isNewer: isNewer,
    isDue: isDue,
    pageFor: pageFor,
    fetchLatest: fetchLatest,
    packageFiles: packageFiles,
    platformKey: platformKey,
    packageFor: packageFor,
    sumFor: sumFor,
    isGithubFileHost: isGithubFileHost,
    downloadPackage: downloadPackage,
    verifyDownloaded: verifyDownloaded,
    RELEASES_URL: RELEASES_URL
  };
})(window);
