# Bulk

Personal training app for a 33-week bench-focused bulk.
Vanilla JS PWA — no framework, no dependencies, no network access.

Start with `AGENTS.md` and `CLAUDE.md` for the current handoff and working
rules. `docs/product-audit-v2.5.md` records the latest product audit;
`VERIFICATION.md` distinguishes automated evidence from real-browser evidence.
`BUILD-BRIEF.md` and the remaining files in `docs/` hold the original product
and training rationale.

## Running it

```bash
npm run serve
```

Then open **http://localhost:8123**.

It has to be served over HTTP. Opening `index.html` directly gives you a
`file://` page, and browsers block it from loading the plan JSON.

```bash
npm test
```

runs the complete Node test suite. The app itself has zero runtime
dependencies.

## Demo data

The app has a built-in, isolated demo mode. It uses a separate IndexedDB
database, so exploring the demo cannot read or modify the real training log.

The older development-data loader remains available at
**http://localhost:8123/dev/sample-data.html** for targeted verification. It
writes generated data into the normal local development database and clears it
first, so use it only in a disposable browser profile.

## Repositories

- `bulk-source` is the source of truth: source, tests, documentation and history.
- `bulk` is generated publishing output for GitHub Pages. Never edit it directly.

Both repositories are currently public. Public access lets a reviewer read and
clone them; it does not grant permission to push.

Publishing is destructive and outward-facing. Read `CLAUDE.md` and
`dev/publish.sh`, run the full verification protocol, and ask before publishing.
