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

  // DATA-FILL CHIPS. A heatmap cell / legend swatch carries a saturated, opaque inline
  // fill that encodes a VALUE, and (for cells) a label color the publisher paired to that
  // fill (stayai-breakeven: background:#184f95;color:#fff). Re-theming either half breaks
  // it: a lifted fill no longer matches its legend, a re-inked label vanishes on the
  // un-lifted fill. Such an element is self-contained → keep its fill AND every inline
  // text color inside it, in every theme. Neutral fills (panels, cards) are not chips.
  function dataFill(st) {
    var v = st.getPropertyValue('background-color') || st.getPropertyValue('background');
    if (!v || /gradient|url\(|var\(/.test(v)) return null;
    var m = v.match(COLOR_RE); COLOR_RE.lastIndex = 0;
    var c = m && m.length === 1 ? parse(m[0]) : null;
    if (!c || c.a < 0.9 || rgb2hsl(c.r, c.g, c.b)[3] < 0.2) return null;
    return c;
  }
  function isChip(el, st) {
    if (el.__hubChip !== undefined) return el.__hubChip;
    var c = dataFill(st), res = false;
    if (c) {
      var fg = parse(st.getPropertyValue('color'));
      if (fg && fg.a > 0.5) res = contrast(fg, c) >= 3;               // fill + paired label
      else res = !el.textContent.trim() && !el.children.length;          // bare legend swatch
    }
    el.__hubChip = res;            // authored values never change under us, so the verdict is stable
    return res;
  }
  function inChip(el) {
    for (var p = el.parentElement, d = 0; p && d < 3; p = p.parentElement, d++) if (p.__hubChip) return true;
    return false;
  }

  function processInline(el) {
    if (el.closest && el.closest('[data-hub-theme-keep]')) return;
    var st = el.style; if (!st || !st.length) return;
    if (isChip(el, st)) return;
    var chipKid = inChip(el);
    var seen = inlineSeen.get(el) || {};
    for (var i = st.length - 1; i >= 0; i--) {
      var prop = st[i], role = roleOf(prop);
      if (!role) continue;
      // Our own theme tokens live inline on <html>; any later write to <html style> (nav sets
      // --hub-nav-h) re-queues it, and remapping them flipped --hub-accent-ink to ink (3.4:1 chips).
      if (prop.indexOf('--hub-') === 0) continue;
      if (chipKid && role === 'text') continue;
      var v = st.getPropertyValue(prop);
      var co = prop === 'color' && cOver.get(el);
      if (co && co[2] === v) continue;               // our own contrast override
      if (seen[prop] === v) continue;                 // our own output
      var nv = mapValue(v, role);
      if (nv == null) continue;
      var pr = st.getPropertyPriority(prop);
      st.setProperty(prop, nv, pr);
      seen[prop] = st.getPropertyValue(prop);
      journal.push([st, prop, v, pr, el, seen[prop]]);
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
      journal.push(['attr', el, a, v, nv]);
      el.setAttribute(a, nv); seen[a] = nv;
    }
    attrSeen.set(el, seen);
  }
  // ── contrast against the element's OWN painted background ──────────────────
  // The role mapper recolors each declaration in isolation and fits text against the
  // THEME GROUND. Text that sits on its own tinted fill (a selected toggle, a good/warn/bad
  // pill, a tinted panel) can then land at 4.0–4.4:1. This pass runs after recoloring and
  // measures each text-bearing element against the composite of every painted ancestor
  // layer (alpha-aware), then moves only lightness — hue kept — until it reaches 4.5:1.
  // Overrides are inline !important, journaled, and re-derived when class/style changes.
  var CTARGET = 4.5;
  var cOver = new WeakMap();           // el → [origValue, origPriority, ourValue]
  var selfWrote = null;                // Set of elements written during a flush (observer echo filter)
  function bgLayer(cs) {
    var c = parse(cs.backgroundColor);
    if (c && c.a > 0.01) return c;
    var bi = cs.backgroundImage;
    if (bi && bi !== 'none' && !/url\(/.test(bi)) {
      var m = bi.match(COLOR_RE); COLOR_RE.lastIndex = 0;
      if (m) { var g = parse(m[0]); if (g && g.a > 0.01) return g; }
    }
    return null;
  }
  function over(top, bot) {
    var a = top.a;
    return { r: top.r * a + bot.r * (1 - a), g: top.g * a + bot.g * (1 - a), b: top.b * a + bot.b * (1 - a), a: 1 };
  }
  function paintedBg(el, cache) {
    var stack = [], base = null;
    for (var a = el; a && a.nodeType === 1; a = a.parentElement) {
      if (cache.has(a)) { base = cache.get(a); break; }
      var l = bgLayer(getComputedStyle(a));
      if (l) { stack.push([a, l]); if (l.a >= 0.999) { base = l; stack.pop(); cache.set(a, l); break; } }
      else stack.push([a, null]);
    }
    if (!base) base = ctx.tBg;
    for (var i = stack.length - 1; i >= 0; i--) {
      if (stack[i][1]) base = over(stack[i][1], base);
      cache.set(stack[i][0], base);
    }
    return base;
  }
  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    return false;
  }
  // Many pages ship `transition: all`. A recolor then animates, and a mid-flight computed
  // color/background is what we'd measure (a card still half-dark → text fitted LIGHT on a
  // white card, 2:1). So transitions are frozen while we rewrite + measure. Toggled via
  // sheet.disabled — no DOM mutation, so the observer never sees it.
  var noTrans = null;
  function freeze(on) {
    try {
      if (!noTrans) {
        noTrans = document.createElement('style');
        noTrans.setAttribute('data-hub-theme-keep', '');
        noTrans.textContent = '*,*::before,*::after{transition:none !important}';
        (document.head || root).appendChild(noTrans);
      }
      if (noTrans.sheet) noTrans.sheet.disabled = !on;
      if (on) void getComputedStyle(root).color;       // settle styles under the freeze
    } catch (e) {}
  }
  function fixContrastIn(node) {
    if (!ctx || node.nodeType !== 1) return;          // runs in Dark too (Justin, 2026-10-15)
    var cache = new Map();
    var list = [node].concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName)) continue;
      var had = cOver.get(el);
      if (had) {                                   // re-derive from the page's own value
        cOver.delete(el);
        if (el.style.getPropertyValue('color') === had[2]) {   // page hasn't re-set it since
          el.style.setProperty('color', had[0], had[1]);
          if (selfWrote) selfWrote.add(el);
        }
      }
      if (!hasOwnText(el)) continue;
      if (el.closest('[data-hub-theme-keep],svg') || el.__hubChip || inChip(el)) continue;
      var cs = getComputedStyle(el);
      // No visibility check: the pre-paint hold makes the whole body visibility:hidden while
      // this runs. Fixing an invisible element is harmless; skipping all of them was not.
      if (cs.display === 'none') continue;
      if (/text/.test((cs.webkitBackgroundClip || '') + (cs.backgroundClip || ''))) continue;
      var fg = parse(cs.color); if (!fg || fg.a < 0.3) continue;
      var bg = paintedBg(el, cache);
      var eff = fg.a < 1 ? over(fg, bg) : fg;
      if (contrast(eff, bg) >= CTARGET) continue;
      var darker = lum(bg) > 0.18;
      var fit = fitContrast({ r: fg.r, g: fg.g, b: fg.b, a: 1 }, bg, CTARGET + 0.1, darker);
      if (contrast(fit, bg) < CTARGET) fit = darker ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
      var nv = fmt(fit);
      var ov = el.style.getPropertyValue('color'), op = el.style.getPropertyPriority('color');
      el.style.setProperty('color', nv, 'important');
      var wrote = el.style.getPropertyValue('color');
      cOver.set(el, [ov, op, wrote]);
      journal.push([el.style, 'color', ov, op, el, wrote]);
      if (selfWrote) selfWrote.add(el);
    }
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
      if (j[0] === 'attr') { if (j[1].getAttribute(j[2]) === j[4]) j[1].setAttribute(j[2], j[3]); continue; }
      // Inline entries: restore only if the value is still the one WE wrote. If the page has
      // re-set it since (a toggle click), the page's newer value wins — restoring our older
      // "original" brought back a stale selected state on theme switch.
      if (j.length > 5 && j[0].getPropertyValue(j[1]) !== j[5]) continue;
      try { j[0].setProperty(j[1], j[2], j[3]); } catch (e) {}
    }
    journal = []; memo = {}; cOver = new WeakMap();
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
    if (!ctx) { pendingNodes = []; return; }
    // Dark-native page in Dark: no recolor, but the contrast pass still runs.
    if (!ctx.identity) processSheets();
    var nodes = pendingNodes; pendingNodes = [];
    selfWrote = new Set();
    freeze(true);
    try {
      if (!ctx.identity) for (var i = 0; i < nodes.length; i++) if (nodes[i].isConnected) processTree(nodes[i]);
      // A new stylesheet can recolor anything, so a sheet arrival re-checks the whole body.
      var roots = sheetsAdded ? [document.body] : nodes; sheetsAdded = false;
      for (var k = 0; k < roots.length; k++) if (roots[k] && roots[k].isConnected) fixContrastIn(roots[k]);
    } finally {
      // Drop the observer's echo of our own writes; keep anything the page did meanwhile.
      if (observer) {
        var recs = observer.takeRecords();
        for (var r = 0; r < recs.length; r++) handleRec(recs[r], selfWrote);
      }
      selfWrote = null;
      freeze(false);
    }
  }
  var sheetsAdded = false;
  function handleRec(m, skip) {
    if (m.type === 'attributes') { if (!(skip && skip.has(m.target))) queue(m.target); return; }
    for (var j = 0; j < m.addedNodes.length; j++) {
      var a = m.addedNodes[j];
      // el.textContent = '658' on an empty span adds only a TEXT node; the span itself now
      // carries text for the first time and needs its contrast checked.
      if (a.nodeType === 3) { if (m.target && m.target.nodeType === 1 && /\S/.test(a.nodeValue)) queue(m.target); continue; }
      if (a.nodeType !== 1) continue;
      if (a.tagName === 'STYLE' || a.tagName === 'LINK') sheetsAdded = true;
      queue(a);
    }
  }
  function queue(n) { pendingNodes.push(n); if (!flushQueued) { flushQueued = true; Promise.resolve().then(flush); } }

  function warn(e) { try { console.warn('[hub-theme]', e); } catch (x) {} }
  function apply() { freeze(true); try { applyInner(); } catch (e) { warn(e); release(); } freeze(false); }
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
    // Every theme, including Dark-as-authored: text below 4.5:1 on its own background is lifted.
    fixContrastIn(document.body || root);
    if (!observer && window.MutationObserver) {
      observer = new MutationObserver(function (muts) {
        if (!ctx) return;
        for (var i = 0; i < muts.length; i++) handleRec(muts[i], null);
      });
      observer.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['style', 'fill', 'stroke', 'class', 'aria-pressed', 'aria-selected', 'disabled'] });
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
