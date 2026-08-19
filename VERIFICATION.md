# Bulk v2 — verification

**Build:** `sw.js` VERSION `v2.1.0` · database v3 · plan format 3 · plan `fopip-v2`
**Verified:** 19 August 2026
**Method:** 206 automated tests, plus a manual pass in a 390 × 844 viewport in
both colour schemes against twelve rotations of generated history.

v1 is archived at `archive/v1/` and tagged `v1.0`. It still runs and still
reads a v1 export.

---

## How to reproduce this

```bash
npm test
```

```bash
npm run serve
```

Then open `http://localhost:8123/dev/sample-data.html`, press **Load twelve
rotations of sample data**, and open `http://localhost:8123/`.

The sample data resolves every session through the same plan engine the Train
screen uses, so what it writes is what the app would have prescribed on that
rotation. It deliberately crosses three blocks, leaves the last rotation
part-finished, skips one session mid-rotation and includes two
yellow-readiness days, because those are the states that used to be reachable
only by hand.

The offline shell is switched off on `localhost` so edits are visible without a
version bump. To exercise the update path itself, open `http://localhost:8123/?sw=1`.

---

## Automated

| Suite | Tests | What it holds down |
|---|---|---|
| `calc.test.js` | 48 | The RPE table, e1RM and its confidence, rounding, prescriptions, the working-max rule and its exceptions |
| `db.test.js` | 26 | Migrations with backfill, idempotent writes under a real race, atomic session start and finish, cascade and soft delete |
| `progress.test.js` | 25 | Rolling averages, slopes, records, decision flags, deload triggers |
| `plan.test.js` / `plan-engine.test.js` | 33 | The plan file itself, and that all 33 × 6 rotations resolve |
| `volume.test.js` | 15 | Fractional sets, head against whole-muscle counting, planned versus completed |
| `export.test.js` | 14 | Zip round-trip with CRC, staged validation, atomic apply, content verification |
| `analytics.test.js` | 12 | Every metric the Progress screen renders, including the four v1 defects |
| `cycle.test.js` | 11 | Rotation progress, partial and skipped positions, corrections, projection |
| `performance.test.js` | 6 | 200 sessions and 6,000 sets against explicit budgets |
| `recovery.test.js` | 5 | Soft delete, restore, the bin listing, and refusing stores it cannot recover |
| `photos.test.js` | 4 | Orientation-independent fitting and size formatting |
| `shell.test.js` | 6 | The offline shell covers the module graph, and the app calls the safe paths rather than merely containing them |

**206 passing, 0 failing**, about 0.6 s.

`shell.test.js` exists because two of the defects found during this pass were
not wrong code but unused code. `js/photos.js` was imported by the Body screen
and absent from the precache list, so the app would have worked everywhere
except offline. `startSessionAtomic` was written and tested and then not
called: `ensureActiveLog` wrote the log and the active pointer separately, so
five taps in one turn of the event loop opened five sessions for the same slot.
A test that only exercises a function cannot catch either.

The performance suite is the one that will catch a regression silently: it
builds 200 sessions and 6,000 sets and asserts that block comparison across
every tracked lift finishes inside 1.5 s. The v1 implementation was quadratic —
a `logs.find` inside a `sets.find` inside a loop over every point of every lift —
and at this size that is tens of millions of comparisons.

---

## Manual

Each of these was checked in the browser against the sample database, in both
colour schemes at 390 × 844.

### The maths says what it means

- **Gain rate.** The verdict quotes the real band and says which side of it the
  rate sits on. With sample data at 0.50 kg/week in calendar week 14 it reads
  *"Gaining faster than the band. 0.50 kg/week against a 0.2–0.25 kg/week target
  for week 14"* — and, because 0.50 is inside the plan's own action thresholds
  of 0.1 and 0.6, the advice is to wait rather than to cut calories. v1 called
  the same number "on target" while printing the band it was outside.
- **Four-week change.** *"Up 6.7 kg in 5 weeks. From 118.8 on 2026-07-16 to
  125.4 on 2026-08-18."* Both ends are real index sets. v1 subtracted the value
  four points ago from the all-time best.
- **Block comparison.** Rows are first-to-last in date order and every tracked
  lift gets its own bar; the Baseline block shows −10.8 kg on the bench rather
  than converting the regression into a gain.
