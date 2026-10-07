// The optional "new version" notice: asks GitHub for the number of the
// latest Downbeat release and compares it with the installed version. It is
// the only place the plugin goes online, it runs only when the user has
// switched it on in Settings, and it sends nothing about the user - a plain
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
  function getFollowing(https, urlText, onResponse, onFail, hops) {
    var u;
    try {
      u = new URL(urlText);
    } catch (e) {
      onFail(new Error("not a web address"));
      return null;
    }
    if (u.protocol !== "https:" || !isGithubFileHost(u.hostname)) {
      onFail(new Error("the file is not on GitHub"));
      return null;
    }
    var req = https.get({
      host: u.hostname,
      path: u.pathname + u.search,
      headers: { "User-Agent": "Downbeat-update-check", "Accept": "application/octet-stream" }
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers && res.headers.location) {
        res.resume();
        if ((hops || 0) >= MAX_REDIRECTS) {
          onFail(new Error("too many forwards"));
          return;
        }
        var next;
        try {
          next = new URL(res.headers.location, u).toString();
        } catch (e2) {
          onFail(new Error("a forward to nowhere"));
          return;
        }
        getFollowing(https, next, onResponse, onFail, (hops || 0) + 1);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        onFail(new Error("GitHub answered " + res.statusCode));
        return;
      }
      onResponse(res);
    });
    req.on("error", function (e) { onFail(e); });
    return req;
  }

  // Small text file (the checksum list) into a string.
  function fetchText(https, urlText, maxBytes, callback) {
    var finished = false;
    function done(err, text) {
      if (!finished) {
        finished = true;
        callback(err, text);
      }
    }
    getFollowing(https, urlText, function (res) {
      var text = "";
      if (typeof res.setEncoding === "function") { res.setEncoding("utf8"); }
      res.on("data", function (chunk) {
        text += chunk.toString("utf8");
        if (text.length > maxBytes) {
          if (typeof res.destroy === "function") { res.destroy(); }
          done(new Error("the checksum list was too large"), null);
        }
      });
      res.on("end", function () { done(null, text); });
      res.on("error", function (e) { done(e, null); });
    }, function (e) { done(e, null); }, 0);
  }

  // Downloads the package for this computer, checks it, saves it as
  // <dir>/<name> and opens it. `latest` is the answer saved by fetchLatest.
  // opts: { platform, dir, onProgress(fraction), modules: { https, fs, path,
  // crypto, open(path) } } - the modules come from the panel's Node context
  // unless a test passes stand-ins.
  // callback(err, { path, name, sha256 }). The file is verified BEFORE it is
  // named: it is written under a ".part" name, its SHA-256 is compared with
  // the one the release publishes (the asset's own digest, else the line in
  // SHA256SUMS.txt), and only a match is renamed and opened. No published
  // checksum, or a mismatch, deletes the file and stops.
  function downloadPackage(latest, opts, callback) {
    var finished = false;
    var partPath = null;
    var fsMod = null;
    function done(err, value) {
      if (finished) { return; }
      finished = true;
      if (err && partPath && fsMod) {
        try { fsMod.unlinkSync(partPath); } catch (e) { /* nothing was written yet */ }
      }
      callback(err, value);
    }
    try {
      var nodeRequire = global.cep_node && global.cep_node.require ? global.cep_node.require : null;
      var m = opts.modules || {};
      var https = m.https || nodeRequire("https");
      fsMod = m.fs || nodeRequire("fs");
      var pathMod = m.path || nodeRequire("path");
      var crypto = m.crypto || nodeRequire("crypto");
      var pkg = packageFor(latest, opts.platform);
      if (!pkg) {
        done(new Error("this release has no package for this computer"), null);
        return;
      }
      var name = pkg.name;
      if (!/^Downbeat-\d{1,4}\.\d{1,4}\.\d{1,4}-(mac|win)\.zxp$/.test(name)) {
        done(new Error("unexpected package name"), null);
        return;
      }
      if (pkg.size > MAX_PACKAGE_BYTES) {
        done(new Error("the package is larger than expected"), null);
        return;
      }
      var finalPath = pathMod.join(opts.dir, name);
      partPath = finalPath + ".part";

      var getExpected = function (next) {
        if (pkg.sha256) {
          next(null, pkg.sha256);
          return;
        }
        var sums = latest.files && latest.files.sums;
        if (!sums) {
          next(new Error("the release publishes no checksum for the package"), null);
          return;
        }
        fetchText(https, sums.url, MAX_SUMS_BYTES, function (err, text) {
          if (err) { next(err, null); return; }
          var sum = sumFor(text, name);
          next(sum ? null : new Error("the checksum list does not name the package"), sum);
        });
      };

      getExpected(function (expectErr, expected) {
        if (expectErr) { done(expectErr, null); return; }
        var hash = crypto.createHash("sha256");
        var written = 0;
        var out = null;
        var idle = null;
        var req = null;
        var armIdle = function () {
          if (idle) { clearTimeout(idle); }
          idle = setTimeout(function () {
            if (req && typeof req.destroy === "function") { req.destroy(); }
            if (out) { try { out.destroy(); } catch (e) { /* closing anyway */ } }
            done(new Error("the download stopped"), null);
          }, DOWNLOAD_IDLE_MS);
        };
        armIdle();
        req = getFollowing(https, pkg.url, function (res) {
          try {
            out = fsMod.createWriteStream(partPath);
          } catch (e) {
            clearTimeout(idle);
            done(e, null);
            return;
          }
          out.on("error", function (e) { clearTimeout(idle); done(e, null); });
          res.on("data", function (chunk) {
            armIdle();
            written += chunk.length;
            if (written > MAX_PACKAGE_BYTES) {
              if (typeof res.destroy === "function") { res.destroy(); }
              clearTimeout(idle);
              try { out.destroy(); } catch (e) { /* closing anyway */ }
              done(new Error("the package is larger than expected"), null);
              return;
            }
            hash.update(chunk);
            out.write(chunk);
            var total = pkg.size > 0 ? pkg.size : (res.headers && Number(res.headers["content-length"]) > 0 ? Number(res.headers["content-length"]) : 0);
            if (typeof opts.onProgress === "function" && total > 0) {
              opts.onProgress(Math.min(1, written / total));
            }
          });
          res.on("error", function (e) { clearTimeout(idle); done(e, null); });
          res.on("end", function () {
            clearTimeout(idle);
            out.end(function () {
              var got = hash.digest("hex");
              if (got !== expected) {
                done(new Error("the downloaded file does not match its published checksum - it was deleted"), null);
                return;
              }
              if (pkg.size > 0 && written !== pkg.size) {
                done(new Error("the downloaded file is not the expected size - it was deleted"), null);
                return;
              }
              try {
                fsMod.renameSync(partPath, finalPath);
              } catch (e) {
                done(e, null);
                return;
              }
              partPath = null;
              var opened = null;
              try {
                if (typeof m.open === "function") { m.open(finalPath); }
              } catch (e) {
                opened = e;
              }
              finished = true;
              callback(null, { path: finalPath, name: name, sha256: got, openError: opened ? (opened.message || String(opened)) : null });
            });
          });
        }, function (e) { clearTimeout(idle); done(e, null); }, 0);
      });
    } catch (e) {
      done(e, null);
    }
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
    RELEASES_URL: RELEASES_URL
  };
})(window);
