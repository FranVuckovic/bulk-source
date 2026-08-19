# v2.3.0 — how to try it, and how to undo any of it

Everything is on the branch `claude/project-onboarding-verify-lz3ob6`.
**Nothing has been published.** The public `bulk` repo is untouched, and
`dev/publish.sh` has not been run.

---

## Try it in two minutes

```bash
git checkout claude/project-onboarding-verify-lz3ob6
npm test          # expect 267 passing, 0 failing
npm run serve     # then open http://localhost:8123
```

**Turn on demo mode first** — Settings → Demo mode → *Turn on demo mode*. It
fills every screen with twelve rotations of invented training so there is
something to look at, and while it is on your real data is in a different
database that the app does not even open. Turn it off and you are back exactly
where you were.

Worth looking at specifically:

| Where | What is new |
|---|---|
| Train | **Session progress card** — elapsed, plan done, plan left, warm-ups counted. |
| Train | Tap a set: **load, reps and RPE together**, and typing replaces instead of appending. |
| Train | **Note** button per exercise — the machine, the seat height, the pin. |
| Train | Every set shows **difficulty** beside e1RM, and says why when there is no estimate. |
| Train | **Timer** button: a stopwatch you drive. Both timers are now wall-clock correct. |
| Log → tap a session | **A whole screen**: load moved, rest chart, timeline, every set, comparison. |
| Anywhere | The version next to the title. Tap it. |
| Anywhere | The rotation chip is tappable → block progression. |
| Bottom bar | **Log** is a section now — the record, backups, and the bin. |
| Progress | Four tabs instead of one long column. |
| Progress → Strength | Tap any record to see how it got there. |
| Plan | Tabs at the top; Workouts is six cards that open. |
| Log → open a session | Set notes, the timing report, and **Fix something about this session**. |
| Train | **Start session**, the timing switch beside Finish, and a **Timer** button. |
| Body | Which scale the weigh-in was on; when the tape was read. |
| Android | The back button now moves inside the app instead of closing it. |

To test the update path itself — the thing that shows `v2.1.3 → v2.3.0` — open
`http://localhost:8123/?sw=1`. The offline shell is deliberately off on
localhost otherwise, or every edit would be invisible until the version is
bumped.

---

## Undoing any part of it

Thirteen commits, each one thing. Any of them can be reverted on its own
without disturbing the others:

```bash
git revert <hash>
```

Newest first:

| Commit | What it does | Safe to revert alone |
|---|---|---|
| `fb79d4e` | Back with a sheet open closed the app | **keep this one** |
| `c4729ac` | Every export failed the app's own backup verifier | **keep this one** |
| `3733c38` | Tests for every tabbed section, and this file | yes |
| `516c213` | Session timing report, hand-driven timer, scale on weigh-ins | yes |
| `7ed887d` | v2.2.0 version bump, docs brought up to date | yes — but the version bump is what makes an update reach the phone |
| `83dec36` | The set-counting proposal document | yes — it is a document, it changes no behaviour |
| `38bc4ae` | Repair tools, record progression, rest-bar clearance | yes |
| `f0693a2` | Five sections, tabs, Android back, measurement time, set notes | yes |
| `6ee2e7f` | Plan screen tabs, Workouts cards, two Plan defects | yes |
| `c8b38a2` | Failures while typing are reported | **keep this one** |
| `a22b4fb` | The four readiness defects | **keep this one** |
| `4ef605b` | Demo mode, sample-data safety, erase offers a backup | yes |
| `6c7430e` | Version display and the update banner | yes |

The four marked **keep** are defect fixes with no visual component. `a22b4fb`
in particular fixes something live for you right now: from rotation 11,
flagging a red day part-way through session A moved every logged set onto the
wrong exercise. `c4729ac` is the one that mattered most for trusting your
backups — before it, every export failed the app's own verifier the moment you
took it.

To throw away the lot and go back to where you were:

```bash
git checkout main
```

Nothing on this branch has touched `main`, the public repo, or your database.

---

## Before publishing

`dev/publish.sh` force-pushes over the public repo and replaces its history, so
it is yours to run, not mine. When you do:

1. `npm test` — 267, 0 failing.
2. Check `sw.js` VERSION reads `v2.3.0`. The publish set is derived from the
   `SHELL` array in that file, and `js/demo.js` was added to it — a test
   enforces that the shell covers the module graph, so this cannot silently go
   wrong.
3. `npm run publish -- https://github.com/FranVuckovic/bulk.git`

The published set is **28 files**: the 27 real paths in `SHELL` — the `'./'`
entry is a route, not a file — plus `sw.js`, which is never in its own shell
because it does not precache itself. `docs/`, `test/`, `dev/`, `archive/` and
this file stay here. I dry-ran that selection: 28 present, 0 missing, nothing
from those directories, no occurrence of your name in any published file, and
the retired v1 plan still excluded.

**Your phone will not lose anything.** The update replaces code only; it never
opens IndexedDB. It will show `v2.1.3 → v2.3.0` — though on that first update
the *old* banner appears, because the page showing it is still the old build.
Every update after this one shows both versions.

---

## Two things waiting on you

Both in `docs/set-counting-proposal.md`. Neither is implemented.

1. **The orange bars on the Plan screen.** Researched, quantified, four options
   ranked. The one I would take changes no training content.
2. **The in-app Deloads tip contradicts the plan.** It says "week 6 of every
   block", which is a v1 sentence — the plan has no scheduled deloads and
   blocks advance on sessions, not weeks. Replacement text is written; it is
   training guidance, so it is your call.
