# Bulk

Personal training app for a 33-week bench-focused bulk.
Vanilla JS PWA — no framework, no dependencies, no network access.

Start with `PROMPTS.md`. It tells you exactly what to do, in order.
`BUILD-BRIEF.md` is what Claude Code reads; the four files in `docs/`
are the reference material.

Put your app icon at `assets/icon-source.png` before stage 7.

## Running it

```bash
npm run serve
```

Then open **http://localhost:8123**.

It has to be served over http. Opening `index.html` straight from Finder gives
you a `file://` page, and browsers block those from loading the plan JSON — the
app will tell you so rather than sitting there dead.

```bash
npm test
```

runs the maths tests. No dependencies are installed for either command.
