// The optional "new version" notice: asks GitHub for the number of the
// latest Downbeat release and compares it with the installed version. It is
// the only place the plugin goes online, it runs only when the user has
// switched it on in Settings, and it sends nothing about the user - a plain
// GET for the public release record. Nothing is downloaded or installed;
// the notice only points to the release page.
(function (global) {
  "use strict";

  var HOST = "api.github.com";
  var PATH = "/repos/ominousopera/Downbeat/releases/latest";
  var RELEASES_URL = "https://github.com/ominousopera/Downbeat/releases/latest";
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
    var finished = false;
    function done(err, value) {
      if (!finished) {
        finished = true;
        callback(err, value);
      }
    }
    try {
      var https = httpsModule || global.cep_node.require("https");
      var req = https.get({
        host: HOST,
        path: PATH,
        headers: { "User-Agent": "Downbeat-update-check", "Accept": "application/vnd.github+json" },
        timeout: TIMEOUT_MS
      }, function (res) {
        if (res.statusCode !== 200) {
          res.resume();
          done(new Error("GitHub answered " + res.statusCode), null);
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
            done(null, { version: String(record.tag_name).replace(/^v/, ""), url: pageFor(record) });
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
