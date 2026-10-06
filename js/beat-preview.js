// The Analyze tab's beat-click preview (the waveform, its player and the
// click on every downbeat) and the music video note under it.
(function (global) {
  "use strict";
  // ctx - what this part needs from main.js: log, basename and
  // formatPlayerTime, the #retempoRow element, and getters for the analysis
  // main.js keeps replacing (lastAnalysis, lastDecodedSamples,
  // lastDecodedSamplesPath). This part only reads them.
  function create(ctx) {
    var log = ctx.log;
    var basename = ctx.basename;
    var _formatPlayerTime = ctx.formatPlayerTime;
    var retempoRow = ctx.retempoRow;
    // BEAT CLICK PREVIEW: plays the analyzed file in the panel's own small
    // player (a CEP panel cannot hook into Premiere's timeline playback) with
    // a synthesized click layered on every downbeat, so accuracy can be
    // checked by ear without touching the timeline. Clicks are scheduled with
    // Web Audio (AudioContext.currentTime, sample-accurate) rather than driven
    // by the <audio> element's `timeupdate` event, which fires only a few
    // times a second. beatsArray and buildDownbeatsTrack() event times are
    // file-relative seconds (see js/cuesheet.js), which is what this <audio>
    // element's currentTime uses for the same file, so no offset mapping is
    // needed here (unlike marker placement, which maps to sequence time).
    var beatClickPlayerRow = document.getElementById("beatClickPlayerRow");
    var beatClickWaveformRow = document.getElementById("beatClickWaveformRow");
    var beatClickWaveformCanvas = document.getElementById("beatClickWaveform");
    var beatClickZoomRow = document.getElementById("beatClickZoomRow");
    var beatClickZoomOutBtn = document.getElementById("beatClickZoomOutBtn");
    var beatClickZoomInBtn = document.getElementById("beatClickZoomInBtn");
    var beatClickZoomFitBtn = document.getElementById("beatClickZoomFitBtn");
    var beatClickZoomLabel = document.getElementById("beatClickZoomLabel");
    var beatClickPanRow = document.getElementById("beatClickPanRow");
    var beatClickPanInput = document.getElementById("beatClickPanInput");
    var beatClickVolumeRow = document.getElementById("beatClickVolumeRow");
    var beatClickTrackVolumeInput = document.getElementById("beatClickTrackVolumeInput");
    var beatClickClickVolumeInput = document.getElementById("beatClickClickVolumeInput");
    var beatClickToggleRow = document.getElementById("beatClickToggleRow");
    var beatClickAudio = document.getElementById("beatClickAudio");
    var beatClickToggleBtn = document.getElementById("beatClickToggleBtn");
    var beatClickTime = document.getElementById("beatClickTime");
    var beatClickEnableCheckbox = document.getElementById("beatClickEnableCheckbox");

    var _beatClickTimes = []; // current track's downbeat times, audio-local seconds
    var _beatClickWaveformPeaks = null; // Float32Array, one 0..1 peak per horizontal pixel
    var _beatClickBandPeaks = null; // { low, mid, high }, same shape, one per frequency band
    // 1 = fit the whole track in view; higher = zoomed in.
    // _beatClickPanSeconds is the file time at the LEFT edge of the current
    // view; _beatClickVisibleWindow() clamps it into range.
    var _beatClickZoom = 1;
    var _beatClickPanSeconds = 0;
    var BEAT_CLICK_ZOOM_MIN = 1;
    var BEAT_CLICK_ZOOM_MAX = 40;
    var BEAT_CLICK_ZOOM_STEP = 1.6;
    var BEAT_CLICK_DEFAULT_ZOOM = 5;
    var _beatClickAudioContext = null;
    var _beatClickSourceNode = null;
    var _beatClickTrackGain = null; // volume of the track itself, independent of the click
    var _beatClickGain = null; // volume of the synthesized click, independent of the track
    var _beatClickBuffer = null; // one short synthesized click, reused for every trigger
    var _beatClickScheduleTimer = null;
    // Scheduled but not yet fired click nodes, so pause can cancel them (Web
    // Audio scheduling continues independently of the <audio> element).
    var _beatClickPendingNodes = [];
    var _beatClickFiredKeys = {}; // beat time -> true, so a beat already triggered this playthrough isn't retriggered on the next scheduler tick
    var _beatClickAnimFrame = null;
    // A short, clean metronome click synthesized on the fly instead of a
    // bundled audio asset: a single fundamental with a touch of its 2nd
    // harmonic for definition, a hard attack and a fast decay, no noise
    // component.
    function _synthesizeClickBuffer(context) {
      var durationSeconds = 0.025;
      var sampleRate = context.sampleRate;
      var frameCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
      var buffer = context.createBuffer(1, frameCount, sampleRate);
      var data = buffer.getChannelData(0);
      var freq = 1500; // a classic, clean, cut-through-a-mix click pitch
      for (var i = 0; i < frameCount; i++) {
        var t = i / sampleRate;
        var envelope = Math.exp(-t * 300); // fast, clean decay - silent well before the buffer ends, so no cutoff pop
        var fundamental = Math.sin(2 * Math.PI * freq * t);
        var overtone = Math.sin(2 * Math.PI * freq * 2 * t) * 0.25; // a little upper harmonic for definition, not a second distinct pitch
        data[i] = (fundamental + overtone) * envelope * 0.9;
      }
      return buffer;
    }
    // Track and click each get their own GainNode so their volumes can be
    // adjusted independently: they are two separate signal paths into the
    // same destination.
    function _ensureBeatClickAudioGraph() {
      if (!_beatClickAudioContext) {
        var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        _beatClickAudioContext = new AudioContextCtor();
        _beatClickSourceNode = _beatClickAudioContext.createMediaElementSource(beatClickAudio);
        _beatClickTrackGain = _beatClickAudioContext.createGain();
        _beatClickTrackGain.gain.value = (parseFloat(beatClickTrackVolumeInput.value) || 0) / 100;
        _beatClickSourceNode.connect(_beatClickTrackGain);
        _beatClickTrackGain.connect(_beatClickAudioContext.destination);
        _beatClickGain = _beatClickAudioContext.createGain();
        _beatClickGain.gain.value = (parseFloat(beatClickClickVolumeInput.value) || 0) / 100;
        _beatClickGain.connect(_beatClickAudioContext.destination);
        _beatClickBuffer = _synthesizeClickBuffer(_beatClickAudioContext);
      }
      if (_beatClickAudioContext.state === "suspended") {
        _beatClickAudioContext.resume();
      }
    }

    beatClickTrackVolumeInput.addEventListener("input", function () {
      if (_beatClickTrackGain) {
        _beatClickTrackGain.gain.value = (parseFloat(beatClickTrackVolumeInput.value) || 0) / 100;
      }
    });
    beatClickClickVolumeInput.addEventListener("input", function () {
      if (_beatClickGain) {
        _beatClickGain.gain.value = (parseFloat(beatClickClickVolumeInput.value) || 0) / 100;
      }
    });
    // Band edges for the low / mid / high colors of the waveform.
    var WAVEFORM_LOW_CUTOFF_HZ = 250;
    var WAVEFORM_HIGH_CUTOFF_HZ = 4000;

    function _splitFrequencyBands(samples, sampleRate) {
      var n = samples.length;
      var low = new Float32Array(n);
      var high = new Float32Array(n);
      var dt = 1 / sampleRate;

      var rcLow = 1 / (2 * Math.PI * WAVEFORM_LOW_CUTOFF_HZ);
      var alphaLow = dt / (rcLow + dt); // one-pole low-pass
      var lowPrev = 0;
      for (var i = 0; i < n; i++) {
        lowPrev = lowPrev + alphaLow * (samples[i] - lowPrev);
        low[i] = lowPrev;
      }

      var rcHigh = 1 / (2 * Math.PI * WAVEFORM_HIGH_CUTOFF_HZ);
      var alphaHigh = rcHigh / (rcHigh + dt); // one-pole high-pass
      var highPrev = 0;
      var xPrev = 0;
      for (var j = 0; j < n; j++) {
        highPrev = alphaHigh * (highPrev + samples[j] - xPrev);
        xPrev = samples[j];
        high[j] = highPrev;
      }
      // Mid = what is left after removing the low and high bands, so the
      // three bands sum back to roughly the original signal.
      var mid = new Float32Array(n);
      for (var k = 0; k < n; k++) {
        mid[k] = samples[k] - low[k] - high[k];
      }

      return { low: low, mid: mid, high: high };
    }
    function _computeBandPeaks(bands, bucketCount) {
      var empty = { low: new Float32Array(0), mid: new Float32Array(0), high: new Float32Array(0) };
      if (!bands || !bands.low.length || bucketCount <= 0) {
        return empty;
      }
      var n = bands.low.length;
      var bucketSize = n / bucketCount;
      var low = new Float32Array(bucketCount);
      var mid = new Float32Array(bucketCount);
      var high = new Float32Array(bucketCount);
      var globalMax = 0;
      for (var b = 0; b < bucketCount; b++) {
        var start = Math.floor(b * bucketSize);
        var end = Math.floor((b + 1) * bucketSize);
        var maxLow = 0, maxMid = 0, maxHigh = 0;
        for (var j = start; j < end && j < n; j++) {
          var vl = Math.abs(bands.low[j]);
          var vm = Math.abs(bands.mid[j]);
          var vh = Math.abs(bands.high[j]);
          if (vl > maxLow) { maxLow = vl; }
          if (vm > maxMid) { maxMid = vm; }
          if (vh > maxHigh) { maxHigh = vh; }
        }
        low[b] = maxLow; mid[b] = maxMid; high[b] = maxHigh;
        if (maxLow > globalMax) { globalMax = maxLow; }
        if (maxMid > globalMax) { globalMax = maxMid; }
        if (maxHigh > globalMax) { globalMax = maxHigh; }
      }
      if (globalMax > 0.0001) {
        for (var k = 0; k < bucketCount; k++) {
          low[k] /= globalMax; mid[k] /= globalMax; high[k] /= globalMax;
        }
      }
      return { low: low, mid: mid, high: high };
    }

    function _computeWaveformPeaks(samples, bucketCount) {
      if (!samples || !samples.length || bucketCount <= 0) {
        return new Float32Array(0);
      }
      var peaks = new Float32Array(bucketCount);
      var bucketSize = samples.length / bucketCount;
      var globalMax = 0;
      for (var b = 0; b < bucketCount; b++) {
        var start = Math.floor(b * bucketSize);
        var end = Math.floor((b + 1) * bucketSize);
        var maxAbs = 0;
        for (var j = start; j < end && j < samples.length; j++) {
          var v = samples[j] < 0 ? -samples[j] : samples[j];
          if (v > maxAbs) { maxAbs = v; }
        }
        peaks[b] = maxAbs;
        if (maxAbs > globalMax) { globalMax = maxAbs; }
      }
      // Normalize so the loudest point in THIS track reaches full height; a
      // quiet track should not look like a flat line.
      if (globalMax > 0.0001) {
        for (var k = 0; k < bucketCount; k++) {
          peaks[k] = peaks[k] / globalMax;
        }
      }
      return peaks;
    }
    // This track's mono samples, kept only to re-bucket the waveform on zoom, pan and resize.
    var _beatClickCurrentSamples = null;
    var _beatClickCurrentBands = null;
    function _beatClickVisibleWindow() {
      var duration = beatClickAudio.duration || 0;
      var visibleDuration = duration / _beatClickZoom;
      var maxPan = Math.max(0, duration - visibleDuration);
      var pan = Math.max(0, Math.min(_beatClickPanSeconds, maxPan));
      return { start: pan, duration: visibleDuration, end: pan + visibleDuration, maxPan: maxPan };
    }
    // Re-buckets the waveform from the raw samples for the visible window, so
    // zooming in gives finer detail rather than a stretched version of the
    // full-track buckets.
    function _rebuildBeatClickWaveformForView() {
      var width = Math.max(1, Math.round(beatClickWaveformCanvas.clientWidth) || 300);
      if (!_beatClickCurrentSamples || !beatClickAudio.duration) {
        _beatClickWaveformPeaks = null;
        _beatClickBandPeaks = null;
      } else {
        var win = _beatClickVisibleWindow();
        var sampleRate = window.BeatMarkerAudio.TARGET_SAMPLE_RATE;
        var startSample = Math.max(0, Math.floor(win.start * sampleRate));
        var endSample = Math.min(_beatClickCurrentSamples.length, Math.ceil(win.end * sampleRate));
        _beatClickWaveformPeaks = _computeWaveformPeaks(_beatClickCurrentSamples.subarray(startSample, endSample), width);
        if (_beatClickCurrentBands) {
          _beatClickBandPeaks = _computeBandPeaks({
            low: _beatClickCurrentBands.low.subarray(startSample, endSample),
            mid: _beatClickCurrentBands.mid.subarray(startSample, endSample),
            high: _beatClickCurrentBands.high.subarray(startSample, endSample)
          }, width);
        } else {
          _beatClickBandPeaks = null;
        }
      }
      _updateBeatClickZoomUI();
      _drawBeatClickWaveform();
    }

    function _updateBeatClickZoomUI() {
      var win = _beatClickVisibleWindow();
      beatClickZoomLabel.textContent = _beatClickZoom <= 1.001 ? "" : (_beatClickZoom.toFixed(1) + "x");
      var zoomed = _beatClickZoom > 1.001;
      beatClickPanRow.style.display = zoomed ? "" : "none";
      if (zoomed) {
        beatClickPanInput.min = "0";
        beatClickPanInput.max = String(win.maxPan);
        beatClickPanInput.step = String(Math.max(0.01, win.maxPan / 500 || 0.01));
        beatClickPanInput.value = String(win.start);
      }
    }

    function _setBeatClickZoom(newZoom, anchorSeconds) {
      var duration = beatClickAudio.duration || 0;
      if (duration <= 0) {
        return;
      }
      newZoom = Math.max(BEAT_CLICK_ZOOM_MIN, Math.min(BEAT_CLICK_ZOOM_MAX, newZoom));
      if (anchorSeconds === undefined) {
        var win = _beatClickVisibleWindow();
        anchorSeconds = win.start + win.duration / 2; // keep the CENTER of the current view anchored when zooming via the buttons
      }
      _beatClickZoom = newZoom;
      var newVisibleDuration = duration / _beatClickZoom;
      _beatClickPanSeconds = anchorSeconds - newVisibleDuration / 2;
      _rebuildBeatClickWaveformForView();
      _noteManualBeatClickView();
    }

    beatClickZoomInBtn.addEventListener("click", function () { _setBeatClickZoom(_beatClickZoom * BEAT_CLICK_ZOOM_STEP); });
    beatClickZoomOutBtn.addEventListener("click", function () { _setBeatClickZoom(_beatClickZoom / BEAT_CLICK_ZOOM_STEP); });
    beatClickZoomFitBtn.addEventListener("click", function () { _beatClickPanSeconds = 0; _setBeatClickZoom(BEAT_CLICK_ZOOM_MIN, 0); });
    beatClickPanInput.addEventListener("input", function () {
      _beatClickPanSeconds = parseFloat(beatClickPanInput.value) || 0;
      _rebuildBeatClickWaveformForView();
      _noteManualBeatClickView();
    });

    // Waveform bars + beat tick marks + a moving playhead, all redrawn
    // together on each call; cheap enough at the panel's size to redraw on
    // every animation frame during playback.
    function _drawBeatClickWaveform() {
      var canvas = beatClickWaveformCanvas;
      var cssWidth = canvas.clientWidth;
      var cssHeight = canvas.clientHeight;
      if (cssWidth <= 0 || cssHeight <= 0) {
        return;
      }
      var dpr = window.devicePixelRatio || 1;
      var targetW = Math.round(cssWidth * dpr);
      var targetH = Math.round(cssHeight * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        _rebuildBeatClickWaveformForView();
        return; // _rebuildBeatClickWaveformForView() already re-calls this function
      }
      var ctx2d = canvas.getContext("2d");
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, cssWidth, cssHeight);
      // Frequency-colored waveform. Falls back to a single-color render if
      // band data is not ready yet (e.g. the first frame after a track
      // loads). Low is drawn first (bottom layer), then mid, then high on top,
      // each at reduced alpha so overlapping bands blend.
      if (_beatClickBandPeaks && _beatClickBandPeaks.low.length) {
        var midY = cssHeight / 2;
        var bands = _beatClickBandPeaks;
        var bandCount = Math.min(bands.low.length, Math.round(cssWidth));
        var bandColors = [
          { arr: bands.low, color: "rgba(88, 140, 224, 0.55)" }, // low - blue
          { arr: bands.mid, color: "rgba(224, 163, 57, 0.55)" }, // mid - amber
          { arr: bands.high, color: "rgba(234, 231, 225, 0.5)" } // high - bright cream
        ];
        for (var bi = 0; bi < bandColors.length; bi++) {
          ctx2d.fillStyle = bandColors[bi].color;
          var arr = bandColors[bi].arr;
          for (var x = 0; x < bandCount; x++) {
            var amp = arr[x];
            if (amp <= 0) { continue; }
            var h = Math.max(1, amp * (midY - 2));
            ctx2d.fillRect(x, midY - h, 1, h * 2);
          }
        }
      } else if (_beatClickWaveformPeaks && _beatClickWaveformPeaks.length) {
        var mid = cssHeight / 2;
        ctx2d.fillStyle = "rgba(224, 163, 57, 0.5)"; // accent color at reduced alpha
        var peaks = _beatClickWaveformPeaks;
        var barCount = Math.min(peaks.length, Math.round(cssWidth));
        for (var x2 = 0; x2 < barCount; x2++) {
          var amp2 = peaks[x2];
          var h2 = Math.max(1, amp2 * (mid - 2));
          ctx2d.fillRect(x2, mid - h2, 1, h2 * 2);
        }
      }

      var win = _beatClickVisibleWindow();
      if (win.duration > 0 && _beatClickTimes.length) {
        ctx2d.fillStyle = "#ff9f2e"; // downbeat ticks in orange
        for (var i = 0; i < _beatClickTimes.length; i++) {
          var t = _beatClickTimes[i];
          if (t < win.start || t > win.end) {
            continue; // only draw ticks actually in the current view
          }
          var tx = ((t - win.start) / win.duration) * cssWidth;
          ctx2d.fillRect(tx, 0, 1, cssHeight);
        }
      }

      if (win.duration > 0) {
        var currentT = beatClickAudio.currentTime;
        if (currentT >= win.start && currentT <= win.end) {
          var px = ((currentT - win.start) / win.duration) * cssWidth;
          ctx2d.fillStyle = "#e8e6e1"; // the playhead in white, distinct from the orange ticks
          ctx2d.fillRect(Math.max(0, px - 1), 0, 2, cssHeight);
        }
      }
    }
    // Follow playback. Page-style, like Premiere's default timeline
    // scrolling: when the playhead nears the right edge the view jumps so it
    // sits near the left again.
    var _beatClickFollow = true;
    function _beatClickPlayheadInView() {
      var win = _beatClickVisibleWindow();
      var t = beatClickAudio.currentTime;
      return t >= win.start && t <= win.end;
    }
    function _noteManualBeatClickView() {
      _beatClickFollow = beatClickAudio.paused || _beatClickPlayheadInView();
    }
    function _followBeatClickPlayhead() {
      if (_beatClickZoom <= 1.001) {
        return;
      }
      var inView = _beatClickPlayheadInView();
      if (!_beatClickFollow) {
        if (!inView) {
          return;
        }
        _beatClickFollow = true;
      }
      var win = _beatClickVisibleWindow();
      var t = beatClickAudio.currentTime;
      if (!inView || t > win.start + win.duration * 0.9) {
        _beatClickPanSeconds = t - win.duration * 0.1;
        _rebuildBeatClickWaveformForView();
      }
    }

    function _beatClickAnimTick() {
      _followBeatClickPlayhead();
      _drawBeatClickWaveform();
      if (!beatClickAudio.paused) {
        _beatClickAnimFrame = requestAnimationFrame(_beatClickAnimTick);
      } else {
        _beatClickAnimFrame = null;
      }
    }

    function _seekFromWaveformEvent(evt) {
      var win = _beatClickVisibleWindow();
      if (win.duration <= 0) {
        return;
      }
      var rect = beatClickWaveformCanvas.getBoundingClientRect();
      var x = evt.clientX - rect.left;
      var fraction = Math.max(0, Math.min(1, x / rect.width));
      beatClickAudio.currentTime = win.start + fraction * win.duration;
      _drawBeatClickWaveform();
    }
    var _beatClickScrubbing = false;
    beatClickWaveformCanvas.addEventListener("mousedown", function (evt) {
      _beatClickScrubbing = true;
      _seekFromWaveformEvent(evt);
    });
    window.addEventListener("mousemove", function (evt) {
      if (_beatClickScrubbing) {
        _seekFromWaveformEvent(evt);
      }
    });
    window.addEventListener("mouseup", function () {
      _beatClickScrubbing = false;
    });
    // Mouse-wheel/trackpad navigation, matching Premiere's timeline feel.
    // Zoom triggers on two gestures, both centered on the time under the
    // cursor: Alt/Option+wheel (`event.altKey` covers Alt on Windows and
    // Option on Mac) and trackpad pinch.
    beatClickWaveformCanvas.addEventListener("wheel", function (evt) {
      var duration = beatClickAudio.duration || 0;
      if (duration <= 0) {
        return;
      }
      evt.preventDefault();
      var rect = beatClickWaveformCanvas.getBoundingClientRect();
      var cursorFraction = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
      if (evt.altKey || evt.ctrlKey) {
        var winBefore = _beatClickVisibleWindow();
        var cursorTime = winBefore.start + cursorFraction * winBefore.duration;
        var zoomFactor = evt.deltaY < 0 ? BEAT_CLICK_ZOOM_STEP : (1 / BEAT_CLICK_ZOOM_STEP);
        _beatClickZoom = Math.max(BEAT_CLICK_ZOOM_MIN, Math.min(BEAT_CLICK_ZOOM_MAX, _beatClickZoom * zoomFactor));
        var newVisibleDuration = duration / _beatClickZoom;
        // Keep the same time under the cursor at the same on-screen fraction
        // after zooming, not just re-centered.
        _beatClickPanSeconds = cursorTime - cursorFraction * newVisibleDuration;
      } else {
        var win = _beatClickVisibleWindow();
        var scrollDelta = Math.abs(evt.deltaX) > Math.abs(evt.deltaY) ? evt.deltaX : evt.deltaY;
        var panFraction = Math.max(-0.4, Math.min(0.4, scrollDelta / 300));
        _beatClickPanSeconds = win.start + panFraction * win.duration;
      }
      _rebuildBeatClickWaveformForView();
      _noteManualBeatClickView();
    }, { passive: false });

    function _stopScheduledBeatClicks() {
      for (var i = 0; i < _beatClickPendingNodes.length; i++) {
        try { _beatClickPendingNodes[i].stop(); } catch (e) { /* node already stopped */ }
      }
      _beatClickPendingNodes = [];
    }

    function _resetBeatClickPlaythrough() {
      _beatClickFiredKeys = {};
      _stopScheduledBeatClicks();
    }

    function _stopBeatClickScheduler() {
      clearInterval(_beatClickScheduleTimer);
      _beatClickScheduleTimer = null;
      _stopScheduledBeatClicks();
    }

    function _startBeatClickScheduler() {
      var LOOKAHEAD_SECONDS = 0.15;
      var TICK_MS = 30;
      clearInterval(_beatClickScheduleTimer);
      _beatClickScheduleTimer = setInterval(function () {
        if (beatClickAudio.paused || !beatClickEnableCheckbox.checked) {
          return;
        }
        var nowAudioTime = beatClickAudio.currentTime;
        var nowContextTime = _beatClickAudioContext.currentTime;
        for (var i = 0; i < _beatClickTimes.length; i++) {
          var t = _beatClickTimes[i];
          if (t < nowAudioTime - 0.05 || t > nowAudioTime + LOOKAHEAD_SECONDS) {
            continue;
          }
          var key = t.toFixed(3);
          if (_beatClickFiredKeys[key]) {
            continue;
          }
          _beatClickFiredKeys[key] = true;
          var node = _beatClickAudioContext.createBufferSource();
          node.buffer = _beatClickBuffer;
          node.connect(_beatClickGain);
          var startAt = nowContextTime + (t - nowAudioTime);
          node.start(Math.max(startAt, nowContextTime));
          _beatClickPendingNodes.push(node);
        }
      }, TICK_MS);
    }

    beatClickAudio.addEventListener("loadedmetadata", function () {
      beatClickTime.textContent = _formatPlayerTime(beatClickAudio.currentTime) + " / " + _formatPlayerTime(beatClickAudio.duration);
      _rebuildBeatClickWaveformForView(); // the duration is known only now
    });
    beatClickAudio.addEventListener("timeupdate", function () {
      beatClickTime.textContent = _formatPlayerTime(beatClickAudio.currentTime) + " / " + _formatPlayerTime(beatClickAudio.duration);
      if (beatClickAudio.paused) {
        _drawBeatClickWaveform();
      }
    });
    beatClickAudio.addEventListener("play", function () {
      _ensureBeatClickAudioGraph();
      beatClickToggleBtn.textContent = "‖";
      _beatClickFollow = true; // Play always shows where it plays
      _startBeatClickScheduler();
      if (!_beatClickAnimFrame) {
        _beatClickAnimFrame = requestAnimationFrame(_beatClickAnimTick);
      }
    });
    beatClickAudio.addEventListener("pause", function () {
      beatClickToggleBtn.textContent = "▶";
      _stopBeatClickScheduler();
    });
    beatClickAudio.addEventListener("ended", function () {
      beatClickAudio.currentTime = 0;
      _resetBeatClickPlaythrough();
      _drawBeatClickWaveform();
    });
    beatClickAudio.addEventListener("seeking", function () {
      _resetBeatClickPlaythrough();
    });
    beatClickToggleBtn.addEventListener("click", function () {
      if (beatClickAudio.paused) {
        beatClickAudio.play();
      } else {
        beatClickAudio.pause();
      }
    });
    // Shows or hides the Analyze tab's `has-analysis` styling: the layout
    // styles the tab by whether a beat grid exists. Before one, Analyze is the
    // main button; after, Place markers.
    function _setAnalyzeTabHasAnalysis(on) {
      var tab = document.getElementById("tabContentAnalyze");
      if (tab && tab.classList) {
        tab.classList.toggle("has-analysis", !!on);
      }
    }
    // MUSIC VIDEO NOTE: shown when the analyzed file's name says it is a
    // music video's soundtrack, to remind the user to check the intro and
    // ending. Lyric, audio and visualizer uploads get no note. The Russian
    // word for "music video" is written as escapes so the source stays ASCII.
    var MUSIC_VIDEO_NAME = /music\s*video|official\s*video|video\s*oficial|videoclip|clip\s*officiel|\bm\/?v\b|dance\s*video|performance\s*video|\u043a\u043b\u0438\u043f/i;
    var NOT_MUSIC_VIDEO_NAME = /lyric|letra|visuali[sz]er|\baudio\b/i;
    function _looksLikeMusicVideo(path) {
      var name = basename(path || "");
      return MUSIC_VIDEO_NAME.test(name) && !NOT_MUSIC_VIDEO_NAME.test(name);
    }
    var musicVideoNote = document.getElementById("musicVideoNote");
    var _musicVideoNotedPath = null;
    function _updateMusicVideoNote() {
      var p = ctx.lastAnalysis() && ctx.lastAnalysis().beatsArray && ctx.lastAnalysis().beatsArray.length ? ctx.lastAnalysis().audioPath : null;
      var show = !!p && _looksLikeMusicVideo(p);
      musicVideoNote.hidden = !show;
      if (show && _musicVideoNotedPath !== p) {
        _musicVideoNotedPath = p;
        log("The file name looks like a music video's soundtrack - check the intro and the ending of the result.");
      }
    }

    function _refreshBeatClickPreview() {
      // The same "is there a real analysis" condition decides whether the
      // half/double tempo-correction row (retempoRow) is visible; it is
      // evaluated here so every call site that changes lastAnalysis gets it.
      retempoRow.style.display = (ctx.lastAnalysis() && ctx.lastAnalysis().beatsArray && ctx.lastAnalysis().beatsArray.length) ? "" : "none";
      _updateMusicVideoNote();
      if (!ctx.lastAnalysis() || !ctx.lastAnalysis().beatsArray || !ctx.lastAnalysis().beatsArray.length) {
        _hideBeatClickPreview(); // also pauses and cancels scheduled clicks
        return;
      }
      if (!beatClickAudio.paused) {
        beatClickAudio.pause();
      }
      var downbeats = window.BeatMarkerCuesheet.buildDownbeatsTrack(ctx.lastAnalysis().beatsArray, ctx.lastAnalysis().confidence, ctx.lastAnalysis().phase, ctx.lastAnalysis().downbeatTimes);
      _beatClickTimes = downbeats.events.map(function (e) { return e.t; });
      _resetBeatClickPlaythrough();
      var previewPath = ctx.lastAnalysis().audioPath;
      if (/\.aiff?$/i.test(previewPath)) {
        _loadAiffPlayback(previewPath).then(function (aiff) {
          if (!ctx.lastAnalysis() || ctx.lastAnalysis().audioPath !== previewPath) {
            return; // another clip was selected meanwhile
          }
          if (beatClickAudio.getAttribute("src") !== aiff.url) {
            beatClickAudio.src = aiff.url;
          }
          if (!_beatClickCurrentSamples) {
            _beatClickCurrentSamples = aiff.samples;
            _beatClickCurrentBands = _splitFrequencyBands(aiff.samples, window.BeatMarkerAudio.TARGET_SAMPLE_RATE);
            _rebuildBeatClickWaveformForView();
          }
        }, function (err) {
          log("Preview: could not prepare this AIFF for playback: " + (err && err.message ? err.message : err));
        });
      } else {
        var newSrc = "file://" + previewPath;
        if (beatClickAudio.getAttribute("src") !== newSrc) {
          beatClickAudio.src = newSrc;
        }
      }
      _beatClickCurrentSamples = (ctx.lastDecodedSamplesPath() === ctx.lastAnalysis().audioPath) ? ctx.lastDecodedSamples() : null;
      _beatClickCurrentBands = _beatClickCurrentSamples
        ? _splitFrequencyBands(_beatClickCurrentSamples, window.BeatMarkerAudio.TARGET_SAMPLE_RATE)
        : null;
      _setAnalyzeTabHasAnalysis(true);
      beatClickPlayerRow.style.display = "";
      beatClickWaveformRow.style.display = "";
      beatClickZoomRow.style.display = "";
      beatClickVolumeRow.style.display = "";
      beatClickToggleRow.style.display = "";
      // New track: always start at the default zoom from the beginning,
      // never carrying over a previous track's zoom/pan. The "Fit" button
      // still goes out to 1x on request.
      _beatClickZoom = Math.min(BEAT_CLICK_DEFAULT_ZOOM, BEAT_CLICK_ZOOM_MAX);
      _beatClickPanSeconds = 0;
      _rebuildBeatClickWaveformForView();
    }

    // The <audio> element of the panel's browser cannot play AIFF. For an AIFF
    // file the preview plays a WAV made in memory from the samples the panel
    // already decoded (mono, 16-bit, 44.1 kHz). It exists only for playback
    // and is never written to disk.
    var _beatClickAiff = null; // { path, url, samples }
    function _encodeWav16(samples, rate) {
      var n = samples.length;
      var buf = new ArrayBuffer(44 + n * 2);
      var v = new DataView(buf);
      function str(offset, text) {
        for (var k = 0; k < text.length; k++) {
          v.setUint8(offset + k, text.charCodeAt(k));
        }
      }
      str(0, "RIFF");
      v.setUint32(4, 36 + n * 2, true);
      str(8, "WAVE");
      str(12, "fmt ");
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, rate, true);
      v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      str(36, "data");
      v.setUint32(40, n * 2, true);
      for (var i = 0; i < n; i++) {
        var s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
      }
      return new Blob([buf], { type: "audio/wav" });
    }
    function _loadAiffPlayback(path) {
      if (_beatClickAiff && _beatClickAiff.path === path) {
        return Promise.resolve(_beatClickAiff);
      }
      var decoded = ctx.lastDecodedSamplesPath() === path ? Promise.resolve(ctx.lastDecodedSamples()) :
        window.BeatMarkerAudio.decodeFileToMono44100(path).then(function (d) { return d.samples; });
      return decoded.then(function (samples) {
        if (_beatClickAiff) {
          URL.revokeObjectURL(_beatClickAiff.url);
        }
        _beatClickAiff = { path: path, samples: samples,
          url: URL.createObjectURL(_encodeWav16(samples, window.BeatMarkerAudio.TARGET_SAMPLE_RATE)) };
        return _beatClickAiff;
      });
    }

    function _hideBeatClickPreview() {
      musicVideoNote.hidden = true;
      if (!beatClickAudio.paused) {
        beatClickAudio.pause();
      }
      _stopBeatClickScheduler();
      if (_beatClickAnimFrame) {
        cancelAnimationFrame(_beatClickAnimFrame);
        _beatClickAnimFrame = null;
      }
      _beatClickTimes = [];
      _beatClickWaveformPeaks = null;
      _beatClickCurrentSamples = null;
      _beatClickZoom = BEAT_CLICK_ZOOM_MIN;
      _beatClickPanSeconds = 0;
      _setAnalyzeTabHasAnalysis(false);
      beatClickPlayerRow.style.display = "none";
      beatClickWaveformRow.style.display = "none";
      beatClickZoomRow.style.display = "none";
      beatClickPanRow.style.display = "none";
      beatClickVolumeRow.style.display = "none";
      beatClickToggleRow.style.display = "none";
    }

    return {
      refresh: _refreshBeatClickPreview,
      hide: _hideBeatClickPreview
    };
  }

  global.BeatMarkerBeatPreview = { create: create };
})(window);
