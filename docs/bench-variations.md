# Bench variations: ratios as ranges, the weekly single, and three whole-plan options

> **Status, 4 September 2026:** implemented in v2.24.0 — the double pause at 0.82, close grip 0.88, pin press 0.85, and the block schedule. The wide-grip and feet-up ratios are unchanged and unused so far.

Written 2–3 September 2026. This is a **proposal**. Nothing in
`data/plan-fopip-v2.json` has been changed by any of it.

Supersedes the single-number version of this document from 2 September.

---

## 1. The ratios, as ranges

A ratio is the variation's own **1RM** as a fraction of the competition 1RM.
It is not the working weight — the app multiplies by the ratio to get the
variation's max, then applies the RPE table to get the load.

Two ranges are given. **General** is the spread you see across lifters.
**Yours** is the narrower band you should expect to land in, for reasons given
under each. The app takes one number, so "start at" is what to enter; the
range tells you where recalibration can legitimately end up before something
is wrong with the lift rather than the ratio.

| Variation | General | Yours | Yours in kg @ 120 | Start at | = kg |
|---|---|---|---|---|---|
| Wide grip | 0.95–1.02 | 0.95–0.98 | 115.0–117.5 | 0.97 | 117.5 |
| Feet-up | 0.85–0.95 | 0.90–0.94 | 107.5–112.5 | 0.92 | 110.0 |
| Close grip | 0.85–0.95 | **0.86–0.90** | 102.5–107.5 | **0.88** | 105.0 |
| Long pause, 3 s | 0.83–0.92 | 0.84–0.88 | 100.0–105.0 | 0.88 | 105.0 |
| Pin press | 0.78–0.95 | **0.82–0.88** | 97.5–105.0 | **0.85** | 102.5 |
| Double pause | 0.75–0.88 | **0.78–0.85** | 92.5–102.5 | **0.82** | 97.5 |

Bold = different from what is shipped in v2.21.0 (close grip 0.90, pin 0.88;
double pause does not exist yet).

**Confidence.** These ranges come from practice and coaching convention, not
from controlled studies — nobody has run a trial establishing what fraction of
a competition bench a double pause is. Wide grip and close grip are the
best-established. Pin press has the widest general range because it is
entirely determined by pin height. Double pause is the least established of
all, and therefore the one to recalibrate first.

**Why yours is narrower than general, per lift:**

- **Wide grip** — you do not currently bench wide, and the plan specifies only
  a thumb-length wider, paused. That is a mild change with a shorter range, so
  you land near the top of the band but not above 1.00.
- **Feet-up** — you use a moderate upper-back arch, not a big leg-drive setup,
  so you lose less than the average lifter when the feet come up.
- **Close grip** — bottom half of the band. Close grip shifts load onto the
  triceps and the triceps are your identified gap: long head 9.0 sets/week
  against 20.5 for the lateral head, and a stall at the pec-to-triceps
  handoff. A lifter whose triceps limit them loses more to a close grip than
  average.
- **Long pause** — the 0.88 in the app sits at the very top of your band.
  Expect it to come down. See the anchor note below.
- **Pin press** — your pins are specified about 2 cm *below* where you stall,
  which is a low-to-mid pin from a dead stop with no stretch reflex at all.
  That is the harder half of the general range. **The pin height must be
  recorded in the set note every session** or the number is not comparable to
  itself, and the ratio means nothing.
- **Double pause** — a second pause at the transition sits at the worst
  leverage point in the lift, where a chest pause, however long, is held
  braced and packed. So it is meaningfully below the long pause, and its band
  is wide because how long you hold pause two changes it a lot.

### The anchor, and why your new protocol fixes it

Every one of these is a fraction of your competition max, and until now that
max came from touch-and-go AMRAPs with a heavy bounce — 8 reps at 87% where a
paused lifter expects 4–5. That gap is elastic energy, not strength. So every
paused variation was being loaded off a denominator inflated in exactly the
direction that matters.

**A weekly heavy paused single fixes this at the root.** Once the max is a
number you actually pressed, paused, with a spotter watching, the ratios stop
being fractions of an estimate and become fractions of a fact. That is the
single biggest improvement available to this whole system, and it is the
reason the ranges above can be trusted at face value from the week you start.

