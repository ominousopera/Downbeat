// Resolve finished-audio destinations and create files without overwriting.
(function (global) {
  "use strict";
  function directory(settings, projectFile, dataDir, path) {
    var mode = settings.audioOutputMode || "documents";
    if (mode === "project") {
      if (!projectFile) { throw new Error("output.projectUnsaved"); }
      return path.join(path.dirname(projectFile), "Downbeat", "processed");
    }
    if (mode === "custom") {
      if (!settings.audioOutputFolder || !path.isAbsolute(settings.audioOutputFolder)) {
        throw new Error("output.folderMissing");
      }
      return settings.audioOutputFolder;
    }
    return path.join(dataDir, "processed");
  }
  function save(bytes, folder, sourcePath, fs, path) {
    fs.mkdirSync(folder, { recursive: true });
    var stem = path.basename(sourcePath, path.extname(sourcePath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "audio";
    var name = stem + "-metronome";
    for (var i = 0; i < 1000; i++) {
      var file = path.join(folder, name + (i ? "-" + i : "") + ".wav");
      var fd;
      try { fd = fs.openSync(file, "wx"); }
      catch (e) { if (e.code === "EEXIST") { continue; } throw e; }
      try { fs.writeFileSync(fd, bytes); fs.closeSync(fd); }
      catch (e) {
        try { fs.closeSync(fd); } catch (closeErr) { /* cleanup failure is secondary */ }
        try { fs.unlinkSync(file); } catch (removeErr) { /* never remove an existing destination */ }
        throw e;
      }
      return file;
    }
    throw new Error("output.nameCollision");
  }
  global.BeatMarkerAudioOutput = { directory: directory, save: save };
})(window);
