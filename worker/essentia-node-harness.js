// Shared setup for running this project's essentia.js-dependent code
// (js/analyze.js and everything it pulls in) standalone in plain Node,
// outside the browser/CEF panel context. Used by worker/analyze-worker.js
// and scripts/analyze-cli.js.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TARGET_SAMPLE_RATE = 44100;

function setupBrowserLikeGlobals(libDir) {
  global.window = global;
  global.self = global;
  global.document = { currentScript: null };
  // Node's native fetch() does not support file:// URLs. js/analyze.js's
  // initEssentia() calls EssentiaWASM() with no options, so the glue falls
  // back to a bare relative filename ("essentia-wasm.web.wasm") with no base
  // URL to resolve it against outside a real page. This resolves anything
  // that is not an http(s) URL against libDir, where the .wasm lives next to
  // its .js glue. Downbeat never goes online: a web address is refused here
  // instead of being passed to the real fetch.
  global.fetch = async (url) => {
    const href = typeof url === "string" ? url : url.href;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href) && !/^file:\/\//i.test(href)) {
      throw new Error("Downbeat does not go online - refused to fetch " + href);
    }
    const filePath = href.startsWith("file://")
      ? require("url").fileURLToPath(href)
      : path.join(libDir, href);
    const buf = fs.readFileSync(filePath);
    return new Response(buf, { status: 200, headers: { "Content-Type": "application/wasm" } });
  };
}

function loadAsGlobalScript(absPath) {
  // essentia-wasm.web.js and essentia.js-core.js declare `var EssentiaWASM` /
  // `var Essentia` at top level with no module.exports, so they are loaded
  // with vm.runInThisContext (not require()) to attach to the real global
  // object instead of a CommonJS module wrapper.
  const code = fs.readFileSync(absPath, "utf8");
  vm.runInThisContext(code, { filename: absPath });
}

function loadEssentiaGlobals(libDir) {
  loadAsGlobalScript(path.join(libDir, "essentia-wasm.web.js"));
  loadAsGlobalScript(path.join(libDir, "essentia.js-core.js"));
}
function loadPluginModules(jsDir) {
  require(path.join(jsDir, "audio.js"));
  require(path.join(jsDir, "cuesheet.js"));
  require(path.join(jsDir, "camelot.js"));
  require(path.join(jsDir, "key-combine.js")); // the Library scan's 2-of-3 key rule
  require(path.join(jsDir, "analyze.js"));
}
// baseDir: the extension root (contains js/lib/*, js/*.js).
function initNodeEssentiaEnvironment(baseDir) {
  const libDir = path.join(baseDir, "js", "lib");
  const jsDir = path.join(baseDir, "js");
  setupBrowserLikeGlobals(libDir);
  loadEssentiaGlobals(libDir);
  loadPluginModules(jsDir);
}

module.exports = {
  TARGET_SAMPLE_RATE,
  initNodeEssentiaEnvironment,
};
