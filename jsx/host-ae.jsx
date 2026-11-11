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
// COMPOSITION time. For constant positive Stretch, a source second s maps
// to layer.startTime + s * layer.stretch / 100.
// MarkerValue.label indices of After Effects' default label colors
// (Preferences > Labels): 1 Red, 2 Yellow, 3 Aqua, 4 Pink, 5 Lavender, 6
// Peach, 7 Sea Foam, 8 Blue, 9 Green, 10 Purple, 11 Orange, 12 Brown, 13
// Fuchsia, 14 Cyan, 15 Sandstone, 16 Dark Green. Same idea as host.jsx's
// LABEL_COLOR_INDEX.
var AE_LABEL_COLOR_INDEX = {
    "D": 9,
    "b": 8
};
// The marker parameter (Marker dialog > Parameters) Downbeat writes on
// each marker it places: name "Downbeat", value the marker's text, D or b.
// Text, color and length can all be made by hand, so they do not prove
// who placed a marker; this parameter does.
var AE_OWN_MARKER_PARAM = "Downbeat";
// A second parameter on each composition marker Place puts down: the id of
// the layer it was placed for. Composition markers stay where they are when
// layers move, so this is what tells one layer's set from another's on the
// same frames; it is undone and redone with its marker, and the panel needs
// no memory of where the set went.
var AE_LAYER_PARAM = "DownbeatLayer";
// Whether a marker value is one Downbeat placed: the text D or b, the
// Downbeat parameter with that text, Downbeat's label color for it, no
// duration and none of a chapter, web link, cue point name or protected
// region. Any other "D" stays the editor's, including a D or b without the
// Downbeat parameter; such markers are removed by hand. eventCuePoint is
// not read, since its default value for a new marker is not documented.
function _dbAeIsOwnMarker(v) {
    if (!v || !AE_LABEL_COLOR_INDEX.hasOwnProperty(v.comment)) {
        return false;
    }
    var params = null;
    try {
        params = v.getParameters ? v.getParameters() : null;
    } catch (paramErr) {
        params = null;
    }
    if (!params || params[AE_OWN_MARKER_PARAM] !== v.comment) {
        return false;
    }
    if (v.label !== AE_LABEL_COLOR_INDEX[v.comment]) {
        return false;
    }
    if (Math.abs(Number(v.duration) || 0) > 0.0005) {
        return false;
    }
    return !(v.chapter || v.url || v.cuePointName || v.protectedRegion);
}
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

