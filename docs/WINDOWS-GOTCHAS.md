# Windows Gotchas

This page covers Windows checkouts and Windows/WSL crossings. For a native WSL
setup, follow [WSL-SETUP.md](WSL-SETUP.md), which keeps the checkout, Git, Node,
and node_modules in the Linux filesystem.

## Use one Git environment per checkout

A checkout under C:/... (or opened in WSL as /mnt/c/...) should use Git for
Windows for its Git and worktree operations, and Windows Node/npm for scripts
that inspect those worktrees or process IDs. A checkout under WSL's Linux
filesystem should use WSL Git and Node. Do not alternate Git or Node runtimes on
the same checkout: linked-worktree records contain paths in the format used by
the Git environment that created them.

This was verified on this repository. Git for Windows listed the registered
C:/Users/... worktrees normally. Linux Git, run from WSL against that same
Windows-backed checkout, rendered those paths under
.git/worktrees/<name>/C:/Users/... and marked them prunable, even though the
checkout directories and admin directories existed. That output was a path
interpretation mismatch, not proof that the worktrees were disposable.

Before considering repair or cleanup, inspect the list with the Git executable
that owns the checkout. Do not run git worktree repair, prune, remove, or edit a
.git/gitdir file to make the other environment's output look right. If the
matching Git environment still reports broken links, use
[Recovering Git metadata](ORCHESTRATION.md#recovering-git-metadata).

Separate Windows and WSL clones have separate refs and worktree registries.
Changes in one clone do not update the other clone's Git state. Keep their
dependency installs separate too; Windows node_modules and WSL node_modules
are not interchangeable.

## Windows command shims

On Windows, npm tools are commonly exposed as .cmd files. A Node child process
does not launch those shims the same way a shell does. This repository handles
that in [quiet-command.mjs](../scripts/quiet-command.mjs) and
[windows-command-shim.mjs](../scripts/lib/windows-command-shim.mjs). When adding
scripted command execution, use the existing helper and avoid passing arbitrary
arguments through shell interpolation; the helper rejects shell metacharacters
it cannot safely quote.

The TypeScript guard creates Windows .cmd and PowerShell launchers rather than
assuming POSIX symlink behavior. See
[install-tsc-guard.mjs](../scripts/install-tsc-guard.mjs).

## Process IDs and child cleanup

The E2E runner uses different process-tree cleanup on each platform: Windows
uses taskkill /T /F, while POSIX targets the spawned process group. Interpret a
recorded PID and its descendants in the runtime that created them; do not use a
PID or process-group value from the other runtime as proof that a process tree
is stopped. If the owner process is in a different environment, report
liveness as unknown and ask for confirmation; never kill an unverified process
tree.

See [mirror-e2e.mjs](../scripts/mirror-e2e.mjs). The process-liveness probe in
[e2e-run.mjs](../scripts/e2e-run.mjs) is for the runner's own recorded holders;
it is not evidence about an arbitrary process in another environment.

## Git variables inherited by child processes

Git sets variables such as `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE` for
hook processes. A child Git command that should discover a separate checkout
can accidentally reuse that hook's repository or index. Strip the inherited Git
context for nested repository commands, as [quiet-command.mjs](../scripts/quiet-command.mjs)
does. Keep it when a command is intentionally operating on the hook's private
index; stripping it indiscriminately changes what the hook validates.

## npm can relink the TypeScript guard

On Windows the TypeScript guard uses `.cmd`, `.ps1`, and an extensionless `tsc`
launcher in `node_modules/.bin`. npm reification can replace custom launchers;
`npm rebuild` is known to remove the guard, while `npm install` reruns `prepare`
and restores it. To restore it directly, run `node scripts/install-tsc-guard.mjs`.
See [install-tsc-guard.mjs](../scripts/install-tsc-guard.mjs) for the measured
behavior and limits.

## Path spelling

C:/Users/... and /mnt/c/Users/... may reach the same files while remaining
different Git path spellings. Use paths in the syntax expected by the selected
Git executable, and verify the checkout with pwd plus
git rev-parse --show-toplevel before editing or making Git changes. Never
repair .git, gitdir, or commondir by hand.
