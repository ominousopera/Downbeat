// The panel's two bridges: calls into the host (jsx/host.jsx through
// evalScript, arguments ASCII-escaped, one { ok, error, data } shape) and the
// analysis workers (essentia, Beat This!, S-KEY) run under the bundled Node
// with time limits that grow with the audio.
(function (global) {
  "use strict";

  // Worker processes still running, each with the hand-off files it was
  // given. Kept for the whole panel (the Library scan starts its own), so
  // closing or reloading the panel can stop them and remove their files:
  // nothing would wait for them any more.
  var _runningWorkers = [];
  // A worker also gets the time limit itself (worker/lifeline.js), so it
  // ends even when the panel cannot stop it any more. A little longer than
  // the panel's own, which comes first and is reported as a time-out.
  var WORKER_OWN_LIMIT_MARGIN_MS = 10000;

  // The panel's environment plus the worker's own limit and hand-off files.
  // undefined (inherit the environment as it is) if it cannot be read; the
  // worker then still ends when the panel's process is gone.
  function workerEnv(limitMs, tempFiles) {
    try {
      var current = window.cep_node.require("process").env;
      var env = {};
      for (var name in current) {
        if (Object.prototype.hasOwnProperty.call(current, name)) { env[name] = current[name]; }
      }
      env.DOWNBEAT_WORKER_LIMIT_MS = String((limitMs || 0) + WORKER_OWN_LIMIT_MARGIN_MS);
      env.DOWNBEAT_WORKER_TEMP_FILES = JSON.stringify(tempFiles || []);
      return env;
    } catch (e) {
      return undefined;
    }
  }

  // Remembers a started worker until it ends; returns the call that forgets it.
  function trackWorker(child, tempFiles) {
    var entry = { child: child, files: (tempFiles || []).slice() };
    _runningWorkers.push(entry);
    return function () {
      var i = _runningWorkers.indexOf(entry);
      if (i !== -1) { _runningWorkers.splice(i, 1); }
    };
  }

  function _stopAllWorkers() {
    var fs = null;
    try { fs = window.cep_node.require("fs"); } catch (e) { fs = null; }
    _runningWorkers.splice(0).forEach(function (entry) {
      try {
        if (entry.child && typeof entry.child.kill === "function") { entry.child.kill(); }
      } catch (e) {
        // Already ended.
      }
      entry.files.forEach(function (f) {
        try { if (fs) { fs.unlinkSync(f); } } catch (e) { /* swept at a later start */ }
      });
    });
  }
  if (typeof global.addEventListener === "function") {
    global.addEventListener("pagehide", _stopAllWorkers);
    global.addEventListener("unload", _stopAllWorkers);
  }

  // "Mac" / "Windows" when the package holds only another platform's Node.
  function _otherPlatformRuntime(fs, extensionRoot) {
    try {
      var hasMac = fs.existsSync(extensionRoot + "/runtime/node/darwin-arm64") || fs.existsSync(extensionRoot + "/runtime/node/darwin-x64");
      var hasWin = fs.existsSync(extensionRoot + "/runtime/node/win-x64");
      var onWin = window.cep_node.require("os").platform() === "win32";
      if (onWin && hasMac && !hasWin) { return "Mac"; }
      if (!onWin && hasWin && !hasMac) { return "Windows"; }
    } catch (e) {
      // Fall back to the general message.
    }
    return null;
  }
  // Why a worker could not start at all (Node's ENOENT for the program).
  // Each package carries only its own platform's Node: the Mac package
  // installed on Windows (or the other way round) lands here.
  function missingRuntimeReason(fs, os, extensionRoot, triedExecutable) {
    var other = _otherPlatformRuntime(fs, extensionRoot);
    if (other) {
      return "this is the " + other + " package of Downbeat - install the " +
        (os.platform() === "win32" ? "Windows (-win.zxp)" : "Mac (-mac.zxp)") + " package on this computer instead.";
    }
    return "could not find a Node.js executable to run essentia in (tried: " + triedExecutable +
      "). This plugin bundles its own Node.js runtime for supported platforms (macOS Intel/Apple " +
      "Silicon, Windows x64) - seeing this error means either the install is corrupted/incomplete, or " +
      "this is an unsupported platform/architecture (e.g. Windows on ARM, Linux) where it fell back to " +
      "looking for a system-installed Node.js and found none either - install it from nodejs.org in " +
      "that case.";
  }

  // Preserve process status even when a worker exits without stderr.
  // A signal alone does not identify whether memory pressure or another
  // process stopped it.
  function workerFailureDetails(err) {
    var parts = [];
    if (err.code !== undefined && err.code !== null) { parts.push("code=" + err.code); }
    if (err.signal) { parts.push("signal=" + err.signal); }
    if (err.killed) { parts.push("killed=true"); }
    return parts.length ? " [" + parts.join(", ") + "]" : "";
  }

  // Starts one worker with the options every worker gets: no console window
  // on Windows, the panel's time limit, and the worker's own (above).
  // done(err, stdout, stderr, timedOut) is called once, also when the
  // system refuses the start at once (EPERM, EBUSY, UNKNOWN: an antivirus,
  // a blocked node.exe), where Node throws instead of calling back.
  function startWorker(executable, args, opts, done) {
    var started = Date.now();
    var forget = null;
    var finished = false;
    function finish(err, stdout, stderr) {
      if (finished) { return; }
      finished = true;
      if (forget) { forget(); }
      var timedOut = !!(err && (err.killed || (opts.timeoutMs > 0 && Date.now() - started >= opts.timeoutMs)));
      done(err, stdout, stderr, timedOut);
    }
    var child;
    try {
      child = window.cep_node.require("child_process").execFile(executable, args, {
        maxBuffer: opts.maxBuffer,
        timeout: opts.timeoutMs,
        windowsHide: true,
        env: workerEnv(opts.timeoutMs, opts.tempFiles)
      }, finish);
    } catch (spawnErr) {
      finish(spawnErr, "", "");
      return null;
    }
    if (!finished) { forget = trackWorker(child, opts.tempFiles); }
    return child;
  }

  // ctx - csInterface, the only thing this part needs from main.js.
  function create(ctx) {
    var csInterface = ctx.csInterface;
    // Escapes every non-ASCII character as \uXXXX, the way js/place.js sends
    // marker labels, so a file path in any language (Cyrillic folder names,
    // accents) reaches the host unchanged whatever encoding evalScript uses.
    function _asciiOnly(text) {
      return text.replace(/[\u007f-\uffff]/g, function (c) {
        return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
      });
    }
    // A string literal holding the value's JSON (the host JSON.parses it).
    function _jsxJsonArg(value) {
      return JSON.stringify(_asciiOnly(JSON.stringify(value)));
    }
    // A plain string literal.
    function _jsxStringArg(text) {
      return _asciiOnly(JSON.stringify(String(text)));
    }
    // Runs an ExtendScript expression. Every jsx/host.jsx function returns
    // { ok, error, data } as JSON; resolves with `data`, rejects with the
    // error text.
    function evalJson(script) {
      return new Promise(function (resolve, reject) {
        csInterface.evalScript(script, function (rawResult) {
          if (rawResult === "EvalScript error.") {
            reject("The host script could not run.");
            return;
          }
          var parsed;
          try {
            parsed = JSON.parse(rawResult);
          } catch (e) {
            // "{: ,: ,: }" - keys and values gone: the host's own
            // JSON.stringify is broken. In After Effects every panel and
            // script shares one script engine, so something else loaded
            // there can spoil it; restarting the host clears it.
            if (/^\{\s*(:\s*,\s*)*:\s*\}$/.test(String(rawResult))) {
              reject("The host's script engine answered unreadably (its JSON is broken, often by another script or extension). Restart " +
                (csInterface.getHostEnvironment && csInterface.getHostEnvironment().appName === "AEFT" ? "After Effects" : "Premiere Pro") + " and try again.");
              return;
            }
            reject("Could not parse JSX response as JSON: " + e.message + " (raw: " + rawResult + ")");
            return;
          }
          if (!parsed.ok) {
            reject(parsed.error);
            return;
          }
          resolve(parsed.data);
        });
      });
    }
    function getClipInfo() {
      return evalJson("getSelectedAudioInfo()");
    }
    // Node lookup. A GUI app started from Finder or the Dock does not inherit
    // the shell's PATH, so a Node that `which node` finds in Terminal (e.g.
    // /opt/homebrew/bin/node) may be invisible to the panel. Order: the
    // bundled runtime, then well-known install locations, then plain "node"
    // from PATH.
    var _cachedNodeExecutable = null;
    // Path of the Node binary bundled in runtime/node/<platform>-<arch>/, or
    // null when this platform has no bundled build or the file is missing.
    function _bundledNodePath(fs, os, extensionRoot) {
      var platform = os.platform(); // "darwin" | "win32" (Node's own naming, even on 64-bit Windows)
      var arch = os.arch(); // "arm64" | "x64"
      var platformArch = null;
      if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
        platformArch = "darwin-" + arch;
      } else if (platform === "win32" && arch === "x64") {
        platformArch = "win-x64";
      }
      if (!platformArch) {
        return null; // no bundled build for this platform/arch - falls through to the candidate list below
      }
      var fileName = platform === "win32" ? "node.exe" : "node";
      var candidate = extensionRoot + "/runtime/node/" + platformArch + "/" + fileName;
      try {
        return fs.existsSync(candidate) ? candidate : null;
      } catch (e) {
        return null;
      }
    }
    function _resolveNodeExecutable(fs, os, extensionRoot) {
      if (_cachedNodeExecutable) {
        return _cachedNodeExecutable;
      }
      var bundled = _bundledNodePath(fs, os, extensionRoot);
      if (bundled) {
        _cachedNodeExecutable = bundled;
        return _cachedNodeExecutable;
      }
      var candidates = [
        "/opt/homebrew/bin/node", // Homebrew, Apple Silicon
        "/usr/local/bin/node", // Homebrew Intel, or the official Node.js macOS installer
        "/opt/local/bin/node", // MacPorts
        "C:\\Program Files\\nodejs\\node.exe" // official Node.js Windows installer default
      ];
      for (var i = 0; i < candidates.length; i++) {
        try {
          if (fs.existsSync(candidates[i])) {
            _cachedNodeExecutable = candidates[i];
            return _cachedNodeExecutable;
          }
        } catch (e) {
        // Keep checking the rest of the list.
        }
      }
      _cachedNodeExecutable = "node"; // last resort: look "node" up on PATH
      return _cachedNodeExecutable;
    }
    // How many worker handoff temp files are in use right now. The Settings
    // "Delete my data" button refuses while this is above zero, so it can
    // never pull a file out from under a running analysis.
    var _tempFilesInFlight = 0;
    // Timeout for a worker: a base that still catches a real hang quickly on
    // short clips, plus one extra second per second of audio.
    function _workerTimeoutMs(baseMs, audioSeconds) {
      return baseMs + Math.max(0, Math.round((audioSeconds || 0) * 1000));
    }

    // Writes one hand-off file under a new name in the temp folder
    // (getTempDir). A write that fails
    // half-way (a full disk) removes its own partial file at once instead of
    // leaving tens of MB until a start six hours later; a name that was
    // already taken is never written or removed.
    function _writeHandOff(fs, file, data) {
      try {
        fs.writeFileSync(file, data, { flag: "wx" });
      } catch (e) {
        if (!e || e.code !== "EEXIST") {
          try { fs.unlinkSync(file); } catch (e2) { /* nothing was written */ }
        }
        throw e;
      }
    }
    // Runs worker/analyze-worker.js (essentia.js: beat, key and onset
    // detection) in a separate OS process through window.cep_node's
    // child_process, instead of loading essentia's WASM into the panel's own
    // context (see that worker's header for why). The mono samples are
    // handed over in a temp file from getTempDir() (never inside the
    // extension's own folder: that would break the .zxp signature), deleted
    // when the worker exits. Resolves with the worker's `data`.
    function runAnalyzeWorker(mode, monoSamples, audioPath, tempoConstraint, keyMaterialArg) {
      return new Promise(function (resolve, reject) {
        try {
          // Node.js is enabled by the --enable-nodejs flag in CSXS/manifest.xml.
          if (!window.cep_node) {
            reject(new Error("Node.js is not available in this panel. Reinstall the extension."));
            return;
          }
          var fs = window.cep_node.require("fs");
          var os = window.cep_node.require("os");
          var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
          var tmpDir = window.BeatMarkerPersistence.getTempDir(csInterface);
          var tmpFile = tmpDir + "/samples-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
          _writeHandOff(fs, tmpFile, monoSamples);
          _tempFilesInFlight++;
          var workerPath = extensionRoot + "/worker/analyze-worker.js";
          var args = [workerPath, mode, tmpFile];
          if (audioPath || tempoConstraint) {
            args.push(audioPath || "");
          }
          if (tempoConstraint) {
            args.push(JSON.stringify(tempoConstraint));
          }
          if (keyMaterialArg) {
            // "key" mode only: positional argument 7 (see the usage line in
            // analyze-worker.js); the arguments in between are unused there.
            args = [workerPath, mode, tmpFile, "", "", "", keyMaterialArg];
          }
          var timeoutMs = _workerTimeoutMs(60000, monoSamples.length / window.BeatMarkerAudio.TARGET_SAMPLE_RATE);
          startWorker(
            _resolveNodeExecutable(fs, os, extensionRoot),
            args,
            { maxBuffer: 80 * 1024 * 1024, timeoutMs: timeoutMs, tempFiles: [tmpFile] },
            function (err, stdout, stderr, timedOut) {
              _tempFilesInFlight--;
              try {
                fs.unlinkSync(tmpFile);
              } catch (cleanupErr) {
              // Best-effort - a leftover temp file isn't worth failing the
              // whole call over; clearLeftoverTempFiles() sweeps any that
              // survive on the next panel start.
              }
              if (err) {
                var reason;
                if (timedOut) {
                  reason = "timed out after " + Math.round(timeoutMs / 1000) + "s (essentia may be hanging)";
                } else if (err.code === "ENOENT") {
                  reason = missingRuntimeReason(fs, os, extensionRoot, _cachedNodeExecutable);
                } else {
                  reason = err.message || String(err);
                }
                reject(new Error(
                  "analyze-worker (" + mode + ") failed: " + reason + workerFailureDetails(err) +
                  (stderr ? " | stderr: " + String(stderr).slice(0, 500) : "")
                ));
                return;
              }
              var parsed;
              try {
                parsed = JSON.parse(stdout);
              } catch (parseErr) {
                reject(new Error("analyze-worker (" + mode + ") returned invalid JSON: " + parseErr.message));
                return;
              }
              if (!parsed.ok) {
                reject(new Error(parsed.error || ("analyze-worker (" + mode + ") reported failure")));
                return;
              }
              resolve(parsed.data);
            }
          );
        } catch (e) {
          reject(e);
        }
      });
    }
    // `samples22050` must already be resampled to 22050 Hz (js/audio.js's
    // resampleMono()); the worker does no resampling itself. `gridBeats`
    // (optional): the beats of the grid on screen, handed over in a second
    // file of the same name pattern (a long song's beats are too long for a
    // Windows command line); the worker then also counts the bars on them
    // (gridBars).
    function runBeatThisWorker(samples22050, gridBeats) {
      return new Promise(function (resolve, reject) {
        try {
          if (!window.cep_node) {
            reject(new Error("Node.js is not available in this panel. Reinstall the extension."));
            return;
          }
          var fs = window.cep_node.require("fs");
          var os = window.cep_node.require("os");
          var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
          var tmpDir = window.BeatMarkerPersistence.getTempDir(csInterface);
          var tmpFile = tmpDir + "/beatthis-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
          _writeHandOff(fs, tmpFile, samples22050);
          _tempFilesInFlight++;
          var gridFile = null;
          if (gridBeats && gridBeats.length) {
            try {
              gridFile = tmpDir + "/beatthis-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
              _writeHandOff(fs, gridFile, new Float64Array(gridBeats));
            } catch (gridErr) {
              // Only the grid's bars are lost; Beat This! still runs.
              gridFile = null;
            }
          }
          var workerPath = extensionRoot + "/worker/beatthis-worker.js";
          var btTimeoutMs = _workerTimeoutMs(120000, samples22050.length / 22050);
          startWorker(
            _resolveNodeExecutable(fs, os, extensionRoot),
            gridFile ? [workerPath, tmpFile, gridFile] : [workerPath, tmpFile],
            // A longer base limit than the essentia worker's (120 s against
            // 60 s): WASM inference over a whole track is slower.
            { maxBuffer: 80 * 1024 * 1024, timeoutMs: btTimeoutMs, tempFiles: gridFile ? [tmpFile, gridFile] : [tmpFile] },
            function (err, stdout, stderr, timedOut) {
              _tempFilesInFlight--;
              try {
                fs.unlinkSync(tmpFile);
              } catch (cleanupErr) {
              // Best-effort, same reasoning as runAnalyzeWorker() above.
              }
              try {
                if (gridFile) { fs.unlinkSync(gridFile); }
              } catch (gridCleanupErr) {
                // Best-effort as well.
              }
              if (err) {
                var reason = timedOut
                  ? "timed out after " + Math.round(btTimeoutMs / 1000) + "s"
                  : (err.message || String(err));
                reject(new Error("beatthis-worker failed: " + reason + workerFailureDetails(err) + (stderr ? " | stderr: " + String(stderr).slice(0, 500) : "")));
                return;
              }
              var parsed;
              try {
                parsed = JSON.parse(stdout);
              } catch (parseErr) {
                reject(new Error("beatthis-worker returned invalid JSON: " + parseErr.message));
                return;
              }
              if (!parsed.ok) {
                reject(new Error(parsed.error || "beatthis-worker reported failure"));
                return;
              }
              resolve(parsed.data);
            }
          );
        } catch (e) {
          reject(e);
        }
      });
    }
    // S-KEY (worker/skey-worker.js): the third key opinion, Music mode only.
    // Same temp-file handoff as runBeatThisWorker(): 22050 Hz samples.
    function runSkeyWorker(samples22050) {
      return new Promise(function (resolve, reject) {
        try {
          if (!window.cep_node) {
            reject(new Error("Node.js is not available in this panel. Reinstall the extension."));
            return;
          }
          var fs = window.cep_node.require("fs");
          var os = window.cep_node.require("os");
          var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
          var tmpDir = window.BeatMarkerPersistence.getTempDir(csInterface);
          var tmpFile = tmpDir + "/skey-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
          _writeHandOff(fs, tmpFile, samples22050);
          _tempFilesInFlight++;
          var workerPath = extensionRoot + "/worker/skey-worker.js";
          var skeyTimeoutMs = _workerTimeoutMs(60000, samples22050.length / 22050 / 2);
          startWorker(
            _resolveNodeExecutable(fs, os, extensionRoot),
            [workerPath, tmpFile],
            { maxBuffer: 80 * 1024 * 1024, timeoutMs: skeyTimeoutMs, tempFiles: [tmpFile] },
            function (err, stdout, stderr, timedOut) {
              _tempFilesInFlight--;
              try {
                fs.unlinkSync(tmpFile);
              } catch (cleanupErr) {
              // Best-effort, same reasoning as runAnalyzeWorker() above.
              }
              if (err) {
                var reason = timedOut
                  ? "timed out after " + Math.round(skeyTimeoutMs / 1000) + "s"
                  : (err.message || String(err));
                reject(new Error("skey-worker failed: " + reason + workerFailureDetails(err) + (stderr ? " | stderr: " + String(stderr).slice(0, 500) : "")));
                return;
              }
              var parsed;
              try {
                parsed = JSON.parse(stdout);
              } catch (parseErr) {
                reject(new Error("skey-worker returned invalid JSON: " + parseErr.message));
                return;
              }
              if (!parsed.ok) {
                reject(new Error(parsed.error || "skey-worker reported failure"));
                return;
              }
              resolve(parsed.data);
            }
          );
        } catch (e) {
          reject(e);
        }
      });
    }
    // For main.js: how many temp files are in use (Delete my data waits on
    // it), the same count for the Library's own scan files, and which Node
    // executable the workers run under (shown in the diagnostics log).
    function tempFilesInFlight() {
      return _tempFilesInFlight;
    }
    function tempFileStarted() {
      _tempFilesInFlight++;
    }
    function tempFileDone() {
      _tempFilesInFlight--;
    }
    function nodeExecutable() {
      return _cachedNodeExecutable;
    }
    return {
      evalJson: evalJson,
      getClipInfo: getClipInfo,
      jsxJsonArg: _jsxJsonArg,
      jsxStringArg: _jsxStringArg,
      resolveNodeExecutable: _resolveNodeExecutable,
      runAnalyzeWorker: runAnalyzeWorker,
      runBeatThisWorker: runBeatThisWorker,
      runSkeyWorker: runSkeyWorker,
      tempFilesInFlight: tempFilesInFlight,
      tempFileStarted: tempFileStarted,
      tempFileDone: tempFileDone,
      nodeExecutable: nodeExecutable
    };
  }

  // The worker helpers are also used by the Library scan (js/library-tab.js).
  global.BeatMarkerBridge = { create: create, workerEnv: workerEnv, trackWorker: trackWorker, workerFailureDetails: workerFailureDetails,
    missingRuntimeReason: missingRuntimeReason };
})(window);
