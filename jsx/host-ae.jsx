// After Effects half of the host script. ES3 engine: plain for-loops only,
// no .map/.filter/.forEach, no let/const. #included by host.jsx; each public
// function in host.jsx forwards here when _dbIsAe() is true, so the panel
// calls the same names with the same { ok, error, data } contract in both
// hosts.
// Model mapping from Premiere to After Effects:
//   selected audio clip           -> the selected layer that has audio
//   clip (project-item) markers   -> layer markers (they move with the layer)
//   sequence markers              -> composition markers
//   razor cut                     -> layer split (duplicate + trim, like
//                                    Edit > Split Layer)
// Times: layer property keyframes, markers included, are keyed in
// COMPOSITION time.
// MarkerValue.label indices of After Effects' default label colors
// (Preferences > Labels): 1 Red, 2 Yellow, 3 Aqua, 4 Pink, 5 Lavender, 6
// Peach, 7 Sea Foam, 8 Blue, 9 Green, 10 Purple, 11 Orange, 12 Brown, 13
// Fuchsia, 14 Cyan, 15 Sandstone, 16 Dark Green. Same idea as host.jsx's
// LABEL_COLOR_INDEX.
var AE_LABEL_COLOR_INDEX = {
    "D": 9,
    "b": 8
};

function _dbIsAe() {
    try {
        return typeof BridgeTalk !== "undefined" && String(BridgeTalk.appName).indexOf("aftereffects") !== -1;
    } catch (e) {
        return false;
    }
}

function _dbAeResult(fn) {
    var result = { ok: false, error: null, data: null };
    try {
        result.data = fn();
        result.ok = true;
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}

function _dbAeActiveCompOrThrow() {
    if (!app.project) {
        throw new Error("No project is open.");
    }
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
        throw new Error("No active composition. Open a composition and select a layer in its timeline.");
    }
    return item;
}

function _dbAeLayerHasFile(layer) {
    try {
        return !!(layer.source && layer.source.file);
    } catch (e) {
        return false;
    }
}
// Exactly one selected layer with audio. Returns the layer.
function _dbAeSelectedAudioLayerOrThrow(comp) {
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) {
        throw new Error("Nothing selected. Select one audio layer in the composition.");
    }
    var withAudio = [];
    for (var i = 0; i < sel.length; i++) {
        var hasAudio = false;
        try {
            hasAudio = !!sel[i].hasAudio;
        } catch (audioErr) {
            hasAudio = false;
        }
        if (hasAudio) {
            withAudio.push(sel[i]);
        }
    }
    if (withAudio.length === 0) {
        throw new Error("The selected layer has no audio. Select an audio layer instead.");
    }
    if (withAudio.length > 1) {
        throw new Error("More than one layer with audio selected (" + withAudio.length + "). Select exactly one.");
    }
    var layer = withAudio[0];
    if (!_dbAeLayerHasFile(layer)) {
        throw new Error("The selected layer is not a file (a precomp or a generated layer). Select the audio file's own layer.");
    }
    if (layer.source.footageMissing) {
        throw new Error("The selected layer's media file is missing. Relink it first.");
    }
    _dbAeRefuseRetimedLayer(layer);
    return layer;
}

function _dbAeRefuseRetimedLayer(layer) {
    if (layer.timeRemapEnabled) {
        throw new Error("The selected layer uses Time Remapping. Downbeat places markers only on a layer playing at normal speed - turn Time Remap off first.");
    }
    if (Math.abs(layer.stretch - 100) > 0.0001) {
        throw new Error("The selected layer is time-stretched (" + layer.stretch + "%). Downbeat places markers only on a layer at 100% - reset Stretch to 100% first.");
    }
}

function _dbAeParseArray(json, what) {
    var arr = JSON.parse(json);
    if (!arr || arr.length === undefined) {
        throw new Error(what + " expected a JSON array.");
    }
    return arr;
}

