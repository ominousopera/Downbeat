// Release metadata supports explicit checks and optional periodic notices.
// Only this project's release pages are accepted; audio remains local.
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
  // GitHub's latest-release redirect provides a version when API limits apply.
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
        done(null, { version: version, url: where });
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
            done(null, { version: version, url: pageFor(record) });
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
  global.BeatMarkerUpdateCheck = {
    parseVersion: parseVersion,
    isNewer: isNewer,
    isDue: isDue,
    pageFor: pageFor,
    fetchLatest: fetchLatest,
    RELEASES_URL: RELEASES_URL
  };
})(window);