function _dbAeSourceMissing(layer) {
    try {
        return !!(layer.source && layer.source.footageMissing);
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
        // A layer whose file is missing reports no audio: name the real cause.
        if (sel.length === 1 && _dbAeSourceMissing(sel[0])) {
            throw new Error("The selected layer's media file is missing. Relink it first.");
        }
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
        throw new Error("The selected layer uses Time Remapping. Downbeat supports constant positive Time Stretch - turn Time Remap off first.");
    }
    if (!(layer.stretch > 0) || !isFinite(layer.stretch)) {
        throw new Error("The selected layer has a reversed or invalid Time Stretch. Analysis supports positive constant Stretch values.");
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
function _dbAeMarkerValue(label, layerTag) {
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
    if (text === typeCode && AE_LABEL_COLOR_INDEX.hasOwnProperty(text)) {
        var params = {};
        params[AE_OWN_MARKER_PARAM] = text;
        if (layerTag !== undefined && layerTag !== null) {
            params[AE_LAYER_PARAM] = String(layerTag);
        }
        try {
            mv.setParameters(params);
        } catch (paramErr) {
            // the marker is still created; Place and Clear leave it then
        }
    }
    return mv;
}
// Adds markers to a Marker property at comp times. Out-of-range times are
// skipped and counted, not fatal. `stored`: where After Effects put the first
// three, read back - the panel logs it like Premiere's (main.js
// _logStoredMarkerTimes), which shows whether After Effects keeps a time
// between two frames or moves it to a frame.
// A Marker property holds one key per time, so writing where an editor's
// own marker already sits would replace it. Such a beat is left out and
// counted in `kept`; a Downbeat marker at that time is still rewritten, so
// re-placing stays a replacement.
// With layerTag, a Downbeat marker of another layer's set at that time is
// left alone as well: the set placing went first kept it for that layer.
function _dbAeForeignMarkerAt(markerProp, t, layerTag) {
    if (!markerProp.numKeys) {
        return false;
    }
    var k = markerProp.nearestKeyIndex(t);
    if (Math.abs(markerProp.keyTime(k) - t) > 0.00001) {
        return false;
    }
    var v = markerProp.keyValue(k);
    if (!_dbAeIsOwnMarker(v)) {
        return true;
    }
    var tag = layerTag !== undefined && layerTag !== null ? _dbAeTagOf(v) : null;
    return tag !== null && tag !== String(layerTag);
}

function _dbAeAddMarkers(markerProp, compTimes, labels, minTime, maxTime, layerTag) {
    var created = 0;
    var skipped = 0;
    var kept = 0;
    var stored = [];
    var placed = [];
    for (var i = 0; i < compTimes.length; i++) {
        var t = compTimes[i];
        if (typeof t !== "number" || isNaN(t) || t < minTime - 0.0005 || t > maxTime + 0.0005) {
            skipped++;
            continue;
        }
        if (_dbAeForeignMarkerAt(markerProp, t, layerTag)) {
            kept++;
            continue;
        }
        try {
            markerProp.setValueAtTime(t, _dbAeMarkerValue(labels ? labels[i] : null, layerTag));
            created++;
            placed.push(t);
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
    return { created: created, skipped: skipped, kept: kept, stored: stored, placed: placed };
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
            selectionToken: _dbRememberSelection(comp, layer, layer.source),
            clipStartSeconds: layer.inPoint,
            inPointSeconds: (layer.inPoint - layer.startTime) * 100 / layer.stretch,
            outPointSeconds: (layer.outPoint - layer.startTime) * 100 / layer.stretch,
            speed: 100 / layer.stretch,
            frameRate: comp.frameRate,
            trackIndex: layer.index,
            host: "ae",
            layerName: layer.name,
            disabled: layer.audioEnabled === false,
            // The composition every action goes to: the active item, which a
            // click in the Project panel can make another one than the
            // timeline on screen. The panel names it in the clip line.
            compName: comp.name,
            compId: comp.id
        };
    });
}
function _dbAeRemoveOwnMarkers(markerProp, minTime, maxTime) {
    var removed = 0;
    for (var i = markerProp.numKeys; i >= 1; i--) {
        var t = markerProp.keyTime(i);
        var v = markerProp.keyValue(i);
        if (t >= minTime - 0.0005 && t <= maxTime + 0.0005 && _dbAeIsOwnMarker(v)) {
            markerProp.removeKey(i);
            removed++;
        }
    }
    return removed;
}

// The layer id a composition marker is tagged with (AE_LAYER_PARAM), or
// null: untagged (placed without the layer parameter).
function _dbAeTagOf(v) {
    var params = null;
    try {
        params = v && v.getParameters ? v.getParameters() : null;
    } catch (paramErr) {
        params = null;
    }
    var tag = params ? params[AE_LAYER_PARAM] : null;
    return tag === undefined || tag === null || tag === "" ? null : String(tag);
}
function _dbAeSameLayer(a, b) {
    if (a && b && a.id !== undefined && a.id !== null && b.id !== undefined && b.id !== null) {
        return a.id === b.id;
    }
    return a === b;
}
function _dbAeCovers(layer, t) {
    return t >= Math.min(layer.inPoint, layer.outPoint) - 0.0005 && t <= Math.max(layer.inPoint, layer.outPoint) + 0.0005;
}
// Whether a marker at t is over `owner`'s sound (host.jsx _dbClipHolds): one
// on its out point goes with `layer` when `layer` starts playing there.
function _dbAeHolds(owner, t, layer) {
    if (!_dbAeCovers(owner, t)) {
        return false;
    }
    if (t < Math.max(owner.inPoint, owner.outPoint) - 0.0005) {
        return true;
    }
    return !(t >= Math.min(layer.inPoint, layer.outPoint) - 0.0005 && t < Math.max(layer.inPoint, layer.outPoint) - 0.0005);
}
// The other pieces of a layer after Edit > Split Layer (or a duplicate laid
// over it): the same footage at the same Stretch and start time. A piece
// moved in time, or another use of the song, is another layer.
function _dbAePiecesOf(comp, layer) {
    var pieces = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (_dbAeSameLayer(l, layer) || !l.source || !layer.source) {
            continue;
        }
        var sameSource = l.source === layer.source || (l.source.id !== undefined && l.source.id === layer.source.id);
        if (sameSource && Math.abs(l.startTime - layer.startTime) < 0.0005 && Math.abs(l.stretch - layer.stretch) < 1e-6) {
            pieces.push(l);
        }
    }
    return pieces;
}

