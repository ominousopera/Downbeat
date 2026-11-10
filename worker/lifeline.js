// Ends a worker process that nobody waits for any more. The panel stops a
// worker itself when it runs past its time limit, but it cannot once its
// own process is gone (panel closed or reloaded, host quit or crashed): the
// worker would then run on, and a hung one forever, with its hand-off file
// left behind. Each worker entry script calls watch() first.
//
// The check runs on a thread of its own, because a stuck WebAssembly call
// blocks the worker's main thread and every timer on it. It ends the
// process when the process that started it is gone, or when the time limit
// the panel handed over (DOWNBEAT_WORKER_LIMIT_MS, a little longer than the
// panel's own) has passed. Before that it removes the hand-off files the
// panel named for this run (DOWNBEAT_WORKER_TEMP_FILES), and only those
// whose names Downbeat gives its own temp files.
//
// The thread is unref'd: a worker that finishes normally exits at once.
"use strict";

const pathMod = require("path");

// Must match OWN_TEMP_FILE_PATTERN in js/persistence.js.
const OWN_TEMP_FILE = /^((samples|beatthis|skey|library)-[0-9]+-[0-9]+\.raw|library-[0-9]+-[0-9]+\.json)$/;
const CHECK_EVERY_MS = 200;

const WATCHER = [
  "const { workerData: d } = require('worker_threads');",
  "const fs = require('fs');",
  "const started = Date.now();",
  "function parentGone() {",
  // POSIX: an orphan is handed to another parent at once. Windows keeps the
  // old number, so ask whether that process still runs.
  "  if (process.ppid !== d.ppid) { return true; }",
  "  try { process.kill(d.ppid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }",
  "}",
  "setInterval(function () {",
  "  if (!parentGone() && !(d.limitMs > 0 && Date.now() - started > d.limitMs)) { return; }",
  "  d.files.forEach(function (f) { try { fs.unlinkSync(f); } catch (e) { /* already gone */ } });",
  "  process.kill(d.pid, 'SIGKILL');",
  "}, " + CHECK_EVERY_MS + ");"
].join("\n");

function _handedOverFiles(env) {
  let list = [];
  try {
    list = JSON.parse(env.DOWNBEAT_WORKER_TEMP_FILES || "[]");
  } catch (e) {
    list = [];
  }
  if (!Array.isArray(list)) { return []; }
  return list.filter(function (f) {
    return typeof f === "string" && pathMod.isAbsolute(f) && OWN_TEMP_FILE.test(pathMod.basename(f));
  });
}

function watch() {
  let threads;
  try {
    threads = require("worker_threads");
  } catch (e) {
    return; // no threads: the panel's own time limit still applies while it runs
  }
  if (!threads.isMainThread) { return; }
  try {
    const watcher = new threads.Worker(WATCHER, {
      eval: true,
      workerData: {
        pid: process.pid,
        ppid: process.ppid,
        limitMs: Number(process.env.DOWNBEAT_WORKER_LIMIT_MS) || 0,
        files: _handedOverFiles(process.env)
      }
    });
    watcher.on("error", function () { /* the panel's own time limit still applies */ });
    watcher.unref();
  } catch (e) {
    // Without the watcher the worker runs on its own, under the panel's limit.
  }
}

module.exports = { watch: watch, _handedOverFiles: _handedOverFiles, OWN_TEMP_FILE: OWN_TEMP_FILE };
