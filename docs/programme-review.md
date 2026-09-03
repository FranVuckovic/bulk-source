# Whole-programme review — v2

3 September 2026. **Proposal. Nothing in `data/plan-fopip-v2.json` has been
changed by it.** Ratios live in `docs/bench-variations.md`.

This replaces the first version of this document, which proposed removing the
pushdown and putting only two close-grip sets in. Both were wrong: the pushdown
is the plan's only lateral-head isolation, and two sets is not a dose.

---

## 1. The finding everything else follows from

Close-grip bench will not fix the triceps gap, because the gap is in the head a
bench press cannot reach.

Every bench variation in the plan is mapped `triLat: 1, triLong: 0`, and that
is anatomically right — under a bar the shoulder stays flexed, so the long
head, the only one of the three crossing the shoulder, is never loaded at
length. Grip width does not change that.

| | sets/week | frequency |
|---|---|---|
| Triceps lateral head | **21.5** | 4 |
| Triceps long head | **9.0** | 3 |

2.4 : 1, with the starved head under the 10-set floor, the fed head over the
20-set ceiling, and the starved one being the head that locks out from a
stretched position — which is where you stall.

So close grip and the long head are two separate jobs:

- **Close grip is a strength and technique tool** — the tucked elbow path and
  the pec-to-triceps handoff. Heavy, low reps, three sets.
- **The long-head gap is a hypertrophy problem**, and only an overhead
  position fixes it.

---

## 2. The budget

Nothing is added without something paying for it. Seven sets are freed and six
are spent, so the plan gets one set smaller.

### Freed

**F1 speed bench, 5 × 3 → 3 × 3, competition grip.** Speed work is the lowest
value per minute in the plan — 64% at RPE 6 — and the plan's own model says so
by giving `benchSpeed` an empty muscle map. Its job is diagnostic: *is the bar
visibly faster than my volume sets?* Three triples answer that as well as five.
Frees 2 sets.

**E2 volume, 5 × 5 → 4 × 5 @ RPE 8.** Still 20 competition reps at RPE 8 and
still the largest block of specific volume in the plan. Frees 1 set.

**Lateral raises, 4 → 3 sets in A9, C8, E8 and F4.** 20.9 sets a week in all six
sessions on a muscle limiting nothing — the highest-frequency exercise in the
whole plan, and the clearest thing in it that accumulated rather than being
decided. Drops to 16.9, mid-band, frequency still 6. Frees 4 sets.

### Spent

**Close-grip bench, 3 × 4 @ RPE 8, in F, straight after the speed work.** Your
three heavy sets. Spends 3.

Why F: it was the only session with room (65 minutes against 87–115), the speed
work leaves you warm so the ramp is cheap, and F is where the freed speed sets
came from. Why not C: the same three sets take C from 108 minutes to about 130,
making the heaviest day the longest as well.

Cost to name: F is the day before A, so this is twelve heavy close-grip reps
before A's single and back-offs. F1 dropping to three sets partly offsets it.
If A's back-off loads start needing to drop, that is the signal, and F8 is the
slot to cut.

**Overhead cable extension, 3 sets, in F.** The long-head fix. Spends 3.

### Swapped, costing nothing

**C6 skullcrusher → overhead cable extension.** You said to watch the elbows,
and the skullcrusher is the most elbow-aggressive movement in the plan: an EZ
bar loaded at full elbow flexion, with the joint at its worst leverage exactly
where the weight is heaviest. A cable overhead extension trains the same head,
in the same lengthened position, with constant tension and no jam at the bottom.
Same long-head volume, materially less elbow.

Net elbow ledger: one harsh exercise out, two cable slots in, and three
close-grip pressing sets in. That is roughly neutral, and it is the reason the
close grip is affordable at all.

**C7 pushdown stays.** You are right that it is the only isolation the lateral
head gets, and it is the cheapest slot in the session.

**D10 standing calf raise → seated.** Both calf slots are currently standing,
so the soleus — most of the calf's cross-section, and only trainable with the
knee bent — is untrained. Same sets, no cost, and `calfSeat` already exists in
the plan unused.

---

## 3. What it does

| | now | proposed | Δ | frequency |
|---|---|---|---|---|
| Triceps lateral | 21.5 | 25.2 | +3.7 | 4 → 4 |
| Chest (mid) | 21.0 | 21.8 | +0.8 | 3 → **4** |
| Side delts | 20.9 | **16.9** | −4.0 | 6 → 6 |
| Front delts | 15.6 | 16.0 | +0.4 | 4 → 4 |
| Lats | 15.7 | 15.7 | — | 5 |
| Forearms | 14.9 | 14.9 | — | 6 |
| Upper back | 14.2 | 14.2 | — | 4 |
| Biceps long | 13.4 | 13.4 | — | 4 |
| Biceps short | 13.4 | 13.4 | — | 3 |
| Chest (upper) | 12.9 | 12.9 | — | 3 |
| Quads | 12.5 | 12.5 | — | 2 |
| **Triceps long** | **9.0** | **12.0** | **+3.0** | 3 → **4** |
| Hamstrings | 11.4 | 11.4 | — | 2 |
| Rear delts | 10.2 | 10.2 | — | 3 |
| Glutes | 10.2 | 10.2 | — | 2 |
| Abs | 10.2 | 10.2 | — | 3 |
| Calves | 6.0 | 6.0 | — | 2 |
| Obliques | 5.7 | 5.7 | — | 1 |

