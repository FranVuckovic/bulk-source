# Build Brief — "Bulk"

**Paste this into Claude Code as your first message, in a folder containing `docs/`.**

---

## What this is

**The app is called Bulk.** A single-user training app for one lifter running one specific 33-week bench-focused bulk. It holds the plan, makes set logging fast enough that it actually gets used, and exports clean data.

No other users, no accounts, no server. Do not add flexibility to things that do not need it.

**Read these first, in `docs/`:**

| File | What it is |
|---|---|
| `bulk-plan.md` | The training plan. Source of truth for all content and reasoning. |
| `app-spec.md` | The agreed architecture and screen design. |
| `app-decisions.md` | Every feature decision, with what is in and what is deferred. |
| `demo.html` | **A working clickable prototype.** Reference for layout, copy, colour and interaction. Its `data.js`/`tips.js` content is inlined at the top of the `<script>` — lift it directly. |

The demo is not throwaway. Its data structures, RPE table, volume maths, copy and CSS are all correct — port them rather than reinventing them.

---

## Hard constraints — non-negotiable

- **Vanilla JavaScript, ES modules, no framework.** No React, no Vue, no Svelte, no bundler, no build step.
- **Zero runtime dependencies.** `package.json` exists only for the test runner and a static dev server.
- **PWA**: manifest + service worker, installable on Android, fully offline.
- **Storage: IndexedDB.** Request persistent storage on first launch.
- **No network calls at runtime, ever.** No APIs, no CDNs, no web fonts, no analytics.
- **All weights stored in kg.** Pounds is a display transform only.
- Must still run untouched in three years. Every dependency added is a future breakage.

## Do not build

Cloud sync · accounts or auth · Fitbit / Health Connect / scale integration · camera-based bar velocity · video storage (references only) · a plan-editor UI (plans are JSON files) · stock exercise photos · push notifications · plate calculator · side-by-side video comparison.

---

## File structure

```
/index.html
/manifest.webmanifest
/sw.js
/icons/            192, 512, maskable
/css/app.css
/js/
  app.js           bootstrap, routing, render
  db.js            IndexedDB wrapper + migrations
  calc.js          ALL maths. Pure functions. No DOM, no I/O, no Date.now().
  progress.js      rotation position, block position, pace
  volume.js        fractional set counting and roll-ups
  export.js        zip build / parse
  ui/train.js  ui/body.js  ui/progress.js  ui/plan.js  ui/settings.js
  ui/components.js  ui/charts.js   (inline SVG, no chart library)
/data/
  plan-bulk-v1.json
/test/
  calc.test.js  progress.test.js  volume.test.js  export.test.js  db.test.js
/docs/             the four files above
```

`calc.js`, `progress.js` and `volume.js` must be **pure** — inputs in, outputs out. That is what makes them testable, and the maths is the part that must never be silently wrong.

---

## Data model

```js
// plan JSON — data, never hardcoded
{
  format: 1,
  meta: { id, name, sub, startDateISO, rotation:['A'...'F'] },
  muscles:   { id: { label, lo, hi, grp, roll } },       // roll = whole-muscle rollup key
  exercises: { id: { name, tracksMax, maxConf:'high'|'ind',
                     m:{muscleId: weight}, how:[], why, subs:[], watch,
                     defaultRestSec, refPhotoId } },
  sessions:  [{ id, name, mins, purpose, key,
                slots:[{ ex, label, sets, reps, rpe, failLast,
                         idx, amrap, pctTop, lastHarder }] }],
  blocks:    [{ n, w, theme, top, vol, v, incline, cap,
                sessionTarget, changes:[] }],
  fallbacks: { fourDay:[], threeDay:[] },
  knowledge: [{ s, t, c }]                                // markdown-ish HTML
}
```

