---
name: photoshop-tool-creation
description: Build a new Photoshop-faithful tool in the `ph` photo editor end to end - heavy web and repo research, a real options bar, a commit kind that is durable-replayable without migrating history, implementation, mutation-checked unit tests, e2e, aggressive subagent delegation, and a handoff doc. Use when asked to add, implement, or make a Photoshop tool/options bar in this repo.
---

# Photoshop tool creation

How to add a tool to `ph` that behaves like the Photoshop one, in a git worktree, with
research, tests, e2e, delegation and a handoff behind it.

**`AGENTS.md` is the authority, and it is already in context.** This document deliberately does
not repeat it. If a rule is stated in `AGENTS.md` — the commands, the gates, the worktree traps,
the headed-browser refusal, the subagent model policy, the handoff lifecycle — it is not restated
here, not paraphrased, and not restated with a citation attached. Where the two disagree,
`AGENTS.md` wins and this document is wrong. What follows is only what `AGENTS.md` does not say:
the Photoshop tool contract, the code surfaces, and the process for getting there.

**`AGENTS.md` is the short form, and `docs/ORCHESTRATION.md` is the detail behind it.** That
matters here, because a whole class of rules is in the second file and in neither section of the
first: the hard worktree rule and its exceptions, `scripts/main-worktree-guard.mjs`, never
`git stash`, the `git add -A` silent-revert trap and the `merge-takeover-guard.mjs` gate for it,
`WORKTREES.json`, and
the swarm board. An agent that reads `AGENTS.md`, finds no worktree rule beyond three traps, and
concludes none exists is following this document's own index correctly and still gets it wrong.
**Read `docs/ORCHESTRATION.md` before your first edit**, and treat a rule you cannot find in either
as a rule you do not know rather than one that does not apply.

Every `file:line` here was last re-verified on 2026-09-28. **Re-verify before you rely on one**,
and name a symbol as well as a line wherever you can: a stale citation sends the next session
after a bug that does not exist, and writing this skill corrected more than sixty of them.

## When to use this

- The operator asks for a Photoshop tool the app does not have, or asks that an existing one
  "look like Photoshop" / "have proper options".
- An options bar is a placeholder (`src/components/ToolbarsRight/toolbarPlaceholderConfig.ts`).
- A tool is registered but does nothing, or registers a history entry and produces no pixels.
- Any task that will need a per-tool options bar, a new `ToolName`, or a new raster kernel.

Not for: a bug fix inside an existing tool (read the tool's test first), a pure visual pass
(no new tool, so no Phase 1 research), or history/durable-replay migration work (that is its
own programme, and Phase 3 here is explicit about what it will not touch).

## The shape of the task

| Phase | Section                                                                          | Gate before moving on                                                                |
| ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0     | [the worktree](#phase-0--the-worktree)                                           | worktree fast-forwarded to `main`, `npm ci` done, Playwright port isolated           |
| 1     | [research](#phase-1--research)                                                   | digests returned, load-bearing claims re-verified by you, scope cut and written down |
| 2     | [make the tool look like Photoshop](#phase-2--make-the-tool-look-like-photoshop) | every shipped control reaches the renderer; the rest are named in the handoff        |
| 3     | [strip the undoable requirement](#phase-3--strip-the-undoable-requirement)       | a commit kind chosen from the decision table, and its cost accepted out loud         |
| 4     | [implementation](#phase-4--implementation)                                       | tripwire inventory done BEFORE the first edit; `npm run tsc` clean                   |
| 5     | [unit tests](#phase-5--unit-tests)                                               | every new test proven red without its fix                                            |
| 6     | [e2e](#phase-6--e2e)                                                             | spec green headless, mutation-checked, no skip                                       |
| 7     | [delegation](#phase-7--delegation)                                               | never two subagents on one file; the spine stayed with you                           |
| 8     | [gates](#phase-8--gates)                                                         | full gate sweep green, `Test Files` count not decreased                              |
| 9     | [the handoff doc](#phase-9--the-handoff-doc)                                     | every citation re-verified against the tree you are leaving                          |
| 10    | [integration](#phase-10--integration)                                            | one gate per merge, never batched                                                    |

Then: [the tool backlog](#the-tool-backlog--what-to-build-next) and
[the trap list](#appendix-a--the-trap-list).

Phases 0-3 are research and design and produce no code. Phases 4-6 produce code and tests.
Phase 3 sits between design and implementation on purpose: it is the decision that determines
which files Phase 4 is allowed to open, and taking it after the first edit is how a tool
accidentally acquires a history-migration bill.

## The non-negotiables

These are the ones that actually change outcomes. Each is expanded where it is used.

1. **A control ships only if it reaches the renderer.** A slider that changes a readout and
   nothing else is a lie about the product, and it is worse than an absent control. Controls
   that need a missing engine go in the handoff as named work. → [Phase 2](#the-rule-that-governs-the-whole-phase)
2. **You are not removing undo, you are choosing a commit kind whose durable representation
   is already generic.** Then undoability arrives with the tool. → [Phase 3](#the-decision-table)
3. **A test that passes either way is worse than no test**, because it consumes a maintainer's
   trust. Mutation-check every new test. → [Phase 5](#prove-each-test-fails-without-its-fix)
4. **A fix removes its own pin.** A test that asserts current broken behaviour is a tripwire; the
   same change inverts it, and a verified handoff entry is deleted rather than reworded into a
   closed one. → [Phase 9](#the-entry-shape)
5. **Verify every citation before you commit the handoff.** Adding one import shifts every
   line below it. → [Phase 9](#verify-every-citation-before-you-commit-the-handoff)
6. **A hard fix is a requirements problem until proven otherwise.** Compute and time are
   effectively unlimited here, so effort is free and giving up is expensive. Before you conclude
   that a defect is not fixable, or that a feature is out of scope, spend the effort on
   establishing what the feature was **for** — read the older chats, read the plan documents, read
   the pre-existing handoff entries, and research the upstream product's documented behaviour. A
   wrong requirement produces a clean, well-tested, useless implementation, which is worse than a
   red test because nothing about it looks wrong.
7. **Search the chats by meaning, not by id.** The ids in this document are the ones somebody
   happened to write down. To recover a requirement, search the project's session history broadly —
   by the feature noun, by the commit subject, by the file paths the work touched, and by the
   operator's own phrasing — and widen to synonyms when nothing hits. The `chat-history-query` skill
   is the surface for it. **A chat id attached to a worktree is a claim about a moment, not the set
   of sessions that worked on it**, so a requirement recovered only from the recorded ids has been
   recovered from one corner.
8. **When the requirement is unclear, go back to Adobe.** Defaults, ranges, modifier semantics and
   commit points are exactly what Adobe's user guide and API reference publish and what reading code
   cannot recover. `developer.adobe.com` is fetchable and carries exact parameter names. **Do not
   resolve an ambiguity from memory when a source can be asked.**
9. **Escalating is the last resort.** Time and compute are effectively unlimited; the scarce things
   are autonomy and correctness, so a question is a request to take over a decision you had the tools
   to make. Exhaust the searches above first, then write the question into a file with what each one
   did **not** find. The exceptions are real and they are narrower than they look: a **recording
   decision** — a re-recorded baseline, a deliberately waived threshold — is genuinely the
   operator's, because it is a statement about what the number is allowed to mean.

## How to read this document

Read the phase you are in, not the whole thing. Each phase opens by naming the source of
truth it defers to — a `file:line`, a real commit, a recovered brief — so a claim can be
checked rather than believed.

The phase templates are written to be copied into a subagent brief with `<PLACEHOLDERS>`
filled. They are prompts, not prose: the recovered originals are reproduced in the fenced
blocks because the parts that matter (the evidence rules, the locator traps with their
reasons, the report-back contract) are exactly the parts a paraphrase loses.

How this document was assembled, and the four rules the re-verification passes produced, are in
[the provenance appendix](#appendix-c--provenance).

## The three shapes of work

Not every tool is a from-scratch build. Pick the shape first, because it changes Phase 1.

| Shape                                       | What it is                                             | Phase 1 research                                                                                                             | Phases 4-6                                                 |
| ------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **New options bar over an existing commit** | the raster path already works; only the bar is missing | one web brief for the tool's Photoshop controls, one repo brief for the bar contract and the pipeline the control must cross | options-bar component + settings plumbing, no new engine   |
| **New raster tool on `commit: 'raster'`**   | a new `ToolName` with its own kernel                   | both waves, plus the decision table in Phase 3                                                                               | new processor, registry spine, kernel, tests               |
| **A tool whose engine does not exist**      | pen/path, healing, inpaint, live type, 3D, generative  | both waves, and an explicit "is this in scope" note                                                                          | implement the cheap slice honestly and hand off the engine |

The third shape is where a task goes to die. Decide it in Phase 1, write it down, and do not
discover it in Phase 4.

---

## Phase 0 — the worktree

One worktree per task, under `.kilo/worktrees/`, forked from `main`.

### 0.1 Create it

```bash
cd /Users/bkalynovskyi/ph                # a parent dir resolves the wrong package
git status -sb                          # main is a shared surface; expect it dirty
MAIN="$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)"   # absolute, per AGENTS.md
git worktree add -b <branch> "$MAIN/.kilo/worktrees/<name>" main
```

For a **visible session**, do not use `git worktree add`: call `agent_manager` with `mode: "worktree"` and one task carrying `branchName` and `prompt` — `task` creates no visible session.

**Branch name is convention, not policy.** The registered worktrees are what sessions happened to type, not a taxonomy. Use `ps/<tool>-<slug>`, free-checked with `git branch --list 'ps/*'`. **Every registered worktree forks from `main`** — never from an integration line, which is how a leaf inherits a conflict it did not cause. **The directory name is chosen, not derived**: a collision makes `git worktree add` fail, not overwrite.

### 0.2 The stale-worktree trap

Bring an old worktree forward **only after proving the fast-forward is safe**, and never with a hard reset.

```bash
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<name>
git rev-parse --abbrev-ref HEAD           # the branch you are about to move
git merge-base --is-ancestor <base> main  # 0 = branch point still on main: a FF is possible
git log --oneline main..HEAD              # MUST be empty
git status --short                         # MUST be empty, untracked included
git merge --ff-only main
```

`git merge-base --is-ancestor <base> main` answers what the other two cannot: is the recorded branch point still an ancestor of `main`? Non-zero means `main` was rewritten under the branch — stop and report, do not force it. `git log --oneline main..HEAD` is the load-bearing one: any output means the worktree holds commits, so a fast-forward is the wrong operation. `git status --short` must be empty **including untracked**, because an untracked file exists in no commit and no ref. **Never `git reset --hard`, `git checkout -- .`, or `git clean -fd` to "fix" a dirty worktree** — that is data loss with a plausible excuse attached. Report the dirty state.

### 0.3 `.kilo` is gitignored — a new worktree has no plan documents

```bash
git check-ignore -v .kilo   # .gitignore:49:.kilo	.kilo
git ls-files .kilo | wc -l  # 0
```

`.gitignore` ignores `.kilo` and `.serena`, so `git worktree add` checks out **nothing** under `.kilo`: no `plans/`, no skills, no `agent-manager.json`. A fresh worktree has no `ps-research/08-merge-plan.md`, no `RESEARCH-BRIEF.md`, no `04-blend-modes-and-brush-spec.md`. The file that owns the merge gate simply is not there, and this has bitten real sessions. Two workarounds:

```bash
less /Users/bkalynovskyi/ph/.kilo/plans/ps-research/08-merge-plan.md

mkdir -p .kilo/plans/ps-research
cp /Users/bkalynovskyi/ph/.kilo/plans/ps-research/{08-merge-plan,RESEARCH-BRIEF}.md .kilo/plans/ps-research/
```

Never copy the whole tree: `agent-manager.json` is UI/recovery state the extension writes, and a second copy in a worktree is one it will overwrite. A handoff doc is **not** gitignored — `docs/handoffs/` is tracked (existing example: `docs/handoffs/ps-transform-geometry-review-and-merge.md`), so write that one in the worktree, on the branch, in the same commit as the finding. Nothing durable goes under `.kilo/`, so a finding that must survive the session goes in the handoff, not in the plan directory.

### 0.4 `node_modules` is usually missing or empty

The trap is that this _mostly works_: Node walks up to the ancestor checkout, so `tsc` and `vitest` resolve from `/Users/bkalynovskyi/ph/node_modules` and report success. That is what makes it misleading — the tool runs against the parent's dependency tree, so lockfile skew between the two checkouts stays invisible until it is not.

**Vite does not walk up.** It serves only what `server.fs.allow` permits, so fonts, images and AVIF assets that resolve in the root checkout **404 in a worktree**. If an asset will not load, run `npm ci` in the worktree before investigating anything else — it removes the most common false "the code is broken" conclusion. It does not license a dependency change: `package.json` and `package-lock.json` must be unchanged.

### 0.5 The Playwright port

Every worktree's dev server wants `5173`, so a bare `npx playwright test` used to attach to a server **another worktree started** and test that checkout — "my change did nothing" is this, not a cache. **That can no longer happen at all.** Reuse is not off by default here; it is _unreachable_:

```ts
// playwright.config.ts — the `port` binding
const port = process.env.PLAYWRIGHT_PORT ?? '5173';
const baseUrl = `http://localhost:${port}`;

// playwright.config.ts — the `webServer` block
webServer: {
  command: `npm run dev -- --port ${port} --strictPort`,   // `--strictPort`: a clash is a startup failure, not a hop
  url: baseUrl,
  reuseExistingServer: false,                              // literal; nothing can turn it on
}
```

`PLAYWRIGHT_REUSE_EXISTING_SERVER` no longer exists — `scripts/e2e-run.mjs` **refuses** it rather
than ignoring it, so setting it is an error, not a no-op. `PLAYWRIGHT_BASE_URL` is refused too
unless the run says `E2E_ALLOW_REMOTE=1`, which it logs. The wrapper picks a free port, checks it
is still bindable, exports it as `PLAYWRIGHT_PORT`, and records it to `.kilo/e2e-last-run.json`, so
the port that served a run can be named after the fact. Local runs are also sequential —
`workers: 1` outside CI (`playwright.config.ts` — `workers`) — so two runs in one process cannot fight over
one app instance.

```bash
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<name>
PLAYWRIGHT_PORT=5199 npm run test:e2e
```

Pick a port nobody has claimed.

### 0.6 Main is not stable while you work

Other sessions commit into `main` concurrently. Re-read the state immediately before staging, and stage only your own paths.

```bash
cd /Users/bkalynovskyi/ph
git status --short
git diff
git add <explicit/path/one> <explicit/path/two>   # never `git add -A`
git diff --cached --stat                          # read this: it is what you are about to commit
```

`git add -A` in a shared checkout stages another session's in-flight work under your commit message, with no clean undo once pushed. **One investigation to skip:** `.eslintcache` and `.serena/` appear in and disappear from `git status` across sessions because a fast-forward brought a new `.gitignore` line; run `git check-ignore -v` before treating either as another session's work.

### 0.7 Four traps at commit and integration time

`AGENTS.md` does not carry these, so they are stated here. Each has already cost real work in this
repository.

- **A commit made from the main worktree is refused.** `scripts/main-worktree-guard.mjs` runs first
  in `.husky/pre-commit`, ahead of `gate:commit`, and tells you the worktree recipe instead of a bare
  "no". It stops the **commit, not the write** — it runs after the edit — so it converts rogue commits
  into a dirty tree the next `git status` names. A landing never reaches it, because a fast-forward
  fires no **blocking** hook and `git merge` runs `pre-merge-commit`; the one override is
  `ALLOW_MAIN_COMMIT=1`, and only the exact value `1`. Everything that changes a tracked file
  belongs in the branch's own
  worktree, **including a comment**, and `git rev-parse --show-toplevel` before the first edit is the
  only thing that distinguishes where you are from where you believe you are.
- **Never resolve _or repair_ a merge conflict in the main worktree.** `reset --hard` and
  `checkout --ours`/`--theirs` destroy another session's uncommitted work; `hash-object` and
  `update-index` write an index entry no later `git status` reconciles. `git merge --abort` and redo
  it in the worktree. After any interrupted merge, `git rev-parse -q --verify MERGE_HEAD` before
  committing — an interrupted merge can leave `AUTO_MERGE` and `MERGE_MSG` behind with no
  `MERGE_HEAD`, and `git commit` then lands a single-parent commit that reads as a resolution.
- **Never `git stash`.** It is a shared, unordered stack in the common git dir. The silent part is
  the one that matters: `git stash push` on a CLEAN tree exits 0, prints nothing and creates **no
  entry at all**, so the `git stash pop` that follows takes `stash@{0}`, which is whoever pushed
  last. This has destroyed work here.
- **`git add -A` in a worktree whose _root_ checkout is dirty is a silent-revert trap, and it is not
  the same one as above.** The root is a different checkout at a different `HEAD`, so a file your
  branch never touched can sit in your worktree holding main's older content, and `-A` commits it as
  a deliberate reverting of whatever main has since done. One merge shipped **17 such reverts and not
  one of them was a conflict**, so the merge was clean and the revert was invisible in the diff.
  This is enforced, not merely documented: `scripts/merge-takeover-guard.mjs` runs from
  `pre-commit` (a conflicted merge being committed) and `pre-merge-commit` (a clean merge
  that commits itself), and **refuses** the merge. `docs/ORCHESTRATION.md` is the one home for
  the mechanism, both loss shapes, and the limits — a fast-forward fires no **blocking** hook
  (`post-merge` runs, and cannot block), and `--no-verify` bypasses this. The old `comm -13`
  recipe is retired: it fired hundreds of false positives when run before the merge and missed the
  very incident it was written for.

**And a red `tsc` in the main worktree may be somebody else's work in progress**, not a broken `main`
— the main worktree is shared, so it routinely holds an agent's half-written change, and that state
blocks every commit made from there. Read `git status --porcelain` first: a path you have not touched
is not yours to stage and its type error is not yours to resolve. Check whether the _committed_ state
is green instead, in a throwaway worktree, and report the block.

### 0.8 Before you start: is this tool actually missing?

`docs/TOOLS-RESEARCH-BRIEF.md` and the backlog in
[Appendix B](#appendix-b--the-tool-backlog--what-to-build-next) are claims about a moment, and the
moment is old. **Re-derive before you build**: `git merge-base --is-ancestor <sha> main` for every
commit the backlog says is unlanded, `grep -n "'<tool>'" src/tools/toolsMap.ts`, and
`ls src/components/ToolbarsRight/`. The backlog once listed six tools as ABSENT that are in
`toolsMap.ts` with real options bars today, and named a branch that no longer exists. A backlog row
is a starting point, exactly as a chat id is.

---

## Phase 1 — research

Research is two waves, dispatched in the same batch, and they are **two different jobs**:

| Wave         | Question it answers                                                                               | Agent     | Deliverable                                       |
| ------------ | ------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------- |
| **A — WEB**  | What does Photoshop actually do? Defaults, ranges, modifier semantics, commit points, algorithms. | `general` | a **digest**: prose + tables in the final message |
| **B — REPO** | What does _this app_ already have, where, and which existing tests pin broken behaviour?          | `explore` | a **digest**: `file:line` per claim               |

**Never merge the two waves inside a prompt.** A `general` agent that also reads the repo
stops researching and starts anchoring; an `explore` agent that also browses the web returns
unverifiable prose. Each wave has a different evidence standard — Wave A cites `[n]` URLs,
Wave B cites `path:line` — and a single agent cannot hold both without degrading one.

**They fuse at the DOCUMENT layer, not inside a prompt.** The parent owns the fused
artifact: it re-verifies the load-bearing claims from both waves, records which survived
(see _Using the digests_), and writes the plan the implementers read. A digest is an input
to a decision, never the decision.

Run both waves in one `task` batch. Do not serialize them: Wave A has no dependency on
Wave B, and the wall-clock saving is the whole point of fanning out.

### The web-research brief

Fill in every `<PLACEHOLDER>`. Delete nothing — the load-bearing lines are the ones that
stop a subagent from inventing a URL, and they are the reason this brief is a template and
not a checklist.

````text
Research the Photoshop <TOOL FAMILY NAME> and return a dense structured digest. You CANNOT write files — return the digest as your final message text only.

TOOLS COVERED: <explicit list of tool names — one line, no prose>.

RESEARCH PROTOCOL:
- Use `websearch` with `livecrawl: "preferred"`. <Mandatory: `webfetch` on `helpx.adobe.com` returns HTTP 403 on nearly every path, and the websearch live crawler is currently the only reliable route to Adobe's user-guide text. `webfetch` DOES work on `developer.adobe.com` — use it for exact parameter ranges and defaults.>
- Trust: Adobe official > Adobe Community/blogs > Wikipedia/original papers > random blogs. <For algorithms Adobe never publishes (stamp spacing, hardness falloff, path simplification, separable blur, fill rules) cite canonical sources.>
- Verify 2+ independent sources per load-bearing claim. Never invent a URL or fabricate a quote. If something cannot be verified, say so explicitly.
- <The app source is READ-ONLY: "You may read files under /Users/bkalynovskyi/ph/src. Do NOT edit anything and do not run mutating commands." — or, for a web-only wave: "You are doing WEB RESEARCH ONLY. Do not read or edit any project files. Do not run any build/test commands.">

ALREADY-VERIFIED FACTS about this repo (confirmed by direct code reading — trust these, cite file:line):
- `<path:line> — <the fact, with enough of the quoted shape that a reader can check it>`
- `<path:line> — <...>`
<6-12 lines. Every one re-read in the current worktree immediately before dispatch.>

<FRAMING DEVICE — the specific premise the parent suspects is WRONG, or the specific
question whose answer changes the plan. This is the highest-leverage paragraph in the brief
and it is the reason the parent can assert a premise and be corrected. Name it explicitly:
"THIS IS THE MOST LIKELY SOURCE OF HEADLINE FINDINGS. Establish precisely: ..." — or, for a
disputed identity, "CRITICAL RESEARCH QUESTION TO RESOLVE: ... VERIFY THIS RIGOROUSLY with
sources and report it as a headline finding.">

ALSO COVER:
1. <behaviour, with the sub-parts spelled out>
2. <...>

SCOPING POINT TO STATE CLEARLY: <where the app's surface and Photoshop's do not line up —
e.g. Levels and Hue/Saturation are Image > Adjustments commands, not toolbar tools. State the
mismatch precisely rather than researching the wrong feature.>

OUTPUT FORMAT — return exactly this, dense, NO prose padding, HARD CAP <N> words:
```
## Photoshop <TOOL FAMILY>
### 0. <Verdict section, only when the framing device is a yes/no question> — one line + evidence
### 1. Behavior
- bullet per tool, [n] cited
### 2. Options surface
| Option | PS default | Range | Present in ph? | ph default |
### 3. Interaction
- numbered per tool: modifiers, commit point, preview, history grain
### 4. Algorithms
- <the specific math this family needs>
### 5. Edge cases
### 6. Ranked gaps in ph
1. SEVERITY — behavior — `file:line` — fix direction
### 7. Sources
[n] url — what it established
### 8. Unverified
- bullets
```
Prioritize accuracy and density over coverage of trivia.
````

Six things in that template are load-bearing and survive verbatim:

1. **"You CANNOT write files — return the digest as your final message text only."** It is the
   first line. Without it, a `general` agent invents a plausible output path, writes there,
   and the content never reaches the parent — the digest is only in the tool log. This is
   failure mode 2 below, and the sentence is the cheap prophylactic against it.
2. **The `websearch` / `livecrawl: "preferred"` line, with its reason stated inline.** The
   reason is verified, not folklore: `webfetch` on `helpx.adobe.com` returns HTTP 403 on
   essentially every path and the Wayback availability API reports no useful snapshots, so
   the search live-crawler is the only route to Adobe's user-guide text; `webfetch` on
   `developer.adobe.com` **does** work and is where exact parameter names, ranges and
   defaults live. An agent told only "use the web" will burn its budget on `webfetch` 403s.
3. **"Verify 2+ independent sources per load-bearing claim. Never invent a URL or fabricate
   a quote."** Keep the triple: the verification rule, the URL rule, the quote rule. Dropping
   the middle one is how a digest ends up citing a page nobody opened.
4. **The `ALREADY-VERIFIED FACTS` preamble.** This is the mechanism that makes the digest
   _falsifiable_ rather than a free-floating essay. The parent asserts premises it has
   already read in the code; the agent is then able to say "that is wrong" with a citation,
   and the four corrections listed under _Using the digests_ came out of exactly this. A
   digest briefed without it will agree with the parent out of deference, which is worth
   nothing.
5. **The `<FRAMING DEVICE>` slot.** State the parent's suspicion, not just the question.
   "Establish the Blur Tool's status" gets a survey; "the Blur Tool is Illustrator-only —
   verify this rigorously and report it as a headline finding" gets a disproof.
6. **The `OUTPUT FORMAT` tail pair.** `### N. Sources` and `### N. Unverified` are a matched
   pair: a claim that rests on one weak source belongs in `Unverified`, not in the body with
   a hedge. And `HARD CAP <N> words` is what keeps a digest a digest — 1300–1400 words is
   the working range, because a 4000-word digest arrives truncated (failure mode 1) and
   costs a recovery subagent to read back.

The options table columns are fixed: `Option | PS default | Range | Present in ph? | ph default`.
`Present in ph?` is one of `yes` / `partial` / `no` / `declared-but-inert`. That last value is
the one that matters — a control present in `src/tools/settings.ts` but rendered by no
component is the most common false "it exists" claim, and the column forces the agent to
distinguish it. (The agent is told to check **both** `src/tools/settings.ts` and
`src/components/ToolbarsRight/` before claiming a control is missing; a control can exist in
one and not the other.)

#### Filled example — the shape tools digest

Recovered verbatim from session `ses_f2063fb2cffeqn6ZR5KPyQ9Rc6` ("Photoshop shape tools
digest"). This is the canonical example: it has every slot filled, it leads with a framing
device that turns out to be **wrong in the parent's favour**, and it is short enough to read
in one sitting.

````text
Research the Photoshop SHAPE TOOLS and return a dense structured digest. You CANNOT write files — return the digest as your final message text only.

TOOLS COVERED: Rectangle Tool, Ellipse Tool, Line Tool, Triangle Tool, Polygon Tool, Custom Shape Tool.

RESEARCH PROTOCOL:
- Use `websearch` with `livecrawl: "preferred"`. Mandatory: `webfetch` on `helpx.adobe.com` returns HTTP 403 on nearly every path, and the websearch live crawler is the only reliable route to Adobe's user-guide text. `webfetch` DOES work on `developer.adobe.com`.
- Trust: Adobe official > Adobe Community/blogs > Wikipedia/original papers > random blogs.
- Verify 2+ independent sources per load-bearing claim. Never invent a URL or fabricate a quote. If something cannot be verified, say so explicitly.
- You may read files under /Users/bkalynovskyi/ph/src. Do NOT edit anything and do not run mutating commands.

ALREADY-VERIFIED FACTS about this repo (confirmed by direct code reading — trust these, cite the unit):
- `src/tools/shape.ts` — `FigureType = 'line' | 'rectangle' | 'oval' | 'triangle' | 'polygon'`.
- `src/tools/shape.ts` (`ShapeToolArgs`) declares `toolMode?: 'shape'|'path'|'pixels'`, `hasFill?: boolean`, `lineCap?`, `cornerRadius?`, `lineDash?`, `start?: Point`, `end?: Point`.
- `src/tools/settings.ts` (the `shape` default) sets `backgroundColor: null` and there is NO `hasFill` in the defaults, so determine empirically whether fill works at all today.
- `src/tools/shape.ts` (`normalizeShapeGeometry`) implements Shift (aspect snap) and Alt (draw from center). Verify against Photoshop's exact semantics.
- `src/tools/shape.ts` (`drawShape`'s `figure === 'triangle' || figure === 'polygon'` branch) hardcodes `const sides = figure === 'triangle' ? 3 : 5` and inscribes a REGULAR n-gon in the drag box.
- `src/tools/shape.ts` (`drawShape`) applies `cornerRadius` only to `rectangle`, never to `oval` (this is correct Photoshop behavior — verify).
- `src/tools/shape.ts` (`legacyFigureMap`) maps legacy `circle`->`oval` and `square`->`rectangle`, encoding that Circle and Square are Shift-constrained outcomes, not separate tools.
- `src/tools/toolProcessors.ts` (the `rectangle` / `ellipse` / `triangle` / `polygon` / `line`
  entries) — all five figure tools carry `creator: true` and `commit: 'source'`. This was a
  REAL defect once — `rectangle`, `ellipse` and `line` lacked the flag, which
  `sourceBitmap()` in `materialization.ts` throws on — but the throw was latent (neither
  `materializeLayer` nor `materializeDocument` has a production importer). It is now fixed
  AND pinned: the `it('flags every tool routed to the shape processor as a deterministic creator')`
  case in `src/tools/__tests__/tool-processors.test.ts` derives the family from
  the processor identity rather than a hand-written name list, so a new shape variant
  cannot be registered without it. Do not report it as an open inconsistency.
- `src/tools/toolProcessors.ts` (the `'custom-shape'` entry) is `commit: 'unimplemented'` with `imageProcessor: unimplemented` (returns `[null]`); its `ToolArgsByName` entry in `src/contexts/tool-types.ts` (`'custom-shape'`) is just `{ toolName: 'custom-shape' }`; the `'custom-shape'` entry in `src/tools/toolsMap.ts` renders a `PlaceholderTool` with a TODO badge. It IS in `toolbar-mapping.ts` and `availableTools`, so it is user-selectable and does nothing.

THIS IS THE MOST LIKELY SOURCE OF HEADLINE FINDINGS. Establish precisely:
- **Triangle Tool**: Photoshop draws a drag-defined isosceles RIGHT triangle, NOT a regular polygon inscribed in the drag box. Determine the exact geometry and, critically, what Shift actually does for the Triangle Tool specifically (many sources get this wrong), and Alt.
- **Polygon Tool**: it is a CLICK-TO-PLACE-VERTICES tool (click each vertex, double-click or Enter to close) producing an ARBITRARY vertex list — not a drag-defined regular n-gon. Research the Mode options (None, Indents/Round, Indents/Round + Sided), how the Indents value controls star/round indent depth, and Fill Entire / Indents only / Indents from center.
- **Line Tool**: 15-degree angle snapping with Shift (verify), and the Arrowhead start/end options the app lacks entirely.
- **Custom Shape Tool**: the shape picker flyout, the built-in shape set, Star with Points and Indents, the Define/Save Custom Shape round trip and the `.csh` Cumulus format, Path Operations (Combine/Subtract/Intersect/Exclude/Minus Back), and that a custom shape needs a general bezier subpath representation with holes.

ALSO COVER: the three Drawing Modes (Shape / Path / Pixels) and what each commits; Fill vs Stroke; the W/H fields and link chain; the Radius field; the Align flyout; that a Shape-mode stroke draws at full opacity and does NOT accumulate like a brush; and that the resulting layer is trimmed to the shape bounds.

OUTPUT FORMAT — return exactly this, dense, NO prose padding, HARD CAP 1300 words:
```
## Photoshop shape tools
### 1. Behavior
- bullet per tool, [n] cited
### 2. Options surface
| Option | PS default | Range | Present in ph? | ph default |
### 3. Interaction
- numbered per tool: modifiers, commit point, preview, history grain
### 4. Algorithms
- drag-defined isosceles right triangle geometry; arbitrary-vertex polygon + indent/star generation; 15-degree angle snap; multi-subpath bezier path model with holes and a fill rule; Path2D vs scanline rasterization
### 5. Edge cases
### 6. Ranked gaps in ph
1. SEVERITY — behavior — `file:line` — fix direction
### 7. Sources
[n] url — what it established
### 8. Unverified
- bullets
```
Prioritize accuracy and density over coverage of trivia.
````

Three of the four headline questions in that framing device were answered **against** the
parent's premise. That is the brief working, not failing: the parent asserted
"Polygon is click-to-place" and "Line snaps to 15°" from memory, and both turned out to be
wrong. **Do not soften a framing device because you are confident** — the whole point is to
hand the agent your belief so it has something to attack.

The `## 0.` verdict section (visible in the paint-tools and adjustments variants, not in this
one) is the right shape when the framing device is a single yes/no: _"the Blur Tool is
Illustrator-only — verify."_ Then the digest leads with a one-line verdict and the evidence
underneath, and the rest of the report is unaffected.

### The repo-research brief

Wave B. `explore` agents are read-only by construction, which is an advantage for recon and
a liability for authorship — the whole failure mode 2 section is about that liability.

The structure that worked, from the brush/pencil options-bar build (session
`ses_f192fb3faffebyCjBZKwL0xIg4`):

```text
You are reconning a React/TypeScript photo-editor repo at `<ABSOLUTE WORKTREE PATH>`. READ ONLY — do NOT edit, create, or delete any file. <Do not run `npm run build`.> <For a test-convention agent: Do not run any Playwright command (no `--headed`, no `--ui`, no `--debug`, no `show-report`).>

Thoroughness: **very thorough**.

Your ONE concern: **<ONE sentence, naming one subsystem>** — <what it covers and, if not
obvious, why the implementer cannot proceed without it>.

Investigate and report on, with `file:line` evidence for EVERY claim:

1. `<file>` — <read it fully / grep it>. Report <the specific facts wanted>.
...
N. <the question whose answer decides CHEAP vs EXPENSIVE>

CRITICAL OUTPUT FORMAT — your final message must be:
- A section per numbered item above.
- `file:line` for every claim, plus short quoted snippets of the load-bearing code.
- <The closing register for this concern. Pick the one that applies — they are not
  interchangeable:>
  * plug-in list:  a final "WHAT A NEW TOOLBAR MUST PLUG INTO" list: the exact files+symbols
    a new <TOOL> options bar must register with.
  * gap list:      a final "MISSING PRIMITIVES" list: any input component that does not exist
    yet and would have to be written.
  * pipeline list: a final "PIPELINE GAPS" list: what a new options control would need to
    reach in order to change rendering.
  * change list:   a final "IF I ADD A <SETTING> FIELD, WHAT ELSE MUST CHANGE" list with `file:line`.

Be precise and exhaustive. Facts with file:line only — no speculation presented as fact.
```

Four rules, all load-bearing:

- **One concern per agent.** "Your ONE concern" is a hard scope fence. The four agents in the
  brush/pencil wave were: the options-bar renderer, the paint/brush engine, the Pencil tool's
  implementation and history path, and the test conventions. Split by concern, not by
  convenience, and never run two agents on the same file. An agent given two concerns
  interleaves them and both come back shallower.
- **`file:line` for EVERY claim**, plus quoted snippets for the load-bearing ones. A citation
  without a quote is unfalsifiable; a quote without a citation cannot be checked. Ask for both
  and accept neither alone.
- **"Facts with file:line only — no speculation presented as fact."** The last line of the
  brief, verbatim, on every Wave B prompt. Without it a recon agent states what a component
  _probably_ does, the parent cannot tell a fact from an inference, and the inference becomes
  a plan step.
- **The closing register.** Every Wave B agent ends with a named list whose purpose is to make
  the digest directly actionable. `WHAT A NEW TOOLBAR MUST PLUG INTO` answers "where do I
  register?"; `MISSING PRIMITIVES` answers "what do I have to write first?" — a question the
  parent cannot answer from the component tree alone, because a missing slider primitive is
  invisible until something asks for it.

Two prompt variants did the heavy lifting.

**Variant A — the exhaustive literal-string sweep.** For "which of Photoshop's controls does
this app have _any_ support for", one numbered item that reads:

```text
N. Search the whole `src/` tree for the literal strings: `hardness`, `flow`, `spacing`, `jitter`, `scatter`, `wetEdges`, `pressure`, `opacity`, `airbrush`, `autoErase`, `smoothing`. For each hit report `file:line` + the line. This tells me exactly which of the Photoshop controls already have any support at all. **Be complete — use grep, not a sample.**
```

The anti-sampling clause is the load-bearing part. Without it, a recon agent greps, finds a
few dozen hits, decides that is "representative", and reports a partial sweep as a complete
one — and a partial sweep reads exactly like a complete one that found little. `use grep,
not a sample` converts a plausible-looking answer into a checkable one. The parent then
re-runs the same grep and gets the same list.

**Variant B — the test-convention recon.** Any agent whose output will become a new test file
must read the conventions, and three of its items are non-negotiable:

```text
12. `e2e/README.md` — report the documented rules for writing a new spec: required helpers,
    forbidden patterns, naming, and any list of things a new spec must do. **Quote the rules
    verbatim** (this is the authoritative convention doc).
13. `e2e/OPEN_PROBLEMS.md` — list every entry headline + one-line problem statement. I must
    not re-introduce a known defect, and I must read this before investigating any e2e failure.
14. Report whether there is any existing e2e spec that tests a **tool options bar** (as
    opposed to the sidebar tool picker). If yes, quote its relevant section. If no, say so
    explicitly.
```

- **`e2e/README.md` quoted verbatim** (415 lines; the headless rule is under
  "Run it headless": _"`npm run test:e2e` is **headless by default. Keep it that way.**"_).
  A summary of the rules is not the rules. The verbatim quote is what stops the new spec from
  reintroducing `--headed`, a wrong `testDir`, or an unquarantined flake.
- **`e2e/OPEN_PROBLEMS.md` entries enumerated**, section by section: `## Observed failures`,
  `## Known-skip tests`, `## Verified and still unverified`. A new spec that trips a latent known
  defect is a new defect, not a
  flaky test — and the operator reads the entry list before investigating any e2e failure.
- **Item 14 is the existence check.** "Is there already a spec for this surface?" must be
  answered explicitly, including "no". A recon agent that finds nothing tends to stay silent,
  and silence reads as "not applicable" rather than "not present".

The closing register for this variant is a pair of assembled templates:

```text
- A final "TEMPLATE FOR A NEW OPTIONS-BAR UNIT TEST" and "TEMPLATE FOR A NEW OPTIONS-BAR E2E SPEC" section, assembled from what you actually read, with file:line citations.
```

That is the highest-leverage single item in the whole Wave B brief: it converts the recon
into a scaffold, and the implementer writes against it instead of reverse-engineering the
conventions from four existing files.

One more item worth copying verbatim whenever an agent's findings will touch history or
replay:

```text
IMPORTANT: if I add new <TOOL> settings, I need to know whether replay would break — report
whether the durable conversion reconstructs a stroke from stored settings or from stored
pixels, with quoted evidence.
```

**"settings or pixels" is the question that decides whether a new options control is
CHEAP or EXPENSIVE.** A tool whose durable form is generic over its args is nearly free to
extend; a tool that rasterizes at commit is not. Per the architecture status in `AGENTS.md`,
the legacy `HistoryItem[]` path is still the production replay authority, so an agent
answering this must read the legacy path _and_ the durable shadow and say which one it found.

#### Filled example — the paint/brush engine recon

Recovered verbatim from session `ses_f192fb3faffebyCjBZKwL0xIg4`, agent 4 of 4. This is the
one that produced the `PIPELINE GAPS` list, and note how the numbered items escalate from
"read this file" to "answer the question that decides the effort":

```text
You are reconning a React/TypeScript photo-editor repo at `/Users/bkalynovskyi/ph/.kilo/worktrees/brush-toolbar`. READ ONLY — do NOT edit, create, or delete any file. Do not run `npm run build`.

Thoroughness: **very thorough**.

Your ONE concern: **the paint/brush engine** — what brush parameters exist today, where they live, and how the pointer-event pipeline uses them.

Investigate and report on, with `file:line` evidence for EVERY claim:

1. `src/tools/draw.ts` — read it fully. Report: every brush parameter it accepts (size, hardness, opacity, flow, color, spacing, smoothing, jitter, scattering, pressure, tilt, wet edges...), their defaults, the function signatures, and how a stroke is rasterized (interpolation? stamping? `arc()`? `lineWidth?`).
2. `src/tools/colors.ts` and `src/tools/settings.ts` — read fully. Report the tool-settings shape and how per-tool settings are typed/stored.
3. `src/tools/toolProcessors.ts` — read fully. Report how a tool turns a pointer event into a tool call; what the dispatch looks like for `brush` / `pencil` / `color-replacement` / `draw` / `blur`.
4. `src/components/Main/DrawToolArea.tsx` — read fully. This is the canvas event surface. Report: which pointer events are bound (pointerdown/move/up?), how `pressure`, `tiltX`, `tiltY`, `pointerType`, `buttons` are read from the PointerEvent (or not), how the stroke is batched/throttled, how it calls into the tool, and how the stroke is committed to history.
5. Where do brush settings live in the store? Search `src/contexts/StoreContext.tsx` and the settings context. Report the exact shape: which fields, their types, their defaults, the action/reducer names that update them, with `file:line`.
6. `src/util/settings.ts` — read fully. Report the settings persistence shape (localStorage? per-tool?).
7. The pointer pipeline: read `src/hooks/usePointerPosition.ts` and `src/hooks/useRect.ts`. Report what pointer data is threaded through and whether `pressure` survives.
8. Search the whole `src/` tree for the literal strings: `hardness`, `flow`, `spacing`, `jitter`, `scatter`, `wetEdges`, `pressure`, `opacity`, `airbrush`, `autoErase`, `smoothing`. For each hit report `file:line` + the line. This tells me exactly which of the Photoshop controls already have any support at all. Be complete — use grep, not a sample.
9. `src/components/ToolbarsRight/Draw/Draw.tsx` — read fully. It is the EXISTING options bar for the `draw` tool. Report every control it renders, its `data-testid`s, how it reads/writes the store, and its full props. This is my closest template.
10. `src/tools/__tests__/paint-tools.test.ts` — report what it already covers for brush/pencil.

CRITICAL OUTPUT FORMAT — your final message must be:
- A section per numbered item above.
- `file:line` + short quoted snippets for every claim.
- A table at the end: `Photoshop brush control | already exists? (yes/no/partial) | where (file:line) | what is missing`.
- A final "PIPELINE GAPS" list: what a new options control would need to reach in order to change rendering.

Be precise and exhaustive. Facts with file:line only — no speculation presented as fact.
```

Note what is _not_ in it: no instruction to read `AGENTS.md`, and no mention of the ten
architecture constraints. Recon agents do not need them — a recon agent is not designing.
Constraints belong in the implementation brief, where they bind a decision.

### Using the digests

**A digest is a set of falsifiable claims, not a set of findings.** Nobody has verified any
of it, including the parts that are right. Wave A's claims are only as good as its sources,
which you have not read; Wave B's `file:line` citations are only as good as the line numbers,
which were correct when the agent read the file and may not be now.

So the parent's job on return is a **decision register**. Re-verify the load-bearing claims
yourself, then classify each one:

| Verdict       | Meaning                                                                                                                                             | Action                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CONFIRMED** | You re-read the cited source (the URL, or the `file:line`) and it says what the digest says.                                                        | Use it. Cite it in the plan as verified, with the retrieval noted.                                                                                                      |
| **CORRECTED** | The source says something different.                                                                                                                | Use the source, not the digest. Record both — the correction is usually the most valuable thing in the register, because it means the premise behind it is suspect too. |
| **DISCARDED** | Unverifiable: the URL is dead or unreachable, the `file:line` points somewhere else entirely, or the claim is a reconstruction presented as a spec. | Drop it. If the plan needs the fact, it is an open question, not a row in a table.                                                                                      |

Rules that keep the register honest:

- **Re-verify, do not re-derive.** Open the cited `file:line` and read it. Do not re-run the
  investigation — that is the second full research wave you were trying to avoid.
- **Verify the load-bearing claims, not all of them.** A claim that changes the plan's scope
  or sequencing is load-bearing. A claim that fills in a default value is not, unless the
  default is the reason a control is or is not worth shipping. Sampling the load-bearing ones
  is correct; sampling all of them is the research phase again.
- **A `CORRECTED` claim invalidates its neighbours.** If the agent got the Line Tool's snap
  angle wrong, assume the rest of that agent's Line Tool claims are unverified until checked.
  Errors cluster: they come from one source the agent over-trusted.
- **Never let a digest write a plan step directly.** Digests propose; the parent decides. A
  gap row becomes a plan step only after it has survived the register.

#### Four corrections this repo's research actually produced

From the prior campaign, recorded in `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/01-photoshop-reference.md`
§10 (line 888). **These are findings from a prior campaign, not fresh claims. Re-verify them
before acting** — the prior campaign's own method note is that Adobe user-guide text was
reached only through the search live-crawler, never by a direct `helpx.adobe.com` fetch, and
one of the four was later itself narrowed:

1. **The Blur Tool does exist in Photoshop.** The briefing premise was "the Blur Tool is an
   Illustrator tool, not a Photoshop tool". It is a Photoshop Tools-panel paint tool
   (~2023+); Illustrator has only `Effect ▸ Blur`. The app's `blur` tool is therefore not a
   misnamed Illustrator import.
2. **The Polygon Tool IS drag-defined**, inscribing a regular n-gon. The premise that it is
   click-to-place-vertices was wrong — that is the Pen tool. _Partial correction: the same
   campaign found no source in any Photoshop release for the Mode labels
   "None / Indents-Round / Indents-Round + Sided" and flagged them as likely another
   product. Treat the geometry as settled and the Mode labels as unsettled._
3. **The Triangle Tool is drag-defined isosceles**, and **Shift means equilateral** — not
   aspect-snap. The app's `src/tools/shape.ts` (`drawShape`)-era code inscribed a regular triangle
   in the drag box, so this is a live divergence, not a documentation nicety.
4. **The Line Tool snaps to 45°, not 15°.** The 15° figure is the _Free Transform rotate_
   snap, conflated from a different feature.

A fifth correction is repo-side and has since been fixed, so it is listed here only because
it is the shape of the mistake worth avoiding: the premise "`triangle` lacks `creator: true`
while `shape`, `polygon` and `line` have it" was **inverted** — it was `rectangle`, `ellipse`
and `line` that lacked it. That was a real defect (`materialization.ts` threw for three of the
five most-used shape tools) and it is now **fixed and pinned**: all five figure tools carry
`creator: true` in their `src/tools/toolProcessors.ts` registry entries, and the
`it('flags every tool routed to the shape processor as a deterministic creator')` case in
`src/tools/__tests__/tool-processors.test.ts` derives the family from the processor
identity rather than a hand-written name list, so a new shape variant cannot be registered
without the flag. The app was fixed; the _citation_ in the research corpus is now stale.

#### Resolved decisions — how scope gets cut

Research produces more fidelity than any single tool can absorb. The cut is recorded, not
improvised, in a **resolved-decisions register**. One line per decision, fixed shape:

```markdown
D<N> — <the question> — Decided: <the answer> — Consequence: <what shrinks, drops, or is deferred>
```

Keep it in the plan document, not in a chat reply: it is the only record of what was
deliberately left out, and the next session reads it instead of re-asking. The prior
campaign's register, from "Resolved decisions (2026-09-26)" in
`/Users/bkalynovskyi/ph/.kilo/plans/ps-research/README.md`:

| #      | Question                        | Decision                                        | Effect                                                                                                                                                                                                                                    |
| ------ | ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | What is the `color` tool?       | **Black & White + Tint**                        | 6 sextant sliders (defaults 40/60/40/60/20/80) + a Tint colour swatch. The `saturation` slider is **dropped**. Not Selective Color — that has the 9-range CMYK model.                                                                     |
| **D2** | What is the `levels` tool?      | **Implement real Levels**                       | Keeps the name and the toolbar slot. Needs channel selector, histogram, input black/gamma/white, output levels, Auto. The current two-field tool is _superseded_, not renamed. A future Brightness/Contrast would be a **separate** tool. |
| **D3** | Destructive or non-destructive? | **Destructive**, matching `Image > Adjustments` | Adjustment Layers are **out of scope**. The phase shrinks. Side benefit: with engine-independent math, replay becomes honestly param-only and `requiresRaster` returns to `false`.                                                        |

Note what each decision _bought_ as well as what it cost. D3's side benefit — the honest
`requiresRaster` classification — is why it is a decision and not a preference.

**The rule that makes the register necessary:** a control whose engine does not exist is
**named work, not a dead slider**. If the plan's research says Photoshop's Brush has Flow,
and Flow means per-dab alpha accumulation over a stroke buffer that the app does not have
(the `brush` entry in `src/tools/toolProcessors.ts` commits `commit: 'raster'` and rasterizes the stroke
on commit), then shipping a Flow slider is a lie the user can see. Write it into the plan as
"Flow: needs a per-stroke accumulation buffer — Phase 4, blocked on X", and leave the control
out of this iteration entirely. A `declared-but-inert` control in the options surface is a
defect, not a placeholder: it is registered, visible, and does nothing.

The inverse rule holds too: a control the research says Photoshop has, that the app already
has working, needs no decision — but a control the app has that **Photoshop does not** does.
`src/components/ToolbarsRight/toolbarPlaceholderConfig.ts` (20 lines) is the standing list of
Photoshop options the app has not implemented, per placeholder tool, and it is a ready-made
todo list. Re-read it every research wave and note which entries are still live.

### Two research failure modes and their recovery

Both of these cost a full session. Both have a written recovery.

#### Failure mode 1 — a result too large comes back TRUNCATED

A tool result that exceeds the harness limit is not returned; it is **spilled to disk** and
the visible output is cut with a pointer to the file:

```
~/.local/share/kilo/tool-output/tool_<id>
```

The parent sees a report that stops mid-section, and the missing text is the tail of exactly
the section that mattered most — the ranked gaps, the quoted templates, the sources.

**Recovery, in order:**

1. **Do not re-run the agent.** It will produce a differently-worded report, not the
   truncated one, and you will have paid twice.
2. **Grep the heading in the spill file** to find its offset, rather than reading the file
   from the start — the file is large and the part you need is at the end.
3. **Read from that offset** in the parent, if the tail is short enough to fit.
4. **If the tail is still too large, dispatch a subagent whose only job is to re-emit it
   verbatim.** The brief that worked, recovered from
   `ses_f192fb3faffebyCjBZKwL0xIg4`:

```text
Two large tool-output files hold reports I need the tail of. READ ONLY — do not edit, create or delete any file, and do not run any build/test command.

File A: `/Users/bkalynovskyi/.local/share/kilo/tool-output/tool_<ID_A>`
This is a <describe what the report is>. The part I still need starts at a heading roughly like `# <HEADING>` (item 1 was "<the first item, so the agent can check it is the right report>"). Use Read with an offset near the end of the file, or Grep for `<HEADING>` and then read from there.

File B: `/Users/bkalynovskyi/.local/share/kilo/tool-output/tool_<ID_B>` (note: read the exact filename from disk, the one above is approximate — glob for `/Users/bkalynovskyi/.local/share/kilo/tool-output/tool_<PREFIX>*` if it does not open)
This is a <describe what the report is>. I already have sections 1-12. The part I still need:
- <enumerate exactly which sections and sub-items, so the agent returns a bounded amount>
- <enumerate the next sections the same way>

Read from where item 12's `<quote that marks the boundary>` begins to the end of the file.

OUTPUT FORMAT: reproduce the recovered content as-is and near-verbatim, preserving `file:line` citations, code blocks and section headings. Do not summarise the templates — quote them in full. If a section is genuinely absent from the file, say "ABSENT" for it explicitly rather than inventing content.
```

Four clauses in that brief are the whole recovery:

- **The anti-fabrication clause**: _"If a section is genuinely absent from the file, say
  'ABSENT' for it explicitly rather than inventing content."_ A re-emit agent that cannot
  find a section and is not told what to do instead **will** produce plausible filler, and the
  filler is indistinguishable from the real text. The same clause with a different label
  appeared in the second recovery brief: _"If a section I asked for is genuinely absent,
  write 'ABSENT: <section name>' for it explicitly."_ Use both forms; the important part is
  that an explicit absence marker is offered.
- **The approximate-path escape hatch**: _"note: read the exact filename from disk, the one
  above is approximate — glob for `.../tool_<PREFIX>*` if it does not open"_. Hand-transcribed
  tool ids are wrong often enough that a hard path makes the agent fail on a technicality.
  Hand it the prefix and let it glob.
- **The first-item checksum**: naming what item 1 of the report was lets the agent confirm it
  opened the right file before it starts quoting.
- **The boundary marker**: _"Read from where item 12's `<quote>` begins to the end of the
  file."_ A heading name is not enough when the same heading repeats; a distinctive quote
  from inside the target region is.

**Prevention is cheaper than recovery**, and it is one word in the Wave A brief: `HARD CAP
<N> words`. 1300–1400 is the working range and it is chosen so the digest fits. A larger cap
produces a spill, a recovery subagent, and a second turn spent re-reading what one number
prevented.

#### Failure mode 2 — digests that never became deliverables

`explore` subagents **cannot write files**. A `general` agent can, but the reliable shape of
a research wave is `explore`, and `explore` is read-only. So a 19-agent research wave
produces nineteen excellent digests that live only in tool logs, and when the parent
context moves on they are gone. Nothing was wrong with the briefs; the failure was
structural — nobody was assigned the job of turning the digests into documents.

**The fix that worked: the parent authors the digests into the document set itself.** Not a
subagent — the parent, because the parent is the only party holding both waves and the
decision register. That is also why "the digests never became deliverables" is a process
bug and not a prompting bug: no brief fix makes a read-only agent's output durable.

**The doc-set shape that resulted**, in `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/`:

| File                                   | Lines | What it is FOR                                                                                                             |
| -------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| `RESEARCH-BRIEF.md`                    | 189   | The contract every research brief runs against. Read this first, before anything else.                                     |
| `README.md`                            | 114   | The entry point. Orientation, the decisions register, what to land first, what to be sceptical of.                         |
| `00-tool-inventory.md`                 | 196   | The roster: every registered tool vs Photoshop, with honest status. Orientation only.                                      |
| `01-photoshop-reference.md`            | 955   | Cross-family behaviour spec, every claim cited. The behaviour authority; §10 holds the disproved premises.                 |
| `02-implementation-plan.md`            | 1091  | Phased and sequenced, with `file:line` anchors and constraint compliance. Deciding what to build next.                     |
| `03-ui-chrome-spec.md`                 | 347   | Theme tokens, control vocabulary, options-bar contents per tool, cursors. Any visual work.                                 |
| `04-blend-modes-and-brush-spec.md`     | 390   | Blend-mode formulas, the compositing equation, Opacity/Flow math, brush tip rendering. Brush work.                         |
| `05-selection-mask-migration.md`       | 432   | Call-site inventory, exact types, marching-squares spec, migration order, per-test verdicts. Anything touching selections. |
| `06-adjustments-and-color-pipeline.md` | 433   | sRGB/XYZ/Lab with exact matrices, real Levels, Black & White + Tint, blur, LUT strategy. Adjustment work.                  |
| `07-test-harness-and-migration.md`     | 200   | Canvas-mock capability report, which tests assert bugs, the rewrite order. Before writing any code.                        |
| `08-merge-plan.md`                     | 136   | Ownership map, merge order, the merge gate. Only while parallel worktrees are live.                                        |

The numbering is the index: `00` is orientation, `01` is the behaviour authority, `02` is
the plan, and `03`–`08` are the deep-dive sub-specs. A reader who needs one thing should be
able to reach it from the number alone.

**`README.md` carries a "read it when" column**, and that column is the doc set's real
interface — it is what lets a later session find the right file without reading all of them:

```markdown
| File                                                                       | What it is                                                                                                 | Read it when                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **[00-tool-inventory.md](./00-tool-inventory.md)**                         | Every registered tool vs. Photoshop, with honest status and the five highest-impact findings               | First, for orientation             |
| **[01-photoshop-reference.md](./01-photoshop-reference.md)**               | Behavior spec across 7 tool families, every claim cited; §10 lists disproved premises and unverified items | Implementing or reviewing any tool |
| **[02-implementation-plan.md](./02-implementation-plan.md)**               | 10 phases, sequenced, with `file:line` anchors and constraint compliance                                   | Deciding what to build next        |
| **[07-test-harness-and-migration.md](./07-test-harness-and-migration.md)** | Canvas mock capability report, which tests assert bugs, the rewrite order                                  | Before writing any code            |
```

Two more habits from that `README.md` that make a doc set worth maintaining:

- **A "Two things to be sceptical about" section.** One entry is that the corpus was written
  against an older revision and every `file:line` must be re-verified against the live tree;
  the other is that the research **disproved nine of its own briefing premises**. A reader who
  knows the corpus contains its own refutations reads it very differently from one who does
  not.
- **A named unverified surface.** `01-photoshop-reference.md` §10 and `03-ui-chrome-spec.md`
  §10 each close with an explicit "do not present as fact" list. Adobe publishes no algorithm
  and no Photoshop hex palette; where a formula is reconstructed rather than documented, the
  spec says so in that section. **Do not promote a reconstruction to a spec** — that is the
  single rule that keeps a research corpus from decaying into folklore.

**`.kilo` is gitignored, so the doc set never reaches a worktree.** The rule is `.gitignore:49`
(`.kilo`, alongside `.serena`), and `git check-ignore -v .kilo/plans/ps-research/README.md`
confirms it. Two consequences, both of which will bite:

- A fresh worktree has **no** `RESEARCH-BRIEF.md` and no corpus. An agent briefed with a
  relative path to it is reading a file that does not exist, and will either say so or
  substitute its own assumptions.
- **Implementation briefs must use ABSOLUTE paths into the main checkout** —
  `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/01-photoshop-reference.md` — or copy the
  documents into the worktree first. Verify the file exists from the worktree before
  dispatching; a brief that points at a missing file burns a whole agent turn on the
  failure.

This is also why the doc set cannot be a handoff deliverable in the ordinary sense. Handoff
docs ship with the code (`docs/handoffs/`); the research corpus does not. If the research is
worth keeping past this machine, it has to be rewritten into something tracked.

### The architecture constraints every brief must restate

These are the ten constraints from "Architecture constraints your recommendations MUST respect"
in `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/RESEARCH-BRIEF.md`
— the hard-won decisions the whole research campaign rested on. **Restate all ten, verbatim
in intent, in the implementation brief.** A brief that drops one invites a design that
violates it, and the violation is discovered at review, after the work is written.

1. **Single-writer reducer publication.** Runtime layer state is mutated only by dispatching
   a typed action through the store reducer. Never propose mutating runtime layer objects
   from a tool, a callback, or an async continuation. A tool that needs to publish derived
   presentation state (a blur preview, say) needs either document-scoped presentation
   ownership or a new typed presentation action.
2. **Durable replay.** Every tool must have a declared `replay` contract in
   `src/tools/toolProcessors.ts`. A tool whose pixel output cannot be reproduced
   deterministically must be marked `deterministic: false` / `requiresRaster: true`, and its
   replay routed through a raster snapshot rather than re-executing the operation. A new
   tool's `commit` and `replay` entries must be specified explicitly, not implied.
3. **Unsupported operations must reject the durable branch.** Do not manufacture durable
   no-op operations that falsely appear replayable. Reject is a valid, preferred outcome.
4. **Layer ownership and asset disposal.** Any new tool that creates, adopts, or borrows an
   `ImageBitmap` must integrate with `src/contexts/asset-registry.ts` — stable cache keys,
   explicit adoption vs. borrowing, generation tracking, deterministic disposal, and leases
   released on replacement / document replacement / provider teardown. A tool must never
   close a bitmap it borrowed from another owner. (The ownership discriminator is already in
   the code: `AssetOwnership = 'adopt' | 'borrow'` in `src/contexts/asset-registry.ts`.)
5. **Affine transform is retained, not rasterized.** `src/contexts/affine-transform.ts`
   preserves transform as math on both raster and vector sources, and affine renders apply
   the transform BEFORE filters. Do not propose rasterizing a transform that should be
   retained.
6. **Materialization is document-scoped** in `StoreContext`, not owned by individual hooks.
   A new tool must not introduce a second materialization owner.
7. **Stage before publishing.** Runtime rendering must succeed before the visible canvas is
   replaced, so a replay or materialization failure leaves the currently visible document
   intact.
8. **One history state per user action, not per pointer event.** Photoshop commits a stroke
   on mouse-up and a selection when the marquee is closed. Propose history behaviour at that
   grain. (A per-`pointermove` history entry is a defect, not an implementation detail.)
9. **`OffscreenCanvas` + Canvas 2D only.** No WebGL, no WebGPU, no new runtime dependencies
   without an explicit decision. Assume `ctx.filter`, `Path2D`, `createImageBitmap` and
   `OffscreenCanvas` are the only elevated APIs available, and note browser-support risk for
   each.
10. **TypeScript strict**, React 19, no `any` in new code, `satisfies` used to validate
    registries.

Constraint 9 interacts with the rest of the research in a way that is easy to miss: a
`ctx.filter`-based tool is simultaneously a **constraint-2 durability problem** (a
per-pixel filter whose replay must reproduce pixel output is honestly `requiresRaster: true`,
or it is dishonest) and a **constraint-9 portability risk** (`ctx.filter` is a silent no-op on
Safari's `OffscreenCanvas` 2D context — the tool appears inert and still records a history
entry). Both are live in this repo: `src/tools/toolProcessors.ts` declares
`const unimplemented = () => () => [null as never] as ToolResult;`, the shape of a no-op that
consumes a history entry, and a tool that renders nothing while writing history is the exact
failure mode constraints 3 and 8 exist to prevent.

## Phase 2 — make the tool look like Photoshop

This is the phase a reader is most likely to copy line for line, so every template
below is written against the working tree and re-verified against it.
**Every claim in this phase is a mainline fact, cited as a mainline unit.** An earlier
edition cited an unmerged `brush-toolbar` branch as `brush-toolbar:<path>` and marked it "a
reference implementation"; that branch is in no ref of this repository
(`git rev-parse --verify brush-toolbar` fails) and the material it pointed at has since landed
on `main`, so the convention is retired. **If you meet a `brush-toolbar:` citation, it predates the
merge — go and read the named unit on `main`, which is where the code is.**
`src/components/ToolbarsRight/**` does not render on the right — the
directory name is legacy; those components are the **Photoshop options bar body**,
mounted at the top of the workspace by `ToolbarHorizontal`.

### The rule that governs the whole phase

**A control ships only if it reaches the renderer.**

A slider that changes a readout and nothing else is worse than an absent one, because
it is a lie about the product: the user moves it, the number changes, the canvas does
not, and the only way to learn that is to draw. A control that needs an engine this
build does not have is written up in `HANDOFF.md` as named work with the call counts it
would break, and is absent from the bar.

The shipped paint bars prove the rule in both directions. The brush and pencil bars publish
exactly four settings — Size → `ctx.lineWidth` (`src/tools/draw.ts` — `setupDrawCtx()`), Opacity
→ `ctx.globalAlpha` (the same), Smoothing → `smoothStrokePoints()` in `src/tools/brush.ts`, a
filter over the sampled path, and Mode → a per-layer blend mode resolved when the layer is created
— and each one terminates in pixels. Everything else Photoshop puts on that bar (Hardness, Spacing,
Flow, Airbrush, Scatter, Jitter, Wet Edges, Texture, Angle/Roundness, Symmetry, and the Pencil's
Auto Erase) is still absent. Nothing about that choice is negotiable in review: a reviewer who
finds a fifth slider with no renderer behind it is right, and the fix is to delete the slider and
open a handoff item.

Check the claim mechanically first, and check it in the options bar rather than by grepping the
tree. The brush engine has since landed, so `Hardness` and `Spacing` now appear in `src/` for the
eraser, the clone stamp, the smudge, the sponge, the dodge and the burn, and a tree-wide grep for
those two names can no longer tell you whether the **paint** bar renders them. The assertion that
can is the negative one — `Paint.test.tsx`, the
`it('no longer renders the TODO placeholder it replaced')` case, which asserts that `Flow`,
`Airbrush`, `Symmetry` and `Auto Erase` are absent, with its sibling case rendering all four
shipped controls. That is the shape of `absent-in-ph`: the name survives only where something admits
it is not implemented.

### The options bar component

#### The contract

A tool-options component must:

1. Be typed `ToolbarRightComponent` (`src/components/ToolbarsRight/types.ts`, which
   is `React.FC<{}>` — no props, it reads the store).
2. Be registered as the `toolboxComponent` of its tool in `toolsMap`
   (the `ToolsMap` type in `src/tools/toolsMap.ts`, which types the map as
   `Record<ToolName, Partial<ToolProcessorDefinition> & { icon: string; toolboxComponent: ToolbarRightComponent }>`,
   so the `toolboxComponent` field is mandatory and exhaustively typed).
3. Read its own state through the type-safe pair `getToolArgs` / `patchToolArgs` from
   `useCurrentTool` (the `CurrentToolContextState` interface in
   `src/contexts/useCurrentTool.tsx`), **not** through a cast.
   The `MagicWand` component in `src/components/ToolbarsRight/MagicWand/MagicWand.tsx`
   is the current idiom:

   ```tsx
   const { getToolArgs, patchToolArgs } = useCurrentTool();
   const args = getToolArgs('magic-wand');
   if (!args) return null;
   ```

   The older bars use `toolArgs as DrawToolArgs` + `setToolArgs({ ...args, x })`
   (the `args` cast in `src/components/ToolbarsRight/Draw/Draw.tsx` and in
   `src/components/ToolbarsRight/Figures/Shape.tsx`). Match the new idiom for new tools.

4. Put the foreground colour into the tool's own args. The store's `color` is what a
   paint stroke should use, and nothing else carries it across — without the sync
   effect a brush is frozen on its `#000000` default however the swatch is set.
   The colour-sync `useEffect` in `Draw.tsx` does this for the legacy pen; every new
   paint bar must do it for itself.
5. Give **every** control a real `<label htmlFor>` + `id` + visible text. That is the
   only reason the control is reachable from e2e, and it is pinned in two directions:
   the `it('derives its accessible name from the visible label text and nothing else')`
   case in `src/components/ToolbarsRight/Crop/__tests__/Crop.test.tsx` proves the
   accessible name comes from `htmlFor` + `id` plus
   the rendered text, and the `it.fails('keeps an explicit aria-label on the Aspect Ratio select')`
   case in the same file is an `it.fails` pin asserting that
   adding an `aria-label` to a select that already has `htmlFor` + `id` is not the house
   pattern.

#### Where it mounts

`ToolbarHorizontal.tsx` is thirty lines and does one thing: read
`{ hasImage, toolName }` from the store (the `ToolbarHorizontal` component's `useStore`
destructure), bail to an empty bar when either is
missing (its `if (!toolName || !hasImage)` guard), look the component up in `toolsMap`
**through a `?.`** (the `ToolComponent` lookup), bail
to a `TODO: unregistered tool placeholder` strip when the lookup fails, and
otherwise render `<ToolComponent key={toolName} />` inside the bar chrome.
Four consequences you have to design around:

- **The bar renders only when the store has `hasImage` AND a `toolName`** (pinned by the
  `it('renders an empty toolbar bar without placeholder copy when the image is missing')`
  case in `src/components/ToolbarHorizontal/__tests__/ToolbarHorizontal.test.tsx`).
- **A tool missing from `toolsMap` shows a TODO strip instead of failing** (pinned by the
  `it('renders a placeholder instead of crashing for a tool that is not registered in the map')`
  case in `ToolbarHorizontal.test.tsx`). Registering the component is a
  separate, easily-forgotten step.
- **`key={toolName}`** is a hard remount on every tool switch. Local component
  state does not survive a switch; anything that must survive belongs in the tool's
  args, which is what the settings section is about.
- The chrome class string is repeated verbatim in all three branches.
  `overflow-visible` is load-bearing: it lets tooltips and flyouts escape the bar. Do
  not "simplify" it.

#### A complete, compiling example

`Color Replacement` is the right worked example: it has a real renderer
(the `'color-replacement'` entry in `src/tools/toolProcessors.ts` → `draw(..., 'spray')` →
`drawPen()` in `src/util/draw.ts`), real args (`PaintToolArgs`, the `PaintToolArgs` type
in `src/tools/draw.ts`), real defaults (the `'color-replacement'` default in
`src/tools/settings.ts`), and it is still a placeholder card
(the `'color-replacement'` entry in `src/tools/toolsMap.ts`). Replacing that card is the
whole task. The bar
publishes **two** controls, because two reach the renderer: `lineWidth` becomes the
spray radius and `alpha` the gradient stop, both in `drawSpray()` in
`src/util/draw.ts`.
Photoshop's `Mode`, `Tolerance` and the three sampling icons are absent, and the
placeholder card still names them (`placeholderToolGroups` in
`src/components/ToolbarsRight/toolbarPlaceholderConfig.ts`).

```tsx
// src/components/ToolbarsRight/Paint/Paint.tsx
import React, { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { draw, type DrawToolArgs, type PaintToolName, type PenType } from '../../../tools/draw.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import type { Point } from '../../../contexts/general-types.ts';
import type { ToolbarRightComponent } from '../types.ts';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

const SIZE_MIN = 1;
const SIZE_MAX = 500;

const clampSize = (value: number): number =>
  Number.isFinite(value) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, value)) : SIZE_MIN;

const toPercent = (alpha: number): number => Math.round(alpha * 100);

/**
 * Builds the paint options bar for one tool.
 *
 * Each tool gets its own component identity rather than one shared component reading
 * `toolArgs.toolName`, for the same reason `toolsMap` mints a fresh closure per
 * placeholder: the identity is what `ToolbarHorizontal`'s `key={toolName}` remount and
 * the `toolboxComponent` contract are written against. `penType` is the value the
 * tool's registry adapter forces, so the preview cannot disagree with the stroke.
 */
export const createPaintToolbar = (toolName: PaintToolName, penType: PenType): ToolbarRightComponent => {
  const PaintToolbar: React.FC<{}> = () => {
    const [{ color, containerRef, totalSize }] = useStore();
    const { getToolArgs, patchToolArgs, setToolArgs } = useCurrentTool();
    const [brushScale, setBrushScale] = useState<number>(0);
    const previewRef = useRef<HTMLCanvasElement | null>(null);

    const args = getToolArgs(toolName);

    usePointerPosition({ ref: containerRef, imageSize: totalSize, onResize: ({ scale }) => setBrushScale(scale) });

    useEffect(() => {
      if (!args || args.color === color) return;
      setToolArgs({ ...args, color });
    }, [args, color, setToolArgs]);

    useEffect(() => {
      if (!args || !previewRef.current || !brushScale) return;

      const canvas = previewRef.current;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const radius = PREVIEW_HEIGHT / 2.2 / brushScale;
      const centerX = PREVIEW_WIDTH / 2.1 / brushScale;
      const centerY = PREVIEW_HEIGHT / 2.4 / brushScale;
      const arcPoints: Point[] = [];

      for (let angle = -1 / 2; angle <= Math.PI / 2 + 1.2; angle += Math.PI / 2) {
        arcPoints.push({ x: centerX + 2 * Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
      }

      const previewArgs: DrawToolArgs = { ...args, penType, toolName: 'draw', color, points: arcPoints };
      const [toolCanvas] = draw({ size: { width: PREVIEW_WIDTH / brushScale, height: PREVIEW_HEIGHT / brushScale } })(
        previewArgs
      );

      ctx.drawImage(toolCanvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    }, [args, brushScale, color, penType]);

    if (!args) return null;

    const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { lineWidth: clampSize(Number(event.target.value)) });
    };

    const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { alpha: Number(event.target.value) / 100 });
    };

    return (
      <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
        <label htmlFor={`${toolName}-size`} className={FIELD_CLASS}>
          Size <span className={VALUE_CLASS}>{Math.round(args.lineWidth)}px</span>
          <input
            id={`${toolName}-size`}
            className={SLIDER_CLASS}
            max={SIZE_MAX}
            min={SIZE_MIN}
            step="1"
            type="range"
            value={args.lineWidth}
            onChange={handleSizeChange}
          />
        </label>

        <label htmlFor={`${toolName}-opacity`} className={FIELD_CLASS}>
          Opacity <span className={VALUE_CLASS}>{toPercent(args.alpha)}%</span>
          <input
            id={`${toolName}-opacity`}
            className={SLIDER_CLASS}
            max="100"
            min="0"
            step="1"
            type="range"
            value={toPercent(args.alpha)}
            onChange={handleOpacityChange}
          />
        </label>

        <div
          className={`flex h-12 w-24 items-center justify-center flex-shrink-0 ${
            isLightColor(color) ? 'chessboard-dark' : 'chessboard-light'
          }`}
        >
          <canvas ref={previewRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
        </div>
      </div>
    );
  };

  PaintToolbar.displayName = `PaintToolbar(${toolName})`;
  return PaintToolbar;
};
```

Each tool's own file is then the entire implementation —
`src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx` is
`import { createPaintToolbar } from '../Paint/Paint.tsx';` followed by
`export default createPaintToolbar('color-replacement', 'spray');` — and the
registration is one line in `src/tools/toolsMap.ts`, replacing
`placeholderTool('Color Replacement Tool', 'color-replacement')` with
`toolboxComponent: ColorReplacement`. Delete the `'color-replacement'` entry from
`toolbarPlaceholderConfig.ts` in the same change.

#### What the factory buys and what it costs

**Buys.** One implementation for N tools, so a fix to the preview or the colour sync
lands on all of them at once. Independent per-tool settings, because the state lives
in each tool's own args rather than in one component reading a shared prop. Independent
tests, because `createPaintToolbar` returns a component a test can render against a
mocked `useCurrentTool` with no cross-tool fixture. Independent registries, because
`key={toolName}` remounts per tool and each `toolboxComponent` identity is distinct.

**Costs.** A per-tool configuration argument is unavoidable, and that argument is
where the divergence hides: `penType` exists only because each tool's registry adapter
forces one (the `brush` entry in `src/tools/toolProcessors.ts` forces `'pen'`, the
`'color-replacement'` entry forces `'spray'`), and a factory that hides that renders a preview the
canvas never produces. The second cost is the shared class constants: three tools with
genuinely different densities either grow a `Record<PaintToolName, string>` of class
strings or fork the file. Fork the file before you build the table. Use the factory
while the tools differ **only by name and defaults**; the moment one tool needs a
control the other must not show, a `toolName === 'brush' &&` inside the shared body is
the moment two components become cheaper.

### Control conventions

There is no form-control library, and `src/components/Common/**` is not where the
vocabulary lives. The house patterns, all verified in-tree:

| Affordance          | House pattern                                                                                                                                                                                                                            | Reference                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Slider + value      | `<label htmlFor>` + `id`, value inline in a `font-bold` span (`{brushSize}px`, `{Math.round(alpha * 100)}%`, `{rotate}°`), `input type="range"` with `h-1.5 w-NN cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700` | the `Size` row in `Draw.tsx`                             |
| Buttons             | `PRIMARY_BUTTON` / `SECONDARY_BUTTON` from `buttonStyles.ts`                                                                                                                                                                             | `buttonStyles.ts` — `PRIMARY_BUTTON`, `SECONDARY_BUTTON` |
| Segmented control   | adjacent `TOGGLE_BUTTON_ACTIVE` / `TOGGLE_BUTTON_INACTIVE`                                                                                                                                                                               | `buttonStyles.ts` — `TOGGLE_BUTTON_ACTIVE`               |
| Dropdown            | plain `<select>` with a real `htmlFor` + `id`                                                                                                                                                                                            | the Pen Type `<select>` in `Draw.tsx`                    |
| Checkbox            | `type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"`                                                                                                                                      | the `filled-toggle` checkbox in `Shape.tsx`              |
| Crowded row         | root becomes `flex h-full flex-row items-center gap-5 overflow-x-auto`                                                                                                                                                                   | the root row of `MagicWand.tsx`                          |
| Hint / live readout | `text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800`, holding a value from live state such as `selectedPixelCount.toLocaleString()`               | the hint readout in `MagicWand.tsx`                      |
| Preview swatch      | a fixed 96×48 `<canvas>` over a `chessboard-*` class, fed by the tool's own renderer                                                                                                                                                     | the preview swatch in `Draw.tsx`                         |

**No i18n exists.** Every label is a hardcoded English literal. Do not introduce keys.

**There is no numeric scrub field, no segmented-button component, no gradient picker,
no brush-preset popup grid, no blend-mode dropdown.** The foreground / background
swatch is a hand-positioned `div` plus a hidden `input type="color"`
(`handleColorClick()` in `src/components/SidebarLeft/SidebarLeft.tsx`). If your tool needs one of
those you are building it for the first time: factor it into `buttonStyles.ts`-style
constants rather than inlining a third copy of `SLIDER_CLASS`. The preview canvas
carries no `aria-label` and no `title`, pinned on purpose by the
`it('renders a 96x48 preview surface with no accessible role')` case in
`src/components/ToolbarsRight/Draw/__tests__/Draw.test.tsx`.

#### The accessible-name contract

Every control is a `<label>` that _wraps_ its input and carries `htmlFor`, so the
control's accessible name is the label's whole text content, value suffix included.
For `<label htmlFor="color-replacement-size">Size <span>{Math.round(args.lineWidth)}px</span><input …/></label>`
the input's name is **`Size 10px`** at `lineWidth: 10` and **`Size 24px`** after the
user drags it. `Opacity 90%`, `Tolerance 28%` and `Smooth 1.5px` follow the same rule;
a `<select>` with no suffix is just `Mode`. Three consequences:

- **Exact-name locators are brittle.** A spec asking for `'Size 10px'` passes until
  someone moves the slider. Every in-repo spec uses a prefix regex or a bare label for
  this reason: the `const brightness = page.getByRole('slider', { name: /Brightness/ })`
  locator in `e2e/levels.spec.ts`, the
  `page.getByRole('combobox', { name: 'Pen Type' })` locator in `e2e/pen-types.spec.ts` —
  bare, because that select has no
  suffix. Unit tests do the same: `getByLabelText(/Tolerance/)` in `MagicWand.test.tsx`,
  not `'Tolerance 28%'`.
- **The suffix is not decoration.** It is the only place the current value is legible
  without moving the pointer, and it is what makes the control's state assertable from
  a screenshot.
- **Never add an `aria-label` to a control that already has `htmlFor` + `id`.** That is
  the `it.fails('keeps an explicit aria-label on the Aspect Ratio select')` pin in
  `Crop.test.tsx`, and a control carrying both announces
  whichever wins.

#### The control set, and whether it reaches this renderer

Photoshop's display label, the control type, Photoshop's default and range, and the
verdict for **this** app. This table is the one to read before promising a control to
anyone.

| Control             | Type                    | PS default  | PS range                          | Status here                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------- | ----------- | --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brush Preset picker | thumbnail popup         | last used   | n/a                               | `plumbed`, as the app's own preset set                                             | `src/tools/brush.ts` — `PAINT_PRESETS` (three synthetic presets per paint tool) and `matchPaintPreset()`, which returns `''` for a hand-tuned bar so the picker shows `Custom`; the bar renders it as a real `Brush Preset` select (`Paint.test.tsx` — `getPresetSelect()`). It is **not** Photoshop's tip registry: a preset here carries Size, Opacity, Smoothing and Mode and nothing else                                                                                                                                                                                                                                                                                         |
| Size                | slider, integer px      | 30 px       | 1-5000                            | `plumbed` (ceiling 500)                                                            | `setupDrawCtx()` — `ctx.lineWidth = lineWidth`; spray radius `src/util/draw.ts` — `drawSpray()`; bar `Draw.tsx` — the `Size` row uses 0.5-500                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Mode                | dropdown of blend modes | Normal      | 27 modes                          | `plumbed`, 16 of Photoshop's 27                                                    | `DrawToolArgs.blendMode` (`src/tools/draw.ts` — its optional `blendMode` member) → `toolLayerBlendMode()` in `src/contexts/layer-utils.ts`, the closed `PAINT_BLEND_MODES` set with a Normal fallback, resolved by `createLayerSource()` and carried on `Layer.blendMode` to the `ctx.globalCompositeOperation = layer.blendMode` write in `src/contexts/layer-renderer.ts`. The other eleven have no canvas `GlobalCompositeOperation` equivalent, and `ctx.globalCompositeOperation = 'dissolve'` is ignored by the browser rather than erroring                                                                                                                                    |
| Opacity             | slider, percent         | 100%        | 0-100                             | `plumbed`                                                                          | `setupDrawCtx()` — `ctx.globalAlpha = alpha`; spray stop `src/util/draw.ts` — `drawSpray()`; bars `Draw.tsx` — the `Opacity` row, `Levels.tsx` — the `Brightness` row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Flow                | slider, percent         | 100%        | 1-100                             | `needs-engine`                                                                     | `setupDrawCtx` sets `globalAlpha` once per stroke (`src/tools/draw.ts` — `setupDrawCtx()`, which `draw()` calls); per-dab accumulation needs a stamp loop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Feather             | slider, px              | 0 px        | 0-250                             | `plumbed` for `feather-magnetic-lasso`                                             | `featherRadius` default 12 (`src/tools/settings.ts` — the `feather-magnetic-lasso` default) → `featheredBoundsPadding(antiAlias, featherRadius)` in `src/util/selection.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Tolerance           | slider, integer         | 32          | 0-255                             | `plumbed` for `magic-wand`                                                         | `src/components/Main/MagicWandToolArea.tsx` — its two `getMagicWandOptions` calls carrying `tolerance` — reach `getToleranceDistance(options.tolerance ?? 0)` in `src/util/magicWand.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Anti-alias          | checkbox                | on          | on/off                            | `plumbed` for `feather-magnetic-lasso`                                             | `antiAlias: true` (`src/tools/settings.ts` — the `feather-magnetic-lasso` default) → `featheredBoundsPadding()` and `alphaFromSignedDistance()` in `src/util/selection.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Smoothing           | slider, percent         | 10% (brush) | 0-100                             | `plumbed` for `magic-wand` / `feather-magnetic-lasso`; `plumbed` for the paint bar | magic-wand as `Smooth` px (`MagicWand.tsx` — the `Smooth` row, reaching `simplifyClosedPath()` in `src/util/magicWand.ts`); lasso as px (`src/components/Main/FeatherMagneticLassoToolArea.tsx` — the `simplifyPath(rawPoints, args.smoothing)` call); the paint bar's own slider rides `DrawToolArgs.smoothing` (`src/tools/draw.ts` — its optional `smoothing` member) into `smoothStrokePoints()` in `src/tools/brush.ts`, seeded at `PAINT_SMOOTHING_DEFAULT` and made required by `PaintSettings`. **The algorithm is not Photoshop's** — it pulls each sampled interior point toward its neighbours' midpoint, where Photoshop's is a trailing anchor over the raw input stream |
| Style / Ratio       | dropdown + W/H fields   | Normal      | Normal / Fixed Ratio / Fixed Size | `plumbed` for `crop` only                                                          | `CropToolArgs.aspectRatio` default `null` (`src/tools/settings.ts` — the `crop` default (`aspectRatio: null`)); `RectangularSelectionToolArgs` is `{ rect?, toolName }` only (`src/tools/rectangularSelection.ts` — `RectangularSelectionToolArgs`) and its bar has no style control                                                                                                                                                                                                                                                                                                                                                                                                  |
| Dodge / Exposure    | slider, stops           | 0.00        | ±20.00                            | `plumbed`                                                                          | `dodge` and `burn` are registered (`src/contexts/tool-types.ts` — `ToolArgsByName`'s `dodge` and `burn` members) and share one `Tonal` options panel (`src/tools/toolsMap.ts` — the `dodge` and `burn` entries); the `exposure` bounds come from the tool module (`src/tools/dodgeBurn.ts`) and the tip bounds from the brush engine, per `Tonal.test.tsx` — the `it('takes the exposure bounds from the tool module and the tip bounds from the brush engine')` title                                                                                                                                                                                                                |
| Spacing             | slider, percent         | 25%         | 1-200                             | `needs-engine`                                                                     | `drawPen` issues one `beginPath` + one `stroke()` per stroke (`src/util/draw.ts` — `drawPen()`); point density along a single path is not a spacing interval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Hardness            | slider, percent         | 100%        | 0-100                             | `needs-engine`                                                                     | the edge is whatever `ctx.stroke()` produces; `setupDrawCtx` sets no gradient or shadow (`src/tools/draw.ts` — `setupDrawCtx()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Read the `needs-engine` rows as work, not as blockers. `Flow` is the only one of the three
left: it needs a per-dab alpha accumulation, which `setupDrawCtx()` cannot give because it writes
`ctx.globalAlpha` once per stroke (`src/tools/draw.ts` — `setupDrawCtx()`, which `draw()` calls
once per commit). `Hardness` and `Spacing` are `needs-engine` **for the paint bar only**, and the
reason is a shape rather than a missing algorithm: `drawPen()` in `src/util/draw.ts` still issues
one `beginPath` and one `stroke()` per stroke, so point density along a single path is not a
spacing interval and the edge is whatever `ctx.stroke()` produces. The stamped-tip engine these two
need has since landed in `src/util/brush-engine.ts`, and the eraser, the clone stamp, the smudge,
the sponge and the tonal tools all reach it — so the work for a paint stroke is to route it through
an engine that already exists, not to write one. One more thing to read before you add any control
bound to a live pointer: `DrawToolArea.tsx` calls `setupDrawCtx()` once at the start of a gesture
and its own comment records that the shared overlay then paints many times per that one call, so a
control changed mid-gesture is honoured in the committed pixels and ignored in the preview. The
stroke the user watched is not the stroke they get.

### Rendering the disabled control

Photoshop renders an option a build cannot honour as **disabled, not absent**. That
looks like it contradicts the dead-slider rule, and it does not. **Disabled is
correct** for a control that is genuinely part of the tool's Photoshop identity, is
documented, and is simply not wired to anything yet: it says "this tool has this, and
this build does not do it yet", which is true. **A live control that pretends to work
is never correct**, because a disabled control is read as "not now" and a live one as
"already working". The line is whether the _rendering_ knows the control is
unfulfilled, which in this repo is a `disabled` attribute whose condition is a real
fact about state, never a hardcoded `true`:

```tsx
// src/components/ToolbarsRight/Levels/Levels.tsx:137-144
<button
  className={`${SECONDARY_BUTTON} w-full focus:ring-2 focus:ring-blue-500 disabled:opacity-50`}
  onClick={discardAdjustment}
  disabled={!hasLivePreview}
  data-testid="undo-button-reset"
>
  Reset
</button>
```

`hasLivePreview` is derived from the store's `previewLayers` and is the exact
predicate for "this panel's discard has something to discard" (`Levels.tsx` — `hasLivePreview`
explains the read). `disabled:opacity-50` is on the button class because
`SECONDARY_BUTTON` alone does not dim
(`src/components/ToolbarsRight/buttonStyles.ts` — `SECONDARY_BUTTON`) — a disabled control that
_looks_ enabled is a third state, and it is the worst one. The same shape appears in
`MagicWand.tsx` — the Copy / Paste / Clear button row, where Copy, Paste and Clear each gate on a distinct fact.

**Hidden is a different answer, and sometimes the right one.** The Shape bar _hides_
the Dash and Gap sliders unless the Dashed checkbox is on (`Shape.tsx` — the Dashed-conditional Dash and Gap sliders), pinned
by `Shape.test.tsx` — the `it('shows dash and gap sliders when dashed is enabled')` title: a dash pattern
is meaningless for a solid stroke, and a live slider for it would be the lie. So: part
of the tool and not honoured → **disabled**, with a `title` saying why; meaningless in
the current mode → **hidden**; part of the tool and honoured → **live**, the only
third option, and the reason the rule exists.

### Flyout and toolbar placement

`toolbarMap` is data, at the **repo root**: `toolbar-mapping.ts` — `toolbarMap`, terminated
`as const satisfies readonly (readonly ToolbarToolGroup[])[]` (`toolbarMap`'s `satisfies` clause). Shape is
`sections → flyout groups → tools`; each nested array is one flyout, and **the first
entry is the tile's identity** (`src/components/SidebarLeft/SidebarLeft.tsx` — `renderToolGroup()`'s `primaryTool = group[0]`).
Adding a tool takes two edits here and nothing else: append a
`{ label, name, shortcut? }` entry to the flyout group that owns the slot, and append
the same `name` to `availableTools` (`toolbar-mapping.ts` — `availableTools`).

Choose the section by Photoshop's own grouping. The canonical 20 slots are in
`.kilo/plans/ps-research/03-ui-chrome-spec.md` §1.1: Move/Marquee/Lasso/Quick
Selection, Crop, Eyedropper, Healing, **Brush/Pencil/Color Replacement**, Clone Stamp,
History Brush, Eraser, Paint Bucket, Blur, **Dodge/Burn/Sponge**, Pen, Type, Path
Selection, Shape, Hand, Zoom. A new paint tool goes in the Brush section
(`toolbar-mapping.ts` — the Brush flyout group in `toolbarMap`); a new tonal tool goes where slot 14 would sit, which
`toolbarMap` lacks — see the trap below before you add a section.

**Two traps here are load-bearing.** **Flyout test ids are positional**:
`tool-flyout-${groupIndex}` (`SidebarLeft.tsx` — `renderToolGroup()`'s `tool-flyout-${groupIndex}` testid) and
`tool-flyout-item-${name}-${slug}` (`renderToolGroup()`'s `tool-flyout-item-${name}-${slug}` testid), where the group index is
`${sectionIndex}-${groupIndex}` in one-column mode (`SidebarLeft.tsx` — `oneColumnGroupKey()`) and
`two-column-${groupIndex}` in two-column mode (`SidebarLeft.tsx` — `twoColumnGroupKey()`). Inserting a group anywhere in
`toolbarMap` renumbers every later section and silently invalidates any spec that
hard-codes a flyout id, so append inside the last section when you can. And **the
primary tile is `group[0]`** (`SidebarLeft.tsx` — `renderToolGroup()`'s `primaryTool = group[0]`), so reordering a group's first item also changes
what a plain click selects.

`slugifyToolLabel` (`toolbar-mapping.ts` — `slugifyToolLabel`) is deliberately duplicated as
`generateSlug` in the e2e helper and compared by a unit test. Do not tidy one side into
an import of the other — the duplication is the test. `shortcut` is **display-only**:
it reaches the tooltip (`SidebarLeft.tsx` — the tile's `shortcut` prop) and the `<kbd>` chip (`SidebarLeft.tsx` — `renderToolGroup()`'s `<kbd>` chip) and binds
nothing; the real binding is a separate `useKeyDownShortcut` call.

#### The figure-name convention

The five shape entries are the clearest existing example of a naming rule you will need
again. `toolbar-mapping.ts` — the five figure entries in `toolbarMap` gives all five the **same** `name: 'shape'` and
distinguishes them by a `figure` field:

```ts
[
  { label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' },
  { label: 'Ellipse Tool', name: 'shape', figure: 'oval' },
  { label: 'Line Tool', name: 'shape', figure: 'line' },
  { label: 'Triangle Tool', name: 'shape', figure: 'triangle' },
  { label: 'Polygon Tool', name: 'shape', figure: 'polygon' },
  { label: 'Custom Shape Tool', name: 'custom-shape' },
],
```

The toolbar therefore selects `shape` and patches the figure
(`SidebarLeft.tsx` — the `patchToolArgs('shape', { figure })` click handler: `if (tool.figure) patchToolArgs('shape', { figure: tool.figure })`),
and selection is read back through both (`SidebarLeft.tsx` — the `patchToolArgs('shape', …)` click handler).

Yet `rectangle`, `ellipse`, `triangle`, `polygon` and `line` are still real
`ToolName`s, with entries in `availableTools` (`toolbar-mapping.ts` — the five figure names in `availableTools`),
`toolsMap` (`src/tools/toolsMap.ts` — the five figure entries), `defaultSettings`
(`src/tools/settings.ts` — the five figure entries in `defaultSettings`) and `saveLastSettings`
(`src/util/settings.ts` — `saveLastSettings()`). **The `Record<ToolName, …>` types are what force
them to exist.** `ToolName = keyof ToolArgsByName`, and `ToolArgsByName` declares each
one with a narrowed figure (`src/contexts/tool-types.ts` — `ToolArgsByName`'s narrowed-figure members, e.g.
`figure: Extract<FigureType, 'rectangle'>`). From there the requirement cascades
through `toolProcessors: Record<ToolName, ToolProcessorDefinition>`
(`src/tools/toolProcessors.ts` — the `toolProcessors` registry), `toolsMap: ToolsMap` (`src/tools/toolsMap.ts` — the `ToolsMap` type),
`defaultSettings … satisfies ToolArgsByName` (`src/tools/settings.ts` — `defaultSettings` and its `satisfies ToolArgsByName` clause) and the `never`
sentinel in `saveLastSettings` (`src/util/settings.ts` — `saveLastSettings()`'s `never` sentinel). Add a member to
`ToolArgsByName` and every one of those fails to compile until it is handled.

They are **registry-only names**: no `toolbarMap` entry selects one, and the shape
test pins that the mapping never mentions `circle` or `square` at all
(`toolbar-mapping.test.ts` — the `it('has no dedicated Circle or Square tools')` case). They exist
because the durable document and the history replay address a source by tool name,
and a Rectangle drag must replay as a rectangle. Use this pattern when your new tool
is a variant of an existing one and Adobe exposes it as a separate button: the
toolbar selects the base tool, the registry carries the variants, the type system
keeps the two in agreement.

### Icon

`FROM-MEMORY` for the rule, from `.kilo/plans/ps-research/03-ui-chrome-spec.md` §7
("Icons"), which sources it to Adobe's published design guidance: **monochromatic,
colour varies by state and theme; 20×20 viewBox; 1px (sometimes 2px) strokes; round
caps and joins; `currentColor`; consistent weights and proportions per size; avoid
lettering; provide light and dark variants.** The chrome spec labels its own 20×20
figure an approximation, so treat the number as a convention, not a measurement.

The repo does not use 20×20. Every icon goes through one shell,
`src/components/SidebarLeft/icons/IconShell.tsx` — `IconShell`, which hard-codes
`viewBox="0 0 32 32"`, `className="h-7 w-7 overflow-visible"`, `fill="none"`,
`aria-hidden="true"`, and exports `STROKE = 'currentColor'` (`IconShell.tsx` — `STROKE`). A new icon written
on 32×32 coordinates is correct **for this repo**; a 20×20 icon authored against
Adobe's published number and dropped into this shell is squashed to 56% and will look
it. A new icon is three edits, not one — the component, the `ToolIconName` union member
(`src/components/SidebarLeft/types.ts` — `ToolIconName`), and the registry entry:

```tsx
// src/components/SidebarLeft/icons/DodgeIcon.tsx
import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const DodgeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <circle cx="12" cy="12" r="5.5" stroke={STROKE} strokeWidth="1.4" fill="none" />
    <path d="M17 17 24 24" stroke={STROKE} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    <path d="M4 9h16" stroke={STROKE} strokeLinecap="round" strokeWidth="1.2" opacity="0.6" />
  </IconShell>
);
```

```ts
// src/components/SidebarLeft/toolIcons.tsx
import { DodgeIcon } from './icons/DodgeIcon';

export const toolIcons: Record<ToolIconName, SvgIconFactory> = {
  // …
  dodge: DodgeIcon,
};
```

Two things that will fail you if you skip them. The union is **hand-copied into the
test** at `toolIcons.test.tsx` — the hand-copied `toolIconNames` array — extend
that copy too, or the test fails on a union the typecheck accepts. And the
`icon: string` field on each `toolsMap` entry (`src/tools/toolsMap.ts` — the `ToolsMap` type's `icon: string` field) is a separate string
that **no production code reads**; `SidebarLeft` resolves the glyph through
`toolIcons[tool.name]` (`SidebarLeft.tsx` — the `toolIcons[tool.name]` lookup) with an unchecked index that typechecks
only because `ToolName ⊂ ToolIconName` today. Set both, or neither. Selected / hover
states are **not** the icon's job either: they are the tile's class constants —
`TOOL_BUTTON_BASE_CLASS`, `TOOL_BUTTON_ACTIVE_CLASS`, `TOOL_BUTTON_INACTIVE_CLASS`
(`SidebarLeft.tsx` — the `TOOL_BUTTON_BASE_CLASS` / `TOOL_BUTTON_ACTIVE_CLASS` / `TOOL_BUTTON_INACTIVE_CLASS` constants), applied at `SidebarLeft.tsx` — `renderToolGroup()`'s tile className. An icon that hard-codes its own hover
colour fights them.

### Cursor

**There is no cursor registry.** Each tool area hard-codes a class on its own root
div, and `Main.scss` — the `.cursor-*` classes holds the whole set: `.cursor-draw` and `.cursor-crop`
(crosshair), `.cursor-text`, `.cursor-move` (pointer), `.cursor-grab` /
`.cursor-grabbing` (`!important`, mirrored globally in `src/index.scss` — the global `.cursor-grabbing *` rule),
`.cursor-pointer`. Several areas use Tailwind's `cursor-crosshair` directly instead
(`src/components/Main/MagicWandToolArea.tsx` — its `cursor-crosshair` root, `src/components/Main/RectangularSelectionToolArea.tsx` — its `cursor-crosshair` root,
`src/components/Main/PolygonClickToolArea.tsx` — its `cursor-crosshair` root, `src/components/Main/FeatherMagneticLassoToolArea.tsx` — its `cursor-crosshair` root). Resize handles
are imperative via `CURSOR_MAP` (`src/util/constants.ts` — `CURSOR_MAP`).

**There is no brush-size cursor overlay on the canvas.** The only size preview is the
fixed 96×48 canvas in the options bar (`src/components/ToolbarsRight/Draw/Draw.tsx` — the 96×48 preview `<canvas>`). Photoshop's Normal Brush
Tip is a live circle at the tip diameter, so a crosshair on the artboard is a real
fidelity gap — a **new feature**, not a wiring job.

**Navigation tools should not be `ToolName`s at all.** Hand and Zoom change the
viewport; they do not commit pixels, they own no args, and pushing them through
`ToolArgsByName` buys a `{ toolName: 'hand' }` entry no processor reads and a bar that
never appears. Note the asymmetry: `CURSOR_MAP` already exists for exactly this kind
of transient, non-committing interaction, and it is keyed by geometry rather than by
tool. Add navigation as viewport state with its own cursors, not as a tool.

### Settings persistence

Persistence is **in-memory only**. A reload resets every slider; the only
`localStorage` in `src/` is the theme. What you are building is therefore a
**tool-switch** contract, not a reload contract: a control must survive switching away
and back within the session. The four pieces are the per-tool defaults
(`src/tools/settings.ts` — `defaultSettings`, closed by its `satisfies ToolArgsByName` clause), the
live record `lastSavedSettings = cloneDeep(defaultSettings)` (`src/tools/settings.ts` — `lastSavedSettings`), the write
`saveLastSettings` (`src/util/settings.ts` — `saveLastSettings()`, called from `src/contexts/useCurrentTool.tsx` — `_setToolArgs()`
on **every** `setToolArgs`), and the read `cloneSavedToolArgs`
(`src/contexts/useCurrentTool.tsx` — `cloneSavedToolArgs()`). Because the write runs on the same tick as the slider's
own `onChange`, the defect below is possible.

#### The defect class that bit a real build

`saveLastSettings` is an `if/else` chain over tool names, and one of its arms collapsed
every paint tool's args to a bare name:

```ts
// src/util/settings.ts — the save arm, and the defect that bit a real build
} else if (
  toolName === 'brush' || toolName === 'pencil' || toolName === 'color-replacement' ||
  // … the six pen-family tools
) {
  (lastSavedSettings as Record<string, { toolName: string }>)[toolName] = cloneDeep({ toolName });
}
```

That arm is correct for the seven pen-family tools, whose commit kind is
`'unimplemented'` and whose args really are `{ toolName }`. It is **wrong** for
`brush`, `pencil` and `color-replacement`, which have full `PaintToolArgs`
(`src/tools/draw.ts` — `PaintToolArgs`). The sequence: the bar writes `lineWidth: 24` via
`patchToolArgs`; `_setToolArgs` calls `saveLastSettings` on the same tick
(`src/contexts/useCurrentTool.tsx` — `_setToolArgs()`) and the arm above throws the value away; switching tools
replaces the provider's in-memory args (`src/contexts/useCurrentTool.tsx` — `cloneSavedToolArgs()`); and switching back
reads `lastSavedSettings.brush`, which is `{ toolName: 'brush' }` — no `lineWidth`, no
`alpha`, no `color`. The sliders appear to work and reset themselves the moment the
user looks away.

**The test that let it through asserted the wrong thing.**
`src/tools/__tests__/tool-settings.test.ts`
(`persists every registered tool name, so the chain cannot drop one`) deletes each key,
calls `saveLastSettings`, and asserts the key came back. A bare `{ toolName }`
recreates the key perfectly; the test was green the whole time every value was being
discarded. Worse, `tool-settings.test.ts` (`collapses tools without a settings UI down to their tool
name`) now _pins_ the collapse for the tools that are correct, and the arm is shared
with them — so deleting the defect means splitting the arm, not loosening the test.

**The rule: assert the VALUES survive a tool switch, not the key.** The shape that
catches it is in `src/util/__tests__/settings.test.ts` — the `switchToTool` helper — a `switchToTool` helper
that mirrors the provider's deep clone of `lastSavedSettings[toolName]` — used by the
`saveLastSettings across a tool switch` block (`settings.test.ts`). A new tool gets one case
in that block, and the test name is the assertion:

```ts
// src/util/__tests__/settings.test.ts, inside describe('saveLastSettings across a tool switch')
it('keeps every color-replacement setting when another tool is edited between the two switches', () => {
  saveLastSettings({ alpha: 0.4, color: '#ff8800', lineWidth: 32, penType: 'spray', toolName: 'color-replacement' });
  switchToTool('levels');
  saveLastSettings({ brightness: 40, contrast: -20, toolName: 'levels' });

  expect(switchToTool('color-replacement')).toMatchObject({
    alpha: 0.4,
    color: '#ff8800',
    lineWidth: 32,
    penType: 'spray',
  });
});
```

The fix in `src/util/settings.ts` is to split the arm and save the real args, with
`points` emptied the way `draw` empties it (`src/util/settings.ts` — `saveLastSettings()`'s `draw` arm):

```ts
} else if (toolName === 'brush' || toolName === 'pencil' || toolName === 'color-replacement') {
  (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep({
    ...(args as ToolArgs),
    points: [],
  });
} else if (
  toolName === 'pen' ||
  toolName === 'freeform-pen' ||
  toolName === 'curvature-pen' ||
  toolName === 'add-anchor-point' ||
  toolName === 'delete-anchor-point' ||
  toolName === 'convert-point' ||
  toolName === 'custom-shape'
) {
  (lastSavedSettings as Record<string, { toolName: string }>)[toolName] = cloneDeep({ toolName });
}
```

#### The contracts your defaults must satisfy

`src/tools/__tests__/tool-settings.test.ts` pins all of these, and a new tool's entry
has to satisfy every one on the same commit: no shared object references between
entries (`it('does not share object references between entries')`); every number finite, no `NaN` or `Infinity` (`it('seeds every number with a finite value, so no filter or geometry can be poisoned at the source')`); every
`alpha` inside 0..1 (`it('keeps every declared alpha inside the 0..1 range a canvas globalAlpha accepts')`); every non-null colour matching
`/^#[0-9A-Fa-f]{6}$/` (`it('seeds every non-null colour as a six-digit hex string')`); a `commit: 'unimplemented'` tool's default exactly
`{ toolName }` (`it('reduces every unimplemented tool to a bare tool name, matching its null result')`); each entry stamped with its own key as `toolName` (`it('stamps each entry with its own key as toolName')`)
and the key set matching `toolProcessors` (`it('declares an entry for every tool, and a processor or a pixel-free declaration for each')`); mutable collections seeded empty
(`it('seeds mutable collections empty so a fresh document has no stale geometry')`). The `'unimplemented'` rule is what makes the settings arm above
non-negotiable: give a paint tool full args and you must also have moved it off
`'unimplemented'`.

And the trap that keeps a new tool from falling off the end of the chain:

```ts
// src/util/settings.ts:93-99
} else {
  const _exhaustive: never = toolName;
  void _exhaustive;
}
```

Adding a tool to `ToolArgsByName` without adding an arm here is a **typecheck error**,
the cheapest possible guard. Do not weaken it to make a new tool compile — the tool's
settings would be silently dropped and its sliders would reset on the next switch,
which is the same defect with a different trigger.

## Phase 3 — strip the undoable requirement

Every `file` and unit name below was read in `main` on 2026-09-28. Re-read them before you edit:
`AGENTS.md` says of handoff docs "Verify against the tree."

---

### What the operator is actually asking for

An operator who says "strip the undoable requirement" is not asking you to delete undo.
They are asking you **not to spend their task migrating the history system**. They have
read `HANDOFF.md` §1 ("P0 — the durable replay path has no production caller") and
they do not want their tool to be the reason that file grows.

> **The reframe.** You are not removing undo. You are **choosing a `commit` kind whose
> durable representation is already generic**, and you are making the new tool's settings
> **ride the existing `args` channel** so legacy replay, undo/redo and the durable shadow
> cannot disagree. Undoability then arrives with the tool.

Both halves are load-bearing, and the second is the one agents skip.

**The first half** is a lookup table, derived in `### The decision table` below from
`src/contexts/history-adapter.ts` — `operationForTool()` and
`src/contexts/materialization.ts`. One commit kind — `raster` — is provably
name-agnostic: no allowlist exists anywhere between the tool's own name and the
materializer. That is your escape hatch, and it is free.

**The second half** is why the reference implementation worked. A history item holds no
pixels; legacy undo recomputes them by re-running the processor with the stored `args`
(`src/contexts/useHistory.ts` — the `applyRasterTool` arm, the `applyRasterTool` arm, which reads
`layer.tmpCanvas ?? layer.bitmap`, calls `toolProcessors[args.toolName].imageProcessor`,
and writes the result back to `tmpCanvas`). So the legacy contract for a raster tool is
exactly two properties, and you check both yourself: **`imageProcessor` is
deterministic** — same args, same bitmap, same pixels, which is what
`replay.deterministic` declares (`src/tools/toolProcessors.ts` — `ToolProcessorDefinition`'s `replay.deterministic`) — and **`args` is
plain JSON**, because the durable conversion runs them through `plainObject`
(`src/contexts/history-adapter.ts` — `plainObject()`), which throws on any non-plain value, a
non-finite number, or a non-`Object.prototype` object. There is no canvas snapshot, no
`ImageData`, no diffing, no migration. That is the cost.

**The durable path is a shadow, and you must not over-claim.** `AGENTS.md`'s Architecture status section: the
legacy `HistoryItem[]` path is the production replay authority; the durable document is a
shadow projection, not the authority for rendering. Choosing `commit: 'raster'` buys a
durable document that _agrees_ with legacy replay. It does not promote the durable
document. Say so in the PR.

#### Vocabulary

| Symbol                    | Meaning                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToolCommitKind`          | the eight-value union at `src/tools/toolProcessors.ts` — `ToolCommitKind`; a tool's declared answer to "how does my result become state?"                                                                                         |
| `ToolProcessorDefinition` | the registry entry type in `src/tools/toolProcessors.ts`: `creator?`, `commit`, `replay`, `imageProcessor`. The registry is keyed by `PixelToolName`, **not** `ToolName`, so a pixel-free tool goes in `PIXEL_FREE_TOOLS` instead |
| `replay`                  | the frozen descriptor at `src/tools/toolProcessors.ts` — `ToolProcessorDefinition.replay` — `{ kind, deterministic, version, requiresRaster }`, built by the `replay()` factory                                                   |
| `DurableOperation`        | the durable operation union at `src/contexts/history-model.ts` — `DurableOperation` — the eleven shapes a durable history entry can hold                                                                                          |
| `DurableHistoryEntry`     | `{ id, schemaVersion, enabled, operation }`, `src/contexts/history-model.ts` — `DurableHistoryEntry`                                                                                                                              |
| `operationForTool`        | `src/contexts/history-adapter.ts` — `operationForTool()` — **the whole decision point.** Maps one legacy `TOOL_ACTION` entry to one `DurableOperation`, or `null`, or throws                                                      |
| `imageProcessor`          | `(params) => (args) => [BitmapSource, Partial<Pos>?]`; called with `{ bitmap, size }` on replay, `{ size }` for a creator, `{ bitmap, size }` in materialization                                                                  |
| `ToolArgs`                | the closed per-tool args union, `src/contexts/tool-types.ts` — `ToolArgsByName`; every settings field you add is an optional member of your tool's entry                                                                          |

---

### The decision table

`ToolCommitKind` has eight members (`src/tools/toolProcessors.ts` — `ToolCommitKind`). One row each,
derived from `operationForTool` and the two consumers of its output.

| `commit` kind        | What it means                                                                 | Durable op it becomes                                                                                                                                                                                                                                                                                                                                                                                                   | Name-agnostic?                                                                                                                                                                                                                                                                                                                                                                                                                                             | What it costs                                                                                                                                        | VERDICT                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raster`             | My output is a new raster for the layer.                                      | `apply-raster-processor` with `processorId: args.toolName`, `src/contexts/history-adapter.ts` — `operationForTool()`'s `raster` arm                                                                                                                                                                                                                                                                                     | **YES.** No allowlist; `args.toolName` becomes the `processorId` and the materializer resolves it by lookup: `toolProcessors[operation.processorId]` at `src/contexts/materialization.ts` — the `toolProcessors[operation.processorId]` lookup                                                                                                                                                                                                             | zero edits to the history files                                                                                                                      | **ESCAPE HATCH — tier 1. Use this.**                                                                                                                                   |
| `geometry`           | I only move and/or resize the layer's `pos`.                                  | `reposition-layer` carrying `move` and/or `resize`, `src/contexts/history-adapter.ts` — `operationForTool()`'s `geometry` arm                                                                                                                                                                                                                                                                                           | **YES.** The arm reads only `args.move` / `args.resize`; it never reads `args.toolName`. Replay applies it by patching `pos`, `src/contexts/durable-replay.ts` — the `'reposition-layer'` case                                                                                                                                                                                                                                                             | zero edits to the history files                                                                                                                      | **ESCAPE HATCH — tier 1**, for pure move/resize only                                                                                                                   |
| `source`             | I _create_ a layer; my args **are** the layer source.                         | `create-layer`, `src/contexts/history-adapter.ts` — `legacyHistoryToDurable()`, in its `NEW_LAYER_ACTION \|\| (TOOL_ACTION && source)` arm, **not** from `operationForTool`                                                                                                                                                                                                                                             | **YES for the create path.** The op carries no tool name; the name lives on `DurableLayerSource.toolName`, a free `string` (`src/contexts/history-model.ts` — the free `toolName: string` on the `vector` and `text` members of `DurableLayerSource`)                                                                                                                                                                                                      | zero edits to the history files                                                                                                                      | **ESCAPE HATCH for a creator only.** See the trap below                                                                                                                |
| `layer-operation`    | I am a non-destructive filter: append a retained op, do not touch pixels now. | `apply-filter` carrying a `DurableFilter`, `src/contexts/history-adapter.ts` — `operationForTool()`'s `layer-operation` arm                                                                                                                                                                                                                                                                                             | **NO.** Allowlist `['blur', 'color', 'levels']` at `src/contexts/history-adapter.ts` — `operationForTool()`'s filter allowlist; closed union `DurableFilter['toolName']` at `src/contexts/history-model.ts` — `DurableFilter['toolName']`; a `switch` with **no `default` arm** at `src/contexts/materialization.ts` — `presentationOperations()`; a second throw at `src/contexts/materialization.ts` — `presentationOperations()`'s filter version check | four hardcoded sites across three files                                                                                                              | **NOT an escape hatch — tier 2**                                                                                                                                       |
| `selection`          | I produce selection state.                                                    | **`null`.** `src/contexts/history-adapter.ts` — `operationForTool()` returns `null` for `selection` and `document-operation` alike. Selection state enters the durable timeline as a `set-selection` op derived from the `SELECTION_ACTION` entry's args by `deriveSetSelectionEntry` (`src/contexts/history-adapter.ts` — `deriveSetSelectionEntry()`), carried on `legacyHistoryToDurable()`'s `SELECTION_ACTION` arm | the **op** is generic; the **representation** is not — `SelectionGeometry` (`src/contexts/general-types.ts` — `SelectionGeometry`) and `SelectionSourceTool` (`general-types.ts` — `SelectionSourceTool`) are closed unions                                                                                                                                                                                                                                | a new geometry widens both unions                                                                                                                    | **NOT an escape hatch — tier 2**                                                                                                                                       |
| `affine-operation`   | I retain an affine transform.                                                 | `apply-affine-transform`, `src/contexts/history-adapter.ts` — `operationForTool()`'s `apply-affine-transform` return                                                                                                                                                                                                                                                                                                    | **NO — the commit kind is never consulted.** The affine arm sits behind `if (args.toolName === 'transform')` in `operationForTool()`, which returns or throws from inside its own block. A new tool declaring `commit: 'affine-operation'` falls past every `processor.commit === …` test and hits `operationForTool()`'s closing `UnsupportedHistoryFeatureError` throw                                                                                   | the `toolName` gate and the trapezoid arm inside `operationForTool()`, `src/contexts/history-replay.ts` — `replayHistory()`'s `affine-operation` arm | **NOT an escape hatch.** The _op_ is generic; the _kind_ is a name-keyed special case                                                                                  |
| `document-operation` | I own the document frame, not a layer.                                        | **`null`**, `src/contexts/history-adapter.ts` — `operationForTool()`'s `return null`. Legacy replay `continue`s: `if (processor.commit === 'document-operation') continue;` at `src/contexts/history-replay.ts` — `replayHistory()`'s `document-operation` continue                                                                                                                                                     | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none — but the op is discarded by **both** systems                                                                                                   | **NOT an escape hatch.** This is crop's declaration, and it silently loses the operation in legacy replay too                                                          |
| `unimplemented`      | I do not exist yet.                                                           | **throws** `UnsupportedHistoryFeatureError` at `src/contexts/history-adapter.ts` — `operationForTool()`'s closing throw                                                                                                                                                                                                                                                                                                 | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                                                                                                                                                 | **NOT an escape hatch.** The processor is also a no-op: `unimplemented = () => () => [null as never] as ToolResult` at `src/tools/toolProcessors.ts` — `unimplemented` |

#### Three traps the table exposes

**`affine-operation` — the generic op is not reachable by the generic kind.** The naive
reading of `ToolCommitKind` is "`apply-affine-transform` is a generic op, so
`commit: 'affine-operation'` is the generic way to reach it." The code disagrees. The
order of tests in `operationForTool` is: `if (args.toolName === 'transform')` at
`src/contexts/history-adapter.ts` — `operationForTool()`'s `if (args.toolName === 'transform')` gate, which **returns or throws from inside its own
block**; then `processor.commit === 'layer-operation'` (inside `operationForTool()`), `=== 'geometry'`,
`=== 'raster'` (all inside `operationForTool()`), and `=== 'document-operation' || === 'selection'` returning `null`
(also in `operationForTool()`); then `throw new UnsupportedHistoryFeatureError(...)` at `operationForTool()`'s closing throw. A tool named
`warp` with `commit: 'affine-operation'` reaches `operationForTool()`'s closing throw and throws. Legacy replay survives
it (`src/contexts/history-replay.ts` — `replayHistory()`'s `affine-operation` arm handles the kind for any tool name), so the
failure is **durable-only** and silent until the shadow is exercised.

**`source` — only an escape hatch in its creator role.** `operationForTool` has no
`commit === 'source'` arm at all, so a `source` tool dispatched as a `TOOL_ACTION` against
an **existing** layer (no `layerSource`) falls past every arm to the throw at `operationForTool()`'s closing throw, while
legacy replay rasterizes it through its own default arm
(`src/contexts/history-replay.ts` — `replayHistory()`'s default `applyRasterTool` arm). `draw`, `shape`, `text`, `rectangle`, `ellipse`,
`triangle`, `polygon` and `line` all declare `commit: 'source'` and are all marked
`creator: true` (`src/tools/toolProcessors.ts` — the `commit: 'source'`, `creator: true` entries); keep that pairing.

**`layer-operation` — looks generic and is not.** Sharpen, Noise Reduction and Vibrance
are the natural next tools and all three are filters. They work perfectly in legacy replay
(`src/contexts/history-replay.ts` — `replayHistory()`'s `layer-operation` arm appends a retained operation for **any**
`layer-operation` tool, no name check) and fail **only** the shadow, with an
`Unsupported filter ${args.toolName}` throw (`src/contexts/history-adapter.ts` — the `Unsupported filter` throw) that
voids the whole durable document.

---

### The three tiers

The cost of a tool that is genuinely **not** yet undoable-safe escalates in three steps.
Know which one you are on before you write code, because tiers 2 and 3 are
history-migration tasks, not tool tasks.

#### Tier 1 — rides an existing generic commit kind. **Nothing owed.**

`commit: 'raster'`, `commit: 'geometry'`, or `commit: 'source'` **as a creator**.

You write the processor, register it, add the `defaultSettings` entry, and stop. Zero
edits to `history-model.ts`, `history-adapter.ts`, `durable-replay.ts`,
`history-append.ts` or `materialization.ts`. The durable document agrees with legacy
replay from the first commit, and undo/redo come with the tool because the args already
carry everything replay needs.

The durable raster path is generic end to end. The conversion arm
(`src/contexts/history-adapter.ts` — `operationForTool()`'s `raster` arm) builds `{ kind: 'apply-raster-processor',
layerId, processorId: args.toolName, version: processor.replay.version, args:
plainObject(args, …) }` — note what is absent: any allowlist, any name test, any `default`
case. The materializer then resolves it **by lookup, not by a table**
(`src/contexts/materialization.ts` — the `toolProcessors[operation.processorId]` lookup and its two throws: `toolProcessors[operation.processorId as keyof typeof toolProcessors]`,
an unknown-name throw, a `replay.version` mismatch throw, then
`processor.imageProcessor({ bitmap, size })(operation.args as ToolArgs)`). `processorId`
**is** your tool's own name; nothing else has to learn that you exist.

And durable **replay** does not even discriminate: `apply-filter`,
`apply-affine-transform` and `apply-raster-processor` are one collapsed arm
(`src/contexts/durable-replay.ts` — the collapsed `apply-filter` / `apply-affine-transform` / `apply-raster-processor` case) that appends the operation to the layer's
retained list. The name only matters at materialization, and only the _filter_
materializer is name-closed.

#### Tier 2 — needs an entry in a closed union in the history files. **A migration task.**

The exact hardcoded sites. Enumerate them from the tree, not from memory. A new
`layer-operation` filter tool (Sharpen, Vibrance, Noise Reduction) touches five; a tool
that retains an affine transform touches three:

| #   | Site                                                                                                 | What is hardcoded                                                                     | Compiler?                                                                      |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | `src/contexts/history-adapter.ts` — `operationForTool()`'s filter allowlist                          | `if (!['blur', 'color', 'levels'].includes(args.toolName)) throw …`                   | no                                                                             |
| 2   | `src/contexts/history-model.ts` — `DurableFilter`                                                    | `DurableFilter.toolName: 'blur' \| 'color' \| 'levels'`                               | yes, at the cast on `history-adapter.ts` — the `DurableFilter` cast            |
| 3   | `src/contexts/materialization.ts` — `presentationOperations()`                                       | `filterForOperation` — a `switch` over three names with **no `default` arm**          | yes: declared return `string` + closed-union argument make a new member TS2364 |
| 4   | `src/contexts/materialization.ts` — `presentationOperations()`'s filter version check                | `operationFilter` re-derives the processor by name and throws on a `version` mismatch | no                                                                             |
| 5   | `tool-processors.test.ts` — the `it('marks only raster-producing tools as requiring raster')` case   | the `requiresRaster` tool list is asserted exhaustively                               | yes                                                                            |
| 6   | `src/contexts/history-adapter.ts` — `operationForTool()`'s `if (args.toolName === 'transform')` gate | `if (args.toolName === 'transform')` — the whole affine arm                           | no                                                                             |
| 7   | `src/contexts/history-adapter.ts` — `operationForTool()`'s trapezoid arm                             | the trapezoid raster boundary, keyed on `trapezoid` and `transform` args              | no                                                                             |
| 8   | `src/contexts/history-replay.ts` — the `toolArgs.toolName === 'transform'` trapezoid read            | `toolArgs.toolName === 'transform' ? … : 0`                                           | no                                                                             |

Touching any of these is a **history-migration task, not a tool task**: it changes what an
existing durable document means, and `DURABLE_SCHEMA_VERSION` is `1`
(`src/contexts/history-model.ts` — `DURABLE_SCHEMA_VERSION`), checked in exactly one place,
`src/contexts/history-append.ts` — `validatePlannedDurableEntry()`. If your tool fits none of the existing generic ops
and you would have to widen one of these, that is a `HANDOFF.md` entry, and you ship the
tool on `commit: 'raster'`. **To add a selection tool**, see the next section.

#### Tier 3 — needs a new `DurableOperation` variant. **Out of scope. Hand it off.**

If your tool's semantics fit none of `create-layer`, `remove-layer`,
`set-layer-properties`, `reposition-layer`, `reorder-layers`, `apply-filter`,
`apply-affine-transform`, `apply-raster-processor`, `set-document-frame`,
`merge-document` or `set-selection`
(`src/contexts/history-model.ts` — `DurableOperation`), the answer is a `HANDOFF.md` entry and the tool
ships on `commit: 'raster'`. This is a boundary, not a judgement call. Here is the bill,
and note the enforcement column — sites 1, 2 and 11 are the only ones the compiler holds
you to:

| #   | Site                                                                                                             | Enforced by the compiler?                 |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | `src/contexts/history-model.ts` — `DurableOperation` — the union                                                 | —                                         |
| 2   | `src/contexts/history-model.ts` — `cloneOperation()` `cloneOperation`                                            | **yes** (TS2366, no `default`)            |
| 3   | `src/contexts/history-model.ts` — `collectDurableAssetIds()` `collectDurableAssetIds`                            | no (partial switch)                       |
| 4   | `src/contexts/durable-replay.ts` — `replayDurableDocument()`'s operation switch `replayDurableDocument`          | **no — a missing case is a silent no-op** |
| 5   | `src/contexts/history-adapter.ts` — `operationForTool()` `operationForTool`                                      | no                                        |
| 6   | `src/contexts/history-adapter.ts` — `legacyHistoryToDurable()` `legacyHistoryToDurable`                          | no                                        |
| 7   | `src/contexts/history-append.ts` — `translate()` `translate`                                                     | no                                        |
| 8   | `src/contexts/history-append.ts` — `validatePlannedDurableEntry()` `validatePlannedDurableEntry`                 | no                                        |
| 9   | `src/contexts/materialization.ts` — the pixel-application loop pixel application order                           | no                                        |
| 10  | `src/contexts/materialization.ts` — `presentationOperations()` `operationFilter` — unknown kinds are **dropped** | no                                        |
| 11  | `src/tools/toolProcessors.ts` — the tool's `commit` + `replay.version`                                           | **yes**                                   |

`tsconfig.app.json` — the "Linting" `compilerOptions` block sets `strict`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch` — and **not** `noImplicitReturns`. Sites 3 and 4 are
statement-position switches, so `tsc` stays green on a missing case. A new operation kind
with a missing replay arm is a silent no-op in production: the durable document replays
without it, disagrees with legacy replay, and nothing reports the disagreement.

**What "decline" actually costs, and the asymmetry you must not get wrong.** Two decline
postures exist in the tree, with different severities. The **append boundary** declines
per-entry and _warns_: `unavailable()` returns `durableEntry: null` with
`severity: 'warning'` (`src/contexts/history-append.ts` — `unavailable()`, whose diagnostic carries `severity: 'warning'`), the
terminal arm is `translate()`'s terminal `unavailable()` arm, `decideDurableAppend` then returns
`outcome: 'preconditions'` (`src/contexts/history-append.ts` — `decideDurableAppend()`), and the store falls
back to `buildDurableDocument` (`src/contexts/StoreContext.tsx` —
`buildDurableDocument()`) for a full O(history) re-conversion — **a performance cliff on a shadow, not a
correctness loss.** The **shadow conversion** is **fail-closed for the whole document**:
one unsupported entry throws inside the per-item loop, the loop catches it into an
`error`-severity diagnostic (`src/contexts/history-adapter.ts` — `diagnosticFromError()`), and
`convertLegacyHistorySafely` rolls the asset transaction back and returns
`{ status: 'unavailable', document: null }` (`convertLegacyHistorySafely()`'s `status: 'unavailable'` return) — **the shadow is absent, not
degraded.** A tool durable conversion cannot translate therefore costs the _whole_ durable
document, not just its own entry. That is designed behaviour, and `AGENTS.md`'s Architecture status section says
the durable document is a shadow, so nothing user-visible breaks — but it is a consequence
an agent should be able to explain rather than discover.

---

### The two commit kinds that are NOT escape hatches

`layer-operation` and `selection` are the two a new tool reaches for and must not.

#### `layer-operation` — the allowlist is the whole story

The durable filter path is name-closed in **four** places, and a tool that misses any one
of them fails in a different way.

1. **Conversion refuses it.** `src/contexts/history-adapter.ts` — `operationForTool()`'s filter allowlist throws
   `UnsupportedHistoryFeatureError('Unsupported filter …')` for any name outside
   `['blur', 'color', 'levels']`. This fires first, and its throw voids the entire durable
   document (`src/contexts/history-adapter.ts` — `convertLegacyHistorySafely()`).
2. **The type forbids it.** `DurableFilter.toolName` is the literal union
   `'blur' | 'color' | 'levels'` (`src/contexts/history-model.ts` — `DurableFilter['toolName']`). The cast at
   `src/contexts/history-adapter.ts` — the `DurableFilter` cast is a cast precisely because the compiler cannot
   check it.
3. **Materialization cannot render it.** `filterForOperation`
   (`src/contexts/materialization.ts` — `presentationOperations()`) is a `switch` over the three names with
   **no `default` arm**, so an unlisted member is a compile error, not a fallback.
4. **Version drift is refused.** `operationFilter`
   (`src/contexts/materialization.ts` — `presentationOperations()`'s filter version check) re-derives the processor from
   `operation.filter.toolName` and throws on a `replay.version` mismatch.

The legacy side has none of this: `src/contexts/history-replay.ts` — `replayHistory()`'s `layer-operation` arm appends a
retained operation for **any** `layer-operation` tool, no name check. So a new filter tool
is legacy-good and durable-fatal, and the failure is invisible until the shadow runs. The
honest move in a stripped task: declare `commit: 'raster'`, accept that the shadow no
longer holds it non-destructively, and write the `HANDOFF.md` entry that widens the four
sites. Do not widen the allowlist in a tool task.

#### `selection` — a new selection tool needs no new durable op, and a new selection _geometry_ does

**The op is already generic.** `operationForTool` returns `null` for `selection`
(`src/contexts/history-adapter.ts` — `operationForTool()`'s `return null`) — a selection tool is not a layer operation and
correctly produces no `DurableOperation` from the tool arm. Selection state enters the
durable timeline through a separate route: the `SELECTION_ACTION` history entry's
`previousSelectionState` / `nextSelectionState` args
(`src/contexts/selection-baseline.ts` — `SelectionHistoryArgs`), converted to a `set-selection` op by
`deriveSetSelectionEntry` (`src/contexts/history-adapter.ts` — `deriveSetSelectionEntry()`) and carried on the
`legacyHistoryToDurable()`'s `SELECTION_ACTION` arm. A new selection tool that emits the same entry shape
needs **no** new durable op. Confirmed: the two `SELECTION_ACTION` writers are
`appendSelectionClear` (`src/contexts/useSelectionHistory.ts` — `appendSelectionClear()`) and the per-gesture
writer at its per-gesture `appendSelectionClear()` call, and neither names a tool.

**The representation is a closed union.** This is where it stops being free.

- `SelectionGeometry = 'polygon' | 'rectangle'` — `src/contexts/general-types.ts` — `SelectionGeometry`. A
  new geometry (an ellipse marquee, a single-row marquee) widens this, and it is read by
  the renderer, not only by the durable model.
- `SelectionSourceTool = 'polygonal-lasso' | 'freehand-lasso' | 'feather-magnetic-lasso' | 'magic-wand' | 'rectangular-selection'`
  — `src/contexts/general-types.ts` — `SelectionSourceTool`. It is a **string literal union**, not a derived
  type: nothing ties it to `ToolName` (`src/contexts/tool-types.ts` — `ToolName`), so adding the tool
  to `ToolArgsByName` does not add it here, and TypeScript will not tell you which of the two
  you forgot. **Check what the two newest tools did before you widen it** — `elliptical-selection`
  and `quick-selection` are registered and fully wired, yet both deliberately **borrow**
  `'magic-wand'` (`src/tools/ellipticalSelection.ts` — `ELLIPTICAL_SELECTION_SOURCE_TOOL`, `src/tools/quickSelection.ts` — `QUICK_SELECTION_SOURCE_TOOL`)
  rather than adding their own member, because the region each commits is a traced mask
  rather than a marquee. Widening this union is a real decision with a real cost, not a
  checkbox; the borrowed value is a documented choice, not an oversight to correct.
- `Selection.geometry` and `Selection.sourceTool` — `src/contexts/general-types.ts` — `Selection.geometry` and `Selection.sourceTool`.
- `SelectionDraftState.sourceTool` — `src/contexts/general-types.ts` — `ActiveSelectionDraftState.sourceTool`.
- `SelectionMetadata` — `src/contexts/general-types.ts` — `SelectionMetadata` — is the per-tool settings
  bag (`magneticLasso`, `magicWand`, `featherRadius`, …). A new tool with settings needs a
  member here, and this object is what the durable `set-selection` op deep-copies
  (`src/contexts/history-model.ts` — the `case 'set-selection'` arm).

**And selections are outside durable replay authority at the cutover.** The tree says so
twice. `src/contexts/StoreContext.tsx` — the header comment on what can enter the durable document: "A selection can therefore only enter the
document through a `SELECTION_ACTION` history entry, and a layer operation only through a
history entry. This holds whichever rule seeds the baseline, because both read the
timeline." That half is durable — it survives the pending change below, because both
consumers keep reading the timeline either way.

**The baseline lookup is currently unbounded, and that is a known pending change, not
settled design.** `deriveSelectionBaseline`
(`src/contexts/selection-baseline.ts` — `deriveSelectionBaseline()`) takes the whole timeline and no cursor, and
`src/contexts/selection-baseline.ts` — the doc comment above `deriveSelectionBaseline()` still carries the rationale for it: a selection
is created by a gesture that writes no history entry, so the tool-switch clear's
`previousSelectionState` is the only record that the selection ever existed. **Do not
cite that comment as the design.** `src/contexts/history-adapter.ts` — the comment above `legacyHistoryToDurable()`'s `deriveSelectionBaseline()` call carries the same
stale rationale in the caller's own voice, and §31 requires **both** to be rewritten in the
same change — rewriting only the first leaves the rule's owner corrected while its caller
still advertises why it must not be bounded. `HANDOFF.md` §31 records that the premise is now
false — every selection-creating gesture records its own entry, which is exactly the two
`SELECTION_ACTION` writers named above — so the bound is safe to make, and the entry is
actionable. Bounding it needs a cursor argument threaded through **both** consumers
(`src/contexts/history-replay.ts` — `replayHistory()`'s `deriveSelectionBaseline(history)` call and `history-adapter.ts` — `legacyHistoryToDurable()`'s `deriveSelectionBaseline()` call); bounding
one and not the other re-opens the parity divergence `selection-baseline.ts` exists to
close.

So treat the unbounded scan as a live defect with a prescribed fix, and read `HANDOFF.md`
§31 before designing anything here. The same entry names the tests that pin the current
behaviour as load-bearing rather than stale: they assert a creation entry that sits
_after_ the replay target, and a fix must re-derive them to a creation entry that precedes
it — not delete them to make the bound pass.

Two consequences that hold either way. `deriveSetSelectionEntry` returns `null` for a
missing or structurally unusable `nextSelectionState`
(`src/contexts/history-adapter.ts` — `deriveSetSelectionEntry()`'s null return) — the conversion **reports instead of inventing**
a cleared selection; do not "fix" that by defaulting. And because durable replay applies
only each operation's `after` (`src/contexts/durable-replay.ts` — the `'set-selection'` case), a selection that
never produced a `SELECTION_ACTION` entry is invisible to the durable document. Ship a new
selection tool with its union widenings in the same change; do not treat the durable op as
covering the representation.

#### The rest, briefly

- **`affine-operation`** — see the trap above. Generic op, name-gated kind.
- **`document-operation`** — `src/contexts/history-adapter.ts` — `operationForTool()`'s `return null` returns `null` and
  `src/contexts/history-replay.ts` — `replayHistory()`'s `document-operation` continue `continue`s, so the operation is discarded by
  **both** systems. It is crop's declaration, not a way to skip work.
- **`unimplemented`** — `src/contexts/history-adapter.ts` — `operationForTool()`'s closing throw throws, which voids the
  whole durable document, and the processor is
  `() => () => [null as never] as ToolResult` (`src/tools/toolProcessors.ts` — `unimplemented`) so it
  produces nothing. If you mark an `unimplemented` processor `creator: true` and dispatch
  it as a tool-layer source, `createLayerSource` assigns the `null` to `layer.tmpCanvas`
  with no throw (`src/contexts/layer-utils.ts` — `createLayerSource()`) — a layer that exists, is visible,
  is undoable, and is empty. That is the worst of both systems.

---

### The rule

> **Pick the `commit` kind by asking what the tool's result IS, then pick the LOWEST tier
> that answer admits. Never write a new `DurableOperation` variant for a new tool.**

1. **Does the tool create a new layer?** → `commit: 'source'` with `creator: true`. Stop.
2. **Does it only move or resize an existing layer's `pos`?** → `commit: 'geometry'`. Stop.
3. **Does it produce pixels for one layer?** → `commit: 'raster'`. Stop. **This is the
   answer for every drawing, painting, erasing, healing, clone-stamp and text-on-pixels
   tool.**
4. **Would `raster` lose something real?** List it. "It should be non-destructive" is not a
   reason — that is `layer-operation`, and it is tier 2. "The shadow must carry a shape no
   existing op has" is a reason: tier 3, and a `HANDOFF.md` entry.
5. **If the answer is 3 and you are nervous about non-destructiveness:** ship on `raster`,
   write the handoff entry, and say so in the PR. The durable document is a shadow
   (`AGENTS.md`'s Architecture status section); a missing non-destructive shadow is a tracked problem, not a
   shipped defect.

Then verify, before you write a line of UI: `npm run test -- src/tools/__tests__/tool-processors.test.ts`
(the commit/replay pair is asserted exhaustively, so both tests fail loudly if you leave
it inconsistent), then `npm run tsc`. Never gate on `npx tsc --noEmit`: the root
`tsconfig.json` is a `files: []` solution stub, so it processes nothing. `npm run tsc`
(`tsc -b`) is the authoritative one.

---

### What you must still declare

Stripping the migration work does not license an undeclared contract. These four are
non-negotiable in a stripped task, and three are quoted verbatim from
`.kilo/plans/ps-research/RESEARCH-BRIEF.md` (189 lines, constraints at the "Architecture constraints your recommendations MUST respect" section of `RESEARCH-BRIEF.md`) — the
hard-won decisions list the tool research sessions had to respect.

**1. An honest `replay` contract.** `replay` is part of the processor contract
(`src/tools/toolProcessors.ts` — `ToolProcessorDefinition`). `RESEARCH-BRIEF.md` constraint 2, verbatim:

> **Durable replay.** Every tool must have a declared `replay` contract in
> `toolProcessors.ts`. A tool whose pixel output cannot be reproduced deterministically
> must be marked `deterministic: false` / `requiresRaster: true`, and its replay must be
> routed through a raster snapshot rather than re-executing the operation. If you propose
> a new tool, specify its `commit` and `replay` entries explicitly.

`deterministic` and `requiresRaster` are **truth claims, not conveniences.** A tool that
samples a random seed, reads the wall clock, depends on a network font, or composites
against the base layer is `deterministic: false`. Two unit tests hold you to it, both
exhaustive over `toolNames` so a new tool is covered the moment it is registered:
`tool-processors.test.ts` — the `it('commits every raster processor as a raster-processor replay')` case asserts `replay.kind` tracks
`commit` (`'raster'` → `'raster-processor'`, `'unimplemented'` → `'unimplemented'` as the
two special cases), and `tool-processors.test.ts` — the `it('marks only raster-producing tools as requiring raster')` case asserts
`replay.requiresRaster === (commit === 'raster' || (commit === 'selection' && !creator))`.
So `commit: 'raster'` **forces** `requiresRaster: true`; you do not get to declare
otherwise. The descriptor must stay frozen and versioned —
`src/tools/toolProcessors.ts` — the `replay()` factory builds
`Object.freeze({ kind, deterministic, version: 1, requiresRaster })`, and
`tool-processors.test.ts` — the `it('gives each tool a distinct replay descriptor that toolsMap reuses by reference')` case asserts the frozen object, the exact
key set, and that `toolsMap` reuses it **by reference**. **Bump `version` when the pixel
output of an existing processor changes for the same args** —
`src/contexts/materialization.ts` — the unknown-processor and version-mismatch throws rejects an unknown `processorId`/`version` pair,
and so does `src/contexts/materialization.ts` — `presentationOperations()`'s filter version check for filters.

**2. The `commit` kind**, from the table above, with its tier stated. If the answer is
tier 1, say "tier 1, zero history-file edits" in the PR — that sentence is the whole
deliverable of this phase.

**3. The settings shape in `defaultSettings`.** `defaultSettings` is
`src/tools/settings.ts` — `defaultSettings`; `DefaultSettings` is its inferred type and
`lastSavedSettings` clones it into the per-tool store. Every control you ship
needs an entry there, `satisfies`-checked against your tool's args type — the existing
shape, for the two paint tools, is `src/tools/settings.ts` — the `brush` and `pencil` entries in `defaultSettings` (`alpha`, `color`,
`penType`, `lineWidth`, `points`, `toolName`). If a control is not in `defaultSettings` and
not in a real component under `src/components/ToolbarsRight/`, it does not exist; a setting
with no `defaultSettings` entry is a setting the next tool switch erases.

**4. An operation that cannot be replayed deterministically must REJECT the durable
branch.** `RESEARCH-BRIEF.md` constraint 3, verbatim:

> **Unsupported operations must reject the durable branch.** Do not manufacture durable
> no-op operations that falsely appear replayable. Reject is a valid, preferred outcome.

This is the one an agent is most tempted to bend, because rejecting is slower to ship than
faking. The tree already does it correctly in three places; copy them rather than invent a
fourth: `src/contexts/history-adapter.ts` — `operationForTool()`'s closing throw throws `UnsupportedHistoryFeatureError` for
an unhandled commit kind rather than a fake op; `operationForTool()`'s `Unsupported filter` throw throws `Unsupported filter …` for a
filter outside the allowlist rather than a generic `apply-filter`; and `deriveSetSelectionEntry()`'s null return is
`if (!isValidSelectionSnapshot(next)) return null;` in `deriveSetSelectionEntry`, whose doc
comment (the doc comment above `deriveSetSelectionEntry()`) spells out why — "Returning `null` makes the caller report instead of
inventing state."

The anti-pattern to refuse, in your own words: declaring `commit: 'raster'` for a tool
whose `imageProcessor` throws, catches, silently no-ops, or returns a canvas it did not
fully draw. That is a durable op that falsely appears replayable. Reject instead —
`requiresRaster: true` with a real raster, or an honest throw.

**Bonus constraint, because it decides where you put the commit.**
`RESEARCH-BRIEF.md` constraint 8, verbatim:

> **One history state per user action**, not per pointer event. Photoshop commits a stroke
> on mouse-up; a selection commits when the marquee is closed. Propose history behavior
> at that grain.

And constraint 1, which the durable path makes concrete: runtime layer state is mutated
only by dispatching a typed action through the store reducer. If your tool needs to publish
derived presentation state, it needs document-scoped presentation ownership or a new typed
presentation action — not a mutation from a callback or an async continuation.
`AGENTS.md`'s Architecture status section is the one home for why the presentation boundary holds, and
the part of it that decides where your commit goes is narrow: a promoted cache reaches a published
layer only at `src/contexts/StoreContext.tsx` — the reducer's `PROMOTE_LAYER_PRESENTATIONS` arm
arm, and the dispatcher that queues that action re-checks `isSamePresentationCanvas` first
(`src/contexts/StoreContext.tsx` — the dispatcher's `isSamePresentationCanvas` re-check). So hand your canvas to `promoteLayerPresentation`, which
dispatches it (`src/contexts/StoreContext.tsx` — `promoteLayerPresentation()`), and never assign to a published layer's
`tmpCanvas`. Do not restate that here if you extend this file: `docs/DOCUMENTATION.md`'s single-home
rule makes `AGENTS.md` the only place the architecture status is written down.

---

### The backward-compatibility trick

`main` solved the undo problem **without migrating anything**, and the shape it used is reusable,
non-obvious and cheap. It was written on an unmerged branch once; that branch is in no ref of this
repository, so treat what follows as current code and re-verify it against whatever base you land
on. Read it as three layers, because all three are needed and agents routinely ship the first and
skip the third.

#### Layer 1 — the type: a new optional field, absent by default

`smoothing` and `blendMode` are **optional** members of `DrawToolArgs`, and the paint tools are made
to **require** them (`src/tools/draw.ts` — `DrawToolArgs` and `PaintToolArgs`):

```ts
export type DrawToolArgs = {
  // … existing members …
  /**
   * Photoshop `Smoothing`, 0-100, applied to the sampled path by
   * `smoothStrokePoints`. Optional because the legacy `draw` tool's per-pen presets
   * (`src/tools/settings.ts:37-41,68-74`) predate it; an absent value is no smoothing,
   * which is exactly what those presets render today.
   */
  smoothing?: number;
  blendMode?: PaintBlendMode;
  toolName: 'draw';
};

export type PaintToolArgs = Omit<DrawToolArgs, 'toolName' | 'smoothing' | 'blendMode'> &
  PaintSettings & { toolName: PaintToolName };
```

The asymmetry is the point. Optional on the base type so nothing that predates the setting
has to change; **required** on the paint type, via `Omit` + intersection with
`PaintSettings` (`src/tools/brush.ts` — `PaintSettings`), so the options bar can read it
without a guard and a `draw`-era args object can never satisfy the paint type by omission.
That is how "optional in the args channel, mandatory in the new tool" is expressed without
a runtime check. And because the legacy `draw` tool's per-pen presets
(`src/tools/settings.ts` — `savedDrawPerPen`) predate the setting and keep rendering
exactly as they do today — **absent means absent** — the tool does not need to know whether
a setting exists.

#### Layer 2 — the runtime: the identity return

`smoothStrokePoints` (`src/tools/brush.ts` — `smoothStrokePoints()`) computes
`pull = clampPercent(smoothing) / 100` and opens with
`if (pull === 0 || points.length < 3) return points;` — returning `points` **itself**, not
a copy. Its consumer is the reason this is a mechanism rather than an optimization:
`drawLine()` in `src/util/draw.ts` reads `const stroke = points === sampled ? params : { ...params, args: { ...params.args, points } };`
and reuses the caller's args object only on identity, so a fresh-but-equal array would add an
allocation to every legacy `draw` stroke and to every stroke whose bar has never been touched.

#### Layer 3 — the pin: `toBe`, never `toEqual`

```ts
// src/tools/__tests__/brush.test.ts — the smoothStrokePoints describe
expect(smoothStrokePoints(zigzagPath, 0)).toBe(zigzagPath);
```

`toBe` is object identity. `toEqual` is structural equality and **would pass** if the
implementation started returning a fresh, equal, freshly-allocated array — exactly the
refactor that silently changes what every unpinned stroke renders from. Four cases in that
same describe pin it with `toBe` rather than `toEqual`, and all four are named: the
`it('leaves the sampled path untouched at 0%')` case above, the
`it('leaves the sampled path untouched at a negative smoothing, which clamps to no pull')`
case, the `it.each` whose cases are `a negative fraction`, `NaN`, `positive Infinity` and
`negative Infinity`, and the `it.each` over 0, 1 and 2 samples that reads "there being no
interior sample". Every one of them is an identity because `clampPercent` guards on
`Number.isFinite` _before_ it clamps, so every non-finite input takes the `: 0` branch.

#### The real risk this defuses: the committed visual-regression baselines

This is what makes the mechanism non-optional. The export visual-regression baselines are
recorded **through the legacy `draw` tool**: `e2e/export/helpers.ts` — `setupExportTest()` does
`await clickToolButton(page, 'draw');` then
`drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y)`, and that is the
fixture for every export baseline. Seventeen committed files live in
`e2e/export/visual-regression.spec.ts-snapshots/export-baselines/` — ten `.png` and seven other
formats. They are compared, not
regenerated: `e2e/export/visual-regression.spec.ts` — `BASELINE_RECORD_MODE` re-records **only** under
`--update-snapshots=all`, and the comment above it documents that a bare truthiness
check used to rewrite the baseline on every run and make the oracle disposable.

So **any change to the legacy raster path invalidates a committed oracle**, and `AGENTS.md`
is unambiguous — "Do not weaken a gate to get green: no skips, no raised thresholds, no
deleted assertions, no re-recorded visual baselines." Re-recording a baseline is a
**recording decision that belongs to the operator**, not to you. The identity return is what
lets you add a Photoshop-faithful setting to three paint tools without ever touching that
oracle.

#### Two caveats, and one of them used to be a defect

**Caveat 1 — the identity branch is now on this base; do not let a refactor drop it.** This
mechanism was written against a base where `drawLine()` had no identity test at all, and that was
recorded here as the reason the whole thing was branch-local and unportable. **That is no longer
true.** `drawLine()` in `src/util/draw.ts` now reads the identity and reuses the caller's args, and
`git grep sampled -- src/util/draw.ts` returns four hits rather than none. If you port the mechanism
to a base that lacks the branch, you must add the identity branch your caller needs; if you are on
this base, the job is to keep it, and the `toBe` pins above are what prove you did.

**Caveat 2 — the identity mechanism protects geometry, not every line you touch.** The change that
introduced it also removed the `else ctx.setLineDash([])` arm from `setupDrawCtx`
(`src/tools/draw.ts` — `setupDrawCtx()`), a shared legacy code path the `draw` tool and the eraser
both call. **That removal did not survive:** `setupDrawCtx()` today writes the pattern
unconditionally, and its comment above that line says why — the overlay context is shared between
strokes and between tools, so an undashed pen must clear the previous stroke's dash. The same
hazard in its **alpha** form is live and pinned: `setupDrawCtx()` deliberately leaves its alpha on
the context, which is why `DrawToolArea.test.tsx` carries the
`it('brackets the stroke so setupDrawCtx cannot leave its alpha on the shared overlay')` case. The
general lesson is the part that survives, and it is not about this branch: **review the whole diff
for changes to shared legacy code, and for each one either prove it inert or hand it off.** The
identity trick is a licence to add a setting, not a licence to refactor a neighbour.

#### Where the blend mode goes, and why it is the same lesson

`Mode` could not ride the stroke. It is a **layer** property, and the layer is created
_before_ the stroke is rasterized — so it is resolved by `createLayerSource()`
(`src/contexts/layer-utils.ts` — `createLayerSource()`, via `toolLayerBlendMode()`) rather than while drawing.
`toolLayerBlendMode(args)` returns `'source-over'` unless `args.toolName` is `brush`,
`pencil` or `color-replacement` — the three `commit: 'raster'` tools at
`src/tools/toolProcessors.ts` — the `brush`, `pencil` and `color-replacement` entries — and then returns
`isPaintBlendMode(args.blendMode) ? args.blendMode : 'source-over'`.

Three things to copy. **It rides the args channel**, so replay re-enters the same function
with the same history entry's args and undo, redo and the durable shadow cannot disagree —
the `create-layer` op carries the whole args object (`DurableLayerSource.args`,
`src/contexts/history-model.ts` — `DurableLayerSource`'s `args: PlainObject`), so both converters already carry it. **The gate is a
hardcoded tool-name list**, so a fourth paint tool must be added there; same allowlist smell
as `layer-operation`, but in a file that is _not_ part of the durable model — a good trade,
and a reminder that the gate belongs as close as possible to the thing that knows the tool
is a paint tool. **The value is a closed set with a Normal fallback**
(`src/tools/brush.ts` — `isPaintBlendMode()`), because
`ctx.globalCompositeOperation = 'dissolve'` is **silently ignored** by the browser rather
than erroring, so a mode from a document written by a build that offered it degrades to
Normal instead of reaching the canvas as a dead operation.

---

### Where the deferred work goes

**Not inline TODOs in source.** A real build in this repo deferred its entire
engine-dependent remainder to **six numbered handoff entries** rather than to `// TODO`
comments — **no new `// TODO` comment was added anywhere in the change.** I could not verify a
repo-level ban on source comments: `AGENTS.md` contains no occurrence of the
word, and `eslint.config.js` sets no comment rule. What _is_ verifiable, and what that build did, is
handoff entries with zero new inline TODOs. Follow the build, not an unverifiable rule.

That build and its handoff are both gone — the branch is in no ref of this repository — so **a
reader can no longer check the six entries or their wording.** What has since landed tells you how
much of that remainder to expect. The stamped-tip renderer is `src/util/brush-engine.ts`, the
`Custom` preset is `CUSTOM_PRESET_LABEL` beside `matchPaintPreset()` in `src/tools/brush.ts`, and
`pointsBoundingPos()` in `src/util/draw.ts` reserves the full `lineWidth` on every side. Still open:
the Pencil's `Auto Erase`, which `Paint.test.tsx` — the
`it('no longer renders the TODO placeholder it replaced')` case — pins as absent; tablet pressure,
which no tool in `src/` reads; and the once-per-stroke `setupDrawCtx()` call, which
`DrawToolArea.tsx` records in a comment above its own single call site. Re-derive the remainder from
the working tree rather than from a list you cannot check.

#### The entry shape

Four parts, in this order. `**Why it is not a wiring bug.**` is the part to write first and two live
entries still carry it — `HANDOFF.md` §151 and §152 — so read either for the shape rather than a
sample:

```markdown
## <N>. <the defect, stated as the claim>

**Problem.** <what is wrong, the named unit on every claim, a grep or a measurement when
checkable, an explicit mention of any test that pins the current behaviour, and a bound on
how reachable it is>

**Why it is not a wiring bug.** <the structural reason a reviewer would otherwise propose
the one-line fix you already rejected. This is the part that stops the next session
re-proposing it.>

**Fix.** <imperative. Name the exact symbol or branch. Say what NOT to do.>

**Files.** `path`, `symbol()`, an action type, or an `it('...')` title
```

`**Why it is not a wiring bug.**` is what separates a real entry from a wish list, and it
is the part to write first. A deleted paint-toolbar entry used it to record that
`buildDrawArgs` (`src/tools/toolProcessors.ts` — `buildDrawArgs()`) narrows `penType` to
`'pen' | 'spray'` and both paint
tools force `'pen'`, so the one per-point painter in the tree is deliberately unreachable
from a brush or a pencil — "That is deliberate — it is the adapter that makes the tools
hard-edged — not an oversight." That narrowing is still exactly what the registry declares.

#### `**Fix — needs a call, not a patch.**`

Use that exact label when the change would break an existing pin and the choice belongs to
the operator. **There is no live instance left.** The entry that carried it — "Six selectable
tools do nothing at all, and the honest fix is five lines" — was deleted on verification, and its
claim is now carried by `docs/TOOLS-TOO-HARD.md` — "What this app does" for the pen family, where
all six are `commit: 'unimplemented'` and the tool-area dispatch closes on the inert
`DummyToolArea`. Either hiding them from `toolbar-mapping.ts` — `availableTools` — or making
`unimplemented` throw a named error is still defensible, and these are the words the deleted entry
used:

> **Fix — needs a call, not a patch.** Two honest options, and the choice is the
> operator's. Either hide the six from `toolbarMap` until they work, or make
> `unimplemented` throw a named error at `src/tools/toolProcessors.ts` — `unimplemented` so selecting one
> fails loudly instead of silently doing nothing. Throwing is the smaller diff and
> converts a silent no-op into a visible one, but it changes seven existing tools'
> behaviour, which is a product decision rather than a cleanup.

Quoted verbatim, including the one name the entry got wrong: there is no `toolbarMap` in this
repository. The file is `toolbar-mapping.ts`, and the list is its `availableTools`.

(An earlier instance about the seeded brush `alpha` was quoted here and is gone: the
options bar landed in `bf96b728` and took the entry with it. A block quote in this file
is not evidence that the words are still in the handoff — re-read the entry.)

Three triggers, all of which you will meet: the fix would remove or re-derive a committed
test pin (`AGENTS.md`: "a pin is a tripwire that fails the moment the defect is fixed, so a
fix must remove the pin in the same change"); or the fix would change a committed
visual-regression baseline (**recording belongs to the operator**); or the fix would widen a
closed union or a hardcoded allowlist in the history files (tiers 2 and 3), or start a
single-writer cutover (`AGENTS.md`'s Architecture status section).

#### Lifecycle and numbering

The lifecycle itself is in `AGENTS.md`: fixed and verified **deletes** the entry, an unverified
fix leaves it alive and tightened, and the handoff edit belongs in the same commit as the work that
produced the finding. What that file does not carry is the numbering discipline: **numbers are
stable identifiers other items cite, so they are never renumbered** — the gaps are entries that
were fixed and deleted. New entries append at EOF after a `---`, taking the next unused number, and
the next number is whatever the tree says it is: read the file, do not trust a number written here.
It also does not carry the collision hazard: a branch's `HANDOFF.md` was written against its own
base, and its items 37-41 are already taken on this base, so porting entries verbatim collides with
live problems. **Re-number against the tree you are on.**

The TS conventions this document relies on, none of which `AGENTS.md` carries: strict, React 19,
no `any`, `satisfies` for registries, no enums, no parameter properties (`erasableSyntaxOnly` in
`tsconfig.app.json`). The
worked example throughout is a raster tool — and it is the shipped `eraser`, so read the snippets as the shape of a
tool, not as a spec of a tool you are about to write.

---

## Phase 4 — implementation

### The processor contract

One entry per tool, in a total registry:

```ts
// src/tools/toolProcessors.ts
export type ToolProcessorDefinition = {
  creator?: boolean;
  commit: ToolCommitKind;
  replay: Readonly<{
    kind: ToolReplayKind;
    deterministic: boolean;
    version: number;
    requiresRaster: boolean;
  }>;
  imageProcessor: (param: ProcessorToolParams | CreatorToolParams) => (args: ToolArgs) => ToolResult;
};

// src/tools/toolProcessors.ts:97-98
const replay = (kind: ToolReplayKind, requiresRaster: boolean, deterministic = true) =>
  Object.freeze({ kind, deterministic, version: 1, requiresRaster });
```

Two-stage currying: the outer call takes `ProcessorToolParams = { size, bitmap }` or `CreatorToolParams = { size }` (`src/tools/toolProcessors.ts` — `ProcessorToolParams` and `CreatorToolParams`), the inner
takes the tool args, and the result is `ToolResult = [BitmapSource, Partial<Pos>?]` (`src/tools/toolProcessors.ts` — `ToolResult`). The registry is total, so adding a name to
`ToolName` is a `tsc` error until the entry exists (`src/tools/toolProcessors.ts` — `toolProcessors` `Record<ToolName, ToolProcessorDefinition>`).

**What each declaration obliges you to.**

- `commit` — the durable-conversion tier. Use `'raster'` for a new drawing tool:
  `src/contexts/useHistory.ts` — the `applyRasterTool` arm then replays it for free. Never write a new
  `DurableOperation` variant for a tool.
- `replay` — mandatory, and reachable only through the frozen factory, so the four fields cannot
  be smuggled in ad hoc. Bump `version` when pixel output changes for the same args.
- `imageProcessor` — copy an existing adapter's shape rather than aliasing a shared one; the
  three paint adapters are the model (`src/tools/toolProcessors.ts` — the `brush`, `pencil` and `color-replacement` entries). A processor that
  narrows `ToolArgs` to its own name needs `// @ts-expect-error Each processor narrows ToolArgs
to its own registered name.`, as `reposition` does at `toolProcessors.ts` — `reposition`'s `// @ts-expect-error` comment; an inline adapter already
  taking the union does not.
- `creator: true` — a **promise** the tool can run with `{ size }` and no bitmap.
  `src/contexts/layer-utils.ts` — `createLayerSource()` calls `imageProcessor({ size: pos } as
CreatorToolParams)(source.args)` and assigns the result to `layer.tmpCanvas`. Without the flag
  the tool cannot create its own layer.
- There is a fifth field the old playbook warned about, `flattenRequired`, and **it no longer
  exists**: it is not in `ToolProcessorDefinition` and nothing in `src/` or `e2e/` mentions it. If
  you are porting a branch that sets it, that is the first thing to delete.

**`requiresRaster` is derived, not declared, and a test enforces it** — the tripwire
against a dishonest declaration:

```ts
// src/tools/__tests__/tool-processors.test.ts:799-803
it.each(toolNames)('derives the %s requiresRaster flag from its commit kind and creator status', (toolName) => {
  const { commit, creator, replay } = toolProcessors[toolName];

  expect(replay.requiresRaster).toBe(commit === 'raster' || (commit === 'selection' && !creator));
});
```

The companion rule at `it('commits every raster processor as a raster-processor replay')` maps `commit: 'raster'` to `replay.kind: 'raster-processor'`, `'unimplemented'` to `'unimplemented'`, and
everything else to `replay.kind === commit`.

A `layer-operation` tool therefore **cannot** declare `requiresRaster: true` without rewriting the test. Four literal rosters in the same
file go red too: `requiresRaster` `it('marks only raster-producing tools as requiring raster')`, non-deterministic `it('marks only unimplemented tools as non-deterministic')`, raster-committed `it('commits every raster processor as a raster-processor replay')`, creators `it('only labels source-creating tools as creators, and each creator commits as a source')`.

### The file set, in dependency order

**Why the order matters.** Steps 1–6 are the _type spine_: each is closed over `ToolName`,
so they fail `npm run tsc` in sequence and the compiler walks you from the union to the last `never`. Steps 7–9 are the
_presentation_ registries — none total, all pinned by a test roster. Steps 10–13 are the new files. Out of order, you get a
tree that typechecks halfway and renders nothing.

| #   | File                                                                    | Purpose                                                       | Anchor that forces the edit                                                                                                      |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/contexts/tool-types.ts`                                            | the args type in `ToolArgsByName`                             | `ToolArgsByName`; `ToolName` derives from it                                                                                     |
| 2   | `src/tools/<myTool>.ts` (new)                                           | args type + the curried processor                             | —                                                                                                                                |
| 3   | `src/tools/toolProcessors.ts`                                           | `commit`, `replay(...)`, optional `creator`, `imageProcessor` | the `toolProcessors` registry's key type `Record<ToolName, …>`                                                                   |
| 4   | `src/tools/toolsMap.ts`                                                 | `{ ...toolProcessors.<myTool>, icon, toolboxComponent }`      | `ToolsMap`; `export const toolsMap` the literal                                                                                  |
| 5   | `src/tools/settings.ts`                                                 | `defaultSettings['<my-tool>']`                                | `defaultSettings`'s `satisfies ToolArgsByName`; `lastSavedSettings: ToolArgsByName`                                              |
| 6   | `src/util/settings.ts`                                                  | the `saveLastSettings` arm                                    | `saveLastSettings()`; inside it, the `never` trap                                                                                |
| 7   | `SidebarLeft/types.ts` + `icons/<Name>Icon.tsx` (new) + `toolIcons.tsx` | the icon, three files                                         | `ToolIconName`; `toolIcons`                                                                                                      |
| 8   | `toolbar-mapping.ts`                                                    | the flyout entry and `availableTools`                         | `toolbarMap`; `availableTools`                                                                                                   |
| 9   | `src/components/Main/Main.tsx`                                          | **four** edits, not one                                       | the `interactionMode` chain; the `ToolAreaComponent` union; the `EventHandler` routing; the overlay canvas's `display` allowlist |
| 10  | `src/components/Main/<My>ToolArea.tsx` (new)                            | the gesture surface                                           | —                                                                                                                                |
| 11  | `src/components/ToolbarsRight/<MyTool>/<MyTool>.tsx` (new)              | the options component                                         | —                                                                                                                                |
| 12  | `src/components/Main/Main.scss`                                         | the cursor class                                              | the `.cursor-*` classes                                                                                                          |
| 13  | `src/components/Common/AppKeyboardShortcuts.tsx`                        | shortcut, registered **twice** (plain + `shift: true`)        | `AppKeyboardShortcuts.tsx` — the group-literal doc comment above `brushGroup` the group literals                                 |

**Step 9 is the one that gets forgotten.** `interactionMode` is a second, unrelated
hand-written chain (`src/components/Main/Main.tsx` — the `interactionMode` chain). A new raster tool with a working `commit: 'raster'` processor missing from it
falls through to `DummyToolArea` (the `EventHandler` default, the terminal `else`), which renders `style={{ display: 'none' }}`. The tool is selectable, the options bar
renders, and nothing happens on the canvas with no warning. Worse, the overlay canvas `display` is a **separate** allowlist (`src/components/Main/Main.tsx` — the tool-overlay canvas's `display` allowlist),
so a preview painted on `toolOverlayRef` stays invisible even when the handlers fire.

**Every exhaustive surface over `ToolName`.** There is no `switch` over `ToolName` anywhere in
`src/` — the exhaustive sites are registries plus two hand-written chains:

- `Record<ToolName, …>`: `src/tools/toolProcessors.ts` — `toolProcessors`, `src/tools/toolsMap.ts` — the `ToolsMap` type and the `toolsMap` literal.
- `satisfies ToolArgsByName`: `src/tools/settings.ts` — `defaultSettings`'s `satisfies ToolArgsByName`; total assignment `defaultSettings`.
- `never` trap in a chain: `src/util/settings.ts` — `saveLastSettings()`'s `never` trap.
- Hand-written chains, **not** compiler-checked, red at runtime instead:
  `src/components/Main/Main.tsx` — the `interactionMode` chain, `src/util/settings.ts` — `saveLastSettings()`.
- Near-total, checked only by a test: `toolbar-mapping.ts` — `availableTools`.
- Hand-copied unions the typecheck cannot see drift in: `src/components/SidebarLeft/types.ts` — `ToolIconName`
  is **not** derived from `ToolName`, and the use site
  `src/components/SidebarLeft/SidebarLeft.tsx` — the unchecked `toolIcons[tool.name]` lookup is an unchecked `toolIcons[tool.name]`, so it
  typechecks only because `ToolName ⊂ ToolIconName` today.

**Single-owner files.** Steps 1, 3, 4, 5, 6, 7, 8, 9 and 13 are small registries every layer edits
and that are positionally coupled to each other. Assign the whole spine to one session. If another session already has one of these open
when you start, **stop and report** rather than editing: a merge of two `toolProcessors.ts` edits is worse than a delay, and `git status`
in a shared worktree is not a lock.

**The board cannot enforce that, and the reason matters.** Board identity is the git branch, and
`holdFiles` refuses only a _foreign_ lock, so two writers in one worktree are the same agent to the
board: both holds are granted and the file reads as uncontended. It is a discipline, not a lock, and
when two writers do collide neither sees it in the board — the symptom is a clobbered index in
someone else's file, not a refusal. Read-only agents may share a worktree freely; a reader mutates
nothing.

**And do not reach for Kilo's `board_read` when you want to know whether anyone is working.** That
tool carries messages between one session and the task children it spawned, so outside a fan-out it
reports `messages: []` truthfully and knows nothing about this repository, and `board_post` about
work in a worktree usually returns `total: 0, active: 0` with a warning that nothing was delivered.
**Neither response is evidence that nobody is working.** The cross-session channel is
`npm run swarm`: `-- claim <id> --files <paths>` before your first edit, `-- check <paths>` before
touching anything a brief or a sibling names, and `-- note` the branch and its paths before you
start integrating. **Claim the merge, not just the files** — a branch about to land carries a
hazard to every path in it, and no file claim expresses that. A held file is a queue, not a
deadlock, and an unclaimed path _looks_ free.

### The gesture contract

The shared primitive is `usePointerPosition` (`src/hooks/usePointerPosition.ts`) — `isPointerDownValid`,
`isPointerMoveValid`, `isPointerUpValid`, `getLocalCoords`, and the `isMouseDown` ref. The first pointer wins and sets
capture, so a second finger is not a second gesture.

The reference lifecycle is `src/components/Main/DrawToolArea.tsx`: **pointerdown** `handlePointerDown()` (validate,
`setupDrawCtx`, seed `pointsRef.current = [coords]`, first paint);
**pointermove** `handlePointerMove()` (bail unless `isMouseDown.current`, push one point, repaint);
**pointerup** `handlePointerUp()` — the **only** commit. There the `canvasToDocumentPoint` conversion puts the points in document
space, `pointsBoundingPos` computes `pos`, the points are rebased by `-pos.x` / `-pos.y`, the single `FullArgs` is built,
exactly one `createLayerFromTool` call follows, and the ref and the overlay are cleared.

**ONE HISTORY STATE PER USER ACTION. Commit on pointer-up, never per pointer-move.** The
store splits preview from publication: `tempUpdateLayer` (`src/contexts/useLayer.ts`) writes a ref-backed preview and dispatches
nothing; only `updateLayerByTool()` or `commitDirtyTool()` publishes a history entry. `updateLayerByTool` itself does
this correctly — preview in its `tempUpdateLayer` call, publish once in its `commitDirtyTool` call — so the rule is enforced by
_which function the tool area calls_, not by anything inside it. Call it on every pointer
move and undo becomes useless.

**Batching.** `DrawToolArea` batches its repaint through a `requestAnimationFrame` and cancels
**and nulls** the ref on pointer-up; a cancelled-but-live ref repaints a
stale frame after the layer commits. Copy that shape.

**Do not neutralise a shared-context defect.** `Main.tsx` — the `toolOverlayRef.current.getContext('2d')` write hands every tool area the same 2D
context, so a painter must call `resetOverlayAlpha` and bracket in `save()` / `restore()`. Do
**not** write `ctx.globalAlpha = 1` at the top of setup as a fix: the commit path runs on a fresh
`OffscreenCanvas` at the slider's alpha, so forcing 1 on the overlay does nothing for the committed layer. A shared rect-drag hook already
exists (`src/hooks/useRect.ts`) with a three-phase contract — `onRepaint` during the drag, `onChange` on resize, `onChangeEnd` after
pointer-up. Use it instead of writing a fourth rect gesture.

### Inherited constraints

Pre-existing properties that decide the _shape_ of new code. Read each before you touch the file it names.

**1. The canvas is padded by the full `lineWidth` on every side and the stroke is committed as its own layer — so the
layer's area scales with `lineWidth²`, not `lineWidth`.** `pointsBoundingPos` (`src/util/draw.ts` — `pointsBoundingPos()`) returns `{ x: minX - lineWidth,
y: minY - lineWidth, width: maxX - minX + 2 * lineWidth, height: maxY - minY + 2 * lineWidth }`.

`createLayerFromTool` (`src/contexts/useLayer.ts` — `createLayerFromTool()`) then makes that `pos` a fresh layer, so a 5000px tip allocates a 10000px square
for a single dot. This is why the shipped bar caps Size at 500 while Photoshop allows 5000:

```ts
// src/tools/brush.ts — the PAINT_SIZE_MIN/PAINT_SIZE_MAX doc comment
/**
 * Photoshop's brush Size range is 1-5000px, but this editor's strokes are rasterized into a
 * canvas padded by the full `lineWidth` on every side (`pointsBoundingPos`,
 * src/util/draw.ts:5-26) and committed as their own layer, so a 5000px tip allocates a 10000px
 * square for a single dot. 1-500 is the ceiling the existing `Draw` bar already uses, and it
 * keeps a stroke's layer proportional to the canvas it was drawn on.
 */
export const PAINT_SIZE_MIN = 1;
export const PAINT_SIZE_MAX = 500;
```

_Defence:_ declare a `*_SIZE_MAX` beside the module's other constants, clamp every entry point
through it, and pin the constant — a value arriving from anywhere else must be capped to the same ceiling the slider enforces.

**2. The layer is created before the stroke is rasterized, so a blend mode has to be
resolved at layer creation, not while drawing.** The literal at `src/contexts/layer-utils.ts` — `createLayerSource()`'s layer literal — is built first (it hard-codes
`blendMode: 'source-over'`); only then does `createLayerSource()`'s `kind === 'tool'` creator branch run the creator:

```ts
// src/contexts/layer-utils.ts:204-217
} else if (kind === 'tool') {
  // and this is a creator tool
  const [canvas, patch] = toolProcessors[source.args.toolName].imageProcessor({ size: pos } as CreatorToolParams)(
    source.args,
  );
  if (patch) layer.pos = { ...layer.pos, ...patch };
  layer.tmpCanvas = canvas;
}
```

_Defence:_ resolve the mode from `source.args` inside the literal, gate the read on the tool names
that actually declare the field, and pin both directions — a paint tool's mode must reach the layer, and a stray `blendMode` key on a text
or shape args object must not decide how that layer composites. Undo, redo and the durable shadow all re-enter this function, so a mode
cached anywhere else makes a second replay disagree with the first.

**3. The legacy `draw` raster path must render byte-for-byte unchanged.** The export baselines in
`e2e/export/visual-regression.spec.ts-snapshots/export-baselines/` were recorded against the current single-path call pattern, and
re-recording is gated on `testInfo.config.updateSnapshots === 'all'` (`e2e/export/visual-regression.spec.ts` — the `testInfo.config.updateSnapshots === BASELINE_RECORD_MODE` guard). `drawPen` is the pattern
they encode:

```ts
// src/util/draw.ts:141-144 — one beginPath, one moveTo, one stroke() for a whole stroke
ctx.beginPath();
ctx.moveTo(points[0].x, points[0].y);
bezierSmoothedLine(ctx, points);
ctx.stroke();
```

_Defence:_ implement any new stroke behaviour as a **point-space filter applied once at the
seam**, not a stamp loop, and have the filter return its input array by identity at the neutral setting so the caller can skip
reallocation. Pin the call counts (`paint-tools.test.ts` — the `it.each(paintToolNames)('strokes %s with the pen renderer, whatever penType the args carry')` call-count assertions). Never widen a threshold or re-record a baseline to
get green.

### The tripwire inventory

Find these **before** writing code. Procedure: (1) `git grep -n "Object.keys(defaultSettings)\|toolNames" src` for every suite that
_derives_ its roster and updates itself; (2) classify each hard-coded roster below and record the decision in the commit body; (3) run
`npm run test` with no behaviour change, so every failure is classified rather than discovered piecemeal.

| Suite                                                                              | Line                                                                                                                                                                                                                                                                                                                                                                | What it pins                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `tool-processors.test.ts`                                                          | `it('marks only raster-producing tools as requiring raster')`, `it('marks only unimplemented tools as non-deterministic')`, `it('commits every raster processor as a raster-processor replay')`, `it('only labels source-creating tools as creators, and each creator commits as a source')`                                                                        | the `requiresRaster`, non-deterministic, raster-committed and creator rosters, each a literal `toEqual` |
| same                                                                               | `it('maps the full tool roster onto the declared commit kinds')`, the `describe('paint tool raster processors')` `run` helper and `stroke` fixture, `it('brush rasterizes a pen stroke at the requested line width')`, that case's single-`stroke()` assertion                                                                                                      | `toolName → commit` for all 29 tools, plus the identity tables                                          |
| same                                                                               | `it('claims no tool for both the placeholder roster and the real options bars')`, `it('shows a TODO badge on the placeholder toolbox components')`                                                                                                                                                                                                                  | the placeholder list, and the TODO-badge test — see case (c)                                            |
| same                                                                               | `it('mirrors every processor entry and adds an icon plus a toolbox component')` (coverage `it('spreads no processor into a pixel-free toolsMap entry')`), `it('never lets two different tools share the same non-unimplemented processor by accident')` (coverage `it('accepts one params argument on every registry entry except the shared unimplemented stub')`) | the dispatch and icon tables                                                                            |
| `src/components/Main/__tests__/Main.toolAreas.test.tsx`                            | `Main.toolAreas.test.tsx` — the `describe('Main tool-area routing')` block                                                                                                                                                                                                                                                                                          | the `interactionMode` routing table                                                                     |
| `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx`               | `ToolbarPlaceholder.test.tsx` — the hand-copied `PLACEHOLDER_TOOLS`                                                                                                                                                                                                                                                                                                 | `PLACEHOLDER_TOOLS`, mirrored by hand                                                                   |
| `src/components/SidebarLeft/__tests__/harness.tsx`                                 | `harness.tsx` — the `vi.mock('../toolIcons.tsx', …)` factory                                                                                                                                                                                                                                                                                                        | `toolIcons` mocked with an explicit per-tool list                                                       |
| `src/components/SidebarLeft/__tests__/toolIcons.test.tsx`; `tool-settings.test.ts` | `toolIcons.test.tsx` — the hand-copied `toolIconNames` array; `tool-settings.test.ts` — the `it('persists every registered tool name, so the chain cannot drop one')` case                                                                                                                                                                                          | a hand-copied `ToolIconName` union; every tool name survives `saveLastSettings`                         |

**Classify each red test into exactly one of three cases.**

- **(a) It pins the correct old behaviour.** Keep it passing; add your row. The common case.
- **(b) It pins a defect.** Invert it, and remove the `it.fails` pin in the same change — a pin is a
  tripwire that fails the moment the defect is fixed. Use `it.fails('...')` plus a `// BUG:`
  marker for anything deliberately left broken.
- **(c) Its only half disappears because you removed the last example of something.** Subtle, and
  it bit a real build.

**Case (c), the worked example.** `tool-processors.test.ts` — the `it('shows a TODO badge on the placeholder toolbox components')` case read:

```ts
it('shows a TODO badge on real placeholders and hides it where the tool is functional', () => {
  const Placeholder = toolsMap['custom-shape'].toolboxComponent;
  const NoBadge = toolsMap.brush.toolboxComponent;
  // ... asserts the badge on the first, and no TODO on the second
});
```

Its "hides" half had exactly one example — the brush, the one tool whose canvas behaviour was real while its bar was still a placeholder.
Give the brush a real bar and that example stops being a placeholder, so the second half became _vacuous_ rather than failing: it would
have passed against a bar that rendered a TODO badge forever.

**The fix for case (c), in order: (1)** delete the dead half — never weaken it into
`expect(true)`; **(2)** rename the test to what it now claims — the reference branch renamed it to `it('shows a TODO badge on the
placeholder toolbox components')` and left a comment naming where the property moved; **(3)** re-assert the lost property where it is now
true, in the new bar's own suite — the reference branch added `it('no longer renders the TODO placeholder it replaced')` to
`Paint.test.tsx` — the `it('no longer renders the TODO placeholder it replaced')` case, asserting both the absence of `TODO` and of every
dead control name. A case-(c) test is not "a test to update" — it is a test whose coverage you are **relocating**. If you cannot name the
new home for the lost property, you deleted a pin.

### Sequencing

One step at a time, verifying each before the next; the full suite comes at step 9.

| Step | Action                                                                                | Scoped run                                                                                      |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1–2  | add the args type to `ToolArgsByName`, then `src/tools/<myTool>.ts` and its pure test | `npm run tsc`, then `npm run test -- src/tools/__tests__/<myTool>.test.ts`                      |
| 3–4  | add the `toolProcessors` entry, then the `toolsMap` entry                             | `npm run tsc && npm run test -- src/tools/__tests__/tool-processors.test.ts`                    |
| 5    | add `defaultSettings` and the `saveLastSettings` arm                                  | `npm run test -- src/tools/__tests__/tool-settings.test.ts src/util/__tests__/settings.test.ts` |
| 6    | add the icon, the `toolbarMap` entry, `availableTools`                                | `npm run test -- src/components/SidebarLeft/__tests__`                                          |
| 7    | write the gesture surface, wire `Main.tsx`                                            | `npm run test -- src/components/Main/__tests__/Main.toolAreas.test.tsx`                         |
| 8    | write the options bar and its component test                                          | `npm run test -- src/components/ToolbarsRight/__tests__`                                        |
| 9    | classify every red test from the inventory                                            | `npm run test`                                                                                  |

---

## Phase 5 — unit tests

`npm run test` is `vitest --run` on `pool: 'vmThreads'`, `maxWorkers: 4` (`vitest.config.ts`); a test that only fails in a full run is
usually the pool. All three templates below are complete and runnable; `<myTool>` is the only substitution, and the bodies are
written against the shipped `eraser` — keep the shape, change the name.

### The three templates

#### Template 1 — a pure module: `src/tools/__tests__/<myTool>.test.ts`

No React, no canvas, no I/O. The module doc comment at the top of the file is the convention: it states what the module owns, which
properties are load-bearing, and why. Imports are `import { describe, expect, it } from 'vitest'` with explicit named imports, relative
paths with the `.ts` extension spelled out, and `import type` on its own line. Use `it.each` for families and `toBe` when the contract is
identity.

```ts
import { describe, expect, it } from 'vitest';

import { clampEraserHardness, ERASER_HARDNESS_DEFAULT, isEraserTarget, matchEraserPreset } from '../eraser.ts';
import { defaultSettings } from '../settings.ts';
import type { EraserPreset } from '../eraser.ts';

/**
 * `src/tools/eraser.ts` is the contract behind the eraser options bar, and it is pure: no React,
 * no canvas, no I/O. These tests pin the values themselves rather than the pixels they produce,
 * and they pin identity results as well as values — that is what a later refactor silently
 * breaks. Three tripwires: `clampEraserHardness` returns its input unchanged in range, so a
 * caller can compare with `toBe` and a fresh-but-equal object would change that (a `NaN` from a
 * cleared number input must clamp to 0, or the stroke renders as a blank layer); `isEraserTarget`
 * is a closed set, because a mode the canvas cannot composite has to be rejected here rather than
 * reaching it, which ignores an unknown `globalCompositeOperation` silently; and
 * `matchEraserPreset` compares floats with an epsilon, so a bare `===` would flip the picker to
 * `Custom` on a value that is a preset to any number of decimals.
 */

const presets: readonly EraserPreset[] = [
  { label: 'Hard Eraser', hardness: 0, target: 'paint' },
  { label: 'Soft Eraser', hardness: 80, target: 'layer' },
];

describe('clampEraserHardness', () => {
  it.each([0, 1, 50, 99, 100])('passes an in-range hardness of %i through unchanged', (value) => {
    expect(clampEraserHardness(value)).toBe(value);
  });

  it('raises a hardness below 0 and lowers one above 100', () => {
    expect(clampEraserHardness(-1)).toBe(0);
    expect(clampEraserHardness(101)).toBe(100);
  });
});

describe('isEraserTarget', () => {
  it.each(['paint', 'layer', 'all-layers'] as const)('accepts the supported target %s', (value) => {
    expect(isEraserTarget(value)).toBe(true);
  });

  it.each([
    ['a Photoshop mode the canvas has no equivalent for', 'Dissolve'],
    ['an erasing operation', 'destination-out'],
    ['the empty string', ''],
    ['a Photoshop label rather than a canvas value', 'Multiply'],
  ])('rejects %s', (_name, value) => {
    // Rejection is what makes the layer seam fall back to Normal. The canvas ignores an
    // unknown `globalCompositeOperation` without erroring, so a value that got through would
    // commit a layer the user believes is blended and that renders as plain source-over.
    expect(isEraserTarget(value)).toBe(false);
  });
});

describe('matchEraserPreset', () => {
  it.each(presets)('names %s when the settings match it', (preset) => {
    expect(matchEraserPreset(presets, preset)).toBe(preset.label);
  });

  it('matches a preset whose hardness is 0 rather than treating 0 as unset', () => {
    // 0 is a real preset value. A truthiness check on the field would make the opening tip
    // unreachable and show `Custom` on a bar sitting on `Hard Eraser`.
    expect(matchEraserPreset(presets, { hardness: 0, target: 'paint' })).toBe('Hard Eraser');
  });

  it('matches within the comparison epsilon and not outside it', () => {
    // `sameNumber` compares with `Math.abs(a - b) < 1e-9` because the bar's values are
    // parsed out of the DOM and divide into decimals.
    expect(matchEraserPreset(presets, { hardness: 0 + 1e-12, target: 'paint' })).toBe('Hard Eraser');
    expect(matchEraserPreset(presets, { hardness: 0 + 1e-8, target: 'paint' })).toBe('');
  });
});

it('seeds the defaults on the Photoshop hardness', () => {
  expect(ERASER_HARDNESS_DEFAULT).toBe(50);
  expect(defaultSettings.eraser.hardness).toBe(ERASER_HARDNESS_DEFAULT);
});
```

#### Template 2 — a context seam: `src/contexts/__tests__/<seam>.test.ts`

Test the pure function at the seam, not the hook above it. The reference model is
`src/contexts/__tests__/layer-utils.blend-mode.test.ts`: it drives the real `createLayerSource` with the
real registry processors and needs no store. **If** a seam genuinely needs the store, mock `useStore` directly with a `vi.hoisted` state
object plus `vi.mock('../StoreContext.tsx', …)` returning a tuple — the shape in template 3. Do **not** use `renderHook` +
`StoreProvider`: the provider pulls in the durable replay/materialization path, which does not survive the test environment.

```ts
/**
 * Pins the seam that carries a tool's Photoshop `Mode` from the options bar into the layer the
 * tool creates. A stroke is committed as a NEW layer through `createLayerFromTool`
 * (`src/contexts/useLayer.ts:219-262`), and both undo/redo and the durable shadow re-enter
 * `createLayerSource` with the same history entry's args (`src/contexts/useHistory.ts:98`). So
 * the mode has to be derivable from the args alone — that, and not from any ambient bar state,
 * is the property this file pins. The fixture processors are the real ones: rasterizing a
 * two-point stroke needs no pixel read-back, so nothing here depends on the reduced canvas
 * context (`src/test/setup.ts:182-190`).
 */

import { describe, expect, it } from 'vitest';

import { createLayerSource } from '../layer-utils.ts';
import type { ToolLayerSource } from '../layer-types.ts';
import type { Pos } from '../general-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { defaultSettings } from '../../tools/settings.ts';

const STROKE_POS: Pos = { x: 1, y: 2, width: 20, height: 10 };

/** A `ToolLayerSource` laid out as `createLayerFromTool` lays one out. */
function toolSource(args: ToolArgs, pos: Pos = STROKE_POS): ToolLayerSource {
  return { kind: 'tool', args, pos: { ...pos } };
}

/** Every field a stroke's layer carries, rebuilt from `src/tools/settings.ts`. */
function eraserArgs(target: string): ToolArgs {
  return {
    ...defaultSettings.eraser,
    target,
    points: [
      { x: 2, y: 3 },
      { x: 12, y: 9 },
    ],
  };
}

it.each(['source-over', 'multiply', 'screen', 'difference', 'luminosity'])('composites a stroke in %s', (mode) => {
  const layer = createLayerSource({ layers: {}, source: toolSource(eraserArgs(mode)) });

  expect(layer.blendMode).toBe(mode);
});

it.each([
  ['a Photoshop mode this renderer cannot express', 'Dissolve'],
  ['a canvas operation that is not a paint mode', 'destination-out'],
  ['a mode name that does not exist', 'not-a-mode'],
  ['a number', 42],
] as [string, unknown][])('composites as Normal rather than %s', (_label, blendMode) => {
  // `ctx.globalCompositeOperation = 'dissolve'` is silently ignored by the browser rather than
  // erroring, so passing an unknown value through would be an invisible defect: the layer would
  // claim a mode nothing applies.
  const layer = createLayerSource({ layers: {}, source: toolSource(eraserArgs(String(blendMode))) });

  expect(layer.blendMode).toBe('source-over');
  expect(layer.blendMode).not.toBe(blendMode);
});

it('produces layers that differ only by id when called twice with the same source', () => {
  // Replay rebuilds the layer from the history entry's args, so a mode cached on the source or
  // on the layer would make a second replay disagree with the first.
  const source = toolSource(eraserArgs('multiply'));

  const first = createLayerSource({ layers: {}, source });
  const second = createLayerSource({ layers: {}, source });

  // Two `vi.fn()`-bearing mock contexts are never `toEqual`, so the freshly staged raster is
  // excluded from the comparison rather than matched by shape.
  expect(first.id).not.toBe(second.id);
  expect({ ...first, id: 'x', tmpCanvas: 'x' }).toEqual({ ...second, id: 'x', tmpCanvas: 'x' });
});
```

#### Template 3 — a component: `src/components/ToolbarsRight/<MyTool>/__tests__/<MyTool>.test.tsx`

Use `vi.hoisted()` factories, never module-level mutation, so module hoisting keeps working. Mock `useCurrentTool` with
**real `useState`** rather than a bare spy: a `patchToolArgs` that does not publish a new args object leaves the readouts
and the preview frozen, and the repo compiles with `babel-plugin-react-compiler`, which memoizes a zero-prop component.

**The two canvas-mock traps that cost a real build two debug cycles.**

1. `installCanvasContextStub` returns a **new mock context on every `getContext` call**
   (`src/test/setup.ts` — `installCanvasContextStub()`). A `last()`-style accessor therefore compares apples to
   oranges the moment the component repaints: the second paint lands on a different object and
   your call count reads zero. Count across **all** captured contexts.
2. The preview canvas's own context is **not** the last one allocated, because the draw path
   allocates an `OffscreenCanvas` through the same stub. Select the preview context by the
   canvas element, never by recency.

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Eraser from '../Eraser.tsx';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { EraserToolArgs } from '../../../../tools/eraser.ts';

const storeState = vi.hoisted(() => ({
  containerRef: { current: null as HTMLDivElement | null },
  totalSize: { width: 800, height: 600 },
}));

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real `patchToolArgs`
 * publishes a new args object back into React state, so the readouts and the preview repaint;
 * a bare spy never does.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', async () => {
  const { useState } = await import('react');
  return {
    useCurrentTool: () => {
      const [toolArgs, setArgs] = useState(toolState.initial);
      return {
        toolArgs,
        setToolArgs: (next: unknown) => {
          toolState.initial = next;
          setArgs(next);
        },
        getToolArgs: (name: string) => ((toolArgs as { toolName: string }).toolName === name ? toolArgs : null),
        patchToolArgs: (name: string, patch: unknown) => {
          mockPatchToolArgs(name, patch);
          const next = { ...(toolArgs as object), ...(patch as object), toolName: name };
          toolState.initial = next;
          setArgs(next);
        },
      };
    },
  };
});

const resetState = () => {
  storeState.totalSize = { width: 800, height: 600 };
  mockPatchToolArgs.mockClear();
  toolState.initial = { ...defaultSettings.eraser } as EraserToolArgs;
};

const lastPatch = () => mockPatchToolArgs.mock.lastCall as ['eraser', Record<string, unknown>] | undefined;

const getHardnessSlider = () => screen.getByLabelText(/Hardness/) as HTMLInputElement;
const getTargetSelect = () => screen.getByLabelText('Target to Erase') as HTMLSelectElement;

/**
 * The global canvas context stub from `src/test/setup.ts` deliberately records nothing about
 * pixels, so the preview is asserted on the calls it made.
 */
const capturePreviewContexts = () => {
  const installed = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation();
  if (!installed) throw new Error('the global canvas context stub from src/test/setup.ts is missing');

  const contexts: CanvasRenderingContext2D[] = [];
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement
  ) {
    const ctx = installed.call(this, '2d') as CanvasRenderingContext2D;
    contexts.push(ctx);
    return ctx;
  });

  return { spy, blits: () => contexts.reduce((n, ctx) => n + vi.mocked(ctx.drawImage).mock.calls.length, 0) };
};

describe('Eraser options bar', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('no longer renders the TODO placeholder it replaced', () => {
    render(<Eraser />);

    // The bar used to be `placeholderTool('Eraser Tool', 'eraser', false)`, which rendered inert
    // option chips and a "TODO: tool behavior not implemented yet." description. Every one of
    // those chip names was a control the renderer could not honour, so their absence is the
    // assertion.
    expect(screen.queryByText('TODO')).not.toBeInTheDocument();
    expect(screen.queryByText(/tool behavior not implemented/)).not.toBeInTheDocument();
    expect(getHardnessSlider()).toBeInTheDocument();
    expect(getTargetSelect()).toBeInTheDocument();
  });

  it('publishes an exact 0 rather than dropping the field', () => {
    render(<Eraser />);

    // `clampEraserHardness` treats an absent value as 0, so a falsy check that dropped a 0
    // would only surface as a stroke that would not stop softening.
    fireEvent.change(getHardnessSlider(), { target: { value: '0' } });

    expect(lastPatch()).toEqual(['eraser', { hardness: 0 }]);
  });

  it('refuses a target the renderer cannot express', () => {
    render(<Eraser />);

    fireEvent.change(getTargetSelect(), { target: { value: 'Dissolve' } });

    expect(mockPatchToolArgs).not.toHaveBeenCalled();
    expect(getTargetSelect()).toHaveValue(defaultSettings.eraser.target);
  });

  it('re-blits the preview when the settings change', () => {
    const { spy, blits } = capturePreviewContexts();
    try {
      render(<Eraser />);
      expect(blits()).toBe(1);

      fireEvent.change(getHardnessSlider(), { target: { value: '60' } });

      // Counted across all captured contexts, not on the last one: the stub hands out a fresh
      // context per `getContext` call (`src/test/setup.ts:211-215`), so a repaint lands on a new
      // object rather than accumulating on the last.
      expect(blits()).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
  });
});
```

The reference model is `src/components/ToolbarsRight/Paint/__tests__/Paint.test.tsx` — its
`describe.each([['Brush', …], ['Pencil', …]])` shape covers two tools that share one bar implementation and must stay independent, and its
closing `it('does not alias one tool settings object into the other')` is worth copying whenever two tools share an args type.

### The mandatory assertions

Each has a failure mode a weaker version of the same test would miss.

**1. The value survives a tool switch — not merely the key.** The key-survives test passed
happily while every setting was being discarded on the same tick. `toolName in lastSavedSettings`
(`src/tools/__tests__/tool-settings.test.ts` — the `it('persists every registered tool name, so the chain cannot drop one')` case) is true for an arm that stores `{ toolName }` and nothing else, so the mandatory
test writes the values, switches to another tool, edits that tool, and switches back:

Editing another tool is what loses the value in production: it replaces the provider's in-memory args, so the switch back has to read
`lastSavedSettings`. Use the existing `switchToTool` helper (`src/util/__tests__/settings.test.ts` — the `switchToTool` helper), which models the real read path
(`cloneSavedToolArgs`, `src/contexts/useCurrentTool.tsx` — `cloneSavedToolArgs()`).

**2. An absent or zero setting renders byte-identically to the legacy path.** Assert the identity
result — `expect(smoothStrokePoints(zigzagPath, 0)).toBe(zigzagPath)` — never equality. The caller branches on `points === sampled` to
avoid allocating a new args object, so an equal-but-fresh array would silently add an allocation to every legacy `draw` stroke; `toEqual`
passes on it, and the legacy render is what breaks.

**3. A call-count invariant.** `beginPath` once, `moveTo` to the first sample once, `stroke()`
once (`paint-tools.test.ts` — the `it.each(paintToolNames)('strokes %s with the pen renderer, whatever penType the args carry')` call-count assertions). A future stamp loop changes the render and the call counts together, so this is
the assertion that makes it fail loudly. Pin it on the real processor, not on a helper that re-derives it.

**4. An unrecognised enum value falls back to a safe default rather than reaching the
renderer.** `ctx.globalCompositeOperation = 'dissolve'` is silently ignored rather than erroring, so a passthrough is an
_invisible_ defect: the layer claims a mode nothing applies. Assert both directions — the fallback, and `not.toBe` the bad
value.

**5. The epsilon guard on a float comparison needs a test that would catch a truthiness bug on
`0`.** `Math.abs(a - b) < 1e-9` is the production comparison; assert it from both sides — `0.42 + 1e-12` matches, `0.42 + 1e-8` does not —
and separately that a preset whose value is `0` still matches, because `preset.smoothing && …` would make every opening tip unreachable
and show `Custom` on a bar sitting on that tip.

**6. The derived-flag invariant from the processor contract** — quoted in full in Phase 4. It
is what makes `requiresRaster` unchoosable.

Two more that are cheap and load-bearing: assert the **absence** rather than the starting value for an early-bail branch
(`expect(canvas.ctx.lineWidth).not.toBe(defaults.lineWidth)`, because `toBe(0)` passes for any input — `paint-tools.test.ts` is the positive form it inverts), and assert
a degenerate input draws nothing while still returning a full-size canvas (`paint-tools.test.ts` — the full-size-canvas assertions in its degenerate-input case).

### Prove each test fails without its fix

**A test that passes either way is worse than no test, because it consumes a maintainer's
trust.** The mutation check is mandatory, not a nicety.

```bash
git status --short          # 1. clean tree, else you cannot prove the restore
npm run test -- src/tools/__tests__/eraser.test.ts
git diff > /tmp/mutation.patch       # 2. write the edit down before neutering it
npm run test -- src/tools/__tests__/eraser.test.ts   #    and RECORD THE FAILURE COUNT
git checkout -- src/tools/eraser.ts
git apply --check /tmp/mutation.patch   # 4. restore byte-exact, then prove it
git status --short                       #    must be empty again
npm run test -- src/tools/__tests__/eraser.test.ts
```

`git status --short` empty on both sides of step 4 is the proof of a byte-exact restore. If it lists anything, you left residue: the
revert is not reproducible and the next reviewer cannot repeat your result.

**What it costs, and what to write down.** On the reference build, reverting the single
persistence arm in `src/util/settings.ts` turned **7 tests red**, and dropping the single `smoothStrokePoints` call from
`src/util/draw.ts` turned **5 red**. Both numbers belong in the commit body: "I wrote tests" is a claim, "7 of them fail without the fix"
is evidence. A throwaway mutant e2e spec — one that deleted a stroke and asserted the pixel count fell — is the same check one level up:
it proved the pixel assertions _could_ fail at all, because a deleted stroke made the wait time out rather than passing quietly.

**Report format**, one block per guarded behaviour, in the commit body:

```
Mutation check:
- src/util/settings.ts paint arm reverted -> 7 tests red (settings.test.ts, tool-settings.test.ts)
- smoothStrokePoints dropped from src/util/draw.ts -> 5 tests red (brush.test.ts, paint-tools.test.ts)
- git status --short empty before and after each revert
```

This is the shape the repo already uses: `docs/handoffs/ps-transform-geometry-review-and-merge.md` §"3.9 Test quality" records "Every new test was
proven to **fail against the pre-fix code** (20 failures when the old `homography.ts` was restored; restored afterwards)." Two failures to
refuse. A test that passes against the revert is not evidence — delete or strengthen it. A test that fails for the _wrong_ reason (a
`TypeError` from the revert rather than an assertion) proves the revert was fatal, not that the test guards the behaviour; read the
failure message before recording the number.

### Commands

Scoped runs while you work, from the repo root, and the neighbouring suites a change must not disturb — named explicitly rather than by
glob, because a glob over `src/tools` pulls in suites that share nothing with your tool:

```bash
npm run test -- src/tools/__tests__/eraser.test.ts  # the pure module; likewise the seam and the bar's siblings
npm run test -- src/tools/__tests__/tool-processors.test.ts \
                 src/tools/__tests__/tool-settings.test.ts \
                 src/tools/__tests__/paint-tools.test.ts \
                 src/util/__tests__/settings.test.ts \
                 src/util/__tests__/draw.test.ts \
                 src/components/SidebarLeft/__tests__ \
                 src/components/Main/__tests__/Main.toolAreas.test.tsx \
                 src/components/ToolbarHorizontal/__tests__/ToolbarHorizontal.test.tsx
npm run tsc          # the only trustworthy typecheck: `tsc -b` also covers the test files
npm run test         # the full suite
npm run lint:check
```

---

## Phase 6 — e2e

`npm run test:e2e` is headless and starts Vite itself. `e2e/**` is excluded from `npm run test`,
and `**/__tests__/**` plus `*.unit.test.ts` are excluded from Playwright (`AGENTS.md`, "Test traps"). A
Playwright spec run in jsdom, or an e2e helper test run in a browser, fails in a way that looks like
a product bug.

### The browser rule

`AGENTS.md` carries the rule, the blocked-command table and the reason, and they are binding: the
suite is headless, and a headed browser puts a live window on the operator's screen for the whole
run, where their own input reaches the page as real input. Reproduce the rule in every brief you
dispatch; do not restate the table.

What the rule costs, and why it is not a preference: a headed run fails a **disjoint** set of
specs from a headless one. The disjoint sets were the CDP specs that derived an expected size
from the device pixel ratio (which pass headless) against the CDP specs with an explicit
`deviceScaleFactor: 2` (which pass headed). Both are fixed, and the fix was to remove the scale
assertion rather than re-derive it, so the sets are now empty **by construction, not by
observation** — the helper that read the device pixel ratio is gone, and
`cdp-helpers.unit.test.ts` — the `it('does not restate the deviceScaleFactor multiplication the sibling spec disproved')` and `it('states the mechanism the sibling spec measured instead')` cases pin that it stays gone. If
something only reproduces visually, that is the operator's call — name the command and stop
there. `docs/TESTING.md` — the "DO NOT "FIX" A FAILURE BY FLIPPING THE MODE" paragraph is the authority for the rule.

Read a failure from disk, never a viewer: `screenshot: 'only-on-failure'` puts a PNG in the failing
test's `outputDir` under `test-results/`, and the `list` reporter on stdout is the pass/fail record
(`playwright.config.ts`).

### The brief template

The canonical instance is the brief that produced the shipped paint spec
(`e2e/paint-options.spec.ts` — its `test.describe('Brush and Pencil options bar')`, nine tests). It is the
best e2e brief written in this repo because it removes every guess the subagent would otherwise
make. Fill it in; do not abbreviate it.

```markdown
Write ONE new Playwright spec file for the repo at `<ABSOLUTE WORKTREE PATH>`. You may create/edit
files; do not touch any other file. Do not commit.

## HARD RULES (read `<ABSOLUTE WORKTREE PATH>/AGENTS.md` first and follow it)

- **NEVER open a browser window** — no `--headed`, `--ui`, `--debug`, `show-report`, `show-trace`,
  `codegen`, or the headed opt-in variable. `npm run test:e2e` only, which is headless.
- You do NOT need to pick a port to avoid a collision: `npm run test:e2e` finds a free one per run
  and it is impossible to attach to another checkout's server. Pin one only to run two suites on
  this machine at once — `PLAYWRIGHT_PORT=<PORT> npx playwright test e2e/<file>.spec.ts` — and run
  it from the worktree root.
- Do NOT weaken a gate: no `test.skip`, no raised thresholds, no `expect.soft` in place of a hard
  assert, no deleting an assertion to make something pass. If a test genuinely cannot pass, report
  that back instead of skipping it.
- Nothing under `e2e/` may import from `src/`.
- Prettier is single quotes / 120 columns. Run `npx prettier --write <your file>` before finishing.

## THE FEATURE UNDER TEST (already implemented and unit-tested; do not change it)

`<ONE PARAGRAPH: what the feature is, where it renders, what file IS the contract.>`

Controls it renders, in order, each a `<label htmlFor>` wrapping a control, so each has an
accessible name of the form `"<Label> <value suffix>"` (or just `"<Label>"` with no suffix):

| Control  | element              | id         | label text                   | accessible name example  | range/values                     |
| -------- | -------------------- | ---------- | ---------------------------- | ------------------------ | -------------------------------- |
| `<Name>` | `<select>`           | `<dom-id>` | `<Label>`                    | `<Name>`                 | `<values>`                       |
| `<Name>` | `<input type=range>` | `<dom-id>` | `<Label>` + `<span>` readout | `<Name> <default><unit>` | min `<n>`, max `<n>`, step `<n>` |

For the `<sibling tool>` the ids are prefixed `<prefix>-` and the values are `<values>`.

**Critical locator guidance.** The bar renders only when the store has `hasImage` and a `toolName`,
and it is `max-md:hidden`, so the default 1280x720 viewport is fine. The workspace canvas is found
ONLY by `getWorkspaceCanvas(page)` — never `page.locator('canvas')`, **because the options bar
mounts its own preview canvas and a positional lookup would grab that one.** The repo's convention
for options-bar controls is a role + accessible-name locator, exactly as
`e2e/levels.spec.ts:71-75,103-104` does: **match the LABEL PART ONLY with a regex, because the
accessible name carries a live value suffix that changes as you drag.** So use
`page.getByRole('slider', { name: /^<Label>/ })` and `page.getByRole('combobox', { name: '<Label>' })`.

`<Explain how to enter and leave the tool: is it its group's primary tool, so a plain
clickToolButton selects it without opening the flyout, or is it secondary and must come out of
openToolFlyout/selectFromFlyout? Name the helper and the tool.>`

## FILES TO READ FIRST

- `<the closest existing spec>` — the closest template. Match its import order, its
  `SCREAMING_SNAKE` module constants, its named wait strategies, its `beforeEach` shape.
- `<the model spec>` — the model for a labelled `<input type=range>`, and the comment convention
  for why the label part alone is matched.
- `<the naming spec>` — `test.describe` and test-title style (lowercase behavioural sentence, a
  one-line `//` comment naming the tool).
- `e2e/helpers/canvas-helpers.ts` — `<list the exact exports the spec needs, by name>`.
- `e2e/helpers/canvas-redraw.ts` — `waitForCanvasPixels`, `canvasRedrawClip`.
- `e2e/helpers/cdp-helpers.ts` — `captureCanvasScreenshot`.
- `e2e/README.md` — the authoritative rules. Obey every one.
- `e2e/OPEN_PROBLEMS.md` — read the whole file. Name the entries that bite THIS spec, by heading
  and by the line that carries the rule.

## WHAT TO WRITE

Create `e2e/<file>.spec.ts` with `test.describe('<Describe>', ...)`. Write these <N> tests, each
with a one-line `//` comment naming the tool under test:

1. **`<test title>`** — <what to select, what to assert, WHICH CONTRACT the assertion pins, and
   the locator and helper call. Not just the intent.>
2. ... one numbered item per test, same shape.

<Then: what a test must NOT do, as a prohibition. Worked example: "Use a hard assert with a
message. Synchronise with `waitForCanvasPixels`/`hasDarkPixels` (or `waitForCanvasRedraw`) before
each screenshot — never a bare `waitForTimeout` after a draw. Guard the measured bounds: if
`getDarkPixelBounds` returns null, throw a named error rather than asserting on it." Then: any
assertion that must NOT hardcode a count, with the reason. Worked example: "Do not hardcode a count
that would drift; assert against the options the select actually exposes.">

## VERIFY BEFORE REPORTING

From the worktree root: `PLAYWRIGHT_PORT=<PORT> npx playwright test e2e/<file>.spec.ts`,
`npm run tsc`, `npx eslint e2e/<file>.spec.ts`, `npx prettier --check e2e/<file>.spec.ts`. All four
must be clean; iterate until they are. If a test cannot pass without weakening it, LEAVE IT FAILING
and report exactly which assertion fails and what you observed.

## REPORT BACK

One message: (1) the file created with its line count; (2) the exact final Playwright summary line
(e.g. `6 passed (12.3s)`); (3) the tsc / eslint / prettier results; (4) for each of the <N> tests,
one line on what it asserts and how; (5) anything you could not make pass, with evidence.
```

Four devices in that template are load-bearing and are why it worked. **The control table** — the
_accessible name example_ column turns "the label is `Size`" into "the accessible name is
`Size 10px`", the string the locator must match, and is what stops the subagent guessing. **Locator
traps each with the reason attached** — a trap without a reason gets worked around instead of
obeyed. **What to do when a test cannot pass** — "LEAVE IT FAILING and report exactly which
assertion fails" is the only sentence that prevents a green bar bought with a skip. **The report-back
contract** — an exact final summary line, not "tests pass": the orchestrator re-runs the gates
anyway, and what it needs is the number to compare against.

### What an e2e spec for a new tool must prove

The six shapes a paint-tool bar actually used. Draw from this menu; do not invent a seventh.

**1 — controls exposed, with their seeded defaults.** The contract: the bar mounts and
`defaultSettings` reached the readout. The readout is the label text, so asserting the accessible
name proves the seeded default reached both the control and the text a user reads beside it. Take
the expected value from `src/tools/settings.ts`, not from the component, and say in the brief which
line it came from. Use `toHaveAccessibleName`, not `toHaveValue`: a `<input type=range>` carries the
value, but the _readout_ is a sibling `<span>` inside the label, and the readout is what a user
reads.

**2 — a second sibling tool has its OWN defaults.** The contract: settings are per-tool, not one
shared bar state. Select a second tool from the same flyout group and assert its size is _its_
seeded value, not the first tool's. Without this, "the bar renders" and "the settings are per-tool"
are indistinguishable, and one shared bar state passes the whole file. The brief must supply that
second default explicitly; the subagent cannot derive it.

**3 — a control value reaches the raster, not just the readout.** The contract: the arg reached the
processor. Two strokes on **two different rows**, one at a small setting and one at a large one,
then measure. Derive rows as a fraction of the box (`Math.round(box.height * 0.3)` and `0.7`) so
the clips never overlap at any viewport, and size each clip for the tip that drew it — a 4px tip
fits in ±40 of its row, a 60px one needs ±80. Assert a **ratio**, not a pixel count: the tip is
authored in image pixels but measured in capture pixels, so its apparent width also carries the
canvas scale and the host's device pixel ratio. A ratio holds wherever that lands, and 3x of
headroom still fails loudly if the control stops reaching the raster.

**4 — the settings SURVIVE A TOOL SWITCH.** The contract: the persistence contract in
`src/util/settings.ts`. Set every control to a distinctive value, switch to an unrelated tool,
**assert the bar is `toBeHidden()`** (this pins that it really unmounted, so the round trip below
is not asserting against a bar that never went away), switch back, then assert both the control
values _and_ the readouts. The readout assertion is the other half: the value a user reads has to
follow the control, not only the control's own state.

**5 — every option in a dynamic select is selectable.** The contract: the option list is wired, not
decorative. Read the options the select **actually exposes**, assert that list against the source
constant, then `selectOption` each and assert the value:

```ts
const rendered = await mode.locator('option').evaluateAll((options) =>
  options.map((option) => ({
    label: option.textContent ?? '',
    value: (option as HTMLOptionElement).value,
  }))
);
expect(rendered, 'the Mode select must expose exactly the blend modes the paint tools define, in order').toEqual(
  PAINT_BLEND_MODES
);
```

**Never assert a hardcoded count** — a count drifts the first time someone adds an option, and the
drift is invisible. The label/value pairing is copied from the source constant rather than imported,
because nothing under `e2e/` may import from `src/` (`tsconfig.e2e.json` has no `paths` alias into
the app; `e2e/README.md` — the "No `paths` alias and no `jsx`" bullet). The duplication is deliberate: a mode added to the source list
fails the equality assertion instead of silently going untested. Leave the bar on its default at the
end.

**6 — a regression tripwire: the bar carries no `TODO` placeholder text.** The contract: no
regression back to the placeholder component. `ToolbarHorizontal` renders a
`TODO: unregistered tool placeholder` strip for a tool with no `toolboxComponent`, so without this
one line a regression to a placeholder bar is silent.

**The synchronisation rule.** Never a bare `waitForTimeout` after a draw. `waitForCanvasPixels`
(`e2e/helpers/canvas-helpers.ts` — `waitForCanvasPixels()`) is the single poll loop — 10 s timeout, 100 ms interval
(`CANVAS_REDRAW_TIMEOUT_MS` and `CANVAS_REDRAW_POLL_INTERVAL_MS`) — and every other wait in the file is a specialisation of it, so the timeout, the
interval and the error wording can only be changed in one place. Pass a named `description`: the
timeout error prints `Canvas did not render <description> within 10000ms`. `waitForCanvasRedraw`
(`waitForCanvasRedraw()`) is the dark-pixel specialisation. Two refinements the shipped spec added: a low-opacity or
light stroke is **invisible to `hasDarkPixels`**, which times out on a stroke that landed — write a
`CanvasPixelPredicate` polling for "no longer near-white" at the clip centre via
`getColorAtPoint(..., { ignoreNearWhite: true })`; and **re-measure the canvas box after the panel
opens, and re-take the pre-change reading through that same rect**, because opening an options bar
reflows the workspace and a box measured before the switch describes a different region of the
page — so two readings through two rects are not a comparison at all
(`e2e/levels.spec.ts` — `readRedLine()`).

**Clip and coordinate helpers.** `takeLineScreenshot(page, box, name, testInfo, clip?)`
(`canvas-helpers.ts` — `takeLineScreenshot()`) is the `page.screenshot` path; `captureCanvasScreenshot(page, box,
testInfo, name, clip?)` (`e2e/helpers/cdp-helpers.ts` — `captureCanvasScreenshot()`) is the CDP path. Pass `name` as a
**single path component** — a bare filename, with no separator and neither `.` nor `..`. The CDP path rejects anything
else before it creates the directory or opens a CDP session, so a bad name is an error naming the helper rather than a
file written somewhere else; the guard's own docblock is the home for why it rejects rather than sanitises
(`cdp-helpers.ts` — the "So `name` has to be a single path component" comment). **Never divide by `devicePixelRatio`** —
and note that rule lives in a comment, not a guard (`cdp-helpers.ts` — the "do not divide by devicePixelRatio" comment), so a future change can
delete the reasoning without deleting anything that fails. Downstream code derives the scale from
the decoded image dimensions instead, via `screenshotBoundsToCss` (`canvas-helpers.ts` — `screenshotBoundsToCss()`) and
`screenshot-scale.ts` (`screenshot-scale.ts` — `imagePointToCss()`, `cssPointToImage()`, `imageBoundsToCss()`).

### Traps

`e2e/OPEN_PROBLEMS.md` holds latent e2e defects — ones no current run trips but that a new spec can
walk into. **Read it before investigating any e2e failure, and do not re-introduce a known defect**
(`AGENTS.md`, "E2E failures"). On the default headless run nothing fails (`e2e/OPEN_PROBLEMS.md` §"Observed failures"), so a new
failure is a new defect, never a known one. Characterised, not listed:

1. **Empty input flowing into arithmetic.** `screenshotBoundsToCss` (`canvas-helpers.ts` — `screenshotBoundsToCss()`) and
   `imagePointToCss` / `cssPointToImage` divide by the image or box dimension, so a zero-sized
   input yields `NaN` or `Infinity` instead of throwing — deliberately, so the modules stay
   branch-free and total, and it is pinned (`e2e/OPEN_PROBLEMS.md` §"P3 — zero-sized image yields `NaN` edges"). A `NaN` coordinate
   reaching `page.mouse.click` is opaque. **Reject a null or empty bounds result before you
   measure**, and throw a named error rather than asserting on it. The same class hides in the CDP
   helper: an empty `data` decodes to a zero-byte buffer that is written, attached and returned as
   a successful capture (`captureCanvasScreenshot()`'s "check the DECODED length" block), a response with no `data` surfaces as a raw `TypeError` from
   `Buffer` (`captureCanvasScreenshot()`'s missing-`data` error), and a failing `cdp.detach()` replaces the capture error and destroys the
   cause (`captureCanvasScreenshot()`'s `finally` / `cdp.detach()`). Check the **decoded length**, not just the field.

2. **The positional canvas fallback.** `getWorkspaceCanvas` is `page.getByTestId('workspace-canvas')`
   and nothing else (`canvas-helpers.ts` — `getWorkspaceCanvas()`). The removed `.or(nth(1))` was never a priority —
   `.or()` returns a union, so with the test id present the locator resolved to 2 elements and every
   `boundingBox()` raised a strict-mode violation; and the index was wrong anyway, because the Draw
   toolbar mounts a preview canvas ahead of the workspace and unmounting it on a tool switch shifted
   the index onto a hidden overlay (`canvas-helpers.ts` — `getWorkspaceCanvas()`, `e2e/README.md` — the `getWorkspaceCanvas` single-selector paragraph). That was
   `e2e/levels.spec.ts` — its `getWorkspaceCanvas()` lookups before the test id landed (`e2e/OPEN_PROBLEMS.md` — the `e2e/levels.spec.ts` row of the fixed-defects table ("canvas found by test id, not document order")).
   **`getWorkspaceCanvas` is deliberately a single-selector locator so it can only ever match one
   element.** A tool whose own bar mounts a preview canvas makes the same trap reachable through a
   _new_ path, which is why the brief names it explicitly.

3. **The CDP capture-size assertion, and why it was mode-dependent.** The specs derived the expected
   capture size from `window.devicePixelRatio`, but the capture scale is neither a function of that
   value nor of the emulated ratio — it belongs to Chrome. The contract was **removed rather than
   re-derived** and replaced with assertions that hold everywhere: exact rect, one integral scale on
   both axes, correct pixels, no rescaling of the helper's own output (`e2e/README.md` — the `captureCanvasScreenshot at an emulated deviceScaleFactor of 2` status row).
   Each was mutation-tested. A new CDP capture assertion must not name a scale.

4. **The keyboard flyout race.** "The flyout closes asynchronously" was the reading this defect got
   stuck at. The real mechanism is a `requestAnimationFrame` focus handover — the app focuses the
   flyout's first item from a rAF in the tool button's keydown handler, not in the React commit that
   mounts the menu, so "the menu is visible" and "an item holds focus" are two moments one animation
   frame apart (`e2e/OPEN_PROBLEMS.md` — the `e2e/sidebar-keyboard.spec.ts` row of the `Observed failures` table). Over 12 runs: 5 of 12 failures waiting on
   visibility, 0 of 12 waiting on the promised item's focus. **Use `openToolFlyoutViaKeyboard`
   (`e2e/helpers/toolbar-helpers.ts` — the keyboard flyout opener, which the file does not export: it has only `openToolFlyout()` and `waitForFlyout()`), never `waitForFlyout()` alone** — the right-click path never
   focuses an item, so a shared assertion breaks it. And `ArrowUp` focuses the **last** item, so a
   single `.first()` assertion is simply wrong for that key. This entry is filed under
   `## Fixed — Enter did not reliably close the flyout` (a heading that is not in `e2e/OPEN_PROBLEMS.md` today), not among the open latents.

5. **The port race, and what a run can silently attach to.** `playwright.config.ts` — the `PLAYWRIGHT_PORT` read takes the
   port from `PLAYWRIGHT_PORT`, defaulting to 5173, and `playwright.config.ts` — makes `reuseExistingServer` an
   unconditional `false` with `--strictPort` on the server command. `npm run test:e2e` allocates a
   port per run, verifies it, and records it, so even the bare `npx playwright test` now FAILS loudly
   on an occupied port instead of attaching. An older version of this file made reuse opt-**in**;
   that opt-in was withdrawn, because an escape hatch that attaches to whatever holds the port is
   the same defect with a documented name. Where every
   worktree runs `npm run dev` on the same port, that is frequently a **sibling worktree's server**.
   The failure it produced was a strict-mode violation for a test id that existed only in the
   sibling's uncommitted tree, and it pointed at a locator bug in this worktree's helpers. The
   fix landed without the `served-app.ts` layer it originally proposed — that file does not exist.
   What replaced "prove which checkout answered" is that there is nothing left to prove: every run
   starts its own server on a port it picks. The original note is on the unmerged
   `ps-integration:e2e/OPEN_PROBLEMS.md` §"P1 — a run could test a
   different checkout's application", a **not-yet-merged reference**. **Set `PLAYWRIGHT_PORT` in
   every worktree**, and put it in the brief so a subagent cannot forget.

One more latent entry: a nearly transparent pixel counts at full weight in `dominantRed`
(`canvas-helpers.ts` — `dominantRed()`) and `getColorAtPoint` (`canvas-helpers.ts` — `getColorAtPoint()`), so a light or translucent stroke makes a
colour assertion worthless (`e2e/OPEN_PROBLEMS.md` §"P3 — transparent pixels weighted as fully opaque (low confidence)"). **Do not weaken a
gate to get green:** no skips, no raised thresholds, no deleted assertions, no re-recorded visual
baselines (`AGENTS.md`, "Gates" and "E2E failures").

### Visual regression

Baselines live in `e2e/export/visual-regression.spec.ts-snapshots/export-baselines/`, resolved
through `testInfo.snapshotDir` rather than `snapshotPath()` so a baseline committed on one machine
does not read as missing on another (`e2e/README.md` — the `testInfo.snapshotDir` paragraph under "Baseline layout"). The directory holds 17 committed
files; 7 are read, one per format in `browserVerifiedFormats` (`drawing.png.png`, `.jpeg`, `.webp`,
`.svg`, `.bmp`, `.gif`, `.avif`); the other 10 are orphans nothing references
(`e2e/OPEN_PROBLEMS.md` §"P3 — 10 orphaned committed baselines (2.1 MB)"). `.gitattributes:14` marks the snapshot tree `binary` so
line-ending normalisation can never rewrite the committed pixels.

**A green run means the pixels matched** — only because the record-vs-compare branch is gated on
`testInfo.config.updateSnapshots === 'all'`
(`e2e/export/visual-regression.spec.ts` — the `testInfo.config.updateSnapshots === BASELINE_RECORD_MODE` guard). It used to
be `if (testInfo.config.updateSnapshots)`, and Playwright's default for that option is the string
`'missing'`, which is **truthy** — so every run re-recorded the committed baseline and returned
before `compareScreenshots`, and the comparison below it was unreachable. The 7 formats were a
no-op reporting success, invisible because re-encoding the same export produced byte-identical
files (`visual-regression.spec.ts` — the same record-vs-compare guard, `e2e/MIGRATION-TODO.md` — the "Not asked for, and worth knowing — the visual-regression gate was void" paragraph). Budgets are `threshold:
0.01` and `maxDiffPixels: 100` at the call site (the "100 pixels is a tripwire, not a tolerance" comment at the call site), defaulting to `DEFAULT_THRESHOLD = 0.2` /
`DEFAULT_MAX_DIFF_PIXELS = 100` / `DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01`
(`e2e/helpers/image-comparison.ts` — `DEFAULT_THRESHOLD` / `DEFAULT_MAX_DIFF_PIXELS` / `DEFAULT_MAX_DIFF_PIXEL_RATIO`); read the call site rather than assuming a budget.

**100 pixels is a tripwire, not a tolerance, and the argument is at the call site.** It is 0.021% of
an 800x600 baseline, four of the seven compared formats are lossy (JPEG, WebP, GIF, AVIF), and the
browser's encoder — not the app — decides their last digits. A Chrome, libjpeg or libavif bump is
therefore a hard red on a blocking gate; **widening either number is the wrong repair**, because at
`maxDiffPixels: 4800` the suite passes a visibly different picture. The Chrome version is **not**
pinned in `ci.yml` on purpose: nothing in the repository records which Chrome produced the committed
baselines, so a pin is a guess, and a wrong pin turns a green gate red for an undiagnosable reason.
The failure message prints `browser.version()` so the first triage question is answerable from the
run.

**Re-recording requires `--update-snapshots=all` (`npm run test:e2e:update-baselines`) and
is a recording decision that belongs to the operator.** The `=all` is not decoration: Playwright
declares the flag with `preset: 'changed'`, so the **bare** flag resolves to `'changed'` and
re-records nothing — and `'changed'` could not help even if it did, because this spec reads its
baseline with `readFile` rather than through a snapshot assertion. The script carried the bare
flag for as long as this document did, and the two no-opped together
(`visual-regression.spec.ts` — the "A bare truthiness check on `updateSnapshots` was the first defect here" comment). A missing baseline attaches the export and then throws on
purpose: the comparison was never made (`visual-regression.spec.ts` — the throw a missing baseline reaches).

**The baselines were recorded through the legacy `draw` tool**, so any change to the legacy raster
path invalidates them — `e2e/export/helpers.ts` — `setupExportTest()` is the evidence, since it
clicks the `draw` tool and draws a line before every export baseline. When a new paint engine changes stroke rendering, check that tripwire list before
touching a baseline.

#### Subagent model fields

`task` takes `model`, `provider` and `variant`, and **`provider` must be sent together with
`model`**. Omitting it inherits the current turn's model, and a bare model name can resolve
through the Kilo Gateway onto a paid id. Three rules ride with that, and the first has no
exception:

- **A free session must never launch a GPT subagent.** Every GPT model is paid, and the failure is
  an `APIError: Add credits to continue` at zero tokens — the subagent dies before it does
  anything, and the orchestrator that launched it was itself free.
- **The default is `model: 'Space Bunny Alpha (retires Oct 5)', provider: 'kilo', variant: 'max'`.** The
  `variant: 'max'` pairing is the one to copy for anything adversarial or architecture-shaped.
- **`agent_manager` inherits the current turn's model** unless both `model` and `provider` are set,
  so a main turn on a paid model silently spawns paid worktrees.

**Do not copy a qualified id.** A brief that passes `model: 'kilo/stealth/space-bunny-alpha'` with
no `provider` is exactly the shape that fell through to `~openai/gpt-luna-latest` on 2026-09-28 and
killed both subagents in under a second. Audit the live session database before spawning a fleet
rather than after one has died:

```bash
sqlite3 ~/.local/share/kilo/kilo.db "SELECT id, model, parent_id, title FROM session WHERE json_extract(data,'$.model') IS NOT NULL ORDER BY time_updated DESC LIMIT 20"
```

And every subagent you send **inherits your working directory**: create the worktree before the
fan-out, never after it, and put the **absolute** path in every brief — a subagent's cwd only
affects relative `bash`, while its `edit` and `write` calls take absolute paths, so the brief is
what moves the work.

### The rule that actually matters

A tool's spine is a small set of **single-owner** files, and it is not a set you can fan out. The
registries and hand-written lists a new tool edits are the same files every layer touches _and_ are
positionally coupled to each other. Two agents editing `toolProcessors.ts` and `toolsMap.ts` will
conflict; an agent editing the toolbar mapping and another editing the e2e flyout test ids produce
tests that pass locally and fail after merge. The coupling is compile-enforced in places (the
`never` trap in `src/util/settings.ts`; the `satisfies ToolArgsByName` closure), which means the
collision surfaces as a _misleading_ error in someone else's file, not as a merge conflict.

**Keep the whole spine with the orchestrator.** It is a handful of small edits; it is also the part
with all the cross-file coupling and all the traps, and the orchestrator is the only holder of the
context that makes the edit correct.

### When to keep the delicate work inline

The orchestrator that shipped the brush bar wrote **the two most delicate tests itself and delegated
the rest**. The reason is two words: precision plus context already held. Those two tests depended
on decisions made minutes earlier — on why a control was labelled the way it was.

> **Delegate work whose correct shape is fully determined by files the subagent can read. Keep
> inline work whose correct shape depends on a decision made in the last few minutes of your own
> context.**

Concretely, keep inline: the assertion that pins a contract you just designed; anything reading a
constant you introduced two steps ago; anything where a plausible alternative exists and the choice
is not recoverable from the code. Delegate: research, recon, independent file sets, mechanical test
expansions, and everything with a stated file list.

**The fan-out pattern.** Three at once for independent files; six at once for research and recon,
where nothing is written into the app tree. The recorded shapes here: ten parallel research agents,
one per tool family, each writing a single markdown deliverable and read-only on `src/`; then four
recon sweeps by concern; then digest agents that could not write files and returned their output as
the final message; then a review wave of four adversarial reviewers, one per change, after the
implementation landed. Two "re-emit your digest exactly as you originally produced it" agents existed
because a result had been truncated — see _Two failure shapes_.

### The split that does work

| Agent              | Owns                                                                   | Blocked by                                |
| ------------------ | ---------------------------------------------------------------------- | ----------------------------------------- |
| **research**       | one markdown deliverable per tool family, read-only on the source tree | nothing; runs first                       |
| **repo recon**     | one concern per agent, exhaustive, every claim `file:line`             | nothing; parallel with research           |
| **implementation** | one file-set per agent, disjoint by construction                       | the research digest                       |
| **spine**          | the registry files — **stays with the orchestrator**                   | the agents that declared names and shapes |
| **tests**          | one test file per agent                                                | the implementation                        |
| **e2e**            | one spec per agent, with the full brief above                          | the spine                                 |
| **review**         | adversarial, per change, after the implementation lands                | everything                                |

Research, recon and digest are genuinely parallel and touch nothing shared. The spine is a narrow
integration step between the wide waves, and that serialisation **is the plan**, not a limitation of
it. A digest agent that cannot write files must be told so explicitly — "return the digest as your
final message text only", with a word cap.

### The brief skeleton

The recovered structure, from the coordinator's implementation briefs. A subagent has a fresh
context; every section exists because omitting it cost a round trip.

````markdown
You are <ROLE> for <REPO>, at `<ABSOLUTE WORKTREE PATH>`, a git worktree of the main repo with full
read/write rights on the source tree.

## Read these first, in order

1. `<ABSOLUTE PATH>/<plan>.md` — <what it is, which section>
2. `<ABSOLUTE PATH>/<plan>.md` — <what it is, which section>
3. `<ABSOLUTE PATH>/AGENTS.md` — the binding repo rules

<Absolute paths, not relative. `.kilo` is gitignored (`.gitignore:49`), so it is not carried into a
fresh worktree: a plan that exists in one checkout must be named by absolute path, or the subagent
will read a file that is not there.>

## Your task: <GOAL STATEMENT — one paragraph, imperative, bounded>

<Scope boundary in the same paragraph: "Do NOT start <phase>. Do not re-architect anything. Stay
inside the scope below.">

### Step N — <DEFECT TITLE>

`<path>:<line>` currently is:

```ts
<the exact current code, quoted inline>
```

<Why that is wrong, in one or two sentences, with the mechanism.>
Fix: <imperative; name the exact symbol or branch; say what NOT to do.>

### Step N+1 — <DEFECT TITLE>

<the same shape, one defect at a time>

## Do NOT change / you own ONLY these paths

- <path A> — <why>
- <path B> — <why>
  Do NOT touch <path C>: <reason — another task is editing it concurrently>. Never revert unrelated
  changes you find there; the worktree is shared.

## Constraints you must respect

Established project decisions, stated in `<plan>` under "<SECTION>". Honour all of them. Most
relevant here: <constraint>; <constraint>.

## Conventions

- <repo convention, with the path that demonstrates it>
- <the comment rule, verbatim: "DO NOT add any comments in source code unless they are `// BUG:`
  markers or otherwise strictly necessary. The repo's style is comment-free.">

## Verification

From the repo root: `npm run lint:check`, `npm run tsc` (report the real exit code, not a pipe),
`npm run test`. All three must pass. If a test fails because it was asserting a documented bug, fix
or invert the test per the plan — do not weaken an assertion to make it pass.

## Deliverable

Report back: (1) the changes made, one line each, with `file:line`; (2) the exact before/after test
counts; (3) confirmation that every verification command is clean; (4) anything that contradicts the
plan documents — <the research disproved N of its own premises>, so treat the plan as a well-sourced
hypothesis, not gospel, and if something is wrong say so with evidence rather than implementing it;
(5) what you deliberately did NOT do, and why.

Do not commit. Do not create a branch. Leave the changes in the working tree for review.
````

Two parts carry more weight than the rest. **The "Do NOT change" section is the boundary that must
be stated, not assumed** — a branch told to _report_ rather than edit `layer-renderer.ts` /
`useLayer.ts` / `materialization.ts` / `history-replay.ts` still has several live defects it found,
because the boundary is where the work stopped; a subagent told nothing edits whatever it finds.
**The "treat the plan as a well-sourced hypothesis" clause is what makes a wrong brief survivable**,
and it worked. On a five-defect brief, a worker reported that defect 2's premise was false:
`setupDrawCtx`'s spray guard is not a colour-destroying bug, because `drawSpray` reads
`args.alpha` / `args.color` / `args.lineWidth` directly and never reads the context state the guard
skips. The proposed fix would have been a no-op at best and an **alpha-squaring bug at worst**,
since `drawSpray` already embeds alpha in the gradient and `globalAlpha` would multiply it again.
It did not implement it: it wrote a test locking in the current correct behaviour and reported the
disproof with evidence. A second worker did the same on a different step, finding a `try`/`finally`
the brief had missed and concluding that code needed no change at all.

### The review wave

Run it **after** the implementation lands, one adversarial reviewer per change, in parallel. The
framing is what makes it useful: "You are doing a RIGOROUS code review. Be adversarial: your job is
to find defects, not to praise." A reviewer asked what is good produces praise.

An adversarial review brief must contain:

- **The exact diff command**, so the reviewer sees what changed and not what the author remembers —
  plus **the untracked file list**, because new files do not appear in `git diff`.
- **What the change was supposed to do**, enumerated. "Did it do the right thing" is unanswerable
  without the intent, and the intent is the thing most likely to have been wrong.
- **A per-guard removal proof.** For each guard, test branch or pin: _"tell me what happens if that
  one guard is removed — does its test fail? tell me the actual result, not the intended one."_ The
  **actual** result is the load-bearing word: a reviewer asked what a test _should_ do returns the
  author's belief.
- **Named failure modes to check**, not vague ones. The recorded briefs asked questions whose
  answers mattered: does `getImageData` alias the backing store (which would make tests pass when
  they should fail); is `getImageData()` with no args handled; does making `filter` functional change
  which path `src/util/selection.ts` — the `ctx.clip()` comment and the non-zero-winding note now takes, given its "Fall through to CPU rasterization
  for tests" comment implies the mock deliberately omits `getImageData`.
- **A scope-and-conventions audit as its own reviewer**, because scope creep is invisible to a
  correctness reviewer.
- **An output format with a hard word cap**, ordered by severity, `file:line` on every claim, an
  instruction never to guess a line number that was not read, and a verdict field: safe to land
  as-is, safe after the listed fixes, or needs rework.

**The orchestrator's obligation is to re-verify every load-bearing claim itself before acting.** A
review finding is a candidate result, not a fact. In the recorded campaign the coordinator
re-verified the promoted findings and found **two of its own claims wrong**, and one that had
already caused an implementation to cement a false premise — a test written to lock in behaviour
that did not exist, which then reads as a regression guard. So: take the finding, re-read the cited
lines yourself, and where the claim is load-bearing reproduce it — run the mutation, run the test. If
it does not hold, correct it on the board with evidence and tell the worker before it builds on the
wrong premise.

Three defects with zero fix-detection value were found by exactly this pass and named as deletions:
an assertion that read the mock's own default because nothing ever set it; a test comparing two code
paths that were identical by construction and would pass if one were deleted outright; and an
assertion that re-read the registry argument it was supposed to check — a tautology over its own
setup. **A test that passes with the fix reverted is worse than no test: it consumes a maintainer's
trust.**

### Sometimes reimplementing beats reconciling

When two branches independently implemented the same feature, the cost is rarely the code — it is
deciding, line by line, which of two sets of intentions was right, in a checkout other sessions are
committing into. Weigh that against writing the feature once, correctly, against the real
requirement. **This is a first-class option, not a last resort**, and it is a `hard-merge`
decision: `.skills/hard-merge.md` Phase 0 is where the tool is chosen, and its Phase 6 gate admits a
declared reimplementation alongside a union, a graft and a third design.

**If the requirement is genuinely unclear, that cost is not worth paying at all.** Recover the
requirement first — by meaning, not by id, and from Adobe's own documentation when the transcript
runs out — and only then choose between reconciling and rebuilding. A reimplementation decided on a
guessed requirement is a rewrite of the guess.

### Two failure shapes

**The zero-file idle worker.** A worker dispatched on a four-defect brief went idle having written
**zero** files. The brief was not wrong; it was too large for one dispatch. The re-dispatch that
worked reduced it to **one small self-contained task, with absolute paths, exactly two files, an
explicit instruction to start editing, and an exact number to report**:

```markdown
Fix <N> failing tests. You may EDIT ONLY these two files, by absolute path:

- <ABSOLUTE PATH>/<A>.test.tsx
- <ABSOLUTE PATH>/<B>.test.tsx

Do NOT edit any production file. Do NOT add skips, delete tests, or weaken assertions that still
guard real behaviour. Do not run e2e.

Run all commands with workdir <ABSOLUTE WORKTREE PATH>.

THE <N> FAILING TESTS (stale pins on the old <behaviour>):

- <A>.test.tsx > "<exact test name>"
- <B>.test.tsx > "<exact test name>"

WHAT CHANGED: <one paragraph — the behaviour that moved, and where the new contract lives.>

STEP 1 — <the first concrete change, with the file:line and the exact shape.>
STEP 2 — <the second, same shape.>
STEP 3 — <the one that is not a straight swap; say explicitly: "If the actual behaviour differs
from this description, TRUST THE CODE and report the discrepancy in your final message.">

VERIFY (all must pass, report exact output): `npx vitest run <the two files>`;
`npm run test` (full suite — report the final summary line); `npm run tsc ; npm run lint:check`.

Final message must contain: the exact assertions you changed per test, the full-suite summary line,
tsc and lint results, and any place where real behaviour surprised you.
```

The devices that make it work, in order of how much they mattered:

- **Two files, named by absolute path.** Not "the tool-area tests". A relative path in a fresh
  context is a guess, and a wrong guess is a worker that edits something else.
- **The exact test names, quoted.** The worker goes to a known line instead of hunting a failure.
- **"TRUST THE CODE and report the discrepancy."** This converts a stale brief from a wrong
  implementation into a reported one.
- **An exact count to report.** A worker with a number has a stopping condition; a worker asked to
  "report when done" stops when it feels done.
- **One task.** If it returns having done one and not the other, re-dispatch the other. Do not
  re-issue the original. Escalate the other way too: when a brief genuinely needs several files but
  one job, say "you MAY create ONE new test file under <dir> if that is cleaner than extending the
  two above" — bounded but not false.

**The over-large result that returns truncated.** A subagent's final message is capped, and a result
that exceeds the cap comes back **truncated**, which reads exactly like a short answer. The
tool-output spill directory holds the full payload, as
`~/.local/share/kilo/tool-output/tool_<partId>`. Recover it with `grep` plus a byte offset, or —
cheaper and more reliable — dispatch a **re-emit agent** whose whole brief is: `Re-emit your full
<topic> digest as your final message, exactly as you originally produced it. Do not re-research; just
output the text you already have.` Both shapes were used in this repo's history, and the re-emit
agent is the one to reach for first: a `grep` over a JSON spill file costs a context window, a
re-emit costs one turn.

---

## Phase 8 — gates

The command list, the local-versus-CI split, and the lifecycle of each hook are in `AGENTS.md`.
This section carries only the parts a tool author cannot read off that file.

### 8.1 What the commands do not tell you

**There is no `npm run audit` script** — do not invent one; CI runs the binary directly. **Do not
reason from timings** to decide what belongs on a hook: every wall-clock figure written into a
doc or a hook comment in this repo has gone stale. Decide from what each gate answers.

### 8.2 The typecheck trap

**`npm run tsc` is the only trustworthy typecheck**, and the reason is in the tree: `tsconfig.json` — the `files: []` solution stub, whose own comment says a bare `npx tsc` / `npx tsc --noEmit` "resolves zero input files and always exits 0 — that is the design, not a defect". `tsc -b` builds its three references, and only `tsconfig.e2e.json` — its `include` array includes `e2e/**/*.ts` — so nothing but `tsc -b` type-checks a Playwright spec or an e2e helper unit file.

`--force` is **not** required: `tsconfig.app.json` — the comment above `tsBuildInfoFile` states that with `noEmit: true` and no `composite`, `tsc -b` re-checks the project on every run, and `tsconfig.node.json` — the comment above `tsBuildInfoFile` says the same for the node project. Note also `tsconfig.app.json` — its `include` array is `"include": ["src", "toolbar-mapping.ts"]` — the root-level file is listed explicitly because `src` does not match it and it would otherwise enter the program only through its importers. A new root-level `.ts` needs the same treatment, or CI's coverage assertion fails.

### 8.3 What the hooks leave out

The commit gate runs **no app unit test and no e2e helper test**, and the absence of the second is
new: `test:e2e:unit` was moved to CI, where the separate blocking `e2e-unit` job already ran it.
The pre-push hook does not repeat `gate:commit` either: a push can follow a
`git commit --no-verify`, a rebase, or a cherry-pick, and re-running deterministic checks at
push is how a gate gets `--no-verify`'d along with everything else.

`core.hooksPath` points at a generated dispatcher in the common git dir;
`scripts/install-git-hooks.js` installs it from the `prepare` script. If a hook is not firing,
check `git config core.hooksPath` before assuming the gate passed.

### 8.4 Order, and what counts as a red flag

```bash
npm run tsc                                    # type errors first: cheapest to fix
npm run lint:check                             # formatting + lint, whole tree
npm run test                                   # jsdom: 0 failed AND no lost test files
npm run test:e2e:unit                         # node-env helper tests
npm run build                                 # bundler-only failures (sass, wasm, PostCSS)
PLAYWRIGHT_PORT=5199 npm run test:e2e          # headless, last: slowest, most environmental
```

- **The `Test Files` count DECREASED** versus the branch point. A decreased count with 0 failures
  means files were deleted or renamed out of the glob: "a merge that silently drops test files is
  a failed merge."
- **`prettier --check` failing on the two files you just wrote.** This happened for real. It is not
  a preference — the commit hook blocks on it. Run `npm run format`, read the diff, re-stage.
- **A new test that passes with its fix reverted.** Revert one file, re-run, record the failure
  count, restore. A test that passes either way consumes a maintainer's trust and is worse than no
  test.
- **An e2e failure you cannot find in `e2e/OPEN_PROBLEMS.md`.** No pass/skip count is recorded in
  `AGENTS.md` any more; the count lives in `e2e/OPEN_PROBLEMS.md` §"Observed failures", and the skips are listed
  in the same file.

### 8.5 CI jobs

Two things in `ci.yml` are not visible from the job list. The "every tracked `.ts`/`.tsx` is inside
some project's `include`" step is a real constraint — a new file no project includes is
type-checked by nothing, with no error anywhere. Scope it correctly, though: `tsc -b --listFiles`
catches a file no project reaches but **not** one reachable only through its importers. And there
are no coverage thresholds anywhere (`vitest.config.ts` — its `coverage` block, which declares no thresholds, `vitest.e2e.config.ts` — its `coverage` block);
`--coverage` is for the report, not a percentage gate. Dependency licence terms are not checked by
CI; the README's dependency licensing note distinguishes that gap from `npm audit`, which checks
vulnerability advisories.

### 8.6 The one rule

**Never weaken a gate to get green**: no skips, no raised thresholds, no deleted assertions, no
re-recorded visual baselines. The export baselines are genuinely compared now:
`e2e/export/visual-regression.spec.ts` — the record-vs-compare guard gates re-recording on
`testInfo.config.updateSnapshots === 'all'` — the exact string, because Playwright's default is the
truthy string `'missing'` and the earlier truthiness check always re-recorded and returned before
the comparison (`e2e/MIGRATION-TODO.md` §"Not asked for, and worth knowing — the visual-regression gate was void"). Re-record only with
`npm run test:e2e:update-baselines`, which passes `--update-snapshots=all` — the bare flag
resolves to `'changed'` and re-records nothing. It is an operator decision.

---

## Phase 9 — the handoff doc

Routing by scope, the delete-never-reword lifecycle and "validate, do not summarise" are in
`AGENTS.md`. This section is the part that file does not carry: the shape each of the three
documents takes, and the scope error that puts a tool defect in the wrong one.

### Where the handoff goes

**`.kilo/plans/` is gitignored, so a plan there does not ship with the code, and a handoff doc that
does not ship is lost.** `.gitignore` matches `.kilo`, and therefore `.kilo/plans`:

```bash
$ git check-ignore -v .kilo/plans
.gitignore:49:.kilo	.kilo/plans
```

Run that before writing. A plan in `.kilo/plans/` is a working document on one machine; a finding
worth keeping goes somewhere tracked. Three tracked homes, and they are **not interchangeable**:

| File                                | Holds                                                            | Shape                                                                                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HANDOFF.md`                        | the cross-session problem list for the history/presentation work | `## <N>. [P0] — <claim stated as the defect>`, then `**Problem.**` / `**Fix.**` / `**Files.**`                                                                                                                                               |
| `e2e/OPEN_PROBLEMS.md`              | unfixed defects **in the test code**                             | `## P<N> — <defect as a claim>` → a bare `file:line` line with no label → prose proving it → `Fix: <imperative, and say what not to do>` → `Pinned by \`<test name>\` (\`:line\`) in \`<file>\`. A fix removes that pin in the same change.` |
| `docs/handoffs/<branch>-<topic>.md` | the per-task record: decisions not derivable from the code       | unnumbered sections; the one example is `ps-transform-geometry-review-and-merge.md`                                                                                                                                                          |

Severity in `e2e/OPEN_PROBLEMS.md`: **P1** = a wrong or misleading pass/fail, **P2** = latent
breakage or unmaintainable, **P3** = cosmetic/robustness.

Putting a tool plan in `HANDOFF.md` is a category error; putting an unfixed e2e defect in
`docs/handoffs/` is a category error. `HANDOFF.md` scopes itself to the durable-replay migration
and the presentation/append boundary — "tool features and visual fidelity are out of scope unless
a defect is caused by this work" — so **a new tool-feature defect is not a `HANDOFF.md` entry**; it
belongs in `docs/handoffs/<branch>-<topic>.md`.

**Numbering.** `HANDOFF.md` item numbers are stable identifiers other items cite, so they are
**never renumbered** — the gaps are entries that were fixed and deleted. New entries append at EOF
after a `---`, taking the next unused number, and the next number is whatever the tree says it is:
read the file, do not trust a number written here.

**`docs/handoffs/<branch>-<topic>.md` conventions**, from the one existing example: provenance front
matter (the sessions that owned it, which directed it, which plans governed it, and a warning that
those plans are gitignored and exist only on this machine); a table of defects **as assigned vs.
status after review**; untracked work flagged explicitly by name and by what it is the only proof
of; the test-quality statement (every new test proven to fail against pre-fix code, with the failure
count); and a pickup checklist, imperative. Write one of these at the end of every tool task — it is
the only document that captures decisions not derivable from the code.

### The entry shape

Four parts, plus two conditional fields:

```markdown
## <N>. <claim, stated as the defect — a claim about what is wrong, not a topic>

**Problem.** <what is wrong, with `file:line` on every claim, a grep or a measurement when
checkable, an explicit pin mention, a bound on reachability.>

**Why it is not a wiring bug.** <ONLY when the obvious first reading is "just wire the field up".
Name the machinery that does not exist and quote it.>

**Fix.** <imperative; name the exact symbol or branch; say what NOT to do.>

**Tripwires that must be removed in the same change, not weakened.** <ONLY when a unit test or a
baseline pins the current behaviour. Name the test and the assertion.>

**Files.** `path`, `path:line`, `path:line`

---
```

Two conditional headers, both in real use. **`**Fix — needs a call, not a patch.**`** when the fix is
a product decision rather than an implementation: state the options and their consequences, do not
prescribe the answer — that is the operator's decision, not a subagent's.
**`**Why it is not a wiring bug.**`** the field that makes a tool-parity finding survive a review
that starts by trying to wire it.

**The worked example** is a six-entry paint handoff that shipped in `bf96b728` and was deleted from
`HANDOFF.md` when its fixes landed. Six entries, all tool-parity problems the e2e spec and the unit
tests could not catch because they are _about_ the renderer's shape rather than any one control.
**The entries are quoted from that commit, not from the current handoff** — `HANDOFF.md` is now
numbered 0–182 with gaps and does not contain them, and **the branch they were written on is in no
ref of this repository, so a reader can no longer check the other four.** One fix is real and
checkable: `src/components/ToolbarsRight/Brush/Brush.tsx` is three lines that delegate to
`createPaintToolbar` in `src/components/ToolbarsRight/Paint/Paint.tsx`, which is exactly the
representation item 36 said was missing. Item 36 carried the four-part form plus the tripwire field:

> **## 36. The Brush Settings panel has no representation in the renderer**
>
> **Problem.** `drawPen` (`src/util/draw.ts`) issues one `beginPath`, one `moveTo` and one
> `stroke()` for a whole stroke: the pen nib travels continuously along a path, and there is no dab
> loop and no per-dab compositing to modulate. Every remaining Photoshop paint control is defined in
> terms of a stamped tip, so none of them can be reached by wiring a field into the args — Hardness
> needs a radial edge-falloff kernel, Spacing needs arc-length resampling between stamps, Flow needs
> per-dab accumulation, and none of those exist on a single path.
>
> **Why it is not a wiring bug.** `buildDrawArgs` (`src/tools/toolProcessors.ts` — `buildDrawArgs()`) narrows
> `penType` to `'pen' | 'spray'` and both paint tools force `'pen'` (`src/tools/toolProcessors.ts` — the `brush` and `pencil` entries' `buildDrawArgs(args, 'pen', …)` calls), so the one
> per-point painter in the tree, `drawSpray` (`src/util/draw.ts` — `drawSpray()`), is unreachable from a
> brush or a pencil. That is deliberate — it is the adapter that makes the tools hard-edged — not an
> oversight.
>
> **Fix.** Replace the single-path stroke with a stamp loop: build a tip bitmap (falloff from
> Hardness, affine from Angle/Roundness/Flip), walk the path by Spacing, and composite each dab with
> Flow accumulating into a stroke buffer. Do this in a new module rather than in `drawPen`, and have
> both paint processors call it, so `draw` keeps its existing vector behaviour.
>
> **Tripwires that must be removed in the same change, not weakened.**
> `src/tools/__tests__/paint-tools.test.ts` pins `beginPath` called exactly once and `stroke()`
> called exactly once for a brush or pencil stroke (the `strokes %s with the pen renderer` case), and
> `createRadialGradient` once per sample for the spray path. A stamp loop fails all three.
> `e2e/export/visual-regression.spec.ts` baselines were recorded through the `draw` tool and are
> unaffected as long as `draw` is left alone.
>
> **Files.** `src/util/draw.ts` — the stroke renderers `drawLine()`, `drawPen()` and `drawSpray()`, `src/tools/toolProcessors.ts` — `buildDrawArgs()`,
> `src/tools/__tests__/paint-tools.test.ts` (the three call-count pins)

Item 41 carries the **needs-a-call** variant. Note what it does: it identifies the pin, says the
behaviour is "a decision, not an oversight, and it is not obviously the right one", and hands the
choice back without changing the pin or deleting the entry. **Its defect is still open on `main`**,
which is why the entry is worth reading: the seeded brush is `alpha: 0.9, smoothing: 10,
lineWidth: 10` (`src/tools/settings.ts` — the seeded `brush` default) and `Hard Round` is `alpha: 1,
smoothing: 0` (`src/tools/brush.ts` — `PAINT_PRESETS`), so `matchPaintPreset()` returns `''` and the
bar opens on `Custom`. `brush.test.ts` — the `it('reads a freshly seeded paint bar as Custom')`
case — pins that, so the choice has been made and recorded rather than left open.

> **## 41. The brush bar opens on `Custom`, not on a preset, because the seeded opacity is 0.9**
>
> **Problem.** `matchPaintPreset` compares all four settings with a `1e-9` epsilon and returns `''` —
> rendered as `Custom` — unless all four match. The seeded brush is `alpha: 0.9, smoothing: 10,
lineWidth: 10, blendMode: 'source-over'` (`src/tools/settings.ts` — the seeded `brush` default) and the closest preset,
> `Hard Round`, is `alpha: 1, smoothing: 0` (`src/tools/brush.ts`). So a freshly selected brush
> claims to be a hand-tuned combination, and `Hard Round` silently snaps opacity to 100% and
> smoothing to 0 — two settings the user did not ask to change.
>
> **Fix — needs a call, not a patch.** Either raise the seeded `alpha` to 1 and re-derive that pin, or
> add a preset matching the seeded defaults exactly and rename `Hard Round` to something that does
> not promise a 100%-opaque hard edge. The first is closer to Photoshop and changes every committed
> document's default stroke; the second changes nothing outside the bar.
>
> **Files.** `src/tools/brush.ts` (`PAINT_PRESETS`, `matchPaintPreset`),
> `src/tools/settings.ts` — the seeded `brush` default, `src/tools/__tests__/paint-tools.test.ts` (the
> `applies the default alpha and line width` case)

The other four cover the range the same shape reaches: **37** the Pencil's `Auto Erase` does not
exist, with a `**Why it is not a wiring bug.**` naming that no paint tool reads a source bitmap;
**38** tablet pressure cannot reach the renderer, naming that `pressure` is read nowhere in
production code and that a mouse reporting none must render exactly as Photoshop does with no
tablet; **39** `pointsBoundingPos` pads by `lineWidth` per side, harmless until the tip can be
elliptical; **40** `setupDrawCtx` runs once per stroke, so the live overlay ignores mid-stroke
setting changes — with the honest note that no current control can be exercised that way and it
becomes live the moment one is bound to a pointer-held modifier.

### Verify every citation before you commit the handoff

**Mandatory, and a scripted pass, not a read-through.** The real numbers from the branch that
shipped the paint handoff: a **scripted bulk citation check found several `file:line` off**, because
the agent's own import had shifted every line below it, and a subsequent `grep -n` pass fixed them.
One added import moves every line beneath it in that file, and a handoff entry is mostly `file:line`
in files the agent just edited — precisely the set where the shift is largest.

Procedure, in order:

1. **Extract every `file:line`** in the entry, including bare ranges (`src/util/draw.ts:‹lines›`).
2. **`grep -n` each one** and read the actual line. Check the **substance**, not the arithmetic:
   confirm the line is still inside the construct you claim, not merely that a line exists there.
3. **Re-derive the range from the code**, not from memory. Read the function; find its real first
   and last line.
4. **Check every quoted snippet still exists verbatim.** A snippet that moved is a snippet that was
   retyped, and a retyped snippet is a fabrication waiting to be noticed.
5. **Check every cross-reference** — a cited `HANDOFF.md` item number, "item 36", a quoted test
   name. A renamed test breaks the pin reference that makes the entry actionable.
6. **Re-check after the last edit.** A handoff written early and updated late is stale in exactly
   the places you edited last. Do this as the final step before committing.

A stale line number is not neutral: the next session spends a full investigation on a bug that is
already gone, or worse "fixes" a line that has nothing to do with it (`AGENTS.md`,
`AGENTS.md` §"NO LINE NUMBERS IN PROSE — EVER"). The discipline the working `HANDOFF.md` states about itself, and that your entry
inherits:

> **Re-derive a citation from the sentence that contains it, never from the old number**, and
> treat every citation in a file you have not just read as unverified. (`HANDOFF.md` — the entry that names its own citation drift and counts the stale citations,
> where that file names its own citation drift as a standing defect and quantifies it)

**Dropped, not softened.** A claim that does not survive verification is deleted from the entry. It
does not become a hedged sentence.

### The same rule for the other docs

The rule is not scoped to `HANDOFF.md`. **A change that invalidates a count or a claim in another
doc fixes it in the same commit.**

- **A passing-test count is a real one that went stale.** `e2e/OPEN_PROBLEMS.md` §"Observed failures" reads "97 pass,
  2 are skipped by declaration", and `e2e/README.md` — the export-baseline tree listing, which no longer carries the passing-test count
  still carries the justification the count was drawn from ("2–4 of the 97 tests failed for
  documented reasons"). Every one moves the moment a test is added — which is why
  `e2e/README.md` — the `e2e-unit` command block points at the three commands instead of restating the numbers, and why
  `e2e/OPEN_PROBLEMS.md` — the preamble paragraph beginning "The numbers this file used to open with" now says plainly: "The numbers this file used to open with — tests
  passed, expected-fail pins, files, mode-specific failure sets — were each a snapshot of one tree,
  and each has been wrong since it was written while the number beside it stayed silent."
- **A claim about a gate is a real one.** `e2e/README.md` — the "It is a **blocking** gate" paragraph, which no longer says `continue-on-error: true` still says the `e2e` job "is
  still marked `continue-on-error: true`" and leaves "flipping `continue-on-error` to `false`" as
  the thing left to do. It is not: the job was promoted, and `.github/workflows/ci.yml` — the `e2e` job's "It was `continue-on-error: true`" comment
  documents the promotion and why the old justification had stopped describing the suite.
  `AGENTS.md` already carries the new claim. **The README is the stale one** — fix it in the same
  commit that promotes the job, not three commits later.
- **A claim about the number of orphans, of pins, of files** moves the same way.
- **The trigger:** before committing any change, ask what it made untrue elsewhere — a promoted
  gate, a deleted entry, a removed helper, a changed test count. Then fix that too, in the same
  commit.

---

## Phase 10 — integration

Branches merge **leaf → integration line → `main`**, with `--no-ff`, and the full gate re-run after **each** merge, never batched (`08-merge-plan.md` §"3. Merge order").

### 10.1 Before you stage

Beyond reading `git status` / `git diff` and staging explicit paths, two commands earn their place
here because they answer questions the status line does not:

```bash
git log --oneline main..HEAD   # exactly what you are proposing, and nothing you inherited
git diff --cached --stat       # what you are about to commit, under this message
```

The lesson from the last integration campaign: four worktrees branched from one base, `main` moved
substantially underneath them, and each branch was validated **in isolation** — so a green suite in
a leaf says nothing about whether it still applies to today's `main`. Fast-forward onto current
`main` first, one branch at a time.

### 10.2 Commit shape

Conventional Commits with a scope and a body that explains the _why_ (`git log --oneline -30`): `gates: …`, `docs(e2e): …`, `merge: 15 review branches from the untouched-code campaign`, `test(e2e): accept the File > New unsaved-changes confirm in setupIcoTest`, `fix(colors): re-anchor the CSS filter curve …`. Merge commits use the default `Merge branch '<x>' into '<y>'` form. The handoff edit belongs in the **same commit** as the work that produced the finding; a handoff that trails by one commit is a finding that survives one fast-forward without context.

### 10.3 The pre-commit hook rewrites your files — re-verify after

`lint-staged` runs `eslint --fix` then `prettier --write` on every staged `.ts`/`.tsx` (`package.json` — its `lint-staged` block). With `--fail-on-changes` the commit is **blocked** and the fix stays in the working tree:

```bash
git add <paths>
git commit -m "..."        # hook may block with lint-staged output
git diff                   # read what eslint --fix and prettier --write changed
git add <paths>            # stage the fix, deliberately, having read it
git commit                 # now it passes
```

A blocked commit has not staged the fix, but it has not lost it. The second round is the point: you read the formatter's output before it lands. Never reach for `--no-verify`.

### 10.4 One gate per merge

```bash
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<integration-line>
git merge --no-ff <leaf-branch>
npm run tsc && npm run lint:check && npm run test && npm run test:e2e:unit
npm run build
PLAYWRIGHT_PORT=5199 npm run test:e2e
```

Batching merges and then debugging four sets of failures at once is what `08-merge-plan.md` §"5. Cross-cutting state at merge time" — the "Rebase onto current main BEFORE merging, one worktree at a time" bullet explicitly warns against; the full gate after each merge is what makes "which merge broke it" answerable. The model is `f534335`, "merge: 15 review branches from the untouched-code campaign": 15 `rev2/*` leaves into `rev2/integration`, then that line into `main` with a body listing the highlights, the gates run, and the pin delta. The handoff doc ships inside the merge.

Integration lines here were `rev2/integration`, `history/integration` and `cleanup/integration`, and
**none of the three exists any more** — check with `git branch --list '*integration*'` before
assuming one does. `ps-integration` is **not** one: it is a parked preservation branch, and
`HANDOFF.md` §121 — "The worktree sweep is structurally blind to every branch that has no
worktree" — records it as the one ref that is not an ancestor of `main` yet reports zero unlanded
patches. Review it; do not land it. The companion claim, that merging it as written would break
the others because it reads `process.env.E2E_PORT` where they all use `PLAYWRIGHT_PORT`, died with
the entry that carried it and **a reader can no longer check it**: `git grep E2E_PORT ps-integration`
returns nothing today.

### 10.5 When two branches touch the same file

The model is `08-merge-plan.md` §"1. Ownership map": a `Worktree / branch | Phase | Owns` table with one line of owned files per session, written **before** the work starts. Four rules follow.

1. **One owner per file.** A file named in exactly one `Owns` cell is that session's to edit; a file named in none belongs to nobody — a plan defect, raise it before the work.
2. **The spine is a single-owner file set.** The registries — `tool-types.ts`, `toolProcessors.ts`, `toolsMap.ts`, `settings.ts`, `util/settings.ts`, `toolbar-mapping.ts`, `Main.tsx` — are edited by every layer and are positionally coupled. Two agents editing them conflict; an agent editing `toolbar-mapping.ts` beside one editing the e2e flyout testids produces tests that pass locally and fail after merge. Assign the whole set to one agent.
3. **A worker that needs a file it does not own stops and reports.** It does not reach. `08-merge-plan.md` §"2.4 Non-overlap that must stay non-overlapping" records `ps-transform-geometry` being told to report needed changes in `layer-renderer.ts` / `useLayer.ts` / `materialization.ts` / `history-replay.ts` rather than edit them, and `docs/handoffs/ps-transform-geometry-review-and-merge.md` — its own preamble records that this boundary is _precisely why_ several defects it found still exist. State the boundary in the brief; do not assume it was read.
4. **A collision recorded in advance is resolved at merge, not during the work.** The worked example is `08-merge-plan.md` §"2.1 `ShapeToolArea.test.tsx` — real, expected": `ps-shape-geometry` will make `ShapeToolArea.test.tsx` fail, the file is owned by another session, so the merge applies the new expected geometry and splits the case out of the `it.each`.

On an unpredicted conflict, do not resolve it by taking one side wholesale. Read both sides, then run the full gate — a green `tsc` on a mechanically-resolved conflict is not evidence.

### 10.6 Worktree removal is not a safety check

Removable only when all three of these hold:

```bash
git rev-list --count main..HEAD        # 0
git merge-base --is-ancestor HEAD main # exit 0
git status --porcelain                 # empty, untracked included
```

"0 commits ahead of `main`" is **not** a safety test: a worktree whose work was never committed is 0 ahead _because_ nothing was committed, which is exactly the state that loses it. `git stash list` is repo-level — all worktrees share one `refs/stash` — so it is a check, never a cleanup: `git stash clear` is the one destructive command that touches shared state. `git worktree remove` refuses a dirty or untracked worktree unless `--force`, so the exposure is exactly `--force` or `rm -rf`. Never either without the three.

Do not use the worktree count as a test. `git worktree list` disagrees with `.git/worktrees/*/HEAD` and with the directory count under `.kilo/worktrees/`: three numbers, one checkout, no relationship to commits.

### 10.7 Pre-merge checklist

- [ ] Up to date with `main`: `git log --oneline main..HEAD` empty, `git status --short` empty.
- [ ] `npm run tsc` clean. `npm run lint:check` clean, including the files you wrote.
- [ ] `npm run test`: 0 failed **and** the `Test Files` count has not decreased.
- [ ] `npm run test:e2e:unit` clean. `npm run build` clean.
- [ ] `PLAYWRIGHT_PORT=<free port> npm run test:e2e` clean; any failure located in `e2e/OPEN_PROBLEMS.md` or declared a new defect.
- [ ] Every new test fails without its fix, with the failure count recorded.
- [ ] Handoff entry in the same commit as the finding; fixed entries deleted, not reworded.
- [ ] `package.json` and `package-lock.json` unchanged; no new runtime dependency.
- [ ] No new comments in source except `// BUG:` and `// @ts-expect-error`.
- [ ] Staged by explicit path; `git diff --cached` read.
- [ ] Merged with `--no-ff`, full gate re-run **after this merge alone**.

---

## The tool backlog — what to build next

### How to read this

**Snapshot: `main` on 2026-09-28, after the eraser / magic-eraser / paint-bucket / eyedropper tranche
landed.** Every `file:line` below was
re-read against that tree. The "verify against the tree" rule in `AGENTS.md` is what this section
obeys: a citation you cannot re-verify sends the next session after a bug that does not exist.

**The ranking rubric, as a rule.** Order gaps by the product of two things, both of which you
must compute rather than feel:

1. **Frequency × fidelity loss** — how often a working photo editor's user reaches for the tool,
   multiplied by how far the current behaviour is from Photoshop's. A tool that is absent scores
   the full product; a tool that is present-but-wrong scores only the fidelity half. A tool that
   is _selectable and does nothing_ outranks both, because it is worse than absent: it spends a
   user turn to discover a lie.
2. **Cost** — derived in one sentence, below, from `src/contexts/history-adapter.ts`. Not a guess
   about how much code the tool needs; a reading of which closed union it will hit.

**Re-verify before building.** The branch table moves weekly, the registry moves faster, and
`### Already in flight` below was correct only on 2026-09-28. Re-run
`git -C /Users/bkalynovskyi/ph branch --list 'ps/*' 'wip/ps-*'` and
`git merge-base --is-ancestor <branch> main` before you pick anything, and re-read
`src/tools/toolsMap.ts` before you claim a tool is absent.

### Where the app stands

**Two tranches landed after this section was first written: the four-tool tranche
(`eraser` / `magic-eraser` / `paint-bucket` / `eyedropper`) and then the eight-tool tranche
(`elliptical-selection` / `quick-selection` / `gradient` / `sharpen` / `smudge` / `dodge` /
`burn` / `clone-stamp`). The counts below were re-derived on `main` at `f7c242c`; the
tables **below** this one were not, and the gap rows that name an absent tool are now wrong.
Re-derive a row before you build it, exactly as [the rule above](#the-tool-backlog--what-to-build-next) says.

On that tree:

| Measure                                      | Count                                   | Where                                                                                                                                                                |
| -------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registered tools                             | **41**                                  | `src/tools/toolsMap.ts` — `toolsMap`; `ToolName` is `keyof ToolArgsByName` at `src/contexts/tool-types.ts`, and that type has the same 41 members                    |
| Entries in `availableTools`                  | **41**                                  | `toolbar-mapping.ts` — `availableTools`                                                                                                                              |
| Registrations with a `PlaceholderTool`       | **8**                                   | `toolsMap.ts` — the eight `PlaceholderTool` rows                                                                                                                     |
| Registrations with a real options bar        | **33**, over **27 distinct components** | the other 33 rows; six of them (`shape`, `rectangle`, `ellipse`, `triangle`, `polygon`, `line`) all point at one `Shape` component (`toolsMap.ts`'s six figure rows) |
| Registrations with `commit: 'unimplemented'` | **8**                                   | `src/tools/toolProcessors.ts` — the `commit: 'unimplemented'` rows; the shared no-op is `src/tools/toolProcessors.ts` — `unimplemented`                              |
| Toolbar tiles the app renders                | **40**                                  | `toolbar-mapping.ts` — `toolbarMap`; Photoshop's 20-slot column is still FROM-MEMORY, so the slot-for-slot gap count is **not** re-derived here                      |

`availableTools` and `toolsMap` now agree at 41. The old 33-vs-29 divergence — the reason
the inventory scoped itself to "registered tools (all of them in `availableTools`)" — is
**closed**; a missing-tool audit can no longer be explained away by the list lagging the
registry, so go back to diffing Photoshop's roster against `toolsMap` directly.

Of the eight remaining placeholders, `color-replacement` is `commit: 'raster'` and genuinely
paints. `brush` and `pencil` **left this set** — they now have real options bars
(`Brush` / `Pencil` in `toolsMap`) — and the six pen-family rows plus `custom-shape` are the
`unimplemented` defect described in Tier 2.

**The structural finding — why an audit walking the registry cannot see a missing tool.**
`toolsMap` is typed `Record<ToolName, Partial<ToolProcessorDefinition> & { icon; toolboxComponent }>`
(`src/tools/toolsMap.ts` — the `ToolsMap` type, declared at `export const toolsMap`). The registry is still _total_ over `ToolName`
and still requires `icon` and `toolboxComponent` on every row, so it has no way to say "this
Photoshop slot is empty", and no way to say "this row is a stub" — `PlaceholderTool` and `Pen`
are the same `ToolbarRightComponent` to the type. Absence is invisible _from inside the
registry_: an audit that walks `Object.keys(toolsMap)` gets one row per registration, all of
which look equally real. The two failure modes it cannot distinguish are both still live —
**`Gradient` is named in the registry now** (the gap this section was written to expose has
been filled), while `freeform-pen`, `curvature-pen`, `add-anchor-point`,
`delete-anchor-point` and `convert-point` are rows that select, accept options, and produce
nothing. The corpus's own `00-tool-inventory.md` — its "Scope caveat: its universe" line scopes itself to
"Registered tools (all 29 in `availableTools`)" — a count that is now itself stale — so a
missing tool was outside its universe by construction, not by oversight.

A gap list can only come from an external roster (Photoshop's toolbar) diffed against the
registry. That is what this section is, and it is why the original inventory's counts were
right and its gap list empty.

### Ranked gaps

**The cost criterion, so you can re-derive a row you disagree with.**

> **CHEAP** iff the tool can land as `commit: 'raster'` with no edit to
> `src/contexts/history-adapter.ts`, `src/contexts/history-model.ts`, or
> `src/contexts/materialization.ts`. **EXPENSIVE** iff it needs a new `commit` kind that lands on
> a closed union, a new engine, or a new document-model type.

The deciding lines, all verified on that tree:

- **Why `raster` is free.** `operationForTool`'s raster arm is fully generic:
  `processorId: args.toolName` with **no allowlist** (`src/contexts/history-adapter.ts` — `operationForTool()`'s `raster` arm).
  `DurableOperation`'s variant types it `processorId: string` — an open string, not a union
  (`src/contexts/history-model.ts` — `DurableOperation`'s `processorId: string`) — and the materializer resolves it by **lookup**,
  `toolProcessors[operation.processorId as keyof typeof toolProcessors]`, rejecting only an
  unknown name or a version mismatch (`src/contexts/materialization.ts` — the `toolProcessors[operation.processorId]` lookup). Name-agnostic
  end to end. A new `raster` tool is CHEAP by construction.
- **Why `layer-operation` is not.** Three hard-coded name lists trip in sequence: the runtime
  allowlist `if (!['blur', 'color', 'levels'].includes(args.toolName)) throw`
  (`history-adapter.ts` — `operationForTool()`'s `layer-operation` arm and its filter allowlist); the 3-member type union
  `DurableFilter.toolName: 'blur' | 'color' | 'levels'` (`history-model.ts` — `DurableFilter`); and
  `filterForOperation`, a `switch` over those three names with **no `default` arm**
  (`materialization.ts` — `presentationOperations()`) whose missing return becomes a compile error the moment the union
  grows. A fourth filter name is a three-file edit minimum.
- **Why a commit kind with no arm is worse than either.** `operationForTool` **throws**
  `Tool ${args.toolName} cannot be replayed durably` for anything it does not handle
  (`history-adapter.ts` — `operationForTool()`'s closing throw), and `convertLegacyHistorySafely` is **fail-closed for the whole
  document** on any error-severity diagnostic — it rolls back the asset transaction and returns
  `status: 'unavailable', document: null` (`history-adapter.ts` — `convertLegacyHistorySafely()`'s fail-closed `status: 'unavailable'` return). One unhandled commit kind
  in the timeline voids the entire durable shadow, not just its own entry.
- **`source` is also generic.** A `commit: 'source'` `TOOL_ACTION` carrying a `layerSource` is
  routed to `create-layer` by `legacyHistoryToDurable()`, which snapshots whatever source the
  tool produced.
- **`selection` costs no durable work at all.** `history-adapter.ts` — `operationForTool()`'s `return null` for `selection` and `document-operation` returns `null` for
  `selection` and `document-operation` alike — both are excluded from the durable shadow, and
  `e2e/OPEN_PROBLEMS.md` plus the `durable-cutover` constraint confirm selection state is still
  sourced from legacy replay. So a selection tool's cost is its _representation_, never its
  history.

---

#### Tier 1 — CHEAP, high frequency: `commit: 'raster'`, no history-file edit

Photoshop behaviour below is FROM-MEMORY unless a corpus file is named; the app-side column is
always verified.

| Tool                                                   | Photoshop behaviour (FROM-MEMORY)                                                                    | Status here                                                                                                                                                                                       | COST                                                                                       | Deciding `file:line`                                                                                                                                                      | Effort                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Eraser** (Eraser / Background Eraser / Magic Eraser) | Paints the backdrop through the alpha channel; Brush-based, with Erase-to-History and Airbrush modes | **SHIPPED on `main`** — `toolsMap.ts` — the `eraser` row (`80eb207`): `src/tools/eraser.ts`, `src/components/ToolbarsRight/Eraser/Eraser.tsx`                                                     | **CHEAP**                                                                                  | `history-adapter.ts` — `operationForTool()`'s generic raster arm (generic raster arm)                                                                                     | S                                           |
| **Clone Stamp** (+ Pattern Stamp)                      | Copies from a user-set source point, with Aligned and Sample-All-Layers                              | **SHIPPED** — `toolsMap.ts` — the `clone-stamp` row, panel `ToolbarsRight/CloneStamp`                                                                                                             | **CHEAP**                                                                                  | `history-adapter.ts` — `operationForTool()`'s generic raster arm                                                                                                          | M (needs a source offset + alignment state) |
| **Paint Bucket**                                       | Tolerance flood fill, contiguous / global, anti-aliased edge                                         | **SHIPPED on `main`** — `toolsMap.ts` — the paint-bucket row (`80eb207`): `src/tools/fill.ts` over `src/util/floodFill.ts`                                                                        | **CHEAP**, but do not write it                                                             | `history-adapter.ts` — `operationForTool()`'s generic raster arm; see `### Already in flight`                                                                             | S once the branch lands                     |
| **Gradient**                                           | Linear / radial / angle / reflected / diamond along the drag; multi-stop, dither                     | **SHIPPED** — `toolsMap.ts` — the `gradient` row, panel `ToolbarsRight/Gradient`                                                                                                                  | **CHEAP** (`createLinearGradient` is universal)                                            | `history-adapter.ts` — `operationForTool()`'s generic raster arm                                                                                                          | S                                           |
| **Dodge / Burn / Sponge**                              | Per-pixel tonal or saturation remap inside the brush footprint, with Exposure and Range              | **ABSENT** — the `dodge`/`burn` hits are `'color dodge'` / `'color burn'` blend-mode names at `src/contexts/psd-utils.ts` — the `'color dodge'` / `'color burn'` blend-mode names                 | **CHEAP for history, EXPENSIVE in effect**                                                 | `history-adapter.ts` — `operationForTool()`'s generic raster arm for the history; the cost is the JS kernel, because the `ctx.filter` route is the inert one — see Tier 3 | M                                           |
| **Zoom / Hand / Rotate View**                          | Viewport transforms; commit nothing, record nothing                                                  | **ABSENT.** `zoom-container` is a bare class in `Main.tsx` — the div's `transform` style is commented out — and `'zoom'` in its `interactionMode` chain is a dead sentinel meaning "no tool area" | **CHEAPEST** — view state, not document state, so no processor and no history entry at all | `Main.tsx` — the `'zoom'` sentinel                                                                                                                                        | S                                           |
| **Eyedropper / Color Sampler**                         | Samples a pixel; commits nothing, records nothing                                                    | **SHIPPED on `main`** — `toolsMap.ts` — the `eyedropper` row (`80eb207`): `src/tools/eyedropper.ts`, which has no processor at all                                                                | **CHEAPEST**                                                                               | `SidebarLeft.tsx` — the `SET_COLOR` dispatch already dispatches `SET_COLOR`; a sampler reuses it                                                                          | S                                           |

#### Tier 2 — CHEAP, lower frequency, or a defect rather than a feature

| Tool                                                            | Photoshop behaviour (FROM-MEMORY)                                                                 | Status here                                                                                                                                                                                                                                                                                                                                                                                             | COST                                                                                                                                                                           | Deciding `file:line`                                                                                                                                                                                                                                                                                                                                     | Effort                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **The six pen-family tools + Custom Shape: hide or throw**      | Real vector paths; a path model                                                                   | **SELECTABLE AND INERT** — `commit: 'unimplemented'`, `unimplemented()` returns `[null as never]`                                                                                                                                                                                                                                                                                                       | **CHEAP** (a removal, not a build)                                                                                                                                             | `toolProcessors.ts` — the `commit: 'unimplemented'` rows, and `Main.tsx` with **no** `interactionMode` arm, so `EventHandler` is `DummyToolArea` (the default and its terminal `else`) and the overlay is `display: none` (the tool-overlay canvas's `display` allowlist)                                                                                | XS                                                      |
| **Elliptical Marquee** (+ Single Row / Single Column)           | A marquee shape; Shift for a circle, Alt from centre                                              | **BUILT** — `'elliptical-selection'` is registered (`src/tools/toolProcessors.ts` — the `'elliptical-selection'` entry, `toolsMap.ts` — the `'elliptical-selection'` row), has real args (`src/contexts/tool-types.ts` — `ToolArgsByName`'s `'elliptical-selection'` member) and its own options bar (`src/components/ToolbarsRight/EllipticalSelection/`). Single Row / Single Column are still absent | **CHEAP for history** (`selection` → `history-adapter.ts` — `operationForTool()`'s `return null` returns `null`); the loop representation caps it at no-AA, no-holes, no-modes | the `'rectangular-selection'` entry is the sibling template; `general-types.ts`'s `Selection` is the ceiling                                                                                                                                                                                                                                             | S (Single Row / Column)                                 |
| **Magic Wand** — contiguous, Sample All Layers, tolerance range | 0–255 tolerance, default 32; contiguous by default; Sample All Layers                             | **PARTIAL, and a no-op**: `magicWand` is `({ bitmap }) => () => [bitmap]` while registered `commit: 'selection'`                                                                                                                                                                                                                                                                                        | **CHEAP** for history                                                                                                                                                          | `src/tools/magicWand.ts` — `magicWand()` against `src/tools/toolProcessors.ts` — the `'magic-wand'` entry; default tolerance 28 at `src/tools/settings.ts` — the `'magic-wand'` default (the 0–255 range is a FROM-MEMORY claim)                                                                                                                         | M                                                       |
| **Shape-tool fidelity**                                         | Triangle is a drag-defined isosceles, Shift = equilateral; Line snaps 45°; shapes fill by default | **PARTIAL**: Triangle inscribes a _regular_ 3-gon; Line is excluded from every Shift constraint (`if (shiftKey && figure !== 'line')`); `backgroundColor: null` so nothing fills; `oval` carries a dead `cornerRadius`; `polygon` has no `sides`                                                                                                                                                        | **CHEAP**                                                                                                                                                                      | `shape.ts` — `snapLineGeometry()` and the `figure === 'line'` branch of `computeShapeGeometry`; `settings.ts` — the `shape` entry's `backgroundColor: null`                                                                                                                                                                                              | S — **but `wip/ps-shape-geometry` is already doing it** |
| **Text**                                                        | Paragraph layout, wrapping to a text box, justify, tracking, live font gating                     | **PARTIAL / raster-at-birth**: `text.split('\n')` then one `fillText` per line, and `getTextWidth` returns only the **widest** line, so `rect` is decoration, not a wrap box. `lineHeight` is an em multiplier, not a baseline distance                                                                                                                                                                 | **CHEAP** — `commit: 'source'`, routed to `create-layer`                                                                                                                       | `src/tools/toolProcessors.ts` — the `text` entry; `src/tools/text.ts` — the per-line `fillText` renderer; `src/tools/settings.ts` — the `text` default                                                                                                                                                                                                   | M                                                       |
| **Count / Note / Ruler**                                        | Measurement and annotation overlays                                                               | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                              | **CHEAP** for Count and Note (no commit); Ruler needs a persistent screen-space overlay, which no layer has                                                                    | the rect overlay canvas in `Main.tsx` is `display: none` for every tool but `reposition` (its own `display` allowlist); the selection-ants overlay canvas beside it is `display: none` for every tool outside `POLYGON_SELECTION_MODES` (its `[...].includes(...)` gate), so a ruler has two existing gated canvases to model itself on rather than none | S                                                       |

#### Tier 3 — needs a new engine, a new `DurableOperation` variant, or a new document type

| Tool / gap                                                                                    | Photoshop behaviour (FROM-MEMORY)                                      | Status here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | COST                                                                                                                                                                                                                                               | Deciding `file:line`                                                                                                                                                                                                                                                                  | Effort                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **The `ctx.filter` Safari refusal**                                                           | n/a — this is a correctness fix, not a feature                         | **PARTIAL and wrong on a shipping browser.** Five sites write `ctx.filter` into an `OffscreenCanvas`: `src/tools/blur.ts` — its `ctx.filter = \`blur(${radius}px)\``write,`src/tools/colors.ts`— its`ctx.filter = buildColorsFilter(...)`write,`src/tools/levels.ts`— its`ctx.filter = buildLevelsFilter(...)`write,`src/contexts/materialization.ts`— its`requireCanvasFilter()`call,`src/contexts/layer-renderer.ts`— its`requireCanvasFilter()`/`requireLayerFilterSupport()`calls. No feature detection exists —`grep -rn "SUPPORTS_CTX_FILTER\|'filter' in" src e2e` returns **0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **CHEAP** to add the refusal, and it is the _prerequisite_ for every per-pixel tool above                                                                                                                                                          | `materialization.ts` — `presentationOperations()` is the path to extend; a `'filter' in ctx` check is **insufficient** — see the trap list                                                                                                                                            | S                              |
| **Blend modes**                                                                               | 27 modes with a real compositing equation; separable and non-separable | **PARTIAL** — `blendMode: GlobalCompositeOperation`, the browser's enum, passed straight through                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **EXPENSIVE** — a new engine, not a new commit kind                                                                                                                                                                                                | `src/contexts/layer-types.ts` — `blendMode: GlobalCompositeOperation`; a partial slice of the compositing equation already exists as `toolLayerBlendMode()` in `src/contexts/layer-utils.ts` — sixteen of Photoshop's 27 modes, keyed off `args.blendMode` and falling back to Normal | L                              |
| **The healing family** (Spot Healing, Healing, Patch, Content-Aware Move, Red Eye)            | Content-aware synthesis of the covered region                          | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **EXPENSIVE** — a content-aware engine. The _history_ would be cheap (`raster`); the kernel is the cost                                                                                                                                            | `history-adapter.ts` — `operationForTool()`'s generic raster arm buys the history; nothing else exists                                                                                                                                                                                | L                              |
| **History Brush / Art History Brush**                                                         | Replays or resamples from the document's own history states            | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **EXPENSIVE** — Art History needs a per-operation snapshot buffer that no type in the tree models                                                                                                                                                  | `src/contexts/history-types.ts` has no per-step pixel payload; the durable baseline (`history-adapter.ts` — `plainObject()`, the durable-state snapshot helper) is a single state, not a tape                                                                                         | L                              |
| **Selection keystone** — mask, add/subtract/intersect, holes, disjoint islands, anti-aliasing | A region, not a loop                                                   | **PARTIAL** and structurally blocking. `Selection` is one `points: Point[]` boundary loop (plus optional `lifecycle` / `geometry` / `sourceTool` / `metadata`). `rasterizePolygonMask` (`src/util/selection.ts` — `rasterizePolygonMask()`) **binarizes** the anti-aliased alpha the Canvas2D just computed — and it is reached from **one** caller, the feathered copy (the feathered copy's `rasterizePolygonMask()` call), so the binarize is a feathered-path property, not a general one. The default polygon path never binarized: `copyPolygonSelectionToCanvas` (`copyPolygonSelectionToCanvas()`) `clip()`s to the path and returns `{ bitmap, pos }` with the soft alpha intact. `drawPolygonPath` (`drawPolygonPath()`) never sets a fill rule, so the browser's non-zero default applies, while `isPointInPolygon` (`isPointInPolygon()`) is even-odd ray casting — the two disagree, and `clip()` is what makes that disagreement visible: a self-intersecting loop is filled by winding number on screen but hit-tested even-odd. `copySelectionToCanvas` (`copySelectionToCanvas()`) routes **only** `feather-magnetic-lasso` (its `sourceTool === 'feather-magnetic-lasso'` test) through the feathered path | **EXPENSIVE** — a new document-model type. This is the keystone: it unblocks every paint tool, every region-scoped adjustment, and all 7 `commit: 'selection'` tools at once                                                                       | `src/contexts/general-types.ts` — `Selection`; note `SelectionMode` **does** exist at `src/tools/selection.ts` — `SelectionMode` but is `'fill' \| 'outline'`, a fill mode, not a combination mode                                                                                    | XL                             |
| **Selection Brush / Object Selection**                                                        | Paints or computes a region                                            | **ABSENT** — but **Quick Selection is BUILT**: `'quick-selection'` is registered (`src/tools/toolProcessors.ts` — the `'quick-selection'` entry, `toolsMap.ts`), has real args (`src/contexts/tool-types.ts` — `ToolArgsByName`'s `'quick-selection'` member) and its own options bar (`src/components/ToolbarsRight/QuickSelection/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **EXPENSIVE** — blocked by the keystone above, not by itself                                                                                                                                                                                       | `src/contexts/general-types.ts` — `Selection`; a selection-creating tool cannot be expressed as a raster write                                                                                                                                                                        | L (after the keystone)         |
| **`levels` = real Levels; `color` = Black & White + Tint**                                    | Channel selector, histogram, input black/gamma/white, output levels    | **PARTIAL**: `levels` is Brightness/Contrast, `color` is grayscale/sepia/saturation with a fixed `#d9c09a` sepia matrix. The corpus resolved both identities on 2026-09-26 and **neither was implemented** — the `levels` and `color` defaults in `settings.ts` are unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **EXPENSIVE** — a `layer-operation` name trips three closed lists                                                                                                                                                                                  | `history-adapter.ts` — `operationForTool()`'s filter allowlist; `history-model.ts` — `DurableFilter`; `materialization.ts` — `presentationOperations()`                                                                                                                               | M                              |
| **Path Selection / Direct Selection**                                                         | Edits existing vector anchors                                          | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **EXPENSIVE** — no vector path model exists anywhere in `src/`                                                                                                                                                                                     | `src/contexts/general-types.ts` has no path type; `src/tools/toolProcessors.ts` — the pen family's `commit: 'unimplemented'` rows is the pen family's current state                                                                                                                   | XL                             |
| **Path Operations, Transform Selection, Select menu**                                         | Boolean path ops; Select ▸ Modify / Grow / Similar / Refine Edge       | **PARTIAL**: the **Select menu does not exist at all** — `src/components/Menu/Menu.tsx` is 13 lines rendering only `DesktopHeader` and `ToolbarHorizontal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **EXPENSIVE** — combination modes and path ops are the keystone and the path model                                                                                                                                                                 | `src/components/Menu/Menu.tsx` — the whole file                                                                                                                                                                                                                                       | M (menu shell) / L (the modes) |
| **The AI group** (Generative Fill, Generative Expand, Neural Filters)                         | Cloud model inference                                                  | **ABSENT** — no network surface, no async tool-completion model in the tool contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **EXPENSIVE** — and out of scope for this repo until a tool contract admits async, non-deterministic, cancellable commits. `replay.deterministic` (`toolProcessors.ts` — `ToolProcessorDefinition`'s `replay.deterministic`) is a hard requirement | `src/tools/toolProcessors.ts` — `ToolProcessorDefinition`'s `replay.deterministic`; `history-model.ts` — `DurableHistoryEntry`'s `schemaVersion: number` pins a schema version per entry                                                                                              | XL / defer                     |
| **The pen family proper** (Pen, Freeform Pen, Curvature Pen)                                  | Bezier path construction with anchors and handles                      | **SELECTABLE AND INERT** (see Tier 2) — the build is a separate, much larger job                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **EXPENSIVE** — a new document-model type                                                                                                                                                                                                          | `src/tools/toolProcessors.ts` — the pen family's `commit: 'unimplemented'` rows; nothing in `general-types.ts` models a path                                                                                                                                                          | XL                             |

### Suggested first three

Pick these three because each is CHEAP under the criterion above, each closes a _lie_ or a
high-frequency gap rather than adding a feature, and together they cover the whole playbook's
surface — options bar, processor, gesture, history, e2e — at the smallest honest size. **Two of the
three are already filed** in `HANDOFF.md`; read them before starting, because a fix that ignores the
filing is a second copy of the same finding.

1. **Hide or throw the six pen-family tools + Custom Shape.** XS. Remove them from
   `toolbarMap` and `availableTools`, or give them an `interactionMode` arm that refuses. Either way
   the user stops spending a click to discover that a tool does nothing. This is the _defect_ half
   of the pen row, and it does not wait for a path model. **Filed: `HANDOFF.md` item 53**, and the
   honest fix there is five lines.
2. ~~**The Eraser.**~~ **DONE**, with the Magic Eraser, the Paint Bucket and the Eyedropper
   alongside it — the smallest honest `commit: 'raster'` tool, and it exercised exactly the surface
   described here: options bar, `PaintToolArgs` extension, `commit: 'raster'`, per-tool test tables,
   e2e spec.
3. **Zoom / Hand / Rotate View, as one view-only tranche.** S, and the cheapest of the three: none
   of them needs a processor, a history entry, or a `DurableOperation` variant. They are pure view
   state. **Filed: `HANDOFF.md` item 52** — the view transform is commented out, so the absence is
   one line, not three tools.

**They fan out to parallel worktrees because their engine files are independent.** Item 1 owns
`toolbar-mapping.ts` and the pen rows of `toolsMap.ts`; item 3 owns new files plus
`Main.tsx`. **The shared surface is small and additive, and it is the one thing to sequence
last:** the `ToolName` union, the `toolProcessors` row, the `toolsMap` row, the `availableTools`
entry, a `saveToolArgs` arm in `src/util/settings.ts`, and four per-tool tables in
`src/tools/__tests__/tool-processors.test.ts`. Those are line insertions in a single-owner file set,
not refactors — plan for one merge to reconcile them rather than pretending they are free.

**Do not start item 3's `Main.tsx` work without reading `wip/ps-ux-chrome` first**: it rewrites the
options bar and the theme tokens wholesale.

### Already in flight

**Re-derive this; never trust a table — and derive it with the generator, not by hand.** Run
`node scripts/worktree-inventory.mjs` to regenerate `WORKTREES.json`, which is **untracked and
gitignored** on purpose: every value in it describes the machine that produced it, so a tracked copy
is a diff nobody can review and a collision two agents cannot resolve. **Never hand-edit it, never
`git add -f` it**, and note that a fresh clone has none — generate one before you read a worktree
list, and treat any you find as a claim about a moment.

**Read `action` first.** It is the whole answer: `land` merge it · `at-risk` save it, it needs a
human · `dispose` delete it · `legacy` drop the worktree, keep the branch · `in-use` leave it
alone · `keep` never a candidate · `undecided` do
not remove it. Two things that catch people: a **`land` is a point-in-time answer**, only as fresh as
`generatedAt`, so re-read `dirty` and `mergeConflict` before acting on one you did not generate; and
**`mustNotPrune` vetoes `land` as well as `dispose`**, so a branch reading `land` with that flag set
is a contradiction rather than a clean merge.

Do not hand-roll `git branch --list` plus `merge-base --is-ancestor` when the generator has already
done it. A "0 commits ahead" branch is not a safety test either way — a worktree whose work was
never committed is also 0 ahead — and that is what `uncommitted-only` exists to say: never prunable
whatever the curated table claims, and `worktree-inventory.test.mjs` re-derives that set from the
live worktrees to keep it true. Keep a judgement you need in
`scripts/lib/worktree-inventory/curated.mjs`; **an uncurated worktree is not at risk and there is
deliberately no rule demanding an entry for one**, so write an entry when you have a judgement to
record and not per worktree. What matters:

- **The eight tools from a since-merged branch are on `main` today** — `elliptical-selection`,
  `quick-selection`, `clone-stamp`, `sharpen`, `smudge`, `dodge`, `burn`, `gradient`. An earlier
  revision of this bullet said they were **not in `main`** and sent the reader to a branch to check.
  That was wrong in the direction that costs the most: the branch it named, `ps/tool-expansion`,
  was consolidated onto `merge/ps-tool-expansion` and **neither is in any ref of this repository**,
  while `git merge-base --is-ancestor ab5f53c main` **passes**. Each of the eight has a real
  options-bar component under `src/components/ToolbarsRight/` (`CloneStamp`, `Gradient`,
  `Sharpen`, `Smudge`, `Tonal`, `EllipticalSelection`, `QuickSelection`) and its own row in
  `src/tools/toolsMap.ts`. **"Check that branch" sent an agent nowhere. Re-run the ancestor test
  and grep `toolsMap.ts` before believing any absence in this document** — see §0.8.
- **`dodge` and `burn` share one options-bar component**, `ToolbarsRight/Tonal/Tonal.tsx`. That is
  the precedent for one file per tool _family_ rather than per tool, and the collision to expect if
  two agents take one each.
- **The clone-stamp read/write constraint is not an edge case.** With a constant offset, dab
  _k+1_'s read set sits inside dab _k_'s write set, so a row-buffer implementation is impossible
  and self-reference is the common case. Any tool that samples from a region it also writes has to
  be designed around this, not discovered by it.
- `ps/brush-engine` is **unmerged** — four commits ahead of `main` and 969 behind it — and the tip
  engine it built is already on `main` as `src/util/brush-engine.ts`, which is why this document
  cites the tip, the dab centres and the stroke coverage as mainline units. Read the branch if you
  want its history; do not sequence behind it.
- `wip/ps-ux-chrome` (schema-driven options bar) is a parked
  preservation snapshot — one commit ahead of `main`, 1059 behind. Read before designing an options
  bar; do not land it. The sibling it used to name, `wip/ps-integration` (rewrites the served-app
  and Vite plumbing, so an e2e failure in a worktree may be its churn and not yours), **is in no
  ref of this repository any more**, so nothing in it can be checked.

## Appendix A — the trap list

Every entry was checked against the tree on 2026-09-28. Grouped by where it bites. Entries about tooling _behaviour_ rather than tree state are marked **[unverified]** — unverified means unverified, and it is not a claim that they are false.

### Worktree

1. **A new worktree that predates the e2e infrastructure.** Symptom: `npm run test:e2e` fails with
   no spec files, or a spec imports a helper the worktree does not have — the branch is simply
   older than the e2e work. Defence: prove the branch is a strict ancestor with **zero** unique
   commits (`git rev-list --count <branch> ^main` must be 0), then `git merge --ff-only main`.
   **Never a hard reset** — it destroys the branch's own commits, which `ahead=0` cannot
   distinguish from "work never committed". Command: `git rev-list --count <branch> ^main && git
merge --ff-only main`.
2. **`.kilo` is gitignored, so a worktree has no plan docs and no skills.** Symptom: the
   research corpus, the skill, and every plan directory appear not to exist; you re-research
   something that was already answered. Defence: read the corpus from the **main** checkout
   (`/Users/bkalynovskyi/ph/.kilo/plans/…`), not from the worktree. Verified: `.gitignore:49`
   matches `.kilo`, and `git ls-files .kilo` returns nothing. Note the corollary —
   `HANDOFF.md`, `docs/handoffs/`, and `e2e/OPEN_PROBLEMS.md` **are** tracked and do exist in a
   worktree.
3. **`node_modules` is empty in a worktree, and `tsc`/`vitest` still work anyway.** Symptom:
   typecheck and unit tests pass (Node walks up to the parent checkout), but Vite serves nothing
   and fonts/images/AVIF assets 404 — so the app looks broken in e2e and fine in vitest. Defence:
   `npm ci` in the worktree before debugging any asset that will not load.
4. **Every worktree's dev server wants :5173, and `reuseExistingServer` used to be on locally.**
   Symptom: "my change did nothing" in e2e — the run attached to a **different checkout**.
   Defence: `npm run test:e2e`, which allocates a port, verifies it and records it; and behind it
   `reuseExistingServer` is a literal `false` with nothing that can turn it on, plus `--strictPort`
   so a clash is a hard failure rather than a silent hop to 5174 (`playwright.config.ts` — `reuseExistingServer: false`).
   Both refusals are enforced in `e2e/global-setup.ts` as well as the wrapper, so a raw
   `npx playwright test` cannot bypass them either. A swarm lock is also taken so two agents rarely
   run at once, but it is **advisory only** and can never block a run — see `docs/ORCHESTRATION.md`.
5. **The `agent_manager` tool in this build needs every optional key sent explicitly**
   **[unverified by me]** — arrays reportedly get mangled into `{ item: [...] }`. And
   `agent_manager` reportedly accepted 19 session requests and created none, which is why `task`
   is the default instrument. Consequence for this section: **I had no `task` tool in this
   session's toolset**, and `agent_manager` would have created worktrees — which the one-file
   constraint forbids — so every verification here is inline.
6. **A `task` call missing `subagent_type` fails with a schema error, not silently**
   **[unverified by me]**. Symptom if you omit it: a hard validation failure, which is the good
   outcome; the trap is the agent who retries with a paid model.
7. **A large subagent result comes back TRUNCATED.** Symptom: a summary that stops mid-table and
   a conclusion you were about to act on. Defence: the full text is written to
   `~/.local/share/kilo/tool-output/tool_<id>` — verified that the directory exists on this
   machine. Read the file, do not re-run the task. **[unverified by me]** as to the truncation
   itself.
8. **The legacy `draw` path's export baselines are committed.** Symptom: a correct-looking change
   to the draw/brush path fails visual regression. Verified: `e2e/export/visual-regression.spec.ts-snapshots/export-baselines`
   holds **17** tracked files. Defence: re-recording is `npm run test:e2e:update-baselines`,
   which is **an operator decision, not an agent decision** (`AGENTS.md`, "Gates" and "E2E failures").

### Canvas and testing

13. **The global canvas context deliberately has no `getImageData`.** Symptom: a test that
    assumes pixel read-back **silently does nothing** — the code guards on
    `typeof ctx.getImageData === 'function'` to detect a reduced canvas, so the guard takes the
    fallback branch and your assertion passes vacuously. Verified:
    `src/test/setup.ts` — the doc comment above `createPixelCanvasContext()` states this in the doc comment; the opt-in is
    `createPixelCanvasContext` at `createPixelCanvasContext()` or `makeMockCtx` from `@/__tests__/canvas-mock`.
14. **`installCanvasContextStub` returns a NEW mock context per `getContext` call.** Symptom: a
    `last()`-style accessor compares two _different_ context objects and every equality assertion
    fails, or worse, you "fix" it by caching and now assert on a stale context. Verified:
    `src/test/setup.ts` — `installCanvasContextStub()` builds a fresh `createMockCanvasContext(this)` inside the
    `mockImplementation`, and the `beforeEach` re-install in `setup.ts` because
    `vi.restoreAllMocks()` drops it. Two live examples of the correct pattern:
    `image-processors.test.ts` — the `RecordingOffscreenCanvas` doc comment (documents the hazard) and its two `expect(canvas.ctx.filter)` pins
    (`lastCanvas().ctx`).
15. **`ctx.filter` is silently ignored by Safari on `OffscreenCanvas`.** Symptom: `blur`, `color`,
    and `levels` are inert in Safari **and still record a history entry**. Verified: five write
    sites — `src/tools/blur.ts` — its `ctx.filter` write, `src/tools/colors.ts` — its `ctx.filter` write, `src/tools/levels.ts` — its `ctx.filter` write,
    `src/contexts/materialization.ts` — its `requireCanvasFilter()` call, `src/contexts/layer-renderer.ts` — its `requireCanvasFilter()` / `requireLayerFilterSupport()` calls — and **zero**
    feature detection (`grep -rn "SUPPORTS_CTX_FILTER\|'filter' in" src e2e` returns 0).
    Defence: a per-pixel tool that depends on it must **refuse to commit** rather than silently
    no-op, and `'filter' in ctx` is **not a sufficient probe** — the property exists on the
    prototype and only the Safari implementation ignores writes. The corpus's probe is the honest
    one (`01-photoshop-reference.md` — the one-line browser-capability probe it recommends): set it, read it back, compare to `'none'`.
    Do not weaken a test to get green here.

### Options bar

16. **An options bar that mounts its own preview canvas breaks every positional
    `page.locator('canvas')`.** Symptom: a strict-mode "resolved to 2 elements" violation, or
    worse, a silent test that clicks the _preview_ canvas and passes for the wrong reason.
    Verified live instances: `Shape.tsx` — its `<canvas ref={previewRef}>` preview and
    `Draw.tsx` — its `<canvas ref={previewRef}>` preview both render
    `<canvas ref={previewRef}>`. Defence: use the workspace-canvas helper —
    `getWorkspaceCanvas(page)` at `e2e/helpers/canvas-helpers.ts` — `getWorkspaceCanvas()`, which resolves
    `data-testid="workspace-canvas"` and nothing else. The doc comment at the doc comment above `getWorkspaceCanvas()` records the
    exact history: an earlier `.or(page.locator('canvas').nth(1))` fallback was a wrong document
    index that shifted when the Draw toolbar unmounted its preview.
17. **The options component is force-remounted on every tool switch.** Symptom: local panel state
    (an open dropdown, a scrub-in-progress value) is lost the moment the user clicks the toolbar.
    Verified: `<ToolComponent key={toolName} />` at
    `ToolbarHorizontal.tsx` — the `overflow-visible` comment above the returned toolbar. Defence: keep panel state in
    `useCurrentTool`'s tool args, never in component state.
18. **`toolsMap[toolName]?.toolboxComponent` swallows a missing registration.** Symptom: a typo in
    a tool name renders a TODO strip instead of failing. Verified: the optional chain is at
    `ToolbarHorizontal.tsx` — `const ToolComponent = toolsMap[toolName]?.toolboxComponent`. Defence: because `toolsMap` is
    `Record<ToolName, …>` (`src/tools/toolsMap.ts` — the `ToolsMap` type), a row you forget is a **type** error, not a
    runtime one — so the `?.` only ever fires for a `ToolName` that is in the union but not in
    the map, which should be impossible. Treat a `?.` that fires as a registry bug.
19. **Inserting a flyout group renumbers every later section.** Symptom: an e2e spec that
    hard-codes `tool-flyout-<groupIndex>` silently targets a different tool's flyout. Verified: the
    testid is minted at `SidebarLeft.tsx` — the `tool-flyout-${groupIndex}` testid mint from
    `` `${sectionIndex}-${groupIndex}` `` at `SidebarLeft.tsx` — `oneColumnGroupKey()`, or `` `two-column-${groupIndex}` `` at
    `SidebarLeft.tsx` — `twoColumnGroupKey()` — so one-column and two-column layouts number the _same_ groups differently. Defence:
    select flyout items by `tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}`
    (`renderToolGroup()`'s `tool-flyout-item-${name}-${slug}` testid, with the slug rule centralised at `toolbar-mapping.ts` — `slugifyToolLabel`), never by index.
20. **The primary tile is `group[0]`, and flyout test ids are mode-dependent.** Verified:
    `SidebarLeft.tsx` — `renderToolGroup()`'s `primaryTool` (`const primaryTool = primaryTools[groupIndex] ?? group[0]`), and the
    e2e expectation is derived from the same place
    (`toolbar-helpers.ts` — the `openFlyoutFromTile(page, OVERFLOW_TILE_TESTID)` call "Verifies the primary tool shown on a grouped button
    matches the expected label"). Reordering a group's first item changes what a plain click
    selects.
21. **A shortcut must account for the backwards registry walk.** Symptom: the wrong handler
    fires, or two handlers both match and only the last-registered wins. Verified: matching walks
    `for (let i = shortcuts.length - 1; i >= 0; i--)`
    (`src/hooks/useKeyboardEvents.tsx` — the backwards registry walk) and `break`s on the first hit (its `break` on the first hit). Note the
    nuance that is easy to get wrong: `matchesShortcut` only tests `shift` when the declaration
    sets it (`if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) return false;`
    at `matchesShortcut`'s `shift` test), so registering both a plain and a `shift: true` variant is required _when both
    would match_ — not unconditionally. Also: `shortcut` in `toolbarMap` is **display-only** and
    binds nothing.
22. **Two independent `Escape` paths.** Symptom: one `Escape` both closes a flyout and cancels a
    draft. Verified: the flyout one is a raw `window` listener at
    `SidebarLeft.tsx` — the `OVERFLOW_TILE_TESTID` doc comment and the `FLYOUT_HOLD_MS` comment above it that calls `setOpenGroup(null)` and cannot
    be suppressed by `preventDefault` on the other. (The second path, in
    `PolygonClickToolArea`, is **[unverified]** — find it before relying on it.)

### Persistence

23. **A settings-persistence arm that saves a bare `{ toolName }` discards every value on the same
    tick — and a test that asserts only the key survives passes happily.** Symptom: a slider
    resets to its default the moment you touch another control; the options bar looks like it is
    saving. Verified: the arm at `src/util/settings.ts` — `saveLastSettings()`'s multi-name `cloneDeep({ toolName })` group matches nine tool names and stores
    `cloneDeep({ toolName })` — the _whole_ entry is the key, so `opacity`, `flow`, `hardness`
    and everything else are dropped on the next save. The correct pattern is two lines away, at
    `saveLastSettings()` writes `...(lastSavedSettings[toolName] ?? {}), ...args`. Defence, and the reason this trap
    survives: `tool-settings.test.ts` — the `it('stamps each entry with its own key as toolName')` case asserts **only**
    `defaultSettings[toolName].toolName === toolName`, and `tool-settings.test.ts`'s matching `lastSavedSettings[toolName].toolName === toolName` assertion asserts **only**
    `lastSavedSettings[toolName].toolName === toolName`. Neither test looks at a second field, so
    a regression here is invisible to the suite. When you add a tool, add an assertion about a
    **value** in the same change.
24. **The `never` trap can be defeated by a coincidentally matching string.** Symptom: a new tool
    name matches an existing `else if` arm and is saved under the _other_ tool's policy, so the
    exhaustiveness check never fires. Verified: `const _exhaustive: never = toolName;` at
    `src/util/settings.ts` — `saveLastSettings()`'s `never` sentinel. The arms above it are exact string comparisons, so
    `'ellipse'` vs `'oval'` vs `'oval-tool'` is decided by the spelling, not by intent.
25. **Tool settings are in-memory only.** Symptom: a reload resets every slider. Verified: the
    store is in-memory (`src/util/settings.ts` holds `lastSavedSettings` in module state), and
    `normalizeToolArgs` validates nothing but `figure`. Do not promise persistence in an options
    bar until there is a store for it.
26. **`toolbarPlaceholderConfig` is keyed `Record<string, …>`, so a mistyped key compiles.**
    Symptom: a placeholder renders with `undefined` options instead of failing. Verified: the
    record is `Record<string, readonly string[]>` at
    `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts` — `placeholderToolGroups`, and `toolsMap.ts` — `placeholderTool()`'s `key: keyof typeof placeholderToolGroups` parameter types the
    lookup parameter as `keyof typeof placeholderToolGroups` — which, for a `Record<string, …>`,
    is just `string`. Two facts to know about the keys: **the `rectangle` key in `placeholderToolGroups` is defined and
    consumed by nothing** (`toolsMap.ts` — the `rectangle` row gives `rectangle` the real `Shape` component), and
    the three anchor-point tools reuse the `pen` list (`toolsMap.ts` — the `add-anchor-point` / `delete-anchor-point` / `convert-point` rows).

### History

27. **Undo runs the processor with no guard that the live path has.** Symptom: a processor that
    throws on a live pointer move degrades silently on undo, so a bad history entry replays as a
    no-op instead of an error. Verified and load-bearing: the live path **is** guarded —
    `try { … } catch (error) { console.error(error); return; }` at `src/contexts/useLayer.ts` — `tempUpdateLayer`'s two `isTransformArgs` guards (`catch (error) { console.error(error); return false; }`),
    with a comment naming `transform` and its throwing argument shapes as the reason. The undo
    factory `applyRasterTool` at `src/contexts/useHistory.ts` — the `applyRasterTool` arm has **no** try/catch. The
    asymmetry is real and it is the other way round from what older notes claim.
28. **`commit: 'unimplemented'` voids the whole durable shadow, not just its own entry.**
    Symptom: one history entry naming an unsupported tool makes the entire document
    `status: 'unavailable'`. Verified: `unimplemented()` returns `[null as never]`
    (`src/tools/toolProcessors.ts` — `unimplemented`); `operationForTool` throws for an unhandled commit kind
    (`src/contexts/history-adapter.ts` — `operationForTool()`'s closing throw); and `convertLegacyHistorySafely` rolls back and
    returns `document: null` on **any** error-severity diagnostic (`src/contexts/history-adapter.ts` — `convertLegacyHistorySafely()`'s fail-closed return).
    This is correct fail-closed behaviour and must not be "fixed" by manufacturing a durable
    no-op operation.
29. **`commit: 'document-operation'` is a no-op in legacy replay too.** Verified:
    `src/contexts/history-replay.ts` — `replayHistory()`'s `document-operation` continue is literally `if (processor.commit ===
'document-operation') continue;`. It silently loses **both** systems. The durable half returns
    `null` for `document-operation` alongside `selection` (`src/contexts/history-adapter.ts` — `operationForTool()`'s `return null`), so the
    durable shadow is not the thing to fix.
30. **A missing durable replay case is a silent no-op.** Verified: `src/contexts/durable-replay.ts` — `replayDurableDocument()`'s operation switch
    is a `switch` on `operation.kind` with **no `default` arm**, and `src/contexts/materialization.ts` — `presentationOperations()`
    is likewise a switch with no `default`. Adding a `DurableOperation` variant therefore fails
    to _compile_ rather than to _replay wrongly_ — which is the correct failure mode, and the
    reason `layer-operation` is EXPENSIVE in this section.
31. **`replay.requiresRaster` is derived, not declared.** Symptom: you add a tool and rewrite the
    test's expected list, or you set `requiresRaster: true` on a `layer-operation` tool and CI
    fails on a rule you did not know existed. Verified:
    `tool-processors.test.ts` — the `it('derives the %s requiresRaster flag from its commit kind and creator status')` case asserts
    `replay.requiresRaster === (commit === 'raster' || (commit === 'selection' && !creator))`.
    Older plans still recommend flipping the flag; that is now forbidden.
32. **There are per-tool tables in `tool-processors.test.ts` that a new tool must join.**
    Verified live sites, cited by symbol because the line numbers drift: `unimplementedTools`
    (`unimplementedTools`, `paintWrapperTools`, `argOverrides` and `placeholderTools`),
    the derived `requiresRaster` expectations (`it('marks only raster-producing tools as requiring raster')`, the `.replay.requiresRaster).toBe(false)` sweep, `it('marks only unimplemented tools as non-deterministic')`, and the frozen-descriptor key assertion). A new tool
    fails CI until each gains its row. This is the largest practical cost of adding a tool and
    the reason a mechanical registration is not free.
33. **`ToolIconName` is hand-copied into the test.** Verified: the test exists at
    `src/components/SidebarLeft/__tests__/toolIcons.test.tsx`; the union typecheck and the test
    are two different lists, so they can disagree silently. (I did not verify the old the old line-span reference
    range — cite the file, not the line span.)
34. **`isToolDirty` reads as always-false, and the reason is not the one usually given.**
    Verified: the reducer arm **exists** — `case 'SET_TOOL_DIRTY':` at
    `src/contexts/StoreContext.tsx` — the reducer's `case 'SET_TOOL_DIRTY'` arm, cleared by `SET_TOOL_NAME` at the reducer's `case 'SET_TOOL_NAME'` arm. What is true
    is that **no production dispatch ever sets it `true`**; three options-bar components say so
    in their own comments (`src/components/ToolbarsRight/Colors/Color.tsx` — its "nothing dispatches `SET_TOOL_DIRTY` with `true`" comment, `src/components/ToolbarsRight/Blur/Blur.tsx` — its "nothing dispatches `SET_TOOL_DIRTY` with `true`" comment,
    `src/components/ToolbarsRight/Levels/Levels.tsx` — its "nothing dispatches `SET_TOOL_DIRTY` with `true`" comment). Never build a reset/undo affordance on it.
35. **Every tool area shares one 2D overlay context.** Symptom: a new painter's `globalAlpha`,
    `setLineDash`, or `lineCap` leaks into the next stroke or the next tool. Verified:
    `src/components/Main/Main.tsx` — the single `toolOverlayRef.current.getContext('2d')` write takes the single `toolOverlayRef` context, and
    `src/tools/draw.ts` — `setupDrawCtx()` (`setupDrawCtx`) has to set every property unconditionally —
    including the `else ctx.setLineDash([])` else-branch — precisely because the context is
    shared. Defence: bracket `save()`/`restore()`, and do **not** "fix" it by writing
    `globalAlpha = 1` at the top of setup, which flattens the committed layer.
36. **Two separate `canvas` elements and a third for rects; the `display` allowlist is a separate
    list from the handler list.** Verified: the workspace canvas is
    `data-testid="workspace-canvas"` (`src/components/Main/Main.tsx` — the `data-testid="workspace-canvas"` attribute), the tool overlay's `display` is a
    hard-coded array at `src/components/Main/Main.tsx` — the tool-overlay canvas's `display` allowlist, and the rect overlay's is `[...].includes(...)` at
    the rect overlay canvas's `[...].includes(...)` gate. A preview painted on `toolOverlayRef` is invisible even when the handlers fire.

### Docs

38. **`HANDOFF.md` citations go stale the moment you add an import.** Symptom: a future session
    reads a `file:line` that has moved and either wastes an investigation or "fixes" a bug that
    does not exist, and the drift is not
    hypothetical — a branch's own citation to `src/contexts/history-adapter.ts` — `legacyHistoryToDurable()`'s `create-layer` for the
    `create-layer` emission is wrong here; it is at **`legacyHistoryToDurable()`'s `create-layer`**. Defence: re-verify every citation
    in the handoff you are about to commit, in the same commit, by grepping the tree for each
    line and opening it. (No citation-checking script is checked into the repo — the
    sweep is manual, so budget for it.)
39. **A passing-test count written into a doc goes stale and must be fixed in the same commit.**
    Verified: `e2e/OPEN_PROBLEMS.md` §"Observed failures" asserts "no e2e test fails: 97 pass, 2 are
    skipped by declaration", and `e2e/OPEN_PROBLEMS.md` is the only place the pass/skip counts live. `AGENTS.md` used
    to assert the same count and no longer does, which is this trap biting a real citation. Any
    change to the suite invalidates the number. Defence: the same commit that changes the count
    edits the sentence.

### Process

43. **A test that pins a defect is a tripwire, not a test.** Symptom: you fix the defect, the
    "failing" test goes green, and you never notice the pin. Defence: `AGENTS.md` — a fix
    must **invert** the pin in the same change. And the sharper form: **a test whose only half
    disappears when you remove the last example must be re-aimed, not deleted** — if a test exists
    only to assert the behaviour of one instance, removing the instance silently removes the
    assertion, and the correct move is to repoint it at a surviving case.
44. **Two subagents on the same file is a merge conflict you scheduled yourself.** Split by
    concern, not by convenience. In this backlog the natural shared surface is
    the registry (§ `### Suggested first three`): if two tranches both add a tool, they both want
    `toolsMap.ts`, `tool-types.ts`, `toolbar-mapping.ts`, and four test tables. Assign that
    surface to one owner explicitly.
45. **A subagent claim without `file:line` is not verified.** Ask for
    candidate results _and_ how they got them, then check the load-bearing ones yourself. The
    same rule governs a subagent's _negative_ claim ("X does not exist") — make it grep something.

## Appendix B — the research corpus that already exists

`/Users/bkalynovskyi/ph/.kilo/plans/ps-research/` — 11 files, ~265 KB, in the **main** checkout
only. `.gitignore:49` matches `.kilo`, and `git ls-files .kilo` returns nothing, so **a worktree
has none of it** (trap 2). Read it from the main checkout.

**The rule: read before re-researching. A new research wave that ignores this corpus does not
"start fresh" — it duplicates work that already has file:line anchors and a corrections log.**
Treat every claim as unverified until re-checked against the working tree: the corpus was written
against an older revision, and `08-merge-plan.md` in particular describes a campaign that has
since merged.

| File                                   | What it is FOR                                                                                                                                                                                                                                                                                                                                                     | When to read it                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                            | The entry point. 8-row file table, the three resolved decisions (D1 `color` = Black & White + Tint, D2 `levels` = real Levels, D3 destructive), a "land these first" list, the phase overview, and a candid list of what to be sceptical about. **Read this one first and completely** — it is the map                                                             | Before anything else. Re-read the eight-row file table before planning a tranche: five items there are still unlanded                                                                                                                                                           |
| `00-tool-inventory.md`                 | Every registered tool vs Photoshop, the five highest-impact findings, plus Notes A/B/C on `color`, `levels`, and Free Transform. **Scope caveat: its universe is the registry, so it structurally could not surface a missing tool** — that is exactly the finding in `### Where the app stands`                                                                   | For orientation and for the "is this tool partly built?" question. **Not** for "what is missing" — this section is the replacement                                                                                                                                              |
| `01-photoshop-reference.md`            | The behaviour spec across 7 tool families with every claim cited, plus **§10, the corrections log**. The largest and most valuable file here                                                                                                                                                                                                                       | Implementing or reviewing any tool. **§10 before you trust any Photoshop claim** — it lists 17 disproved premises and 18 genuinely unresolved items                                                                                                                             |
| `02-implementation-plan.md`            | 10 phases, sequenced, with `file:line` anchors, per-test verdicts, and a suggested landing order at `02-implementation-plan.md` — its suggested landing order                                                                                                                                                                                                      | Deciding what to build next. Cross-check its phase table against this section's ranking — the two disagree in places, and where they do, prefer the tree over both                                                                                                              |
| `03-ui-chrome-spec.md`                 | Theme palette, typography, the control vocabulary, **options-bar contents per tool**, cursors, specific widgets, and an explicit "Unverified — do not present as fact" section                                                                                                                                                                                     | Any visual work. Read the same document's unverified-list marker before putting a hex value in code. Check `wip/ps-ux-chrome` first — it may already have built this                                                                                                            |
| `04-blend-modes-and-brush-spec.md`     | All 27 blend modes with formulas and separability flags, the compositing equation, Opacity-vs-Flow math, brush tip and dab rendering, airbrush, smoothing, auto-erase, color replacement, performance, symmetry. §2 and §8 are what make the blend-mode and `color-replacement` rows implementation-grade                                                          | Before touching blend modes or the brush engine. **Much of it is already written on `main`** — `src/util/brush-engine.ts` for the tip, spacing and dab stamping, `src/util/brush-tip.ts`, `src/util/brush-airbrush.ts` and `src/util/stroke-coverage.ts` — port, do not rewrite |
| `05-selection-mask-migration.md`       | The selection keystone: an exhaustive call-site inventory, the exact proposed types, combination-mode design, a marching-squares spec, a per-test impact table, a migration order, and risks/non-goals. This is the document that makes the Tier 3 keystone row actionable                                                                                         | **Start here** for any selection or region-scoped work. It is the single highest-leverage file in the corpus                                                                                                                                                                    |
| `06-adjustments-and-color-pipeline.md` | The sRGB/XYZ/Lab pipeline with exact matrices, real Levels (D2), real Brightness/Contrast, Black & White + Tint (D1), Hue/Saturation and Colorize, the other four adjustments, an engine-independent Gaussian blur, LUT strategy, and a recommended architecture. §11 marks what is reconstructed                                                                  | Before the `levels`/`color` row. The JS kernels it specifies are the correct replacement for the `ctx.filter` path                                                                                                                                                              |
| `07-test-harness-and-migration.md`     | The canvas-mock capability report, **§3 the verdict on the seven suspected "tests that assert bugs"**, the affected test files, the established conventions for writing a test here, coverage gaps, and a rewrite order. Its headline finding (the harness silently discarded every `ctx.filter` write) is now **fixed** — read it to see the shape, not the state | Before writing any code, per the corpus README. Read `src/test/setup.ts` for the current state; read this file for the reasoning behind the conventions                                                                                                                         |
| `08-merge-plan.md`                     | The ownership map, known collisions, merge order, per-merge checklist, cross-cutting state at merge time, and what is deliberately not being fixed                                                                                                                                                                                                                 | **Largely superseded.** It describes a campaign that has since merged into `main`. Use `### Already in flight` above for current branch state                                                                                                                                   |
| `RESEARCH-BRIEF.md`                    | The constraints brief the research itself ran against — the hard rules, repository orientation, and the architecture constraints any recommendation must respect. It is what the research **disproved**, so reading it is how you learn which of your own assumptions came from a premise rather than a source                                                     | When you need to know _why_ a recommendation looks the way it does, or when you are about to write a research brief of your own. **Its `## 10. Open questions / unknowns` and `## Rules for accuracy about the current code` are the two sections to read first**               |

### The corpus's own §10, and the four corrections that change a backlog decision

`01-photoshop-reference.md` §"10" — the corrections log records the premises the research **disproved** — acting on
the original briefing would have produced wrong work. Four of them change what this backlog
should recommend:

1. **"The Polygon Tool is click-to-place-vertices" → it is drag-defined**, inscribing a regular
   n-gon. The real `src/tools/shape.ts` — `const sides = figure === 'triangle' ? 3 : polygonSides(args.sides)` behaviour (`const sides = figure === 'triangle' ? 3 : 5`) is
   therefore _closer_ to right for polygon than the app's own code suggests, and the defect is the
   **Triangle** (drag-defined isosceles, Shift = equilateral), not the polygon. Do not "fix" the
   polygon into a click tool.
2. **"The Triangle Tool draws a regular inscribed triangle" → it is a drag-defined _isosceles_,
   and Shift means equilateral, not aspect-snap.** This makes the `src/tools/shape.ts` — `snapLineGeometry()`'s `if (!shiftKey)` branch Shift-exclusion a
   genuine defect, and it is the sharpest of the four because the app's test pins the current
   behaviour.
3. **"`triangle` lacks `creator: true` while others have it" → inverted.** `rectangle`, `ellipse`,
   and `line` lack it. Any plan that adds `creator: true` to the triangle is fixing the wrong tool;
   check `src/tools/toolProcessors.ts` — the five figure rows' `creator: true`, where all five figure rows _do_ have it now.
4. **"Free Transform is a toolbar tool" / "Levels and Hue/Saturation are toolbar tools" → both
   are commands** (⌘T, and Image ▸ Adjustments), not toolbar slots. So the app's `transform`,
   `levels`, and `color` registrations occupy slots Photoshop does not have. That does not make
   them wrong, but it means **a "make the toolbar match Photoshop slot-for-slot" audit is not a
   valid framing** — and it is the framing that produced the original 29-tool inventory.

Two more, worth one line each because they change _labels_: **"Blur Tool is Illustrator-only" →
Photoshop has a Blur tool** (Tools panel, ~2023+), so the app's `blur` is a real slot, not an
invented one; and **"Black & White has 10 color ranges" → it has 6 sextants** (the 9-range CMYK
model is Selective Color), which is what makes D1 a 6-slider tool with the `saturation` slider
dropped rather than a 10-range one.

And one that is not a correction but a boundary: **`01-photoshop-reference.md` — its "No browser…" boundary claim — "No browser
was executed."** Every support claim in that corpus derives from caniuse / MDN BCD / the WebKit
bug tracker, not from runtime measurement. The `ctx.filter` conclusion (trap 15) is in exactly
that category, which is why the one-line probe at the one-line browser-capability probe it recommends is the thing to run before you
depend on it.

### What I could not verify

- **No suite was run.** No `npm run test`, `npm run tsc`, `npm run build`,
  `npm run test:e2e:unit` or `npm run test:e2e` — the task forbade it. Every claim here is a
  read of the tree, not an execution. No test-pass count in this section is a prediction.
- **No `task` subagent was available in this session's toolset**, so traps 8, 9, and 10
  (`agent_manager` key coercion, missing `subagent_type`, truncated results) are carried as
  reported-by-prior-sessions and marked **[unverified by me]**. I did confirm the
  `~/.local/share/kilo/tool-output/` directory exists.
- **`RESEARCH-BRIEF.md` and the whole corpus are gitignored and local-only.** They exist at
  `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/` and are **not** in this worktree. Everything
  in Appendix B was read from the main checkout.
- **The 20-slot Photoshop toolbar is FROM-MEMORY.** I did not launch a browser to check it
  against Adobe's current toolbar, and the browser rule in `AGENTS.md` forbids a headed one. The app-side
  column of every gap row is verified; the Photoshop column is not.
- **`08-merge-plan.md` and `02-implementation-plan.md` were read for headings and scope only**
  (11 files, ~265 KB). Their `file:line` anchors are against an older revision and I did not
  re-verify any of them.
- **Open citations I dropped rather than guess:** the `#d9c09a` sepia matrix in
  `src/tools/functions.ts`; `PolygonClickToolArea.tsx` — `handlePointerUp()`; `useHistory.test.tsx` — its `vi.mock('../layer-renderer.ts', …)` factory;
  `src/contexts/useCurrentTool.tsx` — `normalizeToolArgs()`; `toolIcons.test.tsx` — the hand-copied `toolIconNames` array; `HANDOFF.md` §45; `draw.ts`'s file
  length and its `src/util/draw.ts` — the `drawSpray(stroke)` dispatch inside `draw()` re-stroke. Each is marked in the correction table. A dropped citation is
  a claim the next session must re-derive, which is cheaper than a wrong one.

## Appendix C — how this document was built, and what to distrust

It was assembled from a playbook that lived on an **unmerged** branch (`docs/ps-tool-playbook`, tip `025470e`), section by section, and every citation was re-derived against the tree as each section landed. That playbook is not on `main`, and the tables that recorded its wrong line numbers one by one are gone: the tree is the authority now, and a list of corrections to a document nobody reads is a list that will itself go stale.

What survives is the four things those passes taught, and they are the reason to distrust any citation in this file.

**A re-verification pass is required after _any_ change to a cited document**, not only to the code the citation points into. A `file:line` is a claim about a _file_, and a file can move its own content around without changing one line of the thing it points at. `AGENTS.md` was restructured and every citation into it became wrong while the code it described stayed byte-identical. Treat a stale `file:line` as a defect **in the same change that made it stale**, and re-derive the claim rather than re-deriving only the number.

**Name a section beside every line.** A heading survives an insertion above it; a line number does not. This document had its `AGENTS.md:NNN` citations invalidated twice in one day by edits that were entirely correct.

**Counts are the same defect wearing a different hat.** A claim about the number of orphans, of pins, of files, of registered tools moves the same way, and it is worse because it reads as precise. If a count is load-bearing, derive it in the same sentence that uses it.

Facts the correction passes established, kept because nothing else records them:

- `tsconfig` sets `noFallthroughCasesInSwitch` without `noImplicitReturns`, so one missing `return` in a `switch` over a tool name is two different enforcement failures depending on which function it lands in.
- `materialization.ts` resolves `processorId` **by lookup**, which is what makes the `raster` commit kind name-agnostic and why a new raster tool needs no history-adapter arm.
- In `useHistory` tests, `renderHook` + `StoreProvider` is a forbidden template — the provider pulls in the durable replay path and does not survive the test environment. Drive the pure function, or mock `useStore` with `vi.hoisted` + `vi.mock`.
- `tool-processors.test.ts` hard-codes **ten** per-tool rosters, not seven. Joining all ten is the largest practical cost of adding a tool.
- In the e2e helpers, `screenshot-scale.ts` is the single owner of the coordinate converters and `canvas-redraw.ts` re-exports them; the guard at `cdp-helpers.ts` — the "do not divide by devicePixelRatio" comment is a **comment block, not a runtime check**; and the call-site budgets (`threshold: 0.01`, `maxDiffPixels: 100`) differ from the `image-comparison.ts` defaults (`0.2` / `100` / `0.01`), so read the call site.
