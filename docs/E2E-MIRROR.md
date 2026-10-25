# E2E Mirror

`Bohdanus/ph` is the compute mirror; it is currently public. `drguz69/lightshopy.com`
is the source. Repository visibility remains operator-controlled; workflow target guards
bind to the repository name, not its visibility.
The mirror is a separate repository, not a GitHub fork, and does not sync automatically.
A green mirror run does not establish that source-repository CI is green; source changes
must be landed there separately.
These workflows use standard GitHub-hosted runners; GitHub currently documents
runner-minute usage for public repositories as free. Artifact storage is separate
and shares the account's Actions/GitHub Packages allowance; usage beyond the
included amount may be billed. Artifacts are retained for 7 days. Account spending
limits are managed outside this repository; larger runners are not used. Recheck the
[billing policy](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
before changing repository visibility, runner type, or artifact retention.

Run from a clean, committed, non-`main` branch:

```bash
npm run test:e2e:mirror -- --spec e2e/<file>.spec.ts [--platform linux|windows|macos]
npm run test:e2e:mirror -- --full
npm run test:e2e:mirror -- --linux-baselines --chat-id <native-session-id>
```

The CLI pushes only the current branch to `mirror`, then runs its exact SHA. Use the
CLI rather than bare `git push`: the local push default is the source repository.
The `test:e2e:mirror` CLI launches runs with `repository_dispatch`, which uses the
workflow version on the repository's default branch rather than a selectable feature
ref. Automatic CI also runs on pushes to `main` and pull requests targeting `main`.
Fork PRs receive read-only tokens; same-repository PR authors can edit workflow
permissions and are treated as trusted workflow authors. Focused and full CLI jobs are
read-only; failed-run artifacts go under
`test-results/remote-e2e/` for inspection.

Linux baselines are captured and verified on `ubuntu-latest`. An isolated
`contents:write` job promotes only the seven Linux PNGs to that same mirror branch,
with the supplied `Chat:` trailer; the CLI fast-forwards the local branch.

The CLI refreshes mirror `main` and verifies that the requested workflow is active
and its Git blob exactly matches the committed workflow at your branch before it
pushes or dispatches. It pins the mirror `main` commit through run discovery, so a
run from a newer workflow revision is rejected. Linux baseline capture uses a
`repository_dispatch` event, which GitHub runs from the default branch; this keeps
the `contents:write` promotion job on trusted mirror `main` code even when the tested
feature branch contains workflow edits. Merge workflow changes to mirror `main`
first; a missing, disabled, or stale workflow is refused before the feature branch is
pushed. Dispatch requires `gh` write access to `Bohdanus/ph`; artifacts are retained
for 7 days.
Authenticate with `gh auth login`; never put a PAT in repository files or command
arguments, and revoke credentials exposed in chats or logs.
Resolve the native chat ID using [`CHAT-ID.md`](CHAT-ID.md).
