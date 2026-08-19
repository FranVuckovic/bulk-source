# Bulk v2 — verification

**Build:** `sw.js` VERSION `v2.3.0` · database v3 · plan format 3 · plan `fopip-v2`
**Verified:** 19 August 2026
**Method:** 267 automated tests, plus a driven pass in a real Chromium at
390 × 844 against twelve rotations of generated history.

v2.2.0 adds demo mode, the five-section navigation, the repair tools and the
version display. Everything below marked **v2.2.0** was verified by driving the
built app in a browser rather than by reading the code.

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

Then either turn on **demo mode** in Settings, or open
`http://localhost:8123/dev/sample-data.html` and press **Load twelve rotations
of sample data** — they run the same generator and both write to the *demo*
database, never to the real one.

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
| `plan-engine.test.js` | 16 | That all 33 × 6 rotations resolve, and what readiness does to them |
| `volume.test.js` | 15 | Fractional sets, head against whole-muscle counting, planned versus completed |
| `export.test.js` | 14 | Zip round-trip with CRC, staged validation, atomic apply, content verification |
| `analytics.test.js` | 13 | Every metric the Progress screen renders, including the four v1 defects |
| `plan.test.js` | 17 | The plan file's own shape and rules |
| `cycle.test.js` | 11 | Rotation progress, partial and skipped positions, corrections, projection |
| `shell.test.js` | 12 | The offline shell covers the module graph, and the app calls the safe paths rather than merely containing them |
| `service-worker.test.js` | 7 | The takeover rule, and that no branch can answer a module request with the shell |
| `performance.test.js` | 6 | 200 sessions and 6,000 sets against explicit budgets |
| `recovery.test.js` | 6 | Soft delete, restore, the bin listing, that a cascade-deleted set is not listed apart from its session, and refusing stores it cannot recover |
| `screens.test.js` | 18 | Every screen *and every section behind a tab* on an empty database, and at both ends of every block, with no arithmetic leaking into the page |
| `timing.test.js` | 13 | Rest and duration from the stored tick times, and every case where they must not be reported |
| `readiness.test.js` | 4 | The four defects reachable by flagging a day part-way through a session |
| `timer.test.js` | 6 | That the rest timer reads correctly across a gap with no ticks delivered at all |
| `duration.test.js` | 6 | How long a session takes with its warm-up ramps counted |
| `photos.test.js` | 4 | Orientation-independent fitting and size formatting |

**267 passing, 0 failing**, about 1 s.

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
  half-updated app is not reachable.
- **The update flow, end to end on the live site.** With v2.1.0 controlling and
  v2.1.1 published: the banner appeared, *Update now* reloaded the page once,
  the old cache was deleted, and the banner did not come back. It warns first
  if a session is open.
- **Taking over from v1.** Registered the archived v1 worker on a clean origin,
  let it take control, then registered v2.1.1: it activated without waiting,
  claimed the page and dropped the old cache. This is not a nicety — v1's
  worker answered any failed fetch with `index.html`, including a request for a
  JavaScript module, which Chrome refuses to run as `text/html`. On a device
  holding it, the app rendered its header and tab bar and nothing else, and had
  no way to say why: the module that reports errors was one of the ones that
  failed to load.
- A second tab takes the pen and the older one says so rather than racing it.

### What happens if the site goes away

Tested by taking the origin down under a running install, because the app is
served from a repository that may be made private again.

- **The site returning 404 does not unregister the worker.** Forced an update
  check against a missing `sw.js`: the check failed with a 404, and the
  registration, the active worker and all 27 cached files survived intact.
- **The origin disappearing entirely does not stop the app.** With the server
  stopped, a full reload rendered the whole app from cache — plan, rotation
  position, twelve rotations of history — and logging a set still wrote to
  IndexedDB. Every shell file is served cache-first, so the network is a
  fallback, never a requirement.
- **An evicted cache repairs itself.** Emptied the shell cache under the
  running worker: one reload put all 27 files back. Without the repair pass a
  reload only restored the 21 files the page happens to import, leaving the
  icons and the manifest missing — an app that is quietly no longer installable
  or fully offline, and that only tells you in a gym with no signal.

Nothing is ever sent anywhere. There is no account, no sync and no request to
any host but the one the app was served from. Going private stops updates
arriving; it does not touch what is already on the phone.

---

## v2.2.0 — verified by driving the app

Each of these was performed in Chromium at 390 × 844 against the built app, and
the database was read directly to confirm what actually landed.

### Demo mode cannot touch real data

- One set logged to the real database (`bulk`): 1 set, 1 session.
- Demo mode on: `bulk-demo` seeded with **69 sessions and 1,817 sets**; the
  orange band appeared in the header on every screen.
