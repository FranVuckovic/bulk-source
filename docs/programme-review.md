# Whole-programme review: where the bench variations go, and what else moves

3 September 2026. **Proposal — nothing in `data/plan-fopip-v2.json` has been
changed by it.** Read with `docs/bench-variations.md`, which holds the ratios.

---

## 1. The finding that changes the answer

Close-grip bench will not fix the triceps gap.

Every bench variation in the plan is mapped `triLat: 1, triLong: 0`, and that
mapping is right. Under a bar the shoulder stays flexed, so the long head — the
only one of the three that crosses the shoulder joint — cannot be loaded at
length. It is trained by overhead and behind-the-head positions. Nothing you do
with your grip width on a bench changes that.

Here is the plan's triceps volume as it stands, at rotation 3:

| | sets/week | frequency |
|---|---|---|
| Lateral head | **21.5** | 4 |
| Long head | **9.0** | 3 |

A 2.4 : 1 split, with the starved head under the 10-set floor and the fed head
over the 20-set ceiling. And the long head is the one that does the lockout
from a stretched position — which is your sticking point.

Its only sources in the whole plan are A8 and E7 (overhead cable extension,
3 sets each) and C6 (skullcrusher, 3 sets). C7's pushdown is 80% lateral head.

So your instinct that close grip matters is right, and your instinct that it
gives you triceps hypertrophy is not — those are two different problems:

- **Close grip is a strength and technique tool.** The tucked elbow path, the
  handoff at the transition, specific to the competition lift. It belongs in
  the plan, heavy, in low reps.
- **The long-head gap is a hypertrophy problem, and only an overhead position
  fixes it.**

Fixing one with the other wastes the sets. The proposal below does both, and
pays for them.

---

## 2. Why not "2 competition + 3 close grip" in the speed slot

Three reasons, and the first is the one that matters:

**Speed work produces almost no hypertrophy, so close-grip speed work produces
almost no triceps hypertrophy.** The plan already says this: `benchSpeed` is
mapped `m: {}` — no muscle volume at all — which is correct for 5 × 3 at 64% and
RPE 6. Three close-grip speed sets would buy you exactly the thing you were
worried about buying: nothing. You spotted this yourself.

**It spends the one slot whose purpose is the competition groove.** F1 exists
for bar speed and technique rehearsal on the competition lift at low fatigue.
Giving the majority of it to a different groove removes the thing it is for.

**It costs the same as a real close-grip slot and delivers less.** Two heavy
close-grip sets cost about twenty minutes wherever they go, because a new bench
variation needs its own warm-up ramp from an empty bar and the ramp dominates.
If you are paying the ramp anyway, pay it for sets that can actually cause
growth.

So: **keep F1 at 5 × 3 competition, and add a separate close-grip slot at
2 × 4 @ RPE 8.**

---

## 3. The proposal

Six changes. The set count of the whole plan is unchanged — 170 before, 170
after.

**a. C2 becomes the double-pause bench**, 3 × 4–6 @ RPE 8, ratio 0.82. As in
`docs/bench-variations.md`. This is the primary variation and the reason the
rest fits.

**b. F gains a close-grip slot: 2 × 4 @ RPE 8**, 180 s rest, straight after the
speed work. F1 stays 5 × 3 competition at 64%.

Why F: it is the only session with room — 65 minutes against 87–115 for
everything else — and the speed work leaves you warm. It ends at 88 minutes,
still the shortest session in the plan. Putting the same pair in C instead
takes C from 108 to 127 minutes, which makes the heaviest day the longest day
as well.

The cost to name: F is immediately before A, so this is eight heavy reps of
close grip the day before A's single and back-offs. Two sets is a small dose
and A's work is competition-grip and chest-dominant, so I judge the carryover
acceptable — but it is measurable. If A's back-off loads start needing to drop,
that is the signal, and this is the slot to cut.

**c. C7's pushdown becomes an overhead extension.** Same cable, same station,
one attachment position higher. It moves two sets from the head at 21.5 to the
head at 9.0 — the cheapest change in this document, and the highest-value one.

**d. F gains a second overhead extension: 2 × 10–15 @ RPE 10.** F is where the
room is, and it now becomes the plan's fourth triceps session.

**e. Pay for c and d out of the side delts.** 20.9 sets a week, in all six
sessions, on a muscle that is limiting nothing. A9, C8, E8 and F4 go from 4
sets to 3 — that frees four sets, drops side delts to 16.9, and keeps the
frequency at six. Mid-band, six exposures, still the most-trained muscle in the
plan after the chest and triceps.

**f. D10's standing calf raise becomes a seated calf raise.** Both calf slots
are currently standing, so the soleus — which is most of the calf's
cross-section and only responds with the knee bent — is untrained. Same set
count, no cost, and `calfSeat` already exists in the plan unused.

### What it does to the week

| | now | proposed | Δ | frequency |
|---|---|---|---|---|
| Triceps lateral | 21.5 | 23.5 | +2.0 | 4 → 4 |
| Chest (mid) | 21.0 | 22.2 | +1.2 | 3 → **4** |
| Side delts | 20.9 | **16.9** | −4.0 | 6 → 6 |
| Front delts | 15.6 | 16.2 | +0.6 | 4 → 4 |
| Lats | 15.7 | 15.7 | — | 5 |
| Forearms | 14.9 | 14.9 | — | 6 |
| Upper back | 14.2 | 14.2 | — | 4 |
| Biceps long | 13.4 | 13.4 | — | 4 |
| **Triceps long** | **9.0** | **13.0** | **+4.0** | 3 → **4** |
| Biceps short | 13.4 | 13.4 | — | 3 |
| Chest (upper) | 12.9 | 12.9 | — | 3 |
| Quads | 12.5 | 12.5 | — | 2 |
| Hamstrings | 11.4 | 11.4 | — | 2 |
| Rear delts | 10.2 | 10.2 | — | 3 |
| Glutes | 10.2 | 10.2 | — | 2 |
| Abs | 10.2 | 10.2 | — | 3 |
| Calves | 6.0 | 6.0 | — | 2 |
| Obliques | 5.7 | 5.7 | — | 1 |