function _dbAeParseLabels(json) {
    if (!json) {
        return null;
    }
    try {
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}
// A marker in After Effects has one visible text, so the long explanation
// Premiere keeps in `comments` is not set.
function _dbAeMarkerValue(label) {
    var text = "";
    var typeCode = null;
    if (label) {
        var colonIndex = label.indexOf(":");
        var prefix = colonIndex === -1 ? null : label.substring(0, colonIndex);
        var compound = prefix !== null && AE_LABEL_COLOR_INDEX.hasOwnProperty(prefix);
        typeCode = compound ? prefix : label;
        text = compound ? label.substring(colonIndex + 1) : label;
    }
    var mv = new MarkerValue(text);
    if (typeCode !== null && AE_LABEL_COLOR_INDEX[typeCode] !== undefined) {
        try {
            mv.label = AE_LABEL_COLOR_INDEX[typeCode]; // best-effort; without it the marker keeps the default color
        } catch (labelErr) {
            // the marker itself is still created
        }
    }
    return mv;
}
// Adds markers to a Marker property at comp times. Out-of-range times are
// skipped and counted, not fatal. `stored`: where After Effects put the first
// three, read back - the panel logs it like Premiere's (main.js
// _logStoredMarkerTimes), which shows whether After Effects keeps a time
// between two frames or moves it to a frame.
function _dbAeAddMarkers(markerProp, compTimes, labels, minTime, maxTime) {
    var created = 0;
    var skipped = 0;
    var stored = [];
    for (var i = 0; i < compTimes.length; i++) {
        var t = compTimes[i];
        if (typeof t !== "number" || isNaN(t) || t < minTime - 0.0005 || t > maxTime + 0.0005) {
            skipped++;
            continue;
        }
        try {
            markerProp.setValueAtTime(t, _dbAeMarkerValue(labels ? labels[i] : null));
            created++;
        } catch (mkErr) {
            skipped++;
            continue;
        }
        if (stored.length < 3) {
            try {
                stored.push({ requested: t, stored: markerProp.keyTime(markerProp.nearestKeyIndex(t)) });
            } catch (readErr) {
                // the marker is there; only the read-back failed
            }
        }
    }
    return { created: created, skipped: skipped, stored: stored };
}

function _dbAeWithUndo(name, fn) {
    app.beginUndoGroup(name);
    try {
        return fn();
    } finally {
        app.endUndoGroup();
    }
}

function _dbAeFrameSnap(seconds, fps) {
    return Math.round(seconds * fps) / fps;
}

function dbAeGetSelectedAudioInfo() {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        return {
            mediaPath: layer.source.file.fsName,
            clipStartSeconds: layer.inPoint,
            inPointSeconds: layer.inPoint - layer.startTime,
            outPointSeconds: layer.outPoint - layer.startTime,
            frameRate: comp.frameRate,
            trackIndex: layer.index,
            host: "ae",
            layerName: layer.name
        };
    });
}
function _dbAeRemoveOwnMarkers(markerProp, minTime, maxTime) {
    var removed = 0;
    for (var i = markerProp.numKeys; i >= 1; i--) {
        var t = markerProp.keyTime(i);
        var v = markerProp.keyValue(i);
        if (t >= minTime - 0.0005 && t <= maxTime + 0.0005 && v && AE_LABEL_COLOR_INDEX.hasOwnProperty(v.comment)) {
            markerProp.removeKey(i);
            removed++;
        }
    }
    return removed;
}
// Both kinds around one layer: its own layer markers and the composition
// markers within its in/out range.
function _dbAeRemoveOwnAroundLayer(comp, layer) {
    var removed = _dbAeRemoveOwnMarkers(layer.property("Marker"), layer.inPoint, layer.outPoint);
    if (comp.markerProperty) {
        removed += _dbAeRemoveOwnMarkers(comp.markerProperty, layer.inPoint, layer.outPoint);
    }
    return removed;
}

