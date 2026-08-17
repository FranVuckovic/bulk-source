# What changed in the plan, and why

**Revision 2 · August 2026 · applied to `data/plan-bulk-v1.json`**

The plan was already good. This revision does not restructure it — the rotation,
the session order, the working-max protocol and the measurement design are all
untouched. What changed is where the stimulus sits inside that structure.

Everything here was approved item by item. Nothing was changed on the app's own
judgement.

---

## Summary

| | Before | After |
|---|---|---|
| Sets per rotation | 172 | 189 |
| Heavy bench exposures per week | 1 single + AMRAP | **2 singles + AMRAP** |
| Upper chest (fractional sets) | 13.9 | **15.9** |
| Triceps long head | 11.0 at 3× | **13.0 at 4×** |
| Biceps long head | 13.0 at 3× | **16.5 at 4×** |
| Calves | 8.0 | **12.0** |
| Back sets taken to failure | 0 | **6.2** |
| Sessions carrying myo-reps | 0 | 3 |
| Scheduled deloads | week 6 of each block | **none — they are earned** |

Session lengths: A 34, B 32, C 30, D 34, E 24, F 34. No set was cut to save
time; the two reductions below are both risk management.

---

## 1 · A second heavy bench exposure

**Session C now opens with a primer single at RPE 7.5**, before the 5×5.

Heavy pressing singles are not very fatiguing — far less than heavy squats or
pulls — and frequency is the strongest single predictor of strength gain there
is: each added bench day up to about four is worth roughly 28% faster progress
even with volume matched. The Eastern-bloc bench programmes that produced the
best pressers in history run three to four sessions a week, almost entirely
submaximal, on the principle of *build and practise, do not test*.

The primer is one full RPE point below session A's cap, so it is practice rather
than a test, and it potentiates the volume work that follows rather than
compromising it.

**In blocks 4 and 5, session A takes two singles above 90%** instead of one —
which is exactly the maximum the plan's own heavy-single rules already permit.
This is encoded as `setsByBlock` on the slot, so it happens automatically.

## 2 · Back work now finishes at failure

Last set to genuine failure on **every row and face pull** — `rowCSR` in A, D
and E, and `facepull` in D. The chin-up in D also finishes at failure.

Proximity to failure has a clear positive relationship with hypertrophy and
essentially **no relationship with strength gain**. Your back carried 28 sets a
week and not one of them within a rep of failure — the largest pool of
under-stimulated volume in the plan. Because rows are not the competition lift,
this costs the bench nothing.

**Weighted pull-ups and wide pull-ups stay at RPE 8.** They are index sets, and
failure would corrupt the measurement — but that is not the main reason. A
weighted pull-up at 4–6 reps fails at the grip, the biceps tendon and the elbow
before the lats, so the last rep buys poor stimulus at the most exposed joint in
the plan. The chin-up in D carries the failure stimulus for the pulling pattern
instead: lighter, unmeasured, and safe.

## 3 · Triceps long head promoted

The head bench pressing barely touches, and a named aesthetic priority, was
sitting 7th of 10 in session A and 8th of 10 in session D — done after 25 sets,
tired, in the two longest sessions of the rotation.

- **A:** overhead extension moved from 7th to 6th, ahead of the laterals.
- **D:** moved from 8th to 5th, and trimmed from 4 sets to 3.
- **C:** overhead extension added, 3×12. C was the shortest session and had no
  arm work at all.

Frequency goes from 3 to 4, volume from 11.0 to 13.0.

**Elbow insurance:** session B's skullcrushers drop from 3 sets to 2, with 2
sets of cable pushdown added alongside. Skullcrushers are the most elbow-hostile
triceps movement in the plan and they stay — just not all of the volume in one
place. Total triceps still rose from ~26 to ~29 whole-muscle sets a week, which
is why D lost a set: elbows are the most likely thing to derail this plan.

## 4 · Upper chest gets more direct pressing, and both incline variants

`inclineDB` 3→4 sets in A. Session C's incline becomes **`inclineSmith`, 5 sets**.

The blocks already specified dumbbells for blocks 0, 1 and 3 and Smith for
2, 4 and 5 — but every session hardcoded dumbbells, so the Smith rotation would
never actually have happened. Rather than rotating, both now run every week:

