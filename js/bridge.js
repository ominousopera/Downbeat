// The panel's two bridges: calls into the host (jsx/host.jsx through
// evalScript, arguments ASCII-escaped, one { ok, error, data } shape) and the
// analysis workers (essentia, Beat This!, S-KEY) run under the bundled Node
// with time limits that grow with the audio.
(function (global) {
  "use strict";
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
    // Number of temp files currently in use by running workers (see
    // tempFilesInFlight()).
    var _tempFilesInFlight = 0;
    // Timeout for a worker: a base that still catches a real hang quickly on
    // short clips, plus one extra second per second of audio.
    function _workerTimeoutMs(baseMs, audioSeconds) {
      return baseMs + Math.max(0, Math.round((audioSeconds || 0) * 1000));
    }

    // Runs worker/analyze-worker.js (essentia.js: beat, key and onset
    // detection) in a separate OS process through window.cep_node's
    // child_process, instead of loading essentia's WASM into the panel's own
    // context (see that worker's header for why). The mono samples are
    // handed over in a temp file, which is deleted when the worker exits.
    // Resolves with the worker's `data`.
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
          var childProcess = window.cep_node.require("child_process");
          var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
          var tmpDir = window.BeatMarkerPersistence.getTempDir(csInterface);
          var tmpFile = tmpDir + "/samples-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
          fs.writeFileSync(tmpFile, monoSamples);
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
          childProcess.execFile(
            _resolveNodeExecutable(fs, os, extensionRoot),
            args,
            { maxBuffer: 80 * 1024 * 1024, timeout: timeoutMs },
            function (err, stdout, stderr) {
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
                if (err.killed) {
                  reason = "timed out after " + Math.round(timeoutMs / 1000) + "s (essentia may be hanging)";
                } else if (err.code === "ENOENT" && _otherPlatformRuntime(fs, extensionRoot)) {
                  reason = "this is the " + _otherPlatformRuntime(fs, extensionRoot) + " package of Downbeat - install the " +
                    (os.platform() === "win32" ? "Windows (-win.zxp)" : "Mac (-mac.zxp)") + " package on this computer instead.";
                } else if (err.code === "ENOENT") {
                  reason = "could not find a Node.js executable to run essentia in (tried: " + _cachedNodeExecutable +
                    "). This plugin bundles its own Node.js runtime for supported platforms (macOS Intel/Apple " +
                    "Silicon, Windows x64) - seeing this error means either the install is corrupted/incomplete, or " +
                    "this is an unsupported platform/architecture (e.g. Windows on ARM, Linux) where it fell back to " +
                    "looking for a system-installed Node.js and found none either - install it from nodejs.org in " +
                    "that case.";
                } else {
                  reason = err.message || String(err);
                }
                reject(new Error(
                  "analyze-worker (" + mode + ") failed: " + reason +
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
    // resampleMono()); the worker does no resampling itself.
    function runBeatThisWorker(samples22050) {
      return new Promise(function (resolve, reject) {
        try {
          if (!window.cep_node) {
            reject(new Error("Node.js is not available in this panel. Reinstall the extension."));
            return;
          }
          var fs = window.cep_node.require("fs");
          var os = window.cep_node.require("os");
          var childProcess = window.cep_node.require("child_process");
          var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
          var tmpDir = window.BeatMarkerPersistence.getTempDir(csInterface);
          var tmpFile = tmpDir + "/beatthis-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
          fs.writeFileSync(tmpFile, samples22050);
          _tempFilesInFlight++;

          var workerPath = extensionRoot + "/worker/beatthis-worker.js";
          var btTimeoutMs = _workerTimeoutMs(120000, samples22050.length / 22050);
          childProcess.execFile(
            _resolveNodeExecutable(fs, os, extensionRoot),
            [workerPath, tmpFile],
            { maxBuffer: 80 * 1024 * 1024, timeout: btTimeoutMs },
            function (err, stdout, stderr) {
              _tempFilesInFlight--;
              try {
                fs.unlinkSync(tmpFile);
              } catch (cleanupErr) {
                // Best-effort, same reasoning as runAnalyzeWorker() above.
              }
              if (err) {
                var reason = err.killed
                  ? "timed out after " + Math.round(btTimeoutMs / 1000) + "s"
                  : (err.message || String(err));
                reject(new Error("beatthis-worker failed: " + reason + (stderr ? " | stderr: " + String(stderr).slice(0, 500) : "")));
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
          var childProcess = window.cep_node.require("child_process");
          var extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
          var tmpDir = window.BeatMarkerPersistence.getTempDir(csInterface);
          var tmpFile = tmpDir + "/skey-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".raw";
          fs.writeFileSync(tmpFile, samples22050);
          _tempFilesInFlight++;

          var workerPath = extensionRoot + "/worker/skey-worker.js";
          var skeyTimeoutMs = _workerTimeoutMs(60000, samples22050.length / 22050 / 2);
          childProcess.execFile(
            _resolveNodeExecutable(fs, os, extensionRoot),
            [workerPath, tmpFile],
            { maxBuffer: 80 * 1024 * 1024, timeout: skeyTimeoutMs },
            function (err, stdout, stderr) {
              _tempFilesInFlight--;
              try {
                fs.unlinkSync(tmpFile);
              } catch (cleanupErr) {
                // Best-effort, same reasoning as runAnalyzeWorker() above.
              }
              if (err) {
                var reason = err.killed
                  ? "timed out after " + Math.round(skeyTimeoutMs / 1000) + "s"
                  : (err.message || String(err));
                reject(new Error("skey-worker failed: " + reason + (stderr ? " | stderr: " + String(stderr).slice(0, 500) : "")));
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

  global.BeatMarkerBridge = { create: create };
})(window);
