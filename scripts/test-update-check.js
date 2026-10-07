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

  // The package of a release: which files count, and the download
  const crypto = require("crypto");
  const BASE = "https://github.com/ominousopera/Downbeat/releases/download/v1.0.2/";
  const PKG = Buffer.from("pretend this is a 98 MB signed package");
  const PKG_SHA = crypto.createHash("sha256").update(PKG).digest("hex");
  const record = {
    tag_name: "v1.0.2",
    html_url: "https://github.com/ominousopera/Downbeat/releases/tag/v1.0.2",
    assets: [
      { name: "Downbeat-1.0.2-mac.zxp", browser_download_url: BASE + "Downbeat-1.0.2-mac.zxp", size: PKG.length },
      { name: "Downbeat-1.0.2-win.zxp", browser_download_url: BASE + "Downbeat-1.0.2-win.zxp", size: PKG.length, digest: "sha256:" + PKG_SHA },
      { name: "SHA256SUMS.txt", browser_download_url: BASE + "SHA256SUMS.txt", size: 200 },
      { name: "evil.zxp", browser_download_url: BASE + "evil.zxp", size: 5 },
      { name: "Downbeat-1.0.2-mac.zxp", browser_download_url: "https://evil.example/Downbeat-1.0.2-mac.zxp", size: 5 }
    ]
  };
  const files = UC.packageFiles(record, "1.0.2");
  check("the release's files are picked by exact name, from this project's downloads only",
    Object.keys(files).sort().join(",") === "mac,sums,win" && files.mac.url === BASE + "Downbeat-1.0.2-mac.zxp" && files.win.sha256 === PKG_SHA && !files.mac.sha256, JSON.stringify(Object.keys(files)));
  check("the package for this computer follows the system, and none for another system",
    UC.packageFor({ files: files }, "darwin").name === "Downbeat-1.0.2-mac.zxp" && UC.packageFor({ files: files }, "win32").name === "Downbeat-1.0.2-win.zxp" && UC.packageFor({ files: files }, "linux") === null && UC.packageFor({ files: {} }, "darwin") === null && UC.packageFor(null, "darwin") === null);
  check("only GitHub's own hosts may serve a file",
    UC.isGithubFileHost("github.com") && UC.isGithubFileHost("release-assets.githubusercontent.com") && !UC.isGithubFileHost("evilgithubusercontent.com") && !UC.isGithubFileHost("github.com.evil.example") && !UC.isGithubFileHost("example.com"));
  check("a checksum list is read by file name", UC.sumFor(PKG_SHA + "  Downbeat-1.0.2-mac.zxp\n" + "b".repeat(64) + " *Downbeat-1.0.2-win.zxp\n", "Downbeat-1.0.2-win.zxp") === "b".repeat(64) && UC.sumFor("nothing", "x") === null);

  // A stand-in for GitHub: a table of address -> answer
  function fakeSite(table) {
    const log = [];
    return {
      log: log,
      get: function (options, onResponse) {
        const key = options.host + options.path;
        log.push(key);
        const req = new EventEmitter();
        req.destroy = function () {};
        setImmediate(function () {
          const hit = table[key];
          const res = new EventEmitter();
          res.resume = function () {};
          res.destroy = function () {};
          res.setEncoding = function () {};
          if (!hit) { res.statusCode = 404; onResponse(res); return; }
          res.statusCode = hit.status || 200;
          res.headers = hit.location ? { location: hit.location } : {};
          onResponse(res);
          if (hit.body) { res.emit("data", hit.body); }
          res.emit("end");
        });
        return req;
      }
    };
  }
  function download(latest, platform, site, extra) {
    const dir = fs.mkdtempSync(path.join(DOCS, "dl-"));
    let progress = 0;
    let opened = null;
    return new Promise(function (resolve) {
      UC.downloadPackage(latest, {
        platform: platform, dir: dir, onProgress: function (f) { progress = f; },
        modules: Object.assign({ https: site, open: function (p) { opened = p; } }, extra || {})
      }, function (err, value) { resolve({ err: err, value: value, dir: dir, progress: progress, opened: opened }); });
    });
  }
  const forward = "release-assets.githubusercontent.com/blob/1";
  const goodSite = function () {
    return fakeSite({
      "github.com/ominousopera/Downbeat/releases/download/v1.0.2/Downbeat-1.0.2-win.zxp": { status: 302, location: "https://" + forward },
      [forward]: { body: PKG }
    });
  };
  let d = await download({ files: files }, "win32", goodSite());
  check("a package is downloaded through GitHub's forward, checked against the asset's digest, saved and opened",
    !d.err && d.value.name === "Downbeat-1.0.2-win.zxp" && fs.readFileSync(path.join(d.dir, d.value.name)).equals(PKG) && d.opened === path.join(d.dir, d.value.name) && d.progress === 1 && d.value.sha256 === PKG_SHA,
    d.err && d.err.message);
  check("no half-written file is left", fs.readdirSync(d.dir).join(",") === "Downbeat-1.0.2-win.zxp");

  const sumsFiles = JSON.parse(JSON.stringify(files));
  const macSite = fakeSite({
    "github.com/ominousopera/Downbeat/releases/download/v1.0.2/SHA256SUMS.txt": { body: Buffer.from("deadbeef  other\n" + PKG_SHA + "  Downbeat-1.0.2-mac.zxp\n") },
    "github.com/ominousopera/Downbeat/releases/download/v1.0.2/Downbeat-1.0.2-mac.zxp": { body: PKG }
  });
  d = await download({ files: sumsFiles }, "darwin", macSite);
  check("without a digest the checksum is read from SHA256SUMS.txt", !d.err && d.value.sha256 === PKG_SHA && d.opened, d.err && d.err.message);

  const tampered = fakeSite({
    "github.com/ominousopera/Downbeat/releases/download/v1.0.2/Downbeat-1.0.2-win.zxp": { body: Buffer.from("not the same bytes at all!!!!!!!!!!!!!!!!!!!!") }
  });
  const sized = JSON.parse(JSON.stringify(files)); sized.win.size = 0;
  d = await download({ files: sized }, "win32", tampered);
  check("a file that does not match its checksum is deleted and never opened", d.err && /checksum/.test(d.err.message) && d.opened === null && fs.readdirSync(d.dir).length === 0, d.err && d.err.message);

  const noSums = JSON.parse(JSON.stringify(files)); delete noSums.sums;
  d = await download({ files: noSums }, "darwin", goodSite());
  check("with no published checksum nothing is downloaded at all", d.err && /no checksum/.test(d.err.message) && fs.readdirSync(d.dir).length === 0 && d.opened === null, d.err && d.err.message);

  const evil = fakeSite({
    "github.com/ominousopera/Downbeat/releases/download/v1.0.2/Downbeat-1.0.2-win.zxp": { status: 302, location: "https://evil.example/x" }
  });
  d = await download({ files: files }, "win32", evil);
  check("a forward to a host that is not GitHub's is refused", d.err && /not on GitHub/.test(d.err.message) && evil.log.length === 1 && d.opened === null, d.err && d.err.message);
  const plain = fakeSite({
    "github.com/ominousopera/Downbeat/releases/download/v1.0.2/Downbeat-1.0.2-win.zxp": { status: 302, location: "http://objects.githubusercontent.com/x" }
  });
  d = await download({ files: files }, "win32", plain);
  check("a forward to plain http is refused", d.err && /not on GitHub/.test(d.err.message) && d.opened === null, d.err && d.err.message);

  const big = JSON.parse(JSON.stringify(files)); big.win.size = 500 * 1024 * 1024;
  d = await download({ files: big }, "win32", goodSite());
  check("a package announced as far too large is not fetched", d.err && /larger/.test(d.err.message), d.err && d.err.message);
  d = await download({ files: files }, "linux", goodSite());
  check("a system with no package says so", d.err && /no package/.test(d.err.message));
  d = await download({ files: files }, "win32", fakeSite({}));
  check("a missing file (404) is an error and leaves nothing", d.err && /404/.test(d.err.message) && fs.readdirSync(d.dir).length === 0, d.err && d.err.message);
  d = await download({ files: files }, "win32", goodSite(), { open: function () { throw new Error("no application"); } });
  check("a package that downloaded but would not open is kept and the failure is reported", !d.err && d.value.openError === "no application" && fs.existsSync(d.value.path), d.err && d.err.message);

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
  check("no download button when the release has no package for this computer", r.updateDownloadBtn.hidden === true);
  nextAnswer = { err: null, value: { version: "9.9.9", url: "https://github.com/ominousopera/Downbeat/releases/tag/v9.9.9", files: { mac: { name: "Downbeat-9.9.9-mac.zxp", url: BASE + "Downbeat-9.9.9-mac.zxp", size: 98 * 1024 * 1024, sha256: "a".repeat(64) }, win: { name: "Downbeat-9.9.9-win.zxp", url: BASE + "Downbeat-9.9.9-win.zxp", size: 56 * 1024 * 1024, sha256: "a".repeat(64) } } } };
  r.updateCheckNowBtn._fire("click");
  await new Promise(function (res) { setTimeout(res, 20); });
  check("with a package for this computer the download button appears, with its size",
    r.updateDownloadBtn.hidden === false && /\d+ MB/.test(r.updateDownloadBtn.textContent) && r.updateOpenBtn.hidden === false, r.updateDownloadBtn.textContent);
  let downloadAsked = null;
  UC.downloadPackage = function (latest, opts, cb) { downloadAsked = { latest: latest, platform: opts.platform, dir: opts.dir }; opts.onProgress(0.5); setImmediate(function () { cb(null, { path: path.join(opts.dir, "x.zxp"), name: "Downbeat-9.9.9-mac.zxp", sha256: "a".repeat(64), openError: null }); }); };
  r.updateDownloadBtn._fire("click");
  await new Promise(function (res) { setTimeout(res, 20); });
  check("pressing it downloads that release's package into a folder, then says what to do next",
    downloadAsked && downloadAsked.latest.version === "9.9.9" && /Downloads$|^\//.test(downloadAsked.dir) && /Confirm in your ZXP installer/.test(r.updateStatus.textContent), r.updateStatus.textContent);
  UC.downloadPackage = function (latest, opts, cb) { setImmediate(function () { cb(new Error("the downloaded file does not match its published checksum - it was deleted"), null); }); };
  r.updateDownloadBtn._fire("click");
  await new Promise(function (res) { setTimeout(res, 20); });
  check("a failed download says nothing was installed and offers the release page",
    /Nothing was installed/.test(r.updateStatus.textContent) && r.updateOpenBtn.hidden === false && r.updateDownloadBtn.hidden === false, r.updateStatus.textContent);
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
