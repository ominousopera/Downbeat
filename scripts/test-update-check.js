"use strict";
// The optional "new version" notice (Settings > Updates): version parsing
// and comparison, the three-day rhythm, the request to GitHub (against a
// stand-in for Node's https - nothing here goes online), and the panel
// wiring: off by default, the answer shown, the release page behind the
// link confirmation, and no request at all while the switch is off.
// Run: node scripts/test-update-check.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-update-"));
const DATA = path.join(DOCS, "Downbeat");
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true }));
const panel = require("./panel-harness.js").bootPanel({ docsDir: DOCS, realTimeouts: true });
const UC = window.BeatMarkerUpdateCheck;
const r = panel.registry;

// Versions
check("v1.0.1 and 1.0.1 are read", JSON.stringify(UC.parseVersion("v1.0.1")) === "[1,0,1]" && JSON.stringify(UC.parseVersion("1.0.1")) === "[1,0,1]");
check("a pre-release or a half version is not a version", UC.parseVersion("v1.0.1-beta") === null && UC.parseVersion("1.0") === null && UC.parseVersion("") === null && UC.parseVersion(null) === null);
check("1.0.2 is newer than 1.0.1, 1.10.0 than 1.9.9, 2.0.0 than 1.99.99", UC.isNewer("1.0.2", "1.0.1") && UC.isNewer("1.10.0", "1.9.9") && UC.isNewer("2.0.0", "1.99.99"));
check("the same or an older version is not newer", !UC.isNewer("1.0.1", "1.0.1") && !UC.isNewer("1.0.0", "1.0.1") && !UC.isNewer("garbage", "1.0.1") && !UC.isNewer("1.0.2", "unknown (x)"));

// Rhythm
const DAY = 24 * 3600 * 1000;
check("a check is due with none before, after three days, or when the clock went back", UC.isDue(undefined, 1e12) && UC.isDue(1e12 - 3 * DAY, 1e12) && UC.isDue(1e12 + 5, 1e12));
check("not due within three days", !UC.isDue(1e12 - 2 * DAY, 1e12));

// The release page: GitHub's own link for this project, else the fixed one
check("the release link from GitHub is used when it belongs to this project", UC.pageFor({ html_url: "https://github.com/ominousopera/Downbeat/releases/tag/v1.0.2" }) === "https://github.com/ominousopera/Downbeat/releases/tag/v1.0.2");
check("a link to anywhere else is replaced by the project's latest-release page", UC.pageFor({ html_url: "https://evil.example/x" }) === UC.RELEASES_URL && UC.pageFor({}) === UC.RELEASES_URL);

// The request, against a stand-in for https
function fakeHttps(kind, body) {
  const calls = [];
  return {
    calls: calls,
    get: function (options, onResponse) {
      calls.push(options);
      const req = new EventEmitter();
      req.destroy = function () { req.destroyed = true; };
      setImmediate(function () {
        if (kind === "timeout") { req.emit("timeout"); return; }
        if (kind === "error") { req.emit("error", new Error("getaddrinfo ENOTFOUND api.github.com")); return; }
        const res = new EventEmitter();
        res.statusCode = kind === "404" ? 404 : 200;
        res.resume = function () {};
        onResponse(res);
        if (kind === "huge") { res.emit("data", Buffer.alloc(2 * 1024 * 1024)); return; }
        res.emit("data", Buffer.from(body || ""));
        res.emit("end");
      });
      return req;
    }
  };
}
function ask(kind, body) {
  return new Promise(function (resolve) {
    const h = fakeHttps(kind, body);
    UC.fetchLatest(function (err, value) { resolve({ err: err, value: value, calls: h.calls }); }, h);
  });
}

