# Remote Validation and GitHub Actions Compute Mirror

`drguz69/lightshopy.com` is the private source of truth. `Bohdanus/ph` is
currently a private compute-only mirror. A mirror run is useful evidence for
its exact commit, but it does not replace required checks on the source
repository.

## Remote setup and safety

Configure `upstream` for the private source and `mirror` for hosted compute.
Set `remote.pushDefault` to `upstream` as a safety default. Branch-specific
`pushRemote` settings can override it, so always name the remote on every push
and the repository on every `gh pr` command.

```bash
# One-time setup if these remotes are not already present.
git remote add upstream git@github.com:drguz69/lightshopy.com.git
git remote add mirror git@github.com:Bohdanus/ph.git
git config remote.pushDefault upstream
git remote -v
```

Review the remotes before pushing, and never push secrets or unreviewed files.
Private-repository Actions can consume included minutes and may incur charges
if the allowance is exceeded; monitor account usage and budgets. Use SSH for
Git pushes and `gh auth login` with the configured OS credential manager for
workflow dispatches. The workflows use read-only `GITHUB_TOKEN` permissions
and require no personal-token secret. Revoke any token pasted into chat or
otherwise exposed.

## Recommended E2E cadence

1. After an E2E-relevant change, run the affected headless spec locally:

   ```bash
   npm run test:e2e -- e2e/<focused-spec>.spec.ts
   ```

2. For frequent hosted feedback, push the reviewed branch to the mirror and run
   the affected spec on the platform that matters:

   GitHub only dispatches a `workflow_dispatch` workflow if its file is present
   on the repository's default branch. The focused workflow must first be
   merged into the mirror's default branch; until then, run the focused spec
   locally or dispatch the existing full `ci.yml` workflow on the task branch.
   Once the focused workflow is available on the default branch, dispatch it as
   follows:

   ```bash
   git push mirror HEAD:refs/heads/<task-branch>
   gh workflow run focused-linux-e2e.yml -R Bohdanus/ph --ref <task-branch> \
     -f platform=windows -f spec=e2e/<focused-spec>.spec.ts
   gh run list -R Bohdanus/ph --workflow "Focused E2E" --branch <task-branch> --limit 5
   gh run watch <run-id> -R Bohdanus/ph --exit-status
   ```

   Choose `linux`, `windows`, or `macos`. The workflow runs one existing spec
   under `e2e/` on the corresponding hosted runner and uploads the report. It
   rejects paths outside `e2e/`. This is focused diagnostic feedback, not the
   full CI gate.

3. Run the full cross-platform workflow for broad validation and before
   landing:

   ```bash
   gh workflow run ci.yml -R Bohdanus/ph --ref <task-branch>
   gh run list -R Bohdanus/ph --workflow CI --branch <task-branch> --limit 5
   gh run watch <run-id> -R Bohdanus/ph --exit-status
   ```

   Once source Actions are available, source PR checks remain authoritative.
   A job rejected before runner startup with no executed steps is likely an
   account billing or spending-limit issue; inspect its annotations before
   diagnosing code. A successful mirror run does not clear that source block.

## Platform export baselines

Capture Linux, Windows, and macOS export images with the manual
[`Capture cross-platform export baselines` workflow](../.github/workflows/capture-linux-baselines.yml).
It captures each baseline on the corresponding hosted runner and verifies the
images before upload. Review the artifacts, then commit only approved images
under `e2e/export/visual-regression.spec.ts-snapshots/export-baselines/<platform>/`.
Artifacts expire after seven days; committed images are the durable baselines.
Do not use an ARM64 machine to create or overwrite the x86-64 CI baselines.

```bash
gh workflow run capture-linux-baselines.yml -R Bohdanus/ph --ref <task-branch>
gh run list -R Bohdanus/ph --workflow "Capture cross-platform export baselines" \
  --branch <task-branch> --limit 5
gh run download <run-id> -R Bohdanus/ph \
  --name <linux|win32|darwin>-export-baselines-<commit-sha> --dir /tmp/export-baselines
```

## Optional ARM64 EC2 use

The `ssh e2e` host was measured on 2026-10-24 as Ubuntu 26.04.1, ARM64, 2 vCPU,
1.8 GiB RAM, and 4 GiB swap. It can help diagnose ARM64-specific behavior or
run a focused Linux check, but it is not a routine full-suite runner, a
self-hosted GitHub runner, or a source for visual baselines. A one-worker full
suite on an older EC2 checkout took about 34 minutes and had 22 failures; this
was not a green run and exceeded the Linux CI job's 30-minute limit.

Even with free compute, the current host's performance and architecture are
poor substitutes for GitHub's x86-64 runner. Verify account-specific billing
and quotas before provisioning more instances; extra EC2 capacity is not needed
for the recommended E2E workflow.
