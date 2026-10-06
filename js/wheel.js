// Renders the Camelot Wheel as inline SVG: 12 angular positions (30 degrees
// each), each split into an outer "major/B" ring and an inner "minor/A" ring.
// Pure visualization of the data and rules in js/camelot.js. Given one
// highlighted code, compatibility of the other 23 is computed with
// BeatMarkerCamelot.areCompatible(). It does not depend on the track library.
(function (global) {
  "use strict";

  var NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  // One hue per Camelot number, evenly spaced around the color wheel, so the
  // 24 segments can be told apart at a glance.
  function hueForNumber(n) {
    return (n - 1) * 30;
  }
  // Converts a polar position to x/y. 0 degrees is 12 o'clock, increasing
  // clockwise, matching how the numbers are labeled around the rim.
  function polarToCartesian(cx, cy, r, angleDeg) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  // Path for a donut (annulus) sector between two radii and two angles.
  function annularSectorPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
    var p1 = polarToCartesian(cx, cy, rOuter, startAngle);
    var p2 = polarToCartesian(cx, cy, rOuter, endAngle);
    var p3 = polarToCartesian(cx, cy, rInner, endAngle);
    var p4 = polarToCartesian(cx, cy, rInner, startAngle);
    var largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
    return "M " + p1.x + " " + p1.y +
      " A " + rOuter + " " + rOuter + " 0 " + largeArc + " 1 " + p2.x + " " + p2.y +
      " L " + p3.x + " " + p3.y +
      " A " + rInner + " " + rInner + " 0 " + largeArc + " 0 " + p4.x + " " + p4.y +
      " Z";
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var key in attrs) {
      if (attrs.hasOwnProperty(key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
    return el;
  }
  // svgRoot: an existing <svg> element (viewBox already set in HTML).
  // highlightCode: e.g. "8B", or null/undefined to render with nothing
  // highlighted (all segments at rest).
  function renderWheel(svgRoot, highlightCode) {
    while (svgRoot.firstChild) {
      svgRoot.removeChild(svgRoot.firstChild);
    }

    var cx = 100, cy = 100;
    var rOuterEdge = 96, rOuterInner = 62, rInnerEdge = 60, rInnerCore = 28;
    var gapDeg = 1.5;

    for (var i = 0; i < NUMBERS.length; i++) {
      var n = NUMBERS[i];
      var startAngle = i * 30 + gapDeg / 2;
      var endAngle = (i + 1) * 30 - gapDeg / 2;
      var hue = hueForNumber(n);

      var majorCode = n + "B";
      var minorCode = n + "A";
      var majorState = _segmentState(majorCode, highlightCode);
      var minorState = _segmentState(minorCode, highlightCode);

      var majorPath = svgEl("path", {
        d: annularSectorPath(cx, cy, rOuterEdge, rOuterInner, startAngle, endAngle),
        fill: "hsl(" + hue + ", " + majorState.saturation + "%, " + majorState.lightness + "%)",
        opacity: majorState.opacity,
        stroke: majorState.stroke,
        "stroke-width": majorState.strokeWidth
      });
      svgRoot.appendChild(majorPath);

      var minorPath = svgEl("path", {
        d: annularSectorPath(cx, cy, rInnerEdge, rInnerCore, startAngle, endAngle),
        fill: "hsl(" + hue + ", " + minorState.saturation + "%, " + minorState.lightness + "%)",
        opacity: minorState.opacity,
        stroke: minorState.stroke,
        "stroke-width": minorState.strokeWidth
      });
      svgRoot.appendChild(minorPath);

      var midAngle = (startAngle + endAngle) / 2;
      var majorLabelPos = polarToCartesian(cx, cy, (rOuterEdge + rOuterInner) / 2, midAngle);
      var minorLabelPos = polarToCartesian(cx, cy, (rInnerEdge + rInnerCore) / 2, midAngle);

      svgRoot.appendChild(_label(majorLabelPos.x, majorLabelPos.y, majorCode, majorState));
      svgRoot.appendChild(_label(minorLabelPos.x, minorLabelPos.y, minorCode, minorState));
    }

    var center = svgEl("circle", { cx: cx, cy: cy, r: rInnerCore - 4, class: "wheel-center" });
    svgRoot.appendChild(center);

    var centerText = svgEl("text", { x: cx, y: cy, class: "wheel-center-label" });
    centerText.textContent = highlightCode || "—";
    svgRoot.appendChild(centerText);
  }

  function _label(x, y, text, state) {
    var el = svgEl("text", {
      x: x, y: y, class: "wheel-label",
      opacity: state.labelOpacity
    });
    el.textContent = text;
    return el;
  }
  // Visual weight for a given segment's code relative to the highlighted one:
  // itself (brightest + ring), compatible (medium + faint ring), everything
  // else (dim). Pure function of js/camelot.js's own areCompatible() - no
  // separate compatibility table maintained here.
  function _segmentState(code, highlightCode) {
    if (!highlightCode) {
      return { saturation: 55, lightness: 38, opacity: 0.9, stroke: "none", strokeWidth: 0, labelOpacity: 0.85 };
    }
    if (code === highlightCode) {
      return { saturation: 75, lightness: 52, opacity: 1, stroke: "#fff3e0", strokeWidth: 2, labelOpacity: 1 };
    }
    if (global.BeatMarkerCamelot.areCompatible(code, highlightCode)) {
      return { saturation: 65, lightness: 45, opacity: 0.95, stroke: "#fff3e0", strokeWidth: 1, labelOpacity: 0.95 };
    }
    return { saturation: 20, lightness: 22, opacity: 0.5, stroke: "none", strokeWidth: 0, labelOpacity: 0.35 };
  }

  global.BeatMarkerWheel = {
    renderWheel: renderWheel
  };
})(window);