(async function () {
  let a = await ask("ok", JSON.stringify({ tag_name: "v1.0.2", html_url: "https://github.com/ominousopera/Downbeat/releases/tag/v1.0.2" }));
  check("a good answer gives the version and the page", !a.err && a.value.version === "1.0.2" && /releases\/tag\/v1\.0\.2$/.test(a.value.url));
  check("the request goes to api.github.com, to this project's release record only, with no cookie or token",
    a.calls.length === 1 && a.calls[0].host === "api.github.com" && a.calls[0].path === "/repos/ominousopera/Downbeat/releases/latest" &&
    !Object.keys(a.calls[0].headers).some(function (k) { return /cookie|authorization/i.test(k); }), JSON.stringify(a.calls[0]));
  a = await ask("404");
  check("an HTTP error is reported, not taken for a version", a.err && /404/.test(a.err.message) && !a.value);
  a = await ask("ok", "not json");
  check("an unreadable answer is an error", a.err && !a.value);
  a = await ask("ok", JSON.stringify({ tag_name: "nightly" }));
  check("an answer without a version number is an error", a.err && !a.value);
  a = await ask("huge");
  check("an oversized answer is cut off", a.err && /too large/.test(a.err.message));
  a = await ask("timeout");
  check("no answer in time is an error", a.err && /no answer/.test(a.err.message));
  a = await ask("error");
  check("a network error is passed on", a.err && /ENOTFOUND/.test(a.err.message));

  // The panel: off by default, nothing asked
  let requests = 0;
  let nextAnswer = { err: null, value: { version: "9.9.9", url: "https://github.com/ominousopera/Downbeat/releases/tag/v9.9.9" } };
  UC.fetchLatest = function (cb) { requests++; setImmediate(function () { cb(nextAnswer.err, nextAnswer.value); }); };
  check("off by default: the switch is off, no request was made, no Check now button, no open button",
    r.updateCheckCheckbox.checked === false && requests === 0 && r.updateCheckNowBtn.hidden === true && r.updateOpenBtn.hidden === true);
  r.updateCheckCheckbox.checked = true;
  r.updateCheckCheckbox._fire("change");
  await new Promise(function (res) { setTimeout(res, 20); });
  check("switching it on asks once and shows the newer version, with the open button and a dot on the gear",
    requests === 1 && /9\.9\.9/.test(r.updateStatus.textContent) && r.updateOpenBtn.hidden === false && r.settingsGearBtn.classList.contains("has-update"), r.updateStatus.textContent);
  let saved = JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf8"));
  check("the choice and the answer are remembered", saved.updateCheck === true && saved.latestRelease && saved.latestRelease.version === "9.9.9" && typeof saved.lastUpdateCheck === "number");
  r.updateOpenBtn._fire("click");
  check("the open button asks first: the link confirmation shows the release page",r.externalLinkOverlay.hidden === false && /releases\/tag\/v9\.9\.9/.test(r.externalLinkMessage.textContent), r.externalLinkMessage.textContent);
  check("Check now is offered while the switch is on", r.updateCheckNowBtn.hidden === false);
  nextAnswer = { err: null, value: { version: "1.0.1", url: "https://github.com/ominousopera/Downbeat/releases/latest" } };
  r.updateCheckNowBtn._fire("click");
  await new Promise(function (res) { setTimeout(res, 20); });
  check("when the latest release is the installed one it says so, and the dot and button go away",
    /latest version/.test(r.updateStatus.textContent) && r.updateOpenBtn.hidden === true && !r.settingsGearBtn.classList.contains("has-update"), r.updateStatus.textContent);
  nextAnswer = { err: new Error("no answer from GitHub in 10 s"), value: null };
  r.updateCheckNowBtn._fire("click");
  await new Promise(function (res) { setTimeout(res, 20); });
  check("a failed check says so and does not break anything", /Could not check/.test(r.updateStatus.textContent), r.updateStatus.textContent);
  const before = requests;
  r.updateCheckCheckbox.checked = false;
  r.updateCheckCheckbox._fire("change");
  saved = JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf8"));
  check("switching it off stops everything: saved off, no request, Check now hidden", saved.updateCheck === false && requests === before && r.updateCheckNowBtn.hidden === true);

  fs.rmSync(DOCS, { recursive: true, force: true });
  if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
  console.log("\nthe update notice is off by default, asks GitHub only when switched on, and only shows a link");
})();