// The composition markers Place (mode "place") or Clear ("clear") on
// `layer` takes, as key indices from the last down (host.jsx
// _dbTimelinePlan, with the tag instead of a remembered set):
//   - the markers tagged for this layer, wherever it sits now; on Place,
//     those over another piece of the layer stay with that piece; on Clear
//     also those of its other pieces after Split Layer;
//   - in the layer's range, Downbeat markers no layer holds: untagged, or
//     tagged for a layer that is gone or not under them any more;
//   - untagged ones at the times the panel remembers for the layer.
// Markers tagged for another layer stay wherever that layer still plays,
// also inside this layer's range.
function _dbAeCompPlan(comp, layer, mode) {
    var out = [];
    var cm = comp.markerProperty;
    if (!cm) {
        return out;
    }
    var byId = {};
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (l.id !== undefined && l.id !== null) {
            byId[String(l.id)] = l;
        }
    }
    var pieces = _dbAePiecesOf(comp, layer);
    var mine = {};
    var myId = _dbAeLayerKey(layer);
    if (myId !== null) {
        mine[String(myId)] = true;
    }
    for (var p = 0; p < pieces.length && mode === "clear"; p++) {
        if (pieces[p].id !== undefined && pieces[p].id !== null) {
            mine[String(pieces[p].id)] = true;
        }
    }
    var legacy = myId !== null ? _dbPlacedEntry(_dbPlacedTimeline[_dbPlacedKey(comp.id, myId)]) : null;
    for (var k = cm.numKeys; k >= 1; k--) {
        var v = cm.keyValue(k);
        if (!_dbAeIsOwnMarker(v)) {
            continue;
        }
        var t = cm.keyTime(k);
        var tag = _dbAeTagOf(v);
        var take = _dbAeCovers(layer, t);
        if (tag === null) {
            for (var b = 0; !take && legacy && b < legacy.t.length; b++) {
                take = Math.abs(t - legacy.t[b]) < 0.0005;
            }
        } else if (mine[tag]) {
            // One on this layer's out point is the first beat of a piece that
            // starts there (Split Layer on a marker): it stays with that piece.
            if (!take || (mode !== "clear" && t >= Math.max(layer.inPoint, layer.outPoint) - 0.0005)) {
                take = true;
                for (var q = 0; q < pieces.length && mode !== "clear"; q++) {
                    if (_dbAeHolds(pieces[q], t, layer)) { take = false; break; }
                }
            }
        } else if (byId[tag] && _dbAeHolds(byId[tag], t, layer)) {
            take = false;
        }
        if (take) {
            out.push(k);
        }
    }
    return out;
}
function _dbAeRemoveKeys(markerProp, indices) {
    for (var i = 0; i < indices.length; i++) {
        markerProp.removeKey(indices[i]);
    }
    return indices.length;
}
// Both kinds around one layer: its own layer markers in its in/out range
// and its composition set, _dbAeCompPlan (the clip / timeline
// choice). Forgets the times the panel remembered for the layer.
function _dbAeRemoveOwnAroundLayer(comp, layer) {
    var removed = _dbAeRemoveOwnMarkers(layer.property("ADBE Marker"), layer.inPoint, layer.outPoint);
    if (comp.markerProperty) {
        removed += _dbAeRemoveKeys(comp.markerProperty, _dbAeCompPlan(comp, layer, "place"));
    }
    var layerKey = _dbAeLayerKey(layer);
    if (layerKey !== null) {
        delete _dbPlacedTimeline[_dbPlacedKey(comp.id, layerKey)];
    }
    return removed;
}
function dbAeCreateClipMarkers(secondsJsonArray, labelsJsonArray, replaceOwn, referenceJson, knownPlacedJson) {
    return _dbAeResult(function () {
        _dbValidateSelection(referenceJson);
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var times = _dbAeParseArray(secondsJsonArray, "createClipMarkers");
        var labels = _dbAeParseLabels(labelsJsonArray);
        var compTimes = [];
        for (var i = 0; i < times.length; i++) {
            compTimes.push(layer.startTime + times[i] * layer.stretch / 100);
        }
        var replaced = 0;
        var layerKey = replaceOwn === true ? _dbAeLayerKey(layer) : null;
        var placedKey = layerKey !== null ? _dbPlacedKey(comp.id, layerKey) : null;
        if (placedKey) { _dbSeedPlacedTimeline(knownPlacedJson); }
        var r = _dbAeWithUndo("Downbeat: place markers", function () {
            if (replaceOwn === true) {
                replaced = _dbAeRemoveOwnAroundLayer(comp, layer);
            }
            return _dbAeAddMarkers(layer.property("ADBE Marker"), compTimes, labels, layer.inPoint, layer.outPoint);
        });
        // placedKey without times: the panel forgets this layer's composition set.
        return { requested: times.length, created: r.created, skipped: r.skipped, kept: r.kept, replaced: replaced, stored: r.stored, placedKey: placedKey, placedTimes: null };
    });
}
// The layer's identity, written on its composition markers
// (AE_LAYER_PARAM): Layer.id (After Effects 22.0 and later; the panel needs
// 25.0), unique within the project. Without it the answer is null, the
// markers carry no tag and only the range rule applies: the layer's index is
// not safe, because a duplicated layer takes the original's index.
function _dbAeLayerKey(layer) {
    return layer.id !== undefined && layer.id !== null ? layer.id : null;
}
// Pitch the clip puts a new layer where the original plays: the
// composition markers tagged for the original are tagged for it, so Place
// or Clear on the pitched layer replaces that whole set, also past its
// shorter end. Called inside the insert's undo step.
function _dbAeHandOverCompSet(comp, fromLayer, toLayer) {
    var cm = comp.markerProperty;
    var fromId = _dbAeLayerKey(fromLayer);
    var toId = _dbAeLayerKey(toLayer);
    if (!cm || fromId === null || toId === null) {
        return;
    }
    for (var k = 1; k <= cm.numKeys; k++) {
        var v = cm.keyValue(k);
        if (_dbAeIsOwnMarker(v) && _dbAeTagOf(v) === String(fromId)) {
            var params = v.getParameters();
            params[AE_LAYER_PARAM] = String(toId);
            v.setParameters(params);
            cm.setValueAtTime(cm.keyTime(k), v);
        }
    }
}
// Comp times, like Premiere's sequence markers.
function dbAeCreateMarkers(secondsJsonArray, labelsJsonArray, replaceOwn, referenceJson, knownPlacedJson) {
    return _dbAeResult(function () {
        _dbValidateSelection(referenceJson);
        var comp = _dbAeActiveCompOrThrow();
        var times = _dbAeParseArray(secondsJsonArray, "createMarkers");
        var labels = _dbAeParseLabels(labelsJsonArray);
        if (!comp.markerProperty) {
            throw new Error("This After Effects version does not expose composition markers to scripts.");
        }
        var layer = replaceOwn === true ? _dbAeSelectedAudioLayerOrThrow(comp) : null;
        // Composition markers stay put when the layer moves: the new set is
        // tagged with the layer's id, and re-placing takes the tagged set
        // wherever it is (_dbAeCompPlan). An untagged set is found by the
        // times the panel still remembers for it.
        var layerKey = layer ? _dbAeLayerKey(layer) : null;
        var placedKey = layerKey !== null ? _dbPlacedKey(comp.id, layerKey) : null;
        if (placedKey) { _dbSeedPlacedTimeline(knownPlacedJson); }
        var replaced = 0;
        var r = _dbAeWithUndo("Downbeat: place markers", function () {
            if (layer) {
                replaced = _dbAeRemoveOwnAroundLayer(comp, layer);
            }
            return _dbAeAddMarkers(comp.markerProperty, times, labels, 0, comp.duration, layerKey);
        });
        // placedKey without times: the panel forgets any times it kept for this layer.
        return { requested: times.length, created: r.created, skipped: r.skipped, kept: r.kept, replaced: replaced, stored: r.stored,
            placedKey: placedKey, placedTimes: null };
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

// Same scope as Premiere's clearMarkersForSelectedClip: Downbeat's own
// markers (_dbAeIsOwnMarker) on the layer and on its other pieces after
// Split Layer (each piece keeps a copy of the layer markers), and the
// composition markers of its set (_dbAeCompPlan) - never an editor's.
function dbAeClearMarkersForSelectedClip(knownPlacedJson) {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var layerRemoved = 0;
        var compRemoved = 0;
        var layerKey = _dbAeLayerKey(layer);
        var placedKey = layerKey !== null ? _dbPlacedKey(comp.id, layerKey) : null;
        if (placedKey) { _dbSeedPlacedTimeline(knownPlacedJson); }
        _dbAeWithUndo("Downbeat: clear markers", function () {
            var pieces = [layer].concat(_dbAePiecesOf(comp, layer));
            for (var p = 0; p < pieces.length; p++) {
                layerRemoved += _dbAeRemoveOwnMarkers(pieces[p].property("ADBE Marker"), -1e20, 1e20);
            }
            if (comp.markerProperty) {
                compRemoved = _dbAeRemoveKeys(comp.markerProperty, _dbAeCompPlan(comp, layer, "clear"));
            }
        });
        if (placedKey) { delete _dbPlacedTimeline[placedKey]; }
        return {
            sequenceMarkersRemoved: compRemoved,
            clipMarkersRemoved: layerRemoved,
            clipMarkersAttempted: true,
            clipStartSeconds: layer.inPoint,
            clipEndSeconds: layer.outPoint,
            placedKey: placedKey
        };
    });
}
// Downbeat's own markers around the selected layer (host.jsx
// countOwnMarkersForSelectedClip): its own layer markers, and the
// composition markers placing would replace (_dbAeCompPlan).
function dbAeCountOwnMarkersForSelectedClip(knownPlacedJson) {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var count = 0;
        var lm = layer.property("ADBE Marker");
        for (var i = 1; i <= lm.numKeys; i++) {
            if (_dbAeIsOwnMarker(lm.keyValue(i))) {
                count++;
            }
        }
        _dbSeedPlacedTimeline(knownPlacedJson);
        count += _dbAeCompPlan(comp, layer, "place").length;
        return { count: count };
    });
}

