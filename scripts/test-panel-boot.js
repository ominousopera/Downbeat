"use strict";
// Boots the panel's JavaScript against a stub DOM built from the real
// index.html, with no browser and no host. The id check (check-dom-ids.py)
// cannot catch a boot failure; only actually running init() can.
// Also checks, because this is the one place the real panel code runs end to
// end without Premiere:
//  - booting writes nothing into the extension folder (any new file there
//    breaks the signed .zxp, see js/persistence.js's header);
//  - the Settings "Delete my data" button, clicked through its real handlers,
//    removes this plugin's own files from a fake Documents folder and leaves
//    a foreign file sitting next to them alone.
// Documents is pointed at a throwaway temp folder, never the real one.
const fs = require("fs");
const os = require("os");
const path = require("path");
// DOWNBEAT_ROOT: build-zxp.sh points this at the staged release copy.
const ROOT = process.env.DOWNBEAT_ROOT || path.join(__dirname, "..");
// Fake Documents with a previous session's data plus one foreign file.
const DOCS = fs.mkdtempSync(path.join(os.tmpdir(), "downbeat-boot-"));
const DATA = path.join(DOCS, "Downbeat");
fs.mkdirSync(path.join(DATA, "tmp"), { recursive: true });
fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify({ language: "ru", onboardingCompleted: true }));
fs.writeFileSync(path.join(DATA, "library.json"), "[]");
fs.writeFileSync(path.join(DATA, "sound-library.json"), JSON.stringify({ version: 1, folders: { music: [], sfx: ["/SFX"] },
  files: { "/SFX/hit.wav": { path: "/SFX/hit.wav", section: "sfx", name: "hit.wav", status: "done", v: 3, durationSec: 1 } } }));
fs.writeFileSync(path.join(DATA, "tmp", "samples-1-2.raw"), "x");
fs.writeFileSync(path.join(DATA, "not-ours.txt"), "user file");

function listTree(dir) {
  const out = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const st = fs.lstatSync(full);
      out.push(path.relative(ROOT, full));
      if (st.isDirectory() && !st.isSymbolicLink()) { walk(full); }
    }
  })(dir);
  return out.sort();
}
const extensionTreeBefore = listTree(ROOT);

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log("ok   " + label + (detail ? " - " + detail : "")); }
  else { failures++; console.error("FAIL " + label + (detail ? " - " + detail : "")); }
}
function cleanup() { fs.rmSync(DOCS, { recursive: true, force: true }); } // throwaway fixture made above
let panel;
try {
  panel = require("./panel-harness.js").bootPanel({ docsDir: DOCS });
} catch (e) {
  console.error("FAIL " + e.message);
  cleanup();
  process.exit(1);
}
const registry = panel.registry, allEls = panel.allEls, select = panel.select;

const footer = registry.settingsFooterText.textContent;
check("init() reached its last line", /^v/.test(footer), "footer reads '" + footer.slice(0, 40) + "'");
check("init() rendered the Camelot wheel", registry.camelotWheel.children.length > 0,
      registry.camelotWheel.children.length + " svg nodes");
