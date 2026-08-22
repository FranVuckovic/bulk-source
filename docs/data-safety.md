# What can destroy data, and what stops it

**Written 21 August 2026, against `v2.9.0`.** Every claim here was tested, and
the test is named beside it.

Two losses were reported from real use inside a week. They were the same shape
twice, and finding the second one is why this document exists: rather than fix
it and move on, every write in the app was walked, and the rule that catches
the class is now a test that fails when a new store breaks it.

---

## The rule

**A store's key decides whether a write can destroy something.**

If the key is a counter the database hands out, every write is a new row and
nothing can be replaced. If the key comes from the data — a date, an exercise
id, a composite of session and slot — then writing the same key twice replaces
the first row, and whether that is a correction or a loss depends entirely on
whether the two writes meant the same record.

| Store | Key | Can a write replace an existing row? |
|---|---|---|
| `sets` | `id`, but `logicalKey` is a unique index | **Yes** — see below |
| `sessionLogs` | `id`, assigned | No |
| `daily` | `dateISO` | **Yes** |
| `measurements` | `dateISO` | **Yes** |
| `maxes` | `exerciseId` | **Yes** |
| `settings` | `key` | Yes, but holds preferences, not records |
| `cycles` | `id`, built from sequence **and start instant** | No |
| `niggles`, `media`, `maxHistory`, `auditLog` | auto-increment | No |

`test/write-safety.test.js` walks the schema at run time and requires every
store with a natural key to be listed with what stops a replacement being a
loss. **A new store with a natural key fails that test until someone says which
it is.** That is the durable part; the rest of this document is the reasoning.

---

## The two that were reported

### Yesterday's measurements, overwritten by today's

`daily` and `measurements` are keyed by `dateISO`, and `state.todayISO` was
computed once, in `loadEverything`, at boot. An installed PWA that is resumed
rather than reloaded keeps its JavaScript context — the page has been alive
since it was last opened — so after midnight the Body screen still meant the day
the app was started. It prefilled from that day's records, which is why the
boxes were not empty, and wrote back to that day's key.

Sessions were unaffected because they call `todayISO()` fresh. Only the Body
screen read the cached value.

**Fixed two ways.** The date is re-derived every time the draft is built, and
the app watches for the day changing under it — on `visibilitychange`, on
`focus`, and on a timer so an app left open across midnight rolls over on its
own. And `putDatedRow` keeps what a replacement replaced, in the audit log,
readable from **Log → tap the entry → Replaced values**.

`test/overwrite.test.js` — including the real numbers from the export.

### A swap destroyed the sets logged before it

A set's identity is `logicalKey` — session, slot index, set index — and that is
a unique index. Correct while the slot means the same exercise: unlog a set,
retype it, log it again, one row. Wrong the moment a swap changes what the slot
holds. Log three sets of leg press at slot 4, swap to hack squat, log the first
hack squat set, and its key is the key the first leg press set already held.
Three sets went in and two came out.

**Fixed at the database, not in the UI.** A collision between two *different*
exercises is not an idempotent retry: the set that was there is soft-deleted,
its key released so the new set can hold it and so a restore does not collide
again, and an audit entry records what displaced it. It goes to **Log → Bin**
like every other deletion. The Train screen also warns first, naming the
exercise and the number of sets.

`test/swap.test.js`, including the realistic path — unlog the set showing under
the wrong exercise, then log the new one — which used to resurrect a deleted
leg press set as a live hack squat set.

---

## What is deliberately allowed to replace

- **Re-entering today's weigh-in.** Same record, corrected. The previous values
  go to the audit log.
- **Unlogging a set and logging it again at the same slot.** Same set,
  corrected. One row, no bin entry — verified by test, because a bin that fills
  with every retyped weight is a bin nobody reads.
- **Confirming a working max.** `maxes` holds the current one; `maxHistory`
  keeps every value it has ever had.

---

## The one thing that destroys data

Emptying the bin, in Settings or in Log → Bin. It is the only call in the app
that removes rows rather than marking them, it sits behind two confirmations,
and `test/recovery.test.js` asserts that exactly one hard delete survives in
`app.js` and that it is that one.

---

## What a backup carries

All eleven stores, since `v2.8.1`. Two were missing before that and both
mattered:

- **`auditLog`** — every deletion, and every value a save replaced. The store
  whose entire purpose is recovering from a mistake was not in the archive, so
  a backup taken the morning after an overwrite could not help.
- **`cycles`** — where you are in the 33 rotations. A backup restored onto a new
  phone had every session ever logged and no idea which rotation it was on.

Neither is filtered by the export's date range: a backup of last week that
forgets which rotation you are on is not a backup.

`test/export.test.js`.

---

## Restoring the measurements that were overwritten

Checked against the export of 22 August. The state today:

| | `measurements` | `daily` |
|---|---|---|
| **20 Aug** | 79.6 / 104.6 / 122.7 / 32.9 / 32.9 / 55.7 / 56.4 / 40 | 86.05 kg, 10.6%, 7.5 h |
| **21 Aug** | *(no row)* | *(no row)* |
| **22 Aug** | correct, saved on the day | correct, saved on the day |

**The row dated 20 August holds the 21st's readings.** There is no 21 August
row at all — the overwrite did not create one, it replaced the 20th's. The
audit log has six entries and none of them is an `overwrite`, because it
happened on `v2.7.0`, before a replacement kept what it replaced.

So the repair is two writes, in this order. **Do the 21st first** — the numbers
you need for it are the ones currently sitting on the 20th, and the second step
writes over them.

### 1 · Put the 21st's readings on the 21st

**Body → Change day → 21 August.** The header turns amber and reads *not today —
check this is what you want*. Type:

| | |
|---|---|
| Waist | 79.6 |
| Chest | 104.6 |
| Shoulders | 122.7 |
| Arm L / Arm R | 32.9 / 32.9 |
| Quad L / Quad R | 55.7 / 56.4 |
| Neck | 40 |

Leave the four new sites blank — you were not taking them yet, and blank is
honest. Save. Then the weigh-in on the same day: **86.05 kg, 10.6% body fat,
7.5 h sleep.**

Nothing exists on the 21st yet, so both buttons will say *Save*, not *Replace*.

### 2 · Put the 20th's real readings back on the 20th

**Change day → 20 August.** Both cards will now say **Already logged** and both
buttons will read **Replace** — that is the confirmation you are correcting a
day rather than adding one. From the photograph:

| | |
|---|---|
| Waist | 80 |
| Chest | 105 |
| Shoulders | 124 |
| Arm L / Arm R | 32.6 / 32.5 |
| Quad L / Quad R | 55.6 / 56.2 |
| Neck | 39.5 |

And the weigh-in: **85.5 kg**. Leave body fat and sleep blank unless you
remember them — the 10.6% and 7.5 h currently on that row belong to the 21st,
and step 1 has already put them there.

### 3 · Change day → Today

So the next thing you log goes on the right day.

**Afterwards, both replacements are readable.** Log → the 20 August entry →
**Replaced values** will show what step 2 wrote over. That is the safety net
that did not exist when this happened.

### Take a backup first

Log → Backups → *Export a zip*. Five taps of typing is not much to lose, but a
backup before a repair costs one tap and means the repair itself is reversible.
