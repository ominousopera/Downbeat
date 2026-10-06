// The built-in self-test: runs every feature on the selected clip through
// real button clicks and prints a PASS / FAIL summary in the log. Its button
// (#runSelfTestBtn) stays in the DOM, hidden, and is clicked by
// scripts/test-self-test.js and by developers.
(function (global) {
  "use strict";
  // ctx - log, getPluginVersion and resetResults (clears main.js's last
  // analysis and key before a run), and a getter for every button, display
  // and piece of state of main.js that the self-test clicks or reads. Getters
  // are used so each value is looked up when needed, not captured early.
  function create(ctx) {
    var log = ctx.log;
    var getPluginVersion = ctx.getPluginVersion;
    var _resetResultsForSelfTest = ctx.resetResults;
    // Cheap, stateless calls (get info, place test markers) run twice as a
    // consistency check; Detect key runs twice as a determinism check (the
    // same audio should yield the same key both times). Sequenced by polling
    // each button's own `disabled` flag rather than duplicating each
    // handler's promise chain: handlers set `disabled = true` synchronously
    // as their first line, so polling is safe right after .click().
    function _clickAndWaitForButton(btn, label) {
      return new Promise(function (resolve) {
        log("SELF-TEST: " + label + "...");
        btn.click();
        var checkInterval = setInterval(function () {
          if (!btn.disabled) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 150);
      });
    }
    // Builds one line of the closing summary, scannable at a glance and easy
    // to parse from a pasted log. status: "ok" | "fail" | "skip".
    function _summaryLine(status, label, detail) {
      var icon = status === "ok" ? "PASS" : (status === "fail" ? "FAIL" : "SKIP");
      log("  [" + icon + "] " + label + (detail ? " - " + detail : ""));
    }
    function _summaryFromResult(label, result, detail) {
      var status = result === "ok" ? "ok" : (result === "skip" || result === null ? "skip" : "fail");
      _summaryLine(status, label, detail || (result === null ? "did not run - see the log above." : ""));
    }

    var runSelfTestBtn = document.getElementById("runSelfTestBtn");
    runSelfTestBtn.addEventListener("click", function () {
      runSelfTestBtn.disabled = true;
      _resetResultsForSelfTest();
      var _selfTestManualBpmResult = null, _selfTestManualBpmDetail = "";
      var _selfTestRetempoResult = null, _selfTestRetempoDetail = "";
      var _selfTestKeyOverrideResult = null, _selfTestKeyOverrideDetail = "";
      var _selfTestCutDownbeatsResult = null, _selfTestCutDownbeatsDetail = "";
      var _selfTestCopyPasteResult = null, _selfTestCopyPasteDetail = "";
      var _selfTestKeyMultiNotationResult = null, _selfTestKeyMultiNotationDetail = "";
      var _selfTestBeatThisResult = null; // set by the Beat This! block below, read by the summary
      var _selfTestBeatThisDetail = "";
      log("=== SELF-TEST START (" + new Date().toLocaleTimeString() + ") ===");
      log("Plugin version " + getPluginVersion() + " | host " + ctx.csInterface().getHostEnvironment().appName);
      log("SELF-TEST: Library tab (Add folder, scan, Insert) is not part of this test: Add folder opens a native dialog. Try it by hand.");
      _clickAndWaitForButton(ctx.testEssentiaBtn(), "Test essentia (synthetic signal, isolates essentia from file read/decode)")
        .then(function () { return _clickAndWaitForButton(ctx.getInfoBtn(), "Get selected audio info (run 1)"); })
        .then(function () { return _clickAndWaitForButton(ctx.getInfoBtn(), "Get selected audio info (run 2, consistency check)"); })
        .then(function () { return _clickAndWaitForButton(ctx.placeTestBtn(), "Place test cuesheet markers (run 1)"); })
        .then(function () { return _clickAndWaitForButton(ctx.placeTestBtn(), "Place test cuesheet markers (run 2, consistency check)"); })
        .then(function () { return _clickAndWaitForButton(ctx.clearMarkersBtn(), "Clear test cuesheet markers (cleanup before the real analysis below)"); })
        .then(function () {
          document.getElementById("manualBpmInput").value = "120";
          return _clickAndWaitForButton(ctx.manualBpmBtn(), "Set BPM (manual/synthetic grid path, 120 BPM)").then(function () {
            var ok = !!(ctx.lastAnalysis() && ctx.lastAnalysis().manualBpm === true && ctx.lastAnalysis().beatsArray && ctx.lastAnalysis().beatsArray.length > 0);
            _selfTestManualBpmResult = ok ? "ok" : "fail";
            _selfTestManualBpmDetail = ok
              ? ctx.lastAnalysis().beatsArray.length + " synthetic beats built at 120 BPM"
              : "lastAnalysis.manualBpm / beatsArray not set after the click.";
          });
        })
        .then(function () { return _clickAndWaitForButton(ctx.analyzeBtn(), "Analyze selected audio (full pipeline, run once - expensive)"); })
        .then(function () { return _clickAndWaitForButton(ctx.placeMarkersBtn(), "Place markers (downbeats, plus the beat grid if chosen)"); })
        .then(function () {
          // Beat This!: Analyze applies it by itself on every track (see
          // _runBeatThisOnCurrentAnalysis()), so the Analyze click above
          // already exercised the worker, the count-ratio and logit guards
          // and the native downbeats. This checks the other half: the
          // one-click revert to essentia's grid, and re-applying after a
          // revert, ending in the applied state Analyze left.
          if (!ctx.lastAnalysis()) {
            _selfTestBeatThisResult = null;
            return null;
          }
          if (ctx.lastAnalysis().beatThisRejected) {
            _selfTestBeatThisResult = "reject";
            log("SELF-TEST: Beat This! was not applied on this clip - see the \"Alternative analysis: ...\" line above for why (a guard rejection is expected).");
            return null;
          }
          if (!ctx.lastAnalysis().beatThisApplied) {
            _selfTestBeatThisResult = "fail-not-run";
            _selfTestBeatThisDetail = "Analyze finished but Beat This! neither applied nor was rejected - check the log for an error.";
            return null;
          }
          var beatsApplied = ctx.lastAnalysis().beatsArray;
          var beatsEssentia = ctx.lastAnalysis()._preBeatThisSnapshot ? ctx.lastAnalysis()._preBeatThisSnapshot.beatsArray : null;
          return _clickAndWaitForButton(ctx.beatThisBtn(), "Beat This! - revert to the original analysis")
            .then(function () {
              var revertedCleanly = !ctx.lastAnalysis().beatThisApplied && !!beatsEssentia &&
                ctx.lastAnalysis().beatsArray.length === beatsEssentia.length &&
                ctx.lastAnalysis().beatsArray[0] === beatsEssentia[0];
              if (!revertedCleanly) {
                _selfTestBeatThisResult = "fail-revert";
                _selfTestBeatThisDetail = "revert did not restore essentia's grid exactly.";
                return null;
              }
              return _clickAndWaitForButton(ctx.beatThisBtn(), "Beat This! - apply again after the revert")
                .then(function () {
                  var reapplied = !!ctx.lastAnalysis().beatThisApplied && ctx.lastAnalysis().beatsArray.length === beatsApplied.length;
                  _selfTestBeatThisResult = reapplied ? "ok" : "fail-reapply";
                  _selfTestBeatThisDetail = "applied " + beatsApplied.length + " beats automatically, reverted to essentia's " +
                    beatsEssentia.length + ", re-applied " + ctx.lastAnalysis().beatsArray.length;
                });
            });
        })
        .then(function () {
          // Runs half then double. This is not an exact round trip (halving
          // drops every other beat, doubling inserts midpoints), so the check
          // is loose: each click must produce some valid, non-empty grid.
          // lastAnalysis stays modified but valid, which is enough for the
          // steps that follow.
          if (!ctx.lastAnalysis() || !ctx.lastAnalysis().beatsArray || ctx.lastAnalysis().beatsArray.length < 2) {
            _selfTestRetempoResult = "skip";
            _selfTestRetempoDetail = "no valid lastAnalysis to retempo (Analyze above must have failed - see its own summary line).";
            return null;
          }
          var countBeforeHalf = ctx.lastAnalysis().beatsArray.length;
          return _clickAndWaitForButton(ctx.retempoHalfBtn(), "½x retempo").then(function () {
            var countAfterHalf = ctx.lastAnalysis() && ctx.lastAnalysis().beatsArray ? ctx.lastAnalysis().beatsArray.length : 0;
            return _clickAndWaitForButton(ctx.retempoDoubleBtn(), "2x retempo (back up, not an exact round-trip - see comment above)").then(function () {
              var countAfterDouble = ctx.lastAnalysis() && ctx.lastAnalysis().beatsArray ? ctx.lastAnalysis().beatsArray.length : 0;
              var ok = countAfterHalf > 0 && countAfterDouble > 0;
              _selfTestRetempoResult = ok ? "ok" : "fail";
              _selfTestRetempoDetail = countBeforeHalf + " beats -> ½x -> " + countAfterHalf + " beats -> 2x -> " + countAfterDouble + " beats";
            });
          });
        })
        .then(function () { return _clickAndWaitForButton(ctx.detectKeyBtn(), "Detect key (run 1)"); })
        .then(function () { return _clickAndWaitForButton(ctx.detectKeyBtn(), "Detect key (run 2, determinism check)"); })
        .then(function () {
          // Key override: keyOverrideInput has no default value, so it is
          // pre-filled with a valid Camelot code or the guard rejects it. The
          // override overwrites lastKeyResult wholesale (the perProfile and
          // witness fields are lost), which would break the shared "Detect
          // key + multi-notation..." summary line below. So this step records
          // its own pass/fail immediately, then runs detectKeyBtn again to
          // restore real detection data before the summary reads
          // lastKeyResult.
          document.getElementById("keyOverrideInput").value = "8A";
          return _clickAndWaitForButton(document.getElementById("applyKeyOverrideBtn"), "Key override (manual '8A')").then(function () {
            var ok = !!(ctx.lastKeyResult() && ctx.lastKeyResult().camelot === "8A" && ctx.lastKeyResult().manual === true);
            _selfTestKeyOverrideResult = ok ? "ok" : "fail";
            _selfTestKeyOverrideDetail = ok
              ? "lastKeyResult.camelot=8A, manual=true, as expected"
              : "lastKeyResult after the click: " + JSON.stringify(ctx.lastKeyResult() && { camelot: ctx.lastKeyResult().camelot, manual: ctx.lastKeyResult().manual });
            return _clickAndWaitForButton(ctx.detectKeyBtn(), "Detect key (run 3, restoring real data after the override test above)");
          }).then(function () {
            // Several steps below (razorTestBtn, cutDownbeatsBtn) cut the
            // selected clip, which changes Premiere's selection. The
            // background pollSelection() (every 1.5 s) can then call
            // _applyCachedEntry(), which replaces lastKeyResult with the
            // thinner library-persisted version (without the perProfile and
            // witness diagnostic fields, which are never persisted). The
            // result is therefore captured here, before that can happen.
            if (!ctx.lastKeyResult() || !ctx.lastKeyResult().camelot) {
              _selfTestKeyMultiNotationResult = "fail";
              _selfTestKeyMultiNotationDetail = "lastKeyResult is empty right after Detect key (run 3) - check the detailed log above.";
              return;
            }
            var multiNotationOk = ctx.keyResultDisplay().textContent.indexOf("/") !== -1;
            var allProfilesRan = !!(ctx.lastKeyResult().perProfile && ctx.lastKeyResult().perProfile.length === ctx.lastKeyResult().totalProfiles);
            // Music mode must also have heard from S-KEY (js/key-combine.js).
            var skeyAnswered = ctx.lastKeyResult().material !== "music" || !!ctx.lastKeyResult().skeyCamelot;
            var confidenceShown = ctx.keyAgreementRow().style.display !== "none" && !!ctx.keyAgreementDisplay().textContent;
            _selfTestKeyMultiNotationResult = multiNotationOk && allProfilesRan && confidenceShown && skeyAnswered ? "ok" : "fail";
            _selfTestKeyMultiNotationDetail =
              ctx.lastKeyResult().camelot + " (" + ctx.lastKeyResult().key + " " + ctx.lastKeyResult().scale + ")" +
              (multiNotationOk ? ", Open Key/enharmonic shown" : ", Open Key/enharmonic NOT shown") +
              (allProfilesRan
                ? ", " + ctx.lastKeyResult().material + " vote " + ctx.lastKeyResult().votes + "/" + ctx.lastKeyResult().totalProfiles +
                  ", chord witness " + (ctx.lastKeyResult().witnessAvailable ? ctx.lastKeyResult().chordCamelot : "unavailable")
                : ", a profile is MISSING") +
              (confidenceShown ? "" : ", confidence line NOT shown") +
              (ctx.lastKeyResult().skeyCamelot ? ", S-KEY " + ctx.lastKeyResult().skeyCamelot + " (" + ctx.lastKeyResult().agreement3 + " agree)"
                : (skeyAnswered ? "" : ", S-KEY did NOT answer in Music mode - see the log"));
          });
        })
        .then(function () {
          // Cut at downbeats: razors at every downbeat of the current
          // analysis (many cuts on a typical track, unlike razorTestBtn's
          // single test cut below).
          return _clickAndWaitForButton(ctx.cutDownbeatsBtn(), "Cut at downbeats (real, repeated razor cuts on the selected, still-whole clip)").then(function () {
            var r = ctx._lastCutDownbeatsResult();
            _selfTestCutDownbeatsResult = r && r.ok ? "ok" : "fail";
            _selfTestCutDownbeatsDetail = !r
              ? "handler never set a result - check the log above."
              : r.ok
                ? "requested " + r.requested + ", cut " + r.cut + (r.droppedCount ? ", " + r.droppedCount + " dropped" : "") + "."
                : "FAILED - " + (r.error || "0 of " + (r.requested || "?") + " cuts succeeded") + " - check the \"Cut at downbeats\" line above.";
          });
        })
        .then(function () { return _clickAndWaitForButton(ctx.razorTestBtn(), "Test cut (run once - cuts the selected clip's track)"); })
        .then(function () {
          // Copy + Paste markers. Copy is non-destructive by default
          // (removeAfterCopyCheckbox is unchecked); the checkbox is left as
          // it is, so a user's preference is not flipped mid-test. The
          // clearMarkersBtn cleanup right after this block removes the
          // duplicates.
          return _clickAndWaitForButton(ctx.copyMarkersBtn(), "Copy markers (from the selected clip)").then(function () {
            if (!ctx._copiedMarkers()) {
              _selfTestCopyPasteResult = "skip";
              _selfTestCopyPasteDetail = "no markers found on the selected clip to copy (cuts above may have left none in range) - see the log above.";
              return null;
            }
            var copiedCount = ctx._copiedMarkers().sequenceMarkers.length + ctx._copiedMarkers().clipMarkers.length;
            return _clickAndWaitForButton(ctx.pasteMarkersBtn(), "Paste markers (re-anchors onto the same selected clip)").then(function () {
              _selfTestCopyPasteResult = "ok";
              _selfTestCopyPasteDetail = "copied " + copiedCount + " marker(s), pasted back - check the \"Pasted N of M...\" lines above for the actual count.";
            });
          });
        })
        .then(function () { return _clickAndWaitForButton(ctx.clearMarkersBtn(), "Clear this clip's markers (cleanup)"); })
        .then(function () {
          log("--- SELF-TEST SUMMARY ---");
          _summaryFromResult("Set BPM (manual/synthetic grid path)", _selfTestManualBpmResult, _selfTestManualBpmDetail);
          if (ctx.lastAnalysis()) {
            var marginRatio = ctx.lastAnalysis().phaseMarginRatio;
            var marginKnown = typeof marginRatio === "number";
            var marginUncertain = marginKnown && marginRatio < ctx.PHASE_MARGIN_UNCERTAIN_THRESHOLD();
            _summaryLine("ok", "Analyze (subprocess, weighted bass+chord phase blend)",
              "bpm=" + ctx.bpmDisplay().textContent + ", " + ctx.lastAnalysis().beatsArray.length + " beats, phase=" + ctx.lastAnalysis().phase +
              " (source=" + (ctx.lastAnalysis().downbeatTimes ? "Beat This! own downbeats" : ctx.lastAnalysis().phaseSource) + ")" + ", confidence=" + ctx.lastAnalysis().confidence.toFixed(3) +
              (marginKnown ? ", phase margin=" + (marginRatio * 100).toFixed(1) + "%" +
                (marginUncertain ? " (uncertain - hint should be visible in the panel)" : " (confident)") : ""));
            var usedBundledNode = typeof ctx._bridge().nodeExecutable() === "string" &&
              ctx._bridge().nodeExecutable().indexOf("/runtime/node/") !== -1;
            _summaryLine(usedBundledNode ? "ok" : "fail", "Bundled Node.js runtime in use (not a system fallback)",
              String(ctx._bridge().nodeExecutable()));
            // Beat This! - see the click-sequence block above.
            if (_selfTestBeatThisResult === null) {
              _summaryLine("skip", "Alternative analysis (Beat This!): guard + one-click revert",
                "no analysis to check.");
            } else if (_selfTestBeatThisResult === "reject") {
              _summaryLine("skip", "Alternative analysis (Beat This!): guard + one-click revert",
                "did not apply on this clip - see the \"Alternative analysis: ...\" line above for the specific reason " +
                "(a guard rejection is expected here).");
            } else {
              _summaryLine(_selfTestBeatThisResult === "ok" ? "ok" : "fail",
                "Alternative analysis (Beat This!): guard + one-click revert", _selfTestBeatThisDetail ||
                "revert did not restore the original beatsArray exactly.");
            }
            var retempoLikely = ctx.retempoHint().classList.contains("is-error");
            _summaryLine("skip", "Half-time hint (informational, depends on this clip's tempo)",
              retempoLikely ? "fired: " + ctx.retempoHint().textContent : "did not fire (bpm outside the ambiguous zone, or signal below threshold)");
            _summaryLine("skip", "Marker colors",
              "check them on the timeline by eye.");
            _summaryFromResult("½x/2x retempo (tempo-octave correction)", _selfTestRetempoResult, _selfTestRetempoDetail);
            _summaryFromResult("Cut at downbeats (real razor cuts, not just the single test cut)", _selfTestCutDownbeatsResult, _selfTestCutDownbeatsDetail);
            _summaryFromResult("Copy + Paste markers", _selfTestCopyPasteResult, _selfTestCopyPasteDetail);
          } else {
            _summaryLine("fail", "Analyze", "lastAnalysis is empty after the test ran - check the detailed log above for the actual error.");
          }
          if (ctx.lastKeyResult() && ctx.lastKeyResult().camelot) {
            _summaryFromResult("Detect key + multi-notation display + profile vote", _selfTestKeyMultiNotationResult, _selfTestKeyMultiNotationDetail);
            // The detection used the profile set the Music/SFX switch shows.
            if (ctx.lastKeyResult().material) {
              _summaryLine(ctx.lastKeyResult().material === ctx.keyMaterial() ? "ok" : "fail", "Key profile set matches the Music/SFX switch",
                "switch=" + ctx.keyMaterial() + ", detection used " + ctx.lastKeyResult().material);
            } else {
              _summaryLine("skip", "Key profile set matches the Music/SFX switch", "last key result came from the library cache, not a fresh detection.");
            }
            _summaryFromResult("Key override (manual Camelot entry)", _selfTestKeyOverrideResult, _selfTestKeyOverrideDetail);
          } else {
            _summaryLine("fail", "Detect key", "lastKeyResult is empty after the test ran.");
          }
          log("=== SELF-TEST END (" + new Date().toLocaleTimeString() +
              ") === Copy the log (gear icon > Copy log) to report a problem.");
        })
        .catch(function (err) {
          log("=== SELF-TEST CRASHED: " + (err && err.message ? err.message : String(err)) +
              " === Copy the log (gear icon > Copy log) and include it in a bug report.");
        })
        .then(function () {
          runSelfTestBtn.disabled = false;
        });
    });

    return {
      summaryLine: _summaryLine
    };
  }

  global.BeatMarkerSelfTest = { create: create };
})(window);