function dbAeCreateClipMarkers(secondsJsonArray, labelsJsonArray, replaceOwn) {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var times = _dbAeParseArray(secondsJsonArray, "createClipMarkers");
        var labels = _dbAeParseLabels(labelsJsonArray);
        var compTimes = [];
        for (var i = 0; i < times.length; i++) {
            compTimes.push(layer.startTime + times[i]);
        }
        var replaced = 0;
        var r = _dbAeWithUndo("Downbeat: place markers", function () {
            if (replaceOwn === true) {
                replaced = _dbAeRemoveOwnAroundLayer(comp, layer);
            }
            return _dbAeAddMarkers(layer.property("Marker"), compTimes, labels, layer.inPoint, layer.outPoint);
        });
        return { requested: times.length, created: r.created, skipped: r.skipped, replaced: replaced, stored: r.stored };
    });
}
// Comp times, like Premiere's sequence markers.
function dbAeCreateMarkers(secondsJsonArray, labelsJsonArray, replaceOwn) {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var times = _dbAeParseArray(secondsJsonArray, "createMarkers");
        var labels = _dbAeParseLabels(labelsJsonArray);
        if (!comp.markerProperty) {
            throw new Error("This After Effects version does not expose composition markers to scripts.");
        }
        var layer = replaceOwn === true ? _dbAeSelectedAudioLayerOrThrow(comp) : null;
        var replaced = 0;
        var r = _dbAeWithUndo("Downbeat: place markers", function () {
            if (layer) {
                replaced = _dbAeRemoveOwnAroundLayer(comp, layer);
            }
            return _dbAeAddMarkers(comp.markerProperty, times, labels, 0, comp.duration);
        });
        return { requested: times.length, created: r.created, skipped: r.skipped, replaced: replaced, stored: r.stored };
    });
}
// Splits the layer at one comp time the way Edit > Split Layer does: the
// original keeps everything before, a duplicate above it everything after.
// Returns the new (later) piece.
function _dbAeSplitLayerAt(layer, compTime) {
    if (compTime <= layer.inPoint + 0.0005 || compTime >= layer.outPoint - 0.0005) {
        throw new Error("outside the layer (" + layer.inPoint.toFixed(3) + "-" + layer.outPoint.toFixed(3) + " s)");
    }
    var later = layer.duplicate();
    layer.outPoint = compTime;
    later.inPoint = compTime;
    // New pieces are never left selected: two selected audio layers would
    // make every later call refuse with "more than one layer selected".
    try {
        later.selected = false;
    } catch (selErr) {
        // selection is a convenience; the split itself is done
    }
    return later;
}

function _dbAeReselect(layer) {
    try {
        layer.selected = true;
    } catch (selErr) {
        // same as above
    }
}

function dbAeRazorAtManySeconds(secondsJsonArray) {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var times = _dbAeParseArray(secondsJsonArray, "razorAtManySeconds");
        var sorted = [];
        for (var i = 0; i < times.length; i++) {
            sorted.push(times[i]);
        }
        sorted.sort(function (a, b) { return a - b; });
        var cut = 0;
        var failures = [];
        _dbAeWithUndo("Downbeat: split at beats", function () {
            var current = layer;
            for (var j = 0; j < sorted.length; j++) {
                // Frame-snapped, as Premiere's razor takes a timecode.
                var t = _dbAeFrameSnap(sorted[j], comp.frameRate);
                try {
                    current = _dbAeSplitLayerAt(current, t);
                    cut++;
                } catch (cutErr) {
                    failures.push({ seconds: sorted[j], reason: cutErr.message ? cutErr.message : cutErr.toString() });
                }
            }
            _dbAeReselect(layer);
        });
        return { requested: times.length, cut: cut, failures: failures };
    });
}

