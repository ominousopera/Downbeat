// ExtendScript host side for Premiere Pro (After Effects calls are forwarded
// to host-ae.jsx). It picks files and folders, reads the selected clip,
// places and clears markers, razors clips and inserts library audio. Every
// public function returns a JSON string { ok, error, data }.
// ES3 engine: no array .filter/.map/.forEach/.some/.every/.find/.includes,
// no spread, no nested ternaries. Plain for-loops and explicit object
// literals only.
#include "json2.js"
// After Effects half: the public functions below forward to it when running
// inside After Effects - see host-ae.jsx's header.
#include "host-ae.jsx"

var TICKS_PER_SECOND = 254016000000;
// Native OS folder picker (used by the Library's Add folder).
// Folder.selectDialog() is standard ExtendScript, not QE DOM, and exists in
// every host app. Returns null (not an error) if the user cancels the
// dialog: cancelling is a normal outcome.
function pickFolder() {
    var result = { ok: false, error: null, data: null };
    try {
        var folder = Folder.selectDialog("Choose a folder of audio files to analyze");
        result.ok = true;
        result.data = { directory: folder ? folder.fsName : null };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Returns { path: null } if the user cancels; that is not an error and
// callers treat it as "nothing to do".
function pickSaveFile(suggestedName, titleText) {
    var result = { ok: false, error: null, data: null };
    try {
        var defaultFile = new File(Folder.desktop.fsName + "/" + (suggestedName || "export.csv"));
        var file = defaultFile.saveDlg(titleText || "Save");
        result.ok = true;
        result.data = { path: file ? file.fsName : null };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Native "open file" dialog for Settings > Library > Load a copy.
// File.openDialog is core ExtendScript, the same in Premiere and After
// Effects. No type filter: its form differs between Mac (a function) and
// Windows (a string), and the panel checks the file's contents anyway.
function pickOpenFile(promptText) {
    var result = { ok: false, error: null, data: null };
    try {
        var file = File.openDialog(promptText || "Choose a file");
        result.ok = true;
        result.data = { path: file ? file.fsName : null };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}

function _getActiveSequenceOrThrow() {
    var sequence = app.project.activeSequence;
    if (!sequence) {
        throw new Error("No active sequence.");
    }
    return sequence;
}
// Returns { clip, trackIndex }.
function _findSelectedAudioClipOrThrow(sequence) {
    var selectedAudioClip = null;
    var selectedAudioTrackIndex = -1;
    var selectedAudioCount = 0;
    var audioTrackCount = sequence.audioTracks.numTracks;
    for (var t = 0; t < audioTrackCount; t++) {
        var audioTrack = sequence.audioTracks[t];
        var audioClipCount = audioTrack.clips.numItems;
        for (var c = 0; c < audioClipCount; c++) {
            var audioClip = audioTrack.clips[c];
            if (audioClip.isSelected()) {
                selectedAudioCount++;
                selectedAudioClip = audioClip;
                selectedAudioTrackIndex = t;
            }
        }
    }

    var selectedVideoCount = 0;
    var videoTrackCount = sequence.videoTracks.numTracks;
    for (var vt = 0; vt < videoTrackCount; vt++) {
        var videoTrack = sequence.videoTracks[vt];
        var videoClipCount = videoTrack.clips.numItems;
        for (var vc = 0; vc < videoClipCount; vc++) {
            var videoClip = videoTrack.clips[vc];
            if (videoClip.isSelected()) {
                selectedVideoCount++;
            }
        }
    }

    if (selectedAudioCount === 0 && selectedVideoCount === 0) {
        throw new Error("Nothing selected. Select one audio clip on the timeline.");
    }
    if (selectedAudioCount === 0 && selectedVideoCount > 0) {
        throw new Error("Selection is video, not audio. Select an audio clip instead.");
    }
    if (selectedAudioCount > 1) {
        throw new Error("More than one audio clip selected (" + selectedAudioCount + "). Select exactly one.");
    }

    return { clip: selectedAudioClip, trackIndex: selectedAudioTrackIndex };
}

function _getFrameRate(sequence) {
    // videoFrameRate is the tick-length of ONE FRAME, not fps directly.
    var settings = sequence.getSettings();
    return TICKS_PER_SECOND / settings.videoFrameRate.ticks;
}
// HH:MM:SS:FF, non-drop-frame.
function _secondsToTimecode(seconds, frameRate) {
    var totalFrames = Math.round(seconds * frameRate);
    var framesPerSecond = Math.round(frameRate);
    var framesPerMinute = framesPerSecond * 60;
    var framesPerHour = framesPerMinute * 60;

    var hh = Math.floor(totalFrames / framesPerHour);
    var rem = totalFrames - hh * framesPerHour;
    var mm = Math.floor(rem / framesPerMinute);
    rem = rem - mm * framesPerMinute;
    var ss = Math.floor(rem / framesPerSecond);
    var ff = rem - ss * framesPerSecond;

    return _pad2(hh) + ":" + _pad2(mm) + ":" + _pad2(ss) + ":" + _pad2(ff);
}

function _pad2(n) {
    return (n < 10 ? "0" : "") + n;
}
function getSelectedAudioInfo() {
    if (_dbIsAe()) {
        return dbAeGetSelectedAudioInfo();
    }
    var result = { ok: false, error: null, data: null };
    try {
        var sequence = _getActiveSequenceOrThrow();
        var found = _findSelectedAudioClipOrThrow(sequence);
        var clip = found.clip;

        var projectItem = clip.projectItem;
        if (!projectItem) {
            throw new Error("The selected clip has no project item.");
        }

        var mediaPath = projectItem.getMediaPath();
        if (!mediaPath) {
            throw new Error("Could not resolve a media file path for the selected clip.");
        }
        // A clip re-sped by the Key tab's pitch plays `speed` times as fast.
        // Its markers live in the file's own seconds, so the used part of the
        // file is the timeline length times the speed from the in point -
        // Premiere's own outPoint is not reliable for that.
        var speed = 1;
        try {
            if (typeof clip.getSpeed === "function") {
                speed = Number(clip.getSpeed()) || 1;
            }
        } catch (speedErr) {
            speed = 1;
        }
        var reversed = false;
        try {
            reversed = typeof clip.isSpeedReversed === "function" && !!clip.isSpeedReversed();
        } catch (reverseErr) {
            reversed = false;
        }
        var inSeconds = clip.inPoint.seconds;
        var outSeconds = Math.abs(speed - 1) > 1e-6 ? inSeconds + (clip.end.seconds - clip.start.seconds) * speed : clip.outPoint.seconds;

        result.ok = true;
        result.data = {
            mediaPath: mediaPath,
            clipStartSeconds: clip.start.seconds,
            inPointSeconds: inSeconds,
            outPointSeconds: outSeconds,
            speed: speed,
            reversed: reversed,
            frameRate: _getFrameRate(sequence),
            trackIndex: found.trackIndex
        };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Marker colors by label, so the marker types can be told apart on the
// timeline without reading the names, and so Premiere's own Markers panel
// (Window > Markers) can filter by color. Uses Marker.setColorByIndex().
var LABEL_COLOR_INDEX = {
    "D": 0, // downbeat - Green
    "b": 6 // beat - Blue
};
var LABEL_COMMENT = {
    "D": "Downbeat (start of a bar/strong beat) - the recommended cut point for a beat-synced edit.",
    "b": "Beat (not a downbeat) - a regular beat, weaker than a downbeat."
};
// LABEL_COMMENT_LOCAL holds the translated explanations set by
// setMarkerComments(); LABEL_COMMENT above is the English fallback.
var LABEL_COMMENT_LOCAL = null;
function setMarkerComments(jsonMap) {
    try {
        LABEL_COMMENT_LOCAL = JSON.parse(jsonMap);
    } catch (e) {
        LABEL_COMMENT_LOCAL = null;
    }
    return "ok";
}

// Applies name + color + a longer explanation to one marker from its label.
// The label is a type code ("D" downbeat or "b" beat, see js/cuesheet.js) or a
// compound "type:name", where the part before the colon picks the color and
// comment and the part after it is shown as the marker's name. Each piece is
// independently best-effort (its own try/catch): a failed color or comment
// assignment must never be reported as a marker-placement failure, since the
// marker was already created by then.
function _applyMarkerLabel(marker, label) {
    if (!label) {
        return;
    }
    var colonIndex = label.indexOf(":");
    var prefix = colonIndex === -1 ? null : label.substring(0, colonIndex);
    var compound = prefix !== null && LABEL_COLOR_INDEX.hasOwnProperty(prefix);
    var typeCode = compound ? prefix : label;
    var displayName = compound ? label.substring(colonIndex + 1) : label;

    try {
        marker.name = displayName;
    } catch (nameError) {
        // Marker was still created - see this function's own header.
    }
    var colorIndex = LABEL_COLOR_INDEX[typeCode];
    if (colorIndex !== undefined) {
        try {
            marker.setColorByIndex(colorIndex);
        } catch (colorError) {
            // Same best-effort treatment as the name assignment above.
        }
    }
    var comment = (LABEL_COMMENT_LOCAL && LABEL_COMMENT_LOCAL[typeCode]) || LABEL_COMMENT[typeCode];
    if (comment) {
        try {
            marker.comments = comment;
        } catch (commentError) {
            // Same best-effort treatment.
        }
    }
}
// labelsJsonArray: optional second JSON array, parallel to times, of short
// marker names ("D"/"b", see js/cuesheet.js) or null entries; see
// _applyMarkerLabel() above for the name/color/comments assignment.
// replaceOwn: true first removes Downbeat's own markers around the selected
// clip, so placing again replaces instead of stacking. Paste markers does not
// pass it.
function createMarkers(secondsJsonArray, labelsJsonArray, replaceOwn) {
    if (_dbIsAe()) {
        return dbAeCreateMarkers(secondsJsonArray, labelsJsonArray, replaceOwn);
    }
    var result = { ok: false, error: null, data: null };
    try {
        var sequence = _getActiveSequenceOrThrow();
        var times = JSON.parse(secondsJsonArray);
        if (!times || times.length === undefined) {
            throw new Error("createMarkers expected a JSON array of numbers.");
        }
        var labels = null;
        if (labelsJsonArray) {
            try {
                labels = JSON.parse(labelsJsonArray);
            } catch (labelParseError) {
                labels = null;
            }
        }

        var replacedCount = 0;
        if (replaceOwn === true) {
            replacedCount = _removeOwnMarkersAroundClip(sequence, _findSelectedAudioClipOrThrow(sequence).clip);
        }

        var createdCount = 0;
        var stored = [];
        for (var i = 0; i < times.length; i++) {
            var marker = sequence.markers.createMarker(times[i]);
            if (marker) {
                createdCount++;
                _noteStored(stored, marker, times[i]);
                if (labels) {
                    _applyMarkerLabel(marker, labels[i]);
                }
            }
        }

        result.ok = true;
        result.data = {
            requested: times.length,
            created: createdCount,
            replaced: replacedCount,
            stored: stored
        };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Removes Downbeat's own markers (those whose name is a label code) between
// fromSeconds and toSeconds from a marker collection and returns how many were
// removed. Other markers (an editor's own, or Downbeat's outside the range,
// since project-item markers are shared by every instance of the media) are
// left alone.
function _removeOwnMarkersInRange(markers, fromSeconds, toSeconds) {
    var epsilon = 0.0005;
    var doomed = [];
    var m = markers.getFirstMarker();
    while (m) {
        var t = m.start.seconds;
        if (LABEL_COLOR_INDEX.hasOwnProperty(m.name) && t >= fromSeconds - epsilon && t <= toSeconds + epsilon) {
            doomed.push(m);
        }
        m = markers.getNextMarker(m);
    }
    for (var i = 0; i < doomed.length; i++) {
        markers.deleteMarker(doomed[i]);
    }
    return doomed.length;
}

function _countOwnMarkersInRange(markers, fromSeconds, toSeconds) {
    var epsilon = 0.0005;
    var count = 0;
    var m = markers.getFirstMarker();
    while (m) {
        var t = m.start.seconds;
        if (LABEL_COLOR_INDEX.hasOwnProperty(m.name) && t >= fromSeconds - epsilon && t <= toSeconds + epsilon) {
            count++;
        }
        m = markers.getNextMarker(m);
    }
    return count;
}
// How many of Downbeat's own markers are around the selected clip - the same
// set placing replaces (sequence markers in its timeline range, clip markers
// in its source in/out). Shift and the "1" buttons ask before they put
// markers down again.
function countOwnMarkersForSelectedClip() {
    if (_dbIsAe()) {
        return dbAeCountOwnMarkersForSelectedClip();
    }
    var result = { ok: false, error: null, data: null };
    try {
        var sequence = _getActiveSequenceOrThrow();
        var clip = _findSelectedAudioClipOrThrow(sequence).clip;
        var count = _countOwnMarkersInRange(sequence.markers, clip.start.seconds, clip.end.seconds);
        var projectItem = clip.projectItem;
        if (projectItem && typeof projectItem.getMarkers === "function") {
            var clipMarkers = projectItem.getMarkers();
            if (clipMarkers) {
                count += _countOwnMarkersInRange(clipMarkers, clip.inPoint.seconds, clip.outPoint.seconds);
            }
        }
        result.ok = true;
        result.data = { count: count };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Removes both kinds of Downbeat marker around one selected clip: sequence
// markers within its timeline range, clip markers within its source in/out
// range.
function _removeOwnMarkersAroundClip(sequence, clip) {
    var removed = _removeOwnMarkersInRange(sequence.markers, clip.start.seconds, clip.end.seconds);
    var projectItem = clip.projectItem;
    if (projectItem && typeof projectItem.getMarkers === "function") {
        var clipMarkers = projectItem.getMarkers();
        if (clipMarkers) {
            removed += _removeOwnMarkersInRange(clipMarkers, clip.inPoint.seconds, clip.outPoint.seconds);
        }
    }
    return removed;
}
// Records what Premiere stored for the first few markers, next to what was
// requested; the panel logs it, which shows whether Premiere rounds marker
// times to frames.
function _noteStored(stored, marker, requestedSeconds) {
    if (stored.length < 3) {
        try {
            stored.push({ requested: requestedSeconds, stored: marker.start.seconds });
        } catch (readError) {
            // reading back is diagnostic only
        }
    }
}

// Clip (project item) markers, as an alternative to sequence markers. Same
// arguments as createMarkers(); times are in the file's own (source) seconds.
// With replaceOwn, Downbeat's own markers around the clip are removed first
// (see _removeOwnMarkersAroundClip()). Paste markers does not pass it.
function createClipMarkers(secondsJsonArray, labelsJsonArray, replaceOwn) {
    if (_dbIsAe()) {
        return dbAeCreateClipMarkers(secondsJsonArray, labelsJsonArray, replaceOwn);
    }
    var result = { ok: false, error: null, data: null };
    try {
        var sequence = _getActiveSequenceOrThrow();
        var found = _findSelectedAudioClipOrThrow(sequence);
        var projectItem = found.clip.projectItem;
        if (!projectItem) {
            throw new Error("The selected clip has no project item.");
        }
        if (typeof projectItem.getMarkers !== "function") {
            throw new Error("This Premiere version does not offer clip markers to scripts.");
        }
        var markers = projectItem.getMarkers();
        if (!markers) {
            throw new Error("projectItem.getMarkers() returned nothing.");
        }

        var times = JSON.parse(secondsJsonArray);
        if (!times || times.length === undefined) {
            throw new Error("createClipMarkers expected a JSON array of numbers.");
        }
        var labels = null;
        if (labelsJsonArray) {
            try {
                labels = JSON.parse(labelsJsonArray);
            } catch (labelParseError) {
                labels = null;
            }
        }

        var replacedCount = 0;
        if (replaceOwn === true) {
            // Removes the sequence markers in the clip's timeline range and
            // the clip markers in its source range.
            replacedCount = _removeOwnMarkersAroundClip(sequence, found.clip);
        }

        var createdCount = 0;
        var stored = [];
        for (var i = 0; i < times.length; i++) {
            var marker = markers.createMarker(times[i]);
            if (marker) {
                createdCount++;
                _noteStored(stored, marker, times[i]);
                if (labels) {
                    _applyMarkerLabel(marker, labels[i]);
                }
            }
        }

        result.ok = true;
        result.data = {
            requested: times.length,
            created: createdCount,
            replaced: replacedCount,
            stored: stored
        };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Shared by testRazorAtSeconds() and razorAtManySeconds().
function _getQeAudioTrackOrThrow(trackIndex) {
    if (typeof app.enableQE === "function") {
        app.enableQE();
    } else {
        throw new Error("This Premiere version does not expose the editing API needed for cutting.");
    }
    if (typeof qe === "undefined" || !qe) {
        throw new Error("Premiere's editing API did not respond; cutting is not available here.");
    }
    var qeSequence = qe.project.getActiveSequence();
    if (!qeSequence) {
        throw new Error("Premiere's editing API did not respond; cutting is not available here.");
    }
    var qeTrack = qeSequence.getAudioTrackAt(trackIndex);
    if (!qeTrack) {
        throw new Error("qeSequence.getAudioTrackAt(" + trackIndex + ") returned nothing; cutting is not available here.");
    }
    return qeTrack;
}
function testRazorAtSeconds(secondsValue) {
    if (_dbIsAe()) {
        return dbAeTestRazorAtSeconds(secondsValue);
    }
    var result = { ok: false, error: null, data: null };
    try {
        var targetSeconds = Number(secondsValue);
        if (isNaN(targetSeconds)) {
            throw new Error("testRazorAtSeconds expected a number.");
        }

        var sequence = _getActiveSequenceOrThrow();
        var found = _findSelectedAudioClipOrThrow(sequence);
        var trackIndex = found.trackIndex;
        var frameRate = _getFrameRate(sequence);
        var qeTrack = _getQeAudioTrackOrThrow(trackIndex);

        var timecode = _secondsToTimecode(targetSeconds, frameRate);
        var razorReturn = qeTrack.razor(timecode);
        // Re-read the standard DOM after the cut to report real boundaries -
        // do not trust razorReturn alone as proof of where the cut landed.
        var audioTrack = sequence.audioTracks[trackIndex];
        var clipCount = audioTrack.clips.numItems;
        var nearbyClips = [];
        for (var c = 0; c < clipCount; c++) {
            var clip = audioTrack.clips[c];
            var startSec = clip.start.seconds;
            var endSec = clip.end.seconds;
            // Report anything within 2 seconds of the target so the actual
            // cut position is visible even if it landed somewhere unexpected.
            if (Math.abs(startSec - targetSeconds) < 2 || Math.abs(endSec - targetSeconds) < 2) {
                nearbyClips.push({ name: clip.name, startSeconds: startSec, endSeconds: endSec });
            }
        }

        result.ok = true;
        result.data = {
            requestedSeconds: targetSeconds,
            timecodeSent: timecode,
            frameRate: frameRate,
            razorReturnValue: String(razorReturn),
            clipCountOnTrackAfter: clipCount,
            nearbyClipsAfterCut: nearbyClips
        };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Cuts the selected clip's track at every absolute sequence time in the
// given JSON array (already offset-mapped by the panel, see js/cuesheet.js
// and js/place.js).
function razorAtManySeconds(secondsJsonArray) {
    if (_dbIsAe()) {
        return dbAeRazorAtManySeconds(secondsJsonArray);
    }
    var result = { ok: false, error: null, data: null };
    try {
        var times = JSON.parse(secondsJsonArray);
        if (!times || times.length === undefined) {
            throw new Error("razorAtManySeconds expected a JSON array of numbers.");
        }

        var sequence = _getActiveSequenceOrThrow();
        var found = _findSelectedAudioClipOrThrow(sequence);
        var trackIndex = found.trackIndex;
        var frameRate = _getFrameRate(sequence);
        var qeTrack = _getQeAudioTrackOrThrow(trackIndex);

        var cutCount = 0;
        var failures = [];
        for (var i = 0; i < times.length; i++) {
            var targetSeconds = times[i];
            try {
                var timecode = _secondsToTimecode(targetSeconds, frameRate);
                var razorReturn = qeTrack.razor(timecode);
                if (razorReturn) {
                    cutCount++;
                } else {
                    failures.push({ seconds: targetSeconds, reason: "razor() returned a falsy value" });
                }
            } catch (cutError) {
                failures.push({
                    seconds: targetSeconds,
                    reason: cutError.message ? cutError.message : cutError.toString()
                });
            }
        }

        result.ok = true;
        result.data = {
            requested: times.length,
            cut: cutCount,
            failures: failures
        };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Cleanup for the two kinds of markers this plugin can create, scoped to the
// selected clip only: it never deletes every marker in the sequence, which
// would also wipe markers an editor placed by hand. Unlike
// createClipMarkers()'s replaceOwn, Clear is not limited to this instance's
// in/out range: it means "start over", so every Downbeat marker on the media
// goes, also on the other pieces after a cut. "Remove from source after
// copy" calls it without the flag: a move removes everything it copied.
function clearMarkersForSelectedClip(ownOnly) {
    if (_dbIsAe()) {
        return dbAeClearMarkersForSelectedClip(ownOnly);
    }
    var result = { ok: false, error: null, data: null };
    try {
        var sequence = _getActiveSequenceOrThrow();
        var found = _findSelectedAudioClipOrThrow(sequence);
        var clip = found.clip;
        var clipStart = clip.start.seconds;
        var clipEnd = clip.end.seconds;
        var epsilon = 0.0005;

        var sequenceMarkersRemoved = 0;
        var seqMarkers = sequence.markers;
        var seqToDelete = [];
        var sm = seqMarkers.getFirstMarker();
        while (sm) {
            var markerSeconds = sm.start.seconds;
            if (markerSeconds >= clipStart - epsilon && markerSeconds <= clipEnd + epsilon &&
                    (ownOnly !== true || LABEL_COLOR_INDEX.hasOwnProperty(sm.name))) {
                seqToDelete.push(sm);
            }
            sm = seqMarkers.getNextMarker(sm);
        }
        for (var i = 0; i < seqToDelete.length; i++) {
            seqMarkers.deleteMarker(seqToDelete[i]);
            sequenceMarkersRemoved++;
        }

        var clipMarkersRemoved = 0;
        var clipMarkersAttempted = false;
        var projectItem = clip.projectItem;
        if (projectItem && typeof projectItem.getMarkers === "function") {
            clipMarkersAttempted = true;
            var clipMarkers = projectItem.getMarkers();
            if (clipMarkers) {
                if (ownOnly === true) {
                    clipMarkersRemoved = _removeOwnMarkersInRange(clipMarkers, -1e9, 1e9);
                } else {
                    var clipToDelete = [];
                    var cm = clipMarkers.getFirstMarker();
                    while (cm) {
                        clipToDelete.push(cm);
                        cm = clipMarkers.getNextMarker(cm);
                    }
                    for (var j = 0; j < clipToDelete.length; j++) {
                        clipMarkers.deleteMarker(clipToDelete[j]);
                        clipMarkersRemoved++;
                    }
                }
            }
        }

        result.ok = true;
        result.data = {
            sequenceMarkersRemoved: sequenceMarkersRemoved,
            clipMarkersRemoved: clipMarkersRemoved,
            clipMarkersAttempted: clipMarkersAttempted,
            clipStartSeconds: clipStart,
            clipEndSeconds: clipEnd
        };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// Read-only companion to clearMarkersForSelectedClip() above, for js/main.js's
// "Copy markers" / "Paste markers here". Same scoping as the clear function,
// but it returns the marker data instead of deleting it. Times are returned
// clip-local (sequence markers: marker seconds - clip.start.seconds; clip
// markers are already source-relative, see createClipMarkers()), so the
// panel can re-anchor them onto any other clip or sequence by adding that
// clip's own start time. Moving markers to another sequence is therefore:
// copy here, select the target clip, paste there.
// `label` in the returned data is each marker's own `.name`. Color and
// comments are not returned, because pasting goes through createMarkers() /
// createClipMarkers(), which re-apply them from that name via
// _applyMarkerLabel().
function getMarkersDataForSelectedClip() {
    if (_dbIsAe()) {
        return dbAeGetMarkersDataForSelectedClip();
    }
    var result = { ok: false, error: null, data: null };
    try {
        var sequence = _getActiveSequenceOrThrow();
        var found = _findSelectedAudioClipOrThrow(sequence);
        var clip = found.clip;
        var clipStart = clip.start.seconds;
        var clipEnd = clip.end.seconds;
        var epsilon = 0.0005;

        var sequenceMarkers = [];
        var seqMarkers = sequence.markers;
        var sm = seqMarkers.getFirstMarker();
        while (sm) {
            var markerSeconds = sm.start.seconds;
            if (markerSeconds >= clipStart - epsilon && markerSeconds <= clipEnd + epsilon) {
                sequenceMarkers.push({ localSeconds: markerSeconds - clipStart, label: sm.name });
            }
            sm = seqMarkers.getNextMarker(sm);
        }

        var clipMarkers = [];
        var projectItem = clip.projectItem;
        if (projectItem && typeof projectItem.getMarkers === "function") {
            var pMarkers = projectItem.getMarkers();
            if (pMarkers) {
                var cm = pMarkers.getFirstMarker();
                while (cm) {
                    clipMarkers.push({ localSeconds: cm.start.seconds, label: cm.name });
                    cm = pMarkers.getNextMarker(cm);
                }
            }
        }

        result.ok = true;
        result.data = {
            clipName: clip.name,
            sequenceMarkers: sequenceMarkers,
            clipMarkers: clipMarkers
        };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
// LIBRARY INSERT. Puts an audio file from the Library tab on the timeline at
// the playhead: imported into a "Downbeat" bin (or reused from there when
// already imported), then placed with overwriteClip() on the first unlocked
// audio track that is empty for the sound's whole length - so nothing already
// on the timeline is ever overwritten. With no such track it refuses with a
// clear message instead.
var DOWNBEAT_BIN_NAME = "Downbeat";

function _dbSamePath(a, b) {
    var na = String(a).replace(/\\/g, "/");
    var nb = String(b).replace(/\\/g, "/");
    if ($.os && String($.os).indexOf("Windows") !== -1) {
        return na.toLowerCase() === nb.toLowerCase();
    }
    return na === nb;
}

function _findOrCreateDownbeatBin() {
    var binType = (typeof ProjectItemType !== "undefined" && ProjectItemType.BIN !== undefined) ? ProjectItemType.BIN : 2;
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var child = root.children[i];
        if (child.type === binType && child.name === DOWNBEAT_BIN_NAME) {
            return child;
        }
    }
    return root.createBin(DOWNBEAT_BIN_NAME);
}

function _findItemInBinByPath(bin, mediaPath) {
    for (var i = 0; i < bin.children.numItems; i++) {
        var child = bin.children[i];
        var childPath = null;
        try {
            childPath = child.getMediaPath();
        } catch (e) {
            childPath = null; // bins and other items without media
        }
        if (childPath && _dbSamePath(childPath, mediaPath)) {
            return child;
        }
    }
    return null;
}

// The three audio crossfades under their names in the languages Premiere
// is shipped in. QE looks a transition up by the name shown in the
// interface, so on a Premiere that is not in English the English name finds
// nothing. The list of what this Premiere offers is read as well, to match
// by name ignoring case and, as a last resort, to report in the log.
var _TRANSITION_NAMES = {
    "Constant Power": ["Constant Power", "\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u0430\u044f \u043c\u043e\u0449\u043d\u043e\u0441\u0442\u044c", "Potencia constante", "Konstante Leistung", "Puissance constante", "\u30b3\u30f3\u30b9\u30bf\u30f3\u30c8\u30d1\u30ef\u30fc", "Pot\u00eancia constante", "Potenza costante"],
    "Constant Gain": ["Constant Gain", "\u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u043e\u0435 \u0443\u0441\u0438\u043b\u0435\u043d\u0438\u0435", "Ganancia constante", "Konstante Verst\u00e4rkung", "Gain constant", "\u30b3\u30f3\u30b9\u30bf\u30f3\u30c8\u30b2\u30a4\u30f3", "Ganho constante", "Guadagno costante"],
    "Exponential Fade": ["Exponential Fade", "\u042d\u043a\u0441\u043f\u043e\u043d\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u043e\u0435 \u0437\u0430\u0442\u0443\u0445\u0430\u043d\u0438\u0435", "\u042d\u043a\u0441\u043f\u043e\u043d\u0435\u043d\u0446\u0438\u0430\u043b\u044c\u043d\u044b\u0439 \u0441\u043f\u0430\u0434", "Fundido exponencial", "Exponentielles Ausblenden", "Fondu exponentiel", "\u30a8\u30af\u30b9\u30dd\u30cd\u30f3\u30b7\u30e3\u30eb\u30d5\u30a7\u30fc\u30c9", "Fade exponencial", "Dissolvenza esponenziale"]
};
function _findAudioTransition(name) {
    var result = { transition: null, usedName: null, available: null, byPosition: false };
    var candidates = _TRANSITION_NAMES[name] || [name];
    var i;
    for (i = 0; i < candidates.length; i++) {
        var t = null;
        try { t = qe.project.getAudioTransitionByName(candidates[i]); } catch (e1) { t = null; }
        if (t) {
            result.transition = t;
            result.usedName = candidates[i];
            return result;
        }
    }
    try {
        var list = qe.project.getAudioTransitionList();
        var names = [];
        for (var k = 0; list && k < list.length; k++) { names.push(String(list[k])); }
        result.available = names.join(", ");
        for (i = 0; i < candidates.length; i++) {
            for (var n = 0; n < names.length; n++) {
                if (names[n].toLowerCase() === candidates[i].toLowerCase()) {
                    var byList = null;
                    try { byList = qe.project.getAudioTransitionByName(names[n]); } catch (e2) { byList = null; }
                    if (byList) {
                        result.transition = byList;
                        result.usedName = names[n];
                        return result;
                    }
                }
            }
        }
        // Last resort for an interface language whose names are not in
        // the list above: Premiere offers the three crossfades in a fixed
        // order (Constant Gain, Constant Power, Exponential Fade) in every
        // language, so take the entry by position when the list holds
        // exactly those three. The caller says so in its result, since a
        // different order would mean the wrong curve.
        var position = -1;
        if (name === "Constant Gain") { position = 0; }
        if (name === "Constant Power") { position = 1; }
        if (name === "Exponential Fade") { position = 2; }
        if (position >= 0 && names.length === 3) {
            var byPosition = null;
            try { byPosition = qe.project.getAudioTransitionByName(names[position]); } catch (e4) { byPosition = null; }
            if (byPosition) {
                result.transition = byPosition;
                result.usedName = names[position];
                result.byPosition = true;
                return result;
            }
        }
    } catch (e3) {
        result.available = null;
    }
    return result;
}

// One fade edge: the standard QE call first, and when the host answers
// false although the transition was found, the same request in other forms
// until one is taken: with the placed clip selected, with the linked media
// switched on, with the length as a number, in the short form, and as a
// timecode. The first one that works is named in the result and the log;
// when none does, the trail of answers says what each one said. Plain
// if / else and loops: this engine has no array methods.
function _timecodeFor(frames, fps) {
    var base = Math.max(1, Math.round(fps));
    var ff = frames % base;
    var totalSeconds = Math.floor(frames / base);
    var ss = totalSeconds % 60;
    var mm = Math.floor(totalSeconds / 60) % 60;
    var hh = Math.floor(totalSeconds / 3600);
    function two(n) { return n < 10 ? "0" + n : String(n); }
    return two(hh) + ":" + two(mm) + ":" + two(ss) + ":" + two(ff);
}
function _addOneFade(qeItem, transition, atStart, frames, fps, placedClip) {
    var result = { ok: false, variant: null, trail: [] };
    var variants = ["standard", "clip selected", "linked media on", "length as a number", "short form", "timecode length", "alignment 1", "alignment 2"];
    for (var v = 0; v < variants.length; v++) {
        var answer = null;
        try {
            if (v === 0) {
                answer = qeItem.addTransition(transition, atStart, String(frames), "0", 0, true, false);
            } else if (v === 1) {
                if (placedClip && typeof placedClip.setSelected === "function") {
                    placedClip.setSelected(true, true);
                }
                answer = qeItem.addTransition(transition, atStart, String(frames), "0", 0, true, false);
            } else if (v === 2) {
                answer = qeItem.addTransition(transition, atStart, String(frames), "0", 0, true, true);
            } else if (v === 3) {
                answer = qeItem.addTransition(transition, atStart, frames, 0, 0, true, false);
            } else if (v === 4) {
                answer = qeItem.addTransition(transition, atStart, String(frames));
            } else if (v === 5) {
                answer = qeItem.addTransition(transition, atStart, _timecodeFor(frames, fps), "0", 0, true, false);
            } else {
                // The alignment of the transition on the edit: the standard
                // form passes 0; a clip with no media beyond its edge may
                // only take one aligned to that edge.
                answer = qeItem.addTransition(transition, atStart, String(frames), "0", v - 5, true, false);
            }
            result.trail.push(variants[v] + ": " + (answer ? "taken" : "refused"));
        } catch (callErr) {
            answer = null;
            result.trail.push(variants[v] + ": " + (callErr.message ? callErr.message : String(callErr)));
        }
        if (answer) {
            result.ok = true;
            result.variant = variants[v];
            return result;
        }
    }
    return result;
}

// The QE clip at startSeconds on audio track `target`, looked up again
// from a fresh QE sequence. QE does not always update itself right after
// an edit made in the same script, so a clip placed a moment ago may be
// refused through the object found then and taken through a new one.
function _freshQeClipAt(target, startSeconds) {
    if (typeof $ !== "undefined" && $ && typeof $.sleep === "function") {
        $.sleep(300);
    }
    var qeTrack = _getQeAudioTrackOrThrow(target);
    for (var i = 0; i < qeTrack.numItems; i++) {
        var it = qeTrack.getItemAt(i);
        if (it && it.type === "Clip" && Math.abs(it.start.secs - startSeconds) < 0.02) {
            return it;
        }
    }
    return null;
}

// A second try at the fades, in a script call of its own (the panel makes
// it a moment after the insert when Premiere refused them): the clip placed
// by the earlier call is found again on track `target` at startSeconds and
// the fades named in optsJson are asked for once more, the same way.
function retryEdgeFades(target, startSeconds, optsJson) {
    var result = { ok: false };
    try {
        var opts = JSON.parse(optsJson);
        var sequence = _getActiveSequenceOrThrow();
        result.data = _addEdgeFades(sequence, Number(target), Number(startSeconds), opts);
        result.ok = true;
    } catch (e) {
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}

// Adds Premiere audio transitions as edge fades to the clip that starts at
// startSeconds on audio track `target`, through the QE API (the way a script
// can put fades on a clip that stay editable). opts: fadeInSec, fadeOutSec
// and transitionIn / transitionOut (transition names, default "Constant
// Power"); a fade lasts round(seconds * frame rate) frames, at least 1. Each
// side is best-effort, and addTransition's return value is not proof, so the
// result says only what was asked for.
function _addEdgeFades(sequence, target, startSeconds, opts) {
    var out = { fadeIn: null, fadeOut: null, qeMembers: null, error: null };
    try {
        var fps = _getFrameRate(sequence);
        var qeTrack = _getQeAudioTrackOrThrow(target);
        var qeItem = null;
        for (var i = 0; i < qeTrack.numItems; i++) {
            var it = qeTrack.getItemAt(i);
            if (it && it.type === "Clip" && Math.abs(it.start.secs - startSeconds) < 0.02) {
                qeItem = it;
                break;
            }
        }
        if (!qeItem) {
            throw new Error("the placed clip was not found on the QE track");
        }
        try {
            var wanted = /fade|curve|transition/i;
            var members = [];
            var ms = qeItem.reflect.methods;
            for (var m = 0; m < ms.length; m++) { if (wanted.test(ms[m].name)) { members.push(ms[m].name + "()"); } }
            var ps = qeItem.reflect.properties;
            for (var q = 0; q < ps.length; q++) { if (wanted.test(ps[q].name)) { members.push(ps[q].name); } }
            out.qeMembers = members;
        } catch (reflectErr) {
            out.qeMembers = null;
        }
        try {
            var qms = qeItem.reflect.methods;
            for (var qm = 0; qm < qms.length; qm++) {
                if (qms[qm].name === "addTransition" && qms[qm].arguments) {
                    var argText = [];
                    for (var qa = 0; qa < qms[qm].arguments.length; qa++) {
                        argText.push(qms[qm].arguments[qa].name + ":" + qms[qm].arguments[qa].dataType);
                    }
                    out.addTransitionArgs = argText.join(", ");
                }
            }
            out.clipSeen = { type: String(qeItem.type), start: qeItem.start ? qeItem.start.secs : null, fps: fps };
            // How much of the file lies beyond each edge of the clip (a
            // transition centred on an edge needs some), and what the
            // standard clip object offers about fades in this Premiere.
            var placedStd = _findClipStartingAt(sequence.audioTracks[target], startSeconds);
            if (placedStd) {
                out.clipSeen.mediaBefore = placedStd.inPoint ? placedStd.inPoint.seconds : null;
                try {
                    var mediaEnd = placedStd.projectItem && typeof placedStd.projectItem.getOutPoint === "function" ? placedStd.projectItem.getOutPoint() : null;
                    out.clipSeen.mediaAfter = mediaEnd && placedStd.outPoint ? mediaEnd.seconds - placedStd.outPoint.seconds : null;
                } catch (endErr) {
                    out.clipSeen.mediaAfter = null;
                }
                try {
                    var stdMembers = [];
                    var sm = placedStd.reflect.methods;
                    for (var si = 0; si < sm.length; si++) { if (wanted.test(sm[si].name)) { stdMembers.push(sm[si].name + "()"); } }
                    var sp = placedStd.reflect.properties;
                    for (var sj = 0; sj < sp.length; sj++) { if (wanted.test(sp[sj].name)) { stdMembers.push(sp[sj].name); } }
                    out.clipMembers = stdMembers;
                } catch (stdReflectErr) {
                    out.clipMembers = null;
                }
            }
        } catch (argsErr) {
            out.addTransitionArgs = null;
        }
        var sides = [["fadeIn", true, Number(opts.fadeInSec) || 0, opts.transitionIn], ["fadeOut", false, Number(opts.fadeOutSec) || 0, opts.transitionOut]];
        for (var sIdx = 0; sIdx < sides.length; sIdx++) {
            var side = sides[sIdx];
            if (!(side[2] > 0)) {
                continue;
            }
            var name = side[3] || "Constant Power";
            var frames = Math.max(1, Math.round(side[2] * fps));
            var asked = false;
            var why = null;
            var shownName = name;
            try {
                var found = _findAudioTransition(name);
                shownName = found.usedName || name;
                if (!found.transition) {
                    why = "no audio transition named " + name + " (this Premiere offers: " + (found.available || "unknown") + ")";
                } else {
                    var tried = _addOneFade(qeItem, found.transition, side[1], frames, fps, _findClipStartingAt(sequence.audioTracks[target], startSeconds));
                    if (!tried.ok) {
                        try {
                            var freshItem = _freshQeClipAt(target, startSeconds);
                            var freshAnswer = freshItem ? freshItem.addTransition(found.transition, side[1], String(frames), "0", 0, true, false) : false;
                            tried.trail.push("fresh clip lookup after a pause: " + (freshItem ? (freshAnswer ? "taken" : "refused") : "clip not found"));
                            if (freshAnswer) {
                                tried.ok = true;
                                tried.variant = "fresh clip lookup after a pause";
                                qeItem = freshItem;
                            }
                        } catch (freshErr) {
                            tried.trail.push("fresh clip lookup after a pause: " + (freshErr.message ? freshErr.message : String(freshErr)));
                        }
                    }
                    asked = tried.ok;
                    if (!asked) {
                        why = "Premiere refused the transition (" + tried.trail.join("; ") + ")";
                    } else if (tried.variant !== "standard") {
                        why = "the standard call was refused; taken as: " + tried.variant;
                    } else if (found.byPosition) {
                        // No name matched, so the transition was taken by
                        // its place in the list. Said out loud: a Premiere
                        // that orders them differently would otherwise get
                        // the wrong curve with nothing to show it.
                        why = "no name matched, taken by position in the list (" + (found.available || "unknown") + ")";
                    }
                }
            } catch (sideErr) {
                asked = false;
                why = sideErr.message ? sideErr.message : String(sideErr);
            }
            out[side[0]] = { transition: shownName, frames: frames, asked: asked, why: why };
        }
    } catch (e) {
        out.error = e.message ? e.message : e.toString();
    }
    return out;
}
// The clip on `track` that starts at startSeconds (within 20 ms), or null.
function _findClipStartingAt(track, startSeconds) {
    for (var k = 0; k < track.clips.numItems; k++) {
        if (Math.abs(track.clips[k].start.seconds - startSeconds) < 0.02) {
            return track.clips[k];
        }
    }
    return null;
}
// Sets the speed (and optionally reverses) the clip that starts at
// startSeconds on audio track `target` through the QE setSpeed(), then trims
// its end to timelineLength seconds (a re-sped clip keeps its source length
// otherwise). Reads the clip back and returns { ok, speed, reversed, length,
// error, args }; ok is true only if the speed, length and direction match.
function _applyClipSpeed(sequence, target, startSeconds, speed, reverse, timelineLength) {
    var out = { ok: false, error: null, speed: null, reversed: null, length: null, args: null };
    try {
        var qeTrack = _getQeAudioTrackOrThrow(target);
        var qeItem = null;
        for (var i = 0; i < qeTrack.numItems; i++) {
            var it = qeTrack.getItemAt(i);
            if (it && it.type === "Clip" && Math.abs(it.start.secs - startSeconds) < 0.02) {
                qeItem = it;
                break;
            }
        }
        if (!qeItem) {
            throw new Error("the placed clip was not found on the QE track");
        }
        try {
            var ms = qeItem.reflect.methods;
            for (var m = 0; m < ms.length; m++) {
                if (ms[m].name === "setSpeed" && ms[m].arguments) {
                    out.args = [];
                    for (var a = 0; a < ms[m].arguments.length; a++) {
                        out.args.push(ms[m].arguments[a].name + ":" + ms[m].arguments[a].dataType);
                    }
                }
            }
        } catch (reflectErr) {
            out.args = null;
        }
        qeItem.setSpeed(speed, "", !!reverse, false, false);
        var clip = _findClipStartingAt(sequence.audioTracks[target], startSeconds);
        if (!clip) {
            throw new Error("the clip moved when its speed was set");
        }
        var end = new Time();
        end.seconds = startSeconds + timelineLength;
        clip.end = end;
        clip = _findClipStartingAt(sequence.audioTracks[target], startSeconds);
        out.speed = typeof clip.getSpeed === "function" ? clip.getSpeed() : null;
        out.reversed = typeof clip.isSpeedReversed === "function" ? !!clip.isSpeedReversed() : null;
        out.length = clip.end.seconds - clip.start.seconds;
        var frame = 1 / Math.max(1, _getFrameRate(sequence));
        out.ok = out.speed !== null && Math.abs(out.speed - speed) < 0.01 &&
            Math.abs(out.length - timelineLength) <= Math.max(0.05, 1.5 * frame) &&
            (out.reversed === null || out.reversed === !!reverse);
    } catch (e) {
        out.error = e.message ? e.message : e.toString();
    }
    return out;
}
// optsJson: { inSec, outSec, fadeInSec, fadeOutSec, transitionIn,
// transitionOut, speed, reverse, atSeconds, muteSelected }. The original file
// is inserted, trimmed to inSec..outSec of the source, with Premiere's own
// transitions on its edges so the fades stay editable on the timeline.
// Trimming goes through the project item's in / out points, which are cleared
// again right after the insert so the bin item stays whole. Times in opts
// are file seconds; speed / reverse are applied to the placed clip.
function insertAudioAtPlayhead(mediaPathJson, durationSeconds, optsJson) {
    if (_dbIsAe()) {
        return dbAeInsertAudioAtPlayhead(mediaPathJson, durationSeconds, optsJson);
    }
    var result = { ok: false, error: null, data: null };
    try {
        var mediaPath = JSON.parse(mediaPathJson);
        var sequence = _getActiveSequenceOrThrow();
        var file = new File(mediaPath);
        if (!file.exists) {
            throw new Error("The file is not there any more: " + mediaPath);
        }
        var opts = null;
        try {
            opts = optsJson ? JSON.parse(optsJson) : null;
        } catch (optsErr) {
            opts = null;
        }
        // opts.atSeconds: place at that time instead of the playhead;
        // opts.muteSelected then switches the selected clip off (Disable), so
        // the inserted clip is what plays and the original is one click from
        // coming back.
        var position = sequence.getPlayerPosition();
        if (opts && typeof opts.atSeconds === "number" && opts.atSeconds >= 0) {
            position = new Time();
            position.seconds = opts.atSeconds;
        }
        var startSeconds = position.seconds;
        var toMute = null;
        if (opts && opts.muteSelected) {
            try {
                toMute = _findSelectedAudioClipOrThrow(sequence).clip;
            } catch (selErr) {
                toMute = null;
            }
        }
        var inSec = opts && Number(opts.inSec) > 0 ? Number(opts.inSec) : 0;
        var outSec = opts && Number(opts.outSec) > inSec ? Number(opts.outSec) : null;
        var trim = inSec > 0 || outSec !== null;
        var whole = Number(durationSeconds) > 0 ? Number(durationSeconds) : 0.1;
        var length = outSec !== null ? outSec - inSec : Math.max(0.01, whole - inSec);
        var speed = opts && Number(opts.speed) > 0 ? Number(opts.speed) : 1;
        var reverse = !!(opts && opts.reverse);
        var sped = Math.abs(speed - 1) > 1e-6 || reverse;
        var sourceLength = length;
        length = length / speed; // on the timeline
        var target = -1;
        for (var t = 0; t < sequence.audioTracks.numTracks && target === -1; t++) {
            var track = sequence.audioTracks[t];
            var locked = false;
            try {
                locked = typeof track.isLocked === "function" && track.isLocked();
            } catch (lockErr) {
                locked = false;
            }
            if (locked) {
                continue;
            }
            var free = true;
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                // The clip is first laid down at the file's own length and
                // only then re-sped (shorter when pitched up), so the track
                // must be free for the longer of the two or the insert would
                // overwrite what follows.
                if (clip.start.seconds < startSeconds + Math.max(length, sourceLength) - 0.001 && clip.end.seconds > startSeconds + 0.001) {
                    free = false;
                    break;
                }
            }
            if (free) {
                target = t;
            }
        }
        if (target === -1) {
            throw new Error("No free audio track at the playhead for this " + length.toFixed(1) + " s sound. Add an audio track or move the playhead.");
        }

        var bin = _findOrCreateDownbeatBin();
        var item = _findItemInBinByPath(bin, mediaPath);
        var imported = false;
        if (!item) {
            app.project.importFiles([file.fsName], true, bin, false);
            item = _findItemInBinByPath(bin, mediaPath);
            if (!item) {
                throw new Error("Premiere did not import the file.");
            }
            imported = true;
        }

        if (trim) {
            try {
                item.setInPoint(inSec, 4); // 4 = every media type
                if (outSec !== null) {
                    item.setOutPoint(outSec, 4);
                }
            } catch (inOutErr) {
                trim = false; // checked below by the placed clip's length
            }
        }
        try {
            sequence.audioTracks[target].overwriteClip(item, position);
        } finally {
            if (opts && (inSec > 0 || outSec !== null)) {
                try { item.clearInPoint(); } catch (clearInErr) { /* the bin item then keeps the marks */ }
                try { item.clearOutPoint(); } catch (clearOutErr) { /* same */ }
            }
        }
        // Read the timeline back rather than trusting the call.
        var placedClip = null;
        var targetTrack = sequence.audioTracks[target];
        for (var k = 0; k < targetTrack.clips.numItems; k++) {
            if (Math.abs(targetTrack.clips[k].start.seconds - startSeconds) < 0.02) {
                placedClip = targetTrack.clips[k];
                break;
            }
        }
        if (!placedClip) {
            throw new Error("Premiere did not place the clip on A" + (target + 1) + ".");
        }
        if (opts && (inSec > 0 || outSec !== null)) {
            var placedLength = placedClip.end.seconds - placedClip.start.seconds;
            var placedIn = placedClip.inPoint ? placedClip.inPoint.seconds : 0;
            if (Math.abs(placedLength - sourceLength) > Math.max(0.05, 2 / Math.max(1, _getFrameRate(sequence))) || Math.abs(placedIn - inSec) > 0.05) {
                try { placedClip.remove(false, false); } catch (removeErr) { /* reported below */ }
                result.ok = true;
                result.data = { trimFailed: true, where: "A" + (target + 1), placedLength: placedLength, placedIn: placedIn };
                return JSON.stringify(result);
            }
        }
        var speedResult = null;
        if (sped) {
            speedResult = _applyClipSpeed(sequence, target, startSeconds, speed, reverse, length);
            if (!speedResult.ok) {
                var spedClip = _findClipStartingAt(targetTrack, startSeconds);
                try { if (spedClip) { spedClip.remove(false, false); } } catch (removeSpeedErr) { /* reported below */ }
                result.ok = true;
                result.data = { speedFailed: true, where: "A" + (target + 1), speedResult: speedResult };
                return JSON.stringify(result);
            }
        }
        var fades = null;
        if (opts && (Number(opts.fadeInSec) > 0 || Number(opts.fadeOutSec) > 0)) {
            fades = _addEdgeFades(sequence, target, startSeconds, opts);
        }
        var muted = false;
        if (toMute) {
            try {
                toMute.disabled = true;
                muted = toMute.disabled === true;
            } catch (muteErr) {
                muted = false;
            }
        }
        result.ok = true;
        result.data = { where: "A" + (target + 1), target: target, startSeconds: startSeconds, imported: imported, trimmed: !!opts && (inSec > 0 || outSec !== null), fades: fades, muted: muted, speed: speedResult };
    } catch (e) {
        result.ok = false;
        result.error = e.message ? e.message : e.toString();
    }
    return JSON.stringify(result);
}
