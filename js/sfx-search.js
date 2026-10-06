// Library text search and UCS categories. Pure functions, no DOM: loaded by
// the panel after js/ucs-data.js, and by scripts/test-sfx-search.js.
// Each query word must match a file in one of three ways:
//  - in its name or folders, at the start of a word ("trac" finds "tractor",
//    "hit" does not find "white");
//  - through the UCS category of a UCS-named file ("DSGNWhsh_..." is
//    DESIGNED / WHOOSH, whose synonyms include swoosh, swish, whirr...);
//  - for any file, through the English name of a category the word points to
//    ("swoosh" -> WHOOSH, so "Fast Whoosh 03.wav" matches), the way a sound
//    library thesaurus works.
(function (global) {
  "use strict";

  var WORD_SPLIT = /[^0-9a-zà-ÿ\u0430-\u044f\u0451]+/;
  var index = null;

  function _norm(s) {
    return String(s || "").toLowerCase();
  }
  // term -> [{ id, how }]. How the term belongs to the category: "enCat" /
  // "enSub" its English category / subcategory name, "xxCat" / "xxSub" its
  // Russian or Spanish category / subcategory name, "synWhole" a whole listed
  // synonym ("swoosh" for WHOOSH), "synPart" one word of a longer synonym
  // ("riser" in "high-riser" for URBAN ambience).
  function _index() {
    if (index) {
      return index;
    }
    index = { byId: {}, terms: {}, termList: [] };
    var src = global.BeatMarkerUcsData;
    if (!src || !src.list) {
      return index;
    }
    function add(term, catId, how) {
      if (!term || term.length < 2) {
        return;
      }
      var list = index.terms[term] || (index.terms[term] = []);
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === catId) {
          return; // the first (strongest) way it was listed wins - names are added first
        }
      }
      list.push({ id: catId, how: how });
    }
    function words(text) {
      return _norm(text).split(WORD_SPLIT);
    }
    src.list.forEach(function (r) {
      var id = r[0];
      index.byId[id] = { catId: id, category: r[1], sub: r[2] };
      words(r[1]).forEach(function (w) { add(w, id, "enCat"); });
      words(r[2]).forEach(function (w) { add(w, id, "enSub"); });
      [r[4], r[7]].forEach(function (t) { words(t).forEach(function (w) { add(w, id, "xxCat"); }); });
      [r[5], r[8]].forEach(function (t) { words(t).forEach(function (w) { add(w, id, "xxSub"); }); });
      [r[3], r[6], r[9]].forEach(function (list) {
        String(list || "").split(",").forEach(function (syn) {
          var whole = _norm(syn).trim();
          if (whole && !WORD_SPLIT.test(whole)) {
            add(whole, id, "synWhole");
          }
        });
      });
      [r[3], r[6], r[9]].forEach(function (list) {
        String(list || "").split(",").forEach(function (syn) {
          words(syn).forEach(function (w) { add(w, id, "synPart"); });
        });
      });
    });
    index.termList = Object.keys(index.terms);
    index.stems = {};
    index.termList.forEach(function (term) {
      if (/[\u0430-\u044f\u0451]/.test(term)) {
        var st = _ruStem(term);
        (index.stems[st] = index.stems[st] || []).push(term);
      }
    });
    return index;
  }
  // Russian inflects nouns and verbs; comparing stems lets "shagov" (of
  // steps) find "shagi" (steps) and "udary" (hits) find "udar" (a hit),
  // written here in Latin letters. A light suffix strip, not a full stemmer.
  // The Cyrillic endings, as \u escapes: three letters (-yami, -ami, -ogo...),
  // then two (-ov, -ev...), then one.
  var RU_ENDINGS = ["\u044f\u043c\u0438", "\u0430\u043c\u0438", "\u043e\u0433\u043e", "\u0435\u0433\u043e", "\u043e\u043c\u0443", "\u0435\u043c\u0443", "\u044b\u043c\u0438", "\u0438\u043c\u0438", "\u0430\u0442\u044c", "\u044f\u0442\u044c", "\u0438\u0442\u044c", "\u0435\u0442\u044c",
                    "\u043e\u0432", "\u0435\u0432", "\u0435\u0439", "\u043e\u0439", "\u0438\u0439", "\u044b\u0439", "\u0430\u044f", "\u044f\u044f", "\u043e\u0435", "\u0435\u0435", "\u044b\u0435", "\u0438\u0435", "\u044b\u0445", "\u0438\u0445",
                    "\u0430\u043c", "\u044f\u043c", "\u0430\u0445", "\u044f\u0445", "\u043e\u043c", "\u0435\u043c", "\u0443\u044e", "\u044e\u044e",
                    "\u0430", "\u044f", "\u043e", "\u0435", "\u044b", "\u0438", "\u0443", "\u044e", "\u044c"];
  function _ruStem(w) {
    for (var i = 0; i < RU_ENDINGS.length; i++) {
      var e = RU_ENDINGS[i];
      if (w.length - e.length >= 3 && w.slice(-e.length) === e) {
        return w.slice(0, -e.length);
      }
    }
    return w;
  }
  // UCS file name -> { catId, category, sub, fxName, creator, source } or
  // null.
  var UCS_RE = /^([A-Z][A-Z0-9]*[a-z][A-Za-z0-9]*)(?:-[^_]*)?_/;
  function parseUcsName(fileName) {
    var base = String(fileName || "").replace(/\.[^.]+$/, "");
    var m = UCS_RE.exec(base);
    if (!m) {
      return null;
    }
    var entry = _index().byId[m[1]];
    if (!entry) {
      return null;
    }
    var parts = base.split("_");
    return {
      catId: entry.catId, category: entry.category, sub: entry.sub,
      fxName: (parts[1] || "").trim(), creator: (parts[2] || "").trim() || null, source: (parts[3] || "").trim() || null
    };
  }
  // Words for matching at word starts: camelCase split ("FastWhoosh" -> "fast
  // whoosh", "DSGNWhsh" -> "dsgn whsh"), lower-cased, everything else a
  // space, padded with spaces.
  function _words(s) {
    var t = String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    return " " + _norm(t).split(WORD_SPLIT).filter(function (w) { return w; }).join(" ") + " ";
  }
  // Per-file cache: the name's and last folders' words, and the UCS parse.
  var fileCache = {};
  function fileInfo(item) {
    var key = item.path || item.name;
    var hit = fileCache[key];
    if (hit && hit.name === item.name) {
      return hit;
    }
    var dirs = String(item.path || "").split(/[\\/]/).slice(0, -1).slice(-3).join(" ");
    hit = { name: item.name, text: _words(item.name.replace(/\.[^.]+$/, "")) + _words(dirs).slice(1), ucs: parseUcsName(item.name) };
    fileCache[key] = hit;
    return hit;
  }
  // Category ids a word points to: the word itself, a term it starts (Russian
  // and Spanish inflect: "shagov" -> "shag..."), or a term that starts with
  // it (partial typing: "whoo" -> "whoosh").
  var STRONG = { enCat: 1, enSub: 1, xxCat: 1, xxSub: 1 };
  // Remembered per word: the Category box asks for every option on each
  // keystroke.
  var catsMemo = {};
  var catsMemoSize = 0;
  function _catsFor(word) {
    if (catsMemo.hasOwnProperty(word)) {
      return catsMemo[word];
    }
    if (catsMemoSize > 500) {
      catsMemo = {};
      catsMemoSize = 0;
    }
    catsMemoSize++;
    return (catsMemo[word] = _catsForUncached(word));
  }
  function _catsForUncached(word) {
    var idx = _index();
    var strong = {}, syn = {}, how = {};
    // partial: a term the word only begins ("trac" -> "tractor") matches
    // categories but is too loose to expand from.
    function take(term, partial) {
      idx.terms[term].forEach(function (e) {
        if (STRONG[e.how]) {
          strong[e.id] = 1;
        } else {
          syn[e.id] = 1;
        }
        if (!partial && (!how[e.id] || STRONG[e.how])) {
          how[e.id] = e.how;
        }
      });
    }
    if (idx.terms[word]) {
      take(word);
    }
    if (/[\u0430-\u044f\u0451]/.test(word)) {
      (idx.stems[_ruStem(word)] || []).forEach(function (term) {
        if (term !== word) {
          take(term);
        }
      });
    }
    // A longer word ending: Russian case endings (up to 3 letters), or an
    // English / Spanish plural - so "risers" finds "riser" but "riser" does
    // not find "rise" (a high-rise, in URBAN ambience).
    var cyrillic = /[\u0430-\u044f\u0451]/.test(word);
    for (var i = 0; i < idx.termList.length; i++) {
      var term = idx.termList[i];
      if (term === word) {
        continue;
      }
      var partialTyping = word.length >= 3 && term.indexOf(word) === 0;
      var inflected = (term.length >= 3 && word.indexOf(term) === 0 &&
        (cyrillic ? word.length - term.length <= 3 : /^(s|es)$/.test(word.slice(term.length)))) ||
        (!cyrillic && word.length >= 3 && term.indexOf(word) === 0 && /^(s|es)$/.test(term.slice(word.length)));
      if (inflected) {
        take(term, false);
      } else if (partialTyping) {
        take(term, true);
      }
    }
    return { strong: strong, syn: syn, how: how };
  }
  // English words a query word expands to, for file names without a CatID: a
  // whole synonym brings its subcategory's name ("swoosh" -> "whoosh"); a
  // Russian or Spanish name brings the English one (Russian "shagi" ->
  // "footsteps", "svist" -> "whoosh"). English names bring nothing - the word
  // already matches them - and neither does one word of a longer synonym.
  var GENERIC = /^(misc|miscellaneous|other|general|various|designed|and)$/;
  function _expansions(word, cats) {
    var idx = _index();
    var sources = [];
    var ids = Object.keys(cats.how);
    for (var n = 0; n < ids.length; n++) {
      if (cats.how[ids[n]] === "enCat" || cats.how[ids[n]] === "enSub") {
        return []; // an English category name already: files with the word match directly
      }
    }
    Object.keys(cats.how).forEach(function (id) {
      var how = cats.how[id];
      var e = idx.byId[id];
      if (how === "xxCat") {
        sources.push(e.category);
      } else if (how === "xxSub" || how === "synWhole") {
        sources.push(e.sub);
      }
    });
    // Many categories share one name (WHOOSH under FIRE, WATER, DESIGNED...),
    // so the words are counted and the most common kept: Russian "svist"
    // (whoosh, and also whistle) expands to "whoosh" first.
    var counts = {};
    sources.forEach(function (name) {
      _norm(name).split(WORD_SPLIT).forEach(function (w) {
        if (w.length >= 3 && w !== word && !GENERIC.test(w)) {
          counts[w] = (counts[w] || 0) + 1;
        }
      });
    });
    // A few words are kept as they are; among more, only those several
    // categories agree on ("air" is a synonym in dozens of unrelated
    // categories, so it expands to nothing).
    var ranked = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (ranked.length <= 3) {
      return ranked;
    }
    return ranked.filter(function (w) { return counts[w] >= 2; }).slice(0, 3);
  }
  // English sound-effect synonyms ("swish" also finds "whoosh"), hand-made
  // for the terms editors type. Each group: any word finds the others.
  var THESAURUS = [
    ["whoosh", "woosh", "swoosh", "swish", "swoop", "pass by", "passby", "fly by", "flyby"],
    ["impact", "hit", "punch", "thud", "slam", "smash", "bang"],
    ["riser", "uplifter", "build up", "buildup", "swell", "rise"],
    ["downer", "downlifter", "sub drop", "subdrop", "drop"],
    ["boom", "braam", "brahm", "bram"],
    ["explosion", "explode", "blast", "detonation", "bomb"],
    ["gunshot", "gun", "shot", "rifle", "pistol", "firearm"],
    ["footstep", "footsteps", "steps", "walking", "walk"],
    ["glitch", "stutter", "bitcrush", "datamosh", "malfunction"],
    ["click", "tick", "tap", "button"],
    ["beep", "blip", "bleep", "notification", "alert"],
    ["transition", "swipe", "sweep"],
    ["ambience", "ambient", "atmosphere", "atmos", "room tone", "roomtone", "background"],
    ["drone", "pad", "texture", "hum"],
    ["magic", "spell", "sparkle", "shimmer", "twinkle", "fairy"],
    ["scifi", "sci fi", "laser", "zap", "futuristic"],
    ["creak", "squeak", "creaking"],
    ["glass", "shatter", "breaking glass"],
    ["water", "splash", "liquid", "drip", "bubbles"],
    ["fire", "flame", "burn", "crackle"],
    ["wind", "gust", "breeze"],
    ["thunder", "storm", "lightning"],
    ["crowd", "walla", "audience", "applause", "cheer"],
    ["car", "vehicle", "engine", "motor"],
    ["heartbeat", "heart beat", "pulse"],
    ["camera", "shutter", "snapshot"],
    ["tape stop", "tapestop", "rewind", "vinyl", "scratch"],
    ["reverse", "reversed", "backwards"],
    ["stinger", "sting", "logo"],
    ["cinematic", "trailer", "epic"],
    ["ui", "interface", "menu", "hud"],
    ["punch", "fight", "kick"],
    ["cartoon", "comedy", "toon", "boing"],
    ["horror", "scary", "creepy", "spooky"],
    ["alarm", "siren", "alert"]
  ];
  var thesaurusIndex = null;
  function _thesaurus(word) {
    if (!thesaurusIndex) {
      thesaurusIndex = {};
      THESAURUS.forEach(function (group) {
        group.forEach(function (w) {
          var others = thesaurusIndex[w] || (thesaurusIndex[w] = []);
          group.forEach(function (o) { if (o !== w && others.indexOf(o) === -1) { others.push(o); } });
        });
      });
    }
    return thesaurusIndex[word] || thesaurusIndex[word.replace(/(es|s)$/, "")] || thesaurusIndex[word.replace(/s$/, "")] || [];
  }
  // Synonyms on or off. Off: only the typed words, in file and folder names -
  // no thesaurus, no UCS categories.
  var _synonyms = true;
  function setSynonyms(on) { _synonyms = on !== false; }
  function synonymsOn() { return _synonyms; }
  function compile(text) {
    var words = _norm(text).split(/\s+/).filter(function (w) { return w; });
    var q = { active: words.length > 0, include: [], exclude: [] };
    words.forEach(function (raw) {
      var neg = raw.charAt(0) === "-" && raw.length > 1;
      var w = neg ? raw.slice(1) : raw;
      var cats = (_synonyms && w.length >= 2) ? _catsFor(w) : { strong: {}, syn: {} };
      var expand = [];
      if (!neg && _synonyms) {
        var own = _thesaurus(w);
        // A hand-made group is more precise than UCS words ("hit" is a UCS
        // synonym under CLOTH / IMPACT too, but "cloth" is not what is
        // meant).
        var ucs = own.length ? [] : _expansions(w, cats);
        var translated = Object.keys(cats.how || {}).some(function (id) { return cats.how[id] === "xxCat" || cats.how[id] === "xxSub"; });
        if (!own.length && translated) {
          // A Russian or Spanish category name reaches the English thesaurus
          // through its English name: "impacto" -> impact -> hit, punch...
          ucs.forEach(function (x) { own = own.concat(_thesaurus(x)); });
        }
        own.concat(ucs).forEach(function (x) {
          if (x !== w && expand.indexOf(x) === -1) {
            expand.push(x);
          }
        });
      }
      var term = { word: w, cats: cats, expand: expand };
      (neg ? q.exclude : q.include).push(term);
    });
    return q;
  }
  // -1 = no match; otherwise a score (higher = better).
  function score(q, item) {
    var info = fileInfo(item);
    var catId = info.ucs ? info.ucs.catId : null;
    var total = 0;
    for (var e = 0; e < q.exclude.length; e++) {
      var x = q.exclude[e];
      if (info.text.indexOf(" " + x.word) !== -1 || (catId && x.cats.strong[catId])) {
        return -1;
      }
    }
    for (var i = 0; i < q.include.length; i++) {
      var t = q.include[i];
      var s = 0;
      if (info.text.indexOf(" " + t.word) !== -1) {
        s = 4 + (info.text.indexOf(" " + t.word + " ") !== -1 ? 1 : 0); // a whole word ranks above a word start
      } else if (catId && t.cats.strong[catId]) {
        s = 3;
      } else if (catId && t.cats.syn[catId]) {
        s = 2;
      } else {
        for (var k = 0; k < t.expand.length; k++) {
          if (info.text.indexOf(" " + t.expand[k]) !== -1) {
            s = 1;
            break;
          }
        }
      }
      if (s === 0) {
        return -1;
      }
      total += s;
    }
    return total;
  }

  global.BeatMarkerSfxSearch = {
    parseUcsName: parseUcsName,
    compile: compile,
    setSynonyms: setSynonyms,
    synonymsOn: synonymsOn,
    score: score,
    fileInfo: fileInfo
  };
})(typeof window !== "undefined" ? window : globalThis);