function dbAeTestRazorAtSeconds(secondsValue) {
    return _dbAeResult(function () {
        var targetSeconds = Number(secondsValue);
        if (isNaN(targetSeconds)) {
            throw new Error("testRazorAtSeconds expected a number.");
        }
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var source = layer.source;
        var t = _dbAeFrameSnap(targetSeconds, comp.frameRate);
        _dbAeWithUndo("Downbeat: test split", function () {
            _dbAeSplitLayerAt(layer, t);
            _dbAeReselect(layer);
        });
        // Read the real layer boundaries back rather than trusting the call.
        var nearby = [];
        var sameSource = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            if (l.source !== source) {
                continue;
            }
            sameSource++;
            if (Math.abs(l.inPoint - t) < 2 || Math.abs(l.outPoint - t) < 2) {
                nearby.push({ name: l.name, startSeconds: l.inPoint, endSeconds: l.outPoint });
            }
        }
        return {
            requestedSeconds: targetSeconds,
            timecodeSent: t.toFixed(4) + " s (frame-snapped)",
            frameRate: comp.frameRate,
            razorReturnValue: "split",
            clipCountOnTrackAfter: sameSource,
            nearbyClipsAfterCut: nearby
        };
    });
}

function _dbAeMarkerTimes(markerProp) {
    var out = [];
    for (var i = 1; i <= markerProp.numKeys; i++) {
        out.push({ index: i, time: markerProp.keyTime(i), comment: markerProp.keyValue(i).comment });
    }
    return out;
}
function dbAeClearMarkersForSelectedClip(ownOnly) {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var epsilon = 0.0005;
        var layerRemoved = 0;
        var compRemoved = 0;
        _dbAeWithUndo("Downbeat: clear markers", function () {
            var lm = layer.property("Marker");
            for (var i = lm.numKeys; i >= 1; i--) {
                if (ownOnly === true && !AE_LABEL_COLOR_INDEX.hasOwnProperty(lm.keyValue(i).comment)) {
                    continue;
                }
                lm.removeKey(i);
                layerRemoved++;
            }
            var cm = comp.markerProperty;
            if (cm) {
                for (var j = cm.numKeys; j >= 1; j--) {
                    var t = cm.keyTime(j);
                    if (t >= layer.inPoint - epsilon && t <= layer.outPoint + epsilon &&
                            (ownOnly !== true || AE_LABEL_COLOR_INDEX.hasOwnProperty(cm.keyValue(j).comment))) {
                        cm.removeKey(j);
                        compRemoved++;
                    }
                }
            }
        });
        return {
            sequenceMarkersRemoved: compRemoved,
            clipMarkersRemoved: layerRemoved,
            clipMarkersAttempted: true,
            clipStartSeconds: layer.inPoint,
            clipEndSeconds: layer.outPoint
        };
    });
}
// Downbeat's own markers around the selected layer (host.jsx
// countOwnMarkersForSelectedClip): its own layer markers, and composition
// markers between its in and out points - what clear and placing touch.
function dbAeCountOwnMarkersForSelectedClip() {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var epsilon = 0.0005;
        var count = 0;
        var lm = layer.property("Marker");
        for (var i = 1; i <= lm.numKeys; i++) {
            if (AE_LABEL_COLOR_INDEX.hasOwnProperty(lm.keyValue(i).comment)) {
                count++;
            }
        }
        var cm = comp.markerProperty;
        if (cm) {
            for (var j = 1; j <= cm.numKeys; j++) {
                var t = cm.keyTime(j);
                if (t >= layer.inPoint - epsilon && t <= layer.outPoint + epsilon && AE_LABEL_COLOR_INDEX.hasOwnProperty(cm.keyValue(j).comment)) {
                    count++;
                }
            }
        }
        return { count: count };
    });
}
// Copy markers: layer markers as source-relative seconds (clipMarkers),
// composition markers inside the layer as seconds from the layer's start
// (sequenceMarkers) - the same shapes Premiere's half returns, so the panel's
// paste works unchanged.
function dbAeGetMarkersDataForSelectedClip() {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var epsilon = 0.0005;
        var clipMarkers = [];
        var lm = _dbAeMarkerTimes(layer.property("Marker"));
        for (var i = 0; i < lm.length; i++) {
            clipMarkers.push({ localSeconds: lm[i].time - layer.startTime, label: lm[i].comment });
        }
        var sequenceMarkers = [];
        if (comp.markerProperty) {
            var cm = _dbAeMarkerTimes(comp.markerProperty);
            for (var j = 0; j < cm.length; j++) {
                if (cm[j].time >= layer.inPoint - epsilon && cm[j].time <= layer.outPoint + epsilon) {
                    sequenceMarkers.push({ localSeconds: cm[j].time - layer.inPoint, label: cm[j].comment });
                }
            }
        }
        return { clipName: layer.name, sequenceMarkers: sequenceMarkers, clipMarkers: clipMarkers };
    });
}

