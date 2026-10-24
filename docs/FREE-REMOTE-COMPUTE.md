# Free Remote Compute for Project Tests

Use the local `ssh e2e` alias for sequential Linux validation and for reproducing Linux-specific failures. The host is an AWS EC2 `t4g.small`: 2 vCPU, 2 GiB RAM, ARM64 Graviton2, and no GPU. Check the live OS, swap, disk, Node, Chrome, and Playwright versions before relying on recorded setup details.

## Capacity and billing

AWS currently lists `t4g.small` in its time-limited Free Tier trial. The published trial allows up to 750 instance-hours per month through 2026-12-31, subject to account, region, AMI, and usage conditions. Storage and other resources can still incur charges. Verify the account current billing view before a run; do not treat this VM as permanently free. See [EC2 Free Tier usage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html), [AWS EC2 FAQs](https://aws.amazon.com/ec2/faqs/), and [general-purpose instance specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html).

The small memory budget makes overlap the main operational risk. Run one gate at a time, and do not start a second shell, install, watcher, or test runner while a gate is active.

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

It is not a GPU worker or a parallel CI runner. The CPU-rendered browser is useful for functional checks, but its screenshots may differ from macOS and from an x86-64 Linux CI image.

## Visual regression baselines

The repository keeps baselines under `e2e/export/visual-regression.spec.ts-snapshots/export-baselines/<platform>/`. Only `darwin/` is currently committed; Linux and Windows fail as missing until their platform-specific sets are recorded. Never use this host to overwrite `darwin/` images.

The VM is ARM64, so its output is suitable for an ARM64 Linux baseline only when the consuming CI job uses a matching browser, fonts, and rendering stack. Before adding Linux baselines, compare the VM to the actual CI runner and review every generated image. Use `npm run test:e2e:update-baselines` only from the intended Linux task worktree; do not assume this VM screenshots will satisfy an x86-64 Linux job.

## Other useful tasks

The most useful additional work here is reproducing a platform-specific failure, checking ARM64 dependency compatibility, and collecting headless screenshots for review. A future Linux/ARM64 CI leg could use it to validate its own baseline set. Free LLM inference is separate from this machine; follow [`FREE-COMPUTE.md`](FREE-COMPUTE.md) and verify the route response and cost before trusting it.
