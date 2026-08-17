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

## Sample data

To see the app with history in it — every chart, the block review, prescriptions
calculated from previous sessions — open **http://localhost:8123/dev/sample-data.html**
and press *Load five weeks of sample data*, then go back to the app.

`dev/` is a development tool, not part of the app: it writes to the same database
the app uses, and the same page erases it again. Everything it writes is invented.
Erase it before logging anything real.
