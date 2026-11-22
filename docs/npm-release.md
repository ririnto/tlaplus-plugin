# Finish a staged npm release

Run the release from a checkout at the release tag.
Use Bash, jq, OpenSSL, GitHub CLI, and Node.js 24.22.3 with npm 11.19.1, the toolchain pinned in the staging job.

Before pushing the release tag, confirm each of the eight packages allows `npm stage publish` for the GitHub Actions trusted publisher in `ririnto/tlaplus-plugin`, workflow filename `publish.yaml`.
The staging job uses OIDC and requests provenance.
Use a maintainer npm session with 2FA for approval and dist-tag changes.
[npm staged publishing](https://docs.npmjs.com/staged-publishing/) · [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) · [npm dist-tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)

## Check the staging run

1. Find the completed **Publish package** run triggered by the tag push.
   Check the run's tag, head commit, and successful conclusion against the release you intend to approve.
2. Set `run_id` to that run's ID and `git_tag` to its tag.
   Download the artifacts into an empty directory.

   ```sh
   artifacts=$(mktemp -d)
   gh run download "$run_id" --repo ririnto/tlaplus-plugin --pattern 'npm-*' --dir "$artifacts"
   ```

3. Open `npm-release/manifest.json` under that directory.
   It records the tag, commit, npm version, dist-tags, and checksums for all eight preflight tarballs.
   Open `npm-stage/submissions.ndjson` for the corresponding npm receipts.
   A `submitted` record means npm returned a matching stage ID.
   An `attempting` record without a `submitted` record leaves the result unconfirmed, even if the job stopped before writing `unconfirmed`.

If submission stops, suspend approval.
Use the failed step's package, version, and npm error together with `npm stage list <package-name>` and public registry reads to reconcile each attempted package.
The workflow stops at the first unconfirmed result and rejects repeat attempts.
Keep confirmed IDs and determine which submissions exist before arranging recovery.

## Approve the platform packages, then the main package

1. For each stage ID, inspect `npm stage view <stage-id>`.
   Match the name, version, holding tag, publisher, and SHA-1 checksum to the run evidence.
   The holding tag is `staged-<npm-version>`, so approving an older release affects its own tag.
2. Approve the seven native package IDs using `npm stage approve <stage-id>` and complete each 2FA prompt.
   Keep the result for each package.
   If the registry read below fails, wait for npm to show the approvals or investigate the reported package before proceeding.

   ```sh
   bash scripts/npm-release.sh platforms "$git_tag" "$artifacts"
   ```

3. Approve the main package ID with `npm stage approve <stage-id>` and complete the 2FA prompt.

## Move the consumer dist-tags and create the GitHub Release

Run every promotion and finalization from the same Git clone on the designated release host.
Only the maintainer with release custody moves the consumer tags through the script.
The lock covers cooperating script commands in that clone and its linked worktrees.
Separate clones, other hosts, and direct npm dist-tag writes fall outside this procedure.
npm updates each dist-tag individually without a compare-and-swap operation.

```sh
bash scripts/npm-release.sh promote "$git_tag" "$artifacts"
bash scripts/npm-release.sh release "$git_tag" "$artifacts"
```

`promote` checks all eight holding tags and published tarball integrities before updating any consumer tag.
It uses `npm dist-tag add <package>@<exact-version> <tag>` for the TLA+ Tools tag and `latest`, with the main package last.
If either consumer tag points to a newer or unrecognized release, the script stops.
After an interrupted promotion, check the registry and resume the same accepted release if the guards still pass.
If a process was killed and left the lock behind, confirm it has exited before removing the empty `npm-release.lock` directory in the clone's Git common directory.

`release` checks the tarball integrities and both consumer tags again before creating the GitHub Release with the original tarballs.
It also verifies that the remote Git tag still points to the release commit.
The new GitHub Release triggers the seven public registry smoke jobs.