// Equal-power fade gain at position x (0..1) of a fade, bent by curve
// (-100..100); mirrors fadeGain in js/lib-preview.js.
function _dbAeFadeGain(x, rising, curve) {
    x = Math.max(0, Math.min(1, x));
    if (x === (rising ? 0 : 1)) {
        return 0;
    }
    var base = rising ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
    return curve ? Math.pow(base, Math.pow(2, -curve / 50)) : base;
}
// Library insert: the file as a new layer starting at the comp's current
// time. An already-imported footage item for the same file is reused; a new
// one goes into a "Downbeat" folder of the project.
// optsJson: { inSec, outSec, fadeInSec, fadeOutSec, curveIn, curveOut } - the
// original file as a layer trimmed to inSec..outSec of the source, the fades
// as Audio Levels keyframes along the pane's curve (9 per fade, in dB; -96 dB
// stands for silence), so they stay editable.
function dbAeInsertAudioAtPlayhead(mediaPathJson, durationSeconds, optsJson) {
    return _dbAeResult(function () {
        var mediaPath = JSON.parse(mediaPathJson);
        var opts = null;
        try {
            opts = optsJson ? JSON.parse(optsJson) : null;
        } catch (optsErr) {
            opts = null;
        }
        var comp = _dbAeActiveCompOrThrow();
        var file = new File(mediaPath);
        if (!file.exists) {
            throw new Error("The file is not there any more: " + mediaPath);
        }
        var item = null;
        var folder = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (!item && it instanceof FootageItem && it.file && _dbSamePath(it.file.fsName, file.fsName)) {
                item = it;
            }
            if (!folder && it instanceof FolderItem && it.name === DOWNBEAT_BIN_NAME) {
                folder = it;
            }
        }
        var imported = !item;
        // opts.atSeconds / muteSelected: see host.jsx insertAudioAtPlayhead -
        // here the selected audio layer's sound is switched off.
        var startSeconds = (opts && typeof opts.atSeconds === "number" && opts.atSeconds >= 0) ? opts.atSeconds : comp.time;
        var toMute = null;
        if (opts && opts.muteSelected) {
            try {
                toMute = _dbAeSelectedAudioLayerOrThrow(comp);
            } catch (selErr) {
                toMute = null;
            }
        }
        // Set to "speedFailed" or "trimFailed" when the layer did not come out as asked.
        var failure = null;
        var layer = _dbAeWithUndo("Downbeat: insert sound", function () {
            if (!item) {
                item = app.project.importFile(new ImportOptions(file));
                if (!folder) {
                    folder = app.project.items.addFolder(DOWNBEAT_BIN_NAME);
                }
                item.parentFolder = folder;
            }
            var added = comp.layers.add(item);
            // The pitched clip (Key tab) goes right above the layer it was
            // made from, not to the top of the comp, so the two stay
            // together in a busy comp. A layer that will not move stays on top.
            if (toMute) {
                try {
                    added.moveBefore(toMute);
                } catch (moveErr) {
                    /* still inserted, just on top */
                }
            }
            var inSec = opts && Number(opts.inSec) > 0 ? Number(opts.inSec) : 0;
            var outSec = opts && Number(opts.outSec) > inSec ? Number(opts.outSec) : null;
            // Pitch and Reverse on the layer itself: Time Stretch plays the
            // file's sound faster or slower, pitch with it, like a sampler; a
            // negative stretch plays it backwards. Comp time = startTime +
            // source time x stretch/100.
            var speed = opts && Number(opts.speed) > 0 ? Number(opts.speed) : 1;
            var reverse = !!(opts && opts.reverse);
            var sped = Math.abs(speed - 1) > 1e-6 || reverse;
            var factor = 1 / speed; // comp seconds per source second
            var wantStretch = (reverse ? -100 : 100) * factor;
            var wantOut = null;
            try {
                if (sped) {
                    if (outSec === null) {
                        outSec = item.duration;
                    }
                    added.stretch = wantStretch;
                    added.startTime = reverse ? startSeconds + outSec * factor : startSeconds - inSec * factor;
                    added.inPoint = startSeconds;
                    added.outPoint = startSeconds + (outSec - inSec) * factor;
                    wantOut = startSeconds + (outSec - inSec) * factor;
                } else {
                    added.startTime = startSeconds - inSec;
                    if (inSec > 0 || outSec !== null) {
                        added.inPoint = startSeconds;
                        if (outSec !== null) {
                            added.outPoint = startSeconds + (outSec - inSec);
                            wantOut = startSeconds + (outSec - inSec);
                        }
                    }
                }
            } catch (setErr) {
                failure = sped ? "speedFailed" : "trimFailed";
            }
            if (!failure) {
                var tol = Math.max(0.05, 2 / (comp.frameRate || 25));
                if (sped && Math.abs(added.stretch - wantStretch) > 0.01) {
                    failure = "speedFailed";
                } else if ((inSec > 0 || outSec !== null || sped) &&
                        (Math.abs(added.inPoint - startSeconds) > tol || (wantOut !== null && Math.abs(added.outPoint - wantOut) > tol))) {
                    failure = sped ? "speedFailed" : "trimFailed";
                }
            }
            if (failure) {
                try { added.remove(); } catch (removeErr) { /* reported by the panel's message */ }
                return null;
            }
            var fadeIn = opts ? Number(opts.fadeInSec) || 0 : 0;
            var fadeOut = opts ? Number(opts.fadeOutSec) || 0 : 0;
            if (fadeIn > 0 || fadeOut > 0) {
                var levels = added.property("ADBE Audio Group").property("ADBE Audio Levels");
                var steps = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1];
                var toDb = function (g) { return g <= 0 ? -96 : Math.max(-96, 20 * Math.log(g) / Math.LN10); };
                for (var k = 0; k < steps.length; k++) {
                    if (fadeIn > 0) {
                        var dbIn = toDb(_dbAeFadeGain(steps[k], true, opts.curveIn));
                        levels.setValueAtTime(added.inPoint + steps[k] * fadeIn, [dbIn, dbIn]);
                    }
                    if (fadeOut > 0) {
                        var dbOut = toDb(_dbAeFadeGain(steps[k], false, opts.curveOut));
                        levels.setValueAtTime(added.outPoint - fadeOut + steps[k] * fadeOut, [dbOut, dbOut]);
                    }
                }
            }
            if (toMute) {
                try {
                    toMute.audioEnabled = false;
                } catch (muteErr) {
                    // reported below
                }
            }
            return added;
        });
        if (failure) {
            var failed = { where: comp.name, stretch: null };
            failed[failure] = true;
            failed.speedResult = { speed: (opts && Number(opts.speed) > 0 ? Number(opts.speed) : 1), error: "After Effects could not apply the speed or the trim." };
            return failed;
        }
        // `where` is the composition: the panel says "Inserted {name} on
        // {where}", and the layer's own name is the file's.
        return { where: comp.name, layerName: layer.name, startSeconds: startSeconds, imported: imported,
            trimmed: !!opts && (Number(opts.inSec) > 0 || Number(opts.outSec) > 0), inPoint: layer.inPoint, outPoint: layer.outPoint,
            stretch: layer.stretch, muted: !!toMute && toMute.audioEnabled === false };
    });
}
