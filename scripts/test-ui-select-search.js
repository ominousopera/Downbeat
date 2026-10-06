"use strict";
// Searchable drawn dropdowns: a <select> marked data-searchable gets a box to
// type in; the options narrow as you type, "All ..." stays, Enter picks the
// first match, a select's own _dbFilter decides when set, a closed list gives
// the keyboard back, and the box sits in an opaque header so rows do not show
// around it. Run: node scripts/test-ui-select-search.js.
const path = require("path");

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}

function El(tag) {
  this.tagName = tag.toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.attrs = {};
  this.listeners = {};
  this.hidden = false;
  this._text = "";
  this.className = "";
  const self = this;
  this.classList = {
    add: function (c) { if (!self.classList.contains(c)) { self.className = (self.className + " " + c).trim(); } },
    remove: function (c) { self.className = self.className.split(" ").filter(function (x) { return x !== c; }).join(" "); },
    contains: function (c) { return self.className.split(" ").indexOf(c) !== -1; }
  };
}
Object.defineProperty(El.prototype, "textContent", {
  get: function () { return this.children.length ? this.children.map(function (c) { return c.textContent; }).join("") : this._text; },
  set: function (v) { this.children.forEach(function (c) { c.parentNode = null; }); this.children = []; this._text = String(v); }
});
El.prototype.appendChild = function (c) {
  if (c.parentNode) { c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); }
  c.parentNode = this; this.children.push(c); return c;
};
El.prototype.insertBefore = function (c, ref) {
  if (c.parentNode) { c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); }
  c.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, c); return c;
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
El.prototype.hasAttribute = function (k) { return k in this.attrs; };
El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
El.prototype.dispatchEvent = function (evt) { const self = this; (this.listeners[evt.type] || []).forEach(function (fn) { fn.call(self, evt); }); return true; };
El.prototype.fire = function (type, extra) {
  return this.dispatchEvent(Object.assign({ type: type, target: this, preventDefault: function () { this.defaultPrevented = true; }, stopPropagation: function () {} }, extra || {}));
};
El.prototype.focus = function () { global.document.activeElement = this; };
El.prototype.blur = function () { if (global.document.activeElement === this) { global.document.activeElement = null; } };
El.prototype.querySelector = function (sel) {
  const cls = sel.replace(/^\./, "");
  for (const c of this.children) {
    if (c.classList.contains(cls)) { return c; }
    const deeper = c.querySelector(sel);
    if (deeper) { return deeper; }
  }
  return null;
};

function makeSelect(options) {
  const s = new El("select");
  s.selectedIndex = 0;
  options.forEach(function (o) { const opt = new El("option"); opt.value = o[0]; opt.textContent = o[1]; s.appendChild(opt); });
  Object.defineProperty(s, "options", { get: function () { return s.children; } });
  Object.defineProperty(s, "value", { get: function () { return s.children[s.selectedIndex] ? s.children[s.selectedIndex].value : ""; } });
  return s;
}

global.window = global;
global.Event = function (type) { this.type = type; };
global.document = new El("document");
global.document.activeElement = null;
global.document.createElement = function (tag) { return new El(tag); };
require(path.join(__dirname, "..", "js", "ui-select.js"));
// A folder list: plain word-start matching on the labels.
const box = new El("div");
const folders = makeSelect([["", "All folders"], ["/a", "Cinematic Hits (40)"], ["/b", "Whooshes (12)"], ["/c", "White Noise (3)"], ["/d", "Ambience Hits (7)"]]);
folders.setAttribute("data-searchable", "");
folders.setAttribute("data-search-placeholder", "Type to filter");
box.appendChild(folders);
let changes = 0;
folders.addEventListener("change", function () { changes++; });
const inst = window.BeatMarkerSelect.enhance(folders);
const wrap = box.children[0];
const button = wrap.children[0], list = wrap.children[1];
button.fire("click");
const head = list.children[0];
const search = head.children[0];
const items = list.children.slice(1);
check("a searchable list opens with a focused search box in its own header (no top gap for rows to show through)",
  !list.hidden && head.className === "db-select-search-head" && search.className === "db-select-search" && /is-searchable/.test(list.className) &&
  search.placeholder === "Type to filter" && document.activeElement === search && items.length === 5);
search.value = "hit";
search.fire("input");
const shown = function () { return items.filter(function (i) { return !i.hidden; }).map(function (i) { return i.textContent; }); };
check("typing narrows to word starts, and All stays", shown().join("|") === "All folders|Cinematic Hits (40)|Ambience Hits (7)", shown().join("|"));
search.value = "wh";
search.fire("input");
check("... \"wh\" finds Whooshes and White Noise", shown().join("|") === "All folders|Whooshes (12)|White Noise (3)", shown().join("|"));
search.value = "amb hit";
search.fire("input");
check("... every typed word must match", shown().join("|") === "All folders|Ambience Hits (7)", shown().join("|"));
search.fire("keydown", { key: "Enter" });
check("Enter picks the first match and closes the list", folders.value === "/d" && changes === 1 && list.hidden, folders.value);
check("the closed list gives the keyboard back", document.activeElement !== search);
button.fire("click");
check("opening again starts with an empty box and every option", list.children[0].children[0].value === undefined && list.children.slice(1).every(function (i) { return !i.hidden; }));
inst.close();
// A list with its own matcher (select._dbFilter).
const cats = makeSelect([["", "All"], ["I:DSGNWhsh", "Designed › Whoosh (4)"], ["I:FEETHmn", "Footsteps › Human (9)"]]);
cats.setAttribute("data-searchable", "");
box.appendChild(cats);
cats._dbFilter = function (q, v) { return q === "swoosh" && v === "I:DSGNWhsh"; };
window.BeatMarkerSelect.enhance(cats);
const cwrap = box.children[1];
cwrap.children[0].fire("click");
const csearch = cwrap.children[1].children[0].children[0];
csearch.value = "swoosh";
csearch.fire("input");
const cshown = cwrap.children[1].children.slice(1).filter(function (i) { return !i.hidden; }).map(function (i) { return i.textContent; });
check("a select's own matcher decides", cshown.join("|") === "All|Designed › Whoosh (4)", cshown.join("|"));
// A plain list gets no box.
const plain = makeSelect([["best", "best match"], ["name", "name"]]);
box.appendChild(plain);
window.BeatMarkerSelect.enhance(plain);
box.children[2].children[0].fire("click");
check("a list without data-searchable has no search box", box.children[2].children[1].children.every(function (c) { return c.className !== "db-select-search-head"; }) &&
  !/is-searchable/.test(box.children[2].children[1].className));

if (failures) {
  console.error("\n" + failures + " dropdown search check(s) failed");
  process.exit(1);
}
console.log("\nsearchable dropdowns narrow as you type and pick with Enter");
