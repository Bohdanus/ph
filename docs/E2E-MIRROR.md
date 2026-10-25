# E2E Mirror

`Bohdanus/ph` is the private compute mirror; `drguz69/lightshopy.com` is the source.
EC2 is retired.

Run from a clean, committed, non-`main` branch:

```bash
npm run test:e2e:mirror -- --spec e2e/<file>.spec.ts [--platform linux|windows|macos]
npm run test:e2e:mirror -- --full
npm run test:e2e:mirror -- --linux-baselines --chat-id <native-session-id>
```

The CLI pushes only the current branch to `mirror`, then runs its exact SHA. Focused
and full test jobs are read-only; failed-run artifacts go under
`test-results/remote-e2e/` for inspection.

Linux baselines are captured and verified on `ubuntu-latest`. An isolated
`contents:write` job promotes only the seven Linux PNGs to that same mirror branch,
with the supplied `Chat:` trailer; the CLI fast-forwards the local branch.

Workflows must be present on mirror `main`. Dispatch requires `gh` access with
Actions write permission on `Bohdanus/ph`; artifacts are retained for 7 days.
Resolve the native chat ID using [`CHAT-ID.md`](CHAT-ID.md).