- **The goal is kilograms.** *"140 kg bench in 9–17 weeks"* — a range, in
  kilograms, whatever the display unit is set to.
- **Evidence is attached.** Every verdict carries its sample count, span and
  fit: *"(12 readings over 93 days, a good fit)"*.

### Charts

- Points are spaced by date, so a gap looks like a gap; month ticks sit on the
  axis.
- Every point answers a tap — verified on the estimated-1RM chart, which
  returns `2026-06-10 · rotation 4 · 107.5×1 @8 → 116.6 kg`. There is no hover
  on the device this runs on, so an SVG `<title>` would be an invisible tooltip.
- The bodyweight target is a corridor anchored at the start of the phase whose
  band it draws, not a strip painted around the latest reading.
- Volume is grouped per rotation, not per calendar week, and the
  planned-against-logged bars are counted with the same ruler on both sides.
- Records are concrete categories with dates and the set behind them, and
  bodyweight lifts say so: *"+5.0 × 10, 95.0 kg with bodyweight"*.

### Data

- **Export round-trip.** 1.7 MB zip, 8 photo files, `verifyAgainst` clean,
  `validateImport` clean.
- **Import is atomic and real.** With `measurements` deliberately emptied, the
  staged import restored all 14 rows, 1,817 sets and 26,417 bytes of image data
  in one transaction, and verification passed against the restored database.
- **Deletion is recoverable.** Deleting session D of rotation 12 removed it from
  every chart, put it in *Recently deleted*, and one tap restored it — as a
  *partial* session, not promoted to complete.
- **The bin is the only thing that destroys.** Settings → Empty the bin, behind
  two confirmations and an offered backup.

### Sessions and rotations

- **A session opens once, however fast you tap.** Five ticks fired in the same
  turn of the event loop produce one session log and five sets. Before the fix
  they produced four session logs.
- **Finishing writes a real end state.** 14 of 27 sets → `status: complete`,
  `completionRatio: 0.52`, `prescribedSets: 27`, `loggedSets: 14`, active
  pointer cleared, and the next position reported: *"Next in the rotation: F ·
  1 still to do in rotation 12."*
- **A finished rotation can be advanced from the cycle card, not only from the
  save dialog.** Completing all six offers *Start rotation 13*; taking it closes
  rotation 12 as `complete` with an end date, creates rotation 13 with the right
  block and effort mode, and moves the next session to A. Dismissing the save
  dialog no longer strands the offer.

### Training rules

- **The AMRAP cannot be faked.** Ticking the AMRAP row writes **zero** sets and
  opens the rep editor. Confirmed by counting rows in IndexedDB either side of
  the tap: 1,817 before, 1,817 after.
- **Readiness trims the session.** A red day drops session A from 26 sets to 19
  and removes the AMRAP and any hold.
- **Bodyweight lifts are never prescribed a negative plate.** Ten reps at RPE 8
  off a 122 kg pull-up max works out below 90 kg of bodyweight; the app now says
  *bodyweight only* and names the rep range as the difficulty, instead of
  prescribing −7.5 kg and writing an impossible value into the export.

### The shell

- No console errors and no CSP violations on any screen.
- The service worker serves the whole shell from one versioned cache, so a
  half-updated app is not reachable; a new build waits and is applied by a tap,
  and warns first if a session is open.
- A second tab takes the pen and the older one says so rather than racing it.

---

## Known limits

**The sample data is not real training.** Loads follow the plan's own
prescriptions with a fixed growth rate and no bad days, so the trend lines are
tidier than a real log will ever be. It is there to exercise the code, not to
demonstrate a result.

**Photo decoding depends on the browser.** An iPhone HEIC that Chrome cannot
decode is reported as a readable error rather than silently skipped, but it is
still not imported. Sharing it as JPEG works.

**`frame-ancestors` is not set.** It cannot be delivered from a meta tag, and
GitHub Pages does not let you add response headers. Everything else in the
policy is enforced.

**One tab is advisory.** The database is safe regardless — `logicalKey` and
`operationId` are unique indexes, so nothing can be written twice. What the tab
lock adds is the warning, and it needs `BroadcastChannel`.
