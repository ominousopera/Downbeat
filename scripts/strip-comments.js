"use strict";
// Strips comments from the STAGED copy of the extension (what goes into the
// .zxp); the source files keep every comment. Third-party files (js/lib/,
// js/CSInterface.js, jsx/json2.js) are not touched: their license headers
// stay and their hashes still match NOTICE.md.
// How nothing but comments can change:
//  - JS / JSX: acorn splits the file into tokens; every token is copied byte
//    for byte, and only the gaps between tokens (whitespace and comments) are
//    rewritten. A gap that held a line break keeps one, so automatic
//    semicolon insertion sees the same code.
//  - Then a second, independent parser (esprima) tokenizes the original and
//    the result: the token lists must be identical, and so must the
//    line-break-or-not between every two tokens.
// Usage: node scripts/strip-comments.js <stagedDir>
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VENDOR = path.join(__dirname, "vendor");
const PINNED = {
  "acorn-8.15.0.js": "fdb08546776ec6228b03e8d02b40d4ab3255bae5f401adba7ff5dad927ac5c9c",
  "esprima-4.0.1.js": "6c36c0e60387f5398f98f68ac76ae832688b32fa9162eae4cc9b6b2cad5f554e"
};
for (const name of Object.keys(PINNED)) {
  const sum = crypto.createHash("sha256").update(fs.readFileSync(path.join(VENDOR, name))).digest("hex");
  if (sum !== PINNED[name]) {
    console.error("strip-comments: " + name + " does not match its pinned SHA-256 - not building.");
    process.exit(1);
  }
}
const acorn = require(path.join(VENDOR, "acorn-8.15.0.js"));
const esprima = require(path.join(VENDOR, "esprima-4.0.1.js"));

const LEGAL = "Downbeat - (c) 2026 Nikita Kolesov - AGPL-3.0, see LICENSE and NOTICE.md";
const THIRD_PARTY = new Set(["js/CSInterface.js", "jsx/json2.js"]);
const LOCALIZATION = new Set(["js/i18n.js", "js/ucs-data.js"]);
const CYRILLIC = /[\u0400-\u04FF]/;
const LINE_BREAK = /[\n\r\u2028\u2029]/;

