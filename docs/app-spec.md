# Training App — Specification

**Version 0.1 · 15 August 2026 · Fran**

This is the agreed design on paper, before any code exists. Everything here is either **decided**, **deferred to v2**, or **open** (marked with a ❓ and listed in Part 7).

---

## Part 1 — What we're building and why

A single-user training app that holds one training plan, makes logging fast enough that it actually gets done, and produces a clean export that can be handed to Claude for analysis.

**It is not** a general fitness app. It has no users but Fran, no accounts, no server, and no ambition to be flexible about things that don't need flexibility.

### The five design principles

| # | Principle | Why |
|---|---|---|
| 1 | **Every external dependency is a future breakage** | No Fitbit API, no scale API, no cloud sync, no framework with an upgrade treadmill. The app depends on the browser and nothing else. |
| 2 | **The plan is data, not code** | Adding or changing a program later means editing a JSON file, not rewriting the app. |
| 3 | **Logging speed beats every other feature** | If a set takes four taps instead of one, the app gets abandoned by week five. Prefill everything. |
| 4 | **Data outlives the app** | CSV + JSON in a zip, with a format version from day one. Readable by Excel, by Claude, by whatever replaces this. |
| 5 | **Defer anything complex and fragile** | A working simple app beats an ambitious broken one. The v2 list is not a consolation prize — it's the plan. |

---

## Part 2 — Architecture (decided)

**Web-first PWA, with Capacitor available later to produce a real Android APK.**

### Does this sacrifice quality?

For this specific app, no. The places a PWA genuinely feels worse than native are heavy 3D graphics, deep OS integration, and background processing. This app is forms, numbers, charts and local data — a category where a well-built PWA is functionally indistinguishable from native.

What you get on Android: home-screen icon, launches fullscreen with no browser bar, works fully offline, opens instantly.

What you also get, free: it runs identically on the MacBook and on Windows, in any browser.

### What we give up, honestly

| Native could do | Our workaround |
|---|---|
| Auto-sync sleep from Fitbit via Health Connect | Type it — about 8 seconds a day |
| Auto-sync bodyweight from the smart scale | Same |
| Guaranteed permanent storage | Request persistent storage + backup reminders + one-tap export |
| Background notifications | Deferred to v2; browser notifications work but are less reliable |

**The Capacitor escape hatch:** the same codebase wraps into a real APK whenever wanted, with native filesystem and Health Connect access. No rewrite. This is why web-first isn't a compromise — it's a deferral.

### Maintainability

No framework. Vanilla JavaScript with ES modules, one file per concern. Nothing to migrate, nothing to upgrade, no `node_modules` to rot. In three years you open the file and it still works.

---

## Part 3 — The app, screen by screen

Four tabs along the bottom. That's the whole app.

### Tab 1 · TRAIN

The screen you're in during a session.

- Opens on **the next session in the rotation**, with a one-tap override to pick a different one
- Every prescribed exercise is listed with its target sets, reps and load
- **Loads are auto-calculated from your current estimated max** — this is the single reason to build custom rather than use Hevy
- **Last session's numbers are prefilled on every set**
- Tap a set → adjust load/reps → confirm. One tap if nothing changed.
- Per set: load, reps, RIR or RPE, flags for *to failure* and *AMRAP*, an optional velocity field, an optional note
- **Add an exercise, remove an exercise, add or drop a set** — freely, at any time. Deviations are recorded as deviations, not treated as errors.
- Session note at the end, plus session RPE
- Rest timer
- **Attach a form-check video** to any set (see Media below)

### Tab 2 · BODY

Two clearly separated cadences.

**Daily** (about 8 seconds)
- Bodyweight
- Bodyfat % from the smart scale — *stored, but treated as a low-trust number; the trend matters, the absolute value doesn't*
- Sleep hours
- Optional note

**Weekly** (about 60 seconds)
- Waist at navel · upper chest · shoulders · arm L/R · quad L/R · neck
- **Physique check-in photos** — front, side, back

### Tab 3 · PROGRESS

- Estimated 1RM, best per week
- Bodyweight 7-day average, with the target gain-rate band shaded
- Waist, and waist-vs-bodyweight ratio — the lean-bulk discriminator
- Any measurement, charted
- **PR log** — automatically detected, listed with date and lift
- **Decision flags** — gain rate off target, e1RM stalled while bodyweight rises, top set down vs rolling average, niggle count in a block, sleep below threshold
- Per-exercise history
- **Export** (see Part 5)

### Tab 4 · PLAN

- The current block: what it is, which week you're in, what it's for
- Every session in the rotation, viewable in full
- **The 4-day and 3-day fallback versions**
- **The knowledge base** — why the plan is what it is, technique cues per lift, the decision rules, the research reasoning. Plain text, searchable. This is where everything we've worked out gets stored so it's in your pocket rather than in a chat log.

---

## Part 4 — Media (revised from the earlier decision)

Fran's requirement to **export physique photos and send them to Claude** changes the earlier "reference only" recommendation. A filename reference can't be looked at.

