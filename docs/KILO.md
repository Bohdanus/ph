# Kilo configuration

The agent-facing Kilo configuration this repository depends on, including its
tracked research profile and the settings that only exist in local Kilo config.

Read this before changing [`../kilo.jsonc`](../kilo.jsonc), before editing an agent
definition, and before concluding that a setting "is not configured".

## Why this document exists

Kilo configuration spans these project and user surfaces:

| Surface                                                                        | Tracked | Its home                                                                                     |
| ------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------- |
| [`../kilo.jsonc`](../kilo.jsonc) — project permissions, MCP servers            | yes     | itself; this document links to it and never restates it                                      |
| [`../.kilo/agent/read-only-research.md`](../.kilo/agent/read-only-research.md) | yes     | the project-owned read-only profile used for bounded free-model research                     |
| `.kilo/agents/*.md` — four local primary agent definitions                     | **no**  | this document records their recommended shape; [`../.gitignore`](../.gitignore) ignores them |
| `~/.config/kilo/kilo.jsonc` — model, tools, global permissions                 | **no**  | this document                                                                                |

`.kilo/` is gitignored by default because it holds one worktree per task under
`.kilo/worktrees/`. The tracked research profile is an explicit exception: `AGENTS.md`
and `MODELS.md` direct coordinators to use it for read-only research. The four
`.kilo/agents/` definitions remain local-only; a fresh clone has none of them, so
their recommended shape is recorded here.

## The one non-obvious thing about agent permissions

**`mcp` is not a permission key.** Writing `mcp: deny` compiles to a rule whose
permission is the string `"mcp"`, and evaluation then matches each _tool name_
against it — `"serena_find_symbol"` against the anchored pattern `^mcp$`, which is
false. The rule matches nothing and every MCP tool stays live, including the ones
that rewrite source.

The permission key is the **tool-name glob**. To deny a specific tool, name it:

```yaml
permission:
  serena_replace_symbol_body: deny
  serena_insert_after_symbol: deny
  serena_insert_before_symbol: deny
  serena_safe_delete_symbol: deny
  serena_rename_symbol: deny
  serena_replace_content: deny
  serena_replace_in_files: deny
```

Deny the mutating Serena tools and leave the read-only ones allowed. A code reviewer
that cannot follow a reference with `serena_find_referencing_symbols` is a reviewer
that guesses, and guessing is the failure mode a reviewer exists to prevent.

## The four local primary agent definitions

This section describes local profiles under `.kilo/agents/`; it does not describe the
tracked project profile at `.kilo/agent/read-only-research.md`. All four local profiles
are `mode: primary` and keep `read: allow` and `question: allow`.

| Agent                 | `edit`                                 | `bash`  | Notes                                                          |
| --------------------- | -------------------------------------- | ------- | -------------------------------------------------------------- |
| `architect`           | `*.md` plan paths only                 | `deny`  | Plans, never source. Also needs `plan_exit: allow`.            |
| `code-reviewer`       | `deny`                                 | `allow` | `docs/CODE-REVIEW.md` is the prompt; the file is only a loader |
| `frontend-specialist` | `*.ts` `*.tsx` `*.js` `*.jsx` + styles | `allow` |                                                                |
| `test-engineer`       | `*.test.*` `*.spec.*`                  | `allow` |                                                                |

Two of these are only as good as their honesty about limits:

- `bash: allow` makes `edit: deny` a **soft** boundary on `code-reviewer` and
  `test-engineer`. One shell call is a write. The Serena denials above close the
  tidy path, not that one, and the gap is deliberate: a reviewer that cannot run
  the tests cannot review them.
- `architect` has `bash: deny`, so it cannot verify anything by running it. That is
  the intended trade for a planning agent, and it is why its plan must name the
  command that would confirm each claim rather than asserting it.

`subagent_type: 'explore'` is a **built-in** role, not one of these four local
profiles. Its Bash interface is limited to an allowlist of read-only commands; that
limit is not a tool-level deny. Project rules in [`../AGENTS.md`](../AGENTS.md) and
[`../MODELS.md`](../MODELS.md) are stricter for free task children: deny `bash`,
editing, and file-mutating MCP tools, and never let free children perform Git
operations. Use only an explicitly permitted agent for required scripts or tests;
the coordinator owns all Git operations.

## Global configuration that must be true

These live in `~/.config/kilo/kilo.jsonc` and are not in this repository. Load-bearing:

| Key                      | Value                    | Why                                                                                                                                                            |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permission.bash`        | `"allow"`                | The project config **replaces** this scalar with an object of globs. The order there is the whole mechanism — catch-all first, exceptions after                |
| `lsp`                    | `true`                   | Optional. No language server is on `PATH` here, so no `lsp` tool appears. Serena already drives a tsserver, which is why this is left as-is rather than chased |
| `web_search`             | `true`                   | Used for the Adobe research in `docs/TOOLS.md`                                                                                                                 |
| `skills.paths`           | ast-grep skill directory | Registers the `ast-grep` and `ast-grep-outline` skills                                                                                                         |
| `experimental.code_mode` | `true`                   | Provides the `execute` tool                                                                                                                                    |

`mcp.serena` is configured globally rather than per project, because one Serena
install serves every checkout. `chrome-devtools-mcp` is deliberately **per project**
in `../kilo.jsonc` instead, so it cannot follow the operator to an unrelated repo.

### Do not add a browser MCP server

The project's two window guards are both specific to a shell command: `kilo.jsonc`
denies window-opening invocations with `permission.bash` globs, and
`e2e/global-setup.ts` refuses them from inside a Playwright process. An
`mcp_*_navigate_page` call is **neither**, so any browser MCP server bypasses both.

This is the whole reason looking at a live page here is `npm run probe:console` — a
script, so its invocation is a shell command the globs can see — and not a server.
The server in `../kilo.jsonc` is headless by flag, and that flag is the only thing
constraining it.

Note also that `chrome-devtools-mcp` must **not** run with `--slim`: that reduces it
to navigation, JavaScript execution and screenshots, which is exactly the set that
measures nothing, and the reason it is installed is to measure time and memory.

## Search tooling, and why the list is short

Four layers are installed and working, and a fifth is deliberately absent:

| Layer        | Tool                                             |
| ------------ | ------------------------------------------------ |
| lexical      | `grep` / `glob`                                  |
| structural   | `ast-grep` (binary plus two skills)              |
| symbol / LSP | Serena MCP                                       |
| semantic     | `semantic_search` (local embeddings, no network) |
| —            | no code-exfiltration index                       |

Adding an index that sends this repository off the machine, or a second index of the
same code, buys nothing this table does not already cover. The history of that survey,
including the tools that were evaluated and rejected, is in [`../HANDOFF.md`](../HANDOFF.md).

## Verifying

```bash
ast-grep run --pattern 'useEffect(() => { $$$BODY })' --lang=ts -l src   # structural
npm run probe:console -- --url http://localhost:5173/                    # console, headless
npm run tsc                                                              # covers e2e/ too
```

`chrome-devtools-mcp` is fetched on first use by `npx -y`, so a machine without
network access to npm will not start it. Everything above works offline.
