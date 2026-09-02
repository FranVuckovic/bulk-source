# Bench variations: the ratios, the double pause, and where two of them fit

Written 2 September 2026, after the v2.21.0 variation work shipped. This is a
**proposal**. Nothing in `data/plan-fopip-v2.json` has been changed by it.

---

## 1. Are the ratios good?

Shipped in v2.21.0, as `maxFrom: { exerciseId: 'benchComp', ratio }`:

| Variation | Ratio | At a 120 kg competition max |
|---|---|---|
| Wide grip | 0.97 | 117.5 |
| Feet-up | 0.92 | 110.0 |
| Close grip | 0.90 | 108.0 |
| Long pause, 3 s | 0.88 | 105.6 |
| Pin press | 0.88 | 105.6 |

As population averages these are defensible. As *your* numbers they have one
structural problem and two specific ones.

### The structural problem: the anchor

Every ratio is a fraction of the competition max. Your competition max is
currently derived from touch-and-go AMRAPs with a heavy bounce — 8 reps at 87%
where a paused lifter would expect 4–5. That gap is elastic energy, not
strength.

So the ratios are not wrong relative to each other. They are all measured
against a number that is itself inflated in the *specific* direction that
matters here: everything that removes the bounce (long pause, pin press,
double pause) will come out lower than the ratio predicts, because the
denominator includes a bounce those lifts do not get.

This fixes itself the moment the 120 kg paused single lands and gets confirmed
as the working max. Until then, expect the paused variations to feel harder
than the prescription says, and treat that as information about the anchor
rather than about a bad day.

### Close grip: 0.90 → 0.88

0.88–0.93 is the usual range. You sit at the low end of it, not the middle,
because close grip shifts load onto the triceps and the triceps are your
identified gap — long head at 9.0 sets/week against 20.5 for the lateral head,
and a sticking point at the pec-to-triceps handoff. A lifter whose triceps are
the limiter loses more to a close grip than average.

### Pin press: 0.88 → 0.85, and it needs a recorded pin height

This ratio is meaningless without the pin height attached to it. A pin press
set *above* the sticking point can exceed 1.00; set at chest level from a dead
stop it can be 0.80. Yours is specified at "about 2 cm below where you stall",
which is a low-to-mid pin with no stretch reflex at all — 0.85 is the honest
starting number, and the hole number must go in the note field every session
or the lift is not comparable to itself.

### Wide grip and feet-up: ratios fine, priority wrong

0.97 and 0.92 are both reasonable. But wide grip shortens the range and
*reduces* triceps demand, which is the opposite of what you need, and feet-up
trains trunk stability, which is not what is limiting you. Both are fine
lifts. Neither is one of your two best right now.

---

## 2. Double-pause bench

**Yes. It is the best-matched variation on the list for your profile, and I
would run it as the primary.**

Four reasons, in order of weight:

1. **It attacks the sticking point under your own control.** Your stall is the
   transition zone — upper arm horizontal and just above. A pause held at that
   height loads you isometrically at exactly the joint angle that fails. The
   pin press is trying to do the same thing, but it requires you to *guess*
   the height and set steel there. The double pause lets your own arm find it
   every rep. Given you described the stall as "somewhere around" horizontal,
   that self-locating property is worth a lot.

2. **It removes the bounce twice.** Pause one kills the stretch reflex off the
   chest. Pause two kills the momentum you carry through the bottom third.
   Your measured problem is that the elastic gets you past the bottom and runs
   out where the triceps have to take over — a double pause forbids precisely
   that sequence.

3. **It trains the handoff in the movement.** The pin press trains a dead-stop
   press from near the sticking point; that is a different motor task from
   decelerating, holding, and re-accelerating mid-rep. The double pause is the
   competition lift with the cheat removed, not a separate lift.

4. **It is honest.** You have said you cannot yet trust your RPE, and that the
   same set can feel like 7 or 9. A double pause is very hard to fake or to
   accidentally make easier with technique drift. The number it produces means
   something.

### The caveats

- **Time under load roughly doubles per rep.** Keep reps at 3–5. Past that it
  becomes a metabolic exercise and stops being a strength lift.
- **The second pause position must be consistent** or the load is not
  comparable session to session. Pick a reference — about 5 cm off the chest,
  elbows just below horizontal — and film a set occasionally to check you are
  still stopping in the same place.
- **RPE will read higher** than the same load and reps would in competition
  bench. That is the lift working, not you regressing.
- **Ratio: start at 0.82.** Lower than the 3 s long pause (0.88) because the
  second pause sits at the worst leverage point in the lift, whereas a chest
  pause, however long, is held in a braced and packed position. This is the
  least-established number in the table — double-pause bench is not common
  enough to have reliable population data — so it is also the one to
  recalibrate first, after three exposures.

---

## 3. Where the two variations go

You asked whether the volume or the speed work is the place. Here is the
reasoning, including where it revises what I said last time.

### What I said before, and what changes

I argued against two variations in one week on the grounds that C2 is only
three sets and splitting it kills both progression and calibration. **That
argument still holds and I am not walking it back.** What it argued against
was splitting *one slot*. It said nothing about using a *second* slot. That is
the difference.

### C2 becomes the double-pause bench

