# Picking this up cold

Paste the block below into a fresh session. It is written to be handed to
someone who knows nothing about this project.

Keep it current: if you change the test count, the version, or what is waiting
on a decision, change it here too. A handoff that lies about its own numbers
teaches the next session to distrust everything else in it.

---

```
You are picking up an existing project cold. Read before you build.

## What this is

Bulk — a single-user PWA for one lifter running a 33-rotation, bench-focused
bulk. Vanilla JavaScript, ES modules, ZERO runtime dependencies, no build step,
no framework, no server. Data lives in IndexedDB on the owner's phone and is
never sent anywhere. There is no account and no sync.

The owner is a working lifter, not a developer wanting a codebase tour. What he
wants from a session is the change, working, and a short honest account of it.

## Step 1 — read, in this order. Do not skim.

1. `CLAUDE.md` — the owner's standing instructions. Non-negotiable, not defaults.
2. `PUBLISHING.md` — the two repos, what an update does to his data, how to roll
   back. Read this BEFORE touching anything to do with publishing.
3. `VERIFICATION.md` — what has been verified, how, and the known limits.
4. `TRY-THIS.md` — every commit on the working branch and which are safe to
   revert alone.
5. `docs/v2-status.md` — every requirement, its evidence, the judgement calls.
6. `docs/bulk-plan.md` and `docs/plan-rationale.md` — the training plan and the
   research behind it. MANDATORY before touching anything training-related.
7. `docs/set-counting-proposal.md` — a decision waiting on the owner.
8. `git log` — 82 commits whose messages explain *why*. Several document a
   defect in full. The last twenty are the most relevant.

## Step 2 — prove you have access, then report

Run these and tell me the results before doing anything else:

- `npm test` — must be **314 passing, 0 failing**
- `git rev-list --count HEAD` — must be **82**
- `grep VERSION sw.js` — must be **v2.7.0**
- Count exercises in `data/plan-fopip-v2.json` — must be **49**
- `git branch --show-current` — must be **claude/project-onboarding-verify-lz3ob6**
- Confirm you can read `docs/`, `test/`, `archive/` and `dev/`

If any number differs, say so — either the repo moved on or your access is
partial. Then answer these two from what you read, not from general knowledge:

> Why does the Progress screen import from analytics.js instead of calculating
> anything itself?

> Why does the rest timer never count intervals?

(Correct answers: v1 computed metrics inside the drawing code and consequently
asserted things its own numbers contradicted. And: setInterval is throttled or
suspended when a phone browser is backgrounded, so counting ticks measured how
often the browser felt like calling us rather than time passing — every reading
is now derived from Date.now() against an absolute instant.)

## The two repositories — read this before pushing anything

| | |
|---|---|
| **bulk-source** (private) | Source, tests, docs, archive, history. **Work here.** |
| **bulk** (public) | Build output only. Served by GitHub Pages so the app can be installed to a phone. |

`dev/publish.sh` does `rm -rf dist` → `git init` → **`push -f`**. It replaces
the public repo's entire history every time. Never commit into `bulk` directly.

The publish set is derived from the `SHELL` array in `sw.js`, plus `sw.js`
itself. Do not restate that list anywhere else — a second copy is how a retired
plan file titled after its owner once reached a public repository.

**PUBLISHING IS OUTWARD-FACING. Publish only when the owner says so, in those
words, in that turn.** Not because a change is finished, not because tests pass,
not because it seems ready. `PUBLISHING.md` has the checklist and the rollback.

**Bump `VERSION` in `sw.js` whenever a shell file changes**, or the update never
reaches the phone.

## Current state

- **v2.4.0 is live** on GitHub Pages. Published 20 August 2026.
- **v2.6.0 is on the branch and is NOT published.** It is v2.4.0 plus a second
  round of work that arrived as a Git bundle from another session and was
  merged here. `docs/release-v2.6.0.md` lists it.
- Work is on branch `claude/project-onboarding-verify-lz3ob6`. `main` is
  v2.1.3; `e304ef7` on this branch is v2.4.0 — the version actually running on
  the phone, and the sensible rollback point.
- The owner has NOT yet used v2.4.0 or v2.6.0 in a real session. Every round so
  far went in on tests and browser-driving alone. Real use will find things
  those did not.

## How to work here — the parts that bite

**Scope.** Nothing outside this folder. No global installs, no system config.
Dev dependencies in local `node_modules` only. If something is genuinely
missing, say what it is and what you would run — do not run it.

**Decide technical things yourself.** Data structures, signatures, file
organisation, algorithms, edge cases, test design, CSS. Note it briefly, move on.

**Stop and ask only for:** anything visual he would have an opinion on;
anything about training content — exercises, sets, reps, RPE, the plan's logic,
the counting method, the target bands (*never* change these on your own
judgement — propose and wait); a real product decision the docs do not settle;
and anything irreversible or outward-facing.

Fixing a calculation that produces an impossible prescription is not changing
training content. Changing a rep target is.

**Report in two or three lines per unit of work.** If tests fail, say so with
the output. If something was skipped, say that.

## Invariants that will bite you if you do not know them

- **The Progress screen calculates nothing.** Every figure comes from
  `analytics.js` as a metric object carrying its own window, sample count,
  exclusions with reasons, and confidence. Do not reintroduce arithmetic into a
  view. A metric that is not trustworthy must not be *returned*, not merely
  hidden — a view should never have to know which of its numbers are safe.
- **A rotation is the training unit, not a calendar week.** Blocks advance on
  sessions completed.
- **Loads are stored in kilograms, always.** Pounds is a rendering transform.
  Bodyweight lifts store the *added* load; the maths runs on bodyweight + added.
- **An estimate that cannot be justified is not shown** — but say *why*, or a
  blank reads as a broken app. `e1rm` refuses above 12 reps and always will;
  `roughE1rm` gives a clearly-labelled weaker figure past that and never feeds a
  record, a working-max proposal, an index set or a chart.
- **Deletion is recoverable everywhere.** Soft delete plus an audit entry.
  Emptying the bin is the only thing in the app that destroys data.
- **Writes are idempotent at the database level**, via unique indexes on
  `logicalKey` and `operationId` — not via UI locks.
- **Every write goes through `withTransaction`.** That single choke point is
  what makes the demo-mode write lock real rather than decorative.
- **Never count ticks for anything time-related.** Wall clock, always.
- **One shared reload path.** Four save handlers each inlined their own and all
  four drifted, resurrecting deleted rows into the charts. Duplication was the
  bug; the filter was only the symptom.

## Tests

`node:test`, no framework, ~1s. Each test names the defect it prevents — read
them before changing behaviour they cover.

Some check **wiring, not just functions**. Three defects shipped as code that
was written, tested, and then not called. `test/shell.test.js` and
`test/service-worker.test.js` guard those shapes; do not delete them because
they look like they test strings. `test/screens.test.js` renders every screen
and every tabbed section on an empty database and at both ends of every block,
and fails if `NaN`, `undefined` or `[object Object]` reaches the page.

## Testing it for real

Tests are not enough — most of the defects found here were invisible until
someone drove the app. Chromium and `playwright-core` are the tool; drive the
real UI at 390×844 in both colour schemes, and read IndexedDB directly to check
what actually landed rather than what the screen claims.

**Use demo mode** (Settings → Demo mode) rather than writing test data into the
real database. It runs on a separate database the real log cannot be reached
from, and blocks writes at `withTransaction`.

`npm run serve` → `http://localhost:8123`. The offline shell is off on
localhost; use `?sw=1` to exercise the update path.

## Waiting on the owner — do not implement without a decision

Both in `docs/set-counting-proposal.md`:

1. **The orange bars on the Plan screen.** Researched and quantified; four
   options ranked. The recommended one changes no training content.
2. **The in-app Deloads tip contradicts the plan.** It says "week 6 of every
   block" — a v1 sentence, in a plan that has no scheduled deloads and advances
   on sessions rather than weeks. Replacement text is written. It is training
   guidance, so it is his call.

## Start with Step 2 and report back.
```
