# Should the AMRAP have back-off sets?

**Status: a proposal. Nothing here is implemented.** You asked whether the
absence of back-offs after the AMRAP is deliberate, and whether a couple of
sets at ~90% of the AMRAP load for the same reps would be a good stimulus.

**Written 21 August 2026** · against `data/plan-fopip-v2.json`, rotation 12.

---

## The short answer

**Yes, it is deliberate, and it is written down.** `plan-rationale.md` lists
what each of the four bench exposures is for:

| | Job |
|---|---|
| **A · heavy single + back-offs** | Max-strength specificity and skill at competition load |
| **C · AMRAP** | The weekly measurement — and the only true-failure press |
| **E · technique single + volume sets** | The main hypertrophy driver, plus a second heavy exposure |
| **F · speed bench** | Skill practice and intent, at almost no fatigue cost |

Session C's job is *measurement*. The volume job belongs to E. Adding
competition-bench back-offs to C would collapse two of the four jobs into one.

**But your instinct is not wrong about the underlying principle** — it is the
one the plan itself uses in session A, and it is worth being precise about why
A needs back-offs and C does not.

---

## Why A needs them and C does not

The plan's own strongest evidence, from "the five biggest mistakes":

> A heavy single alone was worth **+11.4 kg** over six weeks with a **6%**
> probability of being a real change. The same single plus back-off triples was
> **+33.7 kg** with a **99.6%** probability. The single is a load-finder.

That is the case for back-offs after a *single*, and it is overwhelming. A
single at RPE 8 is one rep — it finds the day's load and supplies almost no
stimulus, so without back-offs the session is a measurement pretending to be
training.

**The AMRAP is not a load-finder.** It is one set at 83% of working max taken to
genuine failure, typically 3–6 reps. That set *is* the stimulus. Where a single
leaves you having done nothing, an AMRAP leaves you having done the single
hardest press of the week.

---

## What session C actually contains

Rotation 12, the whole session:

| | | |
|---|---|---|
| C1 | Competition bench press | 1 × max @ RPE 10 · **the AMRAP** |
| C2 | Bench variation (close-grip / Spoto / pin) | 3 × 5 @ RPE 8 |
| C3 | Weighted dip | 3 × 6–10 @ RPE 8 |
| C4 | Incline cable fly | 3 × 10–15 @ RPE 10 |
| C5 | One-arm lat-biased row | 3 × 8–12 @ RPE 9 |
| C6 | EZ-bar skullcrusher | 3 × 8–12 @ RPE 9 |
| C7–C10 | Pushdown, laterals, curl, wrist extension | 9 sets |

**The day is not "AMRAP and nothing else".** There are three more hard pressing
sets immediately after it — they are simply on a *variation* rather than on the
competition lift. C2 is the back-off work; it just has a second job as well.

Competition-bench sets across a rotation:

| Session | Slots | Sets |
|---|---|---|
| A | 2 | 4 — one single, three back-off triples |
| C | 1 | 1 — the AMRAP |
| E | 2 | 5 — technique single, four volume sets |

Ten competition-bench sets a week, plus five speed sets in F and three
variation sets in C.

---

## Your specific suggestion, costed

"A couple of sets with the same reps at maybe 90% of the weight."

At a 115 kg working max: the AMRAP sits at **95 kg**. 90% of that is **86 kg**,
which is **75% of your max** — so two or three sets of 5 there would land around
RPE 7.5–8 after a rest. **Physically sensible, and achievable after a failure
set.** It is a normal volume prescription.

So the question is not whether you *could*. It is what it costs and what it
displaces.

**What it costs.** `plan-rationale.md` is explicit that four bench sessions a
week are only affordable because fatigue tracks proximity to failure: *"Six sets
at 3 RIR recover as fast as three sets at 3 RIR; three sets to failure cost
24–48 hours."* C already carries the week's only true-failure press. Adding two
or three more competition-bench sets makes C the second most expensive bench day
after A, and E — the actual volume day — is two sessions later.

**What it displaces.** If it is *added*, weekly competition-bench sets go from
10 to 12–13 and chest volume rises again, from a whole-muscle figure already at
29–31 fractional sets against a 10–20 published range. If it *replaces* C2, you
trade the variation's job for competition specificity at no fatigue cost — but
`plan-rationale.md` §"Why exercises rotate on blocks" says: **anchor what you
measure, rotate what you don't.** C2 is the rotating part, on purpose.

---

## The options, ranked

### 1. Leave it. **What I would do.**

The four-exposures-one-job structure is the plan's actual architecture, and C
already has three hard pressing sets after the AMRAP. Nothing is missing; the
volume is on a variation rather than the competition lift, which is a choice
rather than an oversight.

### 2. Replace C2 with competition-bench back-offs

Same set count, same RPE, same rest — competition bench at ~75% instead of the
variation. Costs no extra fatigue and adds specificity.

- Changes: `data/plan-fopip-v2.json`, slot C2's exercise and load basis.
- **This is training content. Your call.** The cost is the variation's job:
  close-grip, Spoto and pin press exist to address different weak points and to
  rotate the stimulus, and the plan argues against rotating what you measure.

### 3. Add two back-off sets after the AMRAP, and take two sets off elsewhere

Keeps the weekly bench count where it is. The obvious donor is E, which has
five competition-bench sets — but E is the hypertrophy driver, so moving volume
from it to C moves volume *towards* the day that already has the failure set.

- **Training content, and the one I would take last.**

### 4. Add them and accept the extra volume

Simplest, and the most expensive. Chest is already above the range the research
covers, and C would become the week's second-hardest bench day.

---

## What I have not done

Per `CLAUDE.md`: no exercise, set, rep, RPE, rotation or block rule has been
changed by this document. `data/plan-fopip-v2.json` is untouched.

If you want one of options 2–4, say which and it is one commit — and it will be
its own commit, so it can be reverted on its own.

---

## Sources

- `docs/plan-rationale.md` — "Why four bench exposures with only one to
  failure", "Why the single alone is not the training", "Why exercises rotate on
  blocks and never weekly", and the four-exposures table.
- `data/plan-fopip-v2.json` — the knowledge entries "The five biggest mistakes,
  in order of cost", "The AMRAP — how to not waste it", and "Rest periods".
- The single-versus-single-plus-back-offs trial cited in `bulk-plan.md`.
