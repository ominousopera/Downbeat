// Bounded reuse of identical constrained passes on immutable decoded samples.
(function (global) {
  "use strict";
  function create(limit) {
    var rows = [];
    function clear() { rows = []; }
    function run(samples, audioPath, constraint, execute) {
      if (rows.length && rows[0].samples !== samples) { clear(); }
      var key = JSON.stringify([audioPath, constraint.minTempo, constraint.maxTempo]);
      var row = rows.filter(function (r) { return r.samples === samples && r.key === key; })[0];
      if (!row) {
        row = { samples: samples, key: key, pending: null };
        rows.push(row);
        if (rows.length > limit) { rows.shift(); }
        row.pending = Promise.resolve().then(execute).then(function (result) {
          return JSON.stringify(result);
        }).catch(function (err) {
          rows = rows.filter(function (r) { return r !== row; });
          throw err;
        });
      }
      // Consumers may adjust phase and grid arrays; each receives its own copy.
      return row.pending.then(function (json) { return JSON.parse(json); });
    }
    return { run: run, clear: clear };
  }
  function interval(samples, rate, clipInfo) {
    var start = Number(clipInfo.inPointSeconds), end = Number(clipInfo.outPointSeconds);
    if (!isFinite(start) || !isFinite(end) || start < 0 || !(end > start)) {
      throw new Error("The selected clip has no valid source interval.");
    }
    var first = Math.floor(start * rate), last = Math.min(samples.length, Math.ceil(end * rate));
    if (!(last > first)) { throw new Error("The selected interval contains no source audio."); }
    return { samples: samples.slice(first, last), startSample: first, endSample: last };
  }
  function scopeKey(scope, material, clipInfo, rate) {
    return scope === "clip" ? [material, Math.floor(clipInfo.inPointSeconds * rate), Math.ceil(clipInfo.outPointSeconds * rate)].join(":") : material;
  }
  global.BeatMarkerAnalysisCache = { create: create, interval: interval, scopeKey: scopeKey };
})(typeof window !== "undefined" ? window : globalThis);
