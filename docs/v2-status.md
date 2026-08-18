# Bulk v2 — implementation status

**Against:** `Bulk-v2-update-kit`, 62 requirements
**Updated:** 19 August 2026

v1 is archived at `archive/v1/` and tagged `v1.0`. It still runs and still reads
a v1 export.

## Done

| ID | Requirement | Evidence |
|---|---|---|
| PLAN-01 | Final plan encoded as the sole structured source | `data/plan-fopip-v2.json`, `js/plan.js`; all 33 × 6 resolve or startup fails |
| PLAN-02 | One A–F rotation is a first-class cycle | `js/cycle.js`; logging A then F reports B–E still owed |
| PLAN-05 | Rotation 1 is a baseline | resolves as `baseline`, no AMRAP, 1RM test with its own note |
| PLAN-06 | Recovery, specificity, test and bridge overrides | recovery 60%, test 53% of a normal rotation, no failure work in either |
| PLAN-07 | Static-hold experiment | from rotation 11, alternating, never in 15 or 31–33 |
| PLAN-08 | Readiness workflow (engine) | `applyReadiness`; yellow trims, red removes AMRAP/holds/grinding |
| DATA-01 | No duplicate logical sets | `logicalKey` unique index; concurrent-tap test |
| DATA-02 | No duplicate active sessions | `startSessionAtomic`; concurrent-start test |
| DATA-03 | Atomic session completion | `finishSessionAtomic`; pointer released in the same transaction |
| DATA-06 | Local civil dates plus UTC instants | `js/dates.js`; no `toISOString` civil date remains |
| DATA-07 | No active-draft unit corruption | drafts convert on load and on unit change |
| DATA-08 | Myo-rep identity preserved | flag stored; counts 2 in planned and logged volume |
| DATA-09 | Recoverable deletion | soft delete + audit entry + restore |
| DATA-11 | Versioned migrations | v3 with backfill; v2→v3 test on populated data |
| MATH-01 | Honest e1RM | `pct()` returns null off-table; unsupported RPE cannot be high-confidence |
| MATH-04 | Head vs whole-muscle counting | `rollUpFromSets`, `plannedVsCompleted` |
| CONTENT-02 | Approved icon | installed; maskable rebuilt from master (supplied one was a duplicate) |
| CONTENT-03 | FOPIP naming | Plan header; launcher stays Bulk |

## Not done

Ordered as the audit sequences them. Each depends on what is above it.

| ID | Requirement | Note |
|---|---|---|
| DATA-04/05, SEC-04 | Staged, validated, atomic import; lossless export | Import is still destructive-on-file-selection and non-atomic. **Do not import into a populated database.** |
| DATA-10 | Cross-tab protection | No lock between tabs |
| DATA-12 | Correction and recovery centre | Soft delete exists; no UI to browse or restore |
| PLAN-03/04 | Manual cycle/block correction; block transition | Engine and audit contract exist; no UI, and the cycle does not yet advance on its own |
| MATH-02/03/05 | Prescription conflict validation; index eligibility | Back-off basis fixed in data; eligibility rules not rebuilt |
| ANA-01…14 | Analytics rebuild and 18 graphs | Progress still uses the v1 pipeline: calendar weeks, block comparison bugs, unit-labelled 140 target |
| UX-01…10 | Train/set editor/AMRAP guard/history/photos/Android | AMRAP can still be one-tapped to its nominal reps; photos unimplemented |
| PWA-01, SEC-03/05 | Atomic update, CSP, offline verification | Cache bumped; update path and CSP not rebuilt |
| PERF-01 | 200 sessions / 6,000 sets | Quadratic path in block comparison remains |

## Judgement calls

**The maskable icon was wrong.** Byte-identical to the ordinary 512, so Android
would crop content never inset for it. Rebuilt from the master at 80% on the
app's dark surface.

**Deloads are not scheduled.** The kit keeps a Recovery Rotation 15, which is
implemented. The earlier trigger-only approach is retained alongside it.

**Old plan data is still present.** `data/plan-bulk-v1.json` remains so a v1
export can still be interpreted. Nothing loads it.

**Sample data is stale.** `dev/sample-data.html` writes v1-shaped records
against the old plan. It will produce misleading results until rebuilt.