```
IndexedDB stores

sessionLogs  id, dateISO, startedAt, endedAt, sessionId, blockId,
             rotationIndex, bodyweight, sessionRpe, note, isPartial

sets         id, sessionLogId, exerciseId, setIndex, load, reps, rpe, rir,
             toFailure, isAmrap, isIndexSet, isMyoRep, velocity, note,
             wasPrescribed, prescribedLoad, timestampISO,
             gripWidth, variantUsed, pauseStyle      // comparability fields

daily        dateISO, bodyweight, bodyfatPct, sleepHours, steps, mood,
             caffeine, note

measurements dateISO, waist, chest, shoulders, armL, armR, quadL, quadR,
             neck, note

media        id, dateISO, kind:'physique'|'formcheck'|'refphoto',
             exerciseId, load, reps, note, imageBlob, fileRef

niggles      id, dateISO, site, severity(1-3), context, note

maxes        exerciseId, workingMax, conf, setAtISO, sourceSetId, blockId

settings     unit, increment, lastBackupISO, formatVersion
```

**Always store date AND time.** `startedAt`/`endedAt` gives session duration free — that is the instrument that catches rushing.

**Never store derived values.** e1RM, rolling averages, volume totals, PRs and flags are computed on read.

---

## The maths — implement exactly

### RPE → %1RM (Tuchscherer/Helms). Copy the table from the demo.

Reps 1–12 × RPE 6–10. Interpolate between RPE columns for half-points. Snap the rep count to the nearest tabulated row.

- `e1rm(load, reps, rpe)` → `load / (pct(reps,rpe)/100)`. **Return null above 12 reps.**
- Missing RPE → Epley fallback, flagged low-confidence.
- `rpeFor(ratio, reps)` → inverse lookup, for effective-RPE display after rounding.

### Prescribed load

```
ideal   = workingMax * pct(targetReps, targetRpe) / 100
if slot.pctTop:  ideal = roundKg(workingMax * pct(1,8)/100) * slot.pctTop
if slot.amrap:   ideal = workingMax * 0.83
rounded = roundToNearest(ideal, settings.increment)   // default 2.5 kg
effRpe  = rpeFor(rounded / workingMax, targetReps)
```

Display `"92.5 kg · RPE ~8.05"`. Manual override always allowed; store both `prescribedLoad` and actual `load`.

### Working max protocol — the rule that matters most

Two distinct numbers per exercise:

- **observed e1RM** — computed from index sets. Continuous history. Never overwritten.
- **workingMax** — drives prescriptions. **Changes only at block boundaries.**

```
Block end:  propose workingMax = best observed e1RM from that block's index sets
            → requires explicit user confirmation, never silent
Mid-block:  bump early ONLY if observed > workingMax * 1.05 for two consecutive weeks
Never lower mid-block.
At a block boundary it MAY lower, by at most 5%, and must say so prominently.
Deload sessions never trigger an update.
```

**Why (put this in a code comment):** 1RM test–retest CV is ~3.3%, so a 130 kg bench carries ±4 kg of noise. Updating on every good session ratchets loads upward on noise and silently moves real effort from RPE 8 to 9.5.

**Confidence.** Every exercise stores a max, but `maxConf` is `'high'` (low-rep compounds) or `'ind'` (isolation — formula error grows sharply past ~10 reps and prediction equations are known to fail on isolation work). **Indicative maxes prescribe loads but must never appear in progress charts or PR claims.**

### Rotation and block position

```
nextSession   = rotation[(rotation.indexOf(lastLoggedSession) + 1) % 6]
              // sessions sorted by DATE, not entry order (back-dating must work)
blockDone     = sessions logged since the block started
blockAdvance  = blockDone >= block.sessionTarget  → opens block review, never auto-advances
pace          = sessionsDone / (daysElapsed / 7)
drift         = blockDone/sessionTarget - (daysElapsed/7)/6   // < -0.12 → warn
isPartial     = fewer than 50% of prescribed sets logged
```

**Blocks advance on sessions completed, not on dates** — a block is an amount of training, not an amount of time. The calendar is tracked alongside purely as a pace check, because the March target is a real date.

### Volume

Fractional sets: `sets × weight` per muscle, weights from `exercise.m`. Weights below 0.3 are excluded from the data entirely. **Speed bench has an empty `m` and contributes zero.**

