# Releasing

How changes reach `main`, how the version is set, and how a release is cut.

## Branches

`main` is the only long-lived branch. Every change reaches it through a pull
request:

- CI must pass: **Node 22**, **Node 24** and **Desktop shell (cargo check)**.
- PRs are squash-merged, so each one becomes a single commit titled with the
  PR title. Merged branches are deleted.
- Nobody pushes to `main` directly. The maintainer can bypass the rules only
  through a PR, for emergencies.

Merging to `main` does not release anything. Merged work waits under
`## [Unreleased]` in `CHANGELOG.md` until the next release.

A `release/X.Y` branch exists only to patch an older release while `main`
holds work that isn't ready to ship (see [Hotfixes](#hotfixes)).

## Changelog

A PR that changes something users run (the app, the server, the desktop
shell) adds a line under `## [Unreleased]`, in the existing sections: Added,
Changed, Fixed, Removed. The **Changelog** check fails without one. Label the
PR `no-changelog` when users won't notice the change, as with refactors, tests,
CI and docs. The check is advisory and doesn't block merging.

The Unreleased section becomes the release notes, so write it for users.

## Versions

[Semantic Versioning](https://semver.org/), while the version is 0.x:

| Bump | When |
|---|---|
| **Patch** (0.2.**1**) | Fixes only. |
| **Minor** (0.**3**.0) | New features, and any breaking change: an HTTP API or MCP tool changing shape, or a data directory migration. List breaking changes under Changed or Removed. |
| **1.0** | When the HTTP API, the MCP tools and the data directory format are promised stable. |

The version is recorded in eight places: the root, `app`, `server` and `site`
`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`. Don't edit them by hand.
`scripts/version.mjs` sets them together, and CI fails if they disagree:

```bash
node scripts/version.mjs check         # all agree? prints the version
node scripts/version.mjs bump minor    # patch | minor | major | X.Y.Z
node scripts/version.mjs notes 0.3.0   # that release's changelog section
```

Versions are plain `X.Y.Z`. The Windows installer's version field accepts
numbers only, so there are no `-rc` versions. A release candidate is a build
of the release PR (step 2 below).

## When to release

- **Patch:** soon after a fix for a reported bug lands, within days.
- **Minor:** when Unreleased holds a coherent set of features, or when `main`
  has gone three to four weeks without a release.
- Don't let `main` go more than about a month unreleased, and avoid releasing
  right before you'll be unavailable to fix a broken installer.

## Cutting a release

1. **Actions → Prepare release → Run workflow.** Pick `patch`, `minor`,
   `major` or an exact version, with `base` set to `main`. The workflow bumps
   every version file, turns `## [Unreleased]` into `## [X.Y.Z] - date`, and
   opens a **Release X.Y.Z** PR. It refuses to run when Unreleased is empty.
2. **Try the installers.** With `installers` left on, the workflow also
   builds the Windows and macOS installers from the PR branch. Download them
   from that **Release** run's artifacts and install them on a real machine.
   This step matters most for a minor release, or anything that changes
   packaging (the bundled Node, audio.cpp, signing).
3. **Review the notes** in the PR. Edit `CHANGELOG.md` on the PR branch if
   needed: that section becomes the GitHub Release text.
4. **Merge the PR.** **Tag release** sees a version with no tag, tags the
   merge commit `vX.Y.Z`, and starts **Release** on the tag. That builds the
   installers again and attaches them to a draft GitHub Release with the
   changelog section as its notes.
5. **Publish the draft** from the Releases page once the assets are all there.
   Check that `latest.json` is among them: publishing is what offers the
   update to installed copies.

The tag is created by the merge. Don't push version tags by hand, except for
a pre-release (below).

## Hotfixes

When a fix can't wait for `main` to be releasable:

1. Merge the fix to `main` first, as usual.
2. Create `release/X.Y` from the release's tag, for example
   `git switch -c release/0.3 v0.3.0` and push it.
3. Open a PR into `release/0.3` that cherry-picks the fix, with its changelog
   line under Unreleased.
4. Run **Prepare release** with `bump: patch` and `base: release/0.3`, then
   merge the PR it opens. Tagging works the same on `release/**` branches.
5. Copy the new `## [0.3.1]` changelog section into `main` in a small PR, so
   `main`'s changelog keeps the full history.

## Pre-releases

A tag with a hyphen, such as `v0.4.0-beta.1`, makes a draft marked as a
pre-release. It isn't part of the normal flow, since release candidates are
PR builds. It's there for a wider test, pushed by hand on a commit of `main`.
Its installers carry the version in the files, not the tag's suffix.

## One-time repository settings

These live in GitHub, not in the repo:

- The **Main** ruleset on the default branch: PR required, the three checks
  above required, squash only, linear history, no deletion or force-push, and
  the maintainer can bypass only through a PR.
- Squash merge only, PR title as the commit title, branches deleted after
  merge.
- Settings → Actions → General: **Allow GitHub Actions to create and approve
  pull requests** turned on, so Prepare release can open its PR.
- A `no-changelog` label.
- The **updater key** secrets (below).

## Update counts

The app asks `https://mirli.app/api/update` once a day (see
[PRIVACY.md](./PRIVACY.md)). The function in `api/update.ts` deploys with the
site on Vercel and adds one to a Redis hash per request:
`installs:<date>` → `<version>|<platform>` = count.

To turn counting on, add an Upstash Redis store to the Vercel project
(Marketplace → Upstash) and let it set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` (the `KV_REST_API_*` names work too). Without them
the endpoint still answers and counts nothing. Read a day back with
`HGETALL installs:2026-11-17`. Keys expire after about 400 days.

Counts are requests, not people: with no install ID, a copy that runs for a
week is about seven counts, and anyone can send junk that passes validation.
Treat them as a trend by version.

Check the deploy with `curl "https://mirli.app/api/update?v=0.4.1&p=win32-x64"`:
it should answer `{"latest":"…","url":"…"}`.

## Updater key

Installed copies update themselves (see [DESKTOP.md](./DESKTOP.md#updates)).
Each update is signed with a minisign key pair: the public half is in
`src-tauri/tauri.conf.json`, the private half is the repository secret
`TAURI_SIGNING_PRIVATE_KEY`, with its password, if any, in
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without the secret, **Release** still
builds installers but warns and attaches no `latest.json`, so nobody is
offered that version.

Keep a backup of the private key outside GitHub. If it's lost, a new key pair
needs a new public key in the app, and every copy installed before that can't
verify updates anymore: those users have to download one installer by hand.
