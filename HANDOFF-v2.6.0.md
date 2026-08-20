# Prompt for the environment that will commit and publish Bulk v2.6.0

Copy everything below this line into the new coding environment after attaching
`Bulk-v2.zip`.

---

You are receiving the completed Bulk v2.6.0 release-candidate handoff. Do not
reimplement the changes from a prose description. Restore or inspect the exact
source and Git history included in the ZIP.

## Objective

Safely place the reviewed v2.6.0 source into
`https://github.com/FranVuckovic/bulk-source`, preserve its history, run the
verification, obtain my explicit approval after the final phone check, and only
then publish the static app to `https://github.com/FranVuckovic/bulk` / GitHub
Pages.

## Package contents

- `bulk-v2.6.0.bundle`: preferred transfer; a Git bundle containing `main` and
  the complete `codex/v2.5-product-hardening` branch with all commits.
- `bulk-v2.6.0.patch`: one complete `main...release` patch for review or for an
  already-cloned repository.
- `source/`: exact source tree at release commit, without `.git`.
- `docs/release-v2.6.0.md`: complete change list, release and rollback guide.
- `VERIFICATION.md`: automated evidence and the remaining phone checklist.
- `docs/product-audit-v2.5.md`: request-by-request audit and decisions.
- `COMMITS.txt` and `SHA256SUMS.txt`: provenance and integrity.

Expected release commit before this handoff document is added:
`8aec65d274e52504ce5935258b0349023c0c5a4b`. The bundle may contain one later
documentation-only commit adding this prompt. Treat the tip printed in
`COMMITS.txt` as authoritative.

## Preferred restoration path

Inspect `SHA256SUMS.txt`, then clone the bundle with its release branch:

```bash
shasum -a 256 -c SHA256SUMS.txt
git clone -b codex/v2.5-product-hardening bulk-v2.6.0.bundle bulk-source
cd bulk-source
git remote remove origin
git remote add origin https://github.com/FranVuckovic/bulk-source.git
git status
npm test
```

Confirm all tests pass and `sw.js` says `v2.6.0`. Review
`docs/release-v2.6.0.md` and `VERIFICATION.md`. Do not alter the training split,
exercises, sets, reps, RPEs, rotations or blocks; this release deliberately
changes none of them.

## Existing-clone alternative

If you already have a clean clone of `bulk-source` at the exact `main` commit
listed in `COMMITS.txt`, either fetch the branch from the bundle or apply the
patch. Preserving the branch history is preferred:

```bash
git fetch /path/to/bulk-v2.6.0.bundle \
  refs/heads/codex/v2.5-product-hardening:refs/heads/codex/v2.5-product-hardening
git switch codex/v2.5-product-hardening
npm test
```

Use `git apply --check bulk-v2.6.0.patch` before `git apply` only if the bundle
cannot be used. Do not combine the bundle and patch; they contain the same
source changes.

## GitHub source release

GitHub authentication must use OAuth, SSH, a device login or an authorized
GitHub connector. Never request that I paste a password or token into a file or
chat. When authenticated:

```bash
git push -u origin codex/v2.5-product-hardening
git switch main
git merge --ff-only codex/v2.5-product-hardening
git tag -a v2.6.0 -m "Bulk v2.6.0"
git push origin main v2.6.0
```

If `main` has moved, stop and inspect the divergence. Do not force-push
`bulk-source`, rewrite these commits, or resolve conflicts by discarding either
side without explaining the exact conflict.

## Required release gate

The automated status is 255 passing, 0 failing. The prior environment could
not attach its browser controller even though local tabs were visible, so a
short real-phone pass remains mandatory. Follow the current v2.6.0 checklist in
`VERIFICATION.md`, especially:

- demo/personal-data switching and isolation;
- log/edit/unlog/finish and recoverable discard/restore;
- custom workout not advancing A–F;
- Summary evidence groups and relative strength;
- working max versus exact best block set;
- collapsed Settings groups and absence of horizontal overflow;
- update to v2.6.0 and offline relaunch.

Before publishing, have me export and verify the phone's current backup. Ask for
explicit approval immediately before the publish command.

## Publish

The public `bulk` repository contains generated GitHub Pages output. The
existing script force-replaces that public repository's history; the durable
rollback history is `bulk-source` plus the `v2.6.0` tag.

```bash
npm test
npm run publish -- https://github.com/FranVuckovic/bulk.git
```

After publication, open `https://franvuckovic.github.io/bulk/`, confirm Settings
→ About reports `v2.6.0`, test demo mode, close/reopen the installed app, and
verify an offline launch. Report the source commit, tag, published commit and
live URL.

If a rollback is required, check out the previous accepted source tag and
publish that shell again. The database schema remains v3, so v2.6.0 introduced
no data downgrade problem.

## What this release contains

The complete list is in `docs/release-v2.6.0.md`. In short: recoverable session
discard/restart, custom workouts outside plan progression, any-set index
marking, grouped logging actions, fixed Plan collapsing/navigation, clearer
measurements and strength records, honest relative strength, clarified block
and working-max evidence, proportional stimulus warnings, grouped Summary,
compact Settings, isolated demo access, corrected tonnage comparison, and
reliable visible handling of failed/successful saves. No training content or
database schema changed.