| Type | Storage | Reasoning |
|---|---|---|
| **Physique check-in photos** | **Stored in the app**, auto-compressed to ~1080px JPEG (~200 KB each) | 3 photos/week × 33 weeks ≈ 100 photos ≈ 20 MB. Trivial. And they can be exported and sent. |
| **Form-check videos** | **Reference only** — date, lift, load, reps, note, plus the filename. Tap it, the gallery opens. | A single video is 50–200 MB. Storing them would make the app a liability. Send them to Claude directly in chat when a form check is wanted. |

Adding either is two taps from the relevant screen. Viewing is a gallery grid sorted by date, with the lift and load overlaid.

---

## Part 5 — Export (decided)

**Selective export.** Pick a date range and pick what to include:

```
☑ Sets & sessions        ☑ Daily (weight, bodyfat, sleep)
☑ Measurements           ☑ Physique photos
☐ Form-check references  ☑ Current plan
Date range: [last month ▾] [all time] [custom]
```

Produces one zip:

```
training-export-2026-11-03.zip
├── meta.json          format version, export date, what's included
├── plan.json          the program you're running
├── sets.csv           one row per set
├── sessions.csv       one row per session
├── daily.csv          weight, bodyfat, sleep
├── measurements.csv   weekly tape numbers
├── niggles.csv        joint, severity, date, context
├── media.csv          index of all photos and video references
└── photos/            the actual check-in images, if selected
```

CSV so it's readable by you, Claude and Excel. JSON so a restore is lossless. A `format` version number so v2 can read v1's data.

**Import** restores from the same zip. That is also how data moves between phone and MacBook.

---

## Part 6 — v1 versus v2

### In v1

Set logging with prefill · plan-driven sessions · auto-calculated loads · e1RM · AMRAP and failure flags · velocity field · niggle log · rest timer · daily body metrics · weekly measurements · physique photos · form-check references · all charts · PR detection · decision flags · selective export · import/restore · offline · dark mode · home-screen install · knowledge base

### Deferred to v2 — and why

| Deferred | Reason |
|---|---|
| Plate calculator | Nice, not needed to start |
| Weekly volume-per-muscle audit | Needs an exercise→muscle map. Worth doing, but after the plan proves stable. |
| Push reminders | Moderate complexity, medium fragility |
| Exercise photos and demo videos | Text cues cover it. Media per exercise is a lot of asset management for little gain. |
| A UI for editing or creating plans | **Plans are JSON. Adding one later is a file, not a feature.** Building an editor is a big job with a small payoff for one user. |
| Side-by-side video comparison | High complexity, low frequency of use |

### Never

Automatic cloud sync · Fitbit or scale API integration · camera-based bar velocity · videos stored in-app · multi-user anything

---

## Part 7 — Data model

```
plan.json                     ← the program, as data
  meta        { name, version, startDate, blocks[] }
  exercises   [{ id, name, muscles{primary,secondary}, cues[], defaultRest }]
  sessions    [{ id, label, role, slots[{ exerciseId, prescription, note }] }]
  rotation    [sessionId, ...]
  fallbacks   { fourDay[], threeDay[] }

sessionLogs   id, date, sessionId, blockId, weekIndex,
              startedAt, endedAt, bodyweight, sessionRpe, note

sets          id, sessionLogId, exerciseId, setIndex,
              load, reps, rpe, rir, toFailure, isAmrap,
              velocity, note, wasPrescribed, timestamp

daily         date, bodyweight, bodyfatPct, sleepHours, note

measurements  date, waist, chest, shoulders, armL, armR,
              quadL, quadR, neck, note

media         id, date, kind, exerciseId, load, reps, note,
              imageBlob (photos) | fileRef (videos)

niggles       date, site, severity(1–3), context, note
```

Everything else — e1RM, rolling averages, weekly set counts, PRs, flags — is **computed, never stored**. Storing derived values is how data goes stale and inconsistent.

**Session duration** comes free from `startedAt`/`endedAt`, and is genuinely useful: it's how we'd catch you rushing sets again.

---

## Part 8 — Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Browser evicts stored data** | High | Request persistent storage on install (Android grants it to installed PWAs); backup reminder every 2 weeks; one-tap export |
| **Logging friction leads to abandonment** | High | Prefill everything; one-tap set confirm; demo tested on the phone before any real build |
| Photo storage grows unbounded | Low | Auto-compress on import; storage-used indicator |
| Schema change breaks old data | Medium | `format` version in every export; migration functions with tests |
| Silently wrong e1RM corrupts months of decisions | **High** | **Unit tests on every calculation** — e1RM, rolling averages, PR detection, volume counting |
| Plan and app drift out of sync | Medium | Plan lives in one JSON file, used by both |

---

## Part 9 — Build sequence

| Phase | What | Where | Blocked by |
|---|---|---|---|
| **0** | Finalise the training plan | Cowork | Baseline numbers + open questions |
| **1** | Clickable demo — every screen, fake data, real navigation, no storage | Cowork | Phase 0 |
| **2** | Fran uses the demo on his phone; fix what's wrong | — | Phase 1 |
| **3** | Build v1 as a git repo with tests on the maths | **Claude Code** | Phase 2 |
| **4** | Run one block → export → analyse → adjust | Both | Phase 3 |

---

## Part 10 — Open questions

Listed in the chat message accompanying this document.
