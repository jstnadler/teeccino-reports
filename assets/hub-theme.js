/* ────────────────────────────────────────────────────────────────────────────
   hub-theme.js — site-wide Dark / Light / Cream reading theme.  Owner: HubSmith.

   HOW IT REACHES EVERY PAGE (no publisher edits)
   The deploy workflow (.github/workflows/deploy-pages.yml → .github/scripts/
   inject_chrome.py) inserts ONE synchronous tag as the first child of <head> on
   every in-scope page at deploy time:
       <script src="/teeccino-reports/assets/hub-theme.js" data-hub-native="dark|light"></script>
   Because it runs at deploy, an owner builder that regenerates a page (DataOps,
   AgentSmith, CatalogSmith, CostSmith …) can never drop it: the next deploy
   re-adds it. The injector is idempotent. Fallback: nav-boot.js loads this file
   too (post-paint) if the tag is ever missing.

   CONTRACT (for publishers who want to opt in more deeply — nothing requires it)
     · localStorage['hub-theme'] = 'dark' | 'light' | 'cream'   (absent → dark)
     · <html data-hub-theme="dark|light|cream">
     · <html data-theme="dark|light"> is ALSO set (cream → "light") so pages that
       already ship their own [data-theme] rules (customer-demographics, social,
       cost-throughput, amazon-ads) follow the site choice instead of a 2nd toggle.
     · CSS vars on <html>: --hub-bg --hub-surface --hub-raised --hub-border
       --hub-grid --hub-ink --hub-ink2 --hub-muted --hub-accent --hub-accent-ink
     · window event 'hub-theme-change' {detail:{theme, tokens}}
     · window.HubTheme = { get(), set(t), tokens(), recolor(color, role) }
     · Opt out of recoloring for an element subtree: [data-hub-theme-keep]
       (swatches, brand mockups). Whole page: <meta name="hub-theme" content="off">.

   WHY A RECOLOR ENGINE (not a stylesheet of overrides)
   Pages here ship ~6 unrelated hand-rolled palettes (navy #1a1a2e, charcoal
   #0f1115, GitHub #0d1117, slate #0f172a, and light-native CostSmith/SearchSmith
   pages). A hex-by-hex override sheet (the Burke-portal approach) would need one
   list per generator and rots the day a generator changes a color. Instead each
   color is classified by ROLE (ground / surface / text / border / mark) and
   lightness, then mapped onto the theme's tokens; saturated colors keep their hue
   and are only moved in lightness until they pass WCAG contrast on the new ground.
   Rewrites happen IN PLACE on the CSSOM, inline styles, SVG attributes and
   Chart.js configs, all recorded so a theme switch reverts exactly.

   PRE-PAINT: in a theme that needs recoloring, <html> is held invisible-but-
   painted-in-the-theme-ground until DOMContentLoaded recolor finishes (hard cap
   2.5 s), so there is no flash of the wrong palette.

   Cream tokens: DesignSmith 2026-10-15 (outbox 2026-10-15T19-06-27Z-reports-
   cream-reading-theme-tokens). raised/grid for cream are HubSmith-derived steps
   between bg and border. Light tokens: HubSmith (neutral; gold accent kept as the
   hub's identity, darkened to 5:1).
   ──────────────────────────────────────────────────────────────────────────── */
