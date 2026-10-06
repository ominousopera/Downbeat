// First-run onboarding tour: a "spotlight" that dims everything except one
// target element per step, with a callout box explaining what it does.
(function (global) {
  "use strict";
  // Each step's target is a CSS selector for the element to spotlight, or
  // null for a centered step with no target (welcome/finish). Selectors point
  // at elements that always exist in the DOM, even if sometimes hidden (e.g.
  // #compatibleKeysRow before any key is detected); resolveVisibleTarget()
  // falls back to the nearest .panel ancestor when the exact target is not
  // visible, so a step never spotlights nothing.
  // `tab`: the tab (js/main.js's window.BeatMarkerTabs) that must be active
  // for the target to be visible; null for targets outside the tab system
  // (the settings gear) and for steps with no target.
  // `hiddenFeature`: the target's whole panel has the `hidden` attribute, so
  // the step is skipped. Otherwise the .panel fallback would resolve to that
  // same zero-size hidden panel and the spotlight would collapse into a tiny
  // box in the top-left corner.
  var STEPS = [
    { target: null, tab: null, titleKey: "tour.welcomeTitle", bodyKey: "tour.welcomeBody" },
    { target: "#analyzeBtn", tab: "analyze", titleKey: "tour.analyzeTitle", bodyKey: "tour.analyzeBody" },
    { target: "#phaseCells", tab: "analyze", titleKey: "tour.phaseTitle", bodyKey: "tour.phaseBody" },
    { target: "#placeMarkersBtn", tab: "analyze", titleKey: "tour.placeTitle", bodyKey: "tour.placeBody" },
    { target: "#cutDownbeatsBtn", tab: "analyze", hiddenFeature: true, titleKey: "tour.cutTitle", bodyKey: "tour.cutBody" },
    { target: "#clearMarkersBtn", tab: "analyze", titleKey: "tour.clearMarkersTitle", bodyKey: "tour.clearMarkersBody" },
    { target: "#detectKeyBtn", tab: "key", titleKey: "tour.keyTitle", bodyKey: "tour.keyBody" },
    { target: "#camelotWheel", tab: "key", titleKey: "tour.wheelTitle", bodyKey: "tour.wheelBody" },
    { target: "#compatibleKeysRow", tab: "key", titleKey: "tour.compatibleTitle", bodyKey: "tour.compatibleBody" },
    { target: "#libSectionSwitch", tab: "library", titleKey: "tour.libraryTitle", bodyKey: "tour.libraryBody" },
    { target: "#settingsGearBtn", tab: null, titleKey: "tour.settingsTitle", bodyKey: "tour.settingsBody" },
    { target: null, tab: null, titleKey: "tour.finishTitle", bodyKey: "tour.finishBody" }
  ];

  var overlay, spotlight, callout, stepIndicator, calloutTitle, calloutBody;
  var skipBtn, backBtn, nextBtn;
  var currentStepIndex = 0;
  var isActive = false;
  var onFinishCallback = null;

  function _els() {
    overlay = overlay || document.getElementById("tourOverlay");
    spotlight = spotlight || document.getElementById("tourSpotlight");
    callout = callout || document.getElementById("tourCallout");
    stepIndicator = stepIndicator || document.getElementById("tourStepIndicator");
    calloutTitle = calloutTitle || document.getElementById("tourCalloutTitle");
    calloutBody = calloutBody || document.getElementById("tourCalloutBody");
    skipBtn = skipBtn || document.getElementById("tourSkipBtn");
    backBtn = backBtn || document.getElementById("tourBackBtn");
    nextBtn = nextBtn || document.getElementById("tourNextBtn");
  }
  // Falls back to the nearest .panel ancestor if the named element is
  // currently hidden or zero-size (e.g. a conditional row not shown yet).
  function resolveVisibleTarget(selector) {
    if (!selector) {
      return null;
    }
    var el = document.querySelector(selector);
    if (!el) {
      return null;
    }
    var rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return el;
    }
    var panel = el.closest(".panel");
    return panel || el;
  }
  // Moves the spotlight over targetEl (or shows a blank, centered one when
  // there is no target) and places the callout below the target, above it
  // when there is no room, clamped to the viewport.
  function positionCallout(targetEl) {
    var viewportW = document.documentElement.clientWidth;
    var viewportH = document.documentElement.clientHeight;
    var margin = 10;

    var rect;
    if (targetEl) {
      rect = targetEl.getBoundingClientRect();
    } else {
      rect = { top: viewportH / 2, bottom: viewportH / 2, left: viewportW / 2, right: viewportW / 2, width: 0, height: 0 };
    }

    var pad = targetEl ? 6 : 0;
    spotlight.classList.toggle("is-blank", !targetEl);
    spotlight.style.top = (rect.top - pad) + "px";
    spotlight.style.left = (rect.left - pad) + "px";
    spotlight.style.width = Math.max(0, rect.width + pad * 2) + "px";
    spotlight.style.height = Math.max(0, rect.height + pad * 2) + "px";

    callout.hidden = false;
    callout.style.visibility = "hidden";
    callout.style.maxWidth = Math.max(160, Math.min(240, viewportW - margin * 2)) + "px";
    callout.style.left = margin + "px";
    callout.style.top = margin + "px";
    var calloutRect = callout.getBoundingClientRect();
    var calloutW = calloutRect.width;
    var calloutH = calloutRect.height;

    var top = rect.bottom + pad + 10;
    if (top + calloutH > viewportH - margin) {
      var above = rect.top - pad - 10 - calloutH;
      top = above >= margin ? above : Math.max(margin, viewportH - margin - calloutH);
    }

    var left = targetEl ? rect.left : (viewportW - calloutW) / 2;
    if (left + calloutW > viewportW - margin) {
      left = viewportW - margin - calloutW;
    }
    if (left < margin) {
      left = margin;
    }
    if (top < margin) {
      top = margin;
    }

    callout.style.left = Math.round(left) + "px";
    callout.style.top = Math.round(top) + "px";
    callout.style.visibility = "visible";
  }

  function renderStep() {
    _els();
    var step = STEPS[currentStepIndex];
    var I18n = global.BeatMarkerI18n;
    stepIndicator.textContent = I18n.t("tour.stepOf", { n: currentStepIndex + 1, total: STEPS.length });
    calloutTitle.textContent = I18n.t(step.titleKey);
    calloutBody.textContent = I18n.t(step.bodyKey);
    backBtn.style.visibility = currentStepIndex === 0 ? "hidden" : "visible";
    nextBtn.textContent = currentStepIndex === STEPS.length - 1 ? I18n.t("tour.done") : I18n.t("tour.next");
    // Switch to this step's tab before measuring: a target inside an inactive
    // tab has zero size.
    if (step.tab && global.BeatMarkerTabs) {
      global.BeatMarkerTabs.switchTab(step.tab);
    }

    var targetEl = resolveVisibleTarget(step.target);
    positionCallout(targetEl);
  }
  // True if this step should be skipped (its target's whole panel is hidden,
  // see hiddenFeature in STEPS above).
  function shouldSkip(index) {
    var step = STEPS[index];
    return !!step.hiddenFeature;
  }

  function start(finishCallback) {
    _els();
    onFinishCallback = finishCallback || null;
    currentStepIndex = 0;
    isActive = true;
    overlay.hidden = false;
    renderStep();
  }

  function finish() {
    isActive = false;
    overlay.hidden = true;
    if (onFinishCallback) {
      onFinishCallback();
    }
  }

  function next() {
    var nextIndex = currentStepIndex + 1;
    while (nextIndex < STEPS.length && shouldSkip(nextIndex)) {
      nextIndex++;
    }
    if (nextIndex >= STEPS.length) {
      finish();
      return;
    }
    currentStepIndex = nextIndex;
    renderStep();
  }

  function back() {
    var prevIndex = currentStepIndex - 1;
    while (prevIndex >= 0 && shouldSkip(prevIndex)) {
      prevIndex--;
    }
    if (prevIndex < 0) {
      return;
    }
    currentStepIndex = prevIndex;
    renderStep();
  }

  function wireButtons() {
    _els();
    nextBtn.addEventListener("click", next);
    backBtn.addEventListener("click", back);
    skipBtn.addEventListener("click", finish);
    window.addEventListener("resize", function () {
      if (isActive) {
        renderStep();
      }
    });
    // Re-measuring on every scroll tick is cheap (a few
    // getBoundingClientRect() calls), so there is no debounce. The spotlight's
    // CSS transition is suppressed (inline style beats the class rule) while
    // scrolling and restored 120 ms after the last scroll event, so
    // step-to-step moves still animate.
    var scrollSettleTimer = null;
    window.addEventListener("scroll", function () {
      if (!isActive) {
        return;
      }
      spotlight.style.transition = "none";
      renderStep();
      clearTimeout(scrollSettleTimer);
      scrollSettleTimer = setTimeout(function () {
        spotlight.style.transition = "";
      }, 120);
    }, { passive: true, capture: true });
  }

  global.BeatMarkerTour = {
    start: start,
    wireButtons: wireButtons,
    isActive: function () { return isActive; }
  };
})(window);
