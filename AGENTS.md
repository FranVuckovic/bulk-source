# Bulk agent handoff

Read `CLAUDE.md` before changing code, then read `VERIFICATION.md` and
`docs/product-audit-v2.5.md`. These files are the current operating record; the
older build brief and decision log provide history, not current verification.

## Non-negotiable product rules

- Do not change the A–F training split, exercises, sets, reps, RPEs, or block
  logic without the owner's explicit approval. Advice is welcome; silent plan
  edits are not.
- Preserve device-local data. A blank is not zero, kilograms are the storage
  unit, deletions are recoverable, and import/finish operations stay atomic.
- Prefer small, named commits. Do not mix a visual redesign, a data migration,
  and a training change in one checkpoint.
- Test a behavior through the path the user taps, not only through a helper.
  Automated rendering is useful but does not replace a real mobile viewport.
- Bump `VERSION` in `sw.js` whenever any offline-shell file changes.
- Do not publish or force-push without explicit approval.

## Current state

- Working branch: `claude/project-onboarding-verify-lz3ob6`. The v2.6.0 work
  arrived on `codex/v2.5-product-hardening` and was merged there.
- Current shell: `v2.11.0`
- Test command: `npm test` (372 passing)
- Local app: `npm run serve`, then `http://localhost:8123/`
- Demo: Settings → Demo data → Explore the demo. Demo and personal data use
  separate IndexedDB databases.
- Current interactive acceptance status: pending. The Codex in-app browser
  controller could not attach to the visible local tabs on 20 August 2026.
  Do not describe v2.6.0 as visually verified until `VERIFICATION.md`'s current
  checklist has been completed.

## Repository and release model

`bulk-source` is the source of truth and is **private**. `bulk` is generated
GitHub Pages output and is public. Work and history belong in the source repository;
the live repository is replaced by `dev/publish.sh`. That script force-pushes,
so inspect it and obtain approval before running it.

Preferred release sequence:

1. Commit source changes on a feature branch and push it to `bulk-source`.
2. Review the diff and complete the local/demo acceptance checklist.
3. Publish a preview or the Pages build only after the owner approves.
4. Verify update, offline launch, real-data isolation, and one full workout path
   on the phone before merging/tagging the release.