// LANGUAGE SWITCHING. The panel boots in Russian. Click the real language
// buttons in Settings, then read every element the panel shows - markup text,
// titles, placeholders, and anything the script built at runtime - and look
// for text left in the previous language.
const i18nSrc = fs.readFileSync(path.join(ROOT, "js", "i18n.js"), "utf8");
function dictOf(lang) {
  const start = i18nSrc.indexOf("\n    " + lang + ": {");
  const block = i18nSrc.slice(start, i18nSrc.indexOf("\n    },", start));
  const out = {};
  const re = /^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(block))) { out[m[1]] = JSON.parse(m[2]); }
  return out;
}
const EN = dictOf("en"), RU = dictOf("ru");
function allShownTexts() {
  const out = [];
  function visit(el, where) {
    [el.textContent, el.title, el.placeholder].forEach(function (t) {
      if (t && String(t).trim()) { out.push({ where: where, text: String(t).trim() }); }
    });
    (el.children || []).forEach(function (c) { visit(c, where + " > " + (c.tagName || "?").toLowerCase()); });
  }
  allEls.forEach(function (el) {
    // Language buttons are named in their own language on purpose (the
    // Russian button shows its Cyrillic name in every UI language), like
    // every OS language picker.
    if (el._cls["lang-btn"]) { return; }
    visit(el, el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.attrs.class ? "." + el.attrs.class.split(/\s+/)[0] : ""));
  });
  return out;
}
function clickLanguage(lang) {
  const btn = select(".lang-btn").filter(function (b) { return b.attrs["data-lang"] === lang; })[0];
  btn._fire("click");
}
function reportLeftovers(label, offenders) {
  check(label, offenders.length === 0, offenders.length ? offenders.length + " element(s)" : "");
  offenders.slice(0, 15).forEach(function (o) { console.error("       " + o.where + ": \"" + o.text.slice(0, 90) + "\""); });
}
const CYRILLIC = /[\u0400-\u04FF]/;
clickLanguage("en");
reportLeftovers("English UI has no Russian text left over", allShownTexts().filter(function (o) { return CYRILLIC.test(o.text); }));
clickLanguage("es");
reportLeftovers("Spanish UI has no Russian text left over", allShownTexts().filter(function (o) { return CYRILLIC.test(o.text); }));
clickLanguage("ru");
// English strings that have a different Russian translation, still showing.
const englishOnly = {};
Object.keys(EN).forEach(function (k) { if (RU[k] && RU[k] !== EN[k] && /[a-z]{3,}/i.test(EN[k])) { englishOnly[EN[k].trim()] = k; } });
reportLeftovers("Russian UI has no English text left over", allShownTexts().filter(function (o) { return englishOnly[o.text]; }));
clickLanguage("en");
// The Guide opens rendered, not as raw Markdown.
registry.guideBtn._fire("click");
function kinds(el, acc) { (el.children || []).forEach(function (c) { acc[c.tagName] = (acc[c.tagName] || 0) + 1; kinds(c, acc); }); return acc; }
const guideKinds = kinds(registry.textViewerBody, {});
check("the Guide renders headings, lists and tables", guideKinds.H3 >= 1 && guideKinds.H4 >= 5 && guideKinds.TABLE >= 1 && guideKinds.LI >= 5,
      JSON.stringify(guideKinds));
check("no raw Markdown left in the Guide", !/\*\*|^\s*\|/m.test(registry.textViewerBody.textContent));
// The Guide in the panel's language: GUIDE.ru.md / GUIDE.es.md.
function allText(el) { return (el.textContent || "") + " " + (el.children || []).map(allText).join(" "); }
const guideTitles = {};
["ru", "es", "en"].forEach(function (lang) {
  clickLanguage(lang);
  registry.guideBtn._fire("click");
  guideTitles[lang] = allText(registry.textViewerBody);
});
check("the Guide opens in the panel's language",
  /\u0433\u0430\u0439\u0434 \/ FAQ/.test(guideTitles.ru) && /Gu\u00eda \/ FAQ/.test(guideTitles.es) && /Guide \/ FAQ/.test(guideTitles.en) &&
  !/Qu\u00e9 hace/.test(guideTitles.en));
