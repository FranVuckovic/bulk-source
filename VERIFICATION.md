# Bulk v2 — verification

**Current build:** `sw.js` VERSION `v2.5.5` · database v3 · plan format 3 · plan
`fopip-v2`
**Automated verification:** 20 August 2026 · 248 passing, 0 failing
**Current visual/interactive verification:** pending

The v2.5 changes have been tested through domain, database, rendering, wiring,
failure-propagation and performance tests. They have **not** yet completed a
fresh real-browser/mobile acceptance pass. The Codex browser controller could
not attach to the open local tabs, so claiming visual verification would be
false. The detailed browser observations later in this file are retained as
historical evidence for v2.1.3, not proof for v2.5.5.

v1 is archived at `archive/v1/` and tagged `v1.0`. It still runs and still
reads a v1 export.

---

## How to reproduce the current automated pass

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

## Current automated evidence

The 248 tests cover calculations, plan compilation, rotations, volume,
analytics, IndexedDB migrations and transactions, export/import, recovery,
performance, service-worker integrity, all-screen rendering, and action wiring.
New v2.5 regressions include demo isolation/visibility, recoverable session
discard, custom-workout isolation from the A–F rotation, manual index sets,
collapsible Plan sections, record evidence, chart recency bands, and rejected
UI writes reaching the central error handler.

Coverage is diagnostic rather than a release score:

```bash
node --test --experimental-test-coverage test/*.test.js
```

On 20 August it reported 65.23% line, 73.07% branch and 64.49% function
coverage. Core data and plan modules are around 96–100% line coverage; DOM-heavy
action modules are lower. That is exactly why the real-device checklist below
remains mandatory.

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

## Current v2.5.5 real-browser acceptance checklist

Use a narrow phone viewport and both colour schemes. Run once with demo data
and once with a fresh disposable personal database.

- Confirm the demo banner appears only in demo mode, “Back to my data” returns
  to the personal database, and changing demo data does not change personal
  data.
- Start A, log/edit/unlog a set, toggle index-set status, add and remove a set,
  swap an exercise, set grip, and finish. Reload after each save-sensitive step
  and confirm the state survived.
- Start a session accidentally, discard it, confirm it appears in Recently
  deleted, restore it, discard it again, and confirm a fresh session can start.
- Build and finish a custom workout; confirm it does not advance the A–F
  rotation or inflate planned rotation volume.
- Inspect Plan on a phone: tabs wrap without horizontal scrolling; workout and
  muscle sections open and close independently; no card is stuck open.
- Inspect Strength: lift selection needs no horizontal scroll; record evidence
  precedes the chart; weight, reps, RPE, date and e1RM are legible; block
  baseline reads as calibration, not a failed negative score.
- Inspect Summary, measurements and Settings for clipped text, excessive blank
  space, overlapping tap targets and unwanted horizontal scroll.
- Export, delete one harmless demo entry, restore it, import the export in a
  disposable database, and run the integrity check.
- Install/update with `?sw=1`: an update must wait for approval, warn if a
  session is active, reload once, and still open offline.
- Check the console for exceptions and CSP/service-worker errors throughout.

Until this list passes, v2.5.5 is a tested development candidate, not a
published release.

---

## Historical v2.1.3 manual evidence

Each item below was checked on 19 August 2026 against v2.1.3 in the browser with
the sample database, in both colour schemes at 390 × 844. It remains useful
regression context but does not certify the later UI changes.

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
