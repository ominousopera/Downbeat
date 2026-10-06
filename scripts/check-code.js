"use strict";
// Code checks run by build-zxp.sh before every build. Third-party files
// (js/lib/, js/CSInterface.js, jsx/json2.js, scripts/vendor/) and the
// generated js/ucs-data.js are left out. The panel makes no network calls: the
// one exception is js/update-check.js (the optional update notice, off until
// the user turns it on), which may use Node's https for this project's GitHub
// release record only. Run: node scripts/check-code.js.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const acorn = require(path.join(__dirname, "vendor", "acorn-8.15.0.js"));
const THIRD_PARTY = /^(js\/lib\/|js\/CSInterface\.js$|jsx\/json2\.js$|scripts\/vendor\/|js\/ucs-data\.js$|assets\/)/;
const GLOBALS = new Set(("window document console Math JSON Promise setTimeout clearTimeout setInterval clearInterval " +
  "requestAnimationFrame cancelAnimationFrame Date Number String Boolean Array Object Error TypeError RangeError RegExp " +
  "Float32Array Float64Array Int8Array Int16Array Int32Array Uint8Array Uint16Array Uint32Array ArrayBuffer DataView " +
  "isFinite isNaN parseInt parseFloat encodeURIComponent decodeURIComponent CSInterface SystemPath AudioContext " +
  "OfflineAudioContext Event navigator location Infinity NaN undefined arguments Map Set Intl globalThis performance " +
  "Blob URL FileReader Image CustomEvent getComputedStyle Proxy Symbol EssentiaWASM Essentia").split(" "));

