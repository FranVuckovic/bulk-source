# Bulk v2.6.0 release notes

**Status:** tested release candidate; final phone acceptance and publication
remain owner-controlled.

## What changed

### Safer training sessions

- The session clock and Start control are above the exercise list.
- An accidentally opened session can be discarded into Recently deleted,
  restored, or discarded and restarted cleanly.
- Custom workouts can be assembled from the exercise library without advancing
  or inflating the A–F plan rotation.
- Any logged set can be marked as an index set; prescribed index sets still
  begin selected.
- Set controls are grouped by consequence: value-filling controls, useful
  tools, and exercise changes.
- Async saves and session finishes reach the central failure presentation.
  Niggle and form-check saves also confirm success.

### Clearer Progress and Strength

- Summary evidence is grouped rather than presented as an unrelated stack.
- “Is this going to plan?” visibly separates Bodyweight & waist, Strength,
  Strength relative to bodyweight, and Plan completion.
- Relative strength is no longer buried: the current ratio and first-to-latest
  change appear in Summary, and the full chart appears before programming
  diagnostics on Strength.
- Selected-lift records appear before charts. e1RM remains primary, while the
  actual record set shows load, reps, RPE and date. Heaviest load shows reps.
- The lift chooser wraps inside one compact control instead of requiring
  horizontal scrolling.
- Load/reps points use clear recency groups and labelled equal-e1RM curves.
- Block comparison shows dated endpoints; baseline is calibration rather than
  a red negative score.
- The selected lift shows “Prescriptions use” (working max) beside “Best
  eligible set this block” (the actual set and its e1RM). All-lift details use
  the same language.
- Relative strength joins only bodyweight readings within three days and is
  explicitly an individual trend, not a population percentile.

### Clearer Plan, Body and Settings

- Plan navigation wraps; workout cards and muscle groups collapse reliably.
- Stimulus colours are proportional: small overages are informational, orange
  is reserved for materially high volume, and target bands are described as
  guardrails rather than pass/fail scores.
- Measurements show dates, selectable trends and bodyweight comparison.
- Demo mode is the first Settings item and its warning exists only while the
  isolated demo database is active.
- Settings is compressed into Training & display, Data & backups, Privacy &
  storage, Deletion & reset and About. Only routine controls begin open.
- The 960-tonne comparison now uses a real 44-tonne articulated-lorry
  equivalent.

## What deliberately did not change

- No exercise, training split, set, rep, RPE, rotation or block rule changed.
- No database migration: the schema remains v3.
- Existing relaxed arm/thigh history was not relabelled as flexed.
- No unsupported strength or measurement percentiles were added.
- No framework rewrite, account system or cloud synchronization was introduced.

## Verification

- `npm test`: 255 passing, 0 failing.
- Coverage: 69.04% line, 74.57% branch, 70.88% function.
- Demo generation is repeatable, isolated from personal data and locked against
  writes; populated Summary, Strength and Settings rendering is exercised.
- Every literal click, change, input and file-picker binding is checked against
  a real handler.
- The local server returns 200 with no-store headers and serves shell `v2.6.0`.
- Current real-browser automation remains unavailable. Complete the short phone
  checklist in `../VERIFICATION.md` before publishing.

## Source release

The source repository is the permanent history. From this folder, after the
phone checklist passes:

```bash
git status
npm test
git push -u origin codex/v2.5-product-hardening
git switch main
git merge --ff-only codex/v2.5-product-hardening
git tag -a v2.6.0 -m "Bulk v2.6.0"
git push origin main v2.6.0
```

If GitHub rejects the push, authorize through GitHub OAuth, SSH or the Codex
GitHub connector. Never paste a password or token into a project file.

## Publish the phone app

Export and verify the phone's current backup first. Publication is
outward-facing and the existing script replaces the public `bulk` repository's
history; the source repository and `v2.6.0` tag are the rollback record.

```bash
npm test
npm run publish -- https://github.com/FranVuckovic/bulk.git
```

Then open `https://franvuckovic.github.io/bulk/` on the phone, accept the update,
confirm the build reads `v2.6.0`, and test one harmless demo path plus offline
relaunch. To roll back, switch the source repository to the previous accepted
tag and publish that shell again; database schema v3 remains compatible.
