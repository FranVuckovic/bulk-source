# Bulk

A single-user PWA training app for one lifter, running a 33-rotation
bench-focused bulk. Vanilla JavaScript, ES modules, **zero runtime
dependencies**, no build step, no framework. Data lives in IndexedDB on the
device and is never sent anywhere.

The owner is a working lifter, not a developer looking for a codebase tour.
What he wants from a session is the change, working, and a short honest account
of it.

---

## How to work here

These are the owner's standing instructions. They are not negotiable defaults —
they were given explicitly and they still hold.

### Scope: nothing outside this folder

Do not install, reinstall, upgrade or remove anything system-wide. No brew, no
global npm installs, no changing system config. Dev dependencies go in local
`node_modules` only. If something is genuinely missing and you cannot proceed,
**stop and say what it is and what you would run** — do not run it yourself.

### Autonomy: decide technical things yourself

Data structures, function signatures, file organisation, algorithms, edge
cases, test design, CSS implementation — make the call, note it briefly, move
on. Do not stop to ask which approach to take, whether a test is worth writing,
or to confirm you understood.

### Stop and ask only for

1. **Anything visual he would have an opinion on.**
2. **Anything about the training content** — exercises, sets, reps, RPE, the
   plan's logic. *Never change training content on your own judgment.* Fixing a
   calculation that produces a physically impossible prescription is not
   changing training content; changing a rep target is.
3. **A real product decision with no obvious answer**, where the docs genuinely
   do not say.
4. **Anything irreversible, outward-facing, or that touches his machine** —
   publishing, force-pushing, deleting data.

### Reporting

Two or three lines per unit of work, not a full writeup. If tests fail, say so
with the output. If something was skipped, say that.

---

## Commands

```bash
npm test          # 248 tests, ~0.6s, node:test only
npm run serve     # dev server on :8123, no-store headers
npm run publish -- https://github.com/FranVuckovic/bulk.git
```

There is no build, no bundler, no transpiler. What is in `js/` is what runs.

---

## Two repositories — read this before pushing anything

| | |
|---|---|
| **`bulk-source`** (public) | This project. Source, tests, docs, archive, history. **Work here.** |
| **`bulk`** (public) | Build output only. Served by GitHub Pages so the app can be installed to a phone. |

`dev/publish.sh` does `rm -rf dist` → `git init` → **`push -f`**. It replaces
the public repo's entire history every time. Never commit work into `bulk`
directly — it will be destroyed on the next publish without warning.

The publish set is derived from the `SHELL` array in `sw.js`, plus `sw.js`
itself. Do not restate that list anywhere else; a second copy is how a retired
plan file titled after its owner ended up on a public repository.

Publishing is outward-facing. **Ask first.**

Public visibility is read access, not write access. Pushes still require the
owner to authorize GitHub through OAuth, SSH, a device login or an installed
GitHub connector. Never ask for or store a raw password or personal access
token in this repository.

---

## Architecture

Pure domain layer, no DOM, no storage, no `Date.now()`:

| File | Owns |
|---|---|
| `js/calc.js` | RPE↔%1RM table, e1RM and its confidence, rounding, prescriptions, working-max rules |
| `js/plan.js` | The plan compiler: rotation + session → resolved prescription |
| `js/cycle.js` | A rotation as the unit of training: progress, corrections, projection |
| `js/volume.js` | Fractional sets, head vs whole-muscle counting |
| `js/analytics.js` | **Every number the Progress screen shows** |
| `js/dates.js` | Local civil dates vs UTC instants |
| `js/db.js` | IndexedDB, migrations, atomic and idempotent writes |
| `js/export.js` | Zip, staged validation, atomic import, verification |

`js/ui/*` renders. It does not calculate.

### Invariants worth knowing before you change anything

**The Progress screen calculates nothing.** Every figure comes from
`analytics.js` as a metric object carrying its own window, sample count,
exclusions with reasons, and confidence. v1 computed metrics inside the drawing
code and consequently asserted things its own numbers contradicted. Do not
reintroduce arithmetic into a view.

**A rotation is the training unit, not a calendar week.** Blocks advance on
sessions completed. Calendar weeks are a report, only for nutrition and
recovery.

**Loads are stored in kilograms, always.** Pounds is a rendering transform.
Bodyweight lifts store the *added* load; the maths runs on bodyweight + added.

**An estimate that cannot be justified is not shown.** `pct()` returns `null`
off-table. Index sets on high-confidence lifts only. An exclusion is reported
with its reason rather than silently dropped.

**Deletion is recoverable everywhere.** Soft delete plus an audit entry.
Emptying the bin in Settings is the only thing in the app that destroys data.

**Writes are idempotent at the database level**, via unique indexes on
`logicalKey` and `operationId` — not via UI locks. Session creation must go
through `startSessionAtomic`; a plain `saveSession` bypasses the active-pointer
check and five fast taps open five sessions.

---

## Tests

`node:test`, no framework. Each test names the defect it prevents — read them
before changing behaviour they cover.

Some tests check **wiring, not just functions**. Two defects shipped as code
that was written, tested, and then not called: `js/photos.js` was absent from
the offline shell, and `startSessionAtomic` existed while `ensureActiveLog`
went around it. `test/shell.test.js` and `test/service-worker.test.js` guard
those shapes. Do not delete them because they look like they test strings.

`test/screens.test.js` renders every screen on an empty database and at both
ends of every block, and fails if `NaN`, `undefined` or `[object Object]`
reaches the page.

`test/body-ui.test.js` and `test/train-ui.test.js` also check that rejected UI
writes are returned to the central action handler. An async save that is
started but neither awaited nor returned can fail without the user seeing the
error; treat that as data-loss risk.

---

## Service worker

Serves the whole shell from one versioned cache, so the app is always running
one complete build. **Bump `VERSION` in `sw.js` whenever a shell file
changes**, or the update will not reach the phone.

- Not registered on `localhost` — the atomic cache would hide every edit. Use
  `?sw=1` when the update path itself is what needs testing.
- Between versioned builds an update waits and the app offers it. From a
  pre-versioning cache name (`bulk-v1`, `bulk-v2`) it takes over immediately:
  v1's worker answered failed fetches with `index.html`, including for module
  requests, which blanks the app with no way to report why.
- The launcher icon is **not** the app's to change. Android bakes it in at
  install time. Icon filenames carry a version so the browser has something to
  notice; only a reinstall moves it immediately.

---

## Where the reasoning is written down

- `VERIFICATION.md` — what was verified, how, and the known limits
- `docs/v2-status.md` — every requirement, its evidence, and the judgement calls
- `docs/bulk-plan.md`, `docs/plan-rationale.md` — the training plan and the
  research behind it. **Read before touching anything training-related.**
- `BUILD-BRIEF.md` — the original brief
- Commit messages — they explain *why*, and several document defects in detail

## Development data

`dev/sample-data.html` writes twelve rotations of invented history through the
real plan engine. It deliberately crosses three blocks, leaves the last
rotation part-finished, skips a session and includes yellow-readiness days.
Loading always clears first. Everything it writes is fake — erase it before
logging anything real.
