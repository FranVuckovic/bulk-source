# Bulk v2.5–v2.6 product audit

**Date:** 20 August 2026
**Branch:** `codex/v2.5-product-hardening`
**Shell:** `v2.6.0`
**Training content changed:** no

## Executive judgement

The app did not need a technology rewrite. Its strongest parts are the local,
offline data model, atomic IndexedDB operations, transparent analytics and
zero-dependency PWA shell. Replacing them with a framework or cloud backend
would add migration and sync risk without fixing the observed problems. The
main weaknesses were information hierarchy, unclear evidence labels, excessive
horizontal/vertical navigation, and several incomplete recovery paths.

This pass improves those weaknesses in small commits. Automated testing is
strong for calculations and persistence and now includes more user-action
failure paths. Real mobile interaction remains the release gate because the
browser automation controller could not attach to the open local browser.

## Request-to-change matrix

| Observation | Decision and evidence | State |
|---|---|---|
| Demo warning always visible; return button unclear | Banner now exists only in demo mode; demo is first in Settings and uses an isolated database | Implemented + tested |
| Start button too low | Session clock/control is above the exercise list | Implemented + tested |
| Accidental session cannot be abandoned | Discard uses recoverable deletion; session can be restored and a new one can start | Implemented + DB tested |
| Need custom workout | Custom exercise list/session added outside A–F rotation progress | Implemented + tested |
| Set actions form one confusing list | Actions grouped by writing values, tools and exercise changes | Implemented + render tested |
| Any set should be eligible as an index set | Explicit toggle stored with the set; prescribed index sets remain preselected | Implemented + tested |
| Plan tabs require horizontal scroll; workout E stuck open | Navigation wraps; workout collapse state respects the user | Implemented + tested |
| Measurement “then/now” lacks dates and context | Dates, selectable site trend and bodyweight comparison added | Implemented + render tested |
| Strength chart and records lack context | Records lead; set weight/reps/RPE/date visible; e1RM primary; load record includes reps | Implemented + tested |
| Lift names require sideways scrolling | Compact wrapped lift chooser replaces the horizontal strip | Implemented + tested |
| Block comparison makes baseline look like failure | Baseline labelled calibration and endpoints/dates made explicit | Implemented + tested |
| Working max is confusing | It is named as a stable prescription anchor and separated from best evidence | Implemented + tested |
| Weekly stimulus is orange almost everywhere | Small overages are informational blue; orange means materially above; groups collapse | Implemented + tested |
| Summary is a stack of unrelated boxes | Primary evidence grouped; secondary evidence collapses | Implemented + render tested |
| 960 tonnes compared to two lorries | Uses a 44-tonne articulated-lorry payload equivalent | Corrected + tested |
| Relative strength could do more | Nearby bodyweight matching and an honest ratio trend added | Implemented + tested |
| Save can silently fail or look inert | UI write promises reach the central error handler; niggle and form-check saves confirm success | Fixed + failure tested |
| Relative strength remains buried | It now has a visible verdict group and a first-class Strength section before diagnostics | Implemented + tested |
| “Is this going to plan?” mixes different questions | Visible groups now separate bodyweight/waist, strength, relative strength and plan completion | Implemented + render tested |
| Settings is a long undifferentiated page | Demo remains first; routine controls are open; backup, privacy, deletion and build groups collapse independently | Implemented + render tested |
| Working max and evidence remain abstract | Selected lift now shows the prescription anchor beside the exact best eligible set, with weight/reps/RPE/date | Implemented + tested |

## Training-volume finding

The orange-heavy display was partly a visualization defect and partly real.
Typical rotations showed small head-level overages (for example side delts,
short-head biceps and forearms) that did not deserve the same warning as a
large overage. Whole-muscle roll-ups remain genuinely high: roughly 30 chest,
27 triceps, 22 back and 21 biceps effective weekly sets in the audited typical
rotations. Glutes are below the app's displayed band.

That is not enough evidence to rewrite the plan. Whole-muscle roll-ups include
fractional indirect work, individual tolerance varies, and actual completion,
performance, soreness and recovery matter more than the planned total alone.
The app now communicates severity more honestly. Any training-content change
must be a separate owner-approved decision after reviewing real logged data.

## Measurement protocol decision

Do not rename the existing relaxed-arm fields: that would mix two different
protocols and corrupt the historical trend. A flexed/tensed arm is a legitimate
additional measurement if maximum arm size is important, but it should be a
new left/right series with its own instructions. Keep quad/thigh as a relaxed,
repeatable circumference at a precisely defined site; flexing the quadriceps
adds contraction-position noise without solving the more important placement
problem. Consistency of site, posture, tape tension and time of day matters more
than which optional protocol is chosen.

No measurement schema change was made because adding flexed-arm history is a
product/data decision the owner should explicitly approve.

## Explicitly deferred

- No training split or prescription changes.
- No strength/body-measurement percentiles. Useful percentiles need a named,
  comparable population, sex/age/training definitions and trustworthy source;
  a generic label would look precise while being misleading.
- No framework migration or cloud account/sync layer.
- No automatic phone-update opt-out. An installed PWA updates its code from the
  same origin while keeping IndexedDB per browser profile. A user-approved
  “Update now” flow exists between versioned builds, but browsers still control
  update checks and old caches cannot be promised indefinitely.
- No live publication. GitHub write authorization and explicit release approval
  are still required.

## Remaining release risks

1. Complete the real-browser checklist in `VERIFICATION.md`, particularly long
   phone labels, collapse controls, sheet behavior, demo switching and reload
   persistence.
2. Exercise storage failure presentation in a browser if practical (quota or a
   forced test failure), not only in unit tests.
3. Verify the service-worker update from the currently published version and
   an offline relaunch on the actual phone.
4. Review the visual concept with the owner before applying any broader visual
   language change. The current code changes prioritize clarity and safety.

## Safe release and rollback

1. Export the phone's current data and verify the archive before updating.
2. Push this branch to `bulk-source` and review it before merging.
3. Tag the accepted source commit (for example `v2.6.0`).
4. Run `npm test`, complete the acceptance checklist, then publish `bulk` only
   with explicit approval.
5. If the release is worse, publish the prior tagged source shell again. The
   database schema remains v3, so this UI pass does not require a data
   downgrade.