// Copy and paste preserve MarkerValue metadata and heard offsets.
var _dbAeTransferFields = ["comment", "chapter", "cuePointName", "eventCuePoint", "url", "frameTarget", "label", "protectedRegion"];
function _dbAeTransferData(value, offset) {
    var m = { localSeconds: offset, label: value.comment || "", duration: Number(value.duration) || 0, fields: {} };
    for (var i = 0; i < _dbAeTransferFields.length; i++) {
        var name = _dbAeTransferFields[i];
        if (value[name] !== undefined) { m.fields[name] = value[name]; }
    }
    if (value.getParameters) { m.parameters = value.getParameters(); }
    return m;
}
// Copy markers: layer markers as source-relative seconds (clipMarkers),
// composition markers inside the layer as seconds from the layer's start
// (sequenceMarkers) - the same shapes Premiere's half returns, so the panel's
// paste works unchanged.
// Copy only reads; nothing is removed (see host.jsx getMarkersDataForSelectedClip).
function dbAeGetMarkersDataForSelectedClip() {
    return _dbAeResult(function () {
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var props = [comp.markerProperty, layer.property("ADBE Marker")];
        var groups = [[], []];
        for (var g = 0; g < props.length; g++) {
            var prop = props[g];
            if (!prop) { continue; }
            for (var i = 1; i <= prop.numKeys; i++) {
                var t = prop.keyTime(i);
                if (t >= layer.inPoint - 0.0005 && t <= layer.outPoint + 0.0005) {
                    groups[g].push(_dbAeTransferData(prop.keyValue(i), Math.max(0, t - layer.inPoint)));
                }
            }
        }
        return { version: 2, host: "ae", clipName: layer.name, sequenceMarkers: groups[0], clipMarkers: groups[1] };
    });
}
// A pasted composition marker of Downbeat's set belongs to the layer it is
// pasted onto, not to the one it was copied from (whose Place or Clear
// would otherwise take it away from here).
function _dbAePastedParameters(params, layerTag) {
    var out = {};
    for (var name in params) {
        if (params.hasOwnProperty(name) && name !== AE_LAYER_PARAM) { out[name] = params[name]; }
    }
    if (params.hasOwnProperty(AE_LAYER_PARAM) && layerTag !== null) { out[AE_LAYER_PARAM] = String(layerTag); }
    return out;
}
function dbAePasteMarkersData(dataJson, referenceJson) {
    return _dbAeResult(function () {
        _dbValidateSelection(referenceJson);
        var info = JSON.parse(referenceJson);
        var plan = _dbTransferPlan(JSON.parse(dataJson), info);
        var comp = _dbAeActiveCompOrThrow();
        var layer = _dbAeSelectedAudioLayerOrThrow(comp);
        var props = [comp.markerProperty, layer.property("ADBE Marker")];
        var groups = [plan.sequenceMarkers, plan.clipMarkers], writes = [], kept = 0;
        // Construct all MarkerValues before changing any host property.
        for (var g = 0; g < groups.length; g++) {
            if (groups[g].length && !props[g]) { throw new Error("The target does not expose markers."); }
            for (var i = 0; i < groups[g].length; i++) {
                var transfer = groups[g][i], m = transfer.data;
                var time = g === 0 ? transfer.time : layer.startTime + transfer.time * layer.stretch / 100;
                var value = new MarkerValue(m.label || "");
                value.duration = m.duration;
                for (var f = 0; f < _dbAeTransferFields.length; f++) {
                    var name = _dbAeTransferFields[f];
                    if (m.fields && m.fields[name] !== undefined) { value[name] = m.fields[name]; }
                }
                if (m.parameters) { value.setParameters(_dbAePastedParameters(m.parameters, g === 0 ? _dbAeLayerKey(layer) : null)); }
                // A marker already at this time stays; writing there would replace it.
                if (props[g].numKeys && Math.abs(props[g].keyTime(props[g].nearestKeyIndex(time)) - time) <= 0.00001) {
                    kept++;
                    continue;
                }
                writes.push({ prop: props[g], time: time, value: value });
            }
        }
        var applied = 0;
        _dbAeWithUndo("Downbeat: paste markers", function () {
            try {
                for (var w = 0; w < writes.length; w++) {
                    writes[w].prop.setValueAtTime(writes[w].time, writes[w].value); applied++;
        }
            } catch (e) {
                for (var r = applied - 1; r >= 0; r--) {
                    writes[r].prop.removeKey(writes[r].prop.nearestKeyIndex(writes[r].time));
                }
                throw e;
            }
        });
        return { created: applied, skipped: plan.skipped, kept: kept };
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
// Whether a reversed layer really plays source outSec..inSec over comp
// startSeconds..endSeconds: active just inside both ends, and the source
// time there as expected (within two frames). `known` is false when this
// After Effects has no activeAtTime or no sourceTime to ask.
function _dbAeCheckReversed(layer, startSeconds, endSeconds, inSec, outSec, fps) {
    var out = { ok: false, known: false, seen: "" };
    if (typeof layer.activeAtTime !== "function" || typeof layer.sourceTime !== "function") {
        return out;
    }
    out.known = true;
    var eps = 1 / Math.max(1, fps);
    var tol = 2 / Math.max(1, fps) * Math.max(1, Math.abs(layer.stretch) / 100);
    var t0 = startSeconds + eps;
    var t1 = endSeconds - eps;
    var a0 = !!layer.activeAtTime(t0);
    var a1 = !!layer.activeAtTime(t1);
    var s0 = Number(layer.sourceTime(t0));
    var s1 = Number(layer.sourceTime(t1));
    out.seen = "active " + a0 + "/" + a1 + ", source " + s0.toFixed(3) + "->" + s1.toFixed(3) + " s, in " + Number(layer.inPoint).toFixed(3) + ", out " + Number(layer.outPoint).toFixed(3);
    out.ok = a0 && a1 && Math.abs(s0 - outSec) <= tol + 0.01 && Math.abs(s1 - inSec) <= tol + 0.01;
    return out;
}

// The editor's own layer markers come along to the pitched layer, at the
// same place in the sound, as Premiere's pitched clip carries its clip
// markers. Downbeat's markers do not; a time where the new layer already
// has a marker keeps that one.
function _dbAeCopyMarkerValue(v, ratio) {
    var copy = new MarkerValue(v.comment);
    var fields = ["chapter", "url", "frameTarget", "cuePointName", "eventCuePoint", "label", "protectedRegion"];
    for (var i = 0; i < fields.length; i++) {
        try {
            if (v[fields[i]] !== undefined) { copy[fields[i]] = v[fields[i]]; }
        } catch (fieldErr) {
            // that field keeps its default
        }
    }
    try { copy.duration = (Number(v.duration) || 0) * ratio; } catch (durationErr) { /* no duration */ }
    try {
        if (v.getParameters) { copy.setParameters(v.getParameters()); }
    } catch (paramErr) {
        // the marker is still carried
    }
    return copy;
}
function _dbAeCarryEditorMarkers(from, to) {
    var carried = 0;
    try {
        var source = from.property("ADBE Marker");
        var target = to.property("ADBE Marker");
        if (!source || !target || !source.numKeys) {
            return 0;
        }
        var ratio = Math.abs(to.stretch / from.stretch);
        for (var k = 1; k <= source.numKeys; k++) {
            var v = source.keyValue(k);
            if (_dbAeIsOwnMarker(v)) {
                continue;
            }
            var sourceSeconds = (source.keyTime(k) - from.startTime) * 100 / from.stretch;
            var t = to.startTime + sourceSeconds * to.stretch / 100;
            if (target.numKeys && Math.abs(target.keyTime(target.nearestKeyIndex(t)) - t) < 0.00001) {
                continue;
            }
            target.setValueAtTime(t, _dbAeCopyMarkerValue(v, ratio));
            carried++;
        }
    } catch (carryErr) {
        // the pitched layer stands without them; the original keeps them
    }
    return carried;
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
        if (opts && opts.pitchReference) { _dbAssertPitchReference(opts.pitchReference); }
        var comp = _dbAeActiveCompOrThrow();
        var file = new File(mediaPath);
        if (!file.exists) {
            throw new Error("The file is not there any more: " + mediaPath);
        }
        var item = null;
        var folder = null;
        var offlineCopy = false;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (!item && it instanceof FootageItem && it.file && _dbSamePath(it.file.fsName, file.fsName)) {
                // Footage After Effects reports missing is passed over and the
                // file imported again, as in Premiere (_findItemInBinByPath).
                if (it.footageMissing === true) {
                    offlineCopy = true;
                } else {
                    item = it;
                }
            }
            if (!folder && it instanceof FolderItem && it.name === DOWNBEAT_BIN_NAME) {
                folder = it;
            }
        }
        var imported = !item;
        // opts.atSeconds / muteSelected: see host.jsx insertAudioAtPlayhead -
        // here the selected audio layer's sound is switched off.
        var startSeconds = (opts && typeof opts.atSeconds === "number" && isFinite(opts.atSeconds)) ? opts.atSeconds : comp.time;
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
        var reverseLayout = null; // what the reversed layer's check saw (for the log)
        // The step's name in Edit > Undo and the History says what was done.
        var undoName = opts && opts.purpose === "metronome" ? "Downbeat: add metronome" :
            opts && opts.muteSelected ? "Downbeat: change pitch" : "Downbeat: insert sound";
        var layer = _dbAeWithUndo(undoName, function () {
            if (!item) {
                item = app.project.importFile(new ImportOptions(file));
                if (!folder) {
                    folder = app.project.items.addFolder(DOWNBEAT_BIN_NAME);
                }
                item.parentFolder = folder;
            }
            var added = comp.layers.add(item);
            // Downbeat inserts sound. A file with picture (a music video's
            // .mp4) keeps its picture switched off, so the comp looks as
            // before.
            try {
                if (added.hasVideo) { added.enabled = false; }
            } catch (videoErr) {
                // the sound is still inserted
            }
            if (opts && opts.pitchReference) {
                try {
                    _dbAeRemoveOwnMarkers(added.property("ADBE Marker"), -1e20, 1e20);
                } catch (markerErr) { added.remove(); throw markerErr; }
            }
            // Keep the metronome immediately below its selected music layer.
            if (opts && typeof opts.belowLayerIndex === "number") {
                try {
                    added.moveAfter(comp.layer(opts.belowLayerIndex + 1));
                } catch (moveErr) {
                    added.remove();
                    throw new Error("After Effects could not place the metronome below the music.");
                }
            }
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
                    // A reversed layer: whether the part really plays is
                    // asked from the layer itself (active at both ends of
                    // the part, the right source time at each), since its
                    // in / out can read back as set while the layer plays
                    // nothing there. If not, the in and out are set the
                    // other way round and asked again.
                    if (reverse) {
                        reverseLayout = _dbAeCheckReversed(added, startSeconds, wantOut, inSec, outSec, comp.frameRate || 25);
                        if (!reverseLayout.ok) {
                            added.inPoint = wantOut;
                            added.outPoint = startSeconds;
                            var swapped = _dbAeCheckReversed(added, startSeconds, wantOut, inSec, outSec, comp.frameRate || 25);
                            swapped.tried = "in / out swapped (after: " + reverseLayout.seen + ")";
                            reverseLayout = swapped;
                        } else {
                            reverseLayout.tried = "in / out as set";
                        }
                    }
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
                } else if (reverseLayout && reverseLayout.known) {
                    if (!reverseLayout.ok) {
                        failure = "speedFailed";
                    }
                } else if ((inSec > 0 || outSec !== null || sped) &&
                        (Math.abs(Math.min(added.inPoint, added.outPoint) - startSeconds) > tol ||
                         (wantOut !== null && Math.abs(Math.max(added.inPoint, added.outPoint) - wantOut) > tol))) {
                    failure = sped ? "speedFailed" : "trimFailed";
                }
            }
            if (failure) {
                try { added.remove(); } catch (removeErr) { /* reported by the panel's message */ }
                return null;
            }
            if (toMute && opts && opts.pitchReference) {
                _dbAeCarryEditorMarkers(toMute, added);
            }
            var fadeIn = opts ? Number(opts.fadeInSec) || 0 : 0;
            var fadeOut = opts ? Number(opts.fadeOutSec) || 0 : 0;
            if (fadeIn > 0 || fadeOut > 0) {
                var levels = added.property("ADBE Audio Group").property("ADBE Audio Levels");
                var steps = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1];
                // The layer's first and last comp seconds whichever way its
                // in / out are counted (a reversed layer may hold them swapped).
                var layerFrom = Math.min(added.inPoint, added.outPoint);
                var layerTo = Math.max(added.inPoint, added.outPoint);
                var toDb = function (g) { return g <= 0 ? -96 : Math.max(-96, 20 * Math.log(g) / Math.LN10); };
                for (var k = 0; k < steps.length; k++) {
                    if (fadeIn > 0) {
                        var dbIn = toDb(_dbAeFadeGain(steps[k], true, opts.curveIn));
                        levels.setValueAtTime(layerFrom + steps[k] * fadeIn, [dbIn, dbIn]);
                    }
                    if (fadeOut > 0) {
                        var dbOut = toDb(_dbAeFadeGain(steps[k], false, opts.curveOut));
                        levels.setValueAtTime(layerTo - fadeOut + steps[k] * fadeOut, [dbOut, dbOut]);
                    }
                }
            }
            if (toMute) {
                try {
                    toMute.audioEnabled = false;
                } catch (muteErr) {
                // reported below
                }
                if (opts && opts.pitchReference) { _dbAeHandOverCompSet(comp, toMute, added); }
            }
            return added;
        });
        if (failure) {
            var failed = { where: comp.name, stretch: null };
            failed[failure] = true;
            failed.speedResult = { speed: (opts && Number(opts.speed) > 0 ? Number(opts.speed) : 1),
                error: "After Effects could not apply the speed or the trim." + (reverseLayout && reverseLayout.known ? " Reversed layer: " + reverseLayout.tried + "; " + reverseLayout.seen : "") };
            return failed;
        }
        var selected = false;
        if (opts && opts.selectInserted) {
            try {
                for (var sl = 1; sl <= comp.numLayers; sl++) {
                    comp.layer(sl).selected = false;
                }
                layer.selected = true;
                selected = layer.selected === true && comp.selectedLayers.length === 1 &&
                    comp.selectedLayers[0].index === layer.index;
            } catch (selectionErr) { selected = false; /* the panel asks for manual selection */ }
        }
        // `where` is the composition: the panel says "Inserted {name} on
        // {where}", and the layer's own name is the file's.
        return { where: comp.name, layerName: layer.name, startSeconds: startSeconds, imported: imported, offlineCopy: offlineCopy,
            trimmed: !!opts && (Number(opts.inSec) > 0 || Number(opts.outSec) > 0), inPoint: layer.inPoint, outPoint: layer.outPoint,
            stretch: layer.stretch, muted: !!toMute && toMute.audioEnabled === false, selected: selected,
            reverseLayout: reverseLayout && reverseLayout.known ? reverseLayout.tried + "; " + reverseLayout.seen : null };
    });
}