function fail(msg) {
  console.error("strip-comments: " + msg);
  process.exit(1);
}
// ---- JS / JSX ---- ExtendScript's #include lines are not JavaScript:
// swapped for a placeholder call while parsing, put back after.
const INCLUDE = /^#include\s+("[^"\n]+")[ \t]*$/gm;
function hideIncludes(src) {
  return src.replace(INCLUDE, function (m, file) { return "__downbeatInclude__(" + file + ");"; });
}
function showIncludes(src) {
  return src.replace(/^__downbeatInclude__\(("[^"\n]+")\);$/gm, function (m, file) { return "#include " + file; });
}

function acornTokens(src) {
  const out = [];
  const tokenizer = acorn.tokenizer(src, { ecmaVersion: "latest", allowHashBang: true, allowReturnOutsideFunction: true });
  for (const t of tokenizer) { out.push({ start: t.start, end: t.end }); }
  return out;
}

function stripJs(src) {
  const tokens = acornTokens(src);
  let out = "";
  let pos = 0;
  for (let i = 0; i <= tokens.length; i++) {
    const gapEnd = i < tokens.length ? tokens[i].start : src.length;
    const gap = src.slice(pos, gapEnd);
    if (i === 0 || i === tokens.length) {
      out += i === 0 ? "" : "\n";
    } else if (LINE_BREAK.test(gap)) {
      const lastBreak = Math.max(gap.lastIndexOf("\n"), gap.lastIndexOf("\r"));
      const indent = gap.slice(lastBreak + 1);
      out += "\n" + (/^[ \t]*$/.test(indent) ? indent : "");
    } else if (gap.length) {
      out += /^[ \t]*$/.test(gap) ? gap : " ";
    }
    if (i < tokens.length) {
      out += src.slice(tokens[i].start, tokens[i].end);
      pos = tokens[i].end;
    }
  }
  return out;
}
// Independent check with esprima: same tokens, same line breaks between them.
function esprimaShape(src) {
  const body = src.replace(/^#![^\n]*/, function (m) { return " ".repeat(m.length); });
  const toks = esprima.tokenize(body, { range: true, tolerant: false });
  return toks.map(function (t, i) {
    const prevEnd = i ? toks[i - 1].range[1] : 0;
    return t.type + "\u0000" + t.value + "\u0000" + (i && LINE_BREAK.test(body.slice(prevEnd, t.range[0])) ? "nl" : "");
  });
}

function processJs(rel, src) {
  const isJsx = /\.jsx$/.test(rel);
  const parsed = isJsx ? hideIncludes(src) : src;
  let stripped = stripJs(parsed);
  // The full parse too, so a file that only tokenizes cleanly but is not a
  // program would still stop the build.
  try {
    acorn.parse(stripped, { ecmaVersion: "latest", allowHashBang: true, allowReturnOutsideFunction: true, sourceType: "script" });
  } catch (e) {
    fail(rel + ": the stripped file does not parse (" + e.message + ")");
  }
  const a = esprimaShape(parsed);
  const b = esprimaShape(stripped);
  if (a.length !== b.length) {
    fail(rel + ": esprima sees " + a.length + " tokens before and " + b.length + " after");
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      fail(rel + ": token " + i + " differs after stripping: " + JSON.stringify(a[i]) + " vs " + JSON.stringify(b[i]));
    }
  }
  if (isJsx) {
    stripped = showIncludes(stripped);
    if ((stripped.match(INCLUDE) || []).length !== (src.match(INCLUDE) || []).length) {
      fail(rel + ": #include lines changed");
    }
  }
  // Cyrillic only inside string literals, and only in the localization files.
  if (CYRILLIC.test(stripped)) {
    if (!LOCALIZATION.has(rel)) {
      fail(rel + ": Cyrillic left after stripping comments");
    }
    const withoutStrings = esprima.tokenize(stripped.replace(/^#![^\n]*/, ""))
      .filter(function (t) { return t.type !== "String" && t.type !== "Template"; })
      .map(function (t) { return t.value; }).join(" ");
    if (CYRILLIC.test(withoutStrings)) {
      fail(rel + ": Cyrillic outside a string literal");
    }
  }
  const hashBang = (src.match(/^#![^\n]*\n/) || [""])[0]; // acorn reads it as a comment
  return hashBang + "/* " + LEGAL + " */\n" + stripped;
}
// ---- CSS ----
function stripCss(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") { out += src[i + 1] || ""; i += 2; continue; }
      if (c === quote) { quote = null; }
      i++;
      continue;
    }
    if (c === "\"" || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) { fail("css: unterminated comment"); }
      const before = out.slice(-1);
      const after = src[end + 2] || "";
      out += (/\s/.test(before) || /\s/.test(after) || /[{};,:>]/.test(before) || /[{};,:>]/.test(after)) ? "" : " ";
      i = end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.split("\n").map(function (l) { return l.replace(/[ \t]+$/, ""); }).filter(function (l) { return l.length; }).join("\n") + "\n";
}
function processCss(rel, src) {
  const stripped = stripCss(src);
  const squash = function (s) { return s.replace(/\s+/g, ""); };
  if (squash(stripped) !== squash(src.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    fail(rel + ": the two ways of removing CSS comments disagree");
  }
  if (CYRILLIC.test(stripped)) { fail(rel + ": Cyrillic in CSS"); }
  return "/* " + LEGAL + " */\n" + stripped;
}
// ---- HTML / XML ----
function processMarkup(rel, src) {
  if (/<(script|style)\b[^>]*>[^<]*<!--/i.test(src)) { fail(rel + ": a comment inside an inline script or style"); }
  const stripped = src.replace(/<!--[\s\S]*?-->/g, "")
    .split("\n").map(function (l) { return l.replace(/[ \t]+$/, ""); }).filter(function (l) { return l.length; }).join("\n") + "\n";
  const tags = function (s) { return (s.replace(/<!--[\s\S]*?-->/g, "").match(/<\/?[A-Za-z][^>]*>/g) || []).join("\n"); };
  if (tags(stripped) !== tags(src)) { fail(rel + ": tags changed while removing comments"); }
  if (/<pre[^>]*>[^<]*\n/.test(stripped)) { fail(rel + ": a <pre> lost its line breaks"); }
  if (CYRILLIC.test(stripped)) { fail(rel + ": Cyrillic in markup"); }
  if (/\.html$/.test(rel)) {
    return stripped.replace(/^(<!doctype html>\n?)/i, "$1<!-- " + LEGAL + " -->\n");
  }
  return stripped;
}
// ---- walk the staged copy ----
const STAGE = process.argv[2];
if (!STAGE || !fs.existsSync(STAGE)) { fail("usage: node scripts/strip-comments.js <stagedDir>"); }
const targets = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(STAGE, full).split(path.sep).join("/");
    if (fs.statSync(full).isDirectory()) {
      if (rel === "js/lib" || rel === "runtime" || rel === "models" || rel === "assets") { continue; }
      walk(full);
    } else if (/\.(js|jsx|css|html|xml)$/.test(name) && !THIRD_PARTY.has(rel)) {
      targets.push(rel);
    }
  }
}
walk(STAGE);
let before = 0;
let after = 0;
for (const rel of targets.sort()) {
  const full = path.join(STAGE, rel);
  const src = fs.readFileSync(full, "utf8");
  let out;
  if (/\.(js|jsx)$/.test(rel)) { out = processJs(rel, src); }
  else if (/\.css$/.test(rel)) { out = processCss(rel, src); }
  else { out = processMarkup(rel, src); }
  fs.writeFileSync(full, out);
  before += Buffer.byteLength(src);
  after += Buffer.byteLength(out);
}
console.log("  comments removed from " + targets.length + " files (" + (before / 1024).toFixed(0) + " KB -> " + (after / 1024).toFixed(0) +
            " KB); tokens checked by a second parser; Cyrillic only in the localization strings");
