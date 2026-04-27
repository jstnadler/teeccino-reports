/* ====================================================================
   provenance-banner.js
   Renders the Data Provenance banner from window.PROVENANCE_CONFIG.
   See provenance-banner.css for usage example. Owner: CatalogSmith.
   ==================================================================== */
(function () {
  "use strict";

  function freshnessFromIso(iso) {
    if (!iso) return { label: "unknown", cls: "unknown", days: null };
    var t = Date.parse(iso);
    if (isNaN(t)) return { label: "unknown", cls: "unknown", days: null };
    var hours = (Date.now() - t) / 36e5;
    var days = hours / 24;
    if (hours < 24)  return { label: "fresh (today)",      cls: "fresh",  days: days };
    if (days  < 3)   return { label: "fresh ("  + Math.round(days) + "d ago)",  cls: "fresh",  days: days };
    if (days  < 7)   return { label: "aging ("  + Math.round(days) + "d ago)",  cls: "aging",  days: days };
    if (days  < 30)  return { label: "stale ("  + Math.round(days) + "d ago)",  cls: "stale",  days: days };
    return { label: "stale (" + Math.round(days) + "d ago)", cls: "stale", days: days };
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "class") e.className = attrs[k];
        else if (k === "html") e.innerHTML = attrs[k];
        else if (k === "text") e.textContent = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (children) children.forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function render(cfg) {
    if (!cfg || !cfg.master) return null;

    var fresh = freshnessFromIso(cfg.master.lastUpdated);
    var rowsLine = (typeof cfg.master.rowCount === "number")
      ? (cfg.master.rowCount.toLocaleString() + (cfg.master.rowGrain ? " " + cfg.master.rowGrain + " rows" : " rows"))
      : "";

    var summaryParts = [
      el("span", { class: "prov-icon", text: "📋" }),
      el("span", { class: "prov-label", text: (cfg.master.label || "Master") + ":" }),
      el("code",  { text: cfg.master.path || "(unspecified)" })
    ];
    if (rowsLine) {
      summaryParts.push(el("span", { class: "prov-meta", html: "<span class='prov-label'>•</span> " + rowsLine }));
    }
    summaryParts.push(el("span", { class: "prov-fresh " + fresh.cls, text: fresh.label }));

    // -- Sources / pipeline / feedsInto detail panel ----------------------
    var detail = el("details");
    detail.appendChild(el("summary", { text: "data sources" }));

    var flow = el("div", { class: "prov-flow" });

    if (cfg.sources && cfg.sources.length) {
      var col = el("div");
      col.appendChild(el("h4", { text: "Sources flowing in" }));
      var ul = el("ul");
      cfg.sources.forEach(function (s) {
        ul.appendChild(el("li", {
          html: "<strong>" + (s.name || "?") + "</strong>" +
                (s.flow ? " <span class='prov-flow-detail'>— " + s.flow + "</span>" : "")
        }));
      });
      col.appendChild(ul);
      flow.appendChild(col);
    }

    if (cfg.pipeline && cfg.pipeline.length) {
      var col = el("div");
      col.appendChild(el("h4", { text: "Pipeline" }));
      var ul = el("ul");
      cfg.pipeline.forEach(function (step) {
        ul.appendChild(el("li", { html: "<code>" + step + "</code>" }));
      });
      col.appendChild(ul);
      flow.appendChild(col);
    }

    if (cfg.feedsInto && cfg.feedsInto.length) {
      var col = el("div");
      col.appendChild(el("h4", { text: "Feeds into" }));
      var ul = el("ul");
      cfg.feedsInto.forEach(function (f) {
        ul.appendChild(el("li", {
          html: "<strong>" + (f.target || "?") + "</strong>" +
                (f.role ? " <span class='prov-flow-detail'>— " + f.role + "</span>" : "")
        }));
      });
      col.appendChild(ul);
      flow.appendChild(col);
    }

    if (cfg.owner || cfg.lastModifiedBy) {
      var col = el("div");
      col.appendChild(el("h4", { text: "Owner" }));
      var ul = el("ul");
      if (cfg.owner)          ul.appendChild(el("li", { html: "<strong>" + cfg.owner + "</strong>" }));
      if (cfg.lastModifiedBy) ul.appendChild(el("li", { html: "Last modified by <strong>" + cfg.lastModifiedBy + "</strong>" }));
      col.appendChild(ul);
      flow.appendChild(col);
    }

    detail.appendChild(flow);

    var banner = el("div", { class: "prov-banner" }, summaryParts.concat([detail]));
    return banner;
  }

  var bannerEl = null;

  function mount() {
    var cfg = window.PROVENANCE_CONFIG;
    if (!cfg) {
      console.warn("[provenance-banner] window.PROVENANCE_CONFIG not set; banner not rendered.");
      return;
    }
    bannerEl = render(cfg);
    if (!bannerEl) return;

    // Mount in #provenance-mount if present, else as the first body child.
    var mountPoint = document.getElementById("provenance-mount");
    if (mountPoint) {
      mountPoint.appendChild(bannerEl);
    } else {
      document.body.insertBefore(bannerEl, document.body.firstChild);
    }
  }

  // Public API — pages can refresh freshness + row count once their data loads.
  // Example:
  //   ProvenanceBanner.update({ lastUpdated: payload.generated_at, rowCount: payload.products.length })
  window.ProvenanceBanner = {
    update: function (patch) {
      if (!window.PROVENANCE_CONFIG) return;
      window.PROVENANCE_CONFIG.master = window.PROVENANCE_CONFIG.master || {};
      if (patch.lastUpdated !== undefined) window.PROVENANCE_CONFIG.master.lastUpdated = patch.lastUpdated;
      if (patch.rowCount    !== undefined) window.PROVENANCE_CONFIG.master.rowCount    = patch.rowCount;
      if (patch.rowGrain    !== undefined) window.PROVENANCE_CONFIG.master.rowGrain    = patch.rowGrain;
      // Re-render in place
      if (bannerEl && bannerEl.parentNode) {
        var newEl = render(window.PROVENANCE_CONFIG);
        if (newEl) {
          bannerEl.parentNode.replaceChild(newEl, bannerEl);
          bannerEl = newEl;
        }
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