registry.thirdPartyNoticesBtn._fire("click");
const noticeKinds = kinds(registry.textViewerBody, {});
check("third-party notices render too, hash lists as code blocks", noticeKinds.H4 >= 5 && noticeKinds.PRE >= 1 &&
      !/```/.test(registry.textViewerBody.textContent), JSON.stringify({ H4: noticeKinds.H4, PRE: noticeKinds.PRE }));
registry.licenseBtn._fire("click");
check("the License stays plain text", /GNU AFFERO GENERAL PUBLIC LICENSE/.test(registry.textViewerBody.textContent) &&
      registry.textViewerBody.children.length === 0);
check("pitch calculator rendered at boot", registry.pitchSemitones.textContent === "No shift",
      "reads '" + registry.pitchSemitones.textContent + "'");
registry.pitchFromSelect.value = "8A"; // A minor
registry.pitchToSelect.value = "10A"; // B minor: +2
registry.pitchFromSelect._fire("change");
check("pitch calculator answers a real shift", registry.pitchSemitones.textContent === "+2 semitones",
      "reads '" + registry.pitchSemitones.textContent + "'");
registry.pitchToSelect.value = "8B"; // C major: unreachable by pitching from A minor
registry.pitchToSelect._fire("change");
check("pitch calculator warns that minor cannot become major",
      /is-caveat/.test(registry.pitchNote.className) && /8B/.test(registry.pitchNote.textContent));
window.BeatMarkerI18n.setLanguage("ru");
registry.pitchToSelect.value = "9A"; // E minor: -5
registry.pitchToSelect._fire("change");
const ruFive = registry.pitchSemitones.textContent;
registry.pitchToSelect.value = "10A"; // +2
registry.pitchToSelect._fire("change");
const ruTwo = registry.pitchSemitones.textContent;
window.BeatMarkerI18n.setLanguage("en");
// The two Russian forms of "semitones" (5+ and 2-4), written as escapes to
// keep this file ASCII-only.
check("Russian plural forms", /\u043f\u043e\u043b\u0443\u0442\u043e\u043d\u043e\u0432$/.test(ruFive) && /\u043f\u043e\u043b\u0443\u0442\u043e\u043d\u0430$/.test(ruTwo), "'" + ruFive + "', '" + ruTwo + "'");
// Music / SFX switch for key detection: starts on Music, a click moves the
// highlight and is remembered in settings.
check("key material starts on Music", registry.keyMaterialMusicBtn.classList.contains("is-active") &&
      !registry.keyMaterialSfxBtn.classList.contains("is-active"));
registry.keyMaterialSfxBtn._fire("click");
const savedSettings = JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf8"));
check("clicking Sound effect switches and is remembered",
      registry.keyMaterialSfxBtn.classList.contains("is-active") && savedSettings.keyMaterial === "sfx",
      "settings.keyMaterial=" + savedSettings.keyMaterial);

check("startup swept the leftover temp file", !fs.existsSync(path.join(DATA, "tmp", "samples-1-2.raw")));
check("startup sweep left settings and library alone",
      fs.existsSync(path.join(DATA, "settings.json")) && fs.existsSync(path.join(DATA, "library.json")));
// Delete my data, through the real click handlers.
check("the saved Music / SFX library loaded at startup", Object.keys(window.BeatMarkerSoundLibrary.getState().files).length === 1);
registry.deleteDataBtn._fire("click");
const preview = registry.deleteDataMessage.textContent;
check("delete dialog opens", registry.deleteDataOverlay.hidden === false);
check("delete dialog lists the plugin's own files", /settings\.json/.test(preview) && /library\.json/.test(preview) && /sound-library\.json/.test(preview));
check("delete dialog does not list the foreign file", !/not-ours\.txt/.test(preview));
check("delete dialog offers a Delete button", registry.deleteDataConfirmBtn.hidden === false);
registry.deleteDataConfirmBtn._fire("click");
check("own files are gone",
      !fs.existsSync(path.join(DATA, "settings.json")) && !fs.existsSync(path.join(DATA, "library.json")) &&
      !fs.existsSync(path.join(DATA, "sound-library.json")));
check("the foreign file is untouched", fs.readFileSync(path.join(DATA, "not-ours.txt"), "utf8") === "user file");
check("the dialog switched to its result", registry.deleteDataConfirmBtn.hidden === true,
      "'" + registry.deleteDataMessage.textContent.slice(0, 50) + "'");
check("the Music / SFX library in memory is emptied too, so no later save writes it back",
      Object.keys(window.BeatMarkerSoundLibrary.getState().files).length === 0 &&
      window.BeatMarkerSoundLibrary.getFolders("sfx").length === 0);

const extensionTreeAfter = listTree(ROOT);
const added = extensionTreeAfter.filter(function (p) { return extensionTreeBefore.indexOf(p) === -1; });
check("nothing was written into the extension folder", added.length === 0, added.length ? added.join(", ") : "");

cleanup();
if (failures) {
  console.error("\n" + failures + " panel boot check(s) failed");
  process.exit(1);
}
console.log("\npanel boots, and Delete my data removes only its own files");
