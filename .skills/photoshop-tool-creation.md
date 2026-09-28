---
name: photoshop-tool-creation
description: Build a new Photoshop-faithful tool in the `ph` photo editor end to end - heavy web and repo research, a real options bar, a commit kind that is durable-replayable without migrating history, implementation, mutation-checked unit tests, e2e, aggressive subagent delegation, and a handoff doc. Use when asked to add, implement, or make a Photoshop tool/options bar in this repo.
---

# Photoshop tool creation

How to add a tool to `ph` that behaves like the Photoshop one, in a git worktree, with
research, tests, e2e, delegation and a handoff behind it.

**`AGENTS.md` is the authority.** This document adds the procedures `AGENTS.md` states but
does not spell out. Where the two disagree, `AGENTS.md` wins and this document is wrong.
Read it first.

Every `file:line` here was re-verified against `main` at `1c9c8de` on 2026-09-28. **Re-verify
before you rely on one**: `AGENTS.md:243-245` says a stale line number sends the next session
after a bug that does not exist, and that is not hypothetical — writing this skill corrected
more than sixty citations inherited from the playbook it was built on.

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
4. **Never weaken a gate to get green.** No skips, no raised thresholds, no deleted assertions,
   no re-recorded visual baselines, no `expect.soft` in place of a hard assert. When a test
   genuinely cannot pass, leave it failing and report the failing assertion. → [Phase 8](#the-one-rule)
5. **Never open a browser window.** Headless only. A headed run fails a disjoint set of tests
   for reasons that are not in the code. → [Phase 0](#never-open-a-browser-window)
6. **A fix removes its own pin.** A test that asserts current broken behaviour is a tripwire;
   the same change inverts it. A handoff entry that has been fixed and verified is deleted,
   never reworded into a closed one. → [Phase 9](#the-lifecycle)
7. **Verify every citation before you commit the handoff.** Adding one import shifts every
   line below it. → [Phase 9](#verify-every-citation-before-you-commit)
8. **Never two subagents on the same file.** Split by concern. The spine of a tool is a small
   set of single-owner files and it stays with you. → [Phase 7](#the-rule-that-actually-matters)

## How to read this document

Read the phase you are in, not the whole thing. Each phase opens by naming the source of
truth it defers to — a `file:line`, a real commit, a recovered brief — so a claim can be
checked rather than believed.

The phase templates are written to be copied into a subagent brief with `<PLACEHOLDERS>`
filled. They are prompts, not prose: the recovered originals are reproduced in the fenced
blocks because the parts that matter (the evidence rules, the locator traps with their
reasons, the report-back contract) are exactly the parts a paraphrase loses.

Provenance — which claims were corrected while assembling this, and what could not be
verified — is in [the provenance appendix](#appendix-c--provenance).

## The three shapes of work

Not every tool is a from-scratch build. Pick the shape first, because it changes Phase 1.

| Shape                                       | What it is                                             | Phase 1 research                                                                                                             | Phases 4-6                                                 |
| ------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **New options bar over an existing commit** | the raster path already works; only the bar is missing | one web brief for the tool's Photoshop controls, one repo brief for the bar contract and the pipeline the control must cross | options-bar component + settings plumbing, no new engine   |
| **New raster tool on `commit: 'raster'`**   | a new `ToolName` with its own kernel                   | both waves, plus the decision table in Phase 3                                                                               | new processor, registry spine, kernel, tests               |
| **A tool whose engine does not exist**      | pen/path, healing, inpaint, live type, 3D, generative  | both waves, and an explicit "is this in scope" note                                                                          | implement the cheap slice honestly and hand off the engine |

The third shape is where a task goes to die. Decide it in Phase 1, write it down, and do not
discover it in Phase 4.

`AGENTS.md` is the authority on every rule restated here (`:110-127` worktrees, `:144-203` gates, `:62-86` the browser rule). This section adds the procedures it states but does not spell out. Every `file:line` was re-verified against `main` at `1c9c8de`; a citation you cannot re-verify sends the next session after a bug that does not exist (`AGENTS.md:243-245`).

---

## Phase 0 — the worktree

One worktree per task, under `.kilo/worktrees/`, forked from `main`.

### 0.1 Create it

```bash
cd /Users/bkalynovskyi/ph                # AGENTS.md:99-100 — a parent dir resolves the wrong package
git status -sb                          # main is a shared surface; expect it dirty
git worktree add -b <branch> .kilo/worktrees/<name> main
```

For a **visible session**, do not use `git worktree add`: call `agent_manager` with `mode: "worktree"` and one task carrying `branchName` and `prompt`. That is the only difference and it is the operator's call — `task` creates no visible session (`AGENTS.md:43-45`).

**Branch name is convention, not policy.** `.kilo/agent-manager.json:2` registers 38 worktrees and only 3 use a `ps/` prefix, so the taxonomy is what sessions happened to type. Use `ps/<tool>-<slug>`, free-checked with `git branch --list 'ps/*'`. **Every registered worktree forks from `main`** (`.kilo/agent-manager.json:6` plus 37 further `parentBranch` entries, all `"main"`) — never from an integration line, which is how a leaf inherits a conflict it did not cause. **The directory name is chosen, not derived**: of 13 registered slash-branch worktrees 3 carry a 16-hex disambiguator (`ps/brush-tip-core` → `ps-brush-tip-core-72c775ad4e905a94`) and 10 do not (`wip/photoshop-fidelity` → `photoshop-fidelity`). A collision makes `git worktree add` fail, not overwrite.

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

`git merge-base --is-ancestor <base> main` answers what the other two cannot: is the recorded branch point still an ancestor of `main`? Non-zero means `main` was rewritten under the branch — stop and report, do not force it. `git log --oneline main..HEAD` is the load-bearing one: any output means the worktree holds commits, so a fast-forward is the wrong operation. `git status --short` must be empty **including untracked**, because an untracked file exists in no commit and no ref (`HANDOFF.md:532-533`). **Never `git reset --hard`, `git checkout -- .`, or `git clean -fd` to "fix" a dirty worktree** — that is data loss with a plausible excuse attached. Report the dirty state.

### 0.3 `.kilo` is gitignored — a new worktree has no plan documents

```bash
git check-ignore -v .kilo   # .gitignore:34:.kilo	.kilo
git ls-files .kilo | wc -l  # 0
```

`.gitignore:34` ignores `.kilo` and `:35` ignores `.serena`, so `git worktree add` checks out **nothing** under `.kilo`: no `plans/`, no skills, no `agent-manager.json`. A fresh worktree has no `ps-research/08-merge-plan.md`, no `RESEARCH-BRIEF.md`, no `04-blend-modes-and-brush-spec.md`. The file that owns the merge gate simply is not there, and this has bitten real sessions. Two workarounds:

```bash
less /Users/bkalynovskyi/ph/.kilo/plans/ps-research/08-merge-plan.md

mkdir -p .kilo/plans/ps-research
cp /Users/bkalynovskyi/ph/.kilo/plans/ps-research/{08-merge-plan,RESEARCH-BRIEF}.md .kilo/plans/ps-research/
```

Never copy the whole tree: `agent-manager.json` is UI/recovery state the extension writes, and a second copy in a worktree is one it will overwrite. A handoff doc is **not** gitignored — `docs/handoffs/` is tracked (existing example: `docs/handoffs/ps-transform-geometry-review-and-merge.md`), so write that one in the worktree, on the branch, in the same commit as the finding (`AGENTS.md:256-260`).

### 0.4 `node_modules` is usually missing or empty

`AGENTS.md:115-120` says "empty or missing in most worktrees". Measured across the 106 directories under `.kilo/worktrees/`: **22 have no `node_modules` at all, 64 have an empty one, 20 are populated** — 86 of 106 cannot resolve a package. The trap is that this _mostly works_: Node walks up to the ancestor checkout, so `tsc` and `vitest` resolve from `/Users/bkalynovskyi/ph/node_modules` and report success. That is what makes it misleading — the tool runs against the parent's dependency tree, so lockfile skew between the two checkouts stays invisible until it is not.

**Vite does not walk up.** It serves only what `server.fs.allow` permits, so fonts, images and AVIF assets that resolve in the root checkout **404 in a worktree**. If an asset will not load, run `npm ci` in the worktree before investigating anything else — it removes the most common false "the code is broken" conclusion. It does not license a dependency change: `package.json` and `package-lock.json` must be unchanged (`08-merge-plan.md:84`).

### 0.5 The Playwright port

Every worktree's dev server wants `:5173` and `reuseExistingServer` is on locally, so `npm run test:e2e` can attach to a server **another worktree started** and test that checkout. "My change did nothing" is this, not a cache (`AGENTS.md:121-124`).

```ts
// playwright.config.ts:21-22
const port = process.env.PLAYWRIGHT_PORT ?? '5173';
const baseUrl = `http://localhost:${port}`;

// playwright.config.ts:118-119
reuseExistingServer:
  process.env.CI || process.env.PLAYWRIGHT_PORT ? false : process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER !== 'false',
```

Read the condition left to right. `PLAYWRIGHT_PORT` does **two** things: it moves the port, and because it is set it also forces `reuseExistingServer: false`. `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` does only the second, leaving the port at 5173, where a stale server turns the `--strictPort` at `playwright.config.ts:111` into a startup failure. **Prefer `PLAYWRIGHT_PORT`** — one variable, both effects. `AGENTS.md:123` documents only the weaker one; `playwright.config.ts:118-119` is what the code does. Local runs are also sequential — `workers: 1` outside CI (`playwright.config.ts:42`) — so two local runs cannot fight over one app instance.

```bash
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<name>
PLAYWRIGHT_PORT=5199 npm run test:e2e
```

Pick a port nobody has claimed.

### 0.6 Main is not stable while you work

Other sessions commit into `main` concurrently (`AGENTS.md:125-127`). Re-read the state immediately before staging, and stage only your own paths.

```bash
cd /Users/bkalynovskyi/ph
git status --short
git diff
git add <explicit/path/one> <explicit/path/two>   # never `git add -A`
git diff --cached --stat                          # read this: it is what you are about to commit
```

`git add -A` in a shared checkout stages another session's in-flight work under your commit message, with no clean undo once pushed. At the time of writing `main` carries an untracked `.output.txt` that is nobody's yours — a `git status` line, not a problem. **One investigation to skip:** `.eslintcache` and `.serena/` appear in and disappear from `git status` across sessions because a fast-forward brought a new `.gitignore` line (`.gitignore:32,34,35`, added by `98594e8` and `f0b939f`); run `git check-ignore -v` before treating either as another session's work.

### 0.7 Never open a browser window

`AGENTS.md:62-86`: a headed browser puts a live, clickable window on the operator's screen for the whole run, and their input reaches the page indistinguishably from the suite's own `page.mouse` calls. Blocked outright — `playwright test --headed` · `--ui` · `--debug` · `playwright show-report` · `show-trace` · `codegen` / `open` · `PLAYWRIGHT_ALLOW_HEADED=1` · `test.use({ headless: false })`. Two layers enforce it and you should name both: `kilo.jsonc` denies most at the permission layer, including the npm script spellings, with `--debug` / `test:e2e:debug` set to `ask` rather than `deny` (`e2e/README.md:69-76`); and `e2e/global-setup.ts:44-45` returns only for `PLAYWRIGHT_ALLOW_HEADED === '1'`, with `:53-55` rejecting the three flags by name, `:59-61` any project resolved to `headless: false`, and `:67` throwing before a window exists.

`npm run test:e2e:headed` (`package.json:22`) sets that variable and prints a warning. **That is the operator's command, not yours**; if something only reproduces visually, ask them to run it. To unblock a run without a window, add `--retries=1` so `trace: 'on-first-retry'` yields a trace file, and read the failure PNG from the test's own `outputDir` under `test-results/` (`screenshot: 'only-on-failure'`, `playwright.config.ts:87`).

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

Model fields on every research dispatch — omitting them inherits the parent turn's model,
which is usually a paid one:

```ts
task({
  subagent_type: 'general', // 'general' for Wave A, 'explore' for Wave B
  model: 'Space Bunny Alpha (new)',
  provider: 'kilo',
  variant: 'max',
  prompt: `...`,
});
```

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

ALREADY-VERIFIED FACTS about this repo (confirmed by direct code reading — trust these, cite file:line):
- `src/tools/shape.ts:5` — `FigureType = 'line' | 'rectangle' | 'oval' | 'triangle' | 'polygon'`.
- `src/tools/shape.ts:32-47` — `ShapeToolArgs` declares `toolMode?: 'shape'|'path'|'pixels'`, `hasFill?: boolean`, `lineCap?`, `cornerRadius?`, `lineDash?`, `start?: Point`, `end?: Point`.
- `src/tools/settings.ts:59-65` — the shape default sets `backgroundColor: null` and there is NO `hasFill` in the defaults, so determine empirically whether fill works at all today.
- `src/tools/shape.ts:71-99` `normalizeShapeGeometry` implements Shift (aspect snap) and Alt (draw from center). Verify against Photoshop's exact semantics.
- `src/tools/shape.ts:161-180` — the `figure === 'triangle' || figure === 'polygon'` branch hardcodes `const sides = figure === 'triangle' ? 3 : 5` and inscribes a REGULAR n-gon in the drag box.
- `src/tools/shape.ts:181-192` — `cornerRadius` is applied only to `rectangle`, never to `oval` (this is correct Photoshop behavior — verify).
- `src/tools/shape.ts:9-27` — `legacyFigureMap` maps legacy `circle`->`oval` and `square`->`rectangle`, encoding that Circle and Square are Shift-constrained outcomes, not separate tools.
- `src/tools/toolProcessors.ts:216` — `triangle` is registered `commit: 'source'` WITHOUT `creator: true`, while `shape`, `polygon`, and `line` have `creator: true`. Investigate whether this is a real inconsistency.
- `src/tools/toolProcessors.ts:219-223` — `custom-shape` is `commit: 'unimplemented'` with `imageProcessor: unimplemented` (returns `[null]`); its `ToolArgsByName` entry in `src/contexts/tool-types.ts:55` is just `{ toolName: 'custom-shape' }`; `src/tools/toolsMap.ts:118-122` renders a `PlaceholderTool` with a TODO badge. It IS in `toolbar-mapping.ts` and `availableTools`, so it is user-selectable and does nothing.

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

- **`e2e/README.md` quoted verbatim** (415 lines; the headless rule is at
  `e2e/README.md:29`: _"`npm run test:e2e` is **headless by default. Keep it that way.**"_).
  A summary of the rules is not the rules. The verbatim quote is what stops the new spec from
  reintroducing `--headed`, a wrong `testDir`, or an unquarantined flake.
- **`e2e/OPEN_PROBLEMS.md` entries enumerated** (363 lines; sections `## Observed failures`
  at `e2e/OPEN_PROBLEMS.md:36`, `## Known-skip tests` at `:308`, `## Verified and still
unverified` at `:318`). A new spec that trips a latent known defect is a new defect, not a
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
7. The pointer pipeline: read `src/hooks/usePointerPosition.ts` and `src/hooks/useDrag.ts`. Report what pointer data is threaded through and whether `pressure` survives.
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
   aspect-snap. The app's `src/tools/shape.ts:161-180`-era code inscribed a regular triangle
   in the drag box, so this is a live divergence, not a documentation nicety.
4. **The Line Tool snaps to 45°, not 15°.** The 15° figure is the _Free Transform rotate_
   snap, conflated from a different feature.

A fifth correction is repo-side and has since been fixed, so it is listed here only because
it is the shape of the mistake worth avoiding: the premise "`triangle` lacks `creator: true`
while `shape`, `polygon` and `line` have it" was **inverted** — it was `rectangle`, `ellipse`
and `line` that lacked it. That was a real defect (`materialization.ts` threw for three of the
five most-used shape tools) and it is now **fixed and pinned**: all five figure tools carry
`creator: true` at `src/tools/toolProcessors.ts:220-224`, and
`src/tools/__tests__/tool-processors.test.ts:146-157` derives the family from the processor
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
campaign's register, from `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/README.md:20-28`:

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
(`src/tools/toolProcessors.ts:165-172` commits `commit: 'raster'` and rasterizes the stroke
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
| **[00-tool-inventory.md](./00-tool-inventory.md)**                         | All 29 registered tools vs. Photoshop, with honest status and the five highest-impact findings             | First, for orientation             |
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

**`.kilo` is gitignored, so the doc set never reaches a worktree.** The rule is `.gitignore:34`
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

These are the ten constraints from `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/RESEARCH-BRIEF.md:51-80`
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
   the code: `AssetOwnership = 'adopt' | 'borrow'` at `src/contexts/asset-registry.ts:6`.)
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
entry). Both are live in this repo: `src/tools/toolProcessors.ts:75` is
`const unimplemented = () => () => [null as never] as ToolResult;`, the shape of a no-op that
consumes a history entry, and a tool that renders nothing while writing history is the exact
failure mode constraints 3 and 8 exist to prevent.

## Phase 2 — make the tool look like Photoshop

This is the phase a reader is most likely to copy line for line, so every template
below is written against the working tree at `1c9c8de` and every `file:line` in it
was re-verified now. Where a claim comes from the unmerged `brush-toolbar` branch it
is cited `brush-toolbar:<path>` and marked as a reference implementation, not as
current code. `src/components/ToolbarsRight/**` does not render on the right — the
directory name is legacy; those components are the **Photoshop options bar body**,
mounted at the top of the workspace by `ToolbarHorizontal`.

### The rule that governs the whole phase

**A control ships only if it reaches the renderer.**

A slider that changes a readout and nothing else is worse than an absent one, because
it is a lie about the product: the user moves it, the number changes, the canvas does
not, and the only way to learn that is to draw. A control that needs an engine this
build does not have is written up in `HANDOFF.md` as named work with the call counts it
would break, and is absent from the bar.

The shipped reference proves the rule in both directions. On `brush-toolbar` the
brush and pencil bars published exactly four settings — Size → `ctx.lineWidth`
(`src/tools/draw.ts:32`), Opacity → `ctx.globalAlpha` (`:35`), Smoothing → a new
point-space filter over the sampled polyline, Mode → a new per-layer blend mode
resolved when the layer is created — and each one terminates in pixels. Everything
else Photoshop puts on that bar (Hardness, Spacing, Flow, Airbrush, Scatter, Jitter,
Wet Edges, Texture, Angle/Roundness, Symmetry, and the Pencil's Auto Erase) was left out
and written up with named fixes in `brush-toolbar:HANDOFF.md` items 36-41. Nothing
about that choice is negotiable in review: a reviewer who finds a fifth slider with no
renderer behind it is right, and the fix is to delete the slider and open a handoff
item.

The `brush-toolbar` commit message names the four settings, so read it before you
re-derive anything. Check the claim mechanically first — search the tree for a
setting's name and count the hits outside the options bar:

```
$ grep -rni "hardness\|spacing\|airbrush\|scatter" src/ --include='*.ts' --include='*.tsx' | grep -v __tests__
src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:2:  brush: [..., 'Flow', 'Airbrush', ...]
```

One hit, and it is a string in the placeholder card. That is the shape of
`absent-in-ph`: the name survives only as a label on a card that admits it is not
implemented.

### The options bar component

#### The contract

A tool-options component must:

1. Be typed `ToolbarRightComponent` (`src/components/ToolbarsRight/types.ts:3`, which
   is `React.FC<{}>` — no props, it reads the store).
2. Be registered as the `toolboxComponent` of its tool in `toolsMap`
   (`src/tools/toolsMap.ts:33-39`, which types the map as
   `Record<ToolName, ToolProcessorDefinition & { icon: string; toolboxComponent: ToolbarRightComponent }>`,
   so the field is mandatory and exhaustively typed).
3. Read its own state through the type-safe pair `getToolArgs` / `patchToolArgs` from
   `useCurrentTool` (`src/contexts/useCurrentTool.tsx:14-15`), **not** through a cast.
   `MagicWand.tsx:10,16-17` is the current idiom:

   ```tsx
   const { getToolArgs, patchToolArgs } = useCurrentTool();
   const args = getToolArgs('magic-wand');
   if (!args) return null;
   ```

   The older bars use `toolArgs as DrawToolArgs` + `setToolArgs({ ...args, x })`
   (`Draw.tsx:15,19,41-42`, `Shape.tsx:22,25`). Match the new idiom for new tools.

4. Put the foreground colour into the tool's own args. The store's `color` is what a
   paint stroke should use, and nothing else carries it across — without the sync
   effect a brush is frozen on its `#000000` default however the swatch is set.
   `Draw.tsx:29-33` does this for the legacy pen; every new paint bar must do it for
   itself.
5. Give **every** control a real `<label htmlFor>` + `id` + visible text. That is the
   only reason the control is reachable from e2e, and it is pinned in two directions:
   `Crop.test.tsx:258-266` proves the accessible name comes from `htmlFor` + `id` plus
   the rendered text, and `Crop.test.tsx:268` is an `it.fails` pin asserting that
   adding an `aria-label` to a select that already has `htmlFor` + `id` is not the house
   pattern.

#### Where it mounts

`ToolbarHorizontal.tsx` is thirty lines and does one thing: read
`{ hasImage, toolName }` from the store (`:5`), bail to an empty bar when either is
missing (`:7-11`), look the component up in `toolsMap` **through a `?.`** (`:13`), bail
to a `TODO: unregistered tool placeholder` strip when the lookup fails (`:15-21`), and
otherwise render `<ToolComponent key={toolName} />` inside the bar chrome (`:23-27`).
Four consequences you have to design around:

- **The bar renders only when the store has `hasImage` AND a `toolName`** (`:7`;
  pinned at
  `src/components/ToolbarHorizontal/__tests__/ToolbarHorizontal.test.tsx:83-89`).
- **A tool missing from `toolsMap` shows a TODO strip instead of failing** (`:13-21`,
  pinned at `ToolbarHorizontal.test.tsx:62-68`). Registering the component is a
  separate, easily-forgotten step.
- **`key={toolName}`** (`:25`) is a hard remount on every tool switch. Local component
  state does not survive a switch; anything that must survive belongs in the tool's
  args, which is what the settings section is about.
- The chrome class string is repeated verbatim in all three branches (`:9,17,24`).
  `overflow-visible` is load-bearing: it lets tooltips and flyouts escape the bar. Do
  not "simplify" it.

#### A complete, compiling example

`Color Replacement` is the right worked example at `1c9c8de`: it has a real renderer
(`src/tools/toolProcessors.ts:186-193` → `draw(..., 'spray')` →
`src/util/draw.ts:106-126`), real args (`PaintToolArgs`, `src/tools/draw.ts:20-22`),
real defaults (`src/tools/settings.ts:130-137`), and it is still a placeholder card
(`src/tools/toolsMap.ts:82-86`). Replacing that card is the whole task. The bar
publishes **two** controls, because two reach the renderer: `lineWidth` becomes the
spray radius at `src/util/draw.ts:114` and `alpha` the gradient stop at `:112`.
Photoshop's `Mode`, `Tolerance` and the three sampling icons are absent, and the
placeholder card still names them (`toolbarPlaceholderConfig.ts:4`).

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
forces one (`src/tools/toolProcessors.ts:169` forces `'pen'` for brush, `:182` forces
`'spray'` for color replacement), and a factory that hides that renders a preview the
canvas never produces. The second cost is the shared class constants: three tools with
genuinely different densities either grow a `Record<PaintToolName, string>` of class
strings or fork the file. Fork the file before you build the table. Use the factory
while the tools differ **only by name and defaults**; the moment one tool needs a
control the other must not show, a `toolName === 'brush' &&` inside the shared body is
the moment two components become cheaper.

### Control conventions

There is no form-control library, and `src/components/Common/**` is not where the
vocabulary lives. The house patterns, all verified in-tree:

| Affordance          | House pattern                                                                                                                                                                                                                            | Reference                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Slider + value      | `<label htmlFor>` + `id`, value inline in a `font-bold` span (`{brushSize}px`, `{Math.round(alpha * 100)}%`, `{rotate}°`), `input type="range"` with `h-1.5 w-NN cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700` | `Draw.tsx:134-152,140,202`    |
| Buttons             | `PRIMARY_BUTTON` / `SECONDARY_BUTTON` from `buttonStyles.ts`                                                                                                                                                                             | `buttonStyles.ts:10-11,25-26` |
| Segmented control   | adjacent `TOGGLE_BUTTON_ACTIVE` / `TOGGLE_BUTTON_INACTIVE`                                                                                                                                                                               | `buttonStyles.ts:41-44`       |
| Dropdown            | plain `<select>` with a real `htmlFor` + `id`                                                                                                                                                                                            | `Draw.tsx:119-131`            |
| Checkbox            | `type="checkbox" className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"`                                                                                                                                      | `Shape.tsx:204-210`           |
| Crowded row         | root becomes `flex h-full flex-row items-center gap-5 overflow-x-auto`                                                                                                                                                                   | `MagicWand.tsx:53`            |
| Hint / live readout | `text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800`, holding a value from live state such as `selectedPixelCount.toLocaleString()`               | `MagicWand.tsx:104-109`       |
| Preview swatch      | a fixed 96×48 `<canvas>` over a `chessboard-*` class, fed by the tool's own renderer                                                                                                                                                     | `Draw.tsx:216-222`            |

**No i18n exists.** Every label is a hardcoded English literal. Do not introduce keys.

**There is no numeric scrub field, no segmented-button component, no gradient picker,
no brush-preset popup grid, no blend-mode dropdown.** The foreground / background
swatch is a hand-positioned `div` plus a hidden `input type="color"`
(`src/components/SidebarLeft/SidebarLeft.tsx:365-398`). If your tool needs one of
those you are building it for the first time: factor it into `buttonStyles.ts`-style
constants rather than inlining a third copy of `SLIDER_CLASS`. The preview canvas
carries no `aria-label` and no `title`, pinned on purpose
(`src/components/ToolbarsRight/Draw/__tests__/Draw.test.tsx:548-549`).

#### The accessible-name contract

Every control is a `<label>` that _wraps_ its input and carries `htmlFor`, so the
control's accessible name is the label's whole text content, value suffix included.
For `<label htmlFor="color-replacement-size">Size <span>{Math.round(args.lineWidth)}px</span><input …/></label>`
the input's name is **`Size 10px`** at `lineWidth: 10` and **`Size 24px`** after the
user drags it. `Opacity 90%`, `Tolerance 28%` and `Smooth 1.5px` follow the same rule;
a `<select>` with no suffix is just `Mode`. Three consequences:

- **Exact-name locators are brittle.** A spec asking for `'Size 10px'` passes until
  someone moves the slider. Every in-repo spec uses a prefix regex or a bare label for
  this reason: `e2e/levels.spec.ts:88` is
  `page.getByRole('slider', { name: /Brightness/ })`, `e2e/pen-types.spec.ts:85` is
  `page.getByRole('combobox', { name: 'Pen Type' })` — bare, because that select has no
  suffix. Unit tests do the same: `MagicWand.test.tsx:153-154` is
  `getByLabelText(/Tolerance/)`, not `'Tolerance 28%'`.
- **The suffix is not decoration.** It is the only place the current value is legible
  without moving the pointer, and it is what makes the control's state assertable from
  a screenshot.
- **Never add an `aria-label` to a control that already has `htmlFor` + `id`.** That is
  an `it.fails` pin (`Crop.test.tsx:268`), and a control carrying both announces
  whichever wins.

#### The control set, and whether it reaches this renderer

Photoshop's display label, the control type, Photoshop's default and range, and the
verdict for **this** app. This table is the one to read before promising a control to
anyone.

| Control             | Type                    | PS default  | PS range                          | Status here                                                                     | Evidence                                                                                                                                                                                                                                    |
| ------------------- | ----------------------- | ----------- | --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brush Preset picker | thumbnail popup         | last used   | n/a                               | `absent-in-ph`                                                                  | named as a placeholder string only, `toolbarPlaceholderConfig.ts:2`; no preset registry in `src/tools/`                                                                                                                                     |
| Size                | slider, integer px      | 30 px       | 1-5000                            | `plumbed` (ceiling 500)                                                         | `src/tools/draw.ts:32` `ctx.lineWidth = lineWidth`; spray radius `src/util/draw.ts:114`; bar `Draw.tsx:134-152` uses 0.5-500                                                                                                                |
| Mode                | dropdown of blend modes | Normal      | 27 modes                          | `needs-engine`                                                                  | `Layer.blendMode` exists and is honoured at `src/contexts/layer-renderer.ts:96`, but `createLayerSource` hardcodes `'source-over'` (`src/contexts/layer-utils.ts:173`) and no tool arg carries a blend field                                |
| Opacity             | slider, percent         | 100%        | 0-100                             | `plumbed`                                                                       | `src/tools/draw.ts:35` `ctx.globalAlpha = alpha`; spray stop `src/util/draw.ts:112`; bars `Draw.tsx:196-214`, `Levels.tsx:100-117`                                                                                                          |
| Flow                | slider, percent         | 100%        | 1-100                             | `needs-engine`                                                                  | `setupDrawCtx` sets `globalAlpha` once per stroke (`src/tools/draw.ts:26-41`, called at `:49`); per-dab accumulation needs a stamp loop                                                                                                     |
| Feather             | slider, px              | 0 px        | 0-250                             | `plumbed` for `feather-magnetic-lasso`                                          | `featherRadius` default 12 (`src/tools/settings.ts:97`) → `src/util/selection.ts:633-635` `featheredBoundsPadding(antiAlias, featherRadius)`                                                                                                |
| Tolerance           | slider, integer         | 32          | 0-255                             | `plumbed` for `magic-wand`                                                      | `src/components/Main/MagicWandToolArea.tsx:57,75` → `src/util/magicWand.ts:332` `getToleranceDistance(options.tolerance ?? 0)`                                                                                                              |
| Anti-alias          | checkbox                | on          | on/off                            | `plumbed` for `feather-magnetic-lasso`                                          | `antiAlias: true` (`src/tools/settings.ts:103`) → `src/util/selection.ts:581,612`                                                                                                                                                           |
| Smoothing           | slider, percent         | 10% (brush) | 0-100                             | `plumbed` for `magic-wand` / `feather-magnetic-lasso`; `absent-in-ph` for brush | magic-wand as `Smooth` px (`MagicWand.tsx:71-86` → `src/util/magicWand.ts:350` `simplifyClosedPath`); lasso as px (`src/components/Main/FeatherMagneticLassoToolArea.tsx:380`); `DrawToolArgs` has no such field (`src/tools/draw.ts:7-16`) |
| Style / Ratio       | dropdown + W/H fields   | Normal      | Normal / Fixed Ratio / Fixed Size | `plumbed` for `crop` only                                                       | `CropToolArgs.aspectRatio` default `null` (`src/tools/settings.ts:51`); `RectangularSelectionToolArgs` is `{ rect?, toolName }` only (`src/tools/rectangularSelection.ts:4-7`) and its bar has no style control                             |
| Dodge / Exposure    | slider, stops           | 0.00        | ±20.00                            | `absent-in-ph`                                                                  | no dodge tool is registered; `toolbar-mapping.ts:37-84` has no slot for Photoshop's 14 (Dodge/Burn/Sponge)                                                                                                                                  |
| Spacing             | slider, percent         | 25%         | 1-200                             | `needs-engine`                                                                  | `drawPen` issues one `beginPath` + one `stroke()` per stroke (`src/util/draw.ts:96-104`); point density along a single path is not a spacing interval                                                                                       |
| Hardness            | slider, percent         | 100%        | 0-100                             | `needs-engine`                                                                  | the edge is whatever `ctx.stroke()` produces; `setupDrawCtx` sets no gradient or shadow (`src/tools/draw.ts:26-41`)                                                                                                                         |

Read the `needs-engine` rows as work, not as blockers. `Mode` is the cheapest of the
three: the field, the renderer and the guard all exist, and only the plumbing from a
tool arg into `createLayerSource` is missing. `Flow` and `Hardness` both need the
stamp loop in `brush-toolbar:HANDOFF.md` item 36, a rewrite of `drawPen` rather than a
wiring job. That branch's item 40 is worth reading before you add any control bound to
a live pointer: `setupDrawCtx` runs on `pointerdown` only, so a control changed
mid-gesture is honoured in the committed pixels and ignored in the preview. The stroke
the user watched is not the stroke they get.

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
predicate for "this panel's discard has something to discard" (`Levels.tsx:52-60`
explains the read). `disabled:opacity-50` is on the button class because
`SECONDARY_BUTTON` alone does not dim
(`src/components/ToolbarsRight/buttonStyles.ts:25-26`) — a disabled control that
_looks_ enabled is a third state, and it is the worst one. The same shape appears in
`MagicWand.tsx:89-101`, where Copy, Paste and Clear each gate on a distinct fact.

**Hidden is a different answer, and sometimes the right one.** The Shape bar _hides_
the Dash and Gap sliders unless the Dashed checkbox is on (`Shape.tsx:232-236`), pinned
by `src/components/ToolbarsRight/Figures/__tests__/Shape.test.tsx:265`: a dash pattern
is meaningless for a solid stroke, and a live slider for it would be the lie. So: part
of the tool and not honoured → **disabled**, with a `title` saying why; meaningless in
the current mode → **hidden**; part of the tool and honoured → **live**, the only
third option, and the reason the rule exists.

### Flyout and toolbar placement

`toolbarMap` is data, at the **repo root**: `toolbar-mapping.ts:37-84`, terminated
`as const satisfies readonly (readonly ToolbarToolGroup[])[]` (`:84`). Shape is
`sections → flyout groups → tools`; each nested array is one flyout, and **the first
entry is the tile's identity** (`src/components/SidebarLeft/SidebarLeft.tsx:153`).
Adding a tool takes two edits here and nothing else: append a
`{ label, name, shortcut? }` entry to the flyout group that owns the slot, and append
the same `name` to `availableTools` (`:86-116`).

Choose the section by Photoshop's own grouping. The canonical 20 slots are in
`.kilo/plans/ps-research/03-ui-chrome-spec.md` §1.1: Move/Marquee/Lasso/Quick
Selection, Crop, Eyedropper, Healing, **Brush/Pencil/Color Replacement**, Clone Stamp,
History Brush, Eraser, Paint Bucket, Blur, **Dodge/Burn/Sponge**, Pen, Type, Path
Selection, Shape, Hand, Zoom. A new paint tool goes in the Brush section
(`toolbar-mapping.ts:56-64`); a new tonal tool goes where slot 14 would sit, which
`toolbarMap` lacks — see the trap below before you add a section.

**Two traps here are load-bearing.** **Flyout test ids are positional**:
`tool-flyout-${groupIndex}` (`SidebarLeft.tsx:276`) and
`tool-flyout-item-${name}-${slug}` (`:299`), where the group index is
`${sectionIndex}-${groupIndex}` in one-column mode (`:353`) and
`two-column-${groupIndex}` in two-column mode (`:358`). Inserting a group anywhere in
`toolbarMap` renumbers every later section and silently invalidates any spec that
hard-codes a flyout id, so append inside the last section when you can. And **the
primary tile is `group[0]`** (`:153`), so reordering a group's first item also changes
what a plain click selects.

`slugifyToolLabel` (`toolbar-mapping.ts:28`) is deliberately duplicated as
`generateSlug` in the e2e helper and compared by a unit test. Do not tidy one side into
an import of the other — the duplication is the test. `shortcut` is **display-only**:
it reaches the tooltip (`SidebarLeft.tsx:165`) and the `<kbd>` chip (`:303`) and binds
nothing; the real binding is a separate `useKeyDownShortcut` call.

#### The figure-name convention

The five shape entries are the clearest existing example of a naming rule you will need
again. `toolbar-mapping.ts:75-82` gives all five the **same** `name: 'shape'` and
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
(`SidebarLeft.tsx:137-140`: `if (tool.figure) patchToolArgs('shape', { figure: tool.figure })`),
and selection is read back through both (`SidebarLeft.tsx:134-135`).

Yet `rectangle`, `ellipse`, `triangle`, `polygon` and `line` are still real
`ToolName`s, with entries in `availableTools` (`toolbar-mapping.ts:96-100`),
`toolsMap` (`src/tools/toolsMap.ts:113-117`), `defaultSettings`
(`src/tools/settings.ts:144-178`) and `saveLastSettings`
(`src/util/settings.ts:66-70`). **The `Record<ToolName, …>` types are what force
them to exist.** `ToolName = keyof ToolArgsByName`, and `ToolArgsByName` declares each
one with a narrowed figure (`src/contexts/tool-types.ts:41-54`, e.g.
`figure: Extract<FigureType, 'rectangle'>`). From there the requirement cascades
through `toolProcessors: Record<ToolName, ToolProcessorDefinition>`
(`src/tools/toolProcessors.ts:77`), `toolsMap: ToolsMap` (`toolsMap.ts:41`),
`defaultSettings … satisfies ToolArgsByName` (`settings.ts:35,180`) and the `never`
sentinel in `saveLastSettings` (`src/util/settings.ts:81`). Add a member to
`ToolArgsByName` and every one of those fails to compile until it is handled.

They are **registry-only names**: no `toolbarMap` entry selects one, and the shape
test pins that the mapping never mentions `circle` or `square` at all
(`src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts:112-124`). They exist
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
`src/components/SidebarLeft/icons/IconShell.tsx:11-23`, which hard-codes
`viewBox="0 0 32 32"`, `className="h-7 w-7 overflow-visible"`, `fill="none"`,
`aria-hidden="true"`, and exports `STROKE = 'currentColor'` (`:4`). A new icon written
on 32×32 coordinates is correct **for this repo**; a 20×20 icon authored against
Adobe's published number and dropped into this shell is squashed to 56% and will look
it. A new icon is three edits, not one — the component, the `ToolIconName` union member
(`src/components/SidebarLeft/types.ts:3-37`), and the registry entry:

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
test** at `src/components/SidebarLeft/__tests__/toolIcons.test.tsx:25-60` — extend
that copy too, or the test fails on a union the typecheck accepts. And the
`icon: string` field on each `toolsMap` entry (`toolsMap.ts:36`) is a separate string
that **no production code reads**; `SidebarLeft` resolves the glyph through
`toolIcons[tool.name]` (`SidebarLeft.tsx:131`) with an unchecked index that typechecks
only because `ToolName ⊂ ToolIconName` today. Set both, or neither. Selected / hover
states are **not** the icon's job either: they are the tile's class constants —
`TOOL_BUTTON_BASE_CLASS`, `TOOL_BUTTON_ACTIVE_CLASS`, `TOOL_BUTTON_INACTIVE_CLASS`
(`SidebarLeft.tsx:9-16`), applied at `:171`. An icon that hard-codes its own hover
colour fights them.

### Cursor

**There is no cursor registry.** Each tool area hard-codes a class on its own root
div, and `Main.scss:12-38` holds the whole set: `.cursor-draw` and `.cursor-crop`
(crosshair), `.cursor-text`, `.cursor-move` (pointer), `.cursor-grab` /
`.cursor-grabbing` (`!important`, mirrored globally in `src/index.scss:57-59`),
`.cursor-pointer`. Several areas use Tailwind's `cursor-crosshair` directly instead
(`MagicWandToolArea.tsx:116`, `RectangularSelectionToolArea.tsx:96`,
`PolygonClickToolArea.tsx:794`, `FeatherMagneticLassoToolArea.tsx:587`). Resize handles
are imperative via `CURSOR_MAP` (`src/util/constants.ts:5-15`).

**There is no brush-size cursor overlay on the canvas.** The only size preview is the
fixed 96×48 canvas in the options bar (`Draw.tsx:216-222`). Photoshop's Normal Brush
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
(`src/tools/settings.ts:35-180`, closed by `satisfies ToolArgsByName` at `:180`), the
live record `lastSavedSettings = cloneDeep(defaultSettings)` (`:199`), the write
`saveLastSettings` (`src/util/settings.ts:20-83`, called from `useCurrentTool.tsx:71`
on **every** `setToolArgs`), and the read `cloneSavedToolArgs`
(`useCurrentTool.tsx:33-35`). Because the write runs on the same tick as the slider's
own `onChange`, the defect below is possible.

#### The defect class that bit a real build

`saveLastSettings` is an `if/else` chain over tool names, and one of its arms collapsed
every paint tool's args to a bare name:

```ts
// src/util/settings.ts:53-65, as of 1c9c8de — still open
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
(`src/tools/draw.ts:20-22`). The sequence: the bar writes `lineWidth: 24` via
`patchToolArgs`; `_setToolArgs` calls `saveLastSettings` on the same tick
(`useCurrentTool.tsx:71`) and the arm above throws the value away; switching tools
replaces the provider's in-memory args (`useCurrentTool.tsx:51`); and switching back
reads `lastSavedSettings.brush`, which is `{ toolName: 'brush' }` — no `lineWidth`, no
`alpha`, no `color`. The sliders appear to work and reset themselves the moment the
user looks away.

**The test that let it through asserted the wrong thing.**
`src/tools/__tests__/tool-settings.test.ts:255-268`
(`persists every registered tool name, so the chain cannot drop one`) deletes each key,
calls `saveLastSettings`, and asserts the key came back. A bare `{ toolName }`
recreates the key perfectly; the test was green the whole time every value was being
discarded. Worse, `:228-234` (`collapses tools without a settings UI down to their tool
name`) now _pins_ the collapse for the tools that are correct, and the arm is shared
with them — so deleting the defect means splitting the arm, not loosening the test.

**The rule: assert the VALUES survive a tool switch, not the key.** The shape that
catches it is in `src/util/__tests__/settings.test.ts:42-46` — a `switchToTool` helper
that mirrors the provider's deep clone of `lastSavedSettings[toolName]` — used by the
`saveLastSettings across a tool switch` block (`:301-354`). A new tool gets one case
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
`points` emptied the way `draw` empties it (`:27`):

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
entries (`:57-65`); every number finite, no `NaN` or `Infinity` (`:320-328`); every
`alpha` inside 0..1 (`:330-340`); every non-null colour matching
`/^#[0-9A-Fa-f]{6}$/` (`:342-351`); a `commit: 'unimplemented'` tool's default exactly
`{ toolName }` (`:362-368`); each entry stamped with its own key as `toolName` (`:51-55`)
and the key set matching `toolProcessors` (`:47-49`); mutable collections seeded empty
(`:67-76`). The `'unimplemented'` rule is what makes the settings arm above
non-negotiable: give a paint tool full args and you must also have moved it off
`'unimplemented'`.

And the trap that keeps a new tool from falling off the end of the chain:

```ts
// src/util/settings.ts:77-83
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

Verified against `main` at `1c9c8de` in the worktree `.kilo/worktrees/skill-ps-tool` on
2026-09-28. Every `file:line` below was read in that tree. Re-read them before you edit:
`AGENTS.md:238-246` says of handoff docs "Verify every claim against the working tree
first — stale line numbers send the next session after a bug that does not exist."

Read `AGENTS.md` first. It is the authority on commands, gates, the headed-browser
refusal, and the handoff lifecycle. This section assumes it.

---

### What the operator is actually asking for

An operator who says "strip the undoable requirement" is not asking you to delete undo.
They are asking you **not to spend their task migrating the history system**. They have
read `HANDOFF.md:55-96` ("P0 — the durable replay path has no production caller") and
they do not want their tool to be the reason that file grows.

> **The reframe.** You are not removing undo. You are **choosing a `commit` kind whose
> durable representation is already generic**, and you are making the new tool's settings
> **ride the existing `args` channel** so legacy replay, undo/redo and the durable shadow
> cannot disagree. Undoability then arrives with the tool.

Both halves are load-bearing, and the second is the one agents skip.

**The first half** is a lookup table, derived in `### The decision table` below from
`src/contexts/history-adapter.ts:349-427` (`operationForTool`) and
`src/contexts/materialization.ts`. One commit kind — `raster` — is provably
name-agnostic: no allowlist exists anywhere between the tool's own name and the
materializer. That is your escape hatch, and it is free.

**The second half** is why the reference implementation worked. A history item holds no
pixels; legacy undo recomputes them by re-running the processor with the stored `args`
(`src/contexts/useHistory.ts:98-108`, the `applyRasterTool` arm, which reads
`layer.tmpCanvas ?? layer.bitmap`, calls `toolProcessors[args.toolName].imageProcessor`,
and writes the result back to `tmpCanvas`). So the legacy contract for a raster tool is
exactly two properties, and you check both yourself: **`imageProcessor` is
deterministic** — same args, same bitmap, same pixels, which is what
`replay.deterministic` declares (`src/tools/toolProcessors.ts:53-56`) — and **`args` is
plain JSON**, because the durable conversion runs them through `plainObject`
(`src/contexts/history-adapter.ts:100-125`), which throws on any non-plain value, a
non-finite number, or a non-`Object.prototype` object. There is no canvas snapshot, no
`ImageData`, no diffing, no migration. That is the cost.

**The durable path is a shadow, and you must not over-claim.** `AGENTS.md:278-287`: the
legacy `HistoryItem[]` path is the production replay authority; the durable document is a
shadow projection, not the authority for rendering. Choosing `commit: 'raster'` buys a
durable document that _agrees_ with legacy replay. It does not promote the durable
document. Say so in the PR.

#### Vocabulary

| Symbol                    | Meaning                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToolCommitKind`          | the eight-value union at `src/tools/toolProcessors.ts:38-46`; a tool's declared answer to "how does my result become state?"                                     |
| `ToolProcessorDefinition` | the registry entry type at `src/tools/toolProcessors.ts:48-59`: `creator?`, `flattenRequired?`, `commit`, `replay`, `imageProcessor`                             |
| `replay`                  | the frozen descriptor at `src/tools/toolProcessors.ts:52-57` — `{ kind, deterministic, version, requiresRaster }`, built by the `replay()` factory at `:69-70`   |
| `DurableOperation`        | the durable operation union at `src/contexts/history-model.ts:87-110` — the twelve shapes a durable history entry can hold                                       |
| `DurableHistoryEntry`     | `{ id, schemaVersion, enabled, operation }`, `src/contexts/history-model.ts:115-120`                                                                             |
| `operationForTool`        | `src/contexts/history-adapter.ts:349-427` — **the whole decision point.** Maps one legacy `TOOL_ACTION` entry to one `DurableOperation`, or `null`, or throws    |
| `imageProcessor`          | `(params) => (args) => [BitmapSource, Partial<Pos>?]`; called with `{ bitmap, size }` on replay, `{ size }` for a creator, `{ bitmap, size }` in materialization |
| `ToolArgs`                | the closed per-tool args union, `src/contexts/tool-types.ts:17-62`; every settings field you add is an optional member of your tool's entry                      |

---

### The decision table

`ToolCommitKind` has eight members (`src/tools/toolProcessors.ts:38-46`). One row each,
derived from `operationForTool` and the two consumers of its output.

| `commit` kind        | What it means                                                                 | Durable op it becomes                                                                                                                                                                                                                                                                                                             | Name-agnostic?                                                                                                                                                                                                                                                                                                                          | What it costs                                                                                            | VERDICT                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raster`             | My output is a new raster for the layer.                                      | `apply-raster-processor` with `processorId: args.toolName`, `src/contexts/history-adapter.ts:416-424`                                                                                                                                                                                                                             | **YES.** No allowlist; `args.toolName` becomes the `processorId` and the materializer resolves it by lookup: `toolProcessors[operation.processorId]` at `src/contexts/materialization.ts:277`                                                                                                                                           | zero edits to the history files                                                                          | **ESCAPE HATCH — tier 1. Use this.**                                                                                                                    |
| `geometry`           | I only move and/or resize the layer's `pos`.                                  | `reposition-layer` carrying `move` and/or `resize`, `src/contexts/history-adapter.ts:403-415`                                                                                                                                                                                                                                     | **YES.** The arm reads only `args.move` / `args.resize`; it never reads `args.toolName`. Replay applies it by patching `pos`, `src/contexts/durable-replay.ts:96-106`                                                                                                                                                                   | zero edits to the history files                                                                          | **ESCAPE HATCH — tier 1**, for pure move/resize only                                                                                                    |
| `source`             | I _create_ a layer; my args **are** the layer source.                         | `create-layer`, `src/contexts/history-adapter.ts:504` — reached from the `NEW_LAYER_ACTION \|\| (TOOL_ACTION && source)` arm at `:500`, **not** from `operationForTool`                                                                                                                                                           | **YES for the create path.** The op carries no tool name; the name lives on `DurableLayerSource.toolName`, a free `string` (`src/contexts/history-model.ts:31`, `:47`)                                                                                                                                                                  | zero edits to the history files                                                                          | **ESCAPE HATCH for a creator only.** See the trap below                                                                                                 |
| `layer-operation`    | I am a non-destructive filter: append a retained op, do not touch pixels now. | `apply-filter` carrying a `DurableFilter`, `src/contexts/history-adapter.ts:391-402`                                                                                                                                                                                                                                              | **NO.** Allowlist `['blur', 'color', 'levels']` at `src/contexts/history-adapter.ts:393`; closed union `DurableFilter['toolName']` at `src/contexts/history-model.ts:75`; a `switch` with **no `default` arm** at `src/contexts/materialization.ts:73-89`; a second throw at `src/contexts/materialization.ts:100-102`                  | four hardcoded sites across three files                                                                  | **NOT an escape hatch — tier 2**                                                                                                                        |
| `selection`          | I produce selection state.                                                    | **`null`.** `src/contexts/history-adapter.ts:425` returns `null` for `selection` and `document-operation` alike. Selection state enters the durable timeline as a `set-selection` op derived from the `SELECTION_ACTION` entry's args by `deriveSetSelectionEntry` (`src/contexts/history-adapter.ts:311-328`, arm at `:556-599`) | the **op** is generic; the **representation** is not — `SelectionGeometry` (`src/contexts/general-types.ts:19`) and `SelectionSourceTool` (`:17-18`) are closed unions                                                                                                                                                                  | a new geometry widens both unions                                                                        | **NOT an escape hatch — tier 2**                                                                                                                        |
| `affine-operation`   | I retain an affine transform.                                                 | `apply-affine-transform`, `src/contexts/history-adapter.ts:384-388`                                                                                                                                                                                                                                                               | **NO — the commit kind is never consulted.** The affine arm sits behind `if (args.toolName === 'transform')` at `src/contexts/history-adapter.ts:357`, which returns or throws from inside its own block. A new tool declaring `commit: 'affine-operation'` falls past every `processor.commit === …` test and hits the throw at `:426` | the `toolName` gate at `:357`, the trapezoid arm at `:362-373`, `src/contexts/history-replay.ts:159-185` | **NOT an escape hatch.** The _op_ is generic; the _kind_ is a name-keyed special case                                                                   |
| `document-operation` | I own the document frame, not a layer.                                        | **`null`**, `src/contexts/history-adapter.ts:425`. Legacy replay `continue`s: `if (processor.commit === 'document-operation') continue;` at `src/contexts/history-replay.ts:192`                                                                                                                                                  | n/a                                                                                                                                                                                                                                                                                                                                     | none — but the op is discarded by **both** systems                                                       | **NOT an escape hatch.** This is crop's declaration, and it silently loses the operation in legacy replay too                                           |
| `unimplemented`      | I do not exist yet.                                                           | **throws** `UnsupportedHistoryFeatureError` at `src/contexts/history-adapter.ts:426`                                                                                                                                                                                                                                              | n/a                                                                                                                                                                                                                                                                                                                                     | none                                                                                                     | **NOT an escape hatch.** The processor is also a no-op: `unimplemented = () => () => [null as never] as ToolResult` at `src/tools/toolProcessors.ts:75` |

#### Three traps the table exposes

**`affine-operation` — the generic op is not reachable by the generic kind.** The naive
reading of `ToolCommitKind` is "`apply-affine-transform` is a generic op, so
`commit: 'affine-operation'` is the generic way to reach it." The code disagrees. The
order of tests in `operationForTool` is: `if (args.toolName === 'transform')` at
`src/contexts/history-adapter.ts:357`, which **returns or throws from inside its own
block**; then `processor.commit === 'layer-operation'` (`:391`), `=== 'geometry'` (`:403`),
`=== 'raster'` (`:416`), and `=== 'document-operation' || === 'selection'` returning `null`
(`:425`); then `throw new UnsupportedHistoryFeatureError(...)` at `:426`. A tool named
`warp` with `commit: 'affine-operation'` reaches `:426` and throws. Legacy replay survives
it (`src/contexts/history-replay.ts:159-185` handles the kind for any tool name), so the
failure is **durable-only** and silent until the shadow is exercised.

**`source` — only an escape hatch in its creator role.** `operationForTool` has no
`commit === 'source'` arm at all, so a `source` tool dispatched as a `TOOL_ACTION` against
an **existing** layer (no `layerSource`) falls past every arm to the throw at `:426`, while
legacy replay rasterizes it through its own default arm
(`src/contexts/history-replay.ts:193`). `draw`, `shape`, `text`, `rectangle`, `ellipse`,
`triangle`, `polygon` and `line` all declare `commit: 'source'` and are all marked
`creator: true` (`src/tools/toolProcessors.ts:117-131`, `:220-224`); keep that pairing.

**`layer-operation` — looks generic and is not.** Sharpen, Noise Reduction and Vibrance
are the natural next tools and all three are filters. They work perfectly in legacy replay
(`src/contexts/history-replay.ts:149-158` appends a retained operation for **any**
`layer-operation` tool, no name check) and fail **only** the shadow, with an
`Unsupported filter ${args.toolName}` throw (`src/contexts/history-adapter.ts:394`) that
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
(`src/contexts/history-adapter.ts:416-424`) builds `{ kind: 'apply-raster-processor',
layerId, processorId: args.toolName, version: processor.replay.version, args:
plainObject(args, …) }` — note what is absent: any allowlist, any name test, any `default`
case. The materializer then resolves it **by lookup, not by a table**
(`src/contexts/materialization.ts:277-284`: `toolProcessors[operation.processorId as keyof typeof toolProcessors]`,
an unknown-name throw, a `replay.version` mismatch throw, then
`processor.imageProcessor({ bitmap, size })(operation.args as ToolArgs)`). `processorId`
**is** your tool's own name; nothing else has to learn that you exist.

And durable **replay** does not even discriminate: `apply-filter`,
`apply-affine-transform` and `apply-raster-processor` are one collapsed arm
(`src/contexts/durable-replay.ts:115-121`) that appends the operation to the layer's
retained list. The name only matters at materialization, and only the _filter_
materializer is name-closed.

#### Tier 2 — needs an entry in a closed union in the history files. **A migration task.**

The exact hardcoded sites. Enumerate them from the tree, not from memory. A new
`layer-operation` filter tool (Sharpen, Vibrance, Noise Reduction) touches five; a tool
that retains an affine transform touches three:

| #   | Site                                                | What is hardcoded                                                                     | Compiler?                                                                      |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | `src/contexts/history-adapter.ts:393`               | `if (!['blur', 'color', 'levels'].includes(args.toolName)) throw …`                   | no                                                                             |
| 2   | `src/contexts/history-model.ts:74-78`               | `DurableFilter.toolName: 'blur' \| 'color' \| 'levels'`                               | yes, at the cast on `history-adapter.ts:397`                                   |
| 3   | `src/contexts/materialization.ts:73-89`             | `filterForOperation` — a `switch` over three names with **no `default` arm**          | yes: declared return `string` + closed-union argument make a new member TS2364 |
| 4   | `src/contexts/materialization.ts:100-102`           | `operationFilter` re-derives the processor by name and throws on a `version` mismatch | no                                                                             |
| 5   | `src/tools/__tests__/tool-processors.test.ts:77-82` | the `requiresRaster` tool list is asserted exhaustively                               | yes                                                                            |
| 6   | `src/contexts/history-adapter.ts:357`               | `if (args.toolName === 'transform')` — the whole affine arm                           | no                                                                             |
| 7   | `src/contexts/history-adapter.ts:362-373`           | the trapezoid raster boundary, keyed on `trapezoid` and `transform` args              | no                                                                             |
| 8   | `src/contexts/history-replay.ts:160-161`            | `toolArgs.toolName === 'transform' ? … : 0`                                           | no                                                                             |

Touching any of these is a **history-migration task, not a tool task**: it changes what an
existing durable document means, and `DURABLE_SCHEMA_VERSION` is `1`
(`src/contexts/history-model.ts:143`), checked in exactly one place,
`src/contexts/history-append.ts:316`. If your tool fits none of the existing generic ops
and you would have to widen one of these, that is a `HANDOFF.md` entry, and you ship the
tool on `commit: 'raster'`. **To add a selection tool**, see the next section.

#### Tier 3 — needs a new `DurableOperation` variant. **Out of scope. Hand it off.**

If your tool's semantics fit none of `create-layer`, `remove-layer`,
`set-layer-properties`, `reposition-layer`, `reorder-layers`, `apply-filter`,
`apply-affine-transform`, `apply-raster-processor`, `rasterize-layer`,
`set-document-frame`, `merge-document` or `set-selection`
(`src/contexts/history-model.ts:87-110`), the answer is a `HANDOFF.md` entry and the tool
ships on `commit: 'raster'`. This is a boundary, not a judgement call. Here is the bill,
and note the enforcement column — sites 1, 2 and 11 are the only ones the compiler holds
you to:

| #   | Site                                                                                       | Enforced by the compiler?                 |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 1   | `src/contexts/history-model.ts:87-110` — the union                                         | —                                         |
| 2   | `src/contexts/history-model.ts:247-303` `cloneOperation`                                   | **yes** (TS2366, no `default`)            |
| 3   | `src/contexts/history-model.ts:158-175` `collectDurableAssetIds`                           | no (partial switch)                       |
| 4   | `src/contexts/durable-replay.ts:68-143` `replayDurableDocument`                            | **no — a missing case is a silent no-op** |
| 5   | `src/contexts/history-adapter.ts:349-427` `operationForTool`                               | no                                        |
| 6   | `src/contexts/history-adapter.ts:444-638` `legacyHistoryToDurable`                         | no                                        |
| 7   | `src/contexts/history-append.ts:117-158` `translate`                                       | no                                        |
| 8   | `src/contexts/history-append.ts:315-356` `validatePlannedDurableEntry`                     | no                                        |
| 9   | `src/contexts/materialization.ts:259-291` pixel application order                          | no                                        |
| 10  | `src/contexts/materialization.ts:91-107` `operationFilter` — unknown kinds are **dropped** | no                                        |
| 11  | `src/tools/toolProcessors.ts:38-59,77` the tool's `commit` + `replay.version`              | **yes**                                   |

`tsconfig.app.json:30-36` sets `strict`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch` — and **not** `noImplicitReturns`. Sites 3 and 4 are
statement-position switches, so `tsc` stays green on a missing case. A new operation kind
with a missing replay arm is a silent no-op in production: the durable document replays
without it, disagrees with legacy replay, and nothing reports the disagreement.

**What "decline" actually costs, and the asymmetry you must not get wrong.** Two decline
postures exist in the tree, with different severities. The **append boundary** declines
per-entry and _warns_: `unavailable()` returns `durableEntry: null` with
`severity: 'warning'` (`src/contexts/history-append.ts:78-92`, the severity at `:86`), the
terminal arm is `:153-158`, `decideDurableAppend` then returns
`outcome: 'preconditions'` (`src/contexts/history-append.ts:358-366`), and the store falls
back to `buildDurableDocument` (`src/contexts/StoreContext.tsx:744-758`, defined at
`:573-603`) for a full O(history) re-conversion — **a performance cliff on a shadow, not a
correctness loss.** The **shadow conversion** is **fail-closed for the whole document**:
one unsupported entry throws inside the per-item loop, the loop catches it into an
`error`-severity diagnostic (`src/contexts/history-adapter.ts:621-623`), and
`convertLegacyHistorySafely` rolls the asset transaction back and returns
`{ status: 'unavailable', document: null }` (`:657-665`) — **the shadow is absent, not
degraded.** A tool durable conversion cannot translate therefore costs the _whole_ durable
document, not just its own entry. That is designed behaviour, and `AGENTS.md:278-287` says
the durable document is a shadow, so nothing user-visible breaks — but it is a consequence
an agent should be able to explain rather than discover.

---

### The two commit kinds that are NOT escape hatches

`layer-operation` and `selection` are the two a new tool reaches for and must not.

#### `layer-operation` — the allowlist is the whole story

The durable filter path is name-closed in **four** places, and a tool that misses any one
of them fails in a different way.

1. **Conversion refuses it.** `src/contexts/history-adapter.ts:393-395` throws
   `UnsupportedHistoryFeatureError('Unsupported filter …')` for any name outside
   `['blur', 'color', 'levels']`. This fires first, and its throw voids the entire durable
   document (`src/contexts/history-adapter.ts:657-665`).
2. **The type forbids it.** `DurableFilter.toolName` is the literal union
   `'blur' | 'color' | 'levels'` (`src/contexts/history-model.ts:75`). The cast at
   `src/contexts/history-adapter.ts:397` is a cast precisely because the compiler cannot
   check it.
3. **Materialization cannot render it.** `filterForOperation`
   (`src/contexts/materialization.ts:73-89`) is a `switch` over the three names with
   **no `default` arm**, so an unlisted member is a compile error, not a fallback.
4. **Version drift is refused.** `operationFilter`
   (`src/contexts/materialization.ts:100-102`) re-derives the processor from
   `operation.filter.toolName` and throws on a `replay.version` mismatch.

The legacy side has none of this: `src/contexts/history-replay.ts:149-158` appends a
retained operation for **any** `layer-operation` tool, no name check. So a new filter tool
is legacy-good and durable-fatal, and the failure is invisible until the shadow runs. The
honest move in a stripped task: declare `commit: 'raster'`, accept that the shadow no
longer holds it non-destructively, and write the `HANDOFF.md` entry that widens the four
sites. Do not widen the allowlist in a tool task.

#### `selection` — a new selection tool needs no new durable op, and a new selection _geometry_ does

**The op is already generic.** `operationForTool` returns `null` for `selection`
(`src/contexts/history-adapter.ts:425`) — a selection tool is not a layer operation and
correctly produces no `DurableOperation` from the tool arm. Selection state enters the
durable timeline through a separate route: the `SELECTION_ACTION` history entry's
`previousSelectionState` / `nextSelectionState` args
(`src/contexts/selection-baseline.ts:11-15`), converted to a `set-selection` op by
`deriveSetSelectionEntry` (`src/contexts/history-adapter.ts:311-328`) and carried on the
`SELECTION_ACTION` arm at `:556-599`. A new selection tool that emits the same entry shape
needs **no** new durable op. Confirmed: the two `SELECTION_ACTION` writers are
`appendSelectionClear` (`src/contexts/useSelectionHistory.ts:118`) and the per-gesture
writer at `:270`, and neither names a tool.

**The representation is a closed union.** This is where it stops being free.

- `SelectionGeometry = 'polygon' | 'rectangle'` — `src/contexts/general-types.ts:19`. A
  new geometry (an ellipse marquee, a single-row marquee) widens this, and it is read by
  the renderer, not only by the durable model.
- `SelectionSourceTool = 'polygonal-lasso' | 'freehand-lasso' | 'feather-magnetic-lasso' | 'magic-wand' | 'rectangular-selection'`
  — `src/contexts/general-types.ts:17-18`. A new selection tool's own name must be added
  here, and it is a **string literal union**, not a derived type: nothing ties it to
  `ToolName` (`src/contexts/tool-types.ts:58`), so adding the tool to `ToolArgsByName` does
  not add it here, and TypeScript will not tell you which of the two you forgot.
- `Selection.geometry` and `Selection.sourceTool` — `src/contexts/general-types.ts:67-68`.
- `SelectionDraftState.sourceTool` — `src/contexts/general-types.ts:24`.
- `SelectionMetadata` — `src/contexts/general-types.ts:33-59` — is the per-tool settings
  bag (`magneticLasso`, `magicWand`, `featherRadius`, …). A new tool with settings needs a
  member here, and this object is what the durable `set-selection` op deep-copies
  (`src/contexts/history-model.ts:193`).

**And selections are deliberately outside durable replay authority at the cutover.** The
tree says so twice. `src/contexts/StoreContext.tsx:59-63`: "A selection can therefore only
enter the document through a `SELECTION_ACTION` history entry, and a layer operation only
through a history entry. This holds whichever rule seeds the baseline, because both read
the timeline." And `src/contexts/selection-baseline.ts:46-52`: the baseline lookup is
**deliberately unbounded** over the whole timeline, because a selection is created by a
gesture that writes no history entry, and the tool-switch clear's
`previousSelectionState` is the only record that the selection ever existed.

Two consequences. `deriveSetSelectionEntry` returns `null` for a missing or structurally
unusable `nextSelectionState` (`src/contexts/history-adapter.ts:318`) — the conversion
**reports instead of inventing** a cleared selection; do not "fix" that by defaulting. And
because durable replay applies only each operation's `after`
(`src/contexts/durable-replay.ts:140-142`), a selection created outside history is
invisible to the durable document. Ship a new selection tool with its union widenings in
the same change; do not treat the durable op as covering the representation.

#### The rest, briefly

- **`affine-operation`** — see the trap above. Generic op, name-gated kind.
- **`document-operation`** — `src/contexts/history-adapter.ts:425` returns `null` and
  `src/contexts/history-replay.ts:192` `continue`s, so the operation is discarded by
  **both** systems. It is crop's declaration, not a way to skip work.
- **`unimplemented`** — `src/contexts/history-adapter.ts:426` throws, which voids the
  whole durable document, and the processor is
  `() => () => [null as never] as ToolResult` (`src/tools/toolProcessors.ts:75`) so it
  produces nothing. If you mark an `unimplemented` processor `creator: true` and dispatch
  it as a tool-layer source, `createLayerSource` assigns the `null` to `layer.tmpCanvas`
  with no throw (`src/contexts/layer-utils.ts:204-213`) — a layer that exists, is visible,
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
   (`AGENTS.md:278-287`); a missing non-destructive shadow is a tracked problem, not a
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
`.kilo/plans/ps-research/RESEARCH-BRIEF.md` (189 lines, constraints at `:51-81`) — the
hard-won decisions list the tool research sessions had to respect.

**1. An honest `replay` contract.** `replay` is part of the processor contract
(`src/tools/toolProcessors.ts:48-59`). `RESEARCH-BRIEF.md` constraint 2, verbatim:

> **Durable replay.** Every tool must have a declared `replay` contract in
> `toolProcessors.ts`. A tool whose pixel output cannot be reproduced deterministically
> must be marked `deterministic: false` / `requiresRaster: true`, and its replay must be
> routed through a raster snapshot rather than re-executing the operation. If you propose
> a new tool, specify its `commit` and `replay` entries explicitly.

`deterministic` and `requiresRaster` are **truth claims, not conveniences.** A tool that
samples a random seed, reads the wall clock, depends on a network font, or composites
against the base layer is `deterministic: false`. Two unit tests hold you to it, both
exhaustive over `toolNames` so a new tool is covered the moment it is registered:
`src/tools/__tests__/tool-processors.test.ts:702-712` asserts `replay.kind` tracks
`commit` (`'raster'` → `'raster-processor'`, `'unimplemented'` → `'unimplemented'` as the
two special cases), and `:714-718` asserts
`replay.requiresRaster === (commit === 'raster' || (commit === 'selection' && !creator))`.
So `commit: 'raster'` **forces** `requiresRaster: true`; you do not get to declare
otherwise. The descriptor must stay frozen and versioned —
`src/tools/toolProcessors.ts:69-70` builds
`Object.freeze({ kind, deterministic, version: 1, requiresRaster })`, and
`src/tools/__tests__/tool-processors.test.ts:720-729` asserts the frozen object, the exact
key set, and that `toolsMap` reuses it **by reference**. **Bump `version` when the pixel
output of an existing processor changes for the same args** —
`src/contexts/materialization.ts:279-281` rejects an unknown `processorId`/`version` pair,
and so does `src/contexts/materialization.ts:100-102` for filters.

**2. The `commit` kind**, from the table above, with its tier stated. If the answer is
tier 1, say "tier 1, zero history-file edits" in the PR — that sentence is the whole
deliverable of this phase.

**3. The settings shape in `defaultSettings`.** `defaultSettings` is
`src/tools/settings.ts:35-180`; `DefaultSettings` is its inferred type (`:182`) and
`lastSavedSettings` clones it into the per-tool store (`:199`). Every control you ship
needs an entry there, `satisfies`-checked against your tool's args type — the existing
shape, for the three raster tools, is `src/tools/settings.ts:116-124` (`alpha`, `color`,
`penType`, `lineWidth`, `points`, `toolName`). If a control is not in `defaultSettings` and
not in a real component under `src/components/ToolbarsRight/`, it does not exist; a setting
with no `defaultSettings` entry is a setting the next tool switch erases.

**4. An operation that cannot be replayed deterministically must REJECT the durable
branch.** `RESEARCH-BRIEF.md` constraint 3, verbatim:

> **Unsupported operations must reject the durable branch.** Do not manufacture durable
> no-op operations that falsely appear replayable. Reject is a valid, preferred outcome.

This is the one an agent is most tempted to bend, because rejecting is slower to ship than
faking. The tree already does it correctly in three places; copy them rather than invent a
fourth: `src/contexts/history-adapter.ts:426` throws `UnsupportedHistoryFeatureError` for
an unhandled commit kind rather than a fake op; `:394` throws `Unsupported filter …` for a
filter outside the allowlist rather than a generic `apply-filter`; and `:318` is
`if (!isValidSelectionSnapshot(next)) return null;` in `deriveSetSelectionEntry`, whose doc
comment (`:288-310`) spells out why — "Returning `null` makes the caller report instead of
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
`AGENTS.md:278-287` adds the standing warning: do not start a single-writer cutover while
`saveLayerCanvas()` can still promote cached canvases outside reducer publication.

---

### The backward-compatibility trick

The reference implementation that solved the undo problem **without migrating anything**
is the `brush-toolbar` branch. It is **not merged**; treat it as a reference, not a
dependency, and re-verify everything against whatever base you land on. Its central move
is reusable, non-obvious and cheap. Read it as three layers, because all three are needed
and agents routinely ship the first and skip the third.

#### Layer 1 — the type: a new optional field, absent by default

`smoothing` and `blendMode` were added to `DrawToolArgs` as **optional** members, and the
three paint tools were made to **require** them
(`brush-toolbar:src/tools/draw.ts`, diff against main):

```ts
export type DrawToolArgs = {
  // … existing members …
  /**
   * Photoshop `Smoothing`, 0-100, applied to the sampled path by
   * `smoothStrokePoints`. Optional because the legacy `draw` tool's per-pen presets
   * (`src/tools/settings.ts:21-25`) predate it; an absent value is no smoothing,
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
`PaintSettings` (`brush-toolbar:src/tools/brush.ts:81-86`), so the options bar can read it
without a guard and a `draw`-era args object can never satisfy the paint type by omission.
That is how "optional in the args channel, mandatory in the new tool" is expressed without
a runtime check. And because the legacy `draw` tool's per-pen presets
(`src/tools/settings.ts:21-25`, `savedDrawPerPen`) predate the setting and keep rendering
exactly as they do today — **absent means absent** — the tool does not need to know whether
a setting exists.

#### Layer 2 — the runtime: the identity return

`smoothStrokePoints` (`brush-toolbar:src/tools/brush.ts:101-119`) computes
`pull = clampPercent(smoothing) / 100` and opens with
`if (pull === 0 || points.length < 3) return points;` — returning `points` **itself**, not
a copy. The doc comment states the reason in terms of the caller's identity comparison, and
that reason is what makes this a mechanism rather than an optimization.

#### Layer 3 — the pin: `toBe`, never `toEqual`

```ts
// brush-toolbar:src/tools/__tests__/brush.test.ts:96
expect(smoothStrokePoints(zigzagPath, 0)).toBe(zigzagPath);
```

`toBe` is object identity. `toEqual` is structural equality and **would pass** if the
implementation started returning a fresh, equal, freshly-allocated array — exactly the
refactor that silently changes what every unpinned stroke renders from. The same file pins
the negative-smoothing, `NaN`, `±Infinity` and sub-three-sample cases with `toBe` too
(`brush-toolbar:src/tools/__tests__/brush.test.ts:103`, `:116`, `:124`), because
`clampPercent` guards on `Number.isFinite` _before_ it clamps, so every non-finite input
takes the `: 0` branch and is an identity.

#### The real risk this defuses: the committed visual-regression baselines

This is what makes the mechanism non-optional. The export visual-regression baselines are
recorded **through the legacy `draw` tool**: `e2e/export/helpers.ts:108-109` in
`setupExportTest` does `await clickToolButton(page, 'draw');` then
`drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y)`, and that is the
fixture for every export baseline. Seventeen committed PNGs live in
`e2e/export/visual-regression.spec.ts-snapshots/export-baselines/`. They are compared, not
regenerated: `e2e/export/visual-regression.spec.ts:73-78` re-records **only** under an
explicit `--update-snapshots`, and the comment at `:67-72` documents that a bare truthiness
check used to rewrite the baseline on every run and make the oracle disposable.

So **any change to the legacy raster path invalidates a committed oracle**, and `AGENTS.md`
is unambiguous — "Do not weaken a gate to get green: no skips, no raised thresholds, no
deleted assertions, no re-recorded visual baselines." Re-recording a baseline is a
**recording decision that belongs to the operator**, not to you. The identity return is what
lets you add a Photoshop-faithful setting to three paint tools without ever touching that
oracle.

#### Two honest caveats about the reference implementation

**Caveat 1 — the identity branch it relies on is not on this base.** The branch's own
justification is that "`drawLine` compares by identity to decide whether to reuse the
caller's args or allocate a copy (`src/util/draw.ts:96-97`)". At `1c9c8de` there is no such
comparison: `src/util/draw.ts:84-94` is `drawLine`, a three-branch `penType` dispatch with
no identity test, and `drawPen` at `:96-104` calls `bezierSmoothedLine` unconditionally.
`git grep sampled -- src/util/draw.ts` returns nothing. The same is true of the branch's
other internal citation, `src/contexts/history-adapter.ts:199` for the `create-layer`
emission, which is at `src/contexts/history-adapter.ts:504` in this tree. Treat every
`file:line` **inside** `brush-toolbar:` as branch-local. If you port the mechanism you must
re-establish the guarantee on your base: prove the absent value renders identically, or add
the identity branch your caller needs.

**Caveat 2 — the identity mechanism protects geometry, not every line you touch.** The
same branch's diff also removes the `else ctx.setLineDash([])` guard from `setupDrawCtx`
(`src/tools/draw.ts:26-45` on the base, a function the legacy `draw` tool calls). That is a
change to a shared legacy code path, and no amount of identity-return safety covers it: as
written, a `pen-dashed` stroke that sets a dash and is followed by an undashed stroke would
leave the dash in place on the shared overlay context. I have **not** run the suite to
confirm the consequence — flag it as a candidate defect to verify, and treat it as the shape
of the risk: **review the whole diff for changes to shared legacy code, and for each one
either prove it inert or hand it off.** The identity trick is a licence to add a setting,
not a licence to refactor a neighbour.

#### Where the blend mode goes, and why it is the same lesson

`Mode` could not ride the stroke. It is a **layer** property, and the layer is created
_before_ the stroke is rasterized — so it is resolved in `createLayerSource`
(`brush-toolbar:src/contexts/layer-utils.ts:160-167`, `:241`) rather than while drawing.
`toolLayerBlendMode(args)` returns `'source-over'` unless `args.toolName` is `brush`,
`pencil` or `color-replacement` — the three `commit: 'raster'` tools at
`src/tools/toolProcessors.ts:165-193` — and then returns
`isPaintBlendMode(args.blendMode) ? args.blendMode : 'source-over'`.

Three things to copy. **It rides the args channel**, so replay re-enters the same function
with the same history entry's args and undo, redo and the durable shadow cannot disagree —
the `create-layer` op carries the whole args object (`DurableLayerSource.args`,
`src/contexts/history-model.ts:32`), so both converters already carry it. **The gate is a
hardcoded tool-name list**, so a fourth paint tool must be added there; same allowlist smell
as `layer-operation`, but in a file that is _not_ part of the durable model — a good trade,
and a reminder that the gate belongs as close as possible to the thing that knows the tool
is a paint tool. **The value is a closed set with a Normal fallback** (`isPaintBlendMode`,
`brush-toolbar:src/tools/brush.ts:51-52`), because
`ctx.globalCompositeOperation = 'dissolve'` is **silently ignored** by the browser rather
than erroring, so a mode from a document written by a build that offered it degrades to
Normal instead of reaching the canvas as a dead operation.

---

### Where the deferred work goes

**Not inline TODOs in source.** A real build in this repo — the `brush-toolbar` branch —
deferred its entire engine-dependent remainder to **six numbered `HANDOFF.md` entries**
(items 36-41: the stamped-tip renderer, the Pencil's `Auto Erase`, tablet pressure,
`pointsBoundingPos` padding, `setupDrawCtx` running once per stroke, and the `Custom`
preset). `git grep TODO brush-toolbar -- src/` finds only the pre-existing
`ToolbarPlaceholder` UI strings and the test asserting the Paint panel no longer renders
one — **no new `// TODO` comment was added anywhere in the change.** I could not verify a
repo-level ban on source comments: `AGENTS.md` (287 lines) contains no occurrence of the
word, and `eslint.config.js` sets no comment rule. What _is_ verifiable, and what the
reference build did, is six handoff entries with zero new inline TODOs. Follow the build,
not an unverifiable rule.

#### The entry shape

Four parts, in this order. Verified against `brush-toolbar:HANDOFF.md` items 36, 37 and 41:

```markdown
## <N>. <the defect, stated as the claim>

**Problem.** <what is wrong, `file:line` on every claim, a grep or a measurement when
checkable, an explicit mention of any test that pins the current behaviour, and a bound on
how reachable it is>

**Why it is not a wiring bug.** <the structural reason a reviewer would otherwise propose
the one-line fix you already rejected. This is the part that stops the next session
re-proposing it.>

**Fix.** <imperative. Name the exact symbol or branch. Say what NOT to do.>

**Files.** `path`, `path:line`, `path:line`
```

`**Why it is not a wiring bug.**` is what separates a real entry from a wish list, and it
is the part to write first. Item 36 uses it to record that `buildDrawArgs`
(`src/tools/toolProcessors.ts:61-67`) narrows `penType` to `'pen' | 'spray'` and both paint
tools force `'pen'`, so the one per-point painter in the tree is deliberately unreachable
from a brush or a pencil — "That is deliberate — it is the adapter that makes the tools
hard-edged — not an oversight."

#### `**Fix — needs a call, not a patch.**`

Use that exact label when the change would break an existing pin and the choice belongs to
the operator. Verified at `brush-toolbar:HANDOFF.md:1264` (item 41), where the seeded brush
opacity is pinned by a unit test and either fix is defensible:

> **Fix — needs a call, not a patch.** Either raise the seeded `alpha` to 1 and re-derive
> that pin, or add a preset matching the seeded defaults exactly and rename `Hard Round` to
> something that does not promise a 100%-opaque hard edge. The first is closer to
> Photoshop and changes every committed document's default stroke; the second changes
> nothing outside the bar.

Three triggers, all of which you will meet: the fix would remove or re-derive a committed
test pin (`AGENTS.md`: "a pin is a tripwire that fails the moment the defect is fixed, so a
fix must remove the pin in the same change"); or the fix would change a committed
visual-regression baseline (**recording belongs to the operator**); or the fix would widen a
closed union or a hardcoded allowlist in the history files (tiers 2 and 3), or start a
single-writer cutover (`AGENTS.md:278-287`).

#### Lifecycle and numbering

From `AGENTS.md:238-276`: **fixed and verified deletes the entry** — never rewrite an open
problem into a closed one; "unverified is not closed", so a fix that landed without a check
leaves the entry alive, tightened to say what still needs verifying; and the handoff edit
**belongs in the same commit as the work that produced the finding**
(`AGENTS.md:247-260`). **Numbers are stable identifiers other items cite, so they are never
renumbered** — the gaps are entries that were fixed and deleted. New entries append at EOF
after a `---`, taking the next unused number.

**At `1c9c8de`, `HANDOFF.md` is 1509 lines with 43 `##` headings numbered up to 45.** The
gaps are **30, 36 and 43**; the next unused number is **46**. That matters: the
`brush-toolbar` branch's six new entries are numbered 36-41 against its own base
(`446d7eb`, a 1270-line `HANDOFF.md`), and on **this** base **37-41 are already taken** by
different problems — 37 is `isToolDirty` has no production writer, 41 is Original / Free no
longer restores the rect drawn before a ratio change. Porting those entries verbatim collides
with five live entries. Re-number against the tree you are on, and take 46+.

---

#### Corrections to the reference implementation's own citations

Not playbook errors — the branch's internal `file:line` values, which are against its own
base (`446d7eb`) and do not resolve at `1c9c8de`. Do not cite them as current-tree facts.

| Branch claim                                                                                  | Status at `1c9c8de`                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/util/draw.ts:96-97` — "`drawLine` compares by identity (`points === sampled`)"           | **Does not exist.** `git grep sampled -- src/util/draw.ts` returns nothing. `src/util/draw.ts:84-94` is `drawLine` (a `penType` dispatch) and `:96-104` is `drawPen`, which calls `bezierSmoothedLine` unconditionally. The identity branch must be re-established on whatever base you port to. |
| `src/contexts/history-adapter.ts:199` — the `create-layer` emission                           | **Does not exist at that line.** `src/contexts/history-adapter.ts:199` is inside `convertLayer`'s layer literal; `create-layer` is emitted at **`src/contexts/history-adapter.ts:504`**.                                                                                                         |
| `src/tools/settings.ts:21-25` — the legacy `draw` per-pen presets                             | **Correct.** `src/tools/settings.ts:21-25` is `savedDrawPerPen`.                                                                                                                                                                                                                                 |
| `src/util/draw.ts:5-26` — `pointsBoundingPos` padding                                         | **Correct for the symbol's start** (`src/util/draw.ts:5`); the end line has shifted. Cite the symbol.                                                                                                                                                                                            |
| `src/tools/toolProcessors.ts:61-67,165-193` — `buildDrawArgs` and the three raster processors | **Correct.** Both ranges resolve exactly.                                                                                                                                                                                                                                                        |
| `HANDOFF.md` items 36-41 on the branch                                                        | **Numbers collide on this base.** The branch's `HANDOFF.md` is 1270 lines off `446d7eb`; this tree's is 1509 lines with 37-41 taken. See the numbering paragraph above.                                                                                                                          |

#### What I could not verify

- **No suite was run.** No `npm run test`, `npm run tsc`, `npm run build`,
  `npm run test:e2e:unit` or `npm run test:e2e` — the task forbade it. Every claim here is
  a read of the tree, not an execution.
- **`RESEARCH-BRIEF.md` is gitignored and local-only.** It exists at
  `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/RESEARCH-BRIEF.md` and is **not** in this
  worktree. The constraint quotes are from that file (189 lines, constraints at `:51-81`),
  read on this machine. A worktree-only agent cannot open it.
- **The `setupDrawCtx` dash-guard removal** (caveat 2) is a candidate defect read from the
  branch's diff, not a confirmed one. I did not run the suite and did not trace the overlay
  context's lifetime.
- **The brush-toolbar branch's test outcomes.** Its commit message claims gates passed; I did
  not run them and cannot confirm the branch is green against `1c9c8de`.
- **`saveLayerCanvas` promotion.** `src/contexts/layer-utils.ts:116-117` still exists at
  `1c9c8de`, consistent with the standing warning in `AGENTS.md:278-287`, so that warning is
  current for this tree. What I did not trace is every caller.

Every `file:line` about the working tree was re-verified at **`1c9c8de`** (branch `skill/photoshop-tool-creation`). Citations of the form
`brush-toolbar:<path>` are the
**not-yet-merged reference implementation** (tip `bf96b72`; `git merge-base --is-ancestor
brush-toolbar main` fails) and describe code that is not in `main`.

Read `AGENTS.md` first. Its "Test traps" section is authoritative and nothing below contradicts it: TS strict, React 19, no `any`,
`satisfies` for registries, no enums, no parameter properties (`erasableSyntaxOnly`, `tsconfig.app.json:32`), `vi.hoisted()` factories
rather than global mutation, `it.fails('...')` plus a `// BUG:` marker for a pinned defect, one setup file (`src/test/setup.ts`). The
worked example throughout is a new raster tool named `eraser`.

---

## Phase 4 — implementation

### The processor contract

One entry per tool, in a total registry:

```ts
// src/tools/toolProcessors.ts:48-59
export type ToolProcessorDefinition = {
  creator?: boolean;
  flattenRequired?: boolean;
  commit: ToolCommitKind;
  replay: Readonly<{
    kind: ToolReplayKind;
    deterministic: boolean;
    version: number;
    requiresRaster: boolean;
  }>;
  imageProcessor: (param: ProcessorToolParams | CreatorToolParams) => (args: ToolArgs) => ToolResult;
};

// src/tools/toolProcessors.ts:69-70
const replay = (kind: ToolReplayKind, requiresRaster: boolean, deterministic = true) =>
  Object.freeze({ kind, deterministic, version: 1, requiresRaster });
```

Two-stage currying: the outer call takes `ProcessorToolParams = { size, bitmap }` or `CreatorToolParams = { size }` (`:17-24`), the inner
takes the tool args, and the result is `ToolResult = [BitmapSource, Partial<Pos>?]` (`:26`). The registry is total, so adding a name to
`ToolName` is a `tsc` error until the entry exists (`src/tools/toolProcessors.ts:77` `Record<ToolName, ToolProcessorDefinition>`).

**What each declaration obliges you to.**

- `commit` — the durable-conversion tier. Use `'raster'` for a new drawing tool:
  `src/contexts/useHistory.ts:98-109` then replays it for free. Never write a new
  `DurableOperation` variant for a tool.
- `replay` — mandatory, and reachable only through the frozen factory, so the four fields cannot
  be smuggled in ad hoc. Bump `version` when pixel output changes for the same args.
- `imageProcessor` — copy an existing adapter's shape rather than aliasing a shared one; the
  three paint adapters are the model (`src/tools/toolProcessors.ts:165-193`). A processor that
  narrows `ToolArgs` to its own name needs `// @ts-expect-error Each processor narrows ToolArgs
to its own registered name.`, as `reposition` does at `:81-82`; an inline adapter already
  taking the union does not.
- `creator: true` — a **promise** the tool can run with `{ size }` and no bitmap.
  `src/contexts/layer-utils.ts:206-213` calls `imageProcessor({ size: pos } as
CreatorToolParams)(source.args)` and assigns the result to `layer.tmpCanvas`. Without the flag
  the tool cannot create its own layer.
- `flattenRequired` — **do not set it.** It is in the type (`:50`) and the branch runs
  (`src/contexts/useLayer.ts:271-301`), but no shipped processor sets it; only two tests that
  inject the flag reach it.

**`requiresRaster` is derived, not declared, and a test enforces it** — the tripwire
against a dishonest declaration:

```ts
// src/tools/__tests__/tool-processors.test.ts:714-718
it.each(toolNames)('derives the %s requiresRaster flag from its commit kind and creator status', (toolName) => {
  const { commit, creator, replay } = toolProcessors[toolName];

  expect(replay.requiresRaster).toBe(commit === 'raster' || (commit === 'selection' && !creator));
});
```

The companion rule at `:702-712` maps `commit: 'raster'` to `replay.kind: 'raster-processor'`, `'unimplemented'` to `'unimplemented'`, and
everything else to `replay.kind === commit`.

A `layer-operation` tool therefore **cannot** declare `requiresRaster: true` without rewriting the test. Four literal rosters in the same
file go red too: `requiresRaster` `:76-82`, non-deterministic `:84-98`, raster-committed `:114-121`, creators `:123-145`.

### The file set, in dependency order

**Why the order matters.** Steps 1–6 are the _type spine_: each is closed over `ToolName`,
so they fail `npm run tsc` in sequence and the compiler walks you from the union to the last `never`. Steps 7–9 are the
_presentation_ registries — none total, all pinned by a test roster. Steps 10–13 are the new files. Out of order, you get a
tree that typechecks halfway and renders nothing.

| #   | File                                                                    | Purpose                                                       | Anchor that forces the edit                                                                                            |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/contexts/tool-types.ts`                                            | the args type in `ToolArgsByName`                             | `:17-56`; `:58` derives `ToolName`                                                                                     |
| 2   | `src/tools/<myTool>.ts` (new)                                           | args type + the curried processor                             | —                                                                                                                      |
| 3   | `src/tools/toolProcessors.ts`                                           | `commit`, `replay(...)`, optional `creator`, `imageProcessor` | `:77` `Record<ToolName, …>`                                                                                            |
| 4   | `src/tools/toolsMap.ts`                                                 | `{ ...toolProcessors.<myTool>, icon, toolboxComponent }`      | `:33-39` `ToolsMap`; `:41` the literal                                                                                 |
| 5   | `src/tools/settings.ts`                                                 | `defaultSettings['<my-tool>']`                                | `:180` `satisfies ToolArgsByName`; `:199` `lastSavedSettings: ToolArgsByName`                                          |
| 6   | `src/util/settings.ts`                                                  | the `saveLastSettings` arm                                    | `:20-83`; `:81` the `never` trap                                                                                       |
| 7   | `SidebarLeft/types.ts` + `icons/<Name>Icon.tsx` (new) + `toolIcons.tsx` | the icon, three files                                         | `types.ts:3-37`; `toolIcons.tsx:25`                                                                                    |
| 8   | `toolbar-mapping.ts`                                                    | the flyout entry and `availableTools`                         | `:37-84`; `:86-116`                                                                                                    |
| 9   | `src/components/Main/Main.tsx`                                          | **four** edits, not one                                       | `:50-76` `interactionMode`; `:135-145` `ToolAreaComponent`; `:149-158` routing; `:184-197` overlay `display` allowlist |
| 10  | `src/components/Main/<My>ToolArea.tsx` (new)                            | the gesture surface                                           | —                                                                                                                      |
| 11  | `src/components/ToolbarsRight/<MyTool>/<MyTool>.tsx` (new)              | the options component                                         | —                                                                                                                      |
| 12  | `src/components/Main/Main.scss`                                         | the cursor class                                              | `:12-38`                                                                                                               |
| 13  | `src/components/Common/AppKeyboardShortcuts.tsx`                        | shortcut, registered **twice** (plain + `shift: true`)        | `:9-16` the group literals                                                                                             |

**Step 9 is the one that gets forgotten.** `interactionMode` is a second, unrelated
hand-written chain (`src/components/Main/Main.tsx:50-56`). A new raster tool with a working `commit: 'raster'` processor missing from it
falls through to `DummyToolArea` (`:147`, `:158`), which renders `style={{ display: 'none' }}`. The tool is selectable, the options bar
renders, and nothing happens on the canvas with no warning. Worse, the overlay canvas `display` is a **separate** allowlist (`:184-197`),
so a preview painted on `toolOverlayRef` stays invisible even when the handlers fire.

**Every exhaustive surface over `ToolName`.** There is no `switch` over `ToolName` anywhere in
`src/` — the exhaustive sites are registries plus two hand-written chains:

- `Record<ToolName, …>`: `src/tools/toolProcessors.ts:77`, `src/tools/toolsMap.ts:33-39`.
- `satisfies ToolArgsByName`: `src/tools/settings.ts:180`; total assignment `:199`.
- `never` trap in a chain: `src/util/settings.ts:81`.
- Hand-written chains, **not** compiler-checked, red at runtime instead:
  `src/components/Main/Main.tsx:50-76`, `src/util/settings.ts:20-83`.
- Near-total, checked only by a test: `toolbar-mapping.ts:86-116` `availableTools`.
- Hand-copied unions the typecheck cannot see drift in: `src/components/SidebarLeft/types.ts:3-37`
  is **not** derived from `ToolName`, and the use site
  `src/components/SidebarLeft/SidebarLeft.tsx:131` is an unchecked `toolIcons[tool.name]`, so it
  typechecks only because `ToolName ⊂ ToolIconName` today.

**Single-owner files.** Steps 1, 3, 4, 5, 6, 7, 8, 9 and 13 are small registries every layer edits
and that are positionally coupled to each other. Assign the whole spine to one session. If another session already has one of these open
when you start, **stop and report** rather than editing: a merge of two `toolProcessors.ts` edits is worse than a delay, and `git status`
in a shared worktree is not a lock.

### The gesture contract

The shared primitive is `usePointerPosition` (`src/hooks/usePointerPosition.ts`): `isPointerDownValid` `:122`, `isPointerMoveValid`
`:135`, `isPointerUpValid` `:142`, `getLocalCoords` `:167`, `isMouseDown` ref `:33`. The first pointer wins and sets capture, so a second
finger is not a second gesture.

The reference lifecycle is `src/components/Main/DrawToolArea.tsx`: **pointerdown** `:46-57` (validate, `setupDrawCtx`, seed
`pointsRef.current = [coords]` at `:54`, first paint at `:56`);
**pointermove** `:59-66` (bail unless `isMouseDown.current`, push one point, repaint);
**pointerup** `:68-91` — the **only** commit. There `:77` converts canvas points to document
space, `:78` computes `pointsBoundingPos`, `:79` rebases points by `-pos`, `:82-85` builds the single `FullArgs`, `:87` makes exactly one
`createLayerFromTool` call, and `:89-90` clears the ref and the overlay.

**ONE HISTORY STATE PER USER ACTION. Commit on pointer-up, never per pointer-move.** The
store splits preview from publication: `tempUpdateLayer` (`src/contexts/useLayer.ts:473`) writes a ref-backed preview and dispatches
nothing; only `updateLayerByTool` (`:264-320`) or `commitDirtyTool` (`:323`) publishes a history entry. `updateLayerByTool` itself does
this correctly — preview at `:304`, publish once at `:309-319` — so the rule is enforced by
_which function the tool area calls_, not by anything inside it. Call it on every pointer
move and undo becomes useless.

**Batching.** `DrawToolArea` repaints synchronously per move (`:34-44`) and that is a known defect,
not a template. If you batch in a `requestAnimationFrame`, cancel **and null** the ref on pointer-up; a cancelled-but-live ref repaints a
stale frame after the layer commits.

**Do not neutralise a shared-context defect.** `Main.tsx:87` hands every tool area the same 2D
context, so a painter must call `resetOverlayAlpha` and bracket in `save()` / `restore()`. Do
**not** write `ctx.globalAlpha = 1` at the top of setup as a fix: the commit path runs on a fresh
`OffscreenCanvas` at the slider's alpha, so forcing 1 on the overlay does nothing for the committed layer. A shared rect-drag hook already
exists (`src/hooks/useRect.ts`) with a three-phase contract — `onRepaint` during the drag, `onChange` on resize, `onChangeEnd` after
pointer-up. Use it instead of writing a fourth rect gesture.

### Inherited constraints

Pre-existing properties that decide the _shape_ of new code. Read each before you touch the file it names.

**1. The canvas is padded by the full `lineWidth` on every side and the stroke is committed as its own layer — so the
layer's area scales with `lineWidth²`, not `lineWidth`.** `pointsBoundingPos` (`src/util/draw.ts:20-25`) returns `{ x: minX - lineWidth,
y: minY - lineWidth, width: maxX - minX + 2 * lineWidth, height: maxY - minY + 2 * lineWidth }`.

`createLayerFromTool` (`src/contexts/useLayer.ts:219-262`) then makes that `pos` a fresh layer, so a 5000px tip allocates a 10000px square
for a single dot. This is why the shipped bar caps Size at 500 while Photoshop allows 5000:

```ts
// brush-toolbar:src/tools/brush.ts:54-63 (NOT YET MERGED)
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
resolved at layer creation, not while drawing.** The literal at `src/contexts/layer-utils.ts:169-185` is built first (`:173` hard-codes
`blendMode: 'source-over'`); only then does `:204-214` run the creator:

```ts
// src/contexts/layer-utils.ts:204-214
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
re-recording is gated on `testInfo.config.updateSnapshots === 'all'` (`e2e/export/visual-regression.spec.ts:73`). `drawPen` is the pattern
they encode:

```ts
// src/util/draw.ts:100-103 — one beginPath, one moveTo, one stroke() for a whole stroke
ctx.beginPath();
ctx.moveTo(points[0].x, points[0].y);
bezierSmoothedLine(ctx, points);
ctx.stroke();
```

_Defence:_ implement any new stroke behaviour as a **point-space filter applied once at the
seam**, not a stamp loop, and have the filter return its input array by identity at the neutral setting so the caller can skip
reallocation. Pin the call counts (`src/tools/__tests__/paint-tools.test.ts:227-229`). Never widen a threshold or re-record a baseline to
get green.

### The tripwire inventory

Find these **before** writing code. Procedure: (1) `git grep -n "Object.keys(defaultSettings)\|toolNames" src` for every suite that
_derives_ its roster and updates itself; (2) classify each hard-coded roster below and record the decision in the commit body; (3) run
`npm run test` with no behaviour change, so every failure is classified rather than discovered piecemeal.

| Suite                                                                              | Line                                                       | What it pins                                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `tool-processors.test.ts`                                                          | `:76-82`, `:84-98`, `:114-121`, `:123-145`                 | the `requiresRaster`, non-deterministic, raster-committed and creator rosters, each a literal `toEqual` |
| same                                                                               | `:159-193`, `:406-426`, `:428-436`, `:438`                 | `toolName → commit` for all 29 tools, plus the identity tables                                          |
| same                                                                               | `:363-384`, `:386-398`                                     | the placeholder list, and the TODO-badge test — see case (c)                                            |
| same                                                                               | `:548-587` (coverage `:589`), `:742-772` (coverage `:782`) | the dispatch and icon tables                                                                            |
| `src/components/Main/__tests__/Main.toolAreas.test.tsx`                            | `:107-133`                                                 | the `interactionMode` routing table                                                                     |
| `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx`               | `:12-30`                                                   | `PLACEHOLDER_TOOLS`, mirrored by hand                                                                   |
| `src/components/SidebarLeft/__tests__/harness.tsx`                                 | `:79-111`                                                  | `toolIcons` mocked with an explicit per-tool list                                                       |
| `src/components/SidebarLeft/__tests__/toolIcons.test.tsx`; `tool-settings.test.ts` | `:21-55`; `:255-268`                                       | a hand-copied `ToolIconName` union; every tool name survives `saveLastSettings`                         |

**Classify each red test into exactly one of three cases.**

- **(a) It pins the correct old behaviour.** Keep it passing; add your row. The common case.
- **(b) It pins a defect.** Invert it, and remove the `it.fails` pin in the same change — a pin is a
  tripwire that fails the moment the defect is fixed. Use `it.fails('...')` plus a `// BUG:`
  marker for anything deliberately left broken.
- **(c) Its only half disappears because you removed the last example of something.** Subtle, and
  it bit a real build.

**Case (c), the worked example.** `tool-processors.test.ts:386-398` read:

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
`brush-toolbar:src/components/ToolbarsRight/Paint/__tests__/Paint.test.tsx:147-160`, asserting both the absence of `TODO` and of every
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

`npm run test` is `vitest --run` on `pool: 'vmThreads'`, `maxWorkers: 4` (`vitest.config.ts:6-9`); a test that only fails in a full run is
usually the pool. All three templates below are complete and runnable; `<myTool>` is the only substitution and the bodies use the
illustrative name `eraser`.

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
`brush-toolbar:src/contexts/__tests__/layer-utils.blend-mode.test.ts` (not yet merged): it drives the real `createLayerSource` with the
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
   (`src/test/setup.ts:211-215`). A `last()`-style accessor therefore compares apples to
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

The reference model is `brush-toolbar:src/components/ToolbarsRight/Paint/__tests__/Paint.test.tsx` (not yet merged) — its
`describe.each([['Brush', …], ['Pencil', …]])` shape covers two tools that share one bar implementation and must stay independent, and its
closing `it('does not alias one tool settings object into the other')` is worth copying whenever two tools share an args type.

### The mandatory assertions

Each has a failure mode a weaker version of the same test would miss.

**1. The value survives a tool switch — not merely the key.** The key-survives test passed
happily while every setting was being discarded on the same tick. `toolName in lastSavedSettings`
(`src/tools/__tests__/tool-settings.test.ts:255-268`) is true for an arm that stores `{ toolName }` and nothing else, so the mandatory
test writes the values, switches to another tool, edits that tool, and switches back:

Editing another tool is what loses the value in production: it replaces the provider's in-memory args, so the switch back has to read
`lastSavedSettings`. Use the existing `switchToTool` helper (`src/util/__tests__/settings.test.ts:42-46`), which models the real read path
(`cloneSavedToolArgs`, `src/contexts/useCurrentTool.tsx:33-35`).

**2. An absent or zero setting renders byte-identically to the legacy path.** Assert the identity
result — `expect(smoothStrokePoints(zigzagPath, 0)).toBe(zigzagPath)` — never equality. The caller branches on `points === sampled` to
avoid allocating a new args object, so an equal-but-fresh array would silently add an allocation to every legacy `draw` stroke; `toEqual`
passes on it, and the legacy render is what breaks.

**3. A call-count invariant.** `beginPath` once, `moveTo` to the first sample once, `stroke()`
once (`src/tools/__tests__/paint-tools.test.ts:227-229`). A future stamp loop changes the render and the call counts together, so this is
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
(`expect(ctx.lineWidth).not.toBe(defaults.lineWidth)`, because `toBe(0)` passes for any input — `paint-tools.test.ts:241-243`), and assert
a degenerate input draws nothing while still returning a full-size canvas (`paint-tools.test.ts:268-276`).

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

This is the shape the repo already uses: `docs/handoffs/ps-transform-geometry-review-and-merge.md:101-103` records "Every new test was
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

`npx tsc --noEmit` resolves the app project alone and exits 0 while the tests do not compile. Read the `Test Files` count, not just the
pass line: a merge that silently drops test files is a failed merge. There is one setup file, `src/test/setup.ts` — a second one, or
global mocks on a path that expects them to load, silently changes what the suite exercises. `e2e/**` is excluded from `npm run test`;
those specs run under `npm run test:e2e`, and their helpers under `npm run test:e2e:unit`.

---

## Phase 6 — e2e

`npm run test:e2e` is headless and starts Vite itself. `e2e/**` is excluded from `npm run test`,
and `**/__tests__/**` plus `*.unit.test.ts` are excluded from Playwright (`AGENTS.md:140-142`). A
Playwright spec run in jsdom, or an e2e helper test run in a browser, fails in a way that looks like
a product bug.

### The browser rule

Read this before writing any e2e code, and reproduce it in every brief you dispatch. The substance
of `AGENTS.md:62-86`, which is binding:

> The e2e suite is headless by default and must stay that way. A headed browser puts a live,
> clickable window on the operator's screen for the whole run; their clicks, keystrokes, mouse
> movement and focus changes reach the page as real input, indistinguishable from the suite's own
> `page.mouse` / `page.keyboard` calls, so the run fails for reasons that are not in the code and
> look exactly like real races.

| Blocked                         | Why                                                        |
| ------------------------------- | ---------------------------------------------------------- |
| `playwright test --headed`      | a visible window                                           |
| `playwright test --ui`          | opens the Playwright UI in the default browser, and blocks |
| `playwright test --debug`       | forces headed and opens the inspector                      |
| `playwright show-report`        | opens a window, and blocks until it is closed              |
| `playwright show-trace`         | opens a window, and blocks until it is closed              |
| `playwright codegen` / `open`   | opens a window                                             |
| `PLAYWRIGHT_ALLOW_HEADED=1`     | the human's opt-in, not yours                              |
| `test.use({ headless: false })` | a live window                                              |

A headed run is **not merely inconvenient — it fails a disjoint set of tests.** The measured
disjoint sets (`e2e/OPEN_PROBLEMS.md:90-93`, `e2e/README.md:44-48`):

| specs                                                                                         | headed | headless |
| --------------------------------------------------------------------------------------------- | ------ | -------- |
| CDP, deriving expected size from `getDevicePixelRatio()` (`:113` `:129` `:146` `:163` `:195`) | 5 fail | pass     |
| CDP, explicit `deviceScaleFactor: 2` block (`:220` `:239`)                                    | pass   | 2 fail   |

The two groups are disjoint and each reproduced identically across repeats. Both are fixed, and the
fix was to remove the scale assertion rather than re-derive it, so the sets are now empty **by
construction, not by observation** (`e2e/OPEN_PROBLEMS.md:338-341`). "Do not fix a failure by
flipping the mode" (`AGENTS.md:83-84`) rests on that measurement, not a preference. If something
only reproduces visually, that is the operator's call — name the command and stop there.

Read a failure from disk, never a viewer: `screenshot: 'only-on-failure'` puts a PNG in the failing
test's `outputDir` under `test-results/`, and the `list` reporter on stdout is the pass/fail record
(`playwright.config.ts:87`, `AGENTS.md:232-236`).

### The brief template

The canonical instance is the brief that produced the shipped paint spec
(`brush-toolbar:e2e/paint-options.spec.ts`, 316 lines, a **not-yet-merged reference**). It is the
best e2e brief written in this repo because it removes every guess the subagent would otherwise
make. Fill it in; do not abbreviate it.

```markdown
Write ONE new Playwright spec file for the repo at `<ABSOLUTE WORKTREE PATH>`. You may create/edit
files; do not touch any other file. Do not commit.

## HARD RULES (read `<ABSOLUTE WORKTREE PATH>/AGENTS.md` first and follow it)

- **NEVER open a browser window** — no `--headed`, `--ui`, `--debug`, `show-report`, `show-trace`,
  `codegen`, or the headed opt-in variable. `npm run test:e2e` only, which is headless.
- You MUST set a distinct port so the run cannot attach to another checkout's :5173:
  `PLAYWRIGHT_PORT=<PORT> npx playwright test e2e/<file>.spec.ts`. Run it from the worktree root.
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
`e2e/levels.spec.ts:55-57,88-91` does: **match the LABEL PART ONLY with a regex, because the
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
the app; `e2e/README.md:193-196`). The duplication is deliberate: a mode added to the source list
fails the equality assertion instead of silently going untested. Leave the bar on its default at the
end.

**6 — a regression tripwire: the bar carries no `TODO` placeholder text.** The contract: no
regression back to the placeholder component. `ToolbarHorizontal` renders a
`TODO: unregistered tool placeholder` strip for a tool with no `toolboxComponent`, so without this
one line a regression to a placeholder bar is silent.

**The synchronisation rule.** Never a bare `waitForTimeout` after a draw. `waitForCanvasPixels`
(`e2e/helpers/canvas-helpers.ts:369`) is the single poll loop — 10 s timeout, 100 ms interval
(`:53-54`) — and every other wait in the file is a specialisation of it, so the timeout, the
interval and the error wording can only be changed in one place. Pass a named `description`: the
timeout error prints `Canvas did not render <description> within 10000ms`. `waitForCanvasRedraw`
(`:393`) is the dark-pixel specialisation. Two refinements the shipped spec added: a low-opacity or
light stroke is **invisible to `hasDarkPixels`**, which times out on a stroke that landed — write a
`CanvasPixelPredicate` polling for "no longer near-white" at the clip centre via
`getColorAtPoint(..., { ignoreNearWhite: true })`; and **re-measure the canvas box after the panel
opens**, because opening an options bar reflows the workspace and a box measured before the switch
can clip empty canvas (`e2e/levels.spec.ts:93-96`).

**Clip and coordinate helpers.** `takeLineScreenshot(page, box, name, testInfo, clip?)`
(`canvas-helpers.ts:191`) is the `page.screenshot` path; `captureCanvasScreenshot(page, box,
testInfo, name, clip?)` (`e2e/helpers/cdp-helpers.ts:25`) is the CDP path. Pass a **bare filename**
as `name`: only `outputDir` is created, so a name with a separator fails `ENOENT` and a traversing
name resolves outside it (`e2e/OPEN_PROBLEMS.md:216-237`). **Never divide by `devicePixelRatio`** —
and note that rule lives in a comment, not a guard (`cdp-helpers.ts:39-51`), so a future change can
delete the reasoning without deleting anything that fails. Downstream code derives the scale from
the decoded image dimensions instead, via `screenshotBoundsToCss` (`canvas-helpers.ts:30`) and
`screenshot-scale.ts` (`imagePointToCss` `:36`, `cssPointToImage` `:49`, `imageBoundsToCss` `:56`).

### Traps

`e2e/OPEN_PROBLEMS.md` holds latent e2e defects — ones no current run trips but that a new spec can
walk into. **Read it before investigating any e2e failure, and do not re-introduce a known defect**
(`AGENTS.md:216-218`). On the default headless run nothing fails (`AGENTS.md:207`), so a new failure
is a new defect, never a known one. Characterised, not listed:

1. **Empty input flowing into arithmetic.** `screenshotBoundsToCss` (`canvas-helpers.ts:30`) and
   `imagePointToCss` / `cssPointToImage` divide by the image or box dimension, so a zero-sized
   input yields `NaN` or `Infinity` instead of throwing — deliberately, so the modules stay
   branch-free and total, and it is pinned (`e2e/OPEN_PROBLEMS.md:174-181`). A `NaN` coordinate
   reaching `page.mouse.click` is opaque. **Reject a null or empty bounds result before you
   measure**, and throw a named error rather than asserting on it. The same class hides in the CDP
   helper: an empty `data` decodes to a zero-byte buffer that is written, attached and returned as
   a successful capture (`:110-130`), a response with no `data` surfaces as a raw `TypeError` from
   `Buffer` (`:153-172`), and a failing `cdp.detach()` replaces the capture error and destroys the
   cause (`:132-151`). Check the **decoded length**, not just the field.

2. **The positional canvas fallback.** `getWorkspaceCanvas` is `page.getByTestId('workspace-canvas')`
   and nothing else (`canvas-helpers.ts:187`). The removed `.or(nth(1))` was never a priority —
   `.or()` returns a union, so with the test id present the locator resolved to 2 elements and every
   `boundingBox()` raised a strict-mode violation; and the index was wrong anyway, because the Draw
   toolbar mounts a preview canvas ahead of the workspace and unmounting it on a tool switch shifted
   the index onto a hidden overlay (`canvas-helpers.ts:174-186`, `e2e/README.md:311-315`). That was
   `e2e/levels.spec.ts:64,109` before the test id landed (`e2e/OPEN_PROBLEMS.md:48-52`).
   **`getWorkspaceCanvas` is deliberately a single-selector locator so it can only ever match one
   element.** A tool whose own bar mounts a preview canvas makes the same trap reachable through a
   _new_ path, which is why the brief names it explicitly.

3. **The CDP capture-size assertion, and why it was mode-dependent.** The specs derived the expected
   capture size from `window.devicePixelRatio`, but the capture scale is neither a function of that
   value nor of the emulated ratio — it belongs to Chrome. The contract was **removed rather than
   re-derived** and replaced with assertions that hold everywhere: exact rect, one integral scale on
   both axes, correct pixels, no rescaling of the helper's own output (`e2e/README.md:295-300`).
   Each was mutation-tested. A new CDP capture assertion must not name a scale.

4. **The keyboard flyout race.** "The flyout closes asynchronously" was the reading this defect got
   stuck at. The real mechanism is a `requestAnimationFrame` focus handover — the app focuses the
   flyout's first item from a rAF in the tool button's keydown handler, not in the React commit that
   mounts the menu, so "the menu is visible" and "an item holds focus" are two moments one animation
   frame apart (`e2e/OPEN_PROBLEMS.md:274-306`). Over 12 runs: 5 of 12 failures waiting on
   visibility, 0 of 12 waiting on the promised item's focus. **Use `openToolFlyoutViaKeyboard`
   (`toolbar-helpers.ts:277`), never `waitForFlyout` (`:163`) alone** — the right-click path never
   focuses an item, so a shared assertion breaks it. And `ArrowUp` focuses the **last** item, so a
   single `.first()` assertion is simply wrong for that key. This entry is filed under
   `## Fixed — Enter did not reliably close the flyout` (`:257`), not among the open latents.

5. **The port race, and what a run can silently attach to.** `playwright.config.ts:21-22` takes the
   port from `PLAYWRIGHT_PORT`, defaulting to 5173; `:118-119` makes `reuseExistingServer` opt-out
   and turns it off entirely when a port is set, so an explicit `PLAYWRIGHT_PORT` is a request to
   test _this_ checkout. Without it a run attaches to whatever answers on :5173 — and where every
   worktree runs `npm run dev` on the same port, that is frequently a **sibling worktree's server**.
   The failure it produced was a strict-mode violation for a test id that existed only in the
   sibling's uncommitted tree, and it pointed at a locator bug in this worktree's helpers. The
   three-layer fix (`served-app.ts` proving which checkout answers, `--strictPort`, opt-in reuse)
   lives on an unmerged branch — `ps-integration:e2e/OPEN_PROBLEMS.md` §"P1 — a run could test a
   different checkout's application", a **not-yet-merged reference**. **Set `PLAYWRIGHT_PORT` in
   every worktree**, and put it in the brief so a subagent cannot forget.

Two more latent entries: a nearly transparent pixel counts at full weight in `dominantRed`
(`canvas-helpers.ts:220`) and `getColorAtPoint` (`:502`), so a light or translucent stroke makes a
colour assertion worthless (`e2e/OPEN_PROBLEMS.md:183-195`); and a bare `name` passed to
`captureCanvasScreenshot` is interpolated into a path unsanitised (`:216-237`). **Do not weaken a
gate to get green:** no skips, no raised thresholds, no deleted assertions, no re-recorded visual
baselines (`AGENTS.md:226-230`).

### Visual regression

Baselines live in `e2e/export/visual-regression.spec.ts-snapshots/export-baselines/`, resolved
through `testInfo.snapshotDir` rather than `snapshotPath()` so a baseline committed on one machine
does not read as missing on another (`e2e/README.md:239-259`). The directory holds 17 committed
files; 7 are read, one per format with `comparePixels: true` (`drawing.png.png`, `.jpeg`, `.webp`,
`.svg`, `.bmp`, `.gif`, `.avif`); the other 10 are orphans nothing references
(`e2e/OPEN_PROBLEMS.md:197-215`). `.gitattributes:14` marks the snapshot tree `binary` so
line-ending normalisation can never rewrite the committed pixels.

**A green run means the pixels matched** — only because the record-vs-compare branch is gated on
`testInfo.config.updateSnapshots === 'all'` (`e2e/export/visual-regression.spec.ts:73`). It used to
be `if (testInfo.config.updateSnapshots)`, and Playwright's default for that option is the string
`'missing'`, which is **truthy** — so every run re-recorded the committed baseline and returned
before `compareScreenshots`, and the comparison below it was unreachable. The 7 formats were a
no-op reporting success, invisible because re-encoding the same export produced byte-identical
files (`visual-regression.spec.ts:67-72`, `e2e/MIGRATION-TODO.md:52-60`). Budgets are `threshold:
0.01` and `maxDiffPixels: 100` at the call site (`:86-89`), defaulting to `DEFAULT_THRESHOLD = 0.2` /
`DEFAULT_MAX_DIFF_PIXELS = 100` / `DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01`
(`e2e/helpers/image-comparison.ts:27-29`); read the call site rather than assuming a budget.

**Re-recording requires an explicit `--update-snapshots` (`npm run test:e2e:update-baselines`) and
is a recording decision that belongs to the operator** (`AGENTS.md:228-230`). A missing baseline
attaches the export and then throws on purpose: the comparison was never made
(`visual-regression.spec.ts:80-84`).

**The baselines were recorded through the legacy `draw` tool**, so any change to the legacy raster
path invalidates them — the shipped brush handoff says so explicitly (`brush-toolbar:HANDOFF.md`
item 36: "baselines were recorded through the `draw` tool and are unaffected as long as `draw` is
left alone"). When a new paint engine changes stroke rendering, check that tripwire list before
touching a baseline.

---

## Phase 7 — delegation

Delegate **first**, not after you get stuck (`AGENTS.md:13-15`). A task that takes one context 40
sequential tool calls should be 8 subagents in parallel plus a synthesis; the sequential calls are
the defect, not the token count (`AGENTS.md:8-11`).

### The model policy

Space Bunny Alpha is **free and nearly as good as GPT Luna**, so it is the default on every
subagent where it makes sense, which is nearly all of them (`AGENTS.md:25-26`). Four rules, none
negotiable (`AGENTS.md:17-27`):

```ts
task({
  subagent_type: 'explore', // or 'general'
  model: 'Space Bunny Alpha (new)',
  provider: 'kilo',
  variant: 'max',
  prompt: '...',
});
```

- **Pass all three fields.** Omitting `model`, `provider` and `variant` inherits the current turn;
  passing them explicitly is what keeps a subagent free when the main turn is not
  (`AGENTS.md:39-40`). This repo's own history shows both shapes: the research wave passed
  `model: 'kilo/stealth/space-bunny-alpha'`, the review wave passed
  `model: 'Space Bunny Alpha (new)', variant: 'max'`. The `variant: 'max'` pairing is the one to
  copy for anything adversarial or architecture-shaped.
- **Never put a GPT model in a subagent unless there is genuinely no alternative.** They cost real
  money by the token on every call, and "this one is hard" is not an alternative — that is the
  judgement you were delegating away (`AGENTS.md:19-21`).
- **Cost roughly doubles past ~260k of context** (`AGENTS.md:22-24`). Keep the main turn lean and
  push fan-out into subagents that each start at zero.
- **Do not escalate to a paid model on your own** for "hard" or "risky" work. Override only when the
  operator named a model, and say so when you do (`AGENTS.md:41-42`).
- `agent_manager` is a different tool: only when the operator wants visible sessions or worktrees.
  `task` for everything else — it creates no sessions (`AGENTS.md:43-45`).

Background long work (`background: true`) and wait for every result you depended on. Never answer
while one is still running (`AGENTS.md:59-60`).

### The rule that actually matters

**Never two subagents on the same file. Split by concern, not by convenience** (`AGENTS.md:49`).

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

<Absolute paths, not relative. `.kilo` is gitignored (`.gitignore:34`), so it is not carried into a
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
  which path `src/util/selection.ts:400-403` now takes, given its "Fall through to CPU rasterization
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

`AGENTS.md:144-203` is authoritative. This section gives the commands, the order, and the failure signals.

### 8.1 The command list

```bash
npm run tsc             # tsc -b                                package.json:13
npm run build           # vite build                            package.json:9
npm run test:e2e:unit   # vitest, node env                      package.json:23
npm run lint:check      # eslint . --cache && prettier --check .  package.json:12
npm run test            # vitest --run, jsdom                   package.json:17
npm run test:e2e        # playwright, headless                  package.json:19
```

Measured cost (`AGENTS.md:157-158`): `build` 1.4s, `test:e2e:unit` 1.2s, `tsc -b` 7.4s, `test` 16s, `lint:check` 6-12s. Anything that would push the commit hook past ~10s belongs on the push hook. **There is no `npm run audit` script** — do not invent one; CI runs the binary directly at `.github/workflows/ci.yml:52`.

### 8.2 The typecheck trap

**`npm run tsc` is the only trustworthy typecheck** (`AGENTS.md:101-104`), and the reason is in the tree: `tsconfig.json:1-14` is a `files: []` solution stub whose own comment says a bare `npx tsc` / `npx tsc --noEmit` "resolves zero input files and always exits 0 — that is the design, not a defect". `tsc -b` builds its three references, and only `tsconfig.e2e.json:44` includes `e2e/**/*.ts` — so nothing but `tsc -b` type-checks a Playwright spec or an e2e helper unit file.

`--force` is **not** required: `tsconfig.app.json:3-8` states that with `noEmit: true` and no `composite`, `tsc -b` re-checks the project on every run, and `tsconfig.node.json:3-5` says the same for the node project. The old `npx tsc -b --force` merge-gate extra (`08-merge-plan.md:77-78`) predates that configuration. Run `npm run tsc`. Note also `tsconfig.app.json:43` is `"include": ["src", "toolbar-mapping.ts"]` — the root-level file is listed explicitly because `src` does not match it and it would otherwise enter the program only through its importers. A new root-level `.ts` needs the same treatment, or CI's coverage assertion fails.

### 8.3 What the hooks actually run

`.husky/pre-commit` and `.husky/pre-push` are 11-line `sh` files whose only executable statement is `npm run gate:commit` / `npm run gate:push`. Both delegate to `package.json` so the sequence a developer is gated by is a command anyone can run by hand (`package.json:30-32`):

| Command       | Contents                                                   |
| ------------- | ---------------------------------------------------------- |
| `gate:verify` | `tsc` → `build` → `test:e2e:unit`                          |
| `gate:commit` | `lint-staged --fail-on-changes --no-stash` → `gate:verify` |
| `gate:push`   | `gate:commit` → `lint:check` → `test`                      |

`build` is in the commit hook despite being cheap because it is **not** redundant with `tsc`: `vite build` runs Babel and esbuild, which strip types without checking them, so it alone catches Sass, wasm resolution, PostCSS and import resolution (`AGENTS.md:159-163`). `--fail-on-changes` is what makes the hook trustworthy: without it lint-staged re-adds whatever `eslint --fix` and `prettier --write` changed and the commit lands code that was never staged and never read; with it the fix stays in the working tree, the index is untouched, and the commit is blocked so you can read the change and stage it deliberately. `--no-stash` prevents a `WIP on <branch>` entry (`AGENTS.md:165-173`); `npm run format` (`package.json:15`) removes the extra round trip. The pre-push hook repeats `gate:commit` because a push can follow a `git commit --no-verify`, a rebase, or a cherry-pick (`.husky/pre-push:2-5`).

`lint-staged` covers only `*.{ts,tsx}` and `*.{md,yml,yaml,json}` (`package.json:37-45`) and `eslint.config.js:38` matches `**/*.{ts,tsx}` only, so a new `.scss` falls outside both: it can pass the commit hook and fail `lint:check` on push. Run `npm run format` before you commit, not after the hook blocks you.

### 8.4 Order, and what counts as a red flag

```bash
npm run tsc                                    # type errors first: cheapest to fix
npm run lint:check                             # formatting + lint, whole tree
npm run test                                   # jsdom: 0 failed AND no lost test files
npm run test:e2e:unit                         # node-env helper tests
npm run build                                 # bundler-only failures (sass, wasm, PostCSS)
PLAYWRIGHT_PORT=5199 npm run test:e2e          # headless, last: slowest, most environmental
```

- **The `Test Files` count DECREASED** versus the branch point. `08-merge-plan.md:79-80`: "A merge that silently drops test files is a failed merge." A decreased count with 0 failures means files were deleted or renamed out of the glob.
- **`prettier --check` failing on the two files you just wrote.** This happened for real. It is not a preference — the commit hook blocks on it. Run `npm run format`, read the diff, re-stage.
- **`npm run test` fails only in a full run.** `pool: 'vmThreads'`, `maxWorkers: 4` (`vitest.config.ts:7-8`, `AGENTS.md:105-106`). A timing-sensitive test that only fails in a full run is usually the pool — reproduce with one file and say so, rather than reporting a product bug.
- **A new test that passes with its fix reverted.** Revert one file, re-run, record the failure count, restore (`08-merge-plan.md:81-82`). A test that passes either way consumes a maintainer's trust and is worse than no test.
- **An e2e failure you cannot find in `e2e/OPEN_PROBLEMS.md`.** On the default headless run no e2e test fails: 97 pass, 2 skipped by declaration (`AGENTS.md:207-208`; the skips are `e2e/export/photopea.spec.ts:6` and `e2e/sidebar-flyout.spec.ts:48`, listed at `e2e/OPEN_PROBLEMS.md:308-317`). **A new failure is a new defect, never a known one** (`AGENTS.md:216-218`).
- **A `trace.zip` you cannot open.** The trace viewer is a window; ask the operator (`AGENTS.md:232-236`).

### 8.5 CI jobs

`.github/workflows/ci.yml` is the only workflow file: four jobs on push and pull request to `main`, plus `workflow_dispatch` (`ci.yml:3-10`), Node 24 from `.nvmrc`, `npm ci`, `permissions: contents: read` (`:20-21`).

| Job                 | Line         | Runs                                                                                                                                                                                        |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci`                | `ci.yml:24`  | `lint:check` → `npm audit --audit-level=high` → `tsc` → assert every tracked `.ts`/`.tsx` is inside some project's `include` (`:59-90`) → `test --coverage` → `build`. Uploads `coverage/`. |
| `dependency-review` | `ci.yml:127` | PR only (`:130`). Denies GPL-3.0-only / AGPL-3.0-only, fails on a high-severity advisory, allowlists licences.                                                                              |
| `e2e-unit`          | `ci.yml:157` | `test:e2e:unit` → `test:e2e:unit:coverage` → upload. A **separate blocking job** so a break in the app pipeline cannot remove the only gate on `e2e/` (`:149-156`).                         |
| `e2e`               | `ci.yml:205` | `npm ci` → cache Chrome → `npx playwright install --with-deps chrome` → `npx playwright test`. A **gate**, not `continue-on-error` (`:208-232`).                                            |

The "tracked file in a project" step is a real constraint: a new `.ts`/`.tsx` no project includes is type-checked by nothing, with no error anywhere. Scope it correctly, though — `tsc -b --listFiles` catches a file no project reaches but **not** one reachable only through its importers (`ci.yml:60-69`). There are no coverage thresholds anywhere (`vitest.config.ts:19-32`, `vitest.e2e.config.ts:38-43`); `--coverage` is for the report, not a percentage gate (`ci.yml:100-102`).

### 8.6 The one rule

**Never weaken a gate to get green** (`AGENTS.md:202-203`): no skips, no raised thresholds, no deleted assertions, no re-recorded visual baselines. The baselines are genuinely compared now: `e2e/export/visual-regression.spec.ts:73` gates re-recording on `testInfo.config.updateSnapshots === 'all'` — the exact string, because Playwright's default is the truthy string `'missing'` and the earlier truthiness check always re-recorded and returned before the comparison (`e2e/OPEN_PROBLEMS.md:328-337`). Re-record only with `npm run test:e2e:update-baselines` (`package.json:25`), an operator decision. Likewise a unit test that pins broken behaviour on purpose must have that pin removed in the same change as the fix (`AGENTS.md:220-224`).

---

## Phase 9 — the handoff doc

`HANDOFF.md`, `.kilo/plans/` and `e2e/OPEN_PROBLEMS.md` are strictly problem-focused and
todo-oriented: **no changelog, no "work completed", no status summaries.** Each entry is a validated
issue with a problem statement, the affected files and an actionable fix. Verify every claim against
the working tree first — stale line numbers send the next session after a bug that does not exist
(`AGENTS.md:238-245`).

### The lifecycle

Stated as a lifecycle, from `AGENTS.md:262-276` — the rule most often broken:

| State                        | What you do                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Validated issue, unfixed** | write the entry. This is the default.                                                                        |
| **Fixed and verified**       | **DELETE the entry.** The same change that fixes it removes it.                                              |
| **Fixed but unverified**     | the entry stays **alive**. Tighten it to say exactly what still needs verifying.                             |
| **Being reworded "fixed"**   | **forbidden.** A new entry wearing the old one's name. Delete it.                                            |
| **A trail of fixed issues**  | **pollution.** Prose the next session reads instead of a problem it can act on, burying the ones still open. |

The residue a fix may leave is **a tripwire in the test code, not a paragraph in the doc**. Several
`e2e/OPEN_PROBLEMS.md` entries are pinned by a unit test that asserts the current broken behaviour
on purpose: it passes today and fails the moment the defect is fixed, so **a fix must remove the pin
in the same change** (`AGENTS.md:220-224`, `e2e/OPEN_PROBLEMS.md:26-29`).

**Writing is the default, not a favour** (`AGENTS.md:247-254`). Leave a handoff doc, or edit the
existing one, whenever you find a validated issue, a strong recommendation, or a finding worth
preserving. The strongest case is a confirmed defect: you investigated, it is real, nobody else
knows. **Not finding anything is the only reason to leave the doc alone** — a session that found a
real problem and wrote nothing down still lost it. Do not ask permission to write one. Handoff docs
**ship with the code**, so the edit belongs in the same commit as the work that produced the finding
(`AGENTS.md:256-260`).

### Where the handoff goes

**`.kilo/plans/` is gitignored, so a plan there does not ship with the code, and a handoff doc that
does not ship is lost.** `.gitignore:34` is the single line `.kilo`, and it matches `.kilo/plans`:

```bash
$ git check-ignore -v .kilo
.gitignore:34:.kilo	.kilo
$ git check-ignore -v .kilo/plans
.gitignore:34:.kilo	.kilo/plans
```

Run that before writing. A plan in `.kilo/plans/` is a working document on one machine; a finding
worth keeping goes somewhere tracked. Three tracked homes, and they are **not interchangeable**:

| File                                        | Holds                                                            | Shape                                                                                                                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HANDOFF.md` (1509 lines, 43 `##` headings) | the cross-session problem list for the history/presentation work | `## <N>. [P0] — <claim stated as the defect>`, then `**Problem.**` / `**Fix.**` / `**Files.**`                                                                                                                                               |
| `e2e/OPEN_PROBLEMS.md` (363 lines)          | unfixed defects **in the test code**                             | `## P<N> — <defect as a claim>` → a bare `file:line` line with no label → prose proving it → `Fix: <imperative, and say what not to do>` → `Pinned by \`<test name>\` (\`:line\`) in \`<file>\`. A fix removes that pin in the same change.` |
| `docs/handoffs/<branch>-<topic>.md`         | the per-task record: decisions not derivable from the code       | unnumbered sections; the one example is `ps-transform-geometry-review-and-merge.md`, 254 lines                                                                                                                                               |

Severity in `e2e/OPEN_PROBLEMS.md`: **P1** = a wrong or misleading pass/fail, **P2** = latent
breakage or unmaintainable, **P3** = cosmetic/robustness (`:31-32`).

Putting a tool plan in `HANDOFF.md` is a category error; putting an unfixed e2e defect in
`docs/handoffs/` is a category error. `HANDOFF.md:9-10` scopes that file to the durable-replay
migration and the presentation/append boundary — "Tool features and visual fidelity are out of scope
unless a defect is caused by this work" — so **a new tool-feature defect is not a `HANDOFF.md`
entry**; it belongs in `docs/handoffs/<branch>-<topic>.md`.

**Numbering.** `HANDOFF.md` item numbers are stable identifiers other items cite, so they are
**never renumbered** — the gaps are entries that were fixed and deleted (`HANDOFF.md:5-7`). New
entries append at EOF after a `---`, taking the next unused number. The heading set runs `## 0.`
through `## 45.` with gaps at 3, 8, 30, 36 and 43, plus two non-item sections
(`## Known defects that are PINNED` at `:505`, `## Worktree hygiene` at `:530`).

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
prescribe the answer — that is the operator's decision, not a subagent's (`AGENTS.md:56-58`).
**`**Why it is not a wiring bug.**`** the field that makes a tool-parity finding survive a review
that starts by trying to wire it.

**The worked example** is items 36–41 of the shipped paint handoff (`brush-toolbar:HANDOFF.md`, a
**not-yet-merged reference**): six entries, all tool-parity problems the e2e spec and the unit
tests could not catch because they are _about_ the renderer's shape rather than any one control.
Item 36 carries the four-part form plus the tripwire field:

> **## 36. The Brush Settings panel has no representation in the renderer**
>
> **Problem.** `drawPen` (`src/util/draw.ts:106-114`) issues one `beginPath`, one `moveTo` and one
> `stroke()` for a whole stroke: the pen nib travels continuously along a path, and there is no dab
> loop and no per-dab compositing to modulate. Every remaining Photoshop paint control is defined in
> terms of a stamped tip, so none of them can be reached by wiring a field into the args — Hardness
> needs a radial edge-falloff kernel, Spacing needs arc-length resampling between stamps, Flow needs
> per-dab accumulation, and none of those exist on a single path.
>
> **Why it is not a wiring bug.** `buildDrawArgs` (`src/tools/toolProcessors.ts:61-67`) narrows
> `penType` to `'pen' | 'spray'` and both paint tools force `'pen'` (`:169`, `:182`), so the one
> per-point painter in the tree, `drawSpray` (`src/util/draw.ts:116-136`), is unreachable from a
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
> **Files.** `src/util/draw.ts:85-136`, `src/tools/toolProcessors.ts:61-67,165-193`,
> `src/tools/__tests__/paint-tools.test.ts` (the three call-count pins)

Item 41 carries the **needs-a-call** variant. Note what it does: it identifies the pin, says the
behaviour is "a decision, not an oversight, and it is not obviously the right one", and hands the
choice back without changing the pin or deleting the entry.

> **## 41. The brush bar opens on `Custom`, not on a preset, because the seeded opacity is 0.9**
>
> **Problem.** `matchPaintPreset` compares all four settings with a `1e-9` epsilon and returns `''` —
> rendered as `Custom` — unless all four match. The seeded brush is `alpha: 0.9, smoothing: 10,
lineWidth: 10, blendMode: 'source-over'` (`src/tools/settings.ts:115-134`) and the closest preset,
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
> `src/tools/settings.ts:115-134`, `src/tools/__tests__/paint-tools.test.ts` (the
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

1. **Extract every `file:line`** in the entry, including bare ranges (`src/util/draw.ts:6-27`).
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
already gone, or worse "fixes" a line that has nothing to do with it (`AGENTS.md:243-245`,
`:256-260`). The discipline the working `HANDOFF.md` states about itself, and that your entry
inherits:

> Every item below was re-verified against the working tree on 2026-09-27; claims that did not
> survive verification were dropped rather than softened. Re-read line numbers before editing —
> this file is a snapshot, not a live view. (`HANDOFF.md:3-5`)

**Dropped, not softened.** A claim that does not survive verification is deleted from the entry. It
does not become a hedged sentence.

### The same rule for the other docs

The rule is not scoped to `HANDOFF.md`. **A change that invalidates a count or a claim in another
doc fixes it in the same commit.**

- **A passing-test count is a real one that went stale.** `AGENTS.md:207` reads "97 pass, 2 are
  skipped by declaration", `e2e/OPEN_PROBLEMS.md:41-42` says the same, and `e2e/README.md:399-400`
  still carries the justification the count was drawn from ("2–4 of the 97 tests failed for
  documented reasons"). Every one moves the moment a test is added — which is why
  `e2e/README.md:276-284` points at the three commands instead of restating the numbers, and why
  `e2e/OPEN_PROBLEMS.md:13-17` now says plainly: "The numbers this file used to open with — tests
  passed, expected-fail pins, files, mode-specific failure sets — were each a snapshot of one tree,
  and each has been wrong since it was written while the number beside it stayed silent."
- **A claim about a gate is a real one.** `e2e/README.md:397-407` still says the `e2e` job "is
  still marked `continue-on-error: true`" and leaves "flipping `continue-on-error` to `false`" as
  the thing left to do. It is not: the job was promoted, and `.github/workflows/ci.yml:205-232`
  documents the promotion and why the old justification had stopped describing the suite.
  `AGENTS.md` already carries the new claim. **The README is the stale one** — fix it in the same
  commit that promotes the job, not three commits later.
- **A claim about the number of orphans, of pins, of files** moves the same way.
- **The trigger:** before committing any change, ask what it made untrue elsewhere — a promoted
  gate, a deleted entry, a removed helper, a changed test count. Then fix that too, in the same
  commit.

---

## Phase 10 — integration

Branches merge **leaf → integration line → `main`**, with `--no-ff`, and the full gate re-run after **each** merge, never batched (`08-merge-plan.md:67-73`).

### 10.1 Before you stage

```bash
cd /Users/bkalynovskyi/ph
git status --short                    # what is actually modified
git diff                             # another session may be in here
git log --oneline main..HEAD          # exactly what you are proposing
git add <explicit/path> <explicit/path>   # never -A
git diff --cached --stat
```

`08-merge-plan.md:112-115` records the lesson: four worktrees branched from one base, `main` moved substantially underneath them, and each branch was validated **in isolation** — so a green suite in a leaf says nothing about whether it still applies to today's `main`. Fast-forward onto current `main` first, one branch at a time.

### 10.2 Commit shape

Conventional Commits with a scope and a body that explains the _why_ (`git log --oneline -30`): `gates: …`, `docs(e2e): …`, `merge: 15 review branches from the untouched-code campaign`, `test(e2e): accept the File > New unsaved-changes confirm in setupIcoTest`, `fix(colors): re-anchor the CSS filter curve …`. Merge commits use the default `Merge branch '<x>' into '<y>'` form. The handoff edit belongs in the **same commit** as the work that produced the finding (`AGENTS.md:256-260`); a handoff that trails by one commit is a finding that survives one fast-forward without context.

### 10.3 The pre-commit hook rewrites your files — re-verify after

`lint-staged` runs `eslint --fix` then `prettier --write` on every staged `.ts`/`.tsx` (`package.json:38-41`). With `--fail-on-changes` the commit is **blocked** and the fix stays in the working tree:

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

Batching merges and then debugging four sets of failures at once is what `08-merge-plan.md:112-113` explicitly warns against; the full gate after each merge is what makes "which merge broke it" answerable. The model is `f534335`, "merge: 15 review branches from the untouched-code campaign": 15 `rev2/*` leaves into `rev2/integration`, then that line into `main` with a body listing the highlights, the gates run, and the pin delta. The handoff doc ships inside the merge.

Integration lines here are `rev2/integration`, `history/integration` and `cleanup/integration` — check with `git branch --list '*integration*'` before assuming one exists. `ps-integration` is **not** one: it is a parked preservation branch. `HANDOFF.md:579` lists it as holding unmerged commits and `HANDOFF.md:604-608` records that merging `wip/ps-integration` as written would break the others, because it reads `process.env.E2E_PORT` where they all use `PLAYWRIGHT_PORT`. Review it; do not land it.

### 10.5 When two branches touch the same file

The model is `08-merge-plan.md:9-16`: a `Worktree / branch | Phase | Owns` table with one line of owned files per session, written **before** the work starts. Four rules follow.

1. **One owner per file.** A file named in exactly one `Owns` cell is that session's to edit; a file named in none belongs to nobody — a plan defect, raise it before the work.
2. **The spine is a single-owner file set.** The registries — `tool-types.ts`, `toolProcessors.ts`, `toolsMap.ts`, `settings.ts`, `util/settings.ts`, `toolbar-mapping.ts`, `Main.tsx` — are edited by every layer and are positionally coupled. Two agents editing them conflict; an agent editing `toolbar-mapping.ts` beside one editing the e2e flyout testids produces tests that pass locally and fail after merge. Assign the whole set to one agent.
3. **A worker that needs a file it does not own stops and reports.** It does not reach. `08-merge-plan.md:44-49` records `ps-transform-geometry` being told to report needed changes in `layer-renderer.ts` / `useLayer.ts` / `materialization.ts` / `history-replay.ts` rather than edit them, and `docs/handoffs/ps-transform-geometry-review-and-merge.md:17` records that this boundary is _precisely why_ several defects it found still exist. State the boundary in the brief; do not assume it was read.
4. **A collision recorded in advance is resolved at merge, not during the work.** The worked example is `08-merge-plan.md:20-32`: `ps-shape-geometry` will make `ShapeToolArea.test.tsx` fail, the file is owned by another session, so the merge applies the new expected geometry and splits the case out of the `it.each`.

On an unpredicted conflict, do not resolve it by taking one side wholesale. Read both sides, then run the full gate — a green `tsc` on a mechanically-resolved conflict is not evidence.

### 10.6 Worktree removal is not a safety check

Removable only when **all four** hold (`HANDOFF.md:530-551`; the three tests at `:538-548`):

```bash
git rev-list --count main..HEAD        # 0
git merge-base --is-ancestor HEAD main # exit 0
git status --porcelain                 # empty, untracked included
git stash list                         # nothing to apply
```

"0 commits ahead of `main`" is **not** a safety test: a worktree whose work was never committed is 0 ahead _because_ nothing was committed, which is exactly the state that loses it (`HANDOFF.md:530-533`). All worktrees share one `refs/stash`, so that check is repo-level, and `git stash clear` is the one destructive command that touches it (`HANDOFF.md:544-548`). `git worktree remove` refuses a dirty or untracked worktree unless `--force`, so the exposure is exactly `--force` or `rm -rf`. Never either without all four.

Do not use the worktree count as a test. `HANDOFF.md:553-555` measured 59 on 2026-09-27; on 2026-09-28 `git worktree list` returns 107, `.git/worktrees/*/HEAD` returns 106, and there are 106 directories under `.kilo/worktrees/`. Three numbers, one checkout, no relationship to commits. `git worktree list` is also unreliable under this repo's permission config — fall back to `.git/worktrees/*/HEAD`.

### 10.7 Pre-merge checklist

- [ ] Up to date with `main`: `git log --oneline main..HEAD` empty, `git status --short` empty.
- [ ] `npm run tsc` clean. `npm run lint:check` clean, including the files you wrote.
- [ ] `npm run test`: 0 failed **and** the `Test Files` count has not decreased.
- [ ] `npm run test:e2e:unit` clean. `npm run build` clean.
- [ ] `PLAYWRIGHT_PORT=<free port> npm run test:e2e` clean; any failure located in `e2e/OPEN_PROBLEMS.md` or declared a new defect.
- [ ] Every new test fails without its fix, with the failure count recorded.
- [ ] Handoff entry in the same commit as the finding; fixed entries deleted, not reworded (`AGENTS.md:262-276`).
- [ ] `package.json` and `package-lock.json` unchanged; no new runtime dependency.
- [ ] No new comments in source except `// BUG:` and `// @ts-expect-error`.
- [ ] Staged by explicit path; `git diff --cached` read.
- [ ] Merged with `--no-ff`, full gate re-run **after this merge alone**.

---

## The tool backlog — what to build next

### How to read this

**Snapshot: `main` at `1c9c8de` (2026-09-28), branch `skill/photoshop-tool-creation`.** Every
`file:line` below was re-read against that tree. `AGENTS.md:243-245` is the rule this section
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

At `1c9c8de`:

| Measure                                      | Count                                   | Where                                                                                                                                                    |
| -------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registered tools                             | **29**                                  | `src/tools/toolsMap.ts:41-123`; the `ToolName` union has the same 29 members at `src/contexts/tool-types.ts:17-56`                                       |
| Entries in `availableTools`                  | **29**                                  | `toolbar-mapping.ts:86-116`                                                                                                                              |
| Registrations with a `PlaceholderTool`       | **10**                                  | `toolsMap.ts:75,80,85,87,91,97,102,107,112,121`                                                                                                          |
| Registrations with a real options bar        | **19**, over **14 distinct components** | the other 19 rows; five of them (`rectangle`, `ellipse`, `triangle`, `polygon`, `line`) all point at the same `Shape` component at `toolsMap.ts:113-117` |
| Registrations with `commit: 'unimplemented'` | **7**                                   | `toolProcessors.ts:194-219,225-229`; the shared no-op is `toolProcessors.ts:75`                                                                          |
| Photoshop toolbar slots with no tool at all  | **10 of 20**                            | FROM-MEMORY on the 20-slot Photoshop column; the app side is `toolbar-mapping.ts:37-84`, which renders 5 sections / 12 tiles                             |

So: three of the ten placeholders (`brush`, `pencil`, `color-replacement`) are `commit: 'raster'`
and genuinely paint. Seven are `unimplemented` and are the defect described in Tier 2.

**The structural finding — why the original inventory could not see a missing tool.**
`toolsMap` is typed `Record<ToolName, ToolProcessorDefinition & { icon; toolboxComponent }>`
(`toolsMap.ts:33-39,41`). The registry is _total_ over `ToolName`, and every row is a
`ToolProcessorDefinition`, so every row necessarily has a `commit`, a `replay`, an
`imageProcessor`, an `icon`, and a `toolboxComponent`. The type therefore has no way to say
"this Photoshop slot is empty", and no way to say "this row is a stub" — `PlaceholderTool` and
`Pen` are the same `ToolbarRightComponent` to the type. Absence is invisible _from inside the
registry_: an audit that walks `Object.keys(toolsMap)` gets 29 rows, all of which look equally
real, and **none of which is named Eraser**. The corpus's own
`.kilo/plans/ps-research/00-tool-inventory.md:15` scopes itself to "Registered tools (all 29 in
`availableTools`)" — so a missing tool was outside its universe by construction, not by oversight.
A gap list can only come from an external roster (Photoshop's toolbar) diffed against the
registry. That is what this section is, and it is why the original inventory's counts were right
and its gap list empty.

### Ranked gaps

**The cost criterion, so you can re-derive a row you disagree with.**

> **CHEAP** iff the tool can land as `commit: 'raster'` with no edit to
> `src/contexts/history-adapter.ts`, `src/contexts/history-model.ts`, or
> `src/contexts/materialization.ts`. **EXPENSIVE** iff it needs a new `commit` kind that lands on
> a closed union, a new engine, or a new document-model type.

The deciding lines, all verified at `1c9c8de`:

- **Why `raster` is free.** `operationForTool`'s raster arm is fully generic:
  `processorId: args.toolName` with **no allowlist** (`src/contexts/history-adapter.ts:416-424`).
  `DurableOperation`'s variant types it `processorId: string` — an open string, not a union
  (`src/contexts/history-model.ts:100-106`) — and the materializer resolves it by **lookup**,
  `toolProcessors[operation.processorId as keyof typeof toolProcessors]`, rejecting only an
  unknown name or a version mismatch (`src/contexts/materialization.ts:277-281`). Name-agnostic
  end to end. A new `raster` tool is CHEAP by construction.
- **Why `layer-operation` is not.** Three hard-coded name lists trip in sequence: the runtime
  allowlist `if (!['blur', 'color', 'levels'].includes(args.toolName)) throw`
  (`history-adapter.ts:391-402`, list at `:393`); the 3-member type union
  `DurableFilter.toolName: 'blur' | 'color' | 'levels'` (`history-model.ts:74-78`); and
  `filterForOperation`, a `switch` over those three names with **no `default` arm**
  (`materialization.ts:73-89`) whose missing return becomes a compile error the moment the union
  grows. A fourth filter name is a three-file edit minimum.
- **Why a commit kind with no arm is worse than either.** `operationForTool` **throws**
  `Tool ${args.toolName} cannot be replayed durably` for anything it does not handle
  (`history-adapter.ts:426`), and `convertLegacyHistorySafely` is **fail-closed for the whole
  document** on any error-severity diagnostic — it rolls back the asset transaction and returns
  `status: 'unavailable', document: null` (`history-adapter.ts:645-665`). One unhandled commit kind
  in the timeline voids the entire durable shadow, not just its own entry.
- **`source` is also generic.** A `commit: 'source'` `TOOL_ACTION` carrying a `layerSource` is
  routed to `create-layer` at `history-adapter.ts:500-504`, which snapshots whatever source the
  tool produced.
- **`selection` costs no durable work at all.** `history-adapter.ts:425` returns `null` for
  `selection` and `document-operation` alike — both are excluded from the durable shadow, and
  `e2e/OPEN_PROBLEMS.md` plus the `durable-cutover` constraint confirm selection state is still
  sourced from legacy replay. So a selection tool's cost is its _representation_, never its
  history.

---

#### Tier 1 — CHEAP, high frequency: `commit: 'raster'`, no history-file edit

Photoshop behaviour below is FROM-MEMORY unless a corpus file is named; the app-side column is
always verified.

| Tool                                                   | Photoshop behaviour (FROM-MEMORY)                                                                    | Status here                                                                                                                                                                        | COST                                                                                       | Deciding `file:line`                                                                                                                  | Effort                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Eraser** (Eraser / Background Eraser / Magic Eraser) | Paints the backdrop through the alpha channel; Brush-based, with Erase-to-History and Airbrush modes | **ABSENT** — `grep -rln -i eraser src` → 0 files                                                                                                                                   | **CHEAP**                                                                                  | `history-adapter.ts:416-424` (generic raster arm)                                                                                     | S                                           |
| **Clone Stamp** (+ Pattern Stamp)                      | Copies from a user-set source point, with Aligned and Sample-All-Layers                              | **ABSENT** — 0 hits for `clone-stamp` / "clone stamp"                                                                                                                              | **CHEAP**                                                                                  | `history-adapter.ts:416-424`                                                                                                          | M (needs a source offset + alignment state) |
| **Paint Bucket**                                       | Tolerance flood fill, contiguous / global, anti-aliased edge                                         | **ABSENT**, but `src/util/flood-fill.ts` (281 lines) **already exists on `ps/tool-expansion`**                                                                                     | **CHEAP**, but do not write it                                                             | `history-adapter.ts:416-424`; see `### Already in flight`                                                                             | S once the branch lands                     |
| **Gradient**                                           | Linear / radial / angle / reflected / diamond along the drag; multi-stop, dither                     | **ABSENT** — the 19 `gradient` hits in `src` are all CSS                                                                                                                           | **CHEAP** (`createLinearGradient` is universal)                                            | `history-adapter.ts:416-424`                                                                                                          | S                                           |
| **Dodge / Burn / Sponge**                              | Per-pixel tonal or saturation remap inside the brush footprint, with Exposure and Range              | **ABSENT** — the `dodge`/`burn` hits are `'color dodge'` / `'color burn'` blend-mode names at `src/contexts/psd-utils.ts:23-24`                                                    | **CHEAP for history, EXPENSIVE in effect**                                                 | `history-adapter.ts:416-424` for the history; the cost is the JS kernel, because the `ctx.filter` route is the inert one — see Tier 3 | M                                           |
| **Zoom / Hand / Rotate View**                          | Viewport transforms; commit nothing, record nothing                                                  | **ABSENT.** `zoom-container` is a bare class at `Main.tsx:167` with the transform commented out at `:170`, and `'zoom'` at `Main.tsx:50` is a dead sentinel meaning "no tool area" | **CHEAPEST** — view state, not document state, so no processor and no history entry at all | `Main.tsx:50,167,170`                                                                                                                 | S                                           |
| **Eyedropper / Color Sampler**                         | Samples a pixel; commits nothing, records nothing                                                    | **ABSENT** — 0 hits                                                                                                                                                                | **CHEAPEST**                                                                               | `SidebarLeft.tsx:56-58` already dispatches `SET_COLOR`; a sampler reuses it                                                           | S                                           |

#### Tier 2 — CHEAP, lower frequency, or a defect rather than a feature

| Tool                                                            | Photoshop behaviour (FROM-MEMORY)                                                                 | Status here                                                                                                                                                                                                                                      | COST                                                                                                                                        | Deciding `file:line`                                                                                                                                                                                     | Effort                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **The six pen-family tools + Custom Shape: hide or throw**      | Real vector paths; a path model                                                                   | **SELECTABLE AND INERT** — `commit: 'unimplemented'`, `unimplemented()` returns `[null as never]`                                                                                                                                                | **CHEAP** (a removal, not a build)                                                                                                          | `toolProcessors.ts:194-219,225-229` and `Main.tsx:50` — with **no** `interactionMode` arm, so `EventHandler` is `DummyToolArea` (`Main.tsx:158`) and the overlay is `display: none` (`Main.tsx:194-196`) | XS                                                      |
| **Elliptical Marquee** (+ Single Row / Single Column)           | A marquee shape; Shift for a circle, Alt from centre                                              | **ABSENT** — only `rectangular-selection` exists                                                                                                                                                                                                 | **CHEAP for history** (`selection` → `history-adapter.ts:425` returns `null`); the loop representation caps it at no-AA, no-holes, no-modes | `toolProcessors.ts:158-164` is the template; `general-types.ts:61` is the ceiling                                                                                                                        | S                                                       |
| **Magic Wand** — contiguous, Sample All Layers, tolerance range | 0–255 tolerance, default 32; contiguous by default; Sample All Layers                             | **PARTIAL, and a no-op**: `magicWand` is `({ bitmap }) => () => [bitmap]` while registered `commit: 'selection'`                                                                                                                                 | **CHEAP** for history                                                                                                                       | `src/tools/magicWand.ts:10-14` against `toolProcessors.ts:152-157`; default tolerance 28 at `src/tools/settings.ts:109` (the 0–255 range is a FROM-MEMORY claim)                                         | M                                                       |
| **Shape-tool fidelity**                                         | Triangle is a drag-defined isosceles, Shift = equilateral; Line snaps 45°; shapes fill by default | **PARTIAL**: Triangle inscribes a _regular_ 3-gon; Line is excluded from every Shift constraint (`if (shiftKey && figure !== 'line')`); `backgroundColor: null` so nothing fills; `oval` carries a dead `cornerRadius`; `polygon` has no `sides` | **CHEAP**                                                                                                                                   | `src/tools/shape.ts:79` and `:166`; `src/tools/settings.ts:30,32,63`                                                                                                                                     | S — **but `wip/ps-shape-geometry` is already doing it** |
| **Text**                                                        | Paragraph layout, wrapping to a text box, justify, tracking, live font gating                     | **PARTIAL / raster-at-birth**: `text.split('\n')` then one `fillText` per line, and `getTextWidth` returns only the **widest** line, so `rect` is decoration, not a wrap box. `lineHeight` is an em multiplier, not a baseline distance          | **CHEAP** — `commit: 'source'`, routed to `create-layer`                                                                                    | `toolProcessors.ts:125-131`; `src/tools/text.ts:47,48-50,53-64`; `src/tools/settings.ts:69`                                                                                                              | M                                                       |
| **Count / Note / Ruler**                                        | Measurement and annotation overlays                                                               | **ABSENT**                                                                                                                                                                                                                                       | **CHEAP** for Count and Note (no commit); Ruler needs a persistent screen-space overlay, which no layer has                                 | `Main.tsx:199-205` is the only other overlay canvas, and it is `display: none` for every tool but `reposition`                                                                                           | S                                                       |

#### Tier 3 — needs a new engine, a new `DurableOperation` variant, or a new document type

| Tool / gap                                                                                    | Photoshop behaviour (FROM-MEMORY)                                      | Status here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | COST                                                                                                                                                                                             | Deciding `file:line`                                                                                                                                                       | Effort                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **The `ctx.filter` Safari refusal**                                                           | n/a — this is a correctness fix, not a feature                         | **PARTIAL and wrong on a shipping browser.** Five sites write `ctx.filter` into an `OffscreenCanvas`: `src/tools/blur.ts:11`, `src/tools/colors.ts:12`, `src/tools/levels.ts:12`, `src/contexts/materialization.ts:247`, `src/contexts/layer-renderer.ts:72`. No feature detection exists — `grep -rn "SUPPORTS_CTX_FILTER\|'filter' in" src e2e` returns **0**                                                                                                                                                         | **CHEAP** to add the refusal, and it is the _prerequisite_ for every per-pixel tool above                                                                                                        | `materialization.ts:73-89` (`filterForOperation`) is the switch to extend; a `'filter' in ctx` check is **insufficient** — see the trap list                               | S                              |
| **Blend modes**                                                                               | 27 modes with a real compositing equation; separable and non-separable | **PARTIAL** — `blendMode: GlobalCompositeOperation`, the browser's enum, passed straight through                                                                                                                                                                                                                                                                                                                                                                                                                        | **EXPENSIVE** — a new engine, not a new commit kind                                                                                                                                              | `src/contexts/layer-types.ts:60`; a 29-line partial slice already exists on `ps/tool-expansion` (`src/contexts/layer-utils.ts`)                                            | L                              |
| **The healing family** (Spot Healing, Healing, Patch, Content-Aware Move, Red Eye)            | Content-aware synthesis of the covered region                          | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **EXPENSIVE** — a content-aware engine. The _history_ would be cheap (`raster`); the kernel is the cost                                                                                          | `history-adapter.ts:416-424` buys the history; nothing else exists                                                                                                         | L                              |
| **History Brush / Art History Brush**                                                         | Replays or resamples from the document's own history states            | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **EXPENSIVE** — Art History needs a per-operation snapshot buffer that no type in the tree models                                                                                                | `src/contexts/history-types.ts` has no per-step pixel payload; the durable baseline (`history-adapter.ts:466-471`) is a single state, not a tape                           | L                              |
| **Selection keystone** — mask, add/subtract/intersect, holes, disjoint islands, anti-aliasing | A region, not a loop                                                   | **PARTIAL** and structurally blocking. `Selection` is one `points: Point[]` boundary loop (plus optional `lifecycle` / `geometry` / `sourceTool` / `metadata`). `src/util/selection.ts:515` **binarizes** the anti-aliased alpha the Canvas2D just computed. `drawPolygonPath` (`:392`) uses the browser's non-zero default while `isPointInPolygon` (`:186`) is even-odd ray casting — the two disagree. `copySelectionToCanvas` (`:708`) routes **only** `feather-magnetic-lasso` (`:720`) through the feathered path | **EXPENSIVE** — a new document-model type. This is the keystone: it unblocks every paint tool, every region-scoped adjustment, and 4 selection tools at once                                     | `src/contexts/general-types.ts:61-70`; note `SelectionMode` **does** exist at `src/tools/selection.ts:5` but is `'fill' \| 'outline'`, a fill mode, not a combination mode | XL                             |
| **Selection Brush / Quick Selection / Object Selection**                                      | Paints or computes a region                                            | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **EXPENSIVE** — blocked by the keystone above, not by itself                                                                                                                                     | `general-types.ts:61`; a selection-creating tool cannot be expressed as a raster write                                                                                     | L (after the keystone)         |
| **`levels` = real Levels; `color` = Black & White + Tint**                                    | Channel selector, histogram, input black/gamma/white, output levels    | **PARTIAL**: `levels` is Brightness/Contrast, `color` is grayscale/sepia/saturation with a fixed `#d9c09a` sepia matrix. The corpus resolved both identities on 2026-09-26 and **neither was implemented** — `src/tools/settings.ts:37,38` are unchanged                                                                                                                                                                                                                                                                | **EXPENSIVE** — a `layer-operation` name trips three closed lists                                                                                                                                | `history-adapter.ts:393`; `history-model.ts:74-78`; `materialization.ts:73-89`                                                                                             | M                              |
| **Path Selection / Direct Selection**                                                         | Edits existing vector anchors                                          | **ABSENT**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **EXPENSIVE** — no vector path model exists anywhere in `src/`                                                                                                                                   | `src/contexts/general-types.ts` has no path type; `src/tools/toolProcessors.ts:194-219` is the pen family's current state                                                  | XL                             |
| **Path Operations, Transform Selection, Select menu**                                         | Boolean path ops; Select ▸ Modify / Grow / Similar / Refine Edge       | **PARTIAL**: the **Select menu does not exist at all** — `src/components/Menu/Menu.tsx` is 13 lines rendering only `DesktopHeader` and `ToolbarHorizontal`                                                                                                                                                                                                                                                                                                                                                              | **EXPENSIVE** — combination modes and path ops are the keystone and the path model                                                                                                               | `src/components/Menu/Menu.tsx:1-13`                                                                                                                                        | M (menu shell) / L (the modes) |
| **The AI group** (Generative Fill, Generative Expand, Neural Filters)                         | Cloud model inference                                                  | **ABSENT** — no network surface, no async tool-completion model in the tool contract                                                                                                                                                                                                                                                                                                                                                                                                                                    | **EXPENSIVE** — and out of scope for this repo until a tool contract admits async, non-deterministic, cancellable commits. `replay.deterministic` (`toolProcessors.ts:53`) is a hard requirement | `toolProcessors.ts:53`; `history-model.ts:115-117` pins a schema version per entry                                                                                         | XL / defer                     |
| **The pen family proper** (Pen, Freeform Pen, Curvature Pen)                                  | Bezier path construction with anchors and handles                      | **SELECTABLE AND INERT** (see Tier 2) — the build is a separate, much larger job                                                                                                                                                                                                                                                                                                                                                                                                                                        | **EXPENSIVE** — a new document-model type                                                                                                                                                        | `src/tools/toolProcessors.ts:194-219`; nothing in `general-types.ts` models a path                                                                                         | XL                             |

### Suggested first three

Pick these three because each is CHEAP under the criterion above, each closes a _lie_ or a
high-frequency gap rather than adding a feature, and together they cover the whole playbook's
surface — options bar, processor, gesture, history, e2e — at the smallest honest size.

1. **Hide or throw the six pen-family tools + Custom Shape.** XS. Remove them from
   `toolbarMap` (`toolbar-mapping.ts:66-73,81`) and `availableTools` (`:90-101`), or give them an
   `interactionMode` arm that refuses. Either way the user stops spending a click to discover that
   a tool does nothing. This is the _defect_ half of the pen row, and it does not wait for a path
   model.
2. **The Eraser.** S. The most-used missing Photoshop tool, and the smallest one that is honestly
   `commit: 'raster'`: a Brush-shaped tool whose only new parameter is the erase composite. It
   exercises the entire playbook — options bar, `PaintToolArgs` extension, `commit: 'raster'`,
   `processorId` naming, the live-vs-undo guard, the per-tool test tables, the e2e spec — for the
   smallest possible surface.
3. **Zoom / Hand / Rotate View + Eyedropper, as one view-and-sample tranche.** S, and the
   cheapest of the three: none of them needs a processor, a history entry, or a `DurableOperation`
   variant. They are pure view state plus one pixel read. They close the two slots users reach for
   most and cannot currently reach at all.

**They fan out to parallel worktrees because their engine files are independent.** Item 1 owns
`toolbar-mapping.ts` and the pen rows of `toolsMap.ts`; item 2 owns new files
(`src/tools/eraser.ts`, `src/components/ToolbarsRight/Eraser/Eraser.tsx`); item 3 owns new files
plus `Main.tsx`. **The shared surface is small and additive, and it is the one thing to sequence
last:** the `ToolName` union (`src/contexts/tool-types.ts:17-56`), the `toolProcessors` row, the
`toolsMap` row, the `availableTools` entry, a `saveToolArgs` arm in `src/util/settings.ts`, and
four per-tool tables in `src/tools/__tests__/tool-processors.test.ts`. Those are line insertions
in a single-owner file set, not refactors — plan for one merge to reconcile them rather than
pretending they are free.

**Do not start item 3's `Main.tsx` work without reading `wip/ps-ux-chrome` first** (see below): it
rewrites the options bar and the theme tokens wholesale.

### Already in flight

`git branch --list 'ps/*' 'wip/ps-*' 'docs/ps-*'` at `1c9c8de`, with
`git merge-base --is-ancestor <branch> main` as the merged test. `ahead`/`behind` are against
`main` at `1c9c8de`. **A "0 commits ahead" branch is not a safety test** — a worktree whose work
was never committed is also 0 ahead.

| Branch                  | Merged? | ahead/behind | Tip                                                                                      | What it is doing — sequence behind it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------- | ------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ps/brush-engine`       | **NO**  | +1 / 59      | `bf96b72` "feat(tools): give the brush and pencil a Photoshop options bar"               | Replaces the `brush`/`pencil` placeholders with a real options bar (`src/components/ToolbarsRight/Paint/Paint.tsx`, +227) and a real brush (`src/tools/brush.ts`, +168), and **deletes** two keys from `toolbarPlaceholderConfig.ts`. 23 files. A strict subset of `ps/tool-expansion` (same tip commit).                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ps/tool-expansion`     | **NO**  | +3 / 3       | `de88730` "feat(util): shared pixel, flood-fill, brush-tip and paint-stroke foundations" | **The big one.** 31 files, +5941/-188. Contains `bf96b72` as an ancestor, so it supersedes `ps/brush-engine` entirely. Adds `src/util/pixels.ts` (383), **`src/util/flood-fill.ts` (281)**, `src/util/brush-engine.ts` (333, with a 609-line test), `src/hooks/usePaintStroke.ts` (304, 461-line test), a 29-line blend-mode slice in `src/contexts/layer-utils.ts`, and `e2e/paint-options.spec.ts` (316). **This already contains the Paint Bucket's flood-fill foundation and most of the brush engine.** Two Tier 1 rows are therefore half-built — check here before writing either. It also rewrites `src/util/settings.ts` (+11/-1) and `src/util/magicWand.ts` (-176), so both of the persistence and magic-wand rows land with it. |
| `wip/ps-ux-chrome`      | **NO**  | +1 / 148     | `57aced8` "wip(preservation): snapshot of uncommitted ps-ux-chrome working tree"         | 42 files, +3492. Adds a **schema-driven options bar**: `src/components/ToolbarHorizontal/optionsBarSchema.ts` (352, + 301-line test), `ScrubbableField.tsx` (180), `OptionsBar.tsx` (130), `ToolbarHorizontal.tsx` (25, which is the `key={toolName}` remount line), plus `src/contexts/theme-tokens.ts` (33), a 725-line `src/index.scss` addition, and `railPanelIcons.tsx` (58). **Any options bar you build collides with this.** Read it before designing one; consider building on it.                                                                                                                                                                                                                                                |
| `wip/ps-shape-geometry` | **NO**  | +1 / 148     | `c43df1a` "wip(preservation): snapshot of uncommitted ps-shape-geometry working tree"    | 2 files: `src/tools/shape.ts` (+45/-11) and its test (+66). **This is exactly the Tier 2 "Shape-tool fidelity" row.** Do not duplicate it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `wip/ps-integration`    | **NO**  | +3 / 138     | `eb832f3` "wip(preservation): snapshot of uncommitted ps-integration working tree"       | 41 files. Merges `ps-transform-geometry` in, rewrites `src/tools/transform.ts` (+243/-…), and adds `src/util/homography.ts` (200) + `homography-resample.ts` (140) with 433 lines of tests. On the e2e side it adds `e2e/helpers/served-app.ts` (316) and a 35-line `vite.config.ts` change — **it is rewriting the served-app and Vite plumbing, so an e2e failure you see in a worktree may be this branch's churn, not yours.**                                                                                                                                                                                                                                                                                                          |
| `docs/ps-tool-playbook` | **NO**  | +1 / 4       | `025470e` "docs: add the tool-creation playbook, and file the cutover-gate defect"       | Adds `docs/tool-creation-playbook.md` (1368 lines) + 53 lines to `HANDOFF.md`. **This section supersedes its §12 and Appendices A/B**; see `### Corrections to the playbook`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ps/brush-stabilizer`   | **YES** | 0 / 59       | `446d7eb` "merge: record a polygon's selection drag once, per gesture"                   | Merged. Nothing to sequence behind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ps/brush-tip-core`     | **YES** | 0 / 59       | `446d7eb` (same commit)                                                                  | Merged. Nothing to sequence behind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Appendix A — the trap list

Every entry was checked against the tree at `1c9c8de`. Grouped by where it bites. Entries that
are about tooling _behaviour_ rather than tree state are marked **[unverified by me]** — I had no
`task` tool in this session's toolset, so I could not reproduce them, and I say so rather than
repeating them as fact.

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
   (`/Users/bkalynovskyi/ph/.kilo/plans/…`), not from the worktree. Verified: `.gitignore:34`
   matches `.kilo`, and `git ls-files .kilo` returns nothing. Note the corollary —
   `HANDOFF.md`, `docs/handoffs/`, and `e2e/OPEN_PROBLEMS.md` **are** tracked and do exist in a
   worktree.
3. **`node_modules` is empty in a worktree, and `tsc`/`vitest` still work anyway.** Symptom:
   typecheck and unit tests pass (Node walks up to the parent checkout), but Vite serves nothing
   and fonts/images/AVIF assets 404 — so the app looks broken in e2e and fine in vitest. Defence:
   `npm ci` in the worktree before debugging any asset that will not load. Per `AGENTS.md:139-146`.
4. **Every worktree's dev server wants :5173, and `reuseExistingServer` is on locally.**
   Symptom: "my change did nothing" in e2e — the run attached to a **different checkout**.
   Defence: `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` in a worktree. The two escapes are already
   wired: `CI` and an explicit `PLAYWRIGHT_PORT` both force `reuseExistingServer: false`, and
   `--strictPort` makes a clash a hard failure instead of a silent hop to 5174
   (`playwright.config.ts:106-120`).
5. **The main worktree is not stable while you work.** Symptom: your `git status` shows files you
   never touched, or a staging attempt picks up another session's work. Defence: re-read `git
status` / `git diff` before staging, every time, and stage only your own paths. Per
   `AGENTS.md:147-149`.

### Tooling

6. **`npm run tsc` is the only trustworthy typecheck.** Symptom: `npx tsc --noEmit` exits 0 while
   the test files and the Playwright specs do not compile. Cause: the root `tsconfig.json:9` is
   `"files": []` — a solution stub that references `tsconfig.app/node/e2e.json`, and
   `--noEmit` resolves the app config alone, which **excludes tests**. Defence: `npm run tsc`
   (`tsc -b`). Per `AGENTS.md:129-134`.
7. **Exactly one vitest setup file.** Symptom: a new mock's globals do not exist, or a second
   setup file silently never loads. Verified: `vitest.config.ts:17` lists exactly one path,
   `./src/test/setup.ts`, and `src/test/` contains only `setup.ts`. `src/__tests__/` holds
   `canvas-mock.ts` and `fixtures/`. Per `AGENTS.md:180-184`.
8. **The `agent_manager` tool in this build needs every optional key sent explicitly**
   **[unverified by me]** — arrays reportedly get mangled into `{ item: [...] }`. And
   `agent_manager` reportedly accepted 19 session requests and created none, which is why `task`
   is the default instrument. Consequence for this section: **I had no `task` tool in this
   session's toolset**, and `agent_manager` would have created worktrees — which the one-file
   constraint forbids — so every verification here is inline.
9. **A `task` call missing `subagent_type` fails with a schema error, not silently**
   **[unverified by me]**. Symptom if you omit it: a hard validation failure, which is the good
   outcome; the trap is the agent who retries with a paid model.
10. **A large subagent result comes back TRUNCATED.** Symptom: a summary that stops mid-table and
    a conclusion you were about to act on. Defence: the full text is written to
    `~/.local/share/kilo/tool-output/tool_<id>` — verified that the directory exists on this
    machine. Read the file, do not re-run the task. **[unverified by me]** as to the truncation
    itself.
11. **Research briefs that assert a premise get it DISPROVED.** Symptom: you implement the brief
    and produce wrong work. Verified instance: the corpus's own
    `01-photoshop-reference.md:888-911` records **17** briefing premises the research disproved —
    including "Blur Tool is Illustrator-only" (Photoshop has had a Blur tool since ~2023),
    "`triangle` lacks `creator: true`" (inverted — `rectangle`, `ellipse`, `line` lack it), and
    "Line Tool snaps to 15°" (45°; 15° is the Free Transform rotate snap). Defence: **verify the
    load-bearing claim yourself before implementing it, and never forward a subagent's finding
    uncritically** — the whole point of a research subagent is that it can be wrong.
12. **The legacy `draw` path's export baselines are committed.** Symptom: a correct-looking change
    to the draw/brush path fails visual regression. Verified: `e2e/export/visual-regression.spec.ts-snapshots/export-baselines`
    holds **17** tracked files. Defence: re-recording is `npm run test:e2e:update-baselines`,
    which is **an operator decision, not an agent decision** (`AGENTS.md:246`).

### Canvas and testing

13. **The global canvas context deliberately has no `getImageData`.** Symptom: a test that
    assumes pixel read-back **silently does nothing** — the code guards on
    `typeof ctx.getImageData === 'function'` to detect a reduced canvas, so the guard takes the
    fallback branch and your assertion passes vacuously. Verified:
    `src/test/setup.ts:185-190` states this in the doc comment; the opt-in is
    `createPixelCanvasContext` at `:191-209` or `makeMockCtx` from `@/__tests__/canvas-mock`.
14. **`installCanvasContextStub` returns a NEW mock context per `getContext` call.** Symptom: a
    `last()`-style accessor compares two _different_ context objects and every equality assertion
    fails, or worse, you "fix" it by caching and now assert on a stale context. Verified:
    `src/test/setup.ts:211-215` builds a fresh `createMockCanvasContext(this)` inside the
    `mockImplementation`, and `:217,:219-221` re-install it in `beforeEach` because
    `vi.restoreAllMocks()` drops it. Two live examples of the correct pattern:
    `src/tools/__tests__/image-processors.test.ts:27` (documents the hazard) and `:106,:121`
    (`lastCanvas().ctx`).
15. **`ctx.filter` is silently ignored by Safari on `OffscreenCanvas`.** Symptom: `blur`, `color`,
    and `levels` are inert in Safari **and still record a history entry**. Verified: five write
    sites — `src/tools/blur.ts:11`, `src/tools/colors.ts:12`, `src/tools/levels.ts:12`,
    `src/contexts/materialization.ts:247`, `src/contexts/layer-renderer.ts:72` — and **zero**
    feature detection (`grep -rn "SUPPORTS_CTX_FILTER\|'filter' in" src e2e` returns 0).
    Defence: a per-pixel tool that depends on it must **refuse to commit** rather than silently
    no-op, and `'filter' in ctx` is **not a sufficient probe** — the property exists on the
    prototype and only the Safari implementation ignores writes. The corpus's probe is the honest
    one (`01-photoshop-reference.md:951-955`): set it, read it back, compare to `'none'`.
    Do not weaken a test to get green here.

### Options bar

16. **An options bar that mounts its own preview canvas breaks every positional
    `page.locator('canvas')`.** Symptom: a strict-mode "resolved to 2 elements" violation, or
    worse, a silent test that clicks the _preview_ canvas and passes for the wrong reason.
    Verified live instances: `src/components/ToolbarsRight/Figures/Shape.tsx:301` and
    `src/components/ToolbarsRight/Draw/Draw.tsx:221` both render
    `<canvas ref={previewRef}>`. Defence: use the workspace-canvas helper —
    `getWorkspaceCanvas(page)` at `e2e/helpers/canvas-helpers.ts:187-189`, which resolves
    `data-testid="workspace-canvas"` and nothing else. The doc comment at `:174-186` records the
    exact history: an earlier `.or(page.locator('canvas').nth(1))` fallback was a wrong document
    index that shifted when the Draw toolbar unmounted its preview.
17. **The options component is force-remounted on every tool switch.** Symptom: local panel state
    (an open dropdown, a scrub-in-progress value) is lost the moment the user clicks the toolbar.
    Verified: `<ToolComponent key={toolName} />` at
    `src/components/ToolbarHorizontal/ToolbarHorizontal.tsx:25`. Defence: keep panel state in
    `useCurrentTool`'s tool args, never in component state.
18. **`toolsMap[toolName]?.toolboxComponent` swallows a missing registration.** Symptom: a typo in
    a tool name renders a TODO strip instead of failing. Verified: the optional chain is at
    `src/components/ToolbarHorizontal/ToolbarHorizontal.tsx:13`. Defence: because `toolsMap` is
    `Record<ToolName, …>` (`toolsMap.ts:33-39`), a row you forget is a **type** error, not a
    runtime one — so the `?.` only ever fires for a `ToolName` that is in the union but not in
    the map, which should be impossible. Treat a `?.` that fires as a registry bug.
19. **Inserting a flyout group renumbers every later section.** Symptom: an e2e spec that
    hard-codes `tool-flyout-<groupIndex>` silently targets a different tool's flyout. Verified: the
    testid is minted at `src/components/SidebarLeft/SidebarLeft.tsx:276` from
    `` `${sectionIndex}-${groupIndex}` `` at `:353`, or `` `two-column-${groupIndex}` `` at
    `:358` — so one-column and two-column layouts number the _same_ groups differently. Defence:
    select flyout items by `tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}`
    (`:299`, with the slug rule centralised at `toolbar-mapping.ts:28`), never by index.
20. **The primary tile is `group[0]`, and flyout test ids are mode-dependent.** Verified:
    `SidebarLeft.tsx:153` (`const primaryTool = primaryTools[groupIndex] ?? group[0]`), and the
    e2e expectation is derived from the same place
    (`e2e/helpers/toolbar-helpers.ts:205` "Verifies the primary tool shown on a grouped button
    matches the expected label"). Reordering a group's first item changes what a plain click
    selects.
21. **A shortcut must account for the backwards registry walk.** Symptom: the wrong handler
    fires, or two handlers both match and only the last-registered wins. Verified: matching walks
    `for (let i = shortcuts.length - 1; i >= 0; i--)`
    (`src/hooks/useKeyboardEvents.tsx:100-101`) and `break`s on the first hit (`:126`). Note the
    nuance that is easy to get wrong: `matchesShortcut` only tests `shift` when the declaration
    sets it (`if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) return false;`
    at `:70`), so registering both a plain and a `shift: true` variant is required _when both
    would match_ — not unconditionally. Also: `shortcut` in `toolbarMap` is **display-only** and
    binds nothing.
22. **Two independent `Escape` paths.** Symptom: one `Escape` both closes a flyout and cancels a
    draft. Verified: the flyout one is a raw `window` listener at
    `src/components/SidebarLeft/SidebarLeft.tsx:98-109` that calls `setOpenGroup(null)` and cannot
    be suppressed by `preventDefault` on the other. (The second path, in
    `PolygonClickToolArea`, I did **not** re-verify at `1c9c8de` — find it before relying on it.)

### Persistence

23. **A settings-persistence arm that saves a bare `{ toolName }` discards every value on the same
    tick — and a test that asserts only the key survives passes happily.** Symptom: a slider
    resets to its default the moment you touch another control; the options bar looks like it is
    saving. Verified: the arm at `src/util/settings.ts:54-65` matches nine tool names and stores
    `cloneDeep({ toolName })` — the _whole_ entry is the key, so `opacity`, `flow`, `hardness`
    and everything else are dropped on the next save. The correct pattern is two lines away, at
    `:66-70`: `...(lastSavedSettings[toolName] ?? {}), ...args`. Defence, and the reason this trap
    survives: `src/tools/__tests__/tool-settings.test.ts:51-56` asserts **only**
    `defaultSettings[toolName].toolName === toolName`, and `:422-428` asserts **only**
    `lastSavedSettings[toolName].toolName === toolName`. Neither test looks at a second field, so
    a regression here is invisible to the suite. When you add a tool, add an assertion about a
    **value** in the same change.
24. **The `never` trap can be defeated by a coincidentally matching string.** Symptom: a new tool
    name matches an existing `else if` arm and is saved under the _other_ tool's policy, so the
    exhaustiveness check never fires. Verified: `const _exhaustive: never = toolName;` at
    `src/util/settings.ts:81`. The arms above it are exact string comparisons, so
    `'ellipse'` vs `'oval'` vs `'oval-tool'` is decided by the spelling, not by intent.
25. **Tool settings are in-memory only.** Symptom: a reload resets every slider. Verified: the
    store is in-memory (`src/util/settings.ts` holds `lastSavedSettings` in module state), and
    `normalizeToolArgs` validates nothing but `figure`. Do not promise persistence in an options
    bar until there is a store for it.
26. **`toolbarPlaceholderConfig` is keyed `Record<string, …>`, so a mistyped key compiles.**
    Symptom: a placeholder renders with `undefined` options instead of failing. Verified: the
    record is `Record<string, readonly string[]>` at
    `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:1`, and `toolsMap.ts:27` types the
    lookup parameter as `keyof typeof placeholderToolGroups` — which, for a `Record<string, …>`,
    is just `string`. Two facts to know about the keys: **`rectangle` (`:8-18`) is defined and
    consumed by nothing** (`toolsMap.ts:113` gives `rectangle` the real `Shape` component), and
    the three anchor-point tools reuse the `pen` list (`toolsMap.ts:101,106,111`).

### History

27. **Undo runs the processor with no guard that the live path has.** Symptom: a processor that
    throws on a live pointer move degrades silently on undo, so a bad history entry replays as a
    no-op instead of an error. Verified and load-bearing: the live path **is** guarded —
    `try { … } catch (error) { console.error(error); return; }` at `src/contexts/useLayer.ts:543-550`,
    with a comment naming `transform` and its throwing argument shapes as the reason. The undo
    factory `applyRasterTool` at `src/contexts/useHistory.ts:98-108` has **no** try/catch. The
    asymmetry is real and it is the other way round from what older notes claim.
28. **`commit: 'unimplemented'` voids the whole durable shadow, not just its own entry.**
    Symptom: one history entry naming an unsupported tool makes the entire document
    `status: 'unavailable'`. Verified: `unimplemented()` returns `[null as never]`
    (`src/tools/toolProcessors.ts:75`); `operationForTool` throws for an unhandled commit kind
    (`src/contexts/history-adapter.ts:426`); and `convertLegacyHistorySafely` rolls back and
    returns `document: null` on **any** error-severity diagnostic (`history-adapter.ts:657-665`).
    This is correct fail-closed behaviour and must not be "fixed" by manufacturing a durable
    no-op operation.
29. **`commit: 'document-operation'` is a no-op in legacy replay too.** Verified:
    `src/contexts/history-replay.ts:192` is literally `if (processor.commit ===
'document-operation') continue;`. It silently loses **both** systems. The durable half returns
    `null` for `document-operation` alongside `selection` (`history-adapter.ts:425`), so the
    durable shadow is not the thing to fix.
30. **A missing durable replay case is a silent no-op.** Verified: `src/contexts/durable-replay.ts:69-143`
    is a `switch` on `operation.kind` with **no `default` arm**, and `materialization.ts:73-89`
    is likewise a switch with no `default`. Adding a `DurableOperation` variant therefore fails
    to _compile_ rather than to _replay wrongly_ — which is the correct failure mode, and the
    reason `layer-operation` is EXPENSIVE in this section.
31. **`replay.requiresRaster` is derived, not declared.** Symptom: you add a tool and rewrite the
    test's expected list, or you set `requiresRaster: true` on a `layer-operation` tool and CI
    fails on a rule you did not know existed. Verified:
    `src/tools/__tests__/tool-processors.test.ts:714-718` asserts
    `replay.requiresRaster === (commit === 'raster' || (commit === 'selection' && !creator))`.
    Older plans still recommend flipping the flag; that is now forbidden.
32. **There are per-tool tables in `tool-processors.test.ts` that a new tool must join.**
    Verified live sites, cited by symbol because the line numbers drift: `unimplementedTools`
    (`:428`), `paintWrapperTools` (`:438`), `argOverrides` (`:540`), `placeholderTools` (`:806`),
    the derived `requiresRaster` expectations (`:77-79`, `:110`, `:714-718`, `:728`). A new tool
    fails CI until each gains its row. This is the largest practical cost of adding a tool and
    the reason a mechanical registration is not free.
33. **`ToolIconName` is hand-copied into the test.** Verified: the test exists at
    `src/components/SidebarLeft/__tests__/toolIcons.test.tsx`; the union typecheck and the test
    are two different lists, so they can disagree silently. (I did not verify the old `:21-60`
    range — cite the file, not the line span.)
34. **`isToolDirty` reads as always-false, and the reason is not the one usually given.**
    Verified: the reducer arm **exists** — `case 'SET_TOOL_DIRTY':` at
    `src/contexts/StoreContext.tsx:358-362`, cleared by `SET_TOOL_NAME` at `:357`. What is true
    is that **no production dispatch ever sets it `true`**; three options-bar components say so
    in their own comments (`ToolbarsRight/Colors/Color.tsx:94`, `Blur/Blur.tsx:66`,
    `Levels/Levels.tsx:69`). Never build a reset/undo affordance on it.
35. **`flattenRequired` is set by no shipped processor — and the tree says so.** Verified: the
    field is declared at `src/tools/toolProcessors.ts:50` and the consuming branch at
    `src/contexts/useLayer.ts:271-275` carries the comment "No shipped processor sets
    `flattenRequired`, but the flag is part of the processor contract and this branch runs it".
    A branch only tests can reach. A new processor must not set it.
36. **Every tool area shares one 2D overlay context.** Symptom: a new painter's `globalAlpha`,
    `setLineDash`, or `lineCap` leaks into the next stroke or the next tool. Verified:
    `src/components/Main/Main.tsx:87` takes the single `toolOverlayRef` context, and
    `src/tools/draw.ts:27-45` (`setupDrawCtx`) has to set every property unconditionally —
    including the `else ctx.setLineDash([])` else-branch — precisely because the context is
    shared. Defence: bracket `save()`/`restore()`, and do **not** "fix" it by writing
    `globalAlpha = 1` at the top of setup, which flattens the committed layer.
37. **Two separate `canvas` elements and a third for rects; the `display` allowlist is a separate
    list from the handler list.** Verified: the workspace canvas is
    `data-testid="workspace-canvas"` (`Main.tsx:174-178`), the tool overlay's `display` is a
    hard-coded array at `Main.tsx:184-196`, and the rect overlay's is `[...].includes(...)` at
    `:203`. A preview painted on `toolOverlayRef` is invisible even when the handlers fire.

### Docs

38. **`HANDOFF.md` citations go stale the moment you add an import.** Symptom: a future session
    reads a `file:line` that has moved and either wastes an investigation or "fixes" a bug that
    does not exist. Verified: `HANDOFF.md` is **1509 lines** at `1c9c8de`, and the drift is not
    hypothetical — a branch's own citation to `src/contexts/history-adapter.ts:199` for the
    `create-layer` emission is wrong here; it is at **`:504`**. Defence: re-verify every citation
    in the handoff you are about to commit, in the same commit, by grepping the tree for each
    line and opening it. (No citation-checking script is checked into the repo at `1c9c8de` — the
    sweep is manual, so budget for it.)
39. **A passing-test count written into a doc goes stale and must be fixed in the same commit.**
    Verified: `AGENTS.md:207` asserts "no e2e test fails: 97 pass, 2 are skipped by
    declaration", and `e2e/OPEN_PROBLEMS.md` carries 12 `##` entries. Any change to the suite
    invalidates the number. Defence: the same commit that changes the count edits the sentence.
40. **A handoff entry's lifecycle is delete-or-nothing.** Symptom: a session "updating" a fixed
    problem into a closed one, which buries the open problems. Defence: `AGENTS.md:250-267` —
    fixed and verified **deletes** the entry; never rewrite it as "fixed in abc123"; unverified
    is not closed, so tighten it to say what still needs checking and let verification delete it.

### Process

41. **Never open a browser window.** Symptom: a headed run puts a live window on the operator's
    screen and their input arrives as real test input, producing failures that look like races.
    Defence: `AGENTS.md:64-108`, enforced twice — `kilo.jsonc` denies the flags and
    `e2e/global-setup.ts` refuses the rest, checking the **resolved per-project** `use.headless`
    rather than the config file (`e2e/global-setup.ts:19-35`, allow-list env at `:42`). A
    `test.use({ headless: false })` inside a single spec file is the one case it cannot see
    (`:25`). If something only reproduces visually, ask the operator to run
    `npm run test:e2e:headed` themselves. Never flip the mode to "fix" a failure.
42. **Do not weaken a gate to get green.** No skips, no raised thresholds, no deleted assertions,
    no re-recorded visual baselines. `visual-regression.spec.ts` re-records only under an explicit
    `--update-snapshots` (`npm run test:e2e:update-baselines`), and that is an operator decision
    (`AGENTS.md:246`).
43. **A test that pins a defect is a tripwire, not a test.** Symptom: you fix the defect, the
    "failing" test goes green, and you never notice the pin. Defence: `AGENTS.md:230-234` — a fix
    must **invert** the pin in the same change. And the sharper form: **a test whose only half
    disappears when you remove the last example must be re-aimed, not deleted** — if a test exists
    only to assert the behaviour of one instance, removing the instance silently removes the
    assertion, and the correct move is to repoint it at a surviving case.
44. **Do not start a single-writer durable cutover yet.** `saveLayerCanvas()` can still promote
    cached canvases outside reducer publication. `AGENTS.md:302-307` and the `durable_cutover_gate`
    constraint both hold. Treat the legacy `HistoryItem[]` path as the production replay
    authority.
45. **Two subagents on the same file is a merge conflict you scheduled yourself.** Split by
    concern, not by convenience (`AGENTS.md:53`). In this backlog the natural shared surface is
    the registry (§ `### Suggested first three`): if two tranches both add a tool, they both want
    `toolsMap.ts`, `tool-types.ts`, `toolbar-mapping.ts`, and four test tables. Assign that
    surface to one owner explicitly.
46. **A subagent claim without `file:line` is not verified.** `AGENTS.md:57-59`. Ask for
    candidate results _and_ how they got them, then check the load-bearing ones yourself. The
    same rule governs a subagent's _negative_ claim ("X does not exist") — make it grep something.

## Appendix B — the research corpus that already exists

`/Users/bkalynovskyi/ph/.kilo/plans/ps-research/` — 11 files, ~265 KB, in the **main** checkout
only. `.gitignore:34` matches `.kilo`, and `git ls-files .kilo` returns nothing, so **a worktree
has none of it** (trap 2). Read it from the main checkout.

**The rule: read before re-researching. A new research wave that ignores this corpus does not
"start fresh" — it duplicates work that already has file:line anchors and a corrections log.**
Treat every claim as unverified until re-checked against the working tree: the corpus was written
against an older revision, and `08-merge-plan.md` in particular describes a campaign that has
since merged.

| File                                   | What it is FOR                                                                                                                                                                                                                                                                                                                                                     | When to read it                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                            | The entry point. 8-row file table, the three resolved decisions (D1 `color` = Black & White + Tint, D2 `levels` = real Levels, D3 destructive), a "land these first" list, the phase overview, and a candid list of what to be sceptical about. **Read this one first and completely** — it is the map                                                             | Before anything else. Re-read `:30-61` before planning a tranche: five items there are still unlanded                                                                                                                                                                               |
| `00-tool-inventory.md`                 | All 29 registered tools vs Photoshop, the five highest-impact findings, plus Notes A/B/C on `color`, `levels`, and Free Transform. **Scope caveat: its universe is the registry, so it structurally could not surface a missing tool** — that is exactly the finding in `### Where the app stands`                                                                 | For orientation and for the "is this tool partly built?" question. **Not** for "what is missing" — this section is the replacement                                                                                                                                                  |
| `01-photoshop-reference.md`            | The behaviour spec across 7 tool families with every claim cited, plus **§10 (`:888-955`), the corrections log**. The largest and most valuable file here                                                                                                                                                                                                          | Implementing or reviewing any tool. **§10 before you trust any Photoshop claim** — it lists 17 disproved premises and 18 genuinely unresolved items                                                                                                                                 |
| `02-implementation-plan.md`            | 10 phases, sequenced, with `file:line` anchors, per-test verdicts, and a suggested landing order at `:1077`                                                                                                                                                                                                                                                        | Deciding what to build next. Cross-check its phase table against this section's ranking — the two disagree in places, and where they do, this section is at `1c9c8de` and the plan is not                                                                                           |
| `03-ui-chrome-spec.md`                 | Theme palette, typography, the control vocabulary, **options-bar contents per tool (`:175`)**, cursors, specific widgets, and an explicit "Unverified — do not present as fact" section at `:333`                                                                                                                                                                  | Any visual work. Read `:333` before putting a hex value in code. Check `wip/ps-ux-chrome` first — it may already have built this                                                                                                                                                    |
| `04-blend-modes-and-brush-spec.md`     | All 27 blend modes with formulas and separability flags, the compositing equation, Opacity-vs-Flow math, brush tip and dab rendering, airbrush, smoothing, auto-erase, color replacement, performance, symmetry. §2 and §8 are what make the blend-mode and `color-replacement` rows implementation-grade                                                          | Before touching blend modes or the brush engine. **Much of it is already written on `ps/tool-expansion`** — port, do not rewrite                                                                                                                                                    |
| `05-selection-mask-migration.md`       | The selection keystone: an exhaustive call-site inventory, the exact proposed types, combination-mode design, a marching-squares spec, a per-test impact table, a migration order, and risks/non-goals. This is the document that makes the Tier 3 keystone row actionable                                                                                         | **Start here** for any selection or region-scoped work. It is the single highest-leverage file in the corpus                                                                                                                                                                        |
| `06-adjustments-and-color-pipeline.md` | The sRGB/XYZ/Lab pipeline with exact matrices, real Levels (D2), real Brightness/Contrast, Black & White + Tint (D1), Hue/Saturation and Colorize, the other four adjustments, an engine-independent Gaussian blur, LUT strategy, and a recommended architecture. §11 marks what is reconstructed                                                                  | Before the `levels`/`color` row. The JS kernels it specifies are the correct replacement for the `ctx.filter` path                                                                                                                                                                  |
| `07-test-harness-and-migration.md`     | The canvas-mock capability report, **§3 the verdict on the seven suspected "tests that assert bugs"**, the affected test files, the established conventions for writing a test here, coverage gaps, and a rewrite order. Its headline finding (the harness silently discarded every `ctx.filter` write) is now **fixed** — read it to see the shape, not the state | Before writing any code, per the corpus README. Read `src/test/setup.ts` for the current state; read this file for the reasoning behind the conventions                                                                                                                             |
| `08-merge-plan.md`                     | The ownership map, known collisions, merge order, per-merge checklist, cross-cutting state at merge time, and what is deliberately not being fixed                                                                                                                                                                                                                 | **Largely superseded.** It describes a campaign that has since merged into `main`. Use `### Already in flight` above for current branch state                                                                                                                                       |
| `RESEARCH-BRIEF.md`                    | The constraints brief the research itself ran against — the hard rules, repository orientation, and the architecture constraints any recommendation must respect. It is what the research **disproved**, so reading it is how you learn which of your own assumptions came from a premise rather than a source                                                     | When you need to know _why_ a recommendation looks the way it does, or when you are about to write a research brief of your own. **Its `## 10. Open questions / unknowns` (`:160`) and `## Rules for accuracy about the current code` (`:168`) are the two sections to read first** |

### The corpus's own §10, and the four corrections that change a backlog decision

`01-photoshop-reference.md:888-911` records the premises the research **disproved** — acting on
the original briefing would have produced wrong work. Four of them change what this backlog
should recommend:

1. **"The Polygon Tool is click-to-place-vertices" → it is drag-defined**, inscribing a regular
   n-gon. The real `shape.ts:166` behaviour (`const sides = figure === 'triangle' ? 3 : 5`) is
   therefore _closer_ to right for polygon than the app's own code suggests, and the defect is the
   **Triangle** (drag-defined isosceles, Shift = equilateral), not the polygon. Do not "fix" the
   polygon into a click tool.
2. **"The Triangle Tool draws a regular inscribed triangle" → it is a drag-defined _isosceles_,
   and Shift means equilateral, not aspect-snap.** This makes the `shape.ts:79` Shift-exclusion a
   genuine defect, and it is the sharpest of the four because the app's test pins the current
   behaviour.
3. **"`triangle` lacks `creator: true` while others have it" → inverted.** `rectangle`, `ellipse`,
   and `line` lack it. Any plan that adds `creator: true` to the triangle is fixing the wrong tool;
   check `toolProcessors.ts:220-224`, where all five figure rows _do_ have it now.
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

And one that is not a correction but a boundary: **`01-photoshop-reference.md:945` — "No browser
was executed."** Every support claim in that corpus derives from caniuse / MDN BCD / the WebKit
bug tracker, not from runtime measurement. The `ctx.filter` conclusion (trap 15) is in exactly
that category, which is why the one-line probe at `:951-955` is the thing to run before you
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
  against Adobe's current toolbar, and `AGENTS.md:64-108` forbids a headed one. The app-side
  column of every gap row is verified; the Photoshop column is not.
- **`08-merge-plan.md` and `02-implementation-plan.md` were read for headings and scope only**
  (11 files, ~265 KB). Their `file:line` anchors are against an older revision and I did not
  re-verify any of them.
- **Open citations I dropped rather than guess:** the `#d9c09a` sepia matrix in
  `src/tools/functions.ts`; `PolygonClickToolArea.tsx:733-738`; `useHistory.test.tsx:87-96`;
  `useCurrentTool.tsx:26-31`; `toolIcons.test.tsx:21-60`; `HANDOFF.md:783`; `draw.ts`'s file
  length and its `:102` re-stroke. Each is marked in the correction table. A dropped citation is
  a claim the next session must re-derive, which is cheaper than a wrong one.

## Appendix C — provenance

This skill was assembled from seven independently written sections, each built from the unmerged `docs/ps-tool-playbook` (tip `025470e`) and re-verified against `main` at `1c9c8de`. The playbook's `file:line` citations were written at `50bb2b8` and were stale in dozens of places. Every correction is listed below, section by section, so the next reader can see which claims were re-derived and which were inherited.

A citation that is still wrong here is a defect, not a gap: fix it in the same commit that touched the code, and never reword a correction into a success story.

### 01-worktree-gates-integration.md — Phase 10 — integration

### Corrections to the playbook

Source: `docs/ps-tool-playbook.md` at `docs/ps-tool-playbook`, authored against `50bb2b8`; tree is now `1c9c8de`. Citations that survived unchanged are omitted.

**§0 — the one-page shape**

- `7. gates  lint:check → tsc → test → test:e2e:unit → build → test:e2e` — not the order any gate runs. `gate:verify` is `tsc` → `build` → `test:e2e:unit` (`package.json:30`); `lint:check` and `test` are pre-push/CI only (`package.json:32`); `test:e2e` is its own CI job (`ci.yml:205`), not a step in that chain.
- `ps/<tool>-<slug>` as the observed taxonomy — `.kilo/agent-manager.json:2` registers 38 worktrees and only 3 use `ps/`. Convention, not policy.

**§1 — Phase 0**

- `AGENTS.md:111-127` → `AGENTS.md:110-127` (heading moved to 110).
- `.kilo/agent-manager.json:6,15,…,362` and "All 30 registered worktrees" → the anchors still resolve (`:6`, `:15`, …) but the file is 636 lines with **38** `parentBranch` entries, all `"main"`. Schema is a top-level `worktrees` map at `:2`; no `sections` key.
- "A branch containing `/` flattens to `-` plus a 16-hex disambiguator" — true for 3 of 13 registered slash-branch worktrees, not all (`wip/photoshop-fidelity` → `photoshop-fidelity`).
- `git worktree add .kilo/worktrees/<dir> -b <branch> main` → `git worktree add -b <branch> .kilo/worktrees/<name> main` (option-first form).
- "`node_modules`: 26 of 105 worktrees have none" → 2026-09-28: **22 missing, 64 empty, 20 populated, of 106** under `.kilo/worktrees/`. "Empty" is the more misleading state, because that is where the walk-up silently takes over.
- `e2e/global-setup.ts:44` → `:44-45` guard, `:53-55` and `:59-61` the two rejection checks, `:67` the throw.
- "main carries another session's uncommitted 179-line deletion in `e2e/OPEN_PROBLEMS.md`" → committed as `bf8101e`; main is clean except an untracked `.output.txt`.
- Verified unchanged: `playwright.config.ts:21-22`, `:118-119` (the `PLAYWRIGHT_PORT`-is-stronger reading is correct); `AGENTS.md:99-100`, `:115-120`, `:121-124`, `:125-127`, `:62-86`.

**§9 — Phase 8**

- `npm run test:e2e  # playwright, headless, informational` → a **gate** (`ci.yml:205-208`, `AGENTS.md:190-194`).
- `e2e` (informational, `continue-on-error`) → promoted to a gate; the comment that justified the old setting is `ci.yml:208-232`, and `AGENTS.md:190-194` explains what the promotion does and does not rest on.
- CI described as three jobs → **four**: `ci` (`ci.yml:24`), `dependency-review` (`ci.yml:127`, PR-only), `e2e-unit` (`ci.yml:157`), `e2e` (`ci.yml:205`).
- `.github/workflows/ci.yml:48-79` for the "tracked file in a project" step → that step is `ci.yml:59-90` (`:70-89` shell body, `:84` the `comm` that yields the uncovered list).
- `AGENTS.md:101-104` for the typecheck — verified unchanged, but `tsconfig.json:1-14` says a bare `npx tsc` resolves **zero** files, where `AGENTS.md:102-103` says it "resolves the app tsconfig alone". Same conclusion; `tsconfig.e2e.json:44` is what makes it safe.
- `08-merge-plan.md:75-86` extras — range still correct, but `npx tsc -b --force` is obsolete (`tsconfig.app.json:3-8`, `tsconfig.node.json:3-5`: `tsc -b` re-checks every run), and `npx eslint . && npx prettier --check .` → `npm run lint:check` (`package.json:12`).
- Missing entirely: `gate:commit` / `gate:verify` / `gate:push` (`package.json:30-32`), `.husky/pre-commit`, `.husky/pre-push`, and the fact that **no `npm run audit` script exists** — CI runs `npm audit --audit-level=high` directly (`ci.yml:52`). All added after the playbook was written, in `1c9c8de`.

**§11 — Phase 10**

- "Current integration lines: `rev2/integration`, `history/integration`, `cleanup/final`" → `cleanup/final` does not exist; the branch is **`cleanup/integration`**.
- "The model is `f534335`" → still the model, but it is no longer `main`'s tip (`1c9c8de`).
- "git worktree list returns 105 worktrees today" → **107** from `git worktree list`, **106** from `.git/worktrees/*/HEAD`, **106** directories under `.kilo/worktrees/`.
- Verified unchanged: `08-merge-plan.md:9-16`, `:51-73`, `:75-86`, `:79-80`, `:81-82`; `HANDOFF.md:530-551`, `:579`, `:604-608` (the three removal tests are `:538-548`).

### 02-research.md — Phase 1 — research

### Corrections to the playbook

Every citation in this section was re-verified against worktree
`.kilo/worktrees/skill-ps-tool` at commit `1c9c8de`. The playbook was authored at `50bb2b8`
and several of its citations are stale. Corrections, old → new:

| Source                                                             | Old                                                                                     | New                                                                                                                                                                                     | Note                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `docs/tool-creation-playbook.md` §2, citing `00-tool-inventory.md` | `toolProcessors.ts:214,215,218` — `rectangle`, `ellipse`, `line` omit `creator: true`   | **Fixed.** All five figure tools carry `creator: true` at `src/tools/toolProcessors.ts:220-224`                                                                                         | Defect resolved and pinned by `src/tools/__tests__/tool-processors.test.ts:146-157`                                  |
| `07-test-harness-and-migration.md:10,46,47`                        | `src/test/setup.ts:207-210` — `set filter(_v: string) {}` silently discards every write | `src/test/setup.ts:178` — `filter: ''` is now a real data property, with the rationale at `:175-177`                                                                                    | Harness repaired; the "land it first" item in `00-tool-inventory.md:34` is done                                      |
| `07-test-harness-and-migration.md:34-38`                           | `getImageData` / `putImageData` / `createImageData` entirely absent                     | Opt-in via `createPixelCanvasContext` at `src/test/setup.ts:191-209`; deliberately **not** on the global context                                                                        | Pixel-level assertions are now writable                                                                              |
| `07-test-harness-and-migration.md:39-40`                           | `Path2D` partial — `moveTo` / `lineTo` / `closePath` only, no `bezierCurveTo`           | `src/test/setup.ts:35-50`, with `bezierCurveTo` at `:41`                                                                                                                                | The Phase 9 blocker is gone                                                                                          |
| `07-test-harness-and-migration.md:62`                              | `vitest.config.ts:11` (`setupFiles`)                                                    | `vitest.config.ts:17`                                                                                                                                                                   |                                                                                                                      |
| `01-photoshop-reference.md` §10                                    | `src/tools/toolProcessors.ts:214-218` for the inverted-`creator` correction             | `src/tools/toolProcessors.ts:220-224`                                                                                                                                                   | Superseded by the fix                                                                                                |
| `00-tool-inventory.md:39-42`                                       | `materialization.ts:161` throws for the three figure tools                              | `src/contexts/materialization.ts:168` — `if (!processor?.creator) throw`                                                                                                                | The throw moved; the defect it expressed is fixed                                                                    |
| `00-tool-inventory.md:39-42`                                       | `history-adapter.ts:180` classifies the six figure tools `kind: 'vector'`               | `src/contexts/history-adapter.ts:169`                                                                                                                                                   |                                                                                                                      |
| `01-photoshop-reference.md` §10 / `00-tool-inventory.md`           | `toolbar-mapping.ts:88-95` for the six pen-family names in `availableTools`             | `toolbar-mapping.ts:86` starts `availableTools`; the pen names run from `:90`                                                                                                           |                                                                                                                      |
| `12-paint-tools digest` ALREADY-VERIFIED facts                     | `src/tools/toolProcessors.ts:162-187` for the brush/pencil/color-replacement block      | `src/tools/toolProcessors.ts:165` (`brush`), `:173` (`pencil`), `:186` (`color-replacement`)                                                                                            | Range is right; the per-tool entry lines are what to cite                                                            |
| `12-paint-tools digest` / `03-ui-chrome-spec.md`                   | `src/tools/toolsMap.ts:72-86` for the placeholder entries                               | Exact — `src/tools/toolsMap.ts:72-76` (`brush`), `:77-81` (`pencil`), `:82-86` (`color-replacement`)                                                                                    | Confirmed unchanged                                                                                                  |
| `07-test-harness-and-migration.md:73`                              | `ShapeToolArea.test.tsx:648-679` "asserts the opposite" (a pin of the bug)              | `src/components/Main/__tests__/ShapeToolArea.test.tsx:648` is now _"computes the committed bounds from the same geometry the preview draws"_ and asserts a square — the fixed behaviour | That half of the pin is gone; the pin at `:715` (`expect(fullArgs.pos.width).not.toBe(fullArgs.pos.height)`) remains |
| `07-test-harness-and-migration.md:7-9` rewrite order               | list `src/test/setup.ts` as rewrite step 1                                              | Already done, as above                                                                                                                                                                  | Rewrite order steps 2-9 are unaffected                                                                               |
| `docs/tool-creation-playbook.md` §10.1                             | `HANDOFF.md` "1509 lines, 43 `##` headings"                                             | **Dropped** — not re-verified in this section's scope; the file is a live target and the count was true only at `50bb2b8`                                                               | Verify before citing                                                                                                 |

Verified unchanged and safe to cite as-is: `.gitignore:34` (`.kilo`); `toolbar-mapping.ts:86`
(`availableTools`); `src/tools/toolProcessors.ts:75` (`unimplemented` returns `[null]`);
`src/components/ToolbarHorizontal/ToolbarHorizontal.tsx:5,13,24-26` (the registry-lookup
dispatch — `toolsMap[toolName]?.toolboxComponent`, not a switch);
`src/components/ToolbarsRight/types.ts:3-5` (`ToolbarRightComponent`, `ResizeCb`);
`src/components/ToolbarsRight/toolbarPlaceholderConfig.ts` (20 lines);
`src/contexts/asset-registry.ts:6` (`AssetOwnership`); `e2e/README.md:29` (headless
default); `e2e/OPEN_PROBLEMS.md:36,308,318` (its three section headings);
`src/components/Main/DrawToolArea.tsx` (101 lines);
`src/components/ToolbarsRight/Draw/Draw.tsx` (227 lines).

**What could not be verified, and was therefore dropped rather than cited:** the
`HANDOFF.md` line and heading counts, the `docs/handoffs/` per-task record's line-level
citations, and the exact `file:line` anchors inside the ps-research corpus itself. Those
documents are gitignored, local to the main checkout, and were written against a tree that
has since moved; their own method notes warn that their citations are
re-verification-dependent. Cite them by absolute path, and re-verify before relying on any
`file:line` inside them.

### 03-look-like-photoshop.md — Phase 2 — make the tool look like Photoshop

### Corrections to the playbook

The playbook was authored at `50bb2b8`. Every citation in this section was re-verified
against the working tree at `1c9c8de`. Changed or dropped citations, old form first:

| Old                                                               | New                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ToolbarHorizontal.tsx:5,13,24-26`                                | `:5,13,15,25` — the `?.` is on `:13`, the `!ToolComponent` guard on `:15-21`, the `key` on `:25`                                 |
| `ToolbarHorizontal.test.tsx:62-81` for both fallbacks             | `:62-68` unregistered-tool strip, `:83-89` empty bar when `hasImage` is false                                                    |
| `Draw.tsx:135-151` for the slider pattern                         | `Draw.tsx:134-152` (the `flex flex-col` wrapper opens on `:134`)                                                                 |
| `buttonStyles.ts:10,25`                                           | `buttonStyles.ts:10-11,25-26` (`PRIMARY_BUTTON` spans two lines)                                                                 |
| `Shape.tsx:204-213` for the checkbox                              | `Shape.tsx:204-210` (the input); `:211-214` is its label                                                                         |
| `MagicWand.tsx:104` for the hint box                              | `:104` the box, `:107-109` the live readout                                                                                      |
| `Transform.test.tsx:121-126` for the rotate `title`               | `Transform.test.tsx:116-126` (the `describe` opens on `:116`)                                                                    |
| `Draw.test.tsx:548` for the unlabelled preview canvas             | `Draw.test.tsx:548-549` (both `not.toHaveAttribute` assertions)                                                                  |
| `IconShell.tsx:11` and a 32×32 shell                              | `IconShell.tsx:11-23` for the shell, `:17` for `viewBox`, `:4` for `STROKE`                                                      |
| `SidebarLeft/types.ts:3-37`, `toolIcons.tsx:25-60`                | unchanged; the hand-copied **test** union is `toolIcons.test.tsx:25-60`, which the old section did not distinguish               |
| `index.scss:57-58`                                                | `index.scss:57-59` (the `cursor-grabbing *` block runs three lines)                                                              |
| `useCurrentTool.tsx:71` write, `:33-35` read                      | unchanged, but the old section never named `:51`, the switch-away that is what actually loses the values                         |
| `Transform.tsx:191`, `Transform.tsx:281-299`, `FontSelect.tsx:26` | not re-verified; **dropped** rather than restated as a stale line — `buttonStyles.ts:41-44` is the durable reference for toggles |

Re-verified unchanged: `Draw.tsx:140,202,216-222` · `MagicWand.tsx:10,16-17,53` ·
`Crop.test.tsx:268` · `toolbar-mapping.ts:37-84,84,28` ·
`SidebarLeft.tsx:153,165,276,299,303,353,358,131` · `Main.scss:12-38` ·
`constants.ts:5-15` · `src/tools/settings.ts:35-180,199` ·
`src/util/settings.ts:20-83,77-83` · every tool-settings test contract the old
section listed. Added, each load-bearing here:
`src/util/__tests__/settings.test.ts:42-46,301-354` (the harness that asserts **values**
across a switch — the defect above is invisible without it) · `toolsMap.ts:72-86`
(brush, pencil and color-replacement are still `placeholderTool(...)` at `1c9c8de`;
`toolbarPlaceholderConfig.ts:2-4` is the card they render) · `src/util/draw.ts:96-104`
and `src/contexts/layer-utils.ts:173`, the evidence for the `needs-engine` verdicts.

### 04-strip-undoable.md — Phase 3 — strip the undoable requirement

### Corrections to the playbook

The source playbook is the unmerged `docs/ps-tool-playbook:docs/tool-creation-playbook.md`
(1368 lines; its own header says "verified against `main` at `f534335`", which does not
match the `50bb2b8` it was authored at). Its §4 is `## 4. Phase 3` with `### 4.1`–`### 4.5`.
Every §4 `file:line` was re-verified at `1c9c8de`. Most are correct; these changed or were
wrong.

| #   | Playbook claim                                                                                                                                                            | Status at `1c9c8de`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §4.3: "Map the tool onto `apply-raster-processor`, `reposition-layer`, `apply-affine-transform`, or `create-layer`" — `apply-affine-transform` reads as freely choosable. | **WRONG.** It is reachable only behind `if (args.toolName === 'transform')` at `src/contexts/history-adapter.ts:357`, which returns or throws from inside its own block, so a tool declaring `commit: 'affine-operation'` falls past every `processor.commit === …` test and hits the throw at `src/contexts/history-adapter.ts:426`. **The op is generic; the commit kind is not.** Tier 2, not tier 1.                                                                                                                                                             |
| 2   | §4.3: `create-layer` listed as freely choosable.                                                                                                                          | **WRONG without the creator qualifier.** `operationForTool` has no `commit === 'source'` arm, so a `source` tool dispatched as a `TOOL_ACTION` against an existing layer throws at `src/contexts/history-adapter.ts:426` while legacy replay rasterizes it via its default arm (`src/contexts/history-replay.ts:193`). `create-layer` is reachable only from the `NEW_LAYER_ACTION \|\| (TOOL_ACTION && source)` arm at `src/contexts/history-adapter.ts:500-504`.                                                                                                   |
| 3   | §4.2: tier L is "the append boundary declines to plan", a `warning` diagnostic and a performance cliff.                                                                   | **INCOMPLETE — it conflates two postures.** The append boundary is per-entry and warns (`src/contexts/history-append.ts:78-92`, severity at `:86`, terminal arm `:153-158`; short-circuit at `:358-366`; fallback to `buildDurableDocument` at `src/contexts/StoreContext.tsx:744-758`). The **shadow conversion** is fail-closed for the **whole document** (`src/contexts/history-adapter.ts:621-623` catches into an `error` diagnostic; `:657-665` rolls back and returns `document: null`). An untranslatable tool costs the entire shadow, not just its entry. |
| 4   | §4 header: "a shadow projection with no production caller (`AGENTS.md:235-236` …)"                                                                                        | **Citation moved.** `AGENTS.md` is 287 lines; Architecture status is at **`AGENTS.md:278-287`**. Lines 235-236 are inside "Handoff documents". Substance unchanged.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | §4 header: "`HANDOFF.md:55-95`" for that item.                                                                                                                            | **Citation moved.** That heading is now at **`HANDOFF.md:55`**; item 2 starts at `HANDOFF.md:98`. Cite `HANDOFF.md:55-96`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | §4.4: "`unimplemented()` returns `[null as never]` … gives the layer `tmpCanvas = null` with no throw (`layer-utils.ts:206-213`)"                                         | **Range off, trigger missing.** The `kind === 'tool'` branch is **`src/contexts/layer-utils.ts:204-213`**. The trigger matters more: it only happens if you mark an `unimplemented` processor `creator: true` **and** dispatch it as a tool-layer source — the current entries are not (`creator` unset on all of `src/tools/toolProcessors.ts:194-229`).                                                                                                                                                                                                            |
| 7   | §4.5: two tests pin the `replay` contract at `src/tools/__tests__/tool-processors.test.ts:702-718`                                                                        | **Correct as written.** `:702-712` is the `replay.kind`-tracks-`commit` test, `:714-718` the `requiresRaster` derivation. Also verified: `:720-729` asserts the descriptor is frozen, has exactly the four keys, and is reused **by reference** by `toolsMap`.                                                                                                                                                                                                                                                                                                       |
| 8   | §4.2 tier-N row 4: `durable-replay.ts:68-143` is "no — a missing case is a silent no-op"                                                                                  | **Correct, and the reason is worth keeping.** That switch has no `default`, and `tsconfig.app.json:30-36` sets `noFallthroughCasesInSwitch` but **not** `noImplicitReturns`. The same defect in `cloneOperation` (`src/contexts/history-model.ts:247-303`, also no `default`) **is** a compile error, because there the union member type is the parameter type. One defect, two enforcement outcomes, depending on the function.                                                                                                                                    |
| 9   | §4.2: `history-adapter.ts:416-424` for the `raster` arm                                                                                                                   | **Correct, exactly.** The addition it omits is the load-bearing part: the materializer resolves `processorId` by **lookup**, `toolProcessors[operation.processorId as keyof typeof toolProcessors]` at `src/contexts/materialization.ts:277` — which is what makes `raster` name-agnostic end to end, not just in conversion.                                                                                                                                                                                                                                        |
| 10  | §4.5: "`materialization.ts:279-281` rejects an unknown `processorId`/`version` pair"                                                                                      | **Correct** (`src/contexts/materialization.ts:278-281`). Add the sibling it misses: `filterForOperation` (`src/contexts/materialization.ts:73-89`) is a `switch` over three names with **no `default` arm** — the name-closure that makes `layer-operation` tier 2.                                                                                                                                                                                                                                                                                                  |
| 11  | §4.1: `useHistory.ts:98-108` for `applyRasterTool`; `history-adapter.ts:100-125` for `plainObject`                                                                        | **Both correct, exactly** at `1c9c8de`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 12  | §4.4: "`commit: 'document-operation'` is a no-op in legacy replay too — `history-replay.ts:192`"                                                                          | **Correct, exactly** — that line is `if (processor.commit === 'document-operation') continue;`. Add the durable half it omits: `src/contexts/history-adapter.ts:425` returns `null` for both `document-operation` and `selection`.                                                                                                                                                                                                                                                                                                                                   |
| 13  | §4.2's three-tier table (`raster`, "any, no durable arm", "new `DurableOperation` variant")                                                                               | **Incomplete, and the gap is the most expensive one here.** The playbook never says `operationForTool` **throws** for an unhandled commit kind (`src/contexts/history-adapter.ts:426`) and that `convertLegacyHistorySafely` is therefore fail-closed for the whole document (`:657-665`). "Declines to plan" is per-append and warning-severity; the conversion is whole-document and error-severity. See correction 3.                                                                                                                                             |

### 05-implementation-unit-tests.md — Phase 5 — unit tests

### Corrections to the playbook

The playbook was authored at `50bb2b8`; every working-tree citation above was re-verified at `1c9c8de`. Unverifiable claims are dropped
rather than carried forward.

| Playbook citation                                                                                         | Corrected to                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-processors.test.ts:702-718` (both derived-flag tests)                                               | `:702-712` for `replay.kind`, `:714-718` for `requiresRaster`                                                                                                                                                                                                     |
| `tool-processors.test.ts:161-193`, `:363-375`, `:406-438`, `:438-459`, `:548-578`, `:742-772`, `:686-739` | `:159-193`; `:363-384`; `:406-426`/`:428-436`/`:438`; `:449-459`; `:548-587` + coverage `:589`; `:742-772` + coverage `:782`; unchanged                                                                                                                           |
| `SidebarLeft/types.ts:3-37`, `toolIcons.tsx:25-60`, `toolbar-mapping.test.ts:14,146-159`                  | all unchanged — but `toolIcons.test.tsx` is `:21-55`, the `toolIcons[tool.name]` use site at `SidebarLeft.tsx:131` is unchecked, and `toolbar-mapping.test.ts` does **not** assert `availableTools` is exhaustive (only two tools are spot-checked, `:85-92`)     |
| `Main.tsx:50-76`; `Main.tsx:158`                                                                          | `:50-76` unchanged; routing `:149-158`; `ToolAreaComponent` `:135-145`; overlay `display` `:184-197`; `DummyToolArea` default `:147`, its `else` `:158`                                                                                                           |
| `useLayer.ts` entry-point table (`:219`, `:264`, `:323`, `:473`, `:651-671`)                              | all four keep their lines; the returned surface is `:656-658`, not `:651-671`                                                                                                                                                                                     |
| `useHistory.ts:98-108`; `draw.ts:96-104`; `paint-tools.test.ts:97-104`, `:237-248`, `:227,229`            | `useHistory.ts:98-109`; the three calls are `draw.ts:100-103`, padding `:20-25`; `:99-104`; `:241-243`; `:227-229` unchanged                                                                                                                                      |
| `src/util/draw.ts:96-97` identity branch, cited by the reference test                                     | Does not exist at `1c9c8de`; it is a `brush-toolbar` change. Cite `brush-toolbar:src/util/draw.ts:88-99` for the reference, `src/util/draw.ts:84-94` for the current `drawLine`                                                                                   |
| `src/test/setup.ts:42-48` / `:117-180` / `:182-190` / `:191-209` / `:211-215`                             | `:117-180` context factory; `:182-209` opt-in pixel context; `:211-215` `installCanvasContextStub`; `:219-221` per-test reinstall (there is no `:42-48`)                                                                                                          |
| `src/util/__tests__/settings.test.ts` (template source)                                                   | `:42-46` is `switchToTool`; the tool-switch describe is `:301-354`. The value-level coverage is on the reference branch, not here                                                                                                                                 |
| `tool-settings.test.ts:57`, `:320-328`, `:330-340`, `:342-351`, `:362-368`                                | all still correct; the key-survives test is `:255-268`                                                                                                                                                                                                            |
| §5.2 "13 files" ordering; step 8 "the icon, three files"                                                  | Reordered: type spine 1–6, presentation registries 7–9, new files 10–13. `Main.tsx` is **four** edits, not one. `ToolIconName` is hand-written and **not** derived from `ToolName`, so the typecheck will not catch a name you forget there                       |
| §4.2/§4.5 recommending flipping `requiresRaster`; §5.4 `flattenRequired` "test-only"                      | **Forbidden** — `tool-processors.test.ts:714-718` derives it, so changing it means rewriting the test. Confirmed: `flattenRequired` is declared `toolProcessors.ts:50`, runs `useLayer.ts:271-301`, and no shipped processor sets it                              |
| §5.3 "a test that pins a defect must be inverted"                                                         | Kept; the case-(c) rule added — a test whose only half loses its last example needs the assertion **relocated**, not weakened                                                                                                                                     |
| §6.1 template B (`useHistory.test.tsx` via `renderHook` + `StoreProvider`)                                | Corrected: the provider is forbidden. The context-seam template drives the real pure function (`createLayerSource`, `layer-utils.ts:152-217`) and, when a store is unavoidable, mocks `useStore` directly with `vi.hoisted` + `vi.mock('../StoreContext.tsx', …)` |
| §5.3 "seven per-tool test tables"                                                                         | Now ten hard-coded rosters in `tool-processors.test.ts` alone, plus the `Main.toolAreas` routing table, the `ToolbarPlaceholder` mirror, the `SidebarLeft` harness icon mock, the hand-copied `ToolIconName`, and `tool-settings.test.ts:255-268`                 |
| §6.4 mutation check ("record the failure count")                                                          | Kept and made mandatory, with a command sequence, a `git status --short` byte-exact restore proof and a report format. Recorded: 7 red for the persistence arm, 5 red for the smoothing call, on the unmerged reference build                                     |
| §7.5 baseline directory                                                                                   | `e2e/export/visual-regression.spec.ts-snapshots/export-baselines/`; `BASELINE_DIR` at `e2e/export/visual-regression.spec.ts:18`; re-record gate `:73`                                                                                                             |

### 06-e2e-delegation-handoff.md — Phase 9 — the handoff doc

### Corrections to the playbook

Each row is a citation in the unmerged `docs/ps-tool-playbook` that is **wrong against the working
tree at `1c9c8de`**, or correct-but-incomplete. The playbook was authored at `50bb2b8` and is not
merged, so these are corrections to a draft, not to shipped documentation.

| Playbook citation (stale)                                                                      | Verified at `1c9c8de`                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §7 opening: "`e2e/**` is excluded from `npm run test`", cited to `AGENTS.md:156`               | `AGENTS.md:140-142` carries the exclusion; `:156` is lint-staged prose inside the local-gate section                                                                                                                                                                                                           |
| §7.3 presents the helper inventory as complete                                                 | It omits `e2e/helpers/screenshot-scale.ts` entirely, which owns `imagePointToCss` (`:36`), `cssPointToImage` (`:49`) and `imageBoundsToCss` (`:56`) — the single implementation the §7.4 pixel rules depend on                                                                                                 |
| §7.3 omits `canvasRedrawClip` and the `canvas-redraw.ts` re-export                             | `e2e/helpers/canvas-redraw.ts:10-15` re-exports `canvasRedrawClip`, `waitForCanvasPixels`, `CanvasPixelPredicate` and `WaitForCanvasPixelsOptions` from `./canvas-helpers`; `canvasRedrawClip` is `canvas-helpers.ts:339` and `loadImageData` is `:165` — the shipped spec imports all three                   |
| §7.3 "Never divide by `devicePixelRatio` (`:39-51`)"                                           | `e2e/helpers/cdp-helpers.ts:39-51` is a **comment block**, not a guard. There is no runtime check, so a future change can delete the reasoning without deleting anything that fails. Say so in the skill                                                                                                       |
| §7.4 "The flyout keyboard race (`:257-306`)" listed among the open latents                     | `e2e/OPEN_PROBLEMS.md:257-306` is correct, but the entry is filed under `## Fixed — Enter did not reliably close the flyout` (`:257`), not among the open defects                                                                                                                                              |
| §7.4 "reject a null bounds result first — every spec does" cites `:174-181`                    | Correct. The other four latents (`:110-130`, `:153-172`, `:132-151`, `:183-195`) and the unsanitised-name entry (`:216-237`) all still resolve to those exact ranges                                                                                                                                           |
| §7.1 "For a tool with options, `e2e/pen-types.spec.ts:85-110`"; §7.2 "`e2e/levels.spec.ts:88`" | Both correct. §7.1 omits `e2e/levels.spec.ts:55-57` — the comment that states _why_ the label part alone is matched — and `e2e/sidebar-flyout.spec.ts` as the naming model                                                                                                                                     |
| §7.5 "Re-record is gated on `updateSnapshots === 'all'` … (`visual-regression.spec.ts:67-78`)" | Correct. §7.5 never states the budget: the call site passes `threshold: 0.01` / `maxDiffPixels: 100` at `visual-regression.spec.ts:86-89`, against defaults `0.2 / 100 / 0.01` at `e2e/helpers/image-comparison.ts:27-29`. It also omits the orphan-baseline entry (`:197-215`) and the `draw`-tool provenance |
| §1 "`AGENTS.md:121-124`" for the weaker `PLAYWRIGHT_REUSE_EXISTING_SERVER` variable            | `AGENTS.md:110-127` never mentions `PLAYWRIGHT_PORT`, which `playwright.config.ts:21-22` and `:118-119` make the correct isolation primitive. The playbook's "`AGENTS.md` should say so" is still an open gap, not a stale citation                                                                            |
| §8.1 "the e2e flyout testids" (`toolbar-helpers.ts:207-210`)                                   | `e2e/helpers/toolbar-helpers.ts:207-209` is `verifyPrimaryTool`, asserting the tile's own `toContainText`. The `group[0]`-is-the-primary-tile rule it attributes here lives in app source (`SidebarLeft.tsx`), a different section's scope                                                                     |
| §10.2 "`See`:216-237` for the model entry"                                                     | `e2e/OPEN_PROBLEMS.md:216-237` is the unsanitised-artifact-name entry, not a model entry. The shape is stated at `e2e/OPEN_PROBLEMS.md:3-7` and demonstrated in full by `:110-130`                                                                                                                             |
| §10 opening treats `.kilo/plans/` as a handoff home alongside `HANDOFF.md`                     | `.gitignore:34` is `.kilo` and matches `.kilo/plans`, so a plan there does not ship. `AGENTS.md:256-260` requires handoff docs to ship with the code                                                                                                                                                           |
| §9 "`e2e` (informational, `continue-on-error`)"                                                | `.github/workflows/ci.yml:205-232` promotes the job; the three `continue-on-error` strings left in that file are all inside historical comments, not keys. `e2e/README.md:397-407` is the stale one                                                                                                            |
| §9 gate list does not separate local hooks from CI jobs                                        | `AGENTS.md:144-204` is the current split: `gate:commit` (`lint-staged` → `gate:verify` → `test:staged`) and `gate:push`, versus four CI jobs                                                                                                                                                                   |

**Not verifiable against this working tree, and therefore not corrected above:**

- The **port-race** entry the playbook characterises as "Playwright's own `webServer` teardown
  raced its probe" does not exist in `e2e/OPEN_PROBLEMS.md` at `1c9c8de`, in any branch's copy of
  that file, or in any commit reachable in this clone. What is documented — and what the traps
  section above uses instead — is the **P1 port-isolation entry** on the unmerged `ps-integration`
  branch: a run attaching to a sibling worktree's server, fixed with three layers. If the teardown
  race is a real observation, it belongs in `e2e/OPEN_PROBLEMS.md` as its own entry before it
  belongs in a skill.
- The **zero-file idle worker** is a recorded outcome, not a citable file. The re-dispatch brief
  quoted above is the shape that fixed it, recovered from a comparable four-test re-dispatch in this
  repo's session history, not from the failed dispatch itself.
- `brush-toolbar:e2e/paint-options.spec.ts` and `brush-toolbar:HANDOFF.md` (items 36–41) are cited
  as **not-yet-merged references**; re-verify their line numbers against that branch before relying
  on them, and against `main` once they merge.

### 07-backlog-and-traps.md — Appendix B — the research corpus that already exists

### Corrections to the playbook

`docs/tool-creation-playbook.md` was written at `50bb2b8` and is unmerged (branch
`docs/ps-tool-playbook`, `025470e`, +1/-4). Every claim below was re-verified at `1c9c8de`.
Citations I could not re-verify are marked **[unverified]** and are not to be carried forward.

| #   | Playbook claim                                                                                                                                                                                                            | Truth at `1c9c8de`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §12: "**Nothing is in flight.** Every `ps/*` branch … is **0 commits ahead of `main`**, and `git diff --stat main...<branch>` is empty for all of them."                                                                  | **Wrong, and load-bearing.** `ps/brush-engine` +1/59, `ps/tool-expansion` +3/3, `wip/ps-integration` +3/138, `wip/ps-shape-geometry` +1/148, `wip/ps-ux-chrome` +1/148, `docs/ps-tool-playbook` +1/4 are all **not merged**. Only `ps/brush-stabilizer` and `ps/brush-tip-core` are. The "0 ahead is not a safety test" caveat in the same paragraph is right and load-bearing; the conclusion drawn from it is wrong                                                                                                                                                                                                                             |
| 2   | §12: "**29 registered tools.**"                                                                                                                                                                                           | **Correct.** 29 rows at `src/tools/toolsMap.ts:41-123`, 29 union members at `src/contexts/tool-types.ts:17-56`, 29 in `availableTools` at `toolbar-mapping.ts:86-116`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | §12: "**7 stubs** (the six pen-family tools plus `custom-shape`, all `commit: 'unimplemented'` returning `[null]`)"                                                                                                       | **Correct** as a count of `unimplemented` registrations (`toolProcessors.ts:194-219,225-229`, no-op at `:75`). But **10** registrations render a `PlaceholderTool` (`toolsMap.ts:75,80,85,87,91,97,102,107,112,121`); three of them (`brush`, `pencil`, `color-replacement`) are real `commit: 'raster'` tools that paint. The playbook conflates "placeholder" with "stub"                                                                                                                                                                                                                                                                       |
| 4   | §12: the pen family "**consume a history entry while doing nothing**", violating the constraint that unsupported operations must reject the durable branch                                                                | **Wrong about the mechanism, and the corrected mechanism is a different defect.** The 7 have no `interactionMode` arm (`Main.tsx:50-76`), so `EventHandler` is `DummyToolArea` (`Main.tsx:158`) and the overlay is `display: none` (`Main.tsx:194-196`). No tool area is mounted, so no pointer event, so no `TOOL_ACTION`, so **no history entry is created**. The defect is _selectable + options bar renders + canvas does nothing + no warning_. The durable-rejection concern is still real for a **hand-crafted or imported** legacy entry naming one of them: that hits `history-adapter.ts:426` and voids the whole shadow via `:657-665` |
| 5   | §12 trap 1: "No `interactionMode` arm in `Main.tsx:50-76`" (read as covering the paint tools)                                                                                                                             | **Wrong for `brush`/`pencil`/`color-replacement`.** `Main.tsx:55` routes all three to `interactionMode = 'draw'`, and they paint. Only the 7 `unimplemented` tools fall through to the `'zoom'` sentinel at `Main.tsx:50`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | §12: `layer-renderer.ts:72` is one of the five `ctx.filter` sites                                                                                                                                                         | **Path wrong.** It is `src/contexts/layer-renderer.ts:72`, not `src/util/`. The other four are correct: `src/tools/blur.ts:11`, `src/tools/colors.ts:12`, `src/tools/levels.ts:12`, `src/contexts/materialization.ts:247`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | §12: "`SelectionMode` does not exist anywhere in `src/`, so **Add/Subtract/Intersect are unrepresentable**"                                                                                                               | **First half wrong.** `src/tools/selection.ts:5` is `export type SelectionMode = 'fill'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 'outline'`. The consequence is unchanged: `'fill' \| 'outline'` has no combination members, so Add/Subtract/Intersect remain unrepresentable |
| 8   | §12: "`general-types.ts:61-70` — `Selection` is `points: Point[]` + `isActive` + `pos`"                                                                                                                                   | **Understated.** The type starts at `general-types.ts:61` and also carries `lifecycle?`, `geometry?`, `sourceTool?`, and `metadata?` (`:66-69`). Still one boundary loop, so the conclusion stands                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | §12: `src/util/selection.ts:515` binarizes; `drawPolygonPath` (`:392-400`) non-zero vs `isPointInPolygon` (`:186-203`) even-odd; `copySelectionToCanvas` (`:708-729`) feathers only `feather-magnetic-lasso` (`:720-726`) | **All four exact.** `:515`, `:392`, `:186`, `:708`, `:720` all resolve as claimed. Corroborated in-tree at `selection.ts:465` ("non-zero winding rule")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10  | §12: `toolbar-mapping.ts:37-84` "has six toolbar groups covering slots 1/2/3/4/5/8/13/15/16/18"                                                                                                                           | **Group count wrong; slot map right.** `toolbarMap` is 5 top-level sections rendering **12** tiles. The covered Photoshop slots (1,2,3,4,5,8,13,15,16,18) and the 10 empty ones are unchanged. Note `brush`/`pencil`/`color-replacement` at `:58-60` are the _slot-8 Brush group_, and `color`/`levels`/`transform` at `:51-53` occupy the slot-6 position that Photoshop gives Frame/Eyedropper                                                                                                                                                                                                                                                  |
| 11  | §12: "**`levels` is Brightness/Contrast; `color` is neither of its two candidate identities**" and "`settings.ts:37,:38` are unchanged"                                                                                   | **Correct**, with the path spelled out: `src/tools/settings.ts:37` is the `color` default (`{ grayscale: 0, sepia: 0, saturation: 0 }`) and `:38` is `levels` (`{ brightness: 0, contrast: 0 }`); the arg types are `src/tools/colors.ts:4` and `src/tools/levels.ts:4`. D1/D2 remain unimplemented                                                                                                                                                                                                                                                                                                                                               |
| 12  | §12: "`levels.ts:4` `{brightness, contrast}`; `colors.ts:4` `{grayscale, sepia, saturation}` with `sepia()` a fixed `#d9c09a` matrix"                                                                                     | **Correct** on both arg types. The `#d9c09a` value is in `src/tools/functions.ts` via `buildColorsFilter` — **[unverified]**, I did not open that file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 13  | §12: "`oval` still carries a dead `cornerRadius` (`settings.ts:30`); Polygon has no `sides` field (`settings.ts:32`); shape does not fill by default (`settings.ts:59-65` `backgroundColor: null`)"                       | **First two exact** (`src/tools/settings.ts:30,32`). The third is at **`src/tools/settings.ts:63`**, not `:59-65`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 14  | §12: "`text.ts:47` `split('\n')` then one `fillText` per line; `getTextWidth` (`:53-64`) returning only the widest line makes `rect` decoration; `settings.ts:69` `lineHeight: 1.1`"                                      | **All exact.** `src/tools/text.ts:47` and `:48-50`, `:53-64`, `src/tools/settings.ts:69`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 15  | §12: "Tolerance is 0–100 default 28 (`settings.ts:109`); Photoshop is 0–255 default 32 on RGB"                                                                                                                            | **Default 28 exact** (`src/tools/settings.ts:109`). The 0–100 app range and the 0–255/32 Photoshop figures are not in the tree — FROM-MEMORY on the Photoshop side and unstated in the app                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 16  | §12: "`src/tools/magicWand.ts:11-15` is `({bitmap}) => () => [bitmap]`, yet registered `commit: 'selection'`"                                                                                                             | **Correct, off by one line.** The processor body is `src/tools/magicWand.ts:10-14`; the registration is `toolProcessors.ts:152-157`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 17  | §12: "`toolProcessors.ts:165-193` … `draw.ts:46` allocates a full-size `OffscreenCanvas` per pointer move; `:102` re-strokes the whole accumulated path. … All three get a `PlaceholderTool` (`toolsMap.ts:75,80,85`)"    | **`:165-193` and the three `toolsMap` rows are correct. `draw.ts:46` is exact** (`new OffscreenCanvas(size.width, size.height)`). The "57 lines" file length and the **`:102` re-stroke claim are [unverified]** — drop them. Note the `draw` path is legacy: `ps/tool-expansion` rewrites `src/tools/draw.ts` (+27/-…) and adds `src/hooks/usePaintStroke.ts`                                                                                                                                                                                                                                                                                    |
| 18  | §12: "`color-replacement` … `util/draw.ts:106-125` `drawSpray`"                                                                                                                                                           | **The symbol is not exported.** `src/util/draw.ts:84-93` is `drawLine`, a three-branch `penType` dispatch; `:91` is `else if (penType === 'spray')`, and the spray body ends at `:126`. Cite the symbol or the branch, not `:106-125` as an export                                                                                                                                                                                                                                                                                                                                                                                                |
| 19  | §12: "**No blend-mode surface.** The app has `layer-types.ts:60` `blendMode: GlobalCompositeOperation` … and no blend-mode module"                                                                                        | **Correct** for the type (`src/contexts/layer-types.ts:60`). "No module" is true on `main` and **false against `ps/tool-expansion`**, which adds a 29-line blend-mode slice in `src/contexts/layer-utils.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 20  | §12: "The **Select menu does not exist** (`src/components/Menu/Menu.tsx` renders a header and the toolbar)"                                                                                                               | **Correct and stronger than stated**: `src/components/Menu/Menu.tsx` is **13 lines** rendering only `DesktopHeader` and `ToolbarHorizontal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 21  | §12: "Zoom and Hand are the most-missed: zoom exists only as a CSS `zoom-container` class (`Main.tsx:167`, transform commented out at `:170`), and `'zoom'` at `Main.tsx:50` is a dead sentinel meaning 'no tool area'"   | **All three exact**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 22  | §12: "**26 absent tools**"                                                                                                                                                                                                | **Undercount, and the framing is the problem.** The 26-list mixes absent _tools_ with absent _menu commands_ and absent _crops_. The decidable framing is slot coverage: **10 of 20 Photoshop toolbar slots are empty**, which the playbook also states. Use the slot framing; the 20-slot Photoshop column is FROM-MEMORY                                                                                                                                                                                                                                                                                                                        |
| 23  | §12: "**~18 partial, 0 at Photoshop parity**"                                                                                                                                                                             | **Not a checkable taxonomy** — "partial" and "parity" have no test. Replaced here by PRESENT/PARTIAL/ABSENT with a `file:line` for each                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 24  | §4.2 cost criterion: `raster` is fully generic, `processorId` is the tool's own name, **no allowlist**                                                                                                                    | **Correct, exactly, and it is the criterion this whole ranking rests on.** Re-derived independently: `history-adapter.ts:416-424`, `history-model.ts:100-106` (`processorId: string`), `materialization.ts:277-281` (resolved by lookup). §4.2 also **omits** that `operationForTool` _throws_ for an unhandled commit kind (`:426`) and that `convertLegacyHistorySafely` is therefore **fail-closed for the whole document** (`:657-665`) — "declines to plan" is per-append and warning-severity; the conversion is whole-document and error-severity                                                                                          |
| 25  | §4.2 / §4.4: "`commit: 'document-operation'` is a no-op in legacy replay too (`history-replay.ts:192`)"                                                                                                                   | **Correct, exactly** — that line is `if (processor.commit === 'document-operation') continue;`. The durable half returns `null` for `document-operation` alongside `selection` (`history-adapter.ts:425`)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 26  | Appendix A trap 10: "`applyRasterTool` (`useHistory.ts:101`) has no try/catch, while the live path does (`useLayer.ts:536-550`)"                                                                                          | **Still true, with paths corrected**: `useHistory.ts:98-108` (unguarded) and `useLayer.ts:543-550` (guarded). The 04 section of this skill also verifies this pair as exact                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 27  | Appendix A trap 28: "The live raster preview calls `imageProcessor` with **no try/catch** (`useLayer.ts:532-533`) on every pointer move"                                                                                  | **Now false — delete it.** The live path **is** guarded at `useLayer.ts:543-550`, with a comment naming `transform` and its throwing argument shapes as the reason. The _undo_ path is the unguarded one (correction 26)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 28  | Appendix A trap 26: "`isToolDirty` is permanently `false` — it has **no production writer**"                                                                                                                              | **Imprecise.** The reducer arm exists (`src/contexts/StoreContext.tsx:358-362`) and `SET_TOOL_NAME` clears it (`:357`). What is true: **no production dispatch sets it `true`**, which three options-bar components state in their own comments (`Color.tsx:94`, `Blur.tsx:66`, `Levels.tsx:69`)                                                                                                                                                                                                                                                                                                                                                  |
| 29  | Appendix A trap 27: "`flattenRequired` is set by no production processor (`HANDOFF.md:783`)"                                                                                                                              | **Correct**, and the tree now says so itself at `src/contexts/useLayer.ts:275`. The `HANDOFF.md:783` citation is **[unverified]** — cite the code comment, not the handoff line                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 30  | Appendix A trap 25: "`useRect`'s aspect ratio is reciprocally defined between the drag (`useRect.ts:206-221`, `w = h·ratio`) and the ratio effect (`:229-237`, `w = h/ratio`)"                                            | **Stale and wrong.** Both helpers are in `useRect.ts`: `adjustHeightRatio` at `:189` computes `wantedHeight = width / _aspectRatio` (`:193`), `adjustWidthRatio` at `:206` computes `wantedWidth = height / _aspectRatio` (`:210`). Both are live (`:263,267` and `:271,275`). The relation is _consistent_ — `w/h = 1/ratio` either way — so "ratio 2" yields `w = h/2`. That is an **inverted-ratio question to settle with the operator**, not a reciprocity defect. `useRect.ts:206-221` and `:229-237` are not the right ranges                                                                                                              |
| 31  | Appendix A trap 23: "**Seven** hard-coded per-tool tables in `tool-processors.test.ts` (`:161-193, :363-375, :406-438, :438-459, :548-578, :742-772, :686-739`)"                                                          | **Line ranges are stale.** Verified live sites, cited by symbol: `unimplementedTools` `:428`, `paintWrapperTools` `:438`, `argOverrides` `:540`, `placeholderTools` `:806`, plus the `requiresRaster` derivation `:714-718` and the expected lists `:77-79`, `:110`, `:728`. The count is right in substance; the ranges are not                                                                                                                                                                                                                                                                                                                  |
| 32  | Appendix A trap 12: "`ToolIconName` is hand-copied into the test (`toolIcons.test.tsx:21-60`)"                                                                                                                            | The file is at `src/components/SidebarLeft/__tests__/toolIcons.test.tsx`. The `:21-60` range is **[unverified]** — cite the file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 33  | Appendix A traps 6, 7, 13: flyout test ids at `SidebarLeft.tsx:276,353,358`; primary tile at `:153`; `toolbar-helpers.ts:207-210`                                                                                         | **All exact.** Testid minted at `SidebarLeft.tsx:276`; `${sectionIndex}-${groupIndex}` at `:353`; `two-column-${groupIndex}` at `:358`; `primaryTools[groupIndex] ?? group[0]` at `:153`; the helper's expectation derives from the same place at `e2e/helpers/toolbar-helpers.ts:205`                                                                                                                                                                                                                                                                                                                                                            |
| 34  | Appendix A trap 15: "A shortcut must be registered twice (plain + `shift: true`) because matching walks the registry backwards and breaks on the first hit (`useKeyboardEvents.tsx:100-126`)"                             | **Mechanism exact, necessity overstated.** `:100-101` is the backwards loop and `:126` is the `break`. But `matchesShortcut` tests `shift` only when the declaration sets it (`:70`), so doubling is required _when both registrations would match_, not unconditionally. Restate as a mechanism                                                                                                                                                                                                                                                                                                                                                  |
| 35  | Appendix A trap 3: "`toolsMap[toolName]?.toolboxComponent` (`ToolbarHorizontal.tsx:13`) — the `?.` turns a missing registration into a TODO strip (`:18`)"                                                                | `:13` is **exact**; the `:18` TODO-strip claim is **[unverified]** (the file yielded only `:13` and `:25` to a grep for `toolboxComponent` and `key=`). Cite `:13`. Trap 18 (`ToolbarHorizontal.tsx:25`, the `key={toolName}` remount) is **exact**                                                                                                                                                                                                                                                                                                                                                                                               |
| 36  | Appendix A trap 14: two independent `Escape` paths — the registry one at `PolygonClickToolArea.tsx:733-738` and a raw `window` listener at `SidebarLeft.tsx:98-109`                                                       | `SidebarLeft.tsx:98-109` is **exact**. The `PolygonClickToolArea` range is **[unverified]** at `1c9c8de` — find it before citing it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 37  | Appendix A trap 22: "`replay.requiresRaster` is derived, not declared (`tool-processors.test.ts:714-718`)"                                                                                                                | **Correct, exactly**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 38  | Appendix A trap 21 / 20: the global context has no `getImageData` (`src/test/setup.ts:182-190`); `getContext` stub is dropped by `vi.restoreAllMocks()` (`useHistory.test.tsx:87-96`)                                     | The setup claims are **exact** (doc comment `:182-190`, opt-in factory `:191-209`, stub `:211-215`, re-install `:217,:219-221`); the range moved to `:185-190`. The `useHistory.test.tsx:87-96` citation is **[unverified]** — the durable re-install is visible in `setup.ts` itself, so cite that instead                                                                                                                                                                                                                                                                                                                                       |
| 39  | Appendix A trap 19: "Tool settings are in-memory only … `normalizeToolArgs` validates nothing but `figure` (`useCurrentTool.tsx:26-31`)"                                                                                  | The persistence claim is **correct**. The `useCurrentTool.tsx:26-31` citation is **[unverified]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 40  | Appendix B: the corpus table, plus "Treat every claim in those files as unverified until re-checked"                                                                                                                      | **Correct and still the rule.** Two updates: `RESEARCH-BRIEF.md` is gitignored and exists only in the main checkout, and the table omits that **`01-photoshop-reference.md` §10 (`:888-955`) is the highest-value section in the corpus** — 17 disproved premises and 18 unresolved items. The playbook's own §12 relies on the un-disproven originals in places                                                                                                                                                                                                                                                                                  |
| 41  | §12: "The immediate fix is to hide or throw, before the path model exists — it is a one-line change that removes a lie from the UI"                                                                                       | **Keep the recommendation, fix the reason** (correction 4). The lie is a selectable tool that does nothing, not a manufactured no-op history entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 42  | §12: "Ranked by Photoshop impact × confidence the gap is real"                                                                                                                                                            | **Correct as an instinct, and this section replaces it with a computable rule** (see `### Ranked gaps`): frequency × fidelity loss, then a COST column derived from three named `file:line`s. The playbook also omits Tier 1 rows the `## 10`-style absence of which it never noticed, because its universe was the registry                                                                                                                                                                                                                                                                                                                      |
