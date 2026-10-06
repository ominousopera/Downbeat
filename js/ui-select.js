// Drawn dropdowns that replace the look of native <select> elements.
// The native <select> stays in the DOM, hidden, and remains the source of
// truth: code reads and sets `.value`, rebuilds its options and listens for
// "change" on it. The drawn part follows it: option clicks set the select and
// fire "change"; programmatic value changes and rebuilt option lists refresh
// the label.
(function (global) {
  "use strict";

  var openInstance = null;

  function closeOpen() {
    if (openInstance) {
      openInstance.close();
    }
  }

  function enhance(select) {
    if (!select || select._dbSelect || !select.parentNode || typeof select.parentNode.insertBefore !== "function") {
      return null;
    }
    var wrap = document.createElement("div");
    wrap.className = "db-select" + (select.className ? " " + select.className : "");
    var button = document.createElement("button");
    button.type = "button";
    button.className = "db-select-btn";
    var label = document.createElement("span");
    label.className = "db-select-label";
    var arrow = document.createElement("span");
    arrow.className = "db-select-arrow";
    arrow.textContent = "▾";
    button.appendChild(label);
    button.appendChild(arrow);
    var list = document.createElement("div");
    list.className = "db-select-list";
    list.hidden = true;
    var searchable = select.hasAttribute && select.hasAttribute("data-searchable");
    if (searchable) {
      list.className += " is-searchable";
    }
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(button);
    wrap.appendChild(list);
    wrap.appendChild(select);
    select.classList.add("db-select-native");

    function refresh() {
      var option = select.options[select.selectedIndex];
      label.textContent = option ? option.textContent : "";
      button.disabled = !!select.disabled;
    }

    function choose(index) {
      var changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      inst.close();
      refresh();
      if (changed) {
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    // A long list (the Library's folders, categories, packs; marked
    // data-searchable) gets a search box: the options narrow to those matching
    // every typed word at a word start, or to whatever
    // select._dbFilter(query, value, label) accepts (the Category list also
    // matches UCS synonyms). The first option ("All ...") always stays. Enter
    // picks the first match.
    var searchBox = null;
    var items = [];
    function labelMatches(query, text) {
      var words = " " + String(text).toLowerCase().split(/[^0-9a-z\u00e0-\u00ff\u0430-\u044f\u0451]+/).join(" ") + " ";
      return String(query).toLowerCase().split(/\s+/).every(function (w) { return !w || words.indexOf(" " + w) !== -1; });
    }
    function applyFilter() {
      var query = searchBox ? searchBox.value : "";
      for (var k = 0; k < items.length; k++) {
        var opt = select.options[k];
        var show = k === 0 || !query.trim() ||
          (typeof select._dbFilter === "function" ? select._dbFilter(query, opt.value, opt.textContent) : labelMatches(query, opt.textContent));
        items[k].hidden = !show;
      }
    }

    function renderList() {
      list.textContent = "";
      items = [];
      if (searchable) {
        searchBox = document.createElement("input");
        searchBox.type = "text";
        searchBox.className = "db-select-search";
        searchBox.placeholder = select.getAttribute("data-search-placeholder") || "";
        searchBox.addEventListener("input", applyFilter);
        searchBox.addEventListener("keydown", function (evt) {
          if (evt.key === "Enter") {
            evt.preventDefault();
            for (var k = 1; k < items.length; k++) {
              if (!items[k].hidden) {
                choose(k);
                return;
              }
            }
          }
        });
        // In a solid full-width header, so rows scrolling under it do not
        // show around the box.
        var searchHead = document.createElement("div");
        searchHead.className = "db-select-search-head";
        searchHead.appendChild(searchBox);
        list.appendChild(searchHead);
      }
      for (var i = 0; i < select.options.length; i++) {
        var item = document.createElement("div");
        item.className = "db-select-item" + (i === select.selectedIndex ? " is-selected" : "");
        item.textContent = select.options[i].textContent;
        item.setAttribute("data-index", String(i));
        item.addEventListener("mousedown", function (evt) {
          evt.preventDefault(); // keep focus where it is
        });
        // Chosen on click, not on press: closing the list on press would let
        // the release land on whatever is underneath it (a library row's
        // Insert button, say) and click that instead.
        item.addEventListener("click", function (evt) {
          evt.stopPropagation();
          choose(parseInt(this.getAttribute("data-index"), 10));
        });
        list.appendChild(item);
        items.push(item);
      }
    }

    var inst = {
      open: function () {
        closeOpen();
        renderList();
        list.hidden = false;
        wrap.classList.add("is-open");
        openInstance = inst;
        var current = list.querySelector(".is-selected");
        if (current && current.scrollIntoView) {
          current.scrollIntoView({ block: "nearest" });
        }
        if (searchBox) {
          searchBox.focus();
        }
      },
      close: function () {
        list.hidden = true;
        wrap.classList.remove("is-open");
        // A hidden search box must not keep the keyboard: the Library's
        // arrows and Space ignore keys typed into a text box.
        if (searchBox && document.activeElement === searchBox) {
          searchBox.blur();
        }
        if (openInstance === inst) {
          openInstance = null;
        }
      },
      refresh: refresh
    };

    button.addEventListener("click", function () {
      if (list.hidden) {
        inst.open();
      } else {
        inst.close();
      }
    });
    select.addEventListener("change", refresh);
    // Values set from code (Match the current clip, Reset, restored settings)
    // refresh the label through the element's own setters.
    var proto = global.HTMLSelectElement && global.HTMLSelectElement.prototype;
    ["value", "selectedIndex"].forEach(function (prop) {
      var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (d && d.get && d.set) {
        Object.defineProperty(select, prop, {
          configurable: true,
          get: function () { return d.get.call(select); },
          set: function (v) { d.set.call(select, v); refresh(); }
        });
      }
    });
    // Option lists rebuilt from code (the key list, language changes).
    if (global.MutationObserver) {
      new global.MutationObserver(refresh).observe(select, { childList: true, subtree: true, characterData: true });
    }
    refresh();
    select._dbSelect = inst;
    return inst;
  }

  function enhanceAll(root) {
    var selects = (root || document).querySelectorAll("select");
    for (var i = 0; i < selects.length; i++) {
      enhance(selects[i]);
    }
  }

  document.addEventListener("mousedown", function (evt) {
    var t = evt.target;
    if (openInstance && !(t && t.closest && t.closest(".db-select.is-open"))) {
      closeOpen();
    }
  }, true);
  document.addEventListener("keydown", function (evt) {
    if (evt.key === "Escape") {
      closeOpen();
    }
  });

  global.BeatMarkerSelect = { enhance: enhance, enhanceAll: enhanceAll, closeOpen: closeOpen };
})(window);
