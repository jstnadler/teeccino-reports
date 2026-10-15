/*
  Burke's portal — Light/Dark theme switch.  Owner: HubSmith (clawd-hubsmith). Portal-scoped.

  Loaded ONLY by burke/_nav.html (via a one-line <img onerror> loader, because <script> tags
  inserted with innerHTML do not execute). Every burke/*.html page fetches that nav, so this file
  reaches every portal page without any edit to a generated page — it survives the daily rebuild.

  ISOLATION (AGENT_STANDARDS §18): this file reads/writes ONE localStorage key and toggles ONE
  attribute on <html>. It fetches nothing, reads no manifest, and loads nothing outside burke/.

  Contract:
    · localStorage['burke-portal-theme'] = 'light' | 'dark'   (absent = dark, the default)
    · <html data-portal-theme="light|dark">  — all light rules are gated on this attribute.
      NOT `data-theme`: amazon-ads.html already sets <html data-theme="burke">.
    · Fires `burke-theme-change` on window ({detail:{theme}}) so a page generator can opt in
      to re-rendering its charts from CSS variables. Nothing depends on that today.
*/
(function () {
  var KEY = 'burke-portal-theme';
  var root = document.documentElement;

  function read() {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }

  function paint(theme) {
    root.setAttribute('data-portal-theme', theme);
    var btns = document.querySelectorAll('#portal-nav-bar [data-theme-set]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-theme-set') === theme ? 'true' : 'false');
    }
  }

  function set(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    paint(theme);
    try { window.dispatchEvent(new CustomEvent('burke-theme-change', { detail: { theme: theme } })); } catch (e) {}
  }

  if (!window.__burkeThemeWired) {
    window.__burkeThemeWired = true;
    document.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('#portal-nav-bar [data-theme-set]') : null;
      if (b) { ev.preventDefault(); set(b.getAttribute('data-theme-set')); }
    });
    // Another tab changed it — follow along.
    window.addEventListener('storage', function (ev) { if (ev.key === KEY) paint(read()); });
  }

  paint(read());
})();

