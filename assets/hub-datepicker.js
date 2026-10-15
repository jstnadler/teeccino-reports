/* ────────────────────────────────────────────────────────────────────────────
   hub-datepicker.js — shared date-range picker.  Owner: HubSmith.  No library, no CDN.
   Loaded by assets/hub-theme.js on every page; styled only by --hub-* theme tokens.

   PROGRESSIVE ENHANCEMENT, NOT A REPLACEMENT. The page's own controls stay in the
   DOM and remain the single source of truth for its filter code:
     · DATE MODE  — a pair of native <input type="date"> (start, end). They are
       visually hidden; one field ("Oct 1 – Oct 15, 2026 ▾") opens the modal.
     · MONTH MODE — a pair of <select> whose option values are all YYYY-MM and whose
       ids say from/to or start/end (product-units). The modal shows a month grid.
   On Apply we write BOTH values through the native setter, then dispatch `input`
   and `change` on start and then end (both values are final before either event
   fires, so a page that clamps "from > to" never sees a half-applied range), then
   click the page's own Apply button if the pair has one (cost-performance). That is
   exactly what a person typing into the native controls does, so the page computes
   from identical values → identical numbers.

   The page's own preset buttons keep working: programmatic `.value =` writes are
   observed (per-instance value accessor) and the field label follows.

   Not enhanced (deliberate, left native): a single date input, single month/year
   selects that navigate to another page (MTD / YTD / discounts / fulfillment), and
   anything inside [data-hdp-skip]. Opt in an unusual pair with
   data-hdp-start / data-hdp-end attributes on the two controls.
   ──────────────────────────────────────────────────────────────────────────── */
