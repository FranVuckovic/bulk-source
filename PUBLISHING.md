# Publishing, updating, and what happens to your data

Written 20 August 2026, against `v2.7.0`. Every claim below was tested, and the
test is named next to it.

**Status: v2.8.1 is live.** Published 20 August 2026. It replaced v2.4.0, which
had replaced v2.1.3 earlier the same day. Every claim below about your data,
about updating and about rolling back holds unchanged across all three: the
database version has been 3 throughout, so no migration has ever run.

Your phone is on whatever it last accepted. It will offer v2.7.0 and wait for
your tap.

---

## The short answers

| Your question | Answer |
|---|---|
| Is my data on the GitHub page? | **No.** 29 files, all code. Checked for your name, your bodyweight, your dates, your session note — none present. |
| Does publishing overwrite my data? | **No.** The service worker contains zero references to IndexedDB. It replaces cached *code* and cannot reach your database. |
| Does my phone update automatically? | **No.** It downloads in the background and waits for you to tap. Proven below. |
| Do I need to do anything with my data? | **No.** Take a backup anyway — it costs one tap. |
| Can we go back to the old version? | **Yes, exactly.** Rebuilding from `main` reproduces the current live site byte-for-byte. Verified. |

---

## Where your data actually is

Your training log lives in **IndexedDB, in the browser, on your phone**. It has
never been anywhere else. There is no account, no server, and no upload.

The published repository is the *app* — the HTML, CSS, JavaScript, the plan
file and three icons. Twenty-nine files. When you load the page your browser
downloads those files and then reads your data out of its own local storage.

The two never meet. GitHub has no idea you exist as a lifter.

**Checked, not assumed.** Searched every published file for the owner's name,
for the text of a logged session note, for the dates of logged sessions, and
for stored bodyweights. The only hit is `bodyweight: 90` in `js/app.js`, which
is the hard-coded *default* setting shipped to anyone who opens the app — not a
reading of anyone's.

`test/shell.test.js` holds this down permanently: it asserts that no published
file names the owner, so it is a failing test rather than a thing to remember.

---

## What an update does, and what it cannot do

`sw.js` — the service worker — is the only thing that changes when you publish.
It manages one cache of code files. **It contains no reference to IndexedDB at
all**, so there is no code path by which an update could read, move or destroy
what you have logged. This is not a promise about carefulness; there is simply
nothing there that could do it.

The database version is also unchanged — `DB_VERSION = 3` before and after — so
**no migration runs**. Nothing rewrites a single stored row.

---

## Your phone will not update itself

This was tested end to end on 20 August 2026, against the bytes now live,
simulating exactly what happens when you push:

1. A browser installed **v2.4.0** from the published files, and a set was
   logged (1 set, 1 session in IndexedDB).
2. The site was replaced with **v2.7.0** — the same thing pushing to GitHub
   Pages does.
3. The app checked for updates. Result, **with no tap at all**:
   - new build downloaded and **waiting**: `true`
   - still running the old one: `true`
   - the header read `v2.4.0 → v2.7.0`
   - data: **1 set, 1 session — unchanged**
4. Tapping it asked first, because a session was open: *"You have a session
   open. Updating reloads the app and anything not yet logged is lost. Update
   anyway?"*
5. After confirming: **v2.7.0**, the old cache cleaned up so only
   `bulk-v2.7.0` remains — and the data was **still 1 set, 1 session**.

That is the design. `sw.js` never calls `skipWaiting()` on its own; the new
build sits in the wings until the app asks for it, because losing a set to a
reload mid-session is worse than running yesterday's build for another hour.

If your phone is still on **v2.1.3** — you never accepted the v2.4.0 update —
the banner you see will be the old one, "A new version of Bulk is ready",
because the page drawing it is that build. It still waits for your tap. From
v2.4.0 onward the banner names both versions, and the running version sits next
to the title on every screen.

**When it does not wait:** a browser with no service worker yet — a new phone, a
different browser, a cleared site — gets v2.7.0 straight away. That is a first
install, not an update, and there is nothing of yours there to preserve.

---

## What to do when you update

Nothing is required. But:

1. **Take a backup first.** Log → Backups → *Export a zip*. Not because the
   update is risky, but because a backup you have is worth more than a
   guarantee you were given, and it is one tap.
2. Publish (below).
3. On the phone, open the app. The banner appears. **Tap it when you are not
   mid-session** — applying an update reloads the page, and an unlogged set
   would be lost. The app warns you if a session is open.
4. Check the version next to the title reads `v2.7.0`. If it does not, the
   update has not reached that device: close every tab and reopen.

---

## Publishing

```bash
cd /path/to/bulk-source
git checkout claude/project-onboarding-verify-lz3ob6
npm test                                                    # 333, 0 failing
grep VERSION sw.js                                          # reads v2.8.1
npm run publish -- https://github.com/FranVuckovic/bulk.git
```

`dev/publish.sh` copies exactly the files listed in `sw.js`'s `SHELL` array,
plus `sw.js` itself and a generated README — 29 in total — into `dist/`, then
force-pushes that as the whole public repository. `docs/`, `test/`, `dev/`,
`archive/` and your notes stay on your machine.

---

## Rolling back

The two states are both on `origin`, so neither can be lost:

| | Commit | What it is |
|---|---|---|
| **Oldest kept** | `5ffae2e` — branch `main` | v2.1.3 |
| **Previous release** | `e304ef7` on `claude/project-onboarding-verify-lz3ob6` | v2.4.0 |
| **Live now** | tip of `claude/project-onboarding-verify-lz3ob6` | v2.8.1 |

Rolling back from v2.8.1 means republishing from
`e304ef7` rather than from `main` — v2.4.0 is the version you have actually
used, so it is the sensible thing to fall back to:

```bash
git checkout e304ef7
npm run publish -- https://github.com/FranVuckovic/bulk.git
```

Going all the way back to v2.1.3:

To go back:

```bash
git checkout main
npm run publish -- https://github.com/FranVuckovic/bulk.git
```

**This is exact, not approximate.** Rebuilding the publish set from `main` was
compared byte-for-byte against the live site on 20 August 2026 and every one of
the files was identical. Rolling back reproduces what is running today.

Three things worth knowing about a rollback:

- **Your phone will not roll itself back either.** It sees the changed `sw.js`,
  downloads v2.1.3, and waits for your tap — the same as any other update.
- **Data logged on a newer build survives a rollback.** The database version
  has never changed, so every build since v2.1.3 shares one schema. Newer
  fields — which scale a weigh-in was on, when the tape was read, the exercise
  notes, whether a session's timing is real — are simply not displayed by an
  older build. Nothing is deleted, and they reappear if you go forward again.
- **The public repo's history is replaced every publish** (`git init` then
  `push -f`), so the rollback is a re-publish from source, not a `git revert`
  on the public repo. That is why the two commits above matter, and why they
  are both pushed.

---

## Reverting only part of it

Twenty commits, each one thing. `TRY-THIS.md` lists them all with which are
safe to revert alone. Four are marked **keep** — they are defect fixes with no
visual component, and one of them stops a red day from moving every logged set
onto the wrong exercise from rotation 11 onward.