- Ticking a set in demo mode left the demo count at 1,817 and showed the
  refusal. The write is turned away inside `withTransaction`, which every write
  in the app passes through.
- The real database read **1 set, 1 session** throughout.
- Demo mode off: the real database was byte-identical to before.

### Versions

- With v2.1.3 controlling and a newer build published under it, the header read
  **`v2.1.3 → v2.2.0`** and the banner named both ends of the move.
- On a development machine, where the offline shell is off, it reads
  **not cached** rather than inventing a number.

### The site going away

Both cases, with the app already installed and the worker in control:

| | Renders | Worker | Cache | Can still log |
|---|---|---|---|---|
| **Origin answers 404** (repo made private) | yes | registered, active | 28 files intact | yes |
| **Origin unreachable** (no signal) | yes | registered, active | 28 files intact | yes |

Every tab rendered in both. **What you lose while private is updates and the
ability to install it somewhere new — not the app you already have, and not one
byte of what you logged.**

### Nothing phones home

Every network request the app made across a full pass — boot, service-worker
registration, all five sections, Settings — went to **one host, the one it was
served from**. Zero external hosts. There is no analytics, no font, no CDN, no
remote image and no telemetry, and the content-security policy would refuse one
if it were added by mistake.

### Repairs

- A session moved from 19 Aug to 11 Aug took **both its sets** with it and wrote
  one audit row.
- A finished session reopened, landed on the Train screen with its logged work
  intact, and was refused while another session was open.
- One set had five fields corrected — load, reps, RPE, exercise, note — with
  **five audit rows**, and its note then appeared in the session detail.
- Deleting that one set left it recoverable in the Bin, and the twenty-seven
  sets of a cascade-deleted session did **not** each appear there.

### Readiness, mid-session

- Rotation 11 session A with a bench set logged: a red day is **refused**, and
  the slot order is unchanged. Before this, red removed the static hold at
  index 0 and shifted every logged set onto the wrong exercise.
- Rotation 1: switching to yellow after logging keeps the logged set visible,
  writes `readiness: yellow` to the session log, and survives a reload.

## v2.3.0 — found by using it in a gym

The first real session was logged on v2.1.3 and the export read back here.
Everything below was diagnosed against those 27 sets rather than against
generated data.

### Fifteen of twenty-seven sets showed no estimate, and would not say why

Reported as "no e1RM when the added weight is 0". It is not the zero — the same
zero at twelve reps estimates fine at 132.4 kg, and the prescribed row on the
same screen is also +0 kg and shows 121.8. It is the twelve-rep limit, which is
deliberate; the silence was not. Every withheld estimate now names its reason.

### The rest timer measured how often the browser called it

`restLeft -= 1` on a one-second interval, which mobile browsers throttle to
about once a minute in the background or suspend outright. Rewritten against
`Date.now()`; six tests move the clock forward by up to a day without
delivering a single tick.

### A session reported eight hours

`startedAt` 11:14, first set 16:30. The log opens on the first thing you do and
un-ticking a set removes the set but not the log, so a tap that was undone
stamped the start five hours early. The session screen shows the span the work
actually occupied, says how far out the start is, and offers to move it.

### Verified against the real export

Imported through the app's own import path: 1 session, 27 sets, 5 settings
restored. The session screen then reported 14,746 kg moved, 340 reps, 27 sets,
6 to failure, a typical rest of 7m 28s across 22 counted gaps, and 164 minutes
of work — with the comparison section correctly saying there is nothing to
compare a first session against.

## Known limits

**The sample data is not real training.** Loads follow the plan's own
prescriptions with a fixed growth rate and no bad days, so the trend lines are
tidier than a real log will ever be. It is there to exercise the code, not to
demonstrate a result.

**The launcher icon is not the app's to change.** Android bakes it into the
installed app, so an icon change reaches the home screen only when the app is
reinstalled, or whenever Chrome next decides to regenerate it. The filenames
carry a version so the browser has something to notice; nothing in the page can
force it.

**Photo decoding depends on the browser.** An iPhone HEIC that Chrome cannot
decode is reported as a readable error rather than silently skipped, but it is
still not imported. Sharing it as JPEG works.

**`frame-ancestors` is not set.** It cannot be delivered from a meta tag, and
GitHub Pages does not let you add response headers. Everything else in the
policy is enforced.

**One tab is advisory.** The database is safe regardless — `logicalKey` and
`operationId` are unique indexes, so nothing can be written twice. What the tab
lock adds is the warning, and it needs `BroadcastChannel`.