---

## 2. Double-pause bench

**Yes. It is the best-matched variation on the list for your profile, and I
would run it as the primary.**

1. **It locates your sticking point by feel, not by guess.** You described the
   stall as "somewhere around" upper arm horizontal. A pin press asks you to
   guess that height and set steel there. A double pause lets your own arm
   find it, every rep.
2. **It kills the bounce twice** — pause one removes the stretch reflex off
   the chest, pause two removes the momentum through the bottom third. Your
   failure mode is the elastic carrying you past the bottom and running out at
   the handoff. A double pause forbids exactly that sequence.
3. **It trains the handoff inside the movement.** A pin press is a dead-stop
   press. Decelerating, holding, and re-accelerating mid-rep is a different
   motor task, and it is the one you actually fail.
4. **It is hard to fake.** You have said the same set can feel like RPE 7 or
   9. This one produces a number that means something.

Caveats: reps 3–5, no more (time under load roughly doubles per rep, and past
5 it becomes a metabolic exercise); the second pause position must be
consistent (≈5 cm off the chest, elbows just under horizontal — film a set
occasionally); RPE will read higher than the same load and reps in competition
bench, which is the lift working, not you regressing.

---

## 3. The weekly single changes more than the max

Your new rule — one heavy single a week, that becomes the working max,
+2.5 kg each week until it stops moving — has three consequences worth naming
before choosing a plan.

**a. It makes the AMRAP redundant, and arguably harmful.** An AMRAP exists to
*estimate* a max you have not measured. You will now be measuring one every
week. Keeping both means the plan has two competing sources of truth, and the
weaker one is the same set that produced the inflated numbers in the first
place. C1 becomes the single in all three options below.

**b. The app will not propose the increase for you.** `proposeMidBlockBump`
requires an observation more than **5%** above the current working max, in two
consecutive weeks. +2.5 kg on 120 is +2.1%. So mid-block the app will stay
silent and you will confirm the new max by hand each week — which is fine, and
is what the confirm button is for. Worth knowing so you do not wait for a
prompt that will not come. If you want, I can add a rule that a *measured*
index single at RPE 9+ proposes itself immediately regardless of the 5%
threshold; that is a code change, not a training change, so say the word.

**c. +2.5 kg/week is roughly +10 kg/month.** That is a fast but defensible
rate on a bulk at +0.79 kg/week bodyweight, and the honest expectation is that
it works for four to eight weeks and then stops. The plan for *when* it stops
matters more than the plan for while it works: the first miss is information,
not failure, and the right response is to hold the max where it is and let the
variations carry the progress for a block.

---

## 4. Three whole-plan options

All three share: C1 becomes the weekly heavy single, confirmed as the max.
They differ in how much of the plan the variations take over.

Current bench exposures per rotation:

| | Now |
|---|---|
| A2 | Competition single @ RPE 8 (index set) |
| A3 | Competition back-offs 3 × 3 @ 8 |
| C1 | Competition AMRAP @ 86% (index set) |
| C2 | Variation 3 × 4–6 @ 8 |
| E1 | Competition single @ 7.5 |
| E2 | Competition volume 5 × 5 @ 8 |
| F1 | Speed bench 5 × 3 @ 65%, RPE 6 |

### Option 1 — Measure once, press competition everywhere else

| | Change |
|---|---|
| C1 | AMRAP → **heavy single**, +2.5 kg/week, confirm as max |
| C2 | **Double-pause bench**, 3 × 4–6 @ 8 |
| A2 | Single drops to RPE 7.5, so it does not compete with C |
| Everything else | Unchanged |

**Pros.** Smallest change from what you are running. Every other bench set
stays the competition lift, so technique practice is maximal and nothing about
the plan's identity moves. One new lift at a time means its ratio calibrates
cleanly with nothing else confounding it. Easiest to attribute a result to a
cause.

**Cons.** Only three sets a week attack the triceps handoff, which is the
thing actually limiting you. The triceps long-head gap (9.0 vs 20.5 sets)
closes slowly. F1's speed work stays a low-value slot — 5 × 3 at 65% is
neither much stimulus nor much information.