(function () {
  if (window.HubDatePicker) return;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var inputDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var selectDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  var pairs = [];
  var YOY = /\bYoY\b|year[\s-]over[\s-]year|vs\.?\s*(LY|last year|prior year|same period)/i.test(document.body ? document.body.textContent.slice(0, 400000) : '');

  // ── date helpers (all local, ISO yyyy-mm-dd strings) ──────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +(p[2] || 1)); }
  function addDays(s, n) { var d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function addMonthsYM(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function shiftYear(s, n) {
    var y = +s.slice(0, 4) + n, rest = s.slice(4);
    if (rest === '-02-29') rest = '-02-28';
    return y + rest;
  }
  function lastDayOf(ym) { var d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0); return iso(d); }
  function fmtDay(s) { if (!s) return ''; var d = fromIso(s); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function fmtYM(s) { return s ? MON[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4) : ''; }
  function fmtRange(p, a, b) {
    if (!a && !b) return p.mode === 'month' ? 'Any month' : 'All dates';
    if (p.mode === 'month') return a === b ? fmtYM(a) : fmtYM(a) + ' – ' + fmtYM(b);
    if (a && b && a.slice(0, 4) === b.slice(0, 4)) {
      var da = fromIso(a);
      return (a === b) ? fmtDay(a) : MON[da.getMonth()] + ' ' + da.getDate() + ' – ' + fmtDay(b);
    }
    return (a ? fmtDay(a) : '…') + ' – ' + (b ? fmtDay(b) : '…');
  }
  function clamp(s, lo, hi) { if (lo && s < lo) return lo; if (hi && s > hi) return hi; return s; }

  // ── value plumbing ────────────────────────────────────────────────────────
  function rawGet(el) { return (el.tagName === 'SELECT' ? selectDesc : inputDesc).get.call(el); }
  function rawSet(el, v) { (el.tagName === 'SELECT' ? selectDesc : inputDesc).set.call(el, v); }
  function watch(el, p) {
    if (el.__hdpWatched) return;
    el.__hdpWatched = true;
    try {
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: function () { return rawGet(el); },
        set: function (v) { rawSet(el, v); if (p.field) refresh(p); }
      });
    } catch (e) {}
    el.addEventListener('input', function () { refresh(p); });
    el.addEventListener('change', function () { refresh(p); });
    if (el.tagName === 'SELECT') new MutationObserver(function () { refresh(p); }).observe(el, { childList: true });
  }
  function bounds(p) {
    if (p.mode === 'month') {
      var vals = Array.prototype.map.call(p.a.options, function (o) { return o.value; }).filter(function (v) { return /^\d{4}-\d{2}$/.test(v); }).sort();
      return { min: vals[0] || null, max: vals[vals.length - 1] || null, vals: vals };
    }
    var min = p.a.min || p.b.min || null, max = p.b.max || p.a.max || null;
    return { min: min || null, max: max || null };
  }
  function refresh(p) {
    if (!p.field) return;
    p.label.textContent = fmtRange(p, rawGet(p.a), rawGet(p.b));
  }

  // ── discovery ─────────────────────────────────────────────────────────────
  var START_RE = /(^|[-_])(from|start|begin|since|lo)([-_]|$)|^(from|start|d?from|date-?from|range-?start|dr-?from)/i;
  var END_RE = /(^|[-_])(to|end|until|thru|hi)([-_]|$)|^(to|end|d?to|date-?to|range-?end|dr-?to)/i;
  function key(el) { return (el.id || el.name || el.getAttribute('aria-label') || '').replace(/([a-z])([A-Z])/g, '$1-$2'); }
  function isMonthSelect(s) {
    if (!s.options.length) return false;
    for (var i = 0; i < s.options.length; i++) if (!/^\d{4}-\d{2}$/.test(s.options[i].value)) return false;
    return true;
  }
  function discover() {
    var found = [];
    var used = new Set(pairs.map(function (p) { return p.a; }).concat(pairs.map(function (p) { return p.b; })));
    function skip(el) { return used.has(el) || el.closest('[data-hdp-skip]') || el.closest('.hdp-modal'); }
    // explicit opt-ins
    document.querySelectorAll('[data-hdp-start]').forEach(function (a) {
      var b = document.getElementById(a.getAttribute('data-hdp-start')) || document.querySelector('[data-hdp-end]');
      if (a && b && !skip(a) && !skip(b)) found.push([a, b, a.tagName === 'SELECT' ? 'month' : 'date']);
    });
    var dates = Array.prototype.filter.call(document.querySelectorAll('input[type="date"]'), function (e) { return !skip(e); });
    for (var i = 0; i + 1 < dates.length; i++) {
      var a = dates[i], b = dates[i + 1];
      if (!near(a, b)) continue;
      var ka = key(a), kb = key(b);
      if ((START_RE.test(ka) && END_RE.test(kb)) || (ka && kb && ka !== kb && !END_RE.test(ka))) { found.push([a, b, 'date']); i++; }
    }
    var sels = Array.prototype.filter.call(document.querySelectorAll('select'), function (e) { return !skip(e) && isMonthSelect(e); });
    for (var j = 0; j + 1 < sels.length; j++) {
      var sa = sels[j], sb = sels[j + 1];
      if (near(sa, sb) && START_RE.test(key(sa)) && END_RE.test(key(sb))) { found.push([sa, sb, 'month']); j++; }
    }
    found.forEach(function (f) { enhance(f[0], f[1], f[2]); });
  }
  function near(a, b) {
    var pa = a.parentElement, pb = b.parentElement;
    for (var d = 0; d < 3 && pa; d++, pa = pa.parentElement) if (pa.contains(b)) return true;
    return false;
  }

  // ── enhance a pair ────────────────────────────────────────────────────────
  var uid = 0;
  function hide(el) { if (el && el.classList) el.classList.add('hdp-hidden'); }
  function isConnectorText(n) { return n.nodeType === 3 ? /^\s*(to|–|—|-|&ndash;|through|thru)?\s*$/i.test(n.textContent) : false; }
  function labelish(n) { return n && n.nodeType === 1 && /^(LABEL|SPAN)$/.test(n.tagName) && n.textContent.trim().length <= 12 && !n.querySelector('input,select,button'); }

  function enhance(a, b, mode) {
    var p = { a: a, b: b, mode: mode, id: ++uid };
    pairs.push(p);
    watch(a, p); watch(b, p);
    var field = document.createElement('button');
    field.type = 'button';
    field.className = 'hdp-field';
    field.id = 'hdp-field-' + p.id;
    field.setAttribute('aria-haspopup', 'dialog');
    field.setAttribute('data-hub-theme-keep', '');
    field.innerHTML = '<span class="hdp-ico" aria-hidden="true">📅</span><span class="hdp-label"></span><span class="hdp-caret" aria-hidden="true">▼</span>';
    p.field = field; p.label = field.querySelector('.hdp-label');
    field.addEventListener('click', function () { open(p); });

    if (a.parentElement === b.parentElement) {
      a.parentElement.insertBefore(field, a);
      // hide the connector ("to", "–", a "To" label) strictly between the two controls
      for (var n = a.nextSibling; n && n !== b; n = n.nextSibling) {
        if (n.nodeType === 3 && isConnectorText(n)) { n.__hdpText = n.textContent; n.textContent = ' '; }
        else if (labelish(n)) hide(n);
      }
      var prev = field.previousSibling;
      while (prev && prev.nodeType === 3 && !prev.textContent.trim()) prev = prev.previousSibling;
      if (prev && prev.nodeType === 3 && /^\s*from\s*$/i.test(prev.textContent)) prev.textContent = ' ';
      else if (labelish(prev) && /^(from|start( date)?)$/i.test(prev.textContent.trim())) prev.textContent = 'Dates';
    } else {
      var pa = a.parentElement, pb = b.parentElement;
      pa.insertBefore(field, a);
      var la = pa.querySelector('label'); if (la && /^(from|start( date)?)$/i.test(la.textContent.trim())) { la.textContent = 'Date range'; la.setAttribute('for', field.id); }
      // end control's wrapper holds just a label + the control → hide the wrapper
      var others = Array.prototype.filter.call(pb.children, function (c) { return c !== b && !(c.tagName === 'LABEL'); });
      if (!others.length) hide(pb); else hide(b);
      var lb = pb.querySelector('label'); if (lb && others.length) hide(lb);
    }
    hide(a); hide(b);
    a.tabIndex = -1; b.tabIndex = -1;
    // The pair's own Apply button is clicked by commit(); showing it too is a 2nd, dead control.
    p.applyBtn = findApply(p);
    if (p.applyBtn) hide(p.applyBtn);
    refresh(p);
  }

  function findApply(p) {
    var scope = p.a.parentElement && p.a.parentElement.contains(p.b) ? p.a.parentElement : (p.a.parentElement && p.a.parentElement.parentElement);
    if (!scope) return null;
    var btns = scope.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].id + ' ' + btns[i].textContent).toLowerCase();
      if (!btns[i].classList.contains('hdp-field') && /\b(apply|go|update)\b|-apply\b/.test(t)) return btns[i];
    }
    return null;
  }

  // ── apply (the one place values leave the picker) ─────────────────────────
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function commit(p, s, e) {
    rawSet(p.a, s); rawSet(p.b, e);
    fire(p.a, 'input'); fire(p.a, 'change');
    fire(p.b, 'input'); fire(p.b, 'change');
    var applyBtn = (p.applyBtn && p.applyBtn.isConnected) ? p.applyBtn : findApply(p);
    if (applyBtn) applyBtn.click();
    refresh(p);
    try { window.dispatchEvent(new CustomEvent('hub-daterange-change', { detail: { start: s, end: e, mode: p.mode, startEl: p.a, endEl: p.b } })); } catch (er) {}
  }

  // ── presets ───────────────────────────────────────────────────────────────
  function anchorToday(bd) { var t = iso(new Date()); return bd.max && bd.max < t ? bd.max : t; }
  function presets(p, bd, cur) {
    var list = [];
    if (p.mode === 'month') {
      var tm = (bd.max || iso(new Date()).slice(0, 7)); var nowYM = iso(new Date()).slice(0, 7); if (tm > nowYM) tm = nowYM;
      list.push(['This month (MTD)', tm, tm]);
      list.push(['Last month', addMonthsYM(tm, -1), addMonthsYM(tm, -1)]);
      list.push(['Year to date', tm.slice(0, 4) + '-01', tm]);
      list.push(['Last 3 months', addMonthsYM(tm, -2), tm]);
      list.push(['Last 12 months', addMonthsYM(tm, -11), tm]);
      if (YOY && cur[0] && cur[1]) list.push(['Same period last year', addMonthsYM(cur[0], -12), addMonthsYM(cur[1], -12)]);
      if (bd.min && bd.max) list.push(['All months', bd.min, bd.max]);
      return list.map(function (x) {
        var ok = (!bd.vals || (bd.vals.indexOf(x[1]) >= 0 || x[1] < bd.min) && (bd.vals.indexOf(x[2]) >= 0 || x[2] > bd.max)) && !(bd.max && x[1] > bd.max) && !(bd.min && x[2] < bd.min);
        return [x[0], clamp(x[1], bd.min, bd.max), clamp(x[2], bd.min, bd.max), ok];
      });
    }
    var t = anchorToday(bd), m1 = t.slice(0, 8) + '01';
    var lmEnd = addDays(m1, -1), lmStart = lmEnd.slice(0, 8) + '01';
    list.push(['Month to date', m1, t]);
    list.push(['Last month', lmStart, lmEnd]);
    list.push(['Year to date', t.slice(0, 4) + '-01-01', t]);
    list.push(['Last 30 days', addDays(t, -29), t]);
    list.push(['Last 90 days', addDays(t, -89), t]);
    if (YOY && cur[0] && cur[1]) list.push(['Same period last year', shiftYear(cur[0], -1), shiftYear(cur[1], -1)]);
    if (bd.min && bd.max) list.push(['All dates', bd.min, bd.max]);
    return list.map(function (x) {
      var ok = !(bd.max && x[1] > bd.max) && !(bd.min && x[2] < bd.min);
      return [x[0], clamp(x[1], bd.min, bd.max), clamp(x[2], bd.min, bd.max), ok];
    });
  }

  // ── modal ─────────────────────────────────────────────────────────────────
  var M = null;   // open-modal state
  function open(p) {
    close();
    var bd = bounds(p);
    var s = rawGet(p.a) || null, e = rawGet(p.b) || null;
    var focusOn = e || s || (p.mode === 'month' ? (bd.max || iso(new Date()).slice(0, 7)) : anchorToday(bd));
    M = { p: p, bd: bd, s: s, e: e, picking: false, hover: null, view: null, opener: document.activeElement };
    if (p.mode === 'month') M.view = +String(focusOn).slice(0, 4);
    else { var f = String(focusOn).slice(0, 7); M.view = addMonthsYM(f, -1); if (bd.min && M.view < bd.min.slice(0, 7)) M.view = bd.min.slice(0, 7); }

    var back = document.createElement('div');
    back.className = 'hdp-backdrop'; back.setAttribute('data-hub-theme-keep', '');
    back.innerHTML = '<div class="hdp-modal" role="dialog" aria-modal="true" aria-label="Choose a date range">' +
      '<div class="hdp-presets"></div><div class="hdp-main"><div class="hdp-head"></div><div class="hdp-cals"></div>' +
      '<div class="hdp-foot"><span class="hdp-note"></span><span><button type="button" class="hdp-btn" data-act="cancel">Cancel</button> ' +
      '<button type="button" class="hdp-btn hdp-primary" data-act="apply">Apply</button></span></div></div></div>';
    M.el = back;
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) close(); });
    back.addEventListener('click', onClick);
    back.addEventListener('mouseover', function (ev) {
      var d = ev.target.closest && ev.target.closest('.hdp-day[data-v]');
      if (d && M && M.picking && M.hover !== d.getAttribute('data-v')) { M.hover = d.getAttribute('data-v'); paintSel(); }
    });
    back.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    render();
    var first = back.querySelector('.hdp-start, .hdp-end, .hdp-day[data-v]:not(:disabled)');
    (first || back.querySelector('[data-act="apply"]')).focus();
  }
  function close() {
    if (!M) return;
    var op = M.opener; M.el.remove(); M = null;
    if (op && op.focus) op.focus();
  }
  function onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key === 'Enter' && ev.target.classList.contains('hdp-btn') === false && !ev.target.classList.contains('hdp-day') && !ev.target.closest('.hdp-presets')) { ev.preventDefault(); doApply(); return; }
    if (ev.key === 'Tab') {   // trap focus
      var f = M.el.querySelectorAll('button:not(:disabled)'); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  }
  function onClick(ev) {
    var t = ev.target.closest('button'); if (!t || !M) return;
    var act = t.getAttribute('data-act');
    if (act === 'cancel') return close();
    if (act === 'apply') return doApply();
    if (act === 'prev' || act === 'next') {
      var dir = act === 'prev' ? -1 : 1;
      M.view = M.p.mode === 'month' ? M.view + dir : addMonthsYM(M.view, dir);
      return render();
    }
    if (t.hasAttribute('data-preset')) {
      var pr = M.presets[+t.getAttribute('data-preset')];
      M.s = pr[1]; M.e = pr[2]; M.picking = false; M.hover = null;
      if (M.p.mode === 'month') M.view = +M.e.slice(0, 4); else M.view = addMonthsYM(M.e.slice(0, 7), -1);
      return render();
    }
    var v = t.getAttribute('data-v');
    if (v) {
      if (!M.picking) { M.s = v; M.e = null; M.picking = true; M.hover = v; }
      else { if (v < M.s) { M.e = M.s; M.s = v; } else M.e = v; M.picking = false; M.hover = null; }
      render();
      var again = M.el.querySelector('[data-v="' + v + '"]'); if (again) again.focus();
    }
  }
  function doApply() {
    if (!M || !M.s) return;
    var s = M.s, e = M.e || M.s, p = M.p;
    if (p.mode === 'month') {
      // snap to months the selects actually offer
      if (M.bd.vals && M.bd.vals.length) {
        s = M.bd.vals.filter(function (x) { return x >= s; })[0] || M.bd.vals[M.bd.vals.length - 1];
        var le = M.bd.vals.filter(function (x) { return x <= e; }); e = le[le.length - 1] || M.bd.vals[0];
      }
    }
    close();
    commit(p, s, e);
  }
  function selRange() {
    var s = M.s, e = M.e;
    if (M.picking && M.hover) { e = M.hover; if (e < s) { var t = s; s = e; e = t; } }
    return [s, e || s];
  }
  function paintSel() {
    var r = selRange();
    M.el.querySelectorAll('.hdp-day[data-v]').forEach(function (d) {
      var v = d.getAttribute('data-v');
      d.classList.toggle('hdp-start', !!r[0] && v === r[0]);
      d.classList.toggle('hdp-end', !!r[1] && v === r[1]);
      d.classList.toggle('hdp-in', !!r[0] && v > r[0] && v < r[1]);
      d.setAttribute('aria-pressed', (v >= r[0] && v <= r[1]) ? 'true' : 'false');
    });
    head();
  }
  function head() {
    var p = M.p, r = selRange();
    var txt = M.s ? fmtRange(p, r[0], r[1]) : (p.mode === 'month' ? 'Pick a start month' : 'Pick a start date');
    var hint = M.picking ? (p.mode === 'month' ? 'Now pick an end month' : 'Now pick an end date') : (M.s ? 'Click a date to start over' : '');
    if (p.mode === 'month' && !M.picking && M.s) hint = 'Click a month to start over';
    var hd = M.el.querySelector('.hdp-head');
    var prevOk = p.mode === 'month' ? !(M.bd.min && M.view <= +M.bd.min.slice(0, 4)) : !(M.bd.min && M.view <= M.bd.min.slice(0, 7));
    var lastView = p.mode === 'month' ? M.view : addMonthsYM(M.view, 1);
    var nextOk = p.mode === 'month' ? !(M.bd.max && M.view >= +M.bd.max.slice(0, 4)) : !(M.bd.max && lastView >= M.bd.max.slice(0, 7));
    hd.innerHTML = '<button type="button" class="hdp-navbtn" data-act="prev" aria-label="Previous"' + (prevOk ? '' : ' disabled') + '>‹</button>' +
      '<span><span class="hdp-sel" aria-live="polite">' + txt + '</span><br><span class="hdp-hint">' + hint + '</span></span>' +
      '<button type="button" class="hdp-navbtn" data-act="next" aria-label="Next"' + (nextOk ? '' : ' disabled') + '>›</button>';
    M.el.querySelector('[data-act="apply"]').disabled = !M.s || M.picking;
    var note = M.el.querySelector('.hdp-note');
    note.textContent = M.bd.min || M.bd.max ? ('Data: ' + (p.mode === 'month' ? fmtYM(M.bd.min) + ' – ' + fmtYM(M.bd.max) : fmtDay(M.bd.min) + ' – ' + fmtDay(M.bd.max))) : '';
    var r2 = [M.s, M.e];
    M.el.querySelectorAll('.hdp-presets [data-preset]').forEach(function (b) {
      var pr = M.presets[+b.getAttribute('data-preset')];
      b.setAttribute('aria-pressed', (!M.picking && pr[1] === r2[0] && pr[2] === r2[1]) ? 'true' : 'false');
    });
  }
  function render() {
    var p = M.p, bd = M.bd;
    M.presets = presets(p, bd, [rawGet(p.a), rawGet(p.b)]);
    M.el.querySelector('.hdp-presets').innerHTML = '<div class="hdp-ph">Quick ranges</div>' + M.presets.map(function (x, i) {
      return '<button type="button" data-preset="' + i + '"' + (x[3] ? '' : ' disabled') + '>' + x[0] + '</button>';
    }).join('');
    var cals = M.el.querySelector('.hdp-cals');
    if (p.mode === 'month') {
      var y = M.view, h = '<div class="hdp-cal" style="width:270px"><div class="hdp-mt">' + y + '</div><div class="hdp-grid hdp-months">';
      for (var m = 0; m < 12; m++) {
        var v = y + '-' + pad(m + 1);
        var dis = (bd.min && v < bd.min) || (bd.max && v > bd.max) || (bd.vals && bd.vals.length && bd.vals.indexOf(v) < 0);
        h += '<button type="button" class="hdp-day" data-v="' + v + '"' + (dis ? ' disabled' : '') + ' aria-label="' + MONTH_FULL[m] + ' ' + y + '">' + MON[m] + '</button>';
      }
      cals.innerHTML = h + '</div></div>';
    } else {
      cals.innerHTML = monthGrid(M.view, bd) + monthGrid(addMonthsYM(M.view, 1), bd);
    }
    paintSel();
  }
  function monthGrid(ym, bd) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
    var first = new Date(y, m, 1), startDow = (first.getDay() + 6) % 7;   // Monday-first
    var days = new Date(y, m + 1, 0).getDate(), today = iso(new Date());
    var h = '<div class="hdp-cal"><div class="hdp-mt">' + MONTH_FULL[m] + ' ' + y + '</div><div class="hdp-grid">' +
      ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(function (d) { return '<span class="hdp-dow">' + d + '</span>'; }).join('');
    for (var i = 0; i < startDow; i++) h += '<span class="hdp-day hdp-out"></span>';
    for (var d = 1; d <= days; d++) {
      var v = y + '-' + pad(m + 1) + '-' + pad(d);
      var dis = (bd.min && v < bd.min) || (bd.max && v > bd.max);
      h += '<button type="button" class="hdp-day' + (v === today ? ' hdp-today' : '') + '" data-v="' + v + '"' + (dis ? ' disabled' : '') +
        ' aria-label="' + fmtDay(v) + '">' + d + '</button>';
    }
    return h + '</div></div>';
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function scan() { try { discover(); } catch (e) { if (window.console) console.warn('hub-datepicker', e); } }
  // Re-scan when a page re-renders its controls (message-performance rebuilds them via innerHTML).
  var q = false;
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) for (var j = 0; j < muts[i].addedNodes.length; j++) {
      var n = muts[i].addedNodes[j];
      if (n.nodeType === 1 && (n.matches('input[type="date"],select') || n.querySelector('input[type="date"],select'))) {
        pairs = pairs.filter(function (p) { return p.a.isConnected && p.b.isConnected; });
        if (!q) { q = true; setTimeout(function () { q = false; scan(); }, 30); }
        return;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan();
  window.addEventListener('load', scan);
  setTimeout(scan, 1500);

  window.HubDatePicker = { pairs: function () { return pairs; }, open: function (i) { open(pairs[i || 0]); }, scan: scan };
})();