(function () {
  if (window.HubTheme) return;
  var KEY = 'hub-theme';
  var root = document.documentElement;
  var me = document.currentScript;

  var TOKENS = {
    dark:  { bg: '#1a1a2e', surface: '#20263b', raised: '#2a3148', border: '#334155', grid: '#2a3245',
             ink: '#e2e8f0', ink2: '#cbd5e1', muted: '#94a3b8', accent: '#D4A843', accentInk: '#1a1a2e', scheme: 'dark' },
    light: { bg: '#f4f5f7', surface: '#ffffff', raised: '#eceef2', border: '#d9dee5', grid: '#e6e9ee',
             ink: '#14171c', ink2: '#3a4250', muted: '#5b6472', accent: '#8a6a12', accentInk: '#ffffff', scheme: 'light' },
    cream: { bg: '#f7f4ef', surface: '#ffffff', raised: '#f0ebe4', border: '#e4dcd2', grid: '#ece6de',
             ink: '#121212', ink2: '#6b3327', muted: '#756259', accent: '#B5404C', accentInk: '#ffffff', scheme: 'light' }
  };
  var NAMES = ['dark', 'light', 'cream'];

  function read() {
    try { var v = localStorage.getItem(KEY); return NAMES.indexOf(v) >= 0 ? v : 'dark'; } catch (e) { return 'dark'; }
  }

  var off = !!document.querySelector('meta[name="hub-theme"][content="off"]');
  var hint = me && me.getAttribute('data-hub-native');           // static hint from the injector
  var origDataTheme = root.getAttribute('data-theme');
  var theme = read();

  function setVars(t) {
    var k = TOKENS[t], s = root.style;
    s.setProperty('--hub-bg', k.bg); s.setProperty('--hub-surface', k.surface);
    s.setProperty('--hub-raised', k.raised); s.setProperty('--hub-border', k.border);
    s.setProperty('--hub-grid', k.grid); s.setProperty('--hub-ink', k.ink);
    s.setProperty('--hub-ink2', k.ink2); s.setProperty('--hub-muted', k.muted);
    s.setProperty('--hub-accent', k.accent); s.setProperty('--hub-accent-ink', k.accentInk);
  }
  function setAttrs(t) {
    root.setAttribute('data-hub-theme', t);
    // Pages with their own [data-theme] rules follow along. Leave a page-specific
    // non light/dark value (e.g. a portal's data-theme="burke") alone.
    if (origDataTheme == null || origDataTheme === 'dark' || origDataTheme === 'light') {
      root.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
    }
    setVars(t);
  }

  // ── pre-paint ──────────────────────────────────────────────────────────────
  var holdStyle = null;
  function hold(t) {
    holdStyle = document.createElement('style');
    holdStyle.setAttribute('data-hub-theme-keep', '');
    holdStyle.textContent = 'html[data-hub-pending]{background:' + TOKENS[t].bg + ' !important}' +
      'html[data-hub-pending] body{visibility:hidden !important}';
    (document.head || root).appendChild(holdStyle);
    root.setAttribute('data-hub-pending', '');
    setTimeout(release, 2500);
  }
  function release() { root.removeAttribute('data-hub-pending'); }

  setAttrs(theme);
  if (!off && (theme !== 'dark' || hint === 'light')) hold(theme);

  // ── color math ─────────────────────────────────────────────────────────────
  var NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
  function parse(str) {
    if (!str) return null;
    str = String(str).trim().toLowerCase();
    var m;
    if (str[0] === '#') {
      var h = str.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
               a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    if ((m = /^rgba?\(([^)]+)\)$/.exec(str))) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean);
      var f = function (v, i) { return /%$/.test(v) ? parseFloat(v) * (i < 3 ? 2.55 : 0.01) : parseFloat(v); };
      return { r: f(p[0], 0), g: f(p[1], 1), b: f(p[2], 2), a: p.length > 3 ? f(p[3], 3) : 1 };
    }
    if ((m = /^hsla?\(([^)]+)\)$/.exec(str))) {
      var q = m[1].split(/[\s,\/]+/).filter(Boolean);
      var rgb = hsl2rgb(parseFloat(q[0]) / 360, parseFloat(q[1]) / 100, parseFloat(q[2]) / 100);
      return { r: rgb[0], g: rgb[1], b: rgb[2], a: q.length > 3 ? (/%$/.test(q[3]) ? parseFloat(q[3]) / 100 : parseFloat(q[3])) : 1 };
    }
    if (NAMED[str]) return { r: NAMED[str][0], g: NAMED[str][1], b: NAMED[str][2], a: 1 };
    return null;
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l, d];
  }
  function hsl2rgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function t(x) { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; }
    return [t(h + 1 / 3) * 255, t(h) * 255, t(h - 1 / 3) * 255];
  }
  function lum(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function fmt(c) {
    var r = Math.round(c.r), g = Math.round(c.g), b = Math.round(c.b);
    if (c.a >= 0.999) return '#' + [r, g, b].map(function (v) { return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2); }).join('');
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (+c.a.toFixed(3)) + ')';
  }
  // Move lightness (keeping hue/sat) until contrast vs `against` >= target.
  function fitContrast(c, against, target, darker) {
    var hsl = rgb2hsl(c.r, c.g, c.b), lo = darker ? 0 : hsl[2], hi = darker ? hsl[2] : 1, best = null;
    var sat = Math.min(hsl[1], 0.9);
    for (var i = 0; i < 18; i++) {
      var mid = (lo + hi) / 2, rgb = hsl2rgb(hsl[0], sat, mid), cand = { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 };
      if (contrast(cand, against) >= target) { best = cand; if (darker) lo = mid; else hi = mid; }
      else { if (darker) hi = mid; else lo = mid; }
    }
    if (!best) { var e = hsl2rgb(hsl[0], sat, darker ? 0.15 : 0.85); best = { r: e[0], g: e[1], b: e[2], a: 1 }; }
    best.a = c.a; return best;
  }

  // ── mapping ────────────────────────────────────────────────────────────────
  // ctx: { native:'dark'|'light', t: tokens, groundL, tBg, tSurface }
  var ctx = null;
  var memo = {};
  function tok(name) { return parse(ctx.t[name]); }

  function mapColor(str, role) {
    var key = role + '|' + str;
    if (memo[key] !== undefined) return memo[key];
    var c = parse(str), out = null;
    if (c && c.a > 0) out = mapParsed(c, role);
    memo[key] = out;            // null = leave as is
    return out;
  }

  function mapParsed(c, role) {
    var hsl = rgb2hsl(c.r, c.g, c.b), l = hsl[2], chroma = hsl[3];
    var neutral = chroma < 0.2;
    var toDark = ctx.t.scheme === 'dark';
    var tBg = ctx.tBg;
    if (role === 'fill') role = neutral ? (ctx.native === 'dark' ? (l < 0.3 ? 'bg' : 'text') : (l > 0.75 ? 'bg' : 'text')) : 'mark';
    if (role === 'stroke') role = neutral ? 'border' : 'mark';
    // A page's saturated accent variables (--gold, --green, --warn …) are used as TEXT far more than as fills:
    // hold them to text contrast. Neutral ones keep mark handling.
    if (role === 'accentvar') role = neutral ? 'mark' : 'text';

    if (ctx.native === 'dark' && !toDark) {             // dark page → light theme
      if (role === 'bg') {
        if (c.a < 0.9) {
          if (neutral && l > 0.85) return fmt(c.a <= 0.07 ? tok('surface') : tok('raised'));   // white overlays = cards / hovers
          if (neutral && l < 0.15) return fmt({ r: 0, g: 0, b: 0, a: Math.min(0.06, c.a * 0.3) });
          if (neutral) return fmt(tok('raised'));
          return null;                                                                       // colored tints read fine on light
        }
        if (neutral) {
          if (l < 0.4) { var d = l - ctx.groundL; return fmt(Math.abs(d) <= 0.025 ? tok('bg') : (l >= 0.22 ? tok('raised') : tok('surface'))); }
          return null;
        }
        if (l < 0.36) { var tint = hsl2rgb(hsl[0], Math.min(hsl[1], 0.55), 0.93); return fmt({ r: tint[0], g: tint[1], b: tint[2], a: c.a }); }
        return null;
      }
      if (role === 'text') {
        if (neutral) {
          var el = c.a < 1 ? c.a * l + (1 - c.a) * ctx.groundL : l;
          if (el >= 0.86) return fmt(tok('ink'));
          if (el >= 0.72) return fmt(tok('ink2'));
          if (el >= 0.3) return fmt(tok('muted'));
          return null;                                            // dark text is sitting on a light chip
        }
        return contrast(c, tBg) >= 4.5 ? null : fmt(fitContrast(c, tBg, 4.6, true));
      }
      if (role === 'border') {
        if (neutral) return fmt(c.a <= 0.07 ? tok('grid') : tok('border'));
        return contrast(c, tBg) >= 2 ? null : fmt(fitContrast(c, tBg, 2.2, true));
      }
      if (role === 'mark') {                                     // series fills/lines, chips, bars
        if (neutral) return l > 0.6 ? fmt(Object.assign(tok('muted'), { a: c.a })) : (l < 0.25 ? fmt(tok('border')) : null);
        return (l > 0.78 && contrast(c, tBg) < 1.8) ? fmt(fitContrast(c, tBg, 2.4, true)) : null;
      }
      return null;
    }

    if (ctx.native === 'light') {                       // light page → any theme
      if (role === 'bg') {
        if (c.a < 0.9) {
          if (!toDark) return null;
          if (neutral && l < 0.15) return fmt({ r: 255, g: 255, b: 255, a: Math.min(0.08, c.a) });
          if (neutral && l > 0.85) return fmt({ r: 0, g: 0, b: 0, a: Math.min(0.25, c.a) });
          return null;
        }
        if (neutral) {
          if (l >= 0.9) return fmt(Math.abs(l - ctx.groundL) <= 0.02 ? tok('bg') : tok('surface'));
          if (l >= 0.75) return fmt(tok('raised'));
          return null;
        }
        if (toDark && l > 0.82) { var dt = hsl2rgb(hsl[0], Math.min(hsl[1], 0.5), 0.18); return fmt({ r: dt[0], g: dt[1], b: dt[2], a: c.a }); }
        return null;
      }
      if (role === 'text') {
        if (neutral) {
          if (l < 0.25) return fmt(tok('ink'));
          if (l < 0.45) return fmt(tok('ink2'));
          if (l < 0.7) return fmt(tok('muted'));
          return toDark ? null : null;                            // light text sits on a dark chip
        }
        if (!toDark) return contrast(c, tBg) >= 4.5 ? null : fmt(fitContrast(c, tBg, 4.6, true));
        return contrast(c, ctx.tSurface) >= 4.5 ? null : fmt(fitContrast(c, ctx.tSurface, 4.6, false));
      }
      if (role === 'border') {
        if (neutral) return fmt(tok(c.a <= 0.12 ? 'grid' : 'border'));
        return null;
      }
      if (role === 'mark') {
        if (neutral && toDark) return l < 0.4 ? fmt(Object.assign(tok('muted'), { a: c.a })) : (l > 0.75 ? fmt(tok('border')) : null);
        if (!neutral && toDark && l < 0.28) return fmt(fitContrast(c, ctx.tSurface, 2.4, false));
        return null;
      }
    }
    return null;
  }

  var COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g;
  function mapValue(v, role) {
    if (!v || v.indexOf('var(') >= 0 && !COLOR_RE.test(v)) { COLOR_RE.lastIndex = 0; return null; }
    COLOR_RE.lastIndex = 0;
    var changed = false;
    var out = v.replace(COLOR_RE, function (m) {
      var r = mapColor(m, role);
      if (r) { changed = true; return r; }
      return m;
    });
    return changed ? out : null;
  }

  function roleOf(prop) {
    if (prop.indexOf('--') === 0) {
      var n = prop.toLowerCase();
      if (/(^|-)(bg|background|card|surface|plane|panel|page|paper|base|hover|input|raised|well|elev|tier\d?-bg|prov-bg)/.test(n)) return 'bg';
      if (/(text|ink|muted|mut|dim|faint|fg|label|tick|subtle)/.test(n)) return 'text';
      if (/(border|line|grid|rule|divider|axis|baseline|hairline|stroke|outline)/.test(n)) return 'border';
      return 'accentvar';
    }
    if (prop === 'color' || prop === '-webkit-text-fill-color' || prop === 'caret-color' || prop === 'text-decoration-color') return 'text';
    if (prop === 'background-color' || prop === 'background-image' || prop === 'background') return 'bg';
    if (/^border.*color$|^outline-color$|^column-rule-color$/.test(prop)) return 'border';
    if (prop === 'fill' || prop === 'stop-color' || prop === 'flood-color') return 'fill';
    if (prop === 'stroke') return 'stroke';
    if (prop === 'accent-color') return 'mark';
    return null;
  }

  // ── journal (everything we changed, for exact revert) ──────────────────────
  var journal = [];
  var inlineSeen = new WeakMap();      // element → {prop: mappedValue}
  var attrSeen = new WeakMap();

  function rewriteDecl(style) {
    // Gradient-filled headline text (background-clip:text): its "background" IS the text color.
    var clipText = /text/.test(style.getPropertyValue('-webkit-background-clip') + style.getPropertyValue('background-clip'));
    for (var i = style.length - 1; i >= 0; i--) {
      var prop = style[i], role = roleOf(prop);
      if (!role) continue;
      if (clipText && role === 'bg') role = 'text';
      var v = style.getPropertyValue(prop);
      var nv = mapValue(v, role);
      if (nv == null) continue;
      var pr = style.getPropertyPriority(prop);
      journal.push([style, prop, v, pr]);
      style.setProperty(prop, nv, pr);
    }
  }

  function walkRules(rules) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.style) rewriteDecl(r.style);
      if (r.cssRules && r.cssRules.length) walkRules(r.cssRules);
    }
  }
  var doneSheets = new WeakSet();
  function processSheets() {
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      if (doneSheets.has(sh)) continue;
      var owner = sh.ownerNode;
      if (owner && owner.closest && owner.closest('[data-hub-theme-keep]')) { doneSheets.add(sh); continue; }
      var rules;
      try { rules = sh.cssRules; } catch (e) { doneSheets.add(sh); continue; }   // cross-origin
      doneSheets.add(sh);
      walkRules(rules);
    }
  }

  function processInline(el) {
    if (el.closest && el.closest('[data-hub-theme-keep]')) return;
    var st = el.style; if (!st || !st.length) return;
    var seen = inlineSeen.get(el) || {};
    for (var i = st.length - 1; i >= 0; i--) {
      var prop = st[i], role = roleOf(prop);
      if (!role) continue;
      var v = st.getPropertyValue(prop);
      if (seen[prop] === v) continue;                 // our own output
      var nv = mapValue(v, role);
      if (nv == null) continue;
      var pr = st.getPropertyPriority(prop);
      journal.push([st, prop, v, pr, el]);
      st.setProperty(prop, nv, pr);
      seen[prop] = st.getPropertyValue(prop);
    }
    inlineSeen.set(el, seen);
  }
  var SVG_ATTRS = ['fill', 'stroke', 'stop-color', 'color'];
  function processAttrs(el) {
    if (el.closest && el.closest('[data-hub-theme-keep]')) return;
    var seen = attrSeen.get(el) || {};
    for (var i = 0; i < SVG_ATTRS.length; i++) {
      var a = SVG_ATTRS[i], v = el.getAttribute(a);
      if (!v || seen[a] === v) continue;
      var nv = mapValue(v, a === 'color' ? 'text' : roleOf(a));
      if (nv == null) continue;
      journal.push(['attr', el, a, v]);
      el.setAttribute(a, nv); seen[a] = nv;
    }
    attrSeen.set(el, seen);
  }
  function processTree(node) {
    if (node.nodeType !== 1) return;
    if (node.hasAttribute('style')) processInline(node);
    if (node.namespaceURI === 'http://www.w3.org/2000/svg') processAttrs(node);
    var list = node.querySelectorAll('[style]');
    for (var i = 0; i < list.length; i++) processInline(list[i]);
    var svg = node.querySelectorAll('svg [fill], svg [stroke], svg [stop-color], svg[fill], svg[stroke], svg text[fill]');
    for (var j = 0; j < svg.length; j++) processAttrs(svg[j]);
  }

  function revertAll() {
    for (var i = journal.length - 1; i >= 0; i--) {
      var j = journal[i];
      if (j[0] === 'attr') { j[1].setAttribute(j[2], j[3]); continue; }
      try { j[0].setProperty(j[1], j[2], j[3]); } catch (e) {}
    }
    journal = []; memo = {};
    doneSheets = new WeakSet(); inlineSeen = new WeakMap(); attrSeen = new WeakMap();
    revertCharts();
  }

  // ── native-mode detection ──────────────────────────────────────────────────
  function groundOf() {
    var els = [document.body, root];
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      var cs = getComputedStyle(els[i]);
      var c = parse(cs.backgroundColor);
      if (c && c.a > 0.5) return c;
      var m = (cs.backgroundImage || '').match(COLOR_RE); COLOR_RE.lastIndex = 0;
      if (m && m.length) { var g = parse(m[0]); if (g) return g; }
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  // ── Chart.js ───────────────────────────────────────────────────────────────
  var chartJournal = [];
  var CH_SKIP = { data: 1, animation: 1, animations: 1, transitions: 1, layout: 1, interaction: 1, font: 1 };
  function chartRole(path, key) {
    if (/tooltip/.test(path)) return /background/i.test(key) ? 'bg' : (/border/i.test(key) ? 'border' : 'text');
    if (/grid|border/.test(path) || /^borderColor$|^tickColor$/.test(key)) return 'border';
    return 'text';
  }
  // Chart.js rebuilds config.options.scales on every update, so undo records hold a PATH
  // from the chart (re-walked at revert time), never a reference to a sub-object.
  function walkChartOpts(obj, path, depth, chart, keys) {
    keys = keys || [];
    if (!obj || typeof obj !== 'object' || depth > 7) return;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k) || CH_SKIP[k]) continue;
      var v = obj[k];
      if (typeof v === 'string' && /color$/i.test(k)) {
        var nv = mapValue(v, chartRole(path, k));
        if (nv != null) { chartJournal.push(['path', chart, keys.concat(k), v]); obj[k] = nv; }
      } else if (v && typeof v === 'object' && !Array.isArray(v)) walkChartOpts(v, path + '.' + k, depth + 1, chart, keys.concat(k));
    }
  }
  function walkDatasets(data) {
    if (!data || !data.datasets) return;
    data.datasets.forEach(function (ds) {
      for (var k in ds) {
        if (!/color$/i.test(k)) continue;
        var v = ds[k];
        if (typeof v === 'string') {
          var nv = mapValue(v, 'mark'); if (nv != null) { chartJournal.push([ds, k, v]); ds[k] = nv; }
        } else if (Array.isArray(v)) {
          var copy = v.slice(), ch = false;
          for (var i = 0; i < copy.length; i++) if (typeof copy[i] === 'string') { var n2 = mapValue(copy[i], 'mark'); if (n2 != null) { copy[i] = n2; ch = true; } }
          if (ch) { chartJournal.push([ds, k, v]); ds[k] = copy; }
        }
      }
    });
  }
  var chartDefaultsDone = false;
  function themeChartDefaults(C) {
    if (chartDefaultsDone || !ctx || ctx.identity) return;
    chartDefaultsDone = true;
    var d = C.defaults; if (!d) return;
    ['color', 'borderColor'].forEach(function (k) {
      if (typeof d[k] === 'string') { var nv = mapValue(d[k], k === 'color' ? 'text' : 'border'); if (nv) { chartJournal.push([d, k, d[k]]); d[k] = nv; } }
    });
    try {
      var sg = d.scale && d.scale.grid; if (sg && typeof sg.color === 'string') { var g = mapValue(sg.color, 'border'); if (g) { chartJournal.push([sg, 'color', sg.color]); sg.color = g; } }
      var ll = d.plugins && d.plugins.legend && d.plugins.legend.labels; if (ll && typeof ll.color === 'string') { var lc = mapValue(ll.color, 'text'); if (lc) { chartJournal.push([ll, 'color', ll.color]); ll.color = lc; } }
    } catch (e) {}
  }
  function themeChart(chart) {
    if (!ctx || ctx.identity || chart.__hubThemed) return;
    chart.__hubThemed = true;
    var cfg = chart.config || {};
    var C = window.Chart; if (C) themeChartDefaults(C);
    walkChartOpts(cfg.options, 'options', 0, chart, []);
    walkDatasets(cfg.data);
  }
  function revertCharts() {
    for (var i = chartJournal.length - 1; i >= 0; i--) {
      var j = chartJournal[i];
      if (j[0] === 'path') {
        var o = j[1].config && j[1].config.options, ks = j[2];
        for (var q = 0; o && q < ks.length - 1; q++) o = o[ks[q]];
        if (o && typeof o === 'object') o[ks[ks.length - 1]] = j[3];
      } else j[0][j[1]] = j[2];
    }
    chartJournal = []; chartDefaultsDone = false;
    eachChart(function (ch) { ch.__hubThemed = false; });
  }
  function eachChart(fn) {
    var C = window.Chart; if (!C || !C.instances) return;
    var inst = C.instances;
    Object.keys(inst).forEach(function (k) { if (inst[k]) fn(inst[k]); });
  }
  function hookChart(C) {
    if (!C || C.__hubHooked || typeof C.register !== 'function') return;
    C.__hubHooked = true;
    // Never let a theming bug stop a page's chart from drawing.
    try { C.register({ id: 'hubTheme', beforeInit: function (chart) { try { themeChart(chart); } catch (e) { warn(e); } } }); } catch (e) {}
    themeChartDefaults(C);
  }
  // Chart.js UMD assigns globalThis.Chart — catch it the moment it lands.
  (function () {
    var cur = window.Chart;
    if (cur) { setTimeout(function () { hookChart(cur); }, 0); return; }
    try {
      Object.defineProperty(window, 'Chart', {
        configurable: true, enumerable: true,
        get: function () { return cur; },
        set: function (v) { cur = v; if (ctx) hookChart(v); }
      });
    } catch (e) {}
  })();

  // ── apply ──────────────────────────────────────────────────────────────────
  var observer = null, pendingNodes = [], flushQueued = false;
  function flush() { try { flushInner(); } catch (e) { warn(e); } }
  function flushInner() {
    flushQueued = false;
    if (!ctx || ctx.identity) { pendingNodes = []; return; }
    processSheets();
    var nodes = pendingNodes; pendingNodes = [];
    for (var i = 0; i < nodes.length; i++) if (nodes[i].isConnected) processTree(nodes[i]);
  }
  function queue(n) { pendingNodes.push(n); if (!flushQueued) { flushQueued = true; Promise.resolve().then(flush); } }

  function warn(e) { try { console.warn('[hub-theme]', e); } catch (x) {} }
  function apply() { try { applyInner(); } catch (e) { warn(e); release(); } }
  function applyInner() {
    revertAll();
    ctx = null;
    if (off) { release(); return; }
    var g = groundOf();
    var native = lum(g) > 0.4 ? 'light' : 'dark';
    var t = TOKENS[theme];
    ctx = { native: native, t: t, groundL: rgb2hsl(g.r, g.g, g.b)[2], tBg: parse(t.bg), tSurface: parse(t.surface),
            identity: (native === 'dark' && t.scheme === 'dark') };
    root.setAttribute('data-hub-native', native);
    if (!ctx.identity) {
      processSheets();
      processTree(document.body || root);
      if (window.Chart) { hookChart(window.Chart); themeChartDefaults(window.Chart); }
    }
    eachChart(function (ch) {
      if (!ctx.identity) themeChart(ch);
      try { ch.update('none'); } catch (e) {}
    });
    if (!observer && window.MutationObserver) {
      observer = new MutationObserver(function (muts) {
        if (!ctx || ctx.identity) return;
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes') { queue(m.target); continue; }
          for (var j = 0; j < m.addedNodes.length; j++) {
            var a = m.addedNodes[j];
            if (a.nodeType === 1) queue(a);
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'fill', 'stroke'] });
    }
    release();
  }

  function set(t) {
    if (NAMES.indexOf(t) < 0) t = 'dark';
    try { localStorage.setItem(KEY, t); } catch (e) {}
    theme = t;
    setAttrs(t);
    // Pages with their own [data-theme] CSS re-cascade first, then we re-detect.
    requestAnimationFrame(function () { apply(); paintSwitches(); fire(); });
  }
  function fire() { try { window.dispatchEvent(new CustomEvent('hub-theme-change', { detail: { theme: theme, tokens: TOKENS[theme] } })); } catch (e) {} }

  // ── switch UI ──────────────────────────────────────────────────────────────
  function paintSwitches() {
    var b = document.querySelectorAll('[data-hub-theme-set]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', b[i].getAttribute('data-hub-theme-set') === theme ? 'true' : 'false');
  }
  function switchHTML() {
    return '<span class="hub-theme-switch" role="group" aria-label="Color theme" data-hub-theme-keep>' +
      NAMES.map(function (n) { return '<button type="button" data-hub-theme-set="' + n + '">' + n.charAt(0).toUpperCase() + n.slice(1) + '</button>'; }).join('') +
      '</span>';
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-hub-theme-set]') : null;
    if (b) { ev.preventDefault(); set(b.getAttribute('data-hub-theme-set')); }
  });
  window.addEventListener('storage', function (ev) { if (ev.key === KEY) { theme = read(); setAttrs(theme); apply(); paintSwitches(); fire(); } });

  // Pages that don't mount the hub nav still get a switch: a small fixed pill.
  function ensureSwitch() {
    if (off) return;
    var slot = document.getElementById('hub-theme-slot');
    if (slot && !slot.firstChild) slot.innerHTML = switchHTML();
    if (!document.querySelector('.hub-theme-switch') && !document.getElementById('hub-nav')) {
      var f = document.createElement('div');
      f.className = 'hub-theme-float'; f.setAttribute('data-hub-theme-keep', '');
      f.innerHTML = switchHTML();
      document.body.appendChild(f);
    }
    paintSwitches();
  }

  function loadAsset(src, isCss) {
    var base = (me && me.src) ? me.src.replace(/[^\/]*$/, '') : '/teeccino-reports/assets/';
    if (document.querySelector((isCss ? 'link[href$="' : 'script[src$="') + src + '"]')) return;
    var n = document.createElement(isCss ? 'link' : 'script');
    if (isCss) { n.rel = 'stylesheet'; n.href = base + src; n.setAttribute('data-hub-theme-keep', ''); }
    else { n.src = base + src; n.defer = true; }
    (document.head || root).appendChild(n);
  }

  window.HubTheme = {
    get: function () { return theme; },
    set: set,
    tokens: function () { return TOKENS[theme]; },
    recolor: function (color, role) { return ctx && !ctx.identity ? (mapValue(color, role || 'text') || color) : color; },
    switchHTML: switchHTML,
    ensureSwitch: ensureSwitch,
    _apply: apply
  };

  loadAsset('hub-theme.css', true);
  function boot() {
    apply();
    ensureSwitch();
    loadAsset('hub-datepicker.js', false);
    // Nav is fetched after DOMContentLoaded; mount its switch slot when it lands.
    setTimeout(ensureSwitch, 1200);
    window.addEventListener('load', function () { setTimeout(ensureSwitch, 50); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