Triceps ratio: **2.4 : 1 → 1.8 : 1**. Long head into the band. Chest gains a
fourth weekly exposure for free, because the close-grip slot counts as one.

| session | sets | minutes |
|---|---|---|
| A | 26 → 25 | 104 → 102 |
| B | 28 → 28 | 87 → 87 |
| C | 28 → 27 | 108 → 106 |
| D | 33 → 33 | 91 → 91 |
| E | 32 → 31 | 115 → 113 |
| F | 23 → 26 | **65 → 88** |

F absorbs all of it and is still the shortest session. Everything else gets
slightly shorter.

---

## 4. Two things I am deliberately not fixing

**Triceps lateral at 23.5 and chest at 22.2 are over the 20-set ceiling.** That
is a choice, not an oversight. The 10–20 band is a general hypertrophy
guideline; being above it on the two muscles the entire plan exists to grow is
the point of a specialist plan. What was actually wrong was the ratio *inside*
the triceps, and that is what is being fixed. If either one starts costing you
recovery, the accessory multiplier already trims them at block boundaries.

**Obliques at 5.7, frequency 1.** Under the band, and I am not adding work.
Anti-rotation trunk work matters for bracing under a heavy bar, not for size,
and three sets of Pallof press plus the 0.3 oblique weight carried by your
cable crunches and hanging leg raises covers that. Inventing sets to make a
number go green is not a reason to spend a session's time.

**Calves stay at 6.0**, under the floor. You have said three sets per session
is your ceiling and calves are not a priority, and I am taking that at face
value — change f makes the six sets you do train both heads instead of one,
which is the whole of the available improvement without adding a slot. Say so
if you want a third calf exposure and I will find it.

---

## 5. Every bench set in the week

At a confirmed 120 kg competition max, in block 1 (rotations 3–10). Close-grip
max 105.0 (0.88), double-pause max 97.5 (0.82).

### Recommended

| slot | lift | sets × reps @ RPE | load |
|---|---|---|---|
| A2 | Competition | 1 × 1 @ 7.5 | 110.0 |
| A3 | Competition | 3 × 4 @ 8 | 100.0 |
| C11 | Competition — **attempt** | 1 × 1 | 120.0 (+2.5/wk) |
| C1 | Competition — **AMRAP, paused** | 1 × max | 100.0 fixed |
| C2 | **Double pause** | 3 × 6 @ 8 | 77.5 |
| E1 | Competition | 1 × 1 @ 7 | 107.5 |
| E2 | Competition | 5 × 5 @ 8 | 97.5 |
| F1 | Competition — speed | 5 × 3 @ 64% | 77.5 |
| F8 | **Close grip** | 2 × 4 @ 8 | 87.5 |

**22 bench sets: 17 competition, 3 double pause, 2 close grip.**

### The four earlier options, for comparison

| | Opt 1 | Opt 2 | Opt 3 | Opt 4 (yours) | **Recommended** |
|---|---|---|---|---|---|
| A2 single | comp | comp | comp | comp | comp |
| A3 back-offs | comp 3×4 | comp 3×4 | **close 3×4** | comp 3×4 | comp 3×4 |
| C11 attempt | ✓ | ✓ | ✓ | ✓ | ✓ |
| C1 AMRAP | 100 kg | 100 kg | 100 kg | 100 kg | 100 kg |
| C2 variation | dbl pause | dbl pause | dbl pause | dbl pause | dbl pause |
| E1 + E2 | comp | comp | comp | comp | comp |
| F1 speed 5×3 | comp | **close** | **close** | **2 comp + 3 close** | comp |
| extra close-grip | — | — | — | **2 heavy** | **2 × 4 @ 8** |
| Competition sets | 17 | 12 | 9 | 14 | **17** |
| Double-pause sets | 3 | 3 | 3 | 3 | **3** |
| Close-grip sets | 0 | 5 (all light) | 8 | 5 (2 heavy) | **2 (both heavy)** |
| Close-grip sets that grow anything | 0 | **0** | 3 | 2 | **2** |
| Long-head fix | no | no | no | no | **yes, +4.0 sets** |

The last two rows are the argument. Options 2 and 3 look like they have far
more triceps work than the recommendation, and most of it is speed work the
plan itself counts as zero volume. And none of the first four options touch the
head that is actually behind.

---

## What I need from you

1. **The close-grip slot: 2 × 4 @ RPE 8 in F**, and F1 staying competition.
2. **C7's pushdown becoming an overhead extension**, and 2 more overhead sets
   in F.
3. **Side delts 4 → 3 sets** in A, C, E and F to pay for it.
4. **D10 standing → seated calf raise.**
5. Plus the still-open items from `docs/bench-variations.md`: double pause at
   0.82 in C2, close grip 0.88, pin press 0.85, and the block schedule.

Any subset. 1–4 are independent of each other and of the ratio decisions.