const problems = [];
let listed = "";
try { listed = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { listed = ""; }
const tracked = listed.split("\n").filter(function (f) { return f && !THIRD_PARTY.test(f); });
if (!tracked.length) {
  console.error("check-code.js needs a git clone (git ls-files returned no files).");
  process.exit(1);
}
// 1. whitespace
tracked.filter(function (f) { return /\.(js|jsx|sh|py|css|html|md|xml|json)$/.test(f); }).forEach(function (f) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  const lines = text.split("\n");
  const bad = [];
  if (text.indexOf("\r") !== -1) { bad.push("CR line endings"); }
  if (text.length && text[text.length - 1] !== "\n") { bad.push("no final newline"); }
  const trailing = lines.filter(function (l) { return /[ \t]$/.test(l); }).length;
  const tabs = lines.filter(function (l) { return l.indexOf("\t") !== -1; }).length;
  if (trailing) { bad.push(trailing + " line(s) with trailing spaces"); }
  if (tabs) { bad.push(tabs + " line(s) with tabs"); }
  if (bad.length) { problems.push(f + ": " + bad.join(", ")); }
});
// 2. header comments
const scripts = tracked.filter(function (f) { return /^(js|worker)\/.*\.js$|^jsx\/.*\.jsx$|^scripts\/[^/]+\.(js|sh)$/.test(f); });
scripts.forEach(function (f) {
  const first = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n")
    .filter(function (l) { return l.trim() && !/^#!/.test(l) && !/^["']use strict["'];$/.test(l.trim()); })[0] || "";
  if (!/^\s*(\/\/|\/\*|#)/.test(first)) { problems.push(f + ": no header comment saying what the file is"); }
});

function parse(f) {
  return acorn.parse(fs.readFileSync(path.join(ROOT, f), "utf8"), { ecmaVersion: "latest", locations: true });
}
function walk(node, visit, parent, key) {
  if (!node || typeof node.type !== "string") { return; }
  visit(node, parent, key);
  for (const k in node) {
    if (k === "loc") { continue; }
    const v = node[k];
    if (Array.isArray(v)) { v.forEach(function (c) { walk(c, visit, node, k); }); }
    else if (v && typeof v.type === "string") { walk(v, visit, node, k); }
  }
}
// 3. undeclared names in the panel scripts
const panelScripts = tracked.filter(function (f) { return /^js\/[^/]+\.js$/.test(f); });
panelScripts.forEach(function (f) {
  const declared = new Set();
  const used = new Set();
  walk(parse(f), function (node, parent, key) {
    if (node.type === "VariableDeclarator") { declared.add(node.id.name); }
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
      if (node.id) { declared.add(node.id.name); }
      node.params.forEach(function (p) { declared.add(p.name); });
    }
    if (node.type === "CatchClause" && node.param) { declared.add(node.param.name); }
    if (node.type === "Identifier") {
      const isProp = parent && parent.type === "MemberExpression" && key === "property" && !parent.computed;
      const isKey = parent && parent.type === "Property" && key === "key";
      if (!isProp && !isKey) { used.add(node.name); }
    }
  });
  const missing = Array.from(used).filter(function (n) { return !declared.has(n) && !GLOBALS.has(n); });
  if (missing.length) { problems.push(f + ": undeclared " + missing.join(", ")); }
});
// 4 and 5. modules made by main.js
const mainAst = parse("js/main.js");
walk(mainAst, function (node) {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.property.name !== "create") { return; }
  const owner = node.callee.object;
  if (owner.type !== "MemberExpression" || owner.object.name !== "window" || !node.arguments[0] || node.arguments[0].type !== "ObjectExpression") { return; }
  const globalName = owner.property.name;
  const file = panelScripts.find(function (f) {
    return fs.readFileSync(path.join(ROOT, f), "utf8").indexOf("global." + globalName + " = { create: create }") !== -1;
  });
  if (!file) { problems.push("js/main.js: no file defines " + globalName + ".create"); return; }
  const passed = node.arguments[0].properties.map(function (p) { return p.key.name || p.key.value; });
  const read = new Set();
  let shadowLine = 0;
  walk(parse(file), function (n) {
    if (n.type === "MemberExpression" && n.object.type === "Identifier" && n.object.name === "ctx" && !n.computed) { read.add(n.property.name); }
    if (n.type === "FunctionDeclaration" && n.id.name === "create") {
      walk(n.body, function (m) {
        if (m.type === "VariableDeclarator" && m.id.name === "ctx") { shadowLine = m.loc.start.line; }
        if ((m.type === "FunctionDeclaration" || m.type === "FunctionExpression") && m.params.some(function (p) { return p.name === "ctx"; })) { shadowLine = m.loc.start.line; }
      });
    }
  });
  const unused = passed.filter(function (k) { return !read.has(k); });
  const notPassed = Array.from(read).filter(function (k) { return passed.indexOf(k) === -1; });
  if (unused.length) { problems.push(file + ": main.js passes ctx keys it never reads: " + unused.join(", ")); }
  if (notPassed.length) { problems.push(file + ": reads ctx keys main.js does not pass: " + notPassed.join(", ")); }
  if (shadowLine) { problems.push(file + ":" + shadowLine + ": a local ctx inside create() hides the module's ctx"); }
});
// 6. no network calls
const NETWORK = [
  [/\bfetch\s*\(/, "fetch()"], [/\bXMLHttpRequest\b/, "XMLHttpRequest"], [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"], [/\bsendBeacon\b/, "sendBeacon"],
  [/require\(\s*["'](node:)?(https?|net|tls|dgram|http2)["']\s*\)/, "Node network module"],
  [/\bimport\s*\(\s*["'](node:)?(https?|net|tls|dgram|http2)["']/, "dynamic import of a network module"],
  [/\bwindow\.open\s*\(/, "window.open"], [/\bnew\s+Image\s*\(/, "new Image() (loads a URL)"],
  [/["'`](curl|wget)["'`]/, "curl / wget"]
];
// The one exception: the optional update notice. Its file may use Node's
// https and nothing else that goes online, and it may name only GitHub's
// release record of this project.
const UPDATE_FILE = "js/update-check.js";
tracked.filter(function (f) { return /^(js|worker)\/.*\.js$|^jsx\/.*\.jsx$/.test(f); }).forEach(function (f) {
  if (f === UPDATE_FILE) {
    const own = fs.readFileSync(path.join(ROOT, f), "utf8");
    const hosts = own.match(/["']https?:\/\/[^"']*["']|host:\s*HOST|var HOST = ["'][^"']*["']/g) || [];
    hosts.forEach(function (h) {
      if (!/ominousopera\/Downbeat|host:\s*HOST|var HOST = ["']api\.github\.com["']/.test(h)) {
        problems.push(f + ": talks to something other than this project's GitHub release record: " + h);
      }
    });
    if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(own)) {
      problems.push(f + ": only Node's https is allowed for the update notice");
    }
    return;
  }
  const code = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
  NETWORK.forEach(function (n) {
    if (n[0].test(code)) { problems.push(f + ": network call (" + n[1] + ") - the plugin never goes online"); }
  });
  if (/openURLInDefaultBrowser/.test(code) && f !== "js/settings-panel.js") {
    problems.push(f + ": opens a web page outside the settings panel's confirmation");
  }
});
// The page and the stylesheets load nothing from the web either.
tracked.filter(function (f) { return /^index\.html$|^css\/.*\.css$/.test(f); }).forEach(function (f) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/<(script|link|img|iframe|source|video|audio)\b[^>]*\b(src|href)\s*=\s*["']?(https?:)?\/\//i.test(text)) {
    problems.push(f + ": loads something from the web (external src / href)");
  }
  if (/@import\s|url\(\s*["']?(https?:)?\/\//i.test(text)) {
    problems.push(f + ": CSS loads something from the web (@import / url(http))");
  }
});

if (problems.length) {
  console.error(problems.join("\n"));
  console.error("\n" + problems.length + " code check(s) failed");
  process.exit(1);
}
console.log("code checks pass: whitespace, headers, declared names, module ctx keys, no network calls (" + tracked.length + " files)");
