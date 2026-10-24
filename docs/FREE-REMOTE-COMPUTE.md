# Free Remote Compute for Project Tests

Use the local `ssh e2e` alias for broad headless E2E runs and Linux/ARM64 validation. Measurements below were checked on 2026-10-24; recheck the host before relying on them.

| Host           | Observed setup                                                                                                                              | Use                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `e2e`          | Ubuntu 26.04.1 LTS, ARM64, 2 vCPU, 1.8 GiB RAM, 4 GiB swap, 46 GiB root disk (37 GiB free), Node 24.22.1, npm 11.19.1, Chrome 156.0.8078.47 | One E2E process at a time, with `--workers=1`; targeted Linux checks; sequential unit/type/build checks |
| Older instance | Amazon Linux 2023, about 6 GiB free disk during setup; no longer the `e2e` alias target                                                     | Ignore for project runs unless it is reprovisioned                                                      |

The useful gain is moving long browser runs off the local workstation. A `t4g.small` is not a high-throughput runner: its two vCPUs and 2 GiB RAM do not support several concurrent Chrome workers reliably. Swap can prevent memory exhaustion but does not add CPU or make parallel runs faster.

## Full-suite experiment

The one-worker full-suite run on the older EC2 checkout (`d124d323`) took about 34 minutes and ended with 22 failures: 7 Linux visual-baseline files were missing, and 15 other failures were in crop-history, levels, paint, and text specs. This is not a green run, does not establish that those 15 failures are ARM-specific, and is not evidence about the newer local `main`. The run also exceeded the GitHub Linux job's 30-minute timeout. The current instance is useful for offloading focused checks and asynchronous reproduction, but one `t4g.small` is too slow to replace the blocking Linux CI job as an unsharded full-suite runner. Diagnose the non-baseline failures and add matching Linux baselines before treating the gate as green.

## Capacity and billing

