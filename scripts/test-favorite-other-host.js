"use strict";
// A star the other host set shows in this panel's list as soon as a save
// here takes it in, and one click on it takes it off; a row drawn before
// that flips what it shows. Music and SFX. This panel and the other host
// are the real panel (panel-harness), each in its own Node process on one
// Documents/Downbeat; the clock is set by hand so the other host's change
// is the newer one.
// Run: node scripts/test-favorite-other-host.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HARNESS = path.join(__dirname, "panel-harness.js");

function rowStar(h, name) {
  const row = h.registry.libraryDisplay.children.find(function (x) {
    return /lib-row/.test(x.className || "") && x.children.some(function (c) {
      return /lib-row-main/.test(c.className || "") && c.children.some(function (n) { return n.textContent === name; });
    });
  });
  if (!row) { throw new Error("no row for " + name); }
  return row.children.find(function (x) { return /lib-fav/.test(x.className || ""); });
}
function click(star) {
  star._fire("click", { stopPropagation: function () {} });
}

// The other host: starts, stars two.wav and closes.
if (process.argv[2] === "other") {
  Date.now = function () { return Number(process.argv[4]); };
  const h = require(HARNESS).bootPanel({ docsDir: process.argv[3] });
  click(rowStar(h, "two.wav"));
  process.exit(0);
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label); } else { failures++; console.log("FAIL " + label + (detail ? " - " + detail : "")); }
}

// This panel, one case per process: "fresh" clicks one.wav first (its save
// takes in the other host's star), then two.wav's row as drawn now; "stale"
// clicks two.wav's row drawn before the other host's change.
if (process.argv[2] === "case") {
  const docs = process.argv[3], section = process.argv[4], mode = process.argv[5];
  const t0 = Number(process.argv[6]);
  const h = require(HARNESS).bootPanel({ docsDir: docs });
  const SL = window.BeatMarkerSoundLibrary;
  const two = path.join(docs, "two.wav");
  const label = section + ", " + mode + ": ";
  function disk() {
    return !!JSON.parse(fs.readFileSync(path.join(docs, "Downbeat", "sound-library.json"), "utf8")).files[two].fav;
  }
  function state() {
    return { memory: !!SL.getState().files[two].fav, shown: rowStar(h, "two.wav").getAttribute("aria-pressed"), disk: disk() };
  }
  const drawnBefore = rowStar(h, "two.wav");
  execFileSync(process.execPath, [__filename, "other", docs, String(t0 + 1000)], { stdio: "pipe", timeout: 20000 });
  Date.now = function () { return t0 + 2000; };
  if (mode === "fresh") {
    click(rowStar(h, "one.wav"));
    const s = state();
    check(label + "the other host's star shows after this panel's save", s.memory && s.shown === "true" && s.disk, JSON.stringify(s));
    Date.now = function () { return t0 + 3000; };
    click(rowStar(h, "two.wav"));
    const off = state();
    check(label + "one click takes it off (list, memory, file)", !off.memory && off.shown === "false" && !off.disk, JSON.stringify(off));
    check(label + "this panel's own star stays", !!SL.getState().files[path.join(docs, "one.wav")].fav);
  } else {
    click(drawnBefore);
    const on = state();
    check(label + "a row drawn before shows its star on after a click", on.memory && on.shown === "true" && on.disk, JSON.stringify(on));
    Date.now = function () { return t0 + 3000; };
    click(rowStar(h, "two.wav"));
    const off = state();
    check(label + "the next click takes it off", !off.memory && off.shown === "false" && !off.disk, JSON.stringify(off));
  }
  console.log("FAILURES " + failures);
  process.exit(0);
}

for (const section of ["music", "sfx"]) {
  for (const mode of ["fresh", "stale"]) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-favorite-other-"));
    try {
      const dir = path.join(work, "Downbeat");
      fs.mkdirSync(dir);
      const t0 = Date.now();
      const files = {};
      ["one.wav", "two.wav"].forEach(function (name) {
        const p = path.join(work, name);
        fs.writeFileSync(p, "fixture");
        files[p] = { path: p, name: name, section: section, status: "done", v: 3, nameChecked: 1, bpm: 120, updatedAt: t0 };
      });
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ language: "en", onboardingCompleted: true, updateCheck: false, librarySection: section }));
      fs.writeFileSync(path.join(dir, "sound-library.json"), JSON.stringify({
        version: 1, folders: { music: section === "music" ? [work] : [], sfx: section === "sfx" ? [work] : [] }, files: files
      }));
      const out = execFileSync(process.execPath, [__filename, "case", work, section, mode, String(t0)], { encoding: "utf8", timeout: 60000 });
      out.split("\n").forEach(function (line) {
        if (/^(ok|FAIL) /.test(line)) { console.log(line); }
        if (/^FAIL /.test(line)) { failures++; }
      });
      if (!/^FAILURES 0$/m.test(out)) {
        failures++;
        console.error("FAIL " + section + ", " + mode + ": the case did not finish cleanly");
      }
    } catch (e) {
      failures++;
      console.error("FAIL " + section + ", " + mode + ": " + (e && e.stderr ? e.stderr : e && e.stack || e));
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
}
if (failures) { console.error("\n" + failures + " check(s) failed"); process.exit(1); }
console.log("\nall favorite checks with the other host passed");
