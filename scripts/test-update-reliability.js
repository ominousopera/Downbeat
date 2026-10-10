"use strict";
// Downloads own their temporary files and retained packages are reverified.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-update-owned-"));
const scope = { window: { cep_node: { require: require } }, URL: URL, Promise: Promise,
  setTimeout: function (fn, ms) { return setTimeout(fn, ms === 30000 ? 50 : ms); }, clearTimeout: clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/update-check.js"), "utf8"), scope);
const UC = scope.window.BeatMarkerUpdateCheck;
const bytes = Buffer.from("a verified package fixture");
const sha = crypto.createHash("sha256").update(bytes).digest("hex");
const name = "Downbeat-1.0.3-mac.zxp";
const foreign = path.join(dir, name + ".part");
fs.writeFileSync(foreign, "owned by another attempt");
const packageInfo = { name: name, size: bytes.length, sha256: sha,
  url: "https://github.com/ominousopera/Downbeat/releases/download/v1.0.3/" + name };
function site(kind) {
  return { get: function (options, cb) {
    const req = new EventEmitter(); req.destroy = function () { req.destroyed = true; };
    if (kind === "stall") { return req; }
    setImmediate(function () {
      const res = new EventEmitter(); res.statusCode = 200; res.headers = {};
      res.resume = function () {}; res.destroy = function () {};
      cb(res);
      if (kind === "aborted") { res.emit("aborted"); res.emit("data", bytes); res.emit("end"); }
      else { res.emit("data", bytes); res.emit("end"); }
    });
    return req;
  } };
}
function download(pkg, kind, modules) {
  let calls = 0;
  return new Promise(function (resolve, reject) {
    UC.downloadPackage({ version: "1.0.3", files: { mac: pkg } }, {
      dir: dir, platform: "darwin", modules: Object.assign({ https: site(kind) }, modules || {})
    }, function (err, value) { calls++; if (calls > 1) { reject(new Error("callback repeated")); } else { resolve({ err: err, value: value }); } });
  });
}
function verify(saved) {
  return new Promise(function (resolve) { UC.verifyDownloaded(saved, {}, function (err) { resolve(err); }); });
}
(async function () {
  try {
    const noSum = Object.assign({}, packageInfo); delete noSum.sha256;
    assert((await download(noSum, "ok")).err);
    assert.strictEqual(fs.readFileSync(foreign, "utf8"), "owned by another attempt");
    fs.writeFileSync(path.join(dir, name), "an existing package");
    const results = await Promise.all([download(packageInfo, "ok"), download(packageInfo, "ok")]);
    for (const result of results) {
      assert.ifError(result.err);
      assert(fs.readFileSync(result.value.path).equals(bytes));
      assert.ifError(await verify(result.value));
    }
    assert.notStrictEqual(results[0].value.path, results[1].value.path);
    assert.strictEqual(fs.readFileSync(path.join(dir, name), "utf8"), "an existing package");
    assert.strictEqual(fs.readFileSync(foreign, "utf8"), "owned by another attempt");
    const before = fs.readdirSync(dir).sort().join();
    assert((await download(packageInfo, "aborted")).err);
    assert.strictEqual(fs.readdirSync(dir).sort().join(), before, "aborted response removes only its own file");
    assert((await download(packageInfo, "stall")).err);
    const withSum = Object.assign({}, packageInfo); delete withSum.sha256;
    const checksumStall = await new Promise(function (resolve) {
      UC.downloadPackage({ files: { mac: withSum, sums: { url: "https://github.com/ominousopera/Downbeat/releases/download/v1.0.3/SHA256SUMS.txt" } } },
        { dir: dir, platform: "darwin", modules: { https: site("stall") } }, function (err) { resolve(err); });
    });
    assert(checksumStall && /checksum/.test(checksumStall.message));
    fs.writeFileSync(results[0].value.path, Buffer.alloc(bytes.length));
    assert(await verify(results[0].value), "same-size tampering is detected");
    fs.unlinkSync(results[1].value.path);
    assert(await verify(results[1].value), "missing retained packages cannot open");
    assert.strictEqual(fs.readFileSync(foreign, "utf8"), "owned by another attempt");
    console.log("ok - concurrent downloads, file ownership, aborts/timeouts and retained-file verification");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(function (err) { console.error(err); process.exitCode = 1; });