### Option 2 — Measure once, two variations (recommended)

| | Change |
|---|---|
| C1 | AMRAP → **heavy single**, +2.5 kg/week, confirm as max |
| C2 | **Double-pause bench**, 3 × 4–6 @ 8 |
| F1 | Speed bench runs **close grip**, same 65%, same RPE 6 |
| A2 | Single drops to RPE 7.5 |
| Everything else | Unchanged |

**Pros.** Both variations every week at essentially zero added fatigue — 65%
is cheap whatever the grip, and F is deliberately the light session because a
heavy A follows it. No competition set is lost from A or E. The handoff gets
worked heavy (C2) and fast (F1), which is the right pairing for a
transition-zone stall. Close-grip speed work also builds the triceps' rate of
force development, which is specifically what a handoff failure needs.

**Cons.** Speed bench also exists to rehearse the competition groove, and a
close grip is not that groove — you trade groove practice for triceps
specificity. Two ratios calibrating at once is slightly muddier than one. If
the close grip aggravates your elbows at speed, you will not know whether it
was the grip or the accumulated volume.

**Why I recommend it.** You already press competition-style in A (single plus
back-offs), C (the single) and E (single plus 5 × 5) — that is three of four
sessions. Groove is not your problem. The handoff is.

### Option 3 — Measure once, variation-led volume

| | Change |
|---|---|
| C1 | AMRAP → **heavy single**, +2.5 kg/week, confirm as max |
| C2 | **Double-pause bench**, 3 × 4–6 @ 8 |
| A3 | Back-offs become **close grip**, 3 × 4 @ 8 |
| F1 | Speed bench runs **close grip**, same 65%, same RPE 6 |
| A2 | Single drops to RPE 7.5 |
| E1, E2 | Unchanged — competition single and 5 × 5 |

**Pros.** The strongest triceps and sticking-point stimulus available inside
the current session structure: heavy close grip in A, double pause in C, fast
close grip in F. The weekly measured single supplies all the specificity the
plan needs, which is precisely the argument for letting the *volume* be
non-specific. If the handoff is really the limiter, this closes it fastest.

**Cons.** A's back-offs at heavy competition weight are your best "heavy
competition reps while already fatigued" — the closest thing in the plan to a
third attempt on a platform. Losing them costs real specific practice. Three
ratios calibrating simultaneously; if progress stalls you will have a hard
time saying which change did it. Highest elbow load of the three, and
Intensification II (rotations 24–27) is already flagged as the plan's highest
cumulative joint load.

### If you want a middle between 2 and 3

Run Option 2 now, and revisit A3 at the next block boundary (rotation 11). By
then you will have eight rotations of double-pause data, a settled close-grip
ratio, and a measured max curve — which is exactly the evidence needed to
decide whether the handoff is still the limiter.

### The block schedule, under any option

The double pause is close to a superset of what the long pause and the pin
press each do for you: one kills the bounce, the other attacks the stall, the
double pause does both. So:

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

Pin press moves to block 4 rather than disappearing: by rotation 16 you will
have fifteen rotations of double-pause data telling you where you actually
stall, which is when setting pins at that height stops being a guess.

---

## 5. Recalibrating a ratio

Set the weight from the ratio. Log the RPE as information. After three or four
exposures:

- consistently 1+ point above target → ratio too high, drop it 0.02
- consistently 1+ point below → raise it 0.02
- scattered either side → the ratio is right and your RPE is still settling

Never adjust on one session. Two of your sets a week apart at identical reps
and identical RPE moved 7.5 kg; one reading cannot separate a bad ratio from a
good week. And stay inside the "Yours" band above — if the honest recalibration
wants to go outside it, the problem is the execution of the lift, not the
number.

---

## What I need from you

Nothing here is implemented. To proceed:

1. **Which option** — 1, 2 or 3.
2. **Ratios**: double pause 0.82, close grip 0.90 → 0.88, pin press
   0.88 → 0.85.
3. **The block schedule** above.
4. Whether to add the code rule in §3b, so a measured index single proposes
   itself as the new max without the 5% threshold.
