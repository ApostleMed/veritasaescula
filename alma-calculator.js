/* ALMA scholarship calculator.
   Logic follows "ALMA Scholarship Calculation Specification" (27 Nov 2026).
   The Google Sheet "ALMA – Scholarship and Fee Calculator" is the source of truth:
   if the sheet changes, update ALMA_SCHOLARSHIP_CONFIG to match. */
(function (root) {
  'use strict';

  var CONFIG = {
    weights: { results: 0.5, diagnostic: 0.5 },
    minDiagnostic: 50,
    oLevel: {
      subjectsEntered: 7, subjectsCounted: 6,
      points: { 'A*': 3, 'A': 2, 'B': 1 },
      maxPoints: 18, directEntryAStars: 7, minGradesBOrBetter: 5
    },
    ged: {
      subjects: ['Mathematical Reasoning', 'Reasoning Through Language Arts', 'Science', 'Social Studies'],
      minSubjectScore: 100, maxSubjectScore: 200,
      directEntryPerSubject: 195, floorPerSubject: 155,
      topTotal: 780, floorTotal: 620
    },
    bands: [
      { minComposite: 95, scholarship: 1.0 },
      { minComposite: 90, scholarship: 0.9 },
      { minComposite: 85, scholarship: 0.8 },
      { minComposite: 80, scholarship: 0.7 },
      { minComposite: 75, scholarship: 0.6 },
      { minComposite: 70, scholarship: 0.5 },
      { minComposite: 65, scholarship: 0.4 },
      { minComposite: 60, scholarship: 0.3 },
      { minComposite: 55, scholarship: 0.2 },
      { minComposite: 50, scholarship: 0.1 },
      { minComposite: 0, scholarship: 0.0 }
    ],
    // Fees stay hidden (VAI policy: no ALMA fees on the website).
    fees: { SHOW_FEES: false }
  };

  var NUM_TO_LETTER = { '9': 'A*', '8': 'A*', '7': 'A', '6': 'B', '5': 'C', '4': 'C', '3': 'D', '2': 'E', '1': 'G', 'U': 'U' };
  var LETTERS = ['A*', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'U'];

  function toLetter(grade) {
    var g = String(grade == null ? '' : grade).trim().toUpperCase();
    if (g === '') return null;
    if (NUM_TO_LETTER[g]) return NUM_TO_LETTER[g];
    if (LETTERS.indexOf(g) !== -1) return g;
    return 'INVALID';
  }
  function toPoints(letter) { return (letter && CONFIG.oLevel.points[letter]) || 0; }

  function bandFor(composite) {
    var bands = CONFIG.bands.slice().sort(function (a, b) { return b.minComposite - a.minComposite; });
    for (var i = 0; i < bands.length; i++) {
      if (composite >= bands[i].minComposite) {
        var lo = bands[i].minComposite, hi = i > 0 ? bands[i - 1].minComposite : null;
        var label = hi === null ? 'Composite ' + lo + ' or more'
          : lo === 0 ? 'Composite under ' + hi
          : 'Composite ' + lo + ' to under ' + hi;
        return { scholarship: bands[i].scholarship, band: label };
      }
    }
    return { scholarship: 0, band: 'Composite under 50' };
  }

  function calculateScholarship(input) {
    var dxRaw = Number(input.diagnostic);
    var dx = Math.max(0, Math.min(100, isFinite(dxRaw) ? dxRaw : 0));
    var resultsScore = 0, direct = false, meetsMinimum = false, minText = '', detail = {};
    var ol = CONFIG.oLevel, ged = CONFIG.ged;

    if (input.qualification === 'OLEVEL') {
      // Students may have taken 5, 6 or 7 subjects. The best 6 count (all of them if fewer),
      // scored out of 3 points per counted subject, so 5 or 6 subjects are not penalised.
      var taken = Math.max(ol.minGradesBOrBetter, Math.min(ol.subjectsEntered, Number(input.subjectsTaken) || ol.subjectsEntered));
      var pts = (input.oLevelGrades || []).slice(0, taken).map(function (g) { return toPoints(toLetter(g)); });
      var counted = Math.min(taken, ol.subjectsCounted);
      var maxPts = counted * 3;
      var aStars = pts.filter(function (p) { return p === 3; }).length;
      var bOrBetter = pts.filter(function (p) { return p >= 1; }).length;
      var best6 = pts.slice().sort(function (a, b) { return b - a; }).slice(0, counted)
        .reduce(function (s, p) { return s + p; }, 0);
      resultsScore = best6 / maxPts * 100;
      direct = aStars >= ol.directEntryAStars;
      meetsMinimum = bOrBetter >= ol.minGradesBOrBetter;
      minText = 'at least ' + ol.minGradesBOrBetter + ' grades at B or better (you have ' + bOrBetter + ')';
      detail = { aStars: aStars, bOrBetter: bOrBetter, best6: best6, counted: counted, maxPts: maxPts, taken: taken };
    } else {
      var s = (input.gedScores || []).map(Number);
      var total = s.reduce(function (a, b) { return a + (b || 0); }, 0);
      resultsScore = Math.max(0, Math.min(100, (total - ged.floorTotal) / (ged.topTotal - ged.floorTotal) * 100));
      direct = s.length === 4 && s.every(function (x) { return x >= ged.directEntryPerSubject; });
      meetsMinimum = total >= ged.floorTotal;
      minText = 'a GED total of ' + ged.floorTotal + ' or more (you have ' + total + ')';
      detail = { total: total, at195: s.filter(function (x) { return x >= ged.directEntryPerSubject; }).length };
    }

    var base = { resultsScore: resultsScore, diagnostic: dx, detail: detail, direct: direct, meetsMinimum: meetsMinimum, dxOk: dx >= CONFIG.minDiagnostic };

    if (direct) return Object.assign(base, {
      scholarship: 1, band: 'Direct entry', composite: null, rule: 1,
      reason: input.qualification === 'OLEVEL'
        ? 'Direct entry: 7 A* grades, so 100% whatever the diagnostic score.'
        : 'Direct entry: 195 or more in all 4 GED subjects, so 100% whatever the diagnostic score.'
    });

    if (!meetsMinimum || dx < CONFIG.minDiagnostic) return Object.assign(base, {
      scholarship: 0, band: 'Below the minimum', composite: null, rule: 2,
      reason: 'Below the minimum: needs ' + [
        meetsMinimum ? null : minText,
        dx >= CONFIG.minDiagnostic ? null : 'a diagnostic score of ' + CONFIG.minDiagnostic + ' or more'
      ].filter(Boolean).join(' and ') + '.'
    });

    var composite = Math.round((CONFIG.weights.results * resultsScore + CONFIG.weights.diagnostic * dx) * 100) / 100;
    var b = bandFor(composite);
    return Object.assign(base, {
      scholarship: b.scholarship, band: b.band, composite: composite, rule: 3,
      reason: 'Composite score ' + composite.toFixed(1) + ' gives a ' + Math.round(b.scholarship * 100) + '% scholarship.'
    });
  }

  var api = { CONFIG: CONFIG, toLetter: toLetter, toPoints: toPoints, calculateScholarship: calculateScholarship };
  root.ALMA_SCHOLARSHIP = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  /* ---------- UI ---------- */
  if (typeof document === 'undefined') return;

  var GRADES = {
    CIE: ['A*', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'U'],
    EDX: ['9', '8', '7', '6', '5', '4', '3', '2', '1', 'U']
  };
  var EDX_HINT = { '9': 'A*', '8': 'A*', '7': 'A', '6': 'B', '5': 'C', '4': 'C', '3': 'D', '2': 'E', '1': 'G', 'U': 'U' };

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ''); }

  function init() {
    var box = document.getElementById('almaCalc');
    if (!box) return;
    var rowsWrap = box.querySelector('#calcGrades');
    var gedWrap = box.querySelector('#calcGed');
    var dxRange = box.querySelector('#calcDxRange');
    var dxNum = box.querySelector('#calcDx');
    var out = box.querySelector('#calcResult');

    // O Level rows
    for (var i = 0; i < CONFIG.oLevel.subjectsEntered; i++) {
      var row = el('div', { 'class': 'calc-row' });
      row.innerHTML =
        '<span class="calc-row-n">' + (i + 1) + '</span>' +
        '<label class="sr-only" for="calcBoard' + i + '">Subject ' + (i + 1) + ' exam board</label>' +
        '<select id="calcBoard' + i + '" class="calc-board">' +
          '<option value="CIE">Cambridge</option><option value="EDX">Edexcel</option></select>' +
        '<label class="sr-only" for="calcGrade' + i + '">Subject ' + (i + 1) + ' grade</label>' +
        '<select id="calcGrade' + i + '" class="calc-grade"></select>';
      rowsWrap.appendChild(row);
      fillGrades(row);
    }
    function fillGrades(row) {
      var board = row.querySelector('.calc-board').value;
      var sel = row.querySelector('.calc-grade');
      var prev = sel.value;
      sel.innerHTML = '<option value="">Grade</option>' + GRADES[board].map(function (g) {
        var label = board === 'EDX' && EDX_HINT[g] !== g ? g + '  (= ' + EDX_HINT[g] + ')' : g;
        return '<option value="' + g + '">' + label + '</option>';
      }).join('');
      if (GRADES[board].indexOf(prev) !== -1) sel.value = prev;
    }
    rowsWrap.addEventListener('change', function (e) {
      if (e.target.classList.contains('calc-board')) fillGrades(e.target.closest('.calc-row'));
      update();
    });

    // How many subjects the student took (5, 6 or 7)
    var taken = CONFIG.oLevel.subjectsEntered;
    function showRows() {
      rowsWrap.querySelectorAll('.calc-row').forEach(function (r, k) {
        r.hidden = k >= taken;
        if (k >= taken) r.querySelector('.calc-grade').value = '';
      });
      box.querySelector('#calcCountLabel').textContent = taken;
    }
    box.querySelectorAll('[data-count]').forEach(function (b) {
      b.addEventListener('click', function () {
        taken = Number(b.getAttribute('data-count'));
        box.querySelectorAll('[data-count]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        showRows(); update();
      });
    });

    // Board for all rows
    box.querySelectorAll('[data-board-all]').forEach(function (b) {
      b.addEventListener('click', function () {
        rowsWrap.querySelectorAll('.calc-row').forEach(function (r) {
          r.querySelector('.calc-board').value = b.getAttribute('data-board-all');
          fillGrades(r);
        });
        update();
      });
    });

    // GED inputs
    CONFIG.ged.subjects.forEach(function (name, j) {
      var f = el('div', { 'class': 'calc-ged-field' });
      f.innerHTML = '<label for="calcGed' + j + '">' + name + '</label>' +
        '<input id="calcGed' + j + '" type="number" inputmode="numeric" min="100" max="200" step="1" placeholder="100–200">' +
        '<span class="calc-err" hidden>Enter a score from 100 to 200</span>';
      gedWrap.appendChild(f);
    });
    gedWrap.addEventListener('input', update);

    // Qualification toggle
    var qual = 'OLEVEL';
    box.querySelectorAll('[data-qual]').forEach(function (b) {
      b.addEventListener('click', function () {
        qual = b.getAttribute('data-qual');
        box.querySelectorAll('[data-qual]').forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === b));
        });
        box.querySelector('#calcOlevel').hidden = qual !== 'OLEVEL';
        box.querySelector('#calcGedPanel').hidden = qual !== 'GED';
        update();
      });
    });

    // Diagnostic: slider and number stay in sync
    function setDx(v, from) {
      if (from !== dxRange) dxRange.value = v === '' ? 0 : v;
      if (from !== dxNum) dxNum.value = v;
      dxRange.style.setProperty('--fill', (Number(dxRange.value) || 0) + '%');
    }
    dxRange.addEventListener('input', function () { setDx(dxRange.value, dxRange); update(); });
    dxNum.addEventListener('input', function () {
      var v = dxNum.value;
      if (v !== '') v = Math.max(0, Math.min(100, Math.round(Number(v))));
      setDx(v, dxNum); update();
    });
    dxNum.addEventListener('blur', function () { if (dxNum.value !== '') dxNum.value = Math.max(0, Math.min(100, Math.round(Number(dxNum.value)))); });
    setDx(dxRange.value);

    box.querySelector('#calcReset').addEventListener('click', function () {
      rowsWrap.querySelectorAll('.calc-grade').forEach(function (s) { s.value = ''; });
      gedWrap.querySelectorAll('input').forEach(function (n) { n.value = ''; });
      setDx(70); update();
    });

    function update() {
      var entered = false, gedBad = false, input = { qualification: qual, diagnostic: dxNum.value === '' ? 0 : Number(dxNum.value) };
      if (qual === 'OLEVEL') {
        input.subjectsTaken = taken;
        input.oLevelGrades = Array.prototype.map.call(rowsWrap.querySelectorAll('.calc-grade'), function (s) { return s.value; });
        entered = input.oLevelGrades.some(function (g) { return g !== ''; });
      } else {
        input.gedScores = [];
        gedWrap.querySelectorAll('.calc-ged-field').forEach(function (f) {
          var n = f.querySelector('input'), err = f.querySelector('.calc-err');
          var raw = n.value.trim(), v = Number(raw);
          var bad = raw !== '' && (!isFinite(v) || v < CONFIG.ged.minSubjectScore || v > CONFIG.ged.maxSubjectScore || Math.round(v) !== v);
          err.hidden = !bad; f.classList.toggle('has-error', bad);
          if (bad) gedBad = true;
          if (raw !== '') entered = true;
          input.gedScores.push(raw === '' || bad ? 0 : v);
        });
      }
      render(entered, gedBad, input);
    }

    function render(entered, gedBad, input) {
      if (!entered) {
        out.className = 'calc-result is-empty';
        out.innerHTML = '<p class="calc-eyebrow">Your estimate</p><div class="calc-pct">–</div>' +
          '<p class="calc-reason">Enter your ' + (qual === 'OLEVEL' ? 'O Level / IGCSE grades' : 'GED scores') + ' and a diagnostic score to see your estimate.</p>';
        return;
      }
      if (gedBad) {
        out.className = 'calc-result is-empty';
        out.innerHTML = '<p class="calc-eyebrow">Your estimate</p><div class="calc-pct">–</div>' +
          '<p class="calc-reason">Each GED score must be a whole number from 100 to 200.</p>';
        return;
      }
      var r = calculateScholarship(input);
      var pct = Math.round(r.scholarship * 100);
      var pathway = qual === 'OLEVEL' ? 'O Level pathway' : 'GED pathway';
      var resDetail = qual === 'OLEVEL'
        ? (r.detail.taken > r.detail.counted ? 'Best ' + r.detail.counted + ' subjects: ' : 'All ' + r.detail.counted + ' subjects: ') + r.detail.best6 + ' of ' + r.detail.maxPts + ' points'
        : 'GED total: ' + r.detail.total + ' of 800';
      var check = function (ok, text) { return '<li class="' + (ok ? 'ok' : 'no') + '"><span aria-hidden="true">' + (ok ? '✓' : '✕') + '</span>' + text + '</li>'; };
      var rules = qual === 'OLEVEL'
        ? check(r.direct, 'Direct entry: 7 A* (' + r.detail.aStars + ' of 7)') +
          check(r.meetsMinimum, 'At least 5 grades at B or better (' + r.detail.bOrBetter + ')')
        : check(r.direct, 'Direct entry: 195+ in all 4 subjects (' + r.detail.at195 + ' of 4)') +
          check(r.meetsMinimum, 'GED total of 620 or more (' + r.detail.total + ')');
      rules += r.direct ? '' : check(r.dxOk, 'Diagnostic score of 50 or more (' + fmt1(r.diagnostic) + ')');

      var bar = function (label, val, sub) {
        return '<div class="calc-bar"><div class="calc-bar-top"><span>' + label + '</span><b>' + (val == null ? '–' : fmt1(val)) + '</b></div>' +
          '<div class="calc-bar-track"><i style="width:' + (val == null ? 0 : Math.max(0, Math.min(100, val))) + '%"></i></div>' +
          (sub ? '<small>' + sub + '</small>' : '') + '</div>';
      };

      out.className = 'calc-result tone-' + (pct >= 100 ? 'full' : pct > 0 ? 'part' : 'none');
      out.innerHTML =
        '<p class="calc-eyebrow">Your estimate · ' + pathway + '</p>' +
        '<div class="calc-pct"><span>' + pct + '%</span><small>scholarship</small></div>' +
        '<p class="calc-band">' + r.band + '</p>' +
        '<p class="calc-reason">' + r.reason + '</p>' +
        bar('Results score', r.resultsScore, resDetail) +
        bar('Diagnostic score', r.direct ? null : r.diagnostic, r.direct ? 'Not needed for direct entry' : '') +
        bar('Composite (50% results, 50% diagnostic)', r.composite, r.composite == null ? (r.rule === 1 ? 'Rule 1 applies' : 'Rule 2 applies') : '') +
        '<ul class="calc-rules">' + rules + '</ul>';
    }

    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