Roll-ups: sum by `muscle.roll` (Chest, Triceps, Biceps, Back, Core). The ~20-sets-per-week literature uses whole-muscle units, so both views must be shown. Only claim "past diminishing returns" when the roll-up is genuinely ≥20.

Frequency counts sessions where a muscle receives a contribution ≥0.5.

---

## Screens

Four tabs — **Train · Body · Progress · Plan** — plus Settings behind a gear icon. The demo shows all of them working; match its structure and copy.

**Train.** Opens on the next session in the rotation, override available. Prescribed loads auto-calculated. Last session's numbers prefilled. One tap confirms an unchanged set. Accordion per exercise that **stays open when you tick a set**. Per set: load, reps, RPE, to-failure and AMRAP flags, velocity, note — plus e1RM shown under each logged set. Add exercise, swap exercise (substitutes first), add set, clear-prescribed (**must not clear values you entered**), and the exercise's About page. Rest timer auto-set from the exercise. Finish-session warns on empty values and saves blanks as blank, never zero.

**Body.** Daily block (weight, bodyfat, sleep, steps, mood, caffeine) and weekly block (seven measurement sites). Physique photos stored in-app, compressed to ~1080 px JPEG. Form-check videos by filename reference only. Structured niggle log. Every field optional, with the same empty-value confirmation.

**Progress.** Stat tiles, decision flags, and these charts: e1RM best-per-week · bodyweight 7-day average with target band · waist · **consistency heatmap** · **load–rep scatter with iso-e1RM curves** · **strength vs bodyweight indexed to 100** · **weekly session load (sRPE × duration)** · volume by muscle over time · PR timeline · block comparison. Working-maxes table with the refresh review. Selective export.

**Plan.** Plan picker → "Where you are" card → three sections: **Exercises** (all, with muscles/why/how/substitutes/reference photo slot/max confidence), **Workouts** (all six with per-session muscle stimulus), **General tips** (the knowledge base). Plus weekly stimulus charts with roll-ups, and the expandable block progression.

**Settings.** kg/lb toggle (display only), load increment, storage status, backup age, export/import, **verify-backup-restores**, privacy statement, erase-all behind a typed confirmation.

---

## Export

One zip. Selective by date range and content type.

```
meta.json · plan.json · sets.csv · sessions.csv · daily.csv ·
measurements.csv · niggles.csv · media.csv · maxes.csv · photos/
```

CSV for humans and Excel, JSON for lossless restore, `format` version in `meta.json`. Write a minimal store-only zip writer by hand (~60 lines) rather than taking a dependency. Import restores from the same zip and is also how data moves between phone and laptop.

---

## Tests — non-negotiable

Node's built-in `node:test`. No framework.

- RPE table at every tabulated point, plus interpolation
- `e1rm` round-trips · null above 12 reps · Epley fallback flagged
- Prescribed load: rounding at 2.5 and 1.0 · `pctTop` · `amrap` · effective-RPE inverse
- **Working max: block-boundary update · the 5%-for-two-weeks exception · never lowers mid-block · deloads excluded**
- **Rotation: next-session after back-dated entries · manual override · partial sessions**
- **Block advance: session-count driven · drift calculation**
- Volume: fractional counting · roll-ups · speed bench contributes zero
- Rolling averages and regression slope vs hand-computed fixtures
- PR detection including ties, and that `maxConf:'ind'` lifts are excluded
- **Export → import → deep-equal the original**
- DB migration v1 → v2 with a populated database

A silently wrong e1RM would corrupt months of training decisions before either of us noticed. That is why this section exists.

---

## Build order

1. `calc.js` + tests. Nothing else until green.
2. `volume.js`, `progress.js` + tests.
3. `db.js` + migrations + tests.
4. Plan JSON, built from `docs/bulk-plan.md` and the demo's `data.js`.
5. **Train screen** — highest-friction surface, get it right first.
6. Body screen.
7. Progress screen + charts.
8. Plan screen + knowledge base.
9. Export/import + tests.
10. PWA shell: manifest, service worker, icons, persistent-storage request.

## Service worker — get this right

Version the cache (`bench-v1`, `bench-v2`…). On activate, delete old caches. **Never cache-first the app shell without a version bump path**, or a future update will never reach the phone. IndexedDB data must survive every update — only the shell is cached.

