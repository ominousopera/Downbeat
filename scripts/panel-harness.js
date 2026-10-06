"use strict";
// A stub browser + host for the panel, built from the real index.html, so the
// panel's own scripts can run under plain Node with no Premiere and no
// browser. Shared by test-panel-boot.js (boot, languages, Delete my data) and
// test-analyze-pipeline.js (a real Analyze through the real workers).
const fs = require("fs");
const path = require("path");
// DOWNBEAT_ROOT: build-zxp.sh points this at the staged release copy.
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");

function bootPanel(options) {
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
// Every element the panel can reach - by id, by class, or through a
// data-i18n* attribute - parsed from the real markup with its attributes and
// its own first text node, so text hardcoded in the markup is visible to the
// language checks too. Comments are blanked first (same length, so offsets
// stay valid) because some mention tags in prose.
const markup = html.replace(/<!--[\s\S]*?-->/g, function (m) { return " ".repeat(m.length); });
const ENTITIES = { "&amp;": "&", "&middot;": "\u00b7", "&#8212;": "\u2014", "&nbsp;": " ", "&lt;": "<", "&gt;": ">" };
function decode(t) { return t.replace(/&[#\w]+;/g, function (e) { return ENTITIES[e] !== undefined ? ENTITIES[e] : e; }); }
const parsed = [];
const tagRe = /<([a-zA-Z][\w-]*)(\s[^>]*?)?\/?>/g;
let tm;
while ((tm = tagRe.exec(markup))) {
  const attrsText = tm[2] || "";
  if (!/\s(id|class|name|data-[\w-]+)=/.test(attrsText)) { continue; }
  const attrs = {};
  attrsText.replace(/([\w:-]+)(?:="([^"]*)")?/g, function (m, k, v) { attrs[k] = v === undefined ? "" : decode(v); return m; });
  const rest = markup.slice(tagRe.lastIndex);
  parsed.push({ tag: tm[1].toLowerCase(), attrs: attrs, offset: tm.index, text: decode(rest.slice(0, rest.indexOf("<")).trim()) });
}

function makeEl(tag, id) {
  const listeners = {};
  const el = {
    tagName: (tag || "div").toUpperCase(), id: id || "", value: "", textContent: "",
    innerHTML: "", hidden: false, disabled: false, checked: false, children: [],
    style: {}, attrs: {}, dataset: {}, _cls: {}, options: [], selectedIndex: -1,
    classList: {
      add: function (c) { el._cls[c] = 1; },
      remove: function (c) { delete el._cls[c]; },
      toggle: function (c, on) {
        const want = on === undefined ? !el._cls[c] : on;
        if (want) { el._cls[c] = 1; } else { delete el._cls[c]; }
      },
      contains: function (c) { return !!el._cls[c]; }
    },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: function () {},
    _fire: function (type, evt) { (listeners[type] || []).forEach(function (fn) { fn.call(el, evt || { target: el, preventDefault: function () {} }); }); },
    setAttribute: function (k, v) { el.attrs[k] = v; },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
    removeAttribute: function (k) { delete el.attrs[k]; },
    hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(el.attrs, k); },
    // Like the DOM, appending a DocumentFragment moves its children in and
    // leaves it empty (the Library list is built in one fragment).
    appendChild: function (c) {
      if (c && c._isFragment) {
        c.children.splice(0).forEach(function (k) { el.children.push(k); });
      } else {
        el.children.push(c);
      }
      el.firstChild = el.children[0];
      return c;
    },
    insertBefore: function (c) { el.children.unshift(c); el.firstChild = el.children[0]; return c; },
    removeChild: function (c) {
      const i = el.children.indexOf(c);
      if (i >= 0) { el.children.splice(i, 1); }
      el.firstChild = el.children[0] || null;
      return c;
    },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    closest: function () { return null; },
    contains: function () { return true; },
    getBoundingClientRect: function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    scrollIntoView: function () {},
    select: function () {}, focus: function () {}, blur: function () {}, click: function () { el._fire("click"); },
    // <audio> (the beat-click preview) and <canvas> (its waveform)
    play: function () { return Promise.resolve(); }, pause: function () {}, load: function () {},
    currentTime: 0, duration: 0, paused: true, volume: 1, src: "",
    getContext: function () {
      return new Proxy({}, { get: function (t, k) { return k in t ? t[k] : function () { return { data: [] }; }; }, set: function (t, k, v) { t[k] = v; return true; } });
    },
    width: 300, height: 60, clientWidth: 300, clientHeight: 60, offsetWidth: 300,
    scrollTop: 0, scrollHeight: 0, firstChild: null, parentNode: null
  };
  // Like a real DOM: setting textContent replaces the children, and reading
  // it returns the element's own text plus its children's.
  let ownText = "";
  Object.defineProperty(el, "textContent", {
    get: function () { return ownText + el.children.map(function (c) { return c.textContent || ""; }).join(""); },
    set: function (v) { ownText = String(v); el.children = []; el.firstChild = null; },
    enumerable: true, configurable: true
  });
  return el;
}

const registry = {};
const allEls = [];
parsed.forEach(function (p) {
  const el = makeEl(p.tag, p.attrs.id);
  el.attrs = p.attrs;
  (p.attrs.class || "").split(/\s+/).filter(Boolean).forEach(function (c) { el._cls[c] = 1; });
  el.value = p.attrs.value || "";
  el.checked = "checked" in p.attrs;
  el.hidden = "hidden" in p.attrs;
  el.title = p.attrs.title || "";
  el.placeholder = p.attrs.placeholder || "";
  el.textContent = p.text;
  el._offset = p.offset;
  allEls.push(el);
  if (p.attrs.id) { registry[p.attrs.id] = el; }
});
// End offset of a container element, by counting nested same-name tags.
function spanEnd(el) {
  const name = el.tagName.toLowerCase();
  const re = new RegExp("<(/?)" + name + "\\b[^>]*>", "g");
  re.lastIndex = el._offset;
  let depth = 0, m;
  while ((m = re.exec(markup))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { return m.index; }
  }
  return markup.length;
}
// The handful of selector shapes the panel actually uses: ".cls", "[attr]",
// "#id", "#id .cls", and radio groups as 'input[name="x"]' /
// 'input[name="x"]:checked'.
function select(sel) {
  let m;
  if ((m = sel.match(/^#([\w-]+)$/))) { return registry[m[1]] ? [registry[m[1]]] : []; }
  if ((m = sel.match(/^(\w+)\[name="([^"]+)"\](:checked)?$/))) {
    return allEls.filter(function (e) {
      return e.tagName.toLowerCase() === m[1] && e.attrs.name === m[2] && (!m[3] || e.checked);
    });
  }
  if ((m = sel.match(/^\.([\w-]+)$/))) { return allEls.filter(function (e) { return e._cls[m[1]]; }); }
  if ((m = sel.match(/^([a-z]+)$/))) { return allEls.filter(function (e) { return e.tagName.toLowerCase() === m[1]; }); }
  if ((m = sel.match(/^\[([\w-]+)\]$/))) { return allEls.filter(function (e) { return m[1] in e.attrs; }); }
  if ((m = sel.match(/^#([\w-]+)\s+\.([\w-]+)$/))) {
    const box = registry[m[1]];
    if (!box) { return []; }
    const end = spanEnd(box);
    return allEls.filter(function (e) { return e._cls[m[2]] && e._offset > box._offset && e._offset < end; });
  }
  throw new Error("test stub does not understand selector: " + sel);
}

global.window = global;
Object.defineProperty(global, "navigator", {
  value: { userAgent: "node-boot-harness", clipboard: null, language: "en" },
  configurable: true, writable: true
});
global.document = {
  readyState: "complete",
  body: makeEl("body"),
  documentElement: makeEl("html"),
  getElementById: function (id) { return registry[id] || null; },
  createElement: function (t) { return makeEl(t); },
  createElementNS: function (ns, t) { return makeEl(t); },
  createTextNode: function (t) { return { textContent: t }; },
  createDocumentFragment: function () { const f = makeEl("fragment"); f._isFragment = true; return f; },
  querySelectorAll: select,
  querySelector: function (sel) { return select(sel)[0] || null; },
  // Document-level listeners are kept, so a test can send a key with
  // document._fire("keydown", { key: "ArrowDown", target: document.body }).
  _listeners: {},
  addEventListener: function (type, fn) { (global.document._listeners[type] = global.document._listeners[type] || []).push(fn); },
  removeEventListener: function () {},
  _fire: function (type, evt) {
    const e = Object.assign({ preventDefault: function () {}, stopPropagation: function () {} }, evt || {});
    (global.document._listeners[type] || []).forEach(function (fn) { fn(e); });
    return e;
  },
  execCommand: function () { return true; }
};
global.addEventListener = function () {};
global.removeEventListener = function () {};
global.requestAnimationFrame = function () { return 0; };
global.cancelAnimationFrame = function () {};
global.scrollTo = function () {};
global.getComputedStyle = function () { return {}; };
// setInterval never fires by itself; a test can run the registered callbacks
// (e.g. the panel's selection polling) via runIntervals().
const intervals = [];
if (!options.realIntervals) {
  global.setInterval = function (fn) { intervals.push(fn); return intervals.length; };
  global.clearInterval = function () {};
}
if (!options.realTimeouts) {
  global.setTimeout = function () { return 0; };
  global.clearTimeout = function () {};
}
// By default the host never answers - the real situation while Premiere is
// still starting up, so the panel must boot without it. A test can pass its
// own evalScript to play the host.
global.SystemPath = { EXTENSION: "extension", MY_DOCUMENTS: "myDocuments", USER_DATA: "userData" };
global.CSInterface = function () {
  return {
    evalScript: options.evalScript || function () {},
    getSystemPath: function (kind) { return kind === "myDocuments" ? options.docsDir : ROOT; },
    getHostEnvironment: function () { return { appName: options.appName || "PPRO", appVersion: "0", appLocale: "en_US" }; },
    getOSInformation: function () { return "Mac OS X 15.0.0"; },
    addEventListener: function () {},
    removeEventListener: function () {},
    openURLInDefaultBrowser: function () {},
    requestOpenExtension: function () {},
    getExtensionID: function () { return "com.downbeat.pro"; }
  };
};
global.cep_node = { require: require };
// Load the panel scripts in exactly the order index.html does.
const scripts = [];
const scriptRe = /<script src="(?:\.\/)?js\/([^"]+)"><\/script>/g;
let sm;
while ((sm = scriptRe.exec(html))) {
  if (sm[1] !== "CSInterface.js") { scripts.push(sm[1]); }
}
for (const f of scripts) {
  try {
    require(path.join(ROOT, "js", f));
  } catch (e) {
    const err = new Error("loading js/" + f + " failed: " + (e && e.stack ? e.stack.split("\n").slice(0, 5).join("\n  ") : e));
    err.loadFailure = true;
    throw err;
  }
}
return { registry: registry, allEls: allEls, select: select, ROOT: ROOT,
         runIntervals: function () { intervals.forEach(function (fn) { fn(); }); } };
}

module.exports = { bootPanel: bootPanel, ROOT: ROOT };