AWS currently lists `t4g.small` in its time-limited Free Tier trial. The published trial allows up to 750 instance-hours per month through 2026-12-31, subject to account, region, AMI, and usage conditions. Storage and other resources can still incur charges. Verify the account current billing view before a run; do not treat this VM as permanently free. See [EC2 Free Tier usage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html), [AWS EC2 FAQs](https://aws.amazon.com/ec2/faqs/), and [general-purpose instance specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html).

The small memory budget makes overlap the main operational risk. Run one gate at a time, and do not start a second shell, install, watcher, or test runner while a gate is active. Do not attach this persistent host as a GitHub self-hosted runner for pull requests: workflow code can execute arbitrary commands, and a persistent runner can expose its home directory and credentials. GitHub Actions remains on GitHub-hosted runners.

## Worktree and runner checks

Follow the repository worktree rules on the remote host too. Use the required bootstrap steps below to locate the main worktree and create a task worktree. After verifying the task worktree, run other Git and npm commands only there; do not run npm from the remote main checkout.

```bash
cd /home/ubuntu/ph
git worktree list --porcelain
# Replace <main-worktree-path> with the listed path whose branch is refs/heads/main.
# This one-time bootstrap creates the task worktree; run later commands inside it.
git -C <main-worktree-path> worktree add /home/ubuntu/ph/.kilo/worktrees/<task-worktree> -b task/<task-branch>
cd /home/ubuntu/ph/.kilo/worktrees/<task-worktree>
git rev-parse --show-toplevel

# For an already-created task worktree, enter its path and verify it instead.
cd /home/ubuntu/ph/.kilo/worktrees/<task-worktree>
npm run repo:state
npm run swarm -- status --json
```

Wait for each command to finish before starting the next. `npm run test:e2e` uses the E2E runner lock; unit tests, typecheck, and build do not share that lock, so the one-runner rule still applies across all gates.

## Agent workflow for broad E2E

Publish the tested commit from the local task worktree before asking the remote checkout to run it. Do not copy an uncommitted tree or run from the remote `main` checkout.

```bash
# Local task worktree: commit the snapshot, then publish its branch.
git push -u origin <source-branch>

# EC2: create one remote task worktree for this source branch.
# Replace <main-worktree-path> with the path reported for refs/heads/main by
# `git worktree list --porcelain`, as described in "Worktree and runner checks".
git -C <main-worktree-path> worktree add \
  /home/ubuntu/ph/.kilo/worktrees/remote-e2e-<task> \
  -b task/remote-e2e-<task> main
cd /home/ubuntu/ph/.kilo/worktrees/remote-e2e-<task>
git rev-parse --show-toplevel
npm run repo:state
npm run swarm -- status --json
git fetch origin <source-branch>
git merge --ff-only FETCH_HEAD
npm ci
npm run test:e2e -- --workers=1
```

Keep the remote worktree for repeated checks of that branch; after a new branch commit, fetch and fast-forward it in that same worktree, then rerun the suite. If the source branch was rebased or the fast-forward fails, stop and create a new task worktree instead of resetting the existing one. Run `npm ci` again when the lockfile changes. Focused, fast specs and non-browser checks can still run locally; use EC2 for the broad browser run so local agents retain headroom for frequent focused gates.

The current `e2e` host can run one full suite, not multiple shards concurrently. If more suitable EC2 hosts are added, scale by running one `--workers=1 --shard=i/N` process in a separate task worktree on each host. Sharding improves throughput only across independent machines; running those shards concurrently on one `t4g.small` increases CPU and memory contention and can make results less stable.

## Useful runs

Use a targeted Linux check first, then run the full gate when the task requires it:

```bash
npm run test -- scripts/__tests__/agent-board.test.mjs --maxWorkers=1
npm run test -- --maxWorkers=1
npm run test:e2e:unit
npm run tsc
npm run build
npm run test:e2e -- e2e/<focused-spec>.spec.ts
```

Run only one command at a time. The headless E2E wrapper starts its own server and selects an isolated output directory. Do not run a headed browser for a gate.

The VM is useful for:

- Reproducing Linux-only unit failures and validating filesystem or process behavior.
- Running a focused headless Playwright spec on Linux/ARM64.
- Running typecheck or a production build away from the local machine, one at a time.
- Capturing Linux screenshots as review artifacts when the target environment is also Linux/ARM64.

It is not a GPU worker or a parallel CI runner. Headless Chrome is useful for functional checks, but the ARM64 host is not pixel-equivalent to GitHub's x86-64 `ubuntu-latest` runner. CPU-only rendering does not remove differences from CPU architecture, OS, browser build, and fonts.

## Visual regression baselines

The repository keeps baselines under `e2e/export/visual-regression.spec.ts-snapshots/export-baselines/<platform>/`. The `darwin/` and `win32/` sets are committed; Linux is missing. Never use this host to overwrite another platform's images.

Committed visual baselines currently exist for `darwin/` and `win32/`; the Linux baseline directory is missing. The GitHub Linux job uses `ubuntu-latest`, while this EC2 host is ARM64 on Ubuntu 26.04.1, so its screenshots are not evidence for that CI baseline. CPU-only rendering is not a sufficient match. After publishing the manual [`Capture Linux export baselines` workflow](../.github/workflows/capture-linux-baselines.yml) on the repository's default branch, dispatch it on the candidate ref (GitHub write access is required), review the downloaded artifact, and add its images in the task worktree. Until those files are committed, Linux visual-baseline tests remain a known failure; do not skip them or restore `continue-on-error`.

## Other useful tasks

The most useful additional work here is reproducing a platform-specific failure, checking ARM64 dependency compatibility, and collecting headless screenshots for review. A future Linux/ARM64 CI leg could use it to validate its own baseline set. Free LLM inference is separate from this machine; follow [`FREE-COMPUTE.md`](FREE-COMPUTE.md) and verify the route response and cost before trusting it.
