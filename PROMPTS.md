# Building **Bulk** — what to paste into Claude Code

Work through these in order. **Do not skip ahead** — each stage depends on the one before, and stage 1 is the one that protects everything else.

After each stage, check the result yourself before moving on. `git commit` between stages.

---

## Before you start

1. Unzip the starter folder — it is already named `bulk`
2. Put your icon image in it at `assets/icon-source.png`
3. In Terminal: `cd` into the folder, then `git init && git add -A && git commit -m "Brief and docs"`
4. Open Claude Code in that folder

---

## Stage 1 — the maths

```
Read BUILD-BRIEF.md, then all four files in docs/.

Build only js/calc.js and test/calc.test.js. Nothing else yet — no UI, no
database, no HTML.

calc.js must be pure: inputs in, outputs out, no DOM, no storage, no Date.now().
Port the RPE table and the e1RM, prescribed-load and rounding logic from the
demo — it is correct, do not reinvent it.

Then run npm test and show me the output.
```

**Check before continuing:** the tests pass, and the RPE table matches the one in the brief. If the maths is wrong here, everything downstream inherits it and you will not notice for months.

---

## Stage 2 — the rest of the logic layer

```
Now build js/volume.js and js/progress.js with their tests, same rules —
pure functions only.

volume.js: fractional set counting and the whole-muscle roll-ups.
progress.js: rotation position, block position, pace and drift.

Assert in the tests that the shipped plan produces a chest roll-up of 33.5,
triceps 31.9, biceps 23.3 and back 28.1, and that speed bench contributes zero.

Run npm test and show me the output.
```

---

## Stage 3 — storage

```
Build js/db.js: the IndexedDB wrapper, the schema from the brief, and a
migration system with a format version. Include test/db.test.js covering a
v1 to v2 migration on a populated database.

Then build data/plan-bulk-v1.json from docs/bulk-plan.md and the data
structures inlined in docs/demo.html. Every exercise, every session, every
block, and the full knowledge base.
```

---

## Stage 4 — the Train screen

```
Build index.html, css/app.css, js/app.js and js/ui/train.js.

Match the demo's layout, copy and interaction exactly — it has been reviewed
and approved. Port the CSS.

Priorities in order: one-tap set confirmation, prefilled values from last
session, the accordion staying open when a set is ticked, direct numeric entry
alongside the steppers, and clear-prescribed leaving entered values untouched.

Then start a dev server, drive it with Playwright, and show me a screenshot at
390x844.
```

---

## Stage 5 — the other screens

```
Build ui/body.js, ui/progress.js, ui/plan.js, ui/settings.js and ui/charts.js.

Charts are inline SVG, no library. Build all of these: e1RM best-per-week,
bodyweight 7-day average with target band, waist, consistency heatmap,
load-rep scatter with iso-e1RM curves, strength vs bodyweight indexed to 100,
weekly session load, volume by muscle over time, PR timeline, block comparison.

Collapsible sections on Body, per the demo. Settings with the kg/lb toggle as
a display-only transform.

Screenshot each screen at 390x844 in light and dark and show me.
```

---

## Stage 6 — export and import

```
Build js/export.js and test/export.test.js.

Write the zip by hand — a minimal store-only writer, roughly 60 lines. Do not
add a dependency.

The test that matters: export, wipe the database, import, and deep-equal the
original data including photos. Show me it passing.
```

---

## Stage 7 — make it installable

```
Build manifest.webmanifest, sw.js and the icons.

The app is called Bulk. name and short_name are both "Bulk".

Generate the icons from assets/icon-source.png per the brief, including the
maskable variant with the 80% safe zone.

Version the service worker cache and delete old caches on activate. Show a
build version in Settings. IndexedDB data must survive an update — only the
shell is cached.

Then run a Lighthouse PWA audit and show me the result.
```

---

## Stage 8 — verification

```
Run the full verification protocol in BUILD-BRIEF.md.

Every automated behaviour check, the visual checks in both light and dark mode,
the unit tests, and Lighthouse. Use Playwright against a real browser.

Write the results to VERIFICATION.md with a pass or fail line for each item and
the screenshots in screenshots/.

Anything that fails, fix it and re-run. Do not report the app as finished with
known failures — I would rather it take another hour than find out in the gym.
```

**This is the stage people skip.** Do not skip it.

---

## Stage 9 — deploy

```
Give me the exact commands to push this to GitHub and enable GitHub Pages,
and tell me the URL it will be served from.
```

Then on your Android phone: open the URL in Chrome → menu → **Install app**. Accept the persistent-storage prompt.

---

## If something goes wrong

- **Tests fail and it keeps patching around them** — stop it, and ask it to explain why the test is failing before changing any code.
- **It suggests adding a library** — refuse. The brief forbids runtime dependencies, and every one of them is a future breakage.
- **A screen looks wrong** — screenshot it yourself, paste the image in, and say what is wrong. Far faster than describing it.
- **It says it is done** — ask for `VERIFICATION.md` and read it before you believe it.