/*
  PORTAL BAR OFFSET + STICKY TABLE HEADERS (2026-10-15, Justin: "on the table, when you scroll
  down I want the headers to stay sticky on top").

  1. OFFSET. The portal bar is position:fixed and wraps to 2 rows at desktop widths (~88-92px),
     but _nav.html used a constant 72px body padding, so page titles sat ~18px under it. We now
     measure the bar (ResizeObserver) and publish:
       --portal-nav-h    the bar's real height
       --portal-nav-pad  body top padding = bar + 16px gap  (read by _nav.html, fallback 72/96px)
     on <html>, plus scroll-padding-top so in-page jumps land below the bar.

  2. STICKY HEADERS. CSS `position:sticky` cannot do this job here: almost every table sits in an
     overflow-x:auto wrapper (amazon .scrollx, amazon-funnel .tbl-scroll, amazon-ads .card), and
     sticky inside an overflow container pins to the WRAPPER, not the viewport — it silently does
     nothing. Dropping the wrappers would break sideways scrolling of wide tables. So instead we
     translateY the header cells by exactly how far the header has gone under the bar:
       shift = barBottom − headerTop, clamped to [0, visibleTableBottom − headerBottom]
     The cells stay inside their own table (so the wrapper still scrolls sideways and nothing
     overflows the layout), and the shift returns to 0 when the table scrolls out — that's the
     release. Pages that already pin headers inside their own vertical scroller (asin-daily,
     movers: th{position:sticky;top:0} in a max-height box) compose with this: the rect we read
     already includes their sticky offset, and their sticky-top body rows (asin-daily's TOTAL
     row) ride along so the header never covers them.
     Opaque: a pinned header gets the composited background of the surface it sits on, re-read
     on theme switch, so rows never show through in Dark or Light.
     Runtime only — no generated page is edited, so it survives the 07:00 rebuild.
     Skips: tables inside a position:fixed overlay (modals), hidden tables, nested tables.
*/
(function () {
  if (window.__burkeStickyWired) return;
  window.__burkeStickyWired = true;

  var GAP = 16;
  var root = document.documentElement;
  var cache = new WeakMap();
  var tables = [];
  var queued = false;

  function nav() { return document.getElementById('portal-nav-bar'); }

  // ---- 1. offset ----
  function publishNavHeight() {
    var n = nav(); if (!n) return;
    var h = n.getBoundingClientRect().height;
    if (!h) return;
    root.style.setProperty('--portal-nav-h', h + 'px');
    root.style.setProperty('--portal-nav-pad', Math.ceil(h + GAP) + 'px');
    root.style.scrollPaddingTop = Math.ceil(h + GAP) + 'px';
  }

  // ---- 2. sticky headers ----
  function parseColor(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  // Composite every background from `el` up to the first opaque one: what the eye sees behind it.
  function surfaceBehind(el) {
    var layers = [];
    for (var a = el; a && a.nodeType === 1; a = a.parentElement) {
      var c = parseColor(getComputedStyle(a).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    var base = (layers.length && layers[layers.length - 1].a >= 1) ? layers.pop()
      : (root.getAttribute('data-portal-theme') === 'light' ? { r: 255, g: 255, b: 255, a: 1 } : { r: 15, g: 26, b: 20, a: 1 });
    var r = base.r, g = base.g, b = base.b;
    for (var i = layers.length - 1; i >= 0; i--) {
      var L = layers[i];
      r = L.r * L.a + r * (1 - L.a); g = L.g * L.a + g * (1 - L.a); b = L.b * L.a + b * (1 - L.a);
    }
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  function info(t) {
    var s = cache.get(t);
    if (s) return s;
    s = { skip: false, cells: [], rows: [], clips: [], shift: 0, on: false };
    cache.set(t, s);
    if (t.parentElement && t.parentElement.closest('table')) { s.skip = true; return s; }
    var hdrRows = [];
    if (t.tHead && t.tHead.rows.length) {
      for (var i = 0; i < t.tHead.rows.length; i++) hdrRows.push(t.tHead.rows[i]);
    } else if (t.rows.length && t.rows[0].querySelector('th') && !t.rows[0].querySelector('td')) {
      hdrRows.push(t.rows[0]);
    }
    if (!hdrRows.length) { s.skip = true; return s; }
    // Body rows the page already pins under its own header (e.g. asin-daily's TOTAL row).
    var tb = t.tBodies[0];
    if (tb) {
      for (var k = 0; k < Math.min(tb.rows.length, 3); k++) {
        var c0 = tb.rows[k].cells[0];
        if (!c0 || hdrRows.indexOf(tb.rows[k]) >= 0) continue;
        var cs0 = getComputedStyle(c0);
        if (cs0.position === 'sticky' && cs0.top !== 'auto') hdrRows.push(tb.rows[k]);
      }
    }
    s.rows = hdrRows;
    hdrRows.forEach(function (r) { for (var j = 0; j < r.cells.length; j++) s.cells.push(r.cells[j]); });
    for (var a = t.parentElement; a && a !== document.body && a !== root; a = a.parentElement) {
      var cs = getComputedStyle(a);
      if (cs.position === 'fixed') { s.skip = true; return s; }
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') s.clips.push(a);
    }
    return s;
  }

  function paintOn(t, s) {
    // Read the page's own header colors with our override off, then lay them over the surface.
    t.removeAttribute('data-bk-pinned');
    s.cells.forEach(function (c) { c.style.removeProperty('background-color'); c.style.removeProperty('background-image'); });
    var surface = surfaceBehind(t);
    s.cells.forEach(function (c) {
      var own = getComputedStyle(c).backgroundColor;
      var oc = parseColor(own);
      if (oc && oc.a >= 1) return;                       // already opaque (e.g. asin-daily, movers)
      if (oc && oc.a > 0) c.style.setProperty('background-image', 'linear-gradient(' + own + ',' + own + ')');
      c.style.setProperty('background-color', surface);
    });
    var lastRow = s.rows[s.rows.length - 1];
    s.cells.forEach(function (c) {
      if (getComputedStyle(c).position === 'static') c.style.setProperty('position', 'relative');
      c.style.setProperty('z-index', '6');      // above body cells, incl. sticky first columns (z 1-3)
      if (c.parentElement === lastRow) c.style.setProperty('box-shadow', 'inset 0 -1px 0 rgba(127,140,132,.55)');
    });
    t.setAttribute('data-bk-pinned', '');
  }

  function clear(t, s) {
    s.cells.forEach(function (c) {
      c.style.removeProperty('transform'); c.style.removeProperty('background-color');
      c.style.removeProperty('background-image'); c.style.removeProperty('position');
      c.style.removeProperty('z-index'); c.style.removeProperty('box-shadow');
    });
    t.removeAttribute('data-bk-pinned');
    s.on = false; s.shift = 0;
  }

  function update() {
    queued = false;
    var n = nav(); if (!n) return;
    var barBottom = n.getBoundingClientRect().bottom;
    var vh = window.innerHeight;
    var plan = [];
    // READ pass (no writes, so one layout per frame).
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i], s = info(t);
      if (s.skip || !s.cells.length) continue;
      var tr = t.getBoundingClientRect();
      // Closed <details> (amazon.html's "Show table" / glossary) still report a layout box — skip them.
      if (!tr.height || tr.bottom < 0 || tr.top > vh || t.closest('details:not([open])')) { if (s.on) plan.push([t, s, 0]); continue; }
      var first = s.rows[0].cells[0], last = s.rows[s.rows.length - 1].cells[0];
      if (!first || !last) continue;
      var top = first.getBoundingClientRect().top - s.shift;     // natural position (incl. page sticky)
      var bottom = last.getBoundingClientRect().bottom - s.shift;
      var limit = tr.bottom;
      for (var k = 0; k < s.clips.length; k++) {
        var cr = s.clips[k].getBoundingClientRect();
        var cb = cr.top + s.clips[k].clientTop + s.clips[k].clientHeight;   // excludes sideways scrollbar
        if (cb < limit) limit = cb;
      }
      var want = barBottom - top;
      var max = limit - bottom;
      // Release: once the table's visible bottom has gone under the bar, the header lets go.
      var shift = (want > 0 && max > 0 && limit > barBottom) ? Math.min(want, max) : 0;
      if (shift !== s.shift || (shift > 0) !== s.on) plan.push([t, s, shift]);
    }
    // WRITE pass.
    for (var p = 0; p < plan.length; p++) {
      var T = plan[p][0], S = plan[p][1], sh = plan[p][2];
      if (sh <= 0) { if (S.on) clear(T, S); continue; }
      if (!S.on) { S.on = true; paintOn(T, S); }
      var v = 'translateY(' + sh + 'px)';
      for (var c = 0; c < S.cells.length; c++) S.cells[c].style.transform = v;
      S.shift = sh;
    }
  }

  function schedule() { if (!queued) { queued = true; requestAnimationFrame(update); } }

  function rescan() {
    tables = Array.prototype.slice.call(document.querySelectorAll('table'));
    schedule();
  }

  function onThemeChange() {
    // Surfaces changed color: re-read the backgrounds of any pinned header.
    requestAnimationFrame(function () {
      tables.forEach(function (t) { var s = cache.get(t); if (s && s.on) paintOn(t, s); });
    });
  }

  function start() {
    publishNavHeight();
    if (window.ResizeObserver && nav()) {
      new ResizeObserver(function () { publishNavHeight(); schedule(); }).observe(nav());
    }
    rescan();
    // capture:true also catches scrolls of inner boxes (asin-daily / movers vertical scrollers).
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('click', function () { setTimeout(schedule, 0); }, true);  // tab switches
    document.addEventListener('toggle', schedule, true);                                 // <details> open/close
    window.addEventListener('burke-theme-change', onThemeChange);
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.target.closest && m.target.closest('#portal-nav-bar')) continue;
        for (var j = 0; j < m.addedNodes.length; j++) {
          var a = m.addedNodes[j];
          if (a.nodeType !== 1) continue;
          var tt = a.tagName === 'TABLE' ? null : a.closest('table');
          if (tt) {                      // rows/cells re-rendered (sort, filter): forget that table
            var st = cache.get(tt); if (st && st.on) clear(tt, st); cache.delete(tt); rescan(); return;
          }
          if (a.tagName === 'TABLE' || a.querySelector('table')) { rescan(); return; }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
