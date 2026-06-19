(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function isBracket(wrapper) {
    return !!wrapper.querySelector('.bracket-body');
  }

  function drawConnectors(wrapper) {
    if (!isBracket(wrapper)) return; // skip non-bracket .bracket-wrapper elements

    var existing = wrapper.querySelector('svg.bracket-connectors');
    if (existing) existing.remove();

    var wRect = wrapper.getBoundingClientRect();
    if (wRect.width === 0) return; // hidden inside a closed modal — defer until visible

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bracket-connectors');
    svg.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(svg);

    function midpoint(el) {
      var r = el.getBoundingClientRect();
      return { x: r.left - wRect.left, y: r.top + r.height / 2 - wRect.top, w: r.width, h: r.height };
    }

    function addCurve(fromEl, toEl, fromEdge, toEdge) {
      var f = midpoint(fromEl);
      var t = midpoint(toEl);
      if (f.w === 0 || t.w === 0) return; // element not rendered

      var x1 = fromEdge === 'right' ? f.x + f.w : f.x;
      var y1 = f.y;
      var x2 = toEdge === 'right' ? t.x + t.w : t.x;
      var y2 = t.y;
      var cx = (x1 + x2) / 2;

      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2);
      svg.appendChild(path);
    }

    function matchups(roundEl) {
      return Array.prototype.slice.call(roundEl.querySelectorAll('.matchup'));
    }

    ['left-half', 'right-half'].forEach(function (side) {
      var half = wrapper.querySelector('.' + side);
      if (!half) return;

      var isLeft  = side === 'left-half';
      var outEdge = isLeft ? 'right' : 'left';
      var inEdge  = isLeft ? 'left'  : 'right';

      var r1m = matchups(half.querySelector('.round.r1')); // 16
      var r2m = matchups(half.querySelector('.round.r2')); //  8
      var r3m = matchups(half.querySelector('.round.r3')); //  4
      var r4m = matchups(half.querySelector('.round.r4')); //  3 (elite8, finalist, elite8)

      // R1 (pairs of 2) → R2
      for (var i = 0; i < 8; i++) {
        addCurve(r1m[i * 2],     r2m[i], outEdge, inEdge);
        addCurve(r1m[i * 2 + 1], r2m[i], outEdge, inEdge);
      }

      // R2 (pairs of 2) → R3
      for (var j = 0; j < 4; j++) {
        addCurve(r2m[j * 2],     r3m[j], outEdge, inEdge);
        addCurve(r2m[j * 2 + 1], r3m[j], outEdge, inEdge);
      }

      // R3 → R4 elite 8 (r4m[1] is the Final Four finalist slot — skip it)
      addCurve(r3m[0], r4m[0], outEdge, inEdge);
      addCurve(r3m[1], r4m[0], outEdge, inEdge);
      addCurve(r3m[2], r4m[2], outEdge, inEdge);
      addCurve(r3m[3], r4m[2], outEdge, inEdge);
    });
  }

  function redrawAll() {
    document.querySelectorAll('.bracket-wrapper').forEach(function (w) { drawConnectors(w); });
  }

  function init() {
    document.querySelectorAll('.bracket-wrapper').forEach(function (wrapper) {
      drawConnectors(wrapper);
      var ro = new ResizeObserver(function () { drawConnectors(wrapper); });
      ro.observe(wrapper);
    });

    // results.ejs runs adjustR3MatchupMargins inside shown.bs.modal synchronously,
    // which shifts R3/R4 element positions after ResizeObserver has already fired.
    // setTimeout(0) here ensures we redraw AFTER all same-event handlers complete.
    document.addEventListener('shown.bs.modal', function (e) {
      setTimeout(function () {
        var wrappers = e.target.querySelectorAll('.bracket-wrapper');
        wrappers.forEach(function (w) { drawConnectors(w); });
      }, 0);
    });

    // results.ejs debounces adjustR3MatchupMargins at 150ms on resize.
    // Run our redraw at 200ms so we always see the final adjusted positions.
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redrawAll, 200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
