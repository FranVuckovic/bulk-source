# Bulk v2 — implementation status

**Against:** `Bulk-v2-update-kit`, 62 requirements
**Updated:** 20 August 2026
**Verification:** [`VERIFICATION.md`](../VERIFICATION.md) — 308 tests, 0 failing;
v2.6.0 interactive acceptance pending

v1 is archived at `archive/v1/` and tagged `v1.0`. It still runs and still reads
a v1 export.

## Done

| ID | Requirement | Evidence |
|---|---|---|
| PLAN-01 | Final plan encoded as the sole structured source | `data/plan-fopip-v2.json`, `js/plan.js`; all 33 × 6 resolve or startup fails |
| PLAN-02 | One A–F rotation is a first-class cycle | `js/cycle.js`; logging A then F reports B–E still owed |
| PLAN-03/04 | Manual cycle correction; block transition | `planCorrection` requires a reason; `advance-cycle` / `correct-cycle` on the Train screen |
| PLAN-05 | Rotation 1 is a baseline | resolves as `baseline`, no AMRAP, 1RM test with its own note |
| PLAN-06 | Recovery, specificity, test and bridge overrides | recovery 60%, test 53% of a normal rotation, no failure work in either |
| PLAN-07 | Static-hold experiment | from rotation 11, alternating, never in 15 or 31–33 |
| PLAN-08 | Readiness workflow | red drops session A from 26 sets to 19 and removes the AMRAP and holds |
| DATA-01 | No duplicate logical sets | `logicalKey` unique index; concurrent-tap test |
| DATA-02 | No duplicate active sessions | `startSessionAtomic`; concurrent-start test |
| DATA-03 | Atomic session completion | `finishSessionAtomic`; pointer released in the same transaction |
| DATA-04/05, SEC-04 | Staged, validated, atomic import; lossless export | parse → validate → preview → one transaction; photos and thumbnails round-trip; verified against a populated database |
| DATA-06 | Local civil dates plus UTC instants | `js/dates.js`; no `toISOString` civil date remains |
| DATA-07 | No active-draft unit corruption | drafts convert on load and on unit change |
| DATA-08 | Myo-rep identity preserved | flag stored; counts 2 in planned and logged volume |
| DATA-09 | Recoverable deletion | soft delete + audit entry + restore, for sessions and every plain store |
| DATA-10 | Cross-tab protection | `claimSingleTab`; the older tab goes read-only and says so |
| DATA-11 | Versioned migrations | v3 with backfill; v2→v3 test on populated data |
| DATA-12 | Correction and recovery centre | *Recently deleted* at the foot of History; Settings empties the bin |
| MATH-01 | Honest e1RM | `pct()` returns null off-table; unsupported RPE cannot be high-confidence |
| MATH-02 | Impossible prescriptions | a bodyweight lift is never prescribed a negative added load |
| MATH-04 | Head vs whole-muscle counting | `rollUpFromSets`, `plannedVsCompleted`; the Plan screen's stimulus figures use the same ruler |
| MATH-05 | Working-max review scoped and shown | proposals are scoped to the current block, counted in rotations, and list the sets behind them |
| ANA-01…14 | Analytics rebuild and the graphs | `js/analytics.js` is the only place a number is computed; charts on real date axes, per-rotation grouping, planned-vs-logged, redesigned records, chronological block comparison, tappable points |
| UX-01…10 | Train, set editor, AMRAP guard, history, photos | AMRAP writes zero sets and opens the editor; photos are stored, viewed, compared and deleted |
| PWA-01 | Atomic update | one versioned cache per build; the new worker waits and is applied by a tap |
| SEC-03 | Content security policy | `default-src 'none'`, script `'self'`, no inline script allowance |
| PERF-01 | 200 sessions / 6,000 sets | `test/performance.test.js`; the quadratic block comparison is gone |
| CONTENT-02 | Approved icon | installed; maskable rebuilt from master (the supplied one was a duplicate) |
| CONTENT-03 | FOPIP naming | Plan header; launcher stays Bulk |

## Judgement calls

**The gain-rate band and the calorie threshold are two different numbers.** The
plan documents give a target band of 0.4–0.5 kg/week early and 0.2–0.25 later,
and separately name 0.1 and 0.6 kg/week as the rates at which to change what you
eat. v1 used one number for both jobs, which is how it reported a rate as "on
target" while printing a band that did not contain it. Both are now stated, and
between them the instruction is to wait.

**A bodyweight lift cannot be given a negative plate.** Ten reps at RPE 8 off a
122 kg pull-up max works out below 90 kg of bodyweight. v1 subtracted anyway and
prescribed −7.5 kg, which then failed its own import validator. The load is
clamped at zero and the screen says the rep range is what makes the set hard.
No prescribed set, rep or RPE was changed.

**The maskable icon was wrong.** Byte-identical to the ordinary 512, so Android
would crop content never inset for it. Rebuilt from the master at 80% on the
app's dark surface.

**Deloads are not scheduled.** The kit keeps a Recovery Rotation 15, which is
implemented. The earlier trigger-only approach is retained alongside it.

**Old plan data is still present, but no longer published.** `data/plan-bulk-v1.json`
remains in the source so a v1 export can still be interpreted. Nothing loads
it, and the publish script no longer copies it — it was reaching the public
repository titled after its owner, for no reason at all.

**The offline shell is off on localhost.** Serving the whole shell from one
versioned cache is what makes an update atomic, and it is also what makes an
edit invisible until the version is bumped. `?sw=1` turns it back on when the
update path itself is what needs testing.

## Not done

| ID | Requirement | Note |
|---|---|---|
| MATH-03 | Prescription conflict validation at authoring time | The plan file is validated for resolvability at startup, but a slot whose percentage and RPE disagree is not flagged to the author |
| SEC-05 | Response headers | `frame-ancestors` and `X-Frame-Options` cannot come from a meta tag, and GitHub Pages does not allow custom headers |
| UX-09 (part) | Photo capture from the camera | The file picker covers it on Android and iOS; there is no in-app camera |

## v2.5 product-hardening addendum

The branch `codex/v2.5-product-hardening` addresses the owner's post-v2 audit
without changing the training split:

- demo warning visibility and access to demo mode;
- recoverable discard/restart of accidental active sessions;
- custom workouts that do not affect A–F rotation progress;
- manual index-set marking on any logged set;
- grouped set actions, wrapped Plan navigation and reliable collapsed state;
- dated measurement comparisons and bodyweight context;
- strength record evidence (weight, reps, RPE, date and e1RM), visible reps on
  heaviest load, recency-coloured load/reps scatter, clearer block calibration,
  and a defined working-max explanation;
- honest relative-strength trend and corrected lorry comparison;
- grouped/collapsible Progress and Plan summaries, with stimulus warning colour
  reserved for material rather than trivial overages;
- async UI writes now propagate failures to the central error presentation.
- v2.6 surfaces relative strength in the main verdict and Strength screen,
  divides the verdict into bodyweight/waist, strength, combined relative
  strength and plan-completion evidence, shows the selected lift's working max
  beside the exact best block set, and compresses Settings into five named
  groups with destructive controls collapsed.
- demo generation/isolation and every literal UI control binding now have
  automated regression coverage.

The exact change/evidence/defer matrix is in `product-audit-v2.5.md`. No plan
exercise, set, rep, RPE, rotation or block rule was changed in this pass.