Triceps ratio **2.4 : 1 → 2.1 : 1**, long head into the band, frequency 3 → 4.
Chest gains a fourth weekly exposure free, because the close-grip slot counts
as one.

| session | sets | minutes |
|---|---|---|
| A | 26 → 25 | 104 → 102 |
| B | 28 → 28 | 87 → 87 |
| C | 28 → 27 | 108 → 106 |
| D | 33 → 33 | 91 → 91 |
| E | 32 → 30 | 115 → 109 |
| F | 23 → 26 | 65 → 90 |
| **total** | **170 → 169** | spread **65–115 → 87–109** |

The sessions were badly uneven — one 65-minute session and one 115 — and F was
carrying almost nothing. That is now the tightest the plan has ever been.

---

## 4. Every bench set in the week

Block 1 (rotations 3–10), at a confirmed 120 kg competition max. Close-grip max
105.0 (× 0.88), double-pause max 97.5 (× 0.82).

| slot | lift | sets × reps @ RPE | load | why it exists |
|---|---|---|---|---|
| A2 | Competition | 1 × 1 @ 7.5 | 110.0 | a heavy single that is not a test |
| A3 | Competition | 3 × 4 @ 8 | 100.0 | heavy competition reps under fatigue |
| C11 | Competition — **attempt** | 1 × 1 | 120.0 (+2.5/wk) | the measurement |
| C1 | Competition — **AMRAP, paused** | 1 × max | 100.0 fixed | rep record at a constant load |
| C2 | **Double pause** | 3 × 6 @ 8 | 77.5 | the sticking point and the bounce |
| E1 | Competition | 1 × 1 @ 7 | 107.5 | opener for the volume |
| E2 | Competition | 4 × 5 @ 8 | 97.5 | the specific hypertrophy block |
| F1 | Competition — speed | 3 × 3 @ 64% | 77.5 | bar-speed diagnostic, cheap |
| F8 | **Close grip** | 3 × 4 @ 8 | 87.5 | tucked path, handoff strength |

**20 bench sets: 14 competition, 3 double pause, 3 close grip.**

By reps on the bar: about 51 competition reps a week across four sessions
against 30 on variations — 63 / 37. Three heavy singles a week (A2, C11, E1),
12 heavy competition reps, 20 volume reps, 9 speed reps and the AMRAP. The
specific side is not thin.

---

## 5. Things that are there on purpose, checked

You asked whether anything is in the plan by accident. What I found:

- **Lateral raises in all six sessions.** Accidental accumulation — nobody
  decided on 20.9 sets a week. Fixed above.
- **Both calf slots standing.** An oversight; the soleus was untrained. Fixed.
- **The skullcrusher.** Not accidental, but it was the harshest way to train
  the head it trains. Swapped for the gentler equivalent.
- **Forearms: 14.9 sets, frequency 6.** Five direct slots. Mid-band, so not a
  volume problem, but it is six sessions of forearm work for a bench specialist.
  Deliberate — you asked for the pronation/supination split by name — so I have
  left it. It is the first place to look if you ever want sessions shorter.
- **Rear delts: 10.2, the floor**, against 21.8 of chest. Not wrong, but it is
  the thinnest thing in the upper body and worth watching if your shoulders
  start complaining. I have not changed it because it would cost sets I have
  already spent.
- **E3's single index set at RPE 10 before E4's two working sets** on the same
  machine: deliberate — the index set is a measurement, the working sets are
  training.
- **A1's static hold**: exists only from rotation 11, labelled an optional
  experiment, and correctly gated.
- **Obliques 5.7, frequency 1.** Under the band and staying there. Anti-rotation
  work matters for bracing under a heavy bar, not for size, and three sets of
  Pallof plus the oblique share of your crunches and leg raises covers it.
  Adding sets to turn a number green is not a reason to spend session time.

**Deliberately left over the ceiling: lateral triceps 25.2 and chest 21.8.**
Three heavy close-grip sets cost +3.0 lateral head and there is no way around
that — close-grip bench *is* the lateral head. Being above the general 10–20
band on the two muscles the whole plan exists to grow is what a specialist plan
looks like. The lever, if it ever costs you recovery: C7's pushdown from 2 sets
to 1, then F9 from 3 to 2. The accessory multiplier already trims both at block
boundaries.

---

## What I need from you

1. **F1 speed 5 × 3 → 3 × 3**, competition grip.
2. **E2 volume 5 × 5 → 4 × 5.**
3. **Close grip 3 × 4 @ RPE 8 in F**, after the speed work.
4. **Overhead cable extension, 3 sets, in F.**
5. **C6 skullcrusher → overhead cable extension** (elbows).
6. **Lateral raises 4 → 3** in A9, C8, E8, F4.
7. **D10 standing → seated calf raise.**
8. Still open from `docs/bench-variations.md`: double pause at 0.82 in C2,
   close grip 0.88, pin press 0.85, and the block schedule.

1–7 are independent of each other and of 8.