- **Dumbbells in A** for the longer stretch at the bottom, where the growth
  evidence is strongest.
- **Smith in C** for precise loading and 1.25 kg progression steps, which
  dumbbells cannot give you.

Two clean progression lines at once, both mechanisms every week.

## 5 · A third biceps exposure

`curlIncline` 3×10 added to session A. Session A is a back day with no biceps
work; short-head frequency was 2, the lowest of any upper-body muscle.

## 6 · Pull-ups and dips moved earlier

- **A:** weighted pull-up from 4th to **3rd**, ahead of the incline press.
- **E:** weighted dip from 3rd to **2nd**, ahead of the bench variation.

Both are tracked strength lifts that were being done behind two pressing
exercises. Pure reordering — no added volume, no added time. The variation at
RPE 7.5 is far less fatigue-sensitive than a lift you are tracking a max on.

## 7 · Bench variation changes rep range by block

4×4 in the intensification blocks (2, 4, 5), **4×6 in the accumulation blocks**
(0, 1, 3). More time under tension when the block's job is size, heavier when
its job is strength. Encoded as `repsByBlock`.

## 8 · Calves

`calfStand` 4→6 in B, `calfSeat` 4→6 in F, both moved to the end of their
sessions. 8 sets to 12, in the slot where they cost nothing.

## 9 · Myo-reps on three isolation exercises

Final set becomes a myo-rep cluster on **overhead extension in A**, **EZ curl in
E**, and **lateral raise in F**. Activation set to failure, 15–20 s rest, then
3–5 mini-sets of 3–5 reps.

A trial comparing myo-reps against straight sets found the same size and
strength gains with roughly 30% less volume load in about 60% less time. That is
an efficiency result, not a superiority one — so they are **appended** to
existing work rather than replacing sets. You are not short of time; you are
chasing stimulus.

The app counts a myo-rep cluster as **two sets** for volume, not five. Counting
each mini-set separately would inflate every weekly total the moment the
technique is used.

## 10 · Static holds, finally in the plan

2–3 holds of 5–10 seconds at 105–115% of max, rack pins, spotter, session A,
**from block 2 onwards**. They were described in `bulk-plan.md` and existed in no
session, so they would never have happened.

They are gated with `fromBlock: 2` and simply do not appear on the Train screen
before then — coming off a cut, hanging 115% of your max on your elbows before
the connective tissue re-adapts is how you buy a layoff. They count **zero**
hypertrophy volume: a seven-second hold is a neural and connective exposure, not
a growth stimulus.

## 11 · Scheduled deloads removed

There is now **no scheduled deload**. The plan previously specified week 6 of
every block, and that was never encoded anyway.

The evidence is thinner than the folklore. A one-week deload at a programme's
midpoint has been found to slightly *reduce* strength gains against training
through, with no hypertrophy benefit; complete cessation actively impaired
strength with more soreness and less motivation; and the risk of genuine
non-functional overreaching without deloading is low.

**What replaces it:** the app watches the triggers this plan already names — a
top set more than 5% below your rolling average, sleep under 7 hours, two or
more niggles in a block — and offers a deload when **two fire together**. One
trigger is a bad week. Two is a pattern. When you take one: keep all six
sessions, cut volume about 45%, drop to RPE 7, nothing to failure, one rotation.

---

## What was deliberately not changed

- **The rotation order.** A never directly follows C or E; it follows F, the leg
  day. That constraint came from a controlled trial and it still holds.
- **Speed bench.** Volume and load equated, maximal intent produced +18.2% on
  the bench against +9.7% for deliberately slow lifting. It is the cheapest
  bench exposure you own and it counts zero volume by design.
- **Front delts.** Still no direct work. Four press days plus the overhead
  ladder already put them at 17.6 fractional sets.
- **The working-max protocol.** Unchanged, and still the best decision in the
  document.
- **Session lengths.** Nothing was cut for time. A, C and D each run 5–10
  minutes longer than before.

## The honest risk

Triceps now sit near 29 whole-muscle sets a week across four pressing days, plus
dips, plus the overhead ladder, plus more heavy singles. Every change in this
revision pushes the same joint. The skullcrusher split and D's trimmed set are
the insurance.

**If two elbow niggles appear in one block, the plan's own rule applies: rotate
the aggravating variation out.** Do not push through it. The app will flag it.