C2 is 3 × 4–6 @ RPE 8, 180 s rest, immediately after the AMRAP. It is the slot
whose entire purpose is "the variation", it is heavy and low-rep, and it comes
when you are warm and specific. It is the right home for the double pause, and
the block schedule already drives it, so this is a one-line change.

### F1 speed bench runs close-grip — same loads, same RPE

F1 is 5 × 3 at 62–68% of the working max, RPE 5.5–6. It is deliberately cheap
because a heavy A follows it. **Do not put a heavy variation there** — a
double pause at RPE 8 before a heavy A is a bad trade and would wreck the one
session in the plan that exists to be cheap.

But the grip is free. Speed work at 64% is low-fatigue whatever the grip, and
running it close-grip makes every speed rep a triceps-biased rep at no
additional cost. That gets you the second variation, weekly, without touching
a single competition-specific set.

The trade, named honestly: speed bench also exists to reinforce the
competition groove, and a close grip is not that groove. I think the trade is
worth taking, because you already press competition-style in A (single plus
back-offs), E (single plus 5×5) and C (the AMRAP) — three of four exposures —
and your problem is not the groove, it is the handoff.

Loads follow the close-grip max, not the competition max: 64% of 105 is
67.5 kg, not 64% of 120.

### What I did not touch, and why

- **E2, the 5×5 at RPE 8.** This is your largest block of competition-specific
  volume and the main hypertrophy driver. Five sets is enough that splitting
  it is *technically* viable in a way C2's three sets were not — but it would
  fragment the one thing in the plan that is working, to buy a variation slot
  you no longer need once C2 and F1 are doing the job.
- **A's single and back-offs.** That is your heavy competition exposure. It
  stays competition.

### The block schedule

If you take this, the variation schedule simplifies, because the double pause
is close to a superset of what the long pause and the pin press each do for
you — one kills the bounce, the other attacks the sticking point, the double
pause does both:

| Block | Rotations | Now | Proposed |
|---|---|---|---|
| 0 Baseline | 1–2 | Close grip | **Double pause** |
| 1 Accumulation I | 3–10 | Close grip | **Double pause** |
| 2 Intensification I | 11–14 | Pin press | **Double pause** |
| 3 Recovery | 15 | Close grip | Close grip |
| 4 Accumulation II | 16–23 | Pin press | Pin press |
| 5 Intensification II | 24–27 | Long pause | Long pause |
| 6 Specificity | 28–30 | Long pause | Long pause |
| 7 Taper | 31 | Close grip | Close grip |
| 8 Test | 32 | — | — |
| 9 Bridge | 33 | Close grip | Close grip |

Pin press moves to block 4 rather than disappearing, because by rotation 16
you will have fifteen rotations of double-pause data telling you where you
actually stall — which is when setting pins at that height stops being a
guess. Close grip is present every single week regardless, in F1.

---

## 4. The ratios, explained, in kilos

A ratio is the variation's own **1RM** as a fraction of the competition 1RM.
It is not the working weight. The app does two steps:

1. variation max = competition working max × ratio
2. working load = variation max × the RPE table's percentage for that slot's
   reps and RPE

So a 3 × 5 @ RPE 8 is 81.1% of the *variation's* max, not of the competition
max, and not of 81.1% of 120.

At a confirmed 120 kg competition max, rounded to 2.5 kg:

| Variation | Ratio | Its max | 3×6 @8 | 3×5 @8 | 3×4 @8 | Speed 64% |
|---|---|---|---|---|---|---|
| Competition | 1.00 | 120.0 | 95.0 | 97.5 | 100.0 | 77.5 |
| Wide grip | 0.97 | 117.5 | 92.5 | 95.0 | 97.5 | 75.0 |
| Feet-up | 0.92 | 110.0 | 87.5 | 90.0 | 92.5 | 70.0 |
| Close grip | **0.88** | 105.0 | 82.5 | 85.0 | 87.5 | **67.5** |
| Long pause 3 s | 0.88 | 105.0 | 82.5 | 85.0 | 87.5 | 67.5 |
| Pin press | **0.85** | 102.5 | 80.0 | 82.5 | 85.0 | 65.0 |
| Double pause | **0.82** | 97.5 | 77.5 | **80.0** | 82.5 | 62.5 |

Bold = changed from what is currently shipped.

You never type any of this. Confirm 120 as the working max and every row
recalculates from it.

### Recalibrating a ratio

Set the weight from the percentage. Log the RPE as information. After three or
four exposures, look at what the RPE actually came out as:

- consistently 1+ point above the target → the ratio is too high, drop it 0.02
- consistently 1+ point below → raise it 0.02
- scattered either side → the ratio is right and your RPE is still settling

Do not adjust on one session. Two of your sets a week apart at identical reps
and RPE moved 7.5 kg; a single reading cannot separate a bad ratio from a good
week.

---

## What I need from you

This is a training-content change, so nothing is implemented. To proceed I
need a yes on:

1. Double-pause bench as a new exercise at ratio **0.82**, in C2.
2. Close grip **0.90 → 0.88**, pin press **0.88 → 0.85**.
3. F1 speed bench running close-grip at the same percentages and RPE.
4. The block schedule above (double pause through block 2, pin press from
   block 4).

Any subset is fine — they are independent.
