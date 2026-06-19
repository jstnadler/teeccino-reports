/* ────────────────────────────────────────────────────────────────────────────
   nav-boot.js — shared hub-nav bootstrap (Owner: HubSmith).

   WHY THIS FILE EXISTS
   The nav fragment (_partials/nav.html) is injected into dashboards via
   `slot.innerHTML = html`. Per the HTML spec, <script> tags inserted that way do
   NOT execute. The previous workaround put the ENTIRE bootstrap inside an
   <img onerror="…big multi-line IIFE…"> attribute. That attribute parsed as a
   single inline-handler program and threw `SyntaxError: Invalid or unexpected
   token` in the live environment — so the badge, active-link highlight, and
   padding-sync all silently no-op'd on every page that uses the minimal include.

   FIX: keep the inline onerror trivial and token-safe — it only injects THIS
   external script. A dynamically created <script src> executes reliably even when
   its parent came from innerHTML, and the logic here lives in a normal .js file
   with zero HTML-attribute tokenization constraints.

   This runs the same three jobs as before:
     0) Share mode (?share=1) — clean externally-shareable view.
     1) Active-link highlight in the nav.
     1.5) Report ownership badge ("Maintained by {Agent}") from pages.json `owner`.
     2) Dynamic body padding-top sync to the real (possibly wrapped) nav height.
   ──────────────────────────────────────────────────────────────────────────── */
