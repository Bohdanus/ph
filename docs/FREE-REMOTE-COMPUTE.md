# Optional EC2 Diagnostics

The `ssh e2e` host is a small ARM64 machine for targeted Linux reproduction and
dependency-compatibility checks. It is optional. Use [`E2E-MIRROR.md`](E2E-MIRROR.md)
for routine focused or full E2E runs, cross-platform checks, and Linux baseline
capture.

## Observed environment

Read-only check via `ssh e2e` on 2026-10-25:

- Ubuntu 26.04.1 LTS, `aarch64` (ARM64)
- 2 CPUs, 1.8 GiB RAM, 4 GiB swap
- Node.js 24.22.1
- Google Chrome 156.0.8078.47

These are point-in-time observations; verify the host before relying on them.
Avoid concurrent browser E2E runs on this limited host.

GitHub's standard [`ubuntu-latest` runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
is x64. Because this host is ARM64, its screenshots are not substitutes for
the CI Linux baselines. Generate and promote those baselines only through
[`capture-linux-baselines.yml`](../.github/workflows/capture-linux-baselines.yml),
as described in [`E2E-MIRROR.md`](E2E-MIRROR.md).

## Safe use and billing

Use a dedicated task worktree and follow the repository's
[`ORCHESTRATION.md`](ORCHESTRATION.md) and [`TESTING.md`](TESTING.md) rules.
Do not run project Git or npm commands from the main checkout.

Keep this host SSH-only; do not register it as a persistent GitHub Actions
self-hosted runner for workflows that process untrusted pull-request code.
Review GitHub's [security guidance](https://docs.github.com/en/actions/reference/security/secure-use)
before changing that boundary.

This guide does not verify the AWS account's plan, credits, or Free Tier
eligibility. Check the account's billing and Free Tier dashboards before
assuming no-cost use. Eligibility depends on account creation date and plan;
usage outside eligible benefits can incur charges. See the official
[EC2 Free Tier guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)
and [AWS Free Tier plans](https://docs.aws.amazon.com/us_en/awsaccountbilling/latest/aboutv2/free-tier.html).
