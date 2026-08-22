# How to try it, and how to undo any of it

Everything is on the branch `claude/project-onboarding-verify-lz3ob6`.

**v2.4.0 is what is published.** It went to the public `bulk` repo on 20 August
2026, replacing v2.1.3. Your phone will offer it and wait for your tap.

**v2.6.0 is on this branch and is not published.** It is v2.4.0 plus a second
round of work that arrived as a handoff bundle from another session, merged
here. Nothing has gone to the public repo since v2.4.0, so trying v2.6.0 means
running it locally — see below. `PUBLISHING.md` has what a publish does to your
data (nothing) and how to roll back (exactly).

---

## Try it in two minutes

```bash
git checkout claude/project-onboarding-verify-lz3ob6
npm test          # expect 372 passing, 0 failing
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


### New in v2.6.0

| Where | What is new |
|---|---|
| Train | The clock and Start sit above the exercise list. |
| Train | A session opened by accident can be **discarded** into the bin, restored from Log → Bin, or discarded and restarted cleanly. |
| Train | **Custom** — an ad-hoc workout built from the exercise library that does not advance or inflate the A–F rotation. It says so on screen. |
| Train | Any logged set can be marked an index set, not only the prescribed one. |
| Train | Set controls grouped by consequence: fill a value, use a tool, change the exercise. |
| Progress → Summary | Evidence is grouped — bodyweight & waist, strength, relative strength, plan completion — instead of one stack. |
| Progress → Strength | The record set comes *before* the chart, with load, reps, RPE and date. "Prescriptions use" sits beside "Best eligible set this block". |
| Progress → Strength | Relative strength is a real trend, matched only to bodyweight readings within three days. |
| Progress → Volume | The tonnage comparison uses a real 44-tonne lorry. |
| Plan | Tabs wrap; workout cards and muscle groups collapse reliably. Stimulus colour is proportional — orange means materially high, not slightly over. |
| Body | Measurements show dates, a selectable trend and a bodyweight comparison. |
| Settings | Five named groups, only the routine one open. Demo mode is first, and its warning appears only while the demo database is live. |

`docs/release-v2.6.0.md` is the full list. No exercise, set, rep, RPE, rotation
or block rule changed, and the database schema is still v3.

### New in v2.11.0

| Where | What is new |
|---|---|
| Body | **"Already logged at 07:12"** on each card that has an entry for the chosen day, and the button changes to **Replace this weigh-in** / **Replace these measurements**. Full boxes are now explained instead of looking like a form that failed to clear. |
| Body | The weigh-in and the tape are asked about **separately** — logging one no longer makes the other claim it is done. |
| Everywhere | Saves record **when** they were written, so the app can say so. Old rows have no stamp and say "already logged" without a time rather than inventing one. |

**Restoring 20 August:** `docs/data-safety.md`, last section — checked against
the 22 August export, two writes in a stated order.

### New in v2.10.0

| Where | What is new |
|---|---|
| Header, every screen | **A blue timer button.** Three states: closed, a draggable bubble, or the full panel. Drag the bubble anywhere; it remembers. |
| The timer | Symbols for minimise and close, top right. Custom length. It no longer closes itself when time is up. Counting up hides the controls that only make sense counting down. Optional "tell me when it is up", off by default. |
| Train → Phases | Every rotation now shows the **load basis** (83% of working max, from the RPE table, from today's top single), the rest and the effort — the things that make two prescriptions comparable. |
| Train → Phases | **Back-offs come with it.** Session A's bench is two slots and both are shown. |
| Train → Phases | **Tap a rotation to borrow its prescription for today**, with a Revert button. It is stored on the session log, so it survives a reload and travels into your history. |
| Body | **Arm L/R flexed** and **Forearm L/R.** Twelve sites. Old readings are untouched and old exports still import — blank stays blank. |

**Waiting on you:** `docs/amrap-backoffs-proposal.md` — whether the AMRAP should
have back-off sets. Short answer: the absence is deliberate and documented, but
four options are laid out and none is implemented.

### New in v2.9.0

| Where | What is new |
|---|---|
| Train → any planned exercise | **Phases** — how that exercise is prescribed across all 33 rotations, and everywhere else it appears in this rotation. |
| Train → Swap | Warns first when the exercise already has logged sets, and those sets can no longer be destroyed. |
| Log → Bin | A set displaced by a swap is offered back here. |
| Train → B | **Arms first.** Curls → leg press → hip thrust → quads → hamstrings → the rest. Your call, made 21 August; nothing but the order changed. |

**Two data-loss defects fixed.** Swapping an exercise after logging sets on it
destroyed the overlapping ones — silently, with no bin entry. And the class it
belongs to is now a standing test: `docs/data-safety.md` lists every store whose
key comes from the data, with what stops a replacement being a loss, and
`test/write-safety.test.js` fails if a new one appears unlisted.

**How to put back the measurements that were overwritten:** `docs/data-safety.md`,
last section. It needs v2.9.0, because changing the day is what makes it
possible.

### New in v2.8.0

| Where | What is new |
|---|---|
| Body | **Which day you are writing to**, stated at the top, and changeable. This is the fix for the measurements that were overwritten — see below. |
| Log → tap an entry | **Replaced values** — every time that entry was written over, and what it held before. |
| Log | The two filters are labelled and separated: *Show* active/deleted, *Of what kind*. |
| Train → Timer | Tap the reading to open the timer to half the screen: six preset lengths, ±30s, pause, reset, count down or count up, minimise, close. The **Timer** button opens it without logging a set. |
| Train → Note | **Last time** — every note you have written about this exercise before, dated. Set notes included. |
| Plan → Tips | The AMRAP is in **Session C**. Several tips said E, which is v1's letter for it. Set counts corrected too. |

**The overwrite.** `daily` and `measurements` are keyed by their date, and
`state.todayISO` was worked out once when the app started. An installed PWA is
resumed, not reloaded, so after midnight the Body screen still meant yesterday:
it prefilled from yesterday's records — the numbers you found already in the
boxes — and wrote back over them. The date is re-derived now, and the app
watches for the day changing while it is open. Separately, a replacement keeps
what it replaced, so this can no longer be silent.

### Undoing v2.6.0 as a whole

The v2.6.0 work arrived as one branch and was merged as one commit, so it comes
out as one:

```bash
git revert -m 1 <the merge commit>
```

That leaves v2.4.0 — what is live today — with the two fixes made since. To go
back to exactly what is published instead, `git checkout e304ef7`.

To test the update path itself — the thing that shows `v2.1.3 → v2.4.0` — open
`http://localhost:8123/?sw=1`. The offline shell is deliberately off on
localhost otherwise, or every edit would be invisible until the version is
bumped.

