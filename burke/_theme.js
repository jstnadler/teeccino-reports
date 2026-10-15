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
