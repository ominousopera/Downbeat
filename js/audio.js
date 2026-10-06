// Audio file access for the panel: reads a file through CEP's Node context,
// decodes it with Web Audio, downmixes to mono and resamples. Runs in the
// panel's Chromium context.
(function (global) {
  "use strict";

  var TARGET_SAMPLE_RATE = 44100;
  // Reads a file via window.cep_node, which is available because
  // manifest.xml enables --enable-nodejs without --mixed-context.
  // Returns a Promise<ArrayBuffer>. The whole file is held in memory, so
  // very long audio files (hours) are not suitable.
  function readFileAsArrayBuffer(path) {
    return new Promise(function (resolve, reject) {
      if (!window.cep_node) {
        reject(new Error("Node access is not available in this panel. Reinstall the extension."));
        return;
      }
      var fs = window.cep_node.require("fs");
      fs.readFile(path, function (err, buffer) {
        if (err) {
          reject(new Error("Failed to read file '" + path + "': " + err.message));
          return;
        }
        // Slice the Node Buffer to exactly this file's bytes, as a real
        // ArrayBuffer that Web Audio can decode.
        var arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        resolve(arrayBuffer);
      });
    });
  }
  // One decoding context for the panel's whole life, so contexts do not pile
  // up.
  var _decodeCtx = null;
  function _decoder() {
    if (!_decodeCtx) {
      _decodeCtx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
    }
    return _decodeCtx;
  }
  // Averages the channels (what Web Audio's own downmix does for stereo).
  function _downmix(decoded) {
    var channels = decoded.numberOfChannels;
    if (channels === 1) {
      return decoded.getChannelData(0);
    }
    var out = new Float32Array(decoded.length);
    for (var c = 0; c < channels; c++) {
      var data = decoded.getChannelData(c);
      for (var i = 0; i < data.length; i++) {
        out[i] += data[i];
      }
    }
    for (var j = 0; j < out.length; j++) {
      out[j] /= channels;
    }
    return out;
  }
  // The decoder can stall without ever answering; the analysis would then
  // wait forever. After a limit that grows with the file the wait ends with
  // an error, so the plugin's own reader can take over for WAV / AIFF and the
  // panel never stays busy. The shared context is dropped as well, since a
  // stalled one may stay stuck for later files.
  function _withDecodeLimit(decodePromise, byteLength) {
    var limitMs = 30000 + Math.round(byteLength / 1048576) * 2000;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        _decodeCtx = null;
        reject(new Error("the decoder did not answer within " + Math.round(limitMs / 1000) + " s"));
      }, limitMs);
      decodePromise.then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // Decodes to mono 44100 Hz (the offline context from _decoder() decodes
  // straight to that rate). Resolves to { samples, original }.
  function decodeToMono44100(arrayBuffer) {
    var decodeCtx = _decoder();
    return _withDecodeLimit(decodeCtx.decodeAudioData(arrayBuffer), arrayBuffer.byteLength).catch(function (e) {
      var detail = (e && e.message) ? e.message : (e && e.name) ? e.name : String(e);
      throw new Error(
        "This file's audio codec isn't supported by Chromium's Web Audio decoder " +
        "(browser error: " + detail + "). Known to work: wav, aiff, mp3, m4a, aac, and the audio of mp4 / mov. " +
        "Try converting the source file to one of those formats and re-selecting it."
      );
    }).then(function (decoded) {
      var originalInfo = {
        durationSec: decoded.duration,
        sampleRate: decoded.sampleRate,
        channels: decoded.numberOfChannels
      };

      var mono = _downmix(decoded);
      if (decoded.sampleRate === TARGET_SAMPLE_RATE) {
        return { samples: mono, original: originalInfo };
      }
      // Safety net: the context decodes at 44100 already.
      return resampleMono(mono, decoded.sampleRate, TARGET_SAMPLE_RATE).then(function (resampled) {
        return { samples: resampled, original: originalInfo };
      });
    });
  }
  // Resamples mono samples from fromRate to toRate, e.g. to 22050 Hz for the
  // Beat This! mel-spectrogram model. Returns a Promise<Float32Array>.
  function resampleMono(samples, fromRate, toRate) {
    if (fromRate === toRate) {
      return Promise.resolve(samples);
    }
    // Offline rendering, so no real-time AudioContext is created.
    var frameCount = Math.ceil(samples.length * (toRate / fromRate));
    var offlineCtx = new OfflineAudioContext(1, frameCount, toRate);
    var sourceBuffer = offlineCtx.createBuffer(1, samples.length, fromRate);
    sourceBuffer.copyToChannel(samples, 0);
    var source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    return offlineCtx.startRendering().then(function (rendered) {
      return rendered.getChannelData(0);
    });
  }
  // Decodes a file into a full AudioBuffer with every channel (used by the
  // Library preview, which plays in stereo and makes copies). Decodes at
  // `sampleRate` when the caller knows the file's own rate, so nothing is
  // resampled; 44100 Hz otherwise. One decoding context per rate is kept.
  var _rateDecoders = {};
  function decodeToBuffer(arrayBuffer, sampleRate) {
    var rate = (sampleRate >= 3000 && sampleRate <= 768000) ? Math.round(sampleRate) : TARGET_SAMPLE_RATE;
    var ctx = rate === TARGET_SAMPLE_RATE ? _decoder() : (_rateDecoders[rate] || (_rateDecoders[rate] = new OfflineAudioContext(1, 1, rate)));
    return ctx.decodeAudioData(arrayBuffer).catch(function (e) {
      var detail = (e && e.message) ? e.message : (e && e.name) ? e.name : String(e);
      throw new Error("This file's audio codec isn't supported by Chromium's Web Audio decoder (browser error: " + detail + ").");
    });
  }

  // Reads and decodes one file to mono 44100 Hz for the Analyze and Key tabs.
  // The panel's decoder is tried first. When it cannot read a WAV or AIFF
  // (Chromium has no AIFF decoder), the plugin's own reader
  // (worker/wav-excerpt.js, the one the Library uses) takes over; a file that
  // reader cannot read either keeps the decoder's own error.
  // opts.onRead(byteCount) runs after the file is read and opts.onFallback()
  // when the plugin's reader is used. Resolves like decodeToMono44100.
  function decodeFileToMono44100(path, opts) {
    opts = opts || {};
    return readFileAsArrayBuffer(path).then(function (arrayBuffer) {
      if (opts.onRead) {
        opts.onRead(arrayBuffer.byteLength);
      }
      return decodeToMono44100(arrayBuffer).catch(function (decodeErr) {
        if (!/\.(wav|aif|aiff)$/i.test(path) || !window.cep_node) {
          throw decodeErr;
        }
        var reader;
        var info;
        try {
          reader = window.cep_node.require(new CSInterface().getSystemPath(SystemPath.EXTENSION) + "/worker/wav-excerpt.js");
          info = reader.probe(path);
        } catch (readerErr) {
          throw decodeErr;
        }
        if (opts.onFallback) {
          opts.onFallback();
        }
        return {
          samples: reader.readExcerpt(path, info, 0, info.durationSec),
          original: { durationSec: info.durationSec, sampleRate: info.header.fmt.rate, channels: info.header.fmt.channels }
        };
      });
    });
  }

  global.BeatMarkerAudio = {
    TARGET_SAMPLE_RATE: TARGET_SAMPLE_RATE,
    readFileAsArrayBuffer: readFileAsArrayBuffer,
    decodeToMono44100: decodeToMono44100,
    decodeFileToMono44100: decodeFileToMono44100,
    decodeToBuffer: decodeToBuffer,
    resampleMono: resampleMono
  };
})(window);