Add a visible build version in Settings so it is obvious whether an update landed.

## App icon

The owner will place his own image at `assets/icon-source.png` (or `.jpg`) before the PWA step.

Generate `icons/icon-192.png`, `icons/icon-512.png` and `icons/icon-maskable-512.png` from it. On macOS use the built-in `sips` so nothing has to be installed:

```bash
mkdir -p icons
sips -s format png -z 192 192 assets/icon-source.png --out icons/icon-192.png
sips -s format png -z 512 512 assets/icon-source.png --out icons/icon-512.png
```

For the maskable version, Android crops to a circle — the important content must sit inside the middle 80%. Composite the source at 80% scale onto a 512×512 canvas filled with the app's dark surface colour (`#1a1a19`). If `sips` alone cannot do the composite, use a tiny one-off Node script with a canvas written by hand, or ImageMagick if it happens to be installed. Do not add a runtime dependency for this.

Reference all three in `manifest.webmanifest` with correct `sizes` and `purpose` (`any` for the first two, `maskable` for the third).

Manifest values:

```json
{
  "name": "Bulk",
  "short_name": "Bulk",
  "description": "Training tracker",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#1a1a19",
  "background_color": "#0d0d0d",
  "start_url": "./"
}
```

The `<title>` is `Bulk`, and the header on the Train screen says `Bulk` where the demo says `Train` — keep the tab labels as they are.

If the source image is missing when you reach this step, generate a plain placeholder icon and say so clearly — do not block the build.

---

## Verification — do this before telling the owner it is finished

**Do not report the app as working until every check below has actually been run and passed.** Write the results into `VERIFICATION.md` with a pass/fail line for each item. If something fails, fix it and re-run rather than noting it as a known issue.

Install Playwright as a **dev dependency only** and drive a real browser.

### Automated behaviour checks

1. App loads with **zero console errors and zero unhandled rejections** on every tab.
2. Every tab and every sub-section renders without throwing, including all Plan sub-sections and Settings.
3. **Log a set → reload the page → the set is still there.** This is the single most important check.
4. **Log a full session → finish it → reload → it appears in history and the rotation has advanced by one.**
5. **Back-date a session** to before the previous one; confirm rotation order is computed by date, not entry order.
6. **Block does not auto-advance** when the session target is reached — the review screen appears and requires confirmation.
7. **kg → lb → kg round-trips exactly.** Assert stored values are byte-identical afterwards; a rounding drift here is a silent data bug.
8. **Clear-prescribed removes only untouched prescribed values** and leaves anything the user entered.
9. **Ticking a set does not collapse the exercise.**
10. **Finishing a session with unlogged sets shows the confirmation**, and saving stores blanks as null — never 0.
11. **Export → import into an empty database → deep-equal the original data**, photos included.
12. **Offline:** load the app, go offline, hard-reload — it must still work fully.
13. **Persistent storage** is requested and the result is reported in Settings.
14. **Service worker update path:** bump the cache version, reload twice, confirm the new build number appears in Settings and IndexedDB data survived.
15. Working-max rule: simulate a block of index sets and assert the proposed max, the 5%-for-two-weeks exception, and that it never lowers mid-block.
16. Volume maths: assert the weekly totals match the demo's figures for the shipped plan (chest roll-up 33.5, triceps 31.9, biceps 23.3, back 28.1).

### Visual checks

Screenshot every screen at **390×844**, in **both light and dark mode**, and actually look at each one. Check for text overflow, overlapping elements, collapsed flex children, unreadable contrast, and tap targets under 40px. Save them to `screenshots/` and reference them in `VERIFICATION.md`.

### Unit tests

`npm test` must pass with everything listed in the Tests section above. Report the count.

### Lighthouse

Run a Lighthouse PWA audit. Installability must pass. Report the score.

---

## Style

Small modules, pure functions, no clever abstractions. This will be read by someone returning after eighteen months with no context. Comment the *why* — especially the working-max rule, the RPE table, and the session-count block model — never the *what*.
