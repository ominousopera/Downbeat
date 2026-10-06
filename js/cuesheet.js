// Cuesheet data and beat-time math: maps detected beat times onto the
// timeline or the clip's source time, evens out beat jitter, snaps to video
// frames, and builds the downbeat and labeled-beat tracks. Pure functions;
// runs in the panel's Chromium context, so modern JS is fine here, unlike
// jsx/host.jsx.
(function (global) {
  "use strict";
  // A tiny cuesheet for the self-test: 8 beats at 120 BPM (0.5 s apart),
  // starting 1 s into the source file. Labelled "b" like every marker
  // Downbeat places, so Clear markers (which removes only Downbeat's own
  // markers) cleans them up.
  var TEST_CUESHEET = {
    version: "1.0",
    source: "manual",
    audio: { path: null, sampleRate: 44100, durationSec: null },
    bpm: 120.0,
    tracks: [
      {
        id: "beats",
        type: "impulse",
        events: [
          { t: 1.0, conf: 1.0, label: "b" },
          { t: 1.5, conf: 1.0, label: "b" },
          { t: 2.0, conf: 1.0, label: "b" },
          { t: 2.5, conf: 1.0, label: "b" },
          { t: 3.0, conf: 1.0, label: "b" },
          { t: 3.5, conf: 1.0, label: "b" },
          { t: 4.0, conf: 1.0, label: "b" },
          { t: 4.5, conf: 1.0, label: "b" }
        ]
      }
    ]
  };

  function _findTrackOrThrow(cuesheet, trackId) {
    for (var i = 0; i < cuesheet.tracks.length; i++) {
      if (cuesheet.tracks[i].id === trackId) {
        return cuesheet.tracks[i];
      }
    }
    throw new Error("Cuesheet has no track with id '" + trackId + "'.");
  }
  // Maps one impulse track's event times (source-file seconds) to sequence
  // seconds for the clip: clipStart + (t - inPoint) / speed, or mirrored for
  // a reversed clip. Events outside the clip's in/out range are dropped.
  // Returns { times, labels, droppedCount }.
  function mapEventsToSequenceSeconds(cuesheet, clipInfo, trackId) {
    var track = _findTrackOrThrow(cuesheet, trackId);

    var times = [];
    var labels = [];
    var droppedCount = 0;
    for (var j = 0; j < track.events.length; j++) {
      var t = track.events[j].t;
      if (t < clipInfo.inPointSeconds || t > clipInfo.outPointSeconds) {
        droppedCount++;
        continue;
      }
      // A reversed clip (Library Reverse) plays its used part backwards: the
      // part's end is at the clip's start.
      var sequenceSeconds = clipInfo.reversed
        ? clipInfo.clipStartSeconds + (clipInfo.outPointSeconds - t) / (clipInfo.speed || 1)
        : clipInfo.clipStartSeconds + (t - clipInfo.inPointSeconds) / (clipInfo.speed || 1);
      times.push(sequenceSeconds);
      labels.push(track.events[j].label || null);
    }

    return { times: times, labels: labels, droppedCount: droppedCount };
  }
  // EVEN OUT. Beat This! reports beats on a 20 ms frame grid, so a detected
  // beat can sit up to about 10 ms off. evenOutTimes() smooths that jitter: a
  // time moves at most EVEN_MAX_MOVE_SEC; neighbors farther than
  // EVEN_OUTLIER_SEC from the local line are ignored; an interval that
  // differs from its local median by more than EVEN_BREAK_RATIO counts as a
  // tempo break and starts a new steady run.
  var EVEN_MAX_MOVE_SEC = 0.025;
  var EVEN_OUTLIER_SEC = 0.020;
  var EVEN_BREAK_RATIO = 0.12;
  function _median(a) {
    var s = a.slice().sort(function (p, q) { return p - q; });
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }
  function _lineAt(times, ks, at) {
    var n = ks.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var j = 0; j < n; j++) { var k = ks[j]; sx += k; sy += times[k]; sxx += k * k; sxy += k * times[k]; }
    var den = n * sxx - sx * sx;
    if (!den) { return null; }
    var b = (n * sxy - sx * sy) / den;
    return { at: (sy - b * sx) / n + b * at, a: (sy - b * sx) / n, b: b };
  }
  // Smooths a sorted array of beat times (seconds). The times are split into
  // steady runs at tempo breaks; inside a run of at least 5 beats, each time
  // is replaced by a least-squares line fitted over its neighbors (`half`
  // beats each side, default 4, outliers dropped), provided it moves no more
  // than EVEN_MAX_MOVE_SEC. Returns { times, moved, medianShiftMs,
  // maxShiftMs }.
  function evenOutTimes(times, half) {
    half = half || 4;
    var n = times.length;
    var out = times.slice();
    var shifts = [];
    if (n >= 5) {
      var intervals = [];
      for (var i = 1; i < n; i++) { intervals.push(times[i] - times[i - 1]); }
      var runs = [];
      var runStart = 0;
      for (var j = 0; j < intervals.length; j++) {
        var around = intervals.slice(Math.max(0, j - 3), Math.min(intervals.length, j + 4));
        var m = _median(around);
        if (!(m > 0) || Math.abs(intervals[j] - m) > EVEN_BREAK_RATIO * m) {
          runs.push([runStart, j]);
          runStart = j + 1;
        }
      }
      runs.push([runStart, n - 1]);
      for (var r = 0; r < runs.length; r++) {
        var s0 = runs[r][0], e0 = runs[r][1];
        if (e0 - s0 + 1 < 5) { continue; }
        for (var t = s0; t <= e0; t++) {
          var lo = Math.max(s0, t - half), hi = Math.min(e0, t + half);
          var ks = [];
          for (var k = lo; k <= hi; k++) { ks.push(k); }
          var first = _lineAt(times, ks, t);
          if (!first) { continue; }
          var keep = ks.filter(function (k2) { return Math.abs(times[k2] - (first.a + first.b * k2)) <= EVEN_OUTLIER_SEC; });
          var line = keep.length >= 4 ? _lineAt(times, keep, t) : first;
          if (!line) { continue; }
          var moved = line.at - times[t];
          if (Math.abs(moved) <= EVEN_MAX_MOVE_SEC) {
            out[t] = line.at;
            if (Math.abs(moved) > 0.0001) { shifts.push(Math.abs(moved) * 1000); }
          }
        }
      }
    }
    return {
      times: out,
      moved: shifts.length,
      medianShiftMs: _median(shifts),
      maxShiftMs: shifts.length ? Math.max.apply(null, shifts) : 0
    };
  }
  // Moves each time back to the start of the video frame it falls in, on the
  // timeline's own frame grid. `source`: true for clip-marker
  // (source-relative) times, which sit on the timeline at clipStart + (t -
  // inPoint); false for timeline times. Times that land in the same frame are
  // merged (the first one's label wins).
  function snapToFrameStart(times, labels, clipInfo, source) {
    var fps = clipInfo && clipInfo.frameRate;
    if (!(fps > 0)) {
      return { times: times.slice(), labels: labels.slice(), merged: 0 };
    }
    // A re-sped clip (Key tab pitch): timeline = clipStart + (t - in) /
    // speed.
    var speed = clipInfo.speed || 1;
    var reversed = !!clipInfo.reversed;
    var offset = source ? (clipInfo.clipStartSeconds - clipInfo.inPointSeconds / speed) : 0;
    var outTimes = [];
    var outLabels = [];
    var merged = 0;
    for (var i = 0; i < times.length; i++) {
      var frameStart;
      if (source && reversed) {
        // timeline = clipStart + (out - t) / speed; snap that, map back
        var tl = clipInfo.clipStartSeconds + (clipInfo.outPointSeconds - times[i]) / speed;
        var snapped = Math.floor(tl * fps + 1e-6) / fps;
        frameStart = clipInfo.outPointSeconds - (snapped - clipInfo.clipStartSeconds) * speed;
      } else if (source) {
        frameStart = (Math.floor((times[i] / speed + offset) * fps + 1e-6) / fps - offset) * speed;
      } else {
        frameStart = Math.floor(times[i] * fps + 1e-6) / fps;
      }
      if (outTimes.length && Math.abs(outTimes[outTimes.length - 1] - frameStart) < 1e-6) {
        merged++;
        continue;
      }
      outTimes.push(frameStart);
      outLabels.push(labels[i]);
    }
    return { times: outTimes, labels: outLabels, merged: merged };
  }
  // Keeps the events inside the clip's in/out range, in source-file seconds
  // with no clipStart offset (unlike mapEventsToSequenceSeconds above), since
  // clip markers live in source time. Returns { times, labels, droppedCount }.
  function filterEventsInClipRange(cuesheet, clipInfo, trackId) {
    var track = _findTrackOrThrow(cuesheet, trackId);

    var times = [];
    var labels = [];
    var droppedCount = 0;
    for (var j = 0; j < track.events.length; j++) {
      var t = track.events[j].t;
      if (t < clipInfo.inPointSeconds || t > clipInfo.outPointSeconds) {
        droppedCount++;
        continue;
      }
      times.push(t);
      labels.push(track.events[j].label || null);
    }

    return { times: times, labels: labels, droppedCount: droppedCount };
  }
  // Builds the "Simple" mode track: one "D" event per downbeat. Uses
  // explicitTimes (Beat This! downbeats) when given, and then ignores
  // `beatsArray` and `phase`; otherwise every 4th beat starting at index
  // `phase`. Pure, so the phase-shift control can call it to re-derive
  // downbeats without re-running analysis.
  function buildDownbeatsTrack(beatsArray, confidence, phase, explicitTimes) {
    var events = [];
    if (explicitTimes && explicitTimes.length) {
      for (var e = 0; e < explicitTimes.length; e++) {
        events.push({ t: explicitTimes[e], conf: confidence, label: "D" });
      }
      return { id: "downbeats", type: "impulse", events: events };
    }
    for (var i = phase; i < beatsArray.length; i += 4) {
      events.push({ t: beatsArray[i], conf: confidence, label: "D" });
    }
    return { id: "downbeats", type: "impulse", events: events };
  }
  // Returns the index in `beatsArray` (ascending) closest to `target`.
  // A linear scan is enough: the array is at most a few hundred elements.
  function _nearestBeatIndex(beatsArray, target) {
    var bestIdx = 0;
    var bestDiff = Math.abs(beatsArray[0] - target);
    for (var i = 1; i < beatsArray.length; i++) {
      var diff = Math.abs(beatsArray[i] - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
  // Shifts each downbeat by `delta` beats along the beat grid. A downbeat
  // that would move past either end of the grid is dropped.
  function shiftDownbeatTimes(downbeatTimes, beatsArray, delta) {
    if (!downbeatTimes || !downbeatTimes.length || !beatsArray || !beatsArray.length) {
      return downbeatTimes ? downbeatTimes.slice() : [];
    }
    var result = [];
    for (var i = 0; i < downbeatTimes.length; i++) {
      var idx = _nearestBeatIndex(beatsArray, downbeatTimes[i]);
      var newIdx = idx + delta;
      if (newIdx >= 0 && newIdx < beatsArray.length) {
        result.push(beatsArray[newIdx]);
      }
    }
    // Sorted and de-duplicated (two adjacent downbeats can snap to the same
    // index on a sparse or irregular grid).
    result.sort(function (a, b) { return a - b; });
    var deduped = [];
    for (var j = 0; j < result.length; j++) {
      if (j === 0 || result[j] !== result[j - 1]) {
        deduped.push(result[j]);
      }
    }
    return deduped;
  }
  // Inserts a midpoint between every consecutive pair in a sorted
  // downbeat-times array - doubles density without touching the times that
  // are already there.
  function interpolateDownbeatMidpoints(downbeatTimes) {
    var times = downbeatTimes ? downbeatTimes.slice().sort(function (a, b) { return a - b; }) : [];
    if (times.length < 2) {
      return times;
    }
    var out = [];
    for (var i = 0; i < times.length - 1; i++) {
      out.push(times[i]);
      out.push((times[i] + times[i + 1]) / 2);
    }
    out.push(times[times.length - 1]);
    return out;
  }
  // Median inter-beat interval of a beat grid, or null if too short to
  // measure. Shared building block for computeGridDensityRatio below.
  function _medianIbi(beatsArray) {
    if (!beatsArray || beatsArray.length < 2) {
      return null;
    }
    var ibis = [];
    for (var i = 1; i < beatsArray.length; i++) {
      ibis.push(beatsArray[i] - beatsArray[i - 1]);
    }
    var sorted = ibis.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    var m = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return (m && m > 0) ? m : null;
  }
  // Ratio of two grids' median inter-beat intervals: essentiaGridIbi /
  // otherGridIbi. Values near 0.5 mean essentia's grid is about twice as
  // dense as the other; js/main.js checks it before calling
  // interpolateDownbeatMidpoints(). Null if either grid is too short.
  function computeGridDensityRatio(essentiaBeatsArray, otherBeatsArray) {
    var essentiaIbi = _medianIbi(essentiaBeatsArray);
    var otherIbi = _medianIbi(otherBeatsArray);
    if (!essentiaIbi || !otherIbi) {
      return null;
    }
    return essentiaIbi / otherIbi;
  }
  // The beat phase (0..3) implied by Beat This!'s native downbeatTimes: the
  // most common value of (nearest-beat-index mod 4) over all downbeats.
  function computeNativeDownbeatPhase(beatsArray, downbeatTimes) {
    if (!beatsArray || !beatsArray.length || !downbeatTimes || !downbeatTimes.length) {
      return null;
    }
    var votes = [0, 0, 0, 0];
    for (var i = 0; i < downbeatTimes.length; i++) {
      var idx = _nearestBeatIndex(beatsArray, downbeatTimes[i]);
      votes[((idx % 4) + 4) % 4]++;
    }
    var best = 0;
    for (var p = 1; p < 4; p++) {
      if (votes[p] > votes[best]) {
        best = p;
      }
    }
    return best;
  }
  // Diagnostic regularity measure for a downbeat-times array. Returns
  // { medianIntervalSec, deviatingFraction, intervalCount }, where
  // deviatingFraction is the share of intervals that differ from the median
  // by more than deviationThreshold (default 0.20, relative). Null when
  // there are fewer than 3 downbeats or the median interval is not positive.
  function computeDownbeatRegularity(downbeatTimes, deviationThreshold) {
    deviationThreshold = (typeof deviationThreshold === "number") ? deviationThreshold : 0.20;
    var times = downbeatTimes ? downbeatTimes.slice().sort(function (a, b) { return a - b; }) : [];
    if (times.length < 3) {
      return null;
    }
    var diffs = [];
    for (var i = 0; i < times.length - 1; i++) {
      diffs.push(times[i + 1] - times[i]);
    }
    var sortedDiffs = diffs.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sortedDiffs.length / 2);
    var medianInterval = sortedDiffs.length % 2 !== 0
      ? sortedDiffs[mid]
      : (sortedDiffs[mid - 1] + sortedDiffs[mid]) / 2;
    if (!medianInterval || medianInterval <= 0) {
      return null;
    }
    var deviating = 0;
    for (var j = 0; j < diffs.length; j++) {
      if (Math.abs(diffs[j] - medianInterval) / medianInterval > deviationThreshold) {
        deviating++;
      }
    }
    return {
      medianIntervalSec: medianInterval,
      deviatingFraction: deviating / diffs.length,
      intervalCount: diffs.length
    };
  }
  // "Detailed" mode: every beat, each labeled "D" (downbeat) or "b" (any
  // other beat). The single-letter labels become the marker names in Premiere
  // (see jsx/host.jsx) and are meant to be glanced at on the timeline.
  // explicitDownbeats: Beat This!'s own downbeat times, when they drive
  // placement; otherwise every 4th beat from `phase` is a "D".
  function buildLabeledBeatsTrack(beatsArray, confidence, phase, explicitDownbeats) {
    var events = [];
    if (explicitDownbeats && explicitDownbeats.length) {
      var gaps = [];
      for (var g = 1; g < beatsArray.length; g++) {
        gaps.push(beatsArray[g] - beatsArray[g - 1]);
      }
      gaps.sort(function (a, b) { return a - b; });
      var tolerance = (gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0.5) / 4;
      var downs = explicitDownbeats.slice().sort(function (a, b) { return a - b; });
      for (var d = 0; d < downs.length; d++) {
        events.push({ t: downs[d], conf: confidence, label: "D" });
      }
      var k = 0;
      for (var b = 0; b < beatsArray.length; b++) {
        var t = beatsArray[b];
        while (k + 1 < downs.length && downs[k + 1] <= t) {
          k++;
        }
        var near = Math.abs(t - downs[k]) < tolerance || (k + 1 < downs.length && Math.abs(downs[k + 1] - t) < tolerance);
        if (!near) {
          events.push({ t: t, conf: confidence, label: "b" });
        }
      }
      events.sort(function (a, b2) { return a.t - b2.t; });
      return { id: "beats-labeled", type: "impulse", events: events };
    }
    for (var i = 0; i < beatsArray.length; i++) {
      var isDownbeat = ((i - phase) % 4 + 4) % 4 === 0;
      events.push({ t: beatsArray[i], conf: confidence, label: isDownbeat ? "D" : "b" });
    }
    return { id: "beats-labeled", type: "impulse", events: events };
  }

  global.BeatMarkerCuesheet = {
    TEST_CUESHEET: TEST_CUESHEET,
    mapEventsToSequenceSeconds: mapEventsToSequenceSeconds,
    filterEventsInClipRange: filterEventsInClipRange,
    snapToFrameStart: snapToFrameStart,
    evenOutTimes: evenOutTimes,
    buildDownbeatsTrack: buildDownbeatsTrack,
    buildLabeledBeatsTrack: buildLabeledBeatsTrack,
    shiftDownbeatTimes: shiftDownbeatTimes,
    interpolateDownbeatMidpoints: interpolateDownbeatMidpoints,
    computeGridDensityRatio: computeGridDensityRatio,
    computeNativeDownbeatPhase: computeNativeDownbeatPhase,
    computeDownbeatRegularity: computeDownbeatRegularity
  };
})(window);