(function () {
  if (window.__hubNavBootstrapped) return;
  window.__hubNavBootstrapped = true;

  /* 0) SHARE MODE — ?share=1 produces a clean, externally-shareable view: hides
     the hub nav, hides the provenance banner + owner badge, appends a small
     "Shared by Teeccino" footer, and zeroes body padding-top.

     SESSION-STICKY: the first time a tab sees ?share=1 we persist a flag in
     sessionStorage and re-apply share mode on every subsequent page in that tab —
     even when navigation happens via JS (e.g. the MTD month dropdown's
     window.location.href, which would otherwise drop the query string). Stickiness
     is per-tab only. Enable: ?share=1 (or true). Disable/reset: ?share=0 (or false).
     If sessionStorage is unavailable, we fall back to URL-only behavior. */
  var params = new URLSearchParams(window.location.search);
  var shareParam = params.get('share');
  var shareOn = false;
  try {
    if (shareParam === '0' || shareParam === 'false') {
      sessionStorage.removeItem('teeccino-share');
    } else if (shareParam === '1' || shareParam === 'true') {
      sessionStorage.setItem('teeccino-share', '1');
      shareOn = true;
    } else if (sessionStorage.getItem('teeccino-share') === '1') {
      shareOn = true;
    }
  } catch (e) {
    shareOn = (shareParam === '1' || shareParam === 'true');
  }
  if (shareOn) {
    var s = document.createElement('style');
    s.id = 'share-mode-style';
    s.textContent =
      '#hub-nav, #hub-nav-bar { display: none !important; }' +
      '.prov-banner { display: none !important; }' +
      '#report-owner-badge { display: none !important; }' +
      'body.has-hub-nav { padding-top: 0 !important; }' +
      'body { padding-top: 0 !important; }' +
      '#share-footer { margin: 64px auto 24px; padding: 20px 16px; text-align: center; ' +
        'color: #94a3b8; font-size: 0.82em; line-height: 1.5; ' +
        'border-top: 1px solid rgba(0, 0, 0, 0.08); max-width: 880px; ' +
        "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }" +
      '#share-footer strong { color: #D4A843; font-weight: 700; letter-spacing: -0.01em; }' +
      '#share-footer .share-sub { display: block; margin-top: 4px; color: #cbd5e1; font-size: 0.92em; }';
    document.head.appendChild(s);
    document.body.classList.remove('has-hub-nav');
    if (!document.getElementById('share-footer')) {
      var f = document.createElement('div');
      f.id = 'share-footer';
      f.innerHTML = 'Shared by <strong>Teeccino</strong>' +
        "<span class='share-sub'>Internal report — please do not redistribute.</span>";
      document.body.appendChild(f);
    }
    return;
  }

  /* Shared manifest fetch — the owner badge AND the page search both need
     pages.json. Fetch it at most once per page and hand both consumers the same
     promise (single source of truth = the manifest, so search auto-syncs). */
  var _manifestPromise = null;
  function getManifest() {
    if (_manifestPromise) return _manifestPromise;
    _manifestPromise = fetch('/teeccino-reports/pages.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return _manifestPromise;
  }

  /* 1) Active-link highlight */
  var here = window.location.pathname.replace(/^.*\/teeccino-reports\//, '').replace(/^\//, '');
  if (!here) here = 'index.html';
  document.querySelectorAll('#hub-nav-bar a.nav-link').forEach(function (a) {
    var href = a.getAttribute('href').replace(/^.*\/teeccino-reports\//, '').replace(/^\//, '');
    if (href === here || (here.startsWith(href.replace('.html', '')) && href !== 'index.html')) {
      a.classList.add('active');
    }
  });

  /* 1.5) REPORT OWNERSHIP BADGE — "Maintained by {Agent}" bar under the nav,
     sourced from pages.json `owner` (single source of truth → auto-covers every
     current AND future report). Edge cases: page absent from manifest → render
     nothing (fail safe); owner 'unknown' → muted "no active maintainer" notice.
     Share mode returned above, so this never runs there. */
  (function renderOwnerBadge() {
    if (here === 'index.html') return;            /* the hub itself needs no badge */
    if (document.getElementById('report-owner-badge')) return;
    var NAMES = {
      agentsmith: 'AgentSmith', dataops: 'DataOps', catalogsmith: 'CatalogSmith',
      adsmith: 'AdSmith', shopkeeper: 'Shopkeeper', themesmith: 'ThemeSmith',
      assetsmith: 'AssetSmith', hubsmith: 'HubSmith', brewsmith: 'BrewSmith',
      labsmith: 'LabSmith', searchsmith: 'SearchSmith'
    };
    var esc = function (str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    getManifest()
      .then(function (data) {
        if (!data || !Array.isArray(data.pages)) return;
        var norm = function (p) { return String(p || '').replace(/^\.?\//, ''); };
        var entry = null;
        for (var i = 0; i < data.pages.length; i++) {
          if (norm(data.pages[i].path) === here) { entry = data.pages[i]; break; }
        }
        if (!entry) return;                         /* not in manifest → no badge */
        var owner = (entry.owner || '').toLowerCase();
        var bar = document.createElement('div');
        bar.id = 'report-owner-badge';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Report ownership');
        if (!owner || owner === 'unknown') {
          bar.className = 'is-legacy';
          bar.innerHTML = '<span class="rob-icon" aria-hidden="true">🗄️</span>' +
            '<span class="rob-text">Legacy report — no active maintainer.</span>';
        } else {
          var name = esc(NAMES[owner] || (owner.charAt(0).toUpperCase() + owner.slice(1)));
          bar.innerHTML = '<span class="rob-icon" aria-hidden="true">🛠️</span>' +
            '<span class="rob-text">Maintained by <span class="rob-agent">' + name + '</span>' +
            ' — route change requests to <span class="rob-to">' + name + '</span>.</span>';
        }
        document.body.insertBefore(bar, document.body.firstChild);
      })
      .catch(function () { /* network/parse failure → fail safe, no badge */ });
  })();

  /* 1.75) HUB PAGE SEARCH — live client-side filter over pages.json.
     Reachable from every page (the search box ships in the nav chrome). Matches
     title, category, owner, and tags. Keyboard: ↑/↓ move, Enter opens highlighted
     (or first) result, Esc closes/clears. Click opens. Graceful "no results".
     Data = the shared manifest fetch, so results always track the manifest. */
  (function initSearch() {
    var input = document.getElementById('hub-search-input');
    var panel = document.getElementById('hub-search-results');
    if (!input || !panel) return;                 /* nav variant without search */

    var OWNER_NAMES = {
      agentsmith: 'AgentSmith', dataops: 'DataOps', catalogsmith: 'CatalogSmith',
      adsmith: 'AdSmith', shopkeeper: 'Shopkeeper', themesmith: 'ThemeSmith',
      assetsmith: 'AssetSmith', hubsmith: 'HubSmith', brewsmith: 'BrewSmith',
      labsmith: 'LabSmith', searchsmith: 'SearchSmith'
    };
    var esc = function (str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    var rel = function (p) { return String(p || '').replace(/^\.?\//, ''); };

    var pages = [];      /* searchable records */
    var results = [];    /* current filtered list */
    var activeIdx = -1;  /* keyboard-highlighted result */
    var loaded = false;

    getManifest().then(function (data) {
      if (!data || !Array.isArray(data.pages)) return;
      pages = data.pages.map(function (p) {
        var owner = (p.owner || '').toLowerCase();
        var ownerName = OWNER_NAMES[owner] || owner;
        var tags = Array.isArray(p.tags) ? p.tags.join(' ') : '';
        return {
          path: rel(p.path),
          title: p.title || rel(p.path),
          icon: p.icon || '📄',
          category: p.category || '',
          owner: owner,
          ownerName: ownerName,
          archived: !!p.archived,
          /* precomputed lowercase haystack: title + category + owner(+name) + tags */
          hay: ((p.title || '') + ' ' + (p.category || '') + ' ' +
                owner + ' ' + ownerName + ' ' + tags).toLowerCase()
        };
      });
      loaded = true;
      if (document.activeElement === input && input.value.trim()) filter(input.value);
    });

    function setOpen(open) {
      panel.classList.toggle('open', open);
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function render() {
      if (!results.length) {
        panel.innerHTML = '<div class="sr-empty">' +
          (loaded ? 'No reports match.' : 'Loading…') + '</div>';
        setOpen(true);
        return;
      }
      var html = results.map(function (r, i) {
        var metaBits = [];
        if (r.category) metaBits.push('<span class="sr-cat">' + esc(r.category.replace(/-/g, ' ')) + '</span>');
        if (r.ownerName) metaBits.push(esc(r.ownerName));
        if (r.archived) metaBits.push('archived');
        return '<a class="sr-item' + (i === activeIdx ? ' sr-active' : '') +
          '" role="option" href="/teeccino-reports/' + esc(r.path) + '">' +
          '<span class="sr-title"><span aria-hidden="true">' + esc(r.icon) + '</span>' +
          esc(r.title) + '</span>' +
          '<span class="sr-meta">' + metaBits.join(' · ') + '</span></a>';
      }).join('');
      panel.innerHTML = html;
      setOpen(true);
    }

    function filter(qRaw) {
      var q = qRaw.trim().toLowerCase();
      activeIdx = -1;
      if (!q) { results = []; setOpen(false); panel.innerHTML = ''; return; }
      /* AND across whitespace-separated terms; each term is a substring match */
      var terms = q.split(/\s+/);
      results = pages.filter(function (p) {
        for (var i = 0; i < terms.length; i++) {
          if (p.hay.indexOf(terms[i]) === -1) return false;
        }
        return true;
      }).sort(function (a, b) {
        /* prefix-of-title matches rank first, then alphabetical */
        var ap = a.title.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        var bp = b.title.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.title.localeCompare(b.title);
      }).slice(0, 8);
      render();
    }

    function go(idx) {
      var r = results[idx];
      if (r) window.location.href = '/teeccino-reports/' + r.path;
    }

    input.addEventListener('input', function () { filter(input.value); });
    input.addEventListener('focus', function () {
      if (input.value.trim() && results.length) setOpen(true);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!results.length) return;
        activeIdx = (activeIdx + 1) % results.length; render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!results.length) return;
        activeIdx = (activeIdx - 1 + results.length) % results.length; render();
      } else if (e.key === 'Enter') {
        if (results.length) { e.preventDefault(); go(activeIdx >= 0 ? activeIdx : 0); }
      } else if (e.key === 'Escape') {
        if (input.value) { input.value = ''; filter(''); }
        else { setOpen(false); input.blur(); }
      }
    });
    /* Close when focus/click leaves the search widget */
    document.addEventListener('click', function (e) {
      var wrap = document.getElementById('hub-search');
      if (wrap && !wrap.contains(e.target)) setOpen(false);
    });
  })();

  /* 2) Dynamic body padding-top sync to actual nav height + 8px clearance. Adapts
     to any nav height (wraps, future nav additions, browser zoom) — replaces the
     brittle static 60px rule that clipped H1s on viewports below ~1700px. */
  var nav = document.getElementById('hub-nav-bar');
  if (!nav) return;
  var CLEARANCE = 8;
  function sync() {
    var h = nav.offsetHeight;
    if (h > 0) document.body.style.setProperty('padding-top', (h + CLEARANCE) + 'px', 'important');
  }
  sync();
  var pending = false;
  window.addEventListener('resize', function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; sync(); });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(nav);
})();
