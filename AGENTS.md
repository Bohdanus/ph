# AGENTS.md

Photoshop-inspired, production-grade photo editor. Instructions for coding agents.

**The detail lives in linked files.** Read the root file for the rules that apply
to every task; open the linked file when the task is that kind of work.

| File                                                   | Read it when                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`docs/TESTING.md`](docs/TESTING.md)                   | running or changing any check: `tsc`, `test`, `lint`, `e2e`, build, CI                                 |
| [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md)       | working alongside other agents: worktrees, the swarm board, the worktree list, recovering a dead agent |
| [`docs/PHOTOSHOP-UX.md`](docs/PHOTOSHOP-UX.md)         | touching the Tools rail, tool names, or panel behaviour                                                |
| `HANDOFF.md`, `TEST-FLAKES.md`, `e2e/OPEN_PROBLEMS.md` | filing or checking a known defect — see "Handoff documents"                                            |

## Subagents: THE DEFAULT, NOT THE FALLBACK

**LAUNCH AS MANY SUBAGENTS AS THE TASK WARRANTS. COMPUTE COSTS ZERO; QUALITY IS THE POINT.** 40 sequential tool calls in one context = 8 parallel subagents + a 6-call synthesis. Sequential tool calls are the defect, not the token count.

Delegate **first**, not after you get stuck. Fan-out signals: every caller of X, per-file audits, "does this test still pin the old behaviour", one sweep per subsystem.

### Model policy

**ALL GPT MODELS ARE PAID. EVERY OTHER MODEL IS FREE. THAT IS THE WHOLE RULE.**

1. **A FREE SESSION MUST NEVER LAUNCH A PAID SUBAGENT. NO EXCEPTION.** Cost is monotone downwards: a subagent may be weaker than its parent, never more expensive. A `model` that resolves to a GPT model is a bug in your call, not a judgement call. If no free model fits, use the best free one and say in the report that the task deserved a stronger model.
2. **A PAID SESSION MAY LAUNCH PAID SUBAGENTS** on the model the turn is already on — already authorised. Escaping to a _different_ paid model still needs the user to name it in that request. Rule 1 is the other direction.
3. **ALWAYS PASS `provider` TOGETHER WITH `model`.** A bare name is matched leniently (case, punctuation, word order ignored) and can resolve to a different provider's model; with no `provider` it falls back to the **Kilo Gateway**, which returns a GPT model under a `~`-prefixed id — `~openai/gpt-luna-latest` is a gateway substitution, not the `openai` model of that name. **A `~` id is a GPT model, so it is paid.**
4. `model: 'Space Bunny Alpha (new)', provider: 'kilo', variant: 'max'` — free, nearly as good as GPT Luna, the default for nearly every subagent. Other free models are useless; do not spend a turn sampling them.
5. **Double billing starts earlier on GPT Luna than on the other paid GPT models: past ~200k of context on Luna, past ~270k on GPT Sol and GPT Terra.** Keep the main turn lean; push fan-out into fresh contexts.
6. `agent_manager` too: a managed session inherits the current turn's model, so a main turn on a paid model spawns paid worktrees unless `model` and `provider` are both set.

```ts
task({
  subagent_type: 'explore', // or 'general'
  model: 'Space Bunny Alpha (new)',
  provider: 'kilo',
  variant: 'max',
  prompt: '...',
});
```

- Omitting those three fields inherits the current turn's model. Passing them explicitly is what keeps a subagent free when the main turn is not.
- **DO NOT ESCALATE TO A PAID MODEL ON YOUR OWN** for "hard" or "risky" work. Override only when the user named a GPT model in that request, and say so when you do.
- `agent_manager` (visible sessions, git worktrees) is a different tool: only when the user wants visible sessions or worktrees. `task` for everything else — it creates no sessions.
- Audit before spawning a fleet, not after: `sqlite3 ~/.local/share/kilo/kilo.db "SELECT json_extract(model,'\$.id') m, json_extract(model,'\$.providerID') p, count(*) FROM session GROUP BY 1,2 ORDER BY 3 DESC"` — `session.model` is a TEXT column holding JSON; there is no `data` column on `session`.

### Rules of delegation

- **NEVER TWO SUBAGENTS ON THE SAME FILE.** Split by concern, not by convenience.
- **Self-contained briefs.** A subagent has a fresh context: give it the goal, your constraints, whether it may edit code, and exactly what its final message must contain. "Return file:line for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not verified. Have subagents report candidate results _and_ how they got them, then check the load-bearing ones yourself.
- **Keep judgement calls.** Architecture, scope, whether a deviation is acceptable: a subagent cannot weigh this file against the operator's intent. "Looks good to me" is not authorization.
- **Background for long work** (`background: true`), and wait for every result you depended on. NEVER answer while one is still running.

## NEVER OPEN A BROWSER WINDOW

**A headed browser takes over the operator's screen and their input reaches the page as real test input, so a headed run fails for reasons that are not in the code. `test:e2e` is headless and stays that way** — never pass `--headed`, `--ui`, `--debug`, `show-report`, `show-trace`, `codegen`, or `PLAYWRIGHT_ALLOW_HEADED=1`, and do not "fix" a failure by flipping the mode. If something only reproduces visually, ask the operator to run `npm run test:e2e:headed` themselves. Blocked-command table and the two holes in enforcement: [`docs/TESTING.md`](docs/TESTING.md).

## Working with other agents

Orchestration detail — the board's commands, leases, `doctor`, and the worktree
inventory — is in [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md). What applies
to every task:

- **Every change to a tracked file happens in its own worktree under
  `.kilo/worktrees/`, on its own branch.** `main` is for reading and merging.
  Before the first edit, `git rev-parse --show-toplevel` must resolve under
  `.kilo/worktrees/`. Create it first, e.g.
  `git worktree add -b fix/task .kilo/worktrees/task`. Read-only work, and changes
  the operator explicitly asked for on `main`, are the only exceptions — a
  doc-only change is not one. If you are already in a worktree, do not nest
  another.
- **Only one root-level agent writes any worktree.** A root-level agent is one a
  human started as a Kilo chat; two of them never work in the same worktree, and
  one does not take over a worktree another is inside. This one the board cannot
  enforce — identity is the branch, so two root agents in one worktree are the
  same agent to it. Subagents of one root agent do share that agent's worktree
  and must split by file.
- **Claim what you touch before the first edit:** `npm run swarm -- claim <id>
--files <paths>`, or `swarm hold <path>` with no issue. A refused hold names the
  holder; take their lock first, never `--force` it. Announce a branch you are
  about to land with `swarm note` before you start resolving it.
- **Merge order:** `main` into the branch **in the worktree**, resolve and run
  gates there, then merge the clean branch into `main`. Never resolve conflicts or
  repair the index in `main`. Never `git stash` — it is a shared unordered stack.
- **A quiet agent is not a dead agent.** If a session died, preserve its worktree
  before reclaiming anything: inspect with `git status`/`git diff`/`git log -1`,
  preview with `npm run swarm -- doctor --dry-run`, then `npm run swarm -- doctor`.
  Force-release only a session confirmed dead, and never because a network-lost
  one stopped talking.
- **The list of worktrees is not written down anywhere by hand.** Run
  `node scripts/worktree-inventory.mjs` to regenerate `WORKTREES.json`, and read
  it before deleting a worktree. `0 commits ahead of main` is **not** evidence a
  worktree is disposable — it can hold uncommitted work that exists on no ref.

## Architecture status

`PaintToolName` is `'brush' | 'pencil'` and that narrowing is load-bearing, not
tidiness. A tool that SUBSTITUTES pixels cannot share a processor, an args type or
an options bar with one that STAMPS them: sharing the union is exactly what let a
forced `'spray'` `penType` masquerade as a tool setting, and a tool that has left
the paint panel must not be widened back into it to accommodate a new bar. The
corollary for persistence is `HANDOFF.md` 70 — a group that persists one key may
not absorb a tool that has more than one.

`HistoryItem[]` is the **PRODUCTION REPLAY AUTHORITY**: history,
`history-replay.ts`, runtime `Layer`s, and export. The durable document is
shadow-only. Re-read code and plans before crossing the boundary. **DO NOT start
single-writer cutover while `saveLayerCanvas()` promotes cached canvases outside
reducer publication.**

## Definition of Done

**A TASK IS NOT DONE UNTIL THE WORK IS MERGED INTO `main` AFTER A THOROUGH CODE REVIEW. NOT "IMPLEMENTED", "COMMITTED", "PUSHED", "PR OPEN", OR "THE TESTS PASS".**

1. **Isolated**, in its own worktree on its own branch.
2. **Green locally**: `lint:check`, `tsc`, `build`, `test`; `test:e2e` when the change is user-visible, `test:e2e:unit` when it touches an e2e helper. See [`docs/TESTING.md`](docs/TESTING.md). "It was already failing" is a fact to report, not a reason to stop.
3. **Covered** by a test that fails without the change. A fix that cannot be pinned by a test is a fix that comes back.
4. **Documented**: handoff docs updated, and any new gate, test trap, or architecture boundary written down where the next agent looks.
5. **Reviewed by someone else**, thoroughly: the diff, the surrounding code, the tests, and its own load-bearing claim re-run. Not the author. A finding sends the task back.
6. **Merged into `main`** after review and passing gates.
7. **Reported as done**: what changed, what validation ran, what the review said.

- **A blocked merge is not done.** Operator decision pending, a defect the operator wants kept, a conflict that needs judgement: say so and name what is outstanding. Reporting "done" with an unmerged branch is the failure mode this section exists to prevent.

## Handoff documents

`HANDOFF.md`, `TEST-FLAKES.md`, and `e2e/OPEN_PROBLEMS.md`: validated, actionable problems only. **NO changelog, completion notes, or status summaries.** Verify against the tree.

- **Route by scope.** `HANDOFF.md` is for history/replay and document-state defects. `TEST-FLAKES.md` is for test-infrastructure defects — flakiness, the pool, the runner, the gates themselves. `e2e/OPEN_PROBLEMS.md` is for Playwright. Do not file a gate or pool defect in `HANDOFF.md`; it is scoped, and a cross-scope entry is the one nobody reads.
- **Nothing durable goes in `.kilo/` or the swarm database.** Both are machine-local; findings belong in the scoped handoff documents. Close the swarm entry when its verified finding is deleted from the handoff.
- **Line-numbered handoff citations move with the file.** If a diff adds or removes lines above `file.ts:NNN`, re-derive every citation below it from the prose's claim.

**WRITE OR UPDATE THE HANDOFF WITHOUT ASKING** for every validated issue, strong recommendation, or durable finding. Ship it with the work.

### Lifecycle: entries die, they never get reworded

- **Verified fix: DELETE the entry.** Verification is another agent, review, or test, not the fixer's claim.
- **Never rewrite an open problem as closed.** Keep unverified work as the exact remaining verification; keep only test tripwires after a fix.