---

## Undoing any part of it

The v2.4.0 commits, each one thing. Any of them can be reverted on its own
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
npm run publish -- https://github.com/FranVuckovic/bulk.git
```

That republishes v2.1.3 and is byte-for-byte exact — verified before the
v2.4.0 publish. Nothing on this branch has touched `main` or your database.

---

## Publishing again, later

`dev/publish.sh` force-pushes over the public repo and replaces its history.
Ask before running it. The checklist:

1. `npm test` — 372, 0 failing.
2. Check `sw.js` VERSION reads `v2.11.0`. The publish set is derived from the
   `SHELL` array in that file, and `js/demo.js` was added to it — a test
   enforces that the shell covers the module graph, so this cannot silently go
   wrong.
3. `npm run publish -- https://github.com/FranVuckovic/bulk.git`

The published set is **29 files**: the 27 real paths in `SHELL` — the `'./'`
entry is a route, not a file — plus `sw.js`, which is never in its own shell
because it does not precache itself, plus the README the script generates. `docs/`, `test/`, `dev/`, `archive/` and
this file stay here. I dry-ran that selection: 28 present, 0 missing, nothing
from those directories, no occurrence of your name in any published file, and
the retired v1 plan still excluded.

**See `PUBLISHING.md`** for the tested answers on data, auto-update and
rollback. In short: your phone will not lose anything, and it will not update
itself — it downloads in the background and waits for your tap. It will show `v2.1.3 → v2.4.0` — though on that first update
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
