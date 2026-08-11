# Publishing to teeccino-reports

Conventions for any agent that writes a dashboard into this repo. Maintained by **HubSmith**
(site chrome, IA, manifest). Page *content* belongs to whoever generates it.

---

## 1. Register every page in `pages.json`

A page that isn't in the manifest is an **orphan**: it gets no hub card, no top-nav entry, no
"Maintained by ___" owner badge, and it doesn't appear in hub search. Those three surfaces all
read `pages.json` at runtime, so an unregistered page is invisible in more ways than it looks.

```python
import sys; sys.path.insert(0, r"C:\Users\JustinAdler\clawd-hubsmith\skills\manifest-curator")
from hub_register import register_page

register_page(
    path="my-dashboard.html",
    title="My Dashboard",
    description="One sentence. Shows on the hub card and in search.",
    category="marketing-ads",     # see CATEGORIES.md — locked set
    owner="adsmith",              # YOUR agent id, not whoever commits
    icon="📊",
)
```

Idempotent upsert keyed on `path`. Safe to call on every build.

## 2. Set `owner` to yourself, and keep it true

`owner` is the **only** reliable attribution signal in this repo — see §4. It drives the owner
badge and decides who gets dispatched when the page breaks. If ownership of a generator moves
between workspaces, re-register the page in the same change. A stale `owner` sends real work to
the wrong agent (this happened: `creatives.html` said `dataops` for 3.5 months after AdSmith took
the builder).

## 3. Commit discipline — stage, commit, *then* run the MC builder

Every agent runs `build_mission_control.py` after each task. It publishes through
`reports_push.publish()`, which commits a fixed pathspec. Historically it fell back to a bare
`git commit` that swept up **anything another agent had left staged** — publishing drafts and
erasing commit messages. That was fixed 2026-08-11, but the ordering rule costs nothing and
protects you if it ever regresses:

> **Stage → commit → then run the MC builder.** Never leave work staged across an MC run.

Also: pushes are debounced ~600s to protect the GitHub Pages deploy queue. Commits are local and
free; pushes coalesce. Don't override the debounce — a forced push can cancel a queued deploy.

## 4. Attribute yourself on commits

This repo has a **shared working copy** — roughly ten agents commit through it, so per-agent git
config is impossible. The local identity is a neutral default:

```
Teeccino Agent Guild <justina@teeccino.com>
```

Until 2026-08-11 it read `CatalogSmith`, which authored **499 of the last 500 commits** regardless
of who made them. Existing history was left untouched, so:

> **`git blame` and `git log --author` are meaningless for attribution in this repo.**
> Use `pages.json` `owner`.

To attribute your own commits going forward, pass your name per-commit:

```bash
git -c user.name="AdSmith" commit -m "Rebuild creative library"
```

## 5. Don't rewrite a timestamp you didn't change

If your generator rewrites a `Built <ISO>` stamp on every run, its page is **permanently dirty**
in `git status`. In a shared repo that trains every agent to ignore `git status` — the one check
that defends against §3. Skip the write when only the stamp differs.

## 6. Chrome is HubSmith's, bodies are yours

Top nav, footer, breadcrumbs, shared CSS, the hub index and `pages.json` structure are HubSmith's.
Your page's body, charts and data are yours — HubSmith won't touch them. Need a chrome change?
Ask; don't hand-edit the nav into your generator's template.

Hardcoded nav links rot. `kpi.html`, `home.html` and 14 root `YYYY-MM.html` pages were archived
2026-08-11 and now 404; generators that hardcoded them shipped dead links for months.

## 7. Expect to be checked

- `dead_link_scan.py` — every internal link resolves (excludes `_archive/`)
- `staleness_audit.py` — flags pages whose generator has silently stopped, pages whose newest
  commit is a sweep rather than a rebuild, and generators no runner invokes
- `check_site_freshness.py` (AgentSmith) — daily SLA check against a curated `CADENCE` list;
  ask to be added if your page refreshes on a schedule
- orphan scan — runs on every hub rebuild

---
*Maintained by HubSmith. Full detail: `clawd-hubsmith/CLAUDE.md` and `CATEGORIES.md`.*
