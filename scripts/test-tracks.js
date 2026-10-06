"use strict";
// Finds the local test tracks by role (see named()). The tracks are not in
// the repository; a test that needs one skips when it is missing.
const fs = require("fs");
const path = require("path");

function localSetting(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "test-tracks.local.json"), "utf8"))[key] || null;
  } catch (e) {
    return null;
  }
}
const DIR = process.env.DOWNBEAT_TEST_MUSIC || localSetting("musicDir") || path.join(__dirname, "no-test-music-folder");
// The first file with this exact name under DIR (subfolders included), or a
// path that does not exist when there is none.
function find(name) {
  const queue = [DIR];
  while (queue.length) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === name) {
        return full;
      }
      if (e.isDirectory()) {
        queue.push(full);
      }
    }
  }
  return path.join(DIR, name);
}
// The tests name tracks by role, not by file name. The mapping from role to
// the real file name lives in scripts/test-tracks.local.json (not in git):
//   { "applies": "<file>.mp3", "rejected": "<file>.mp3", "perfect": ...,
//     "tension": ... }
// Without that file (or without the tracks) a test that needs one skips.
function named(role) {
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(path.join(__dirname, "test-tracks.local.json"), "utf8"));
  } catch (e) {
    map = {};
  }
  return find(map[role] || "(no test track mapped for " + role + ")");
}

module.exports = { DIR: DIR, find: find, named: named, localSetting: localSetting };
