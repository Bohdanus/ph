# Dependencies

The licence policy for this project's dependency tree, and the fact that
**nothing enforces it**. There is no gate here, local or remote. This file is
the record, so that the policy is a decision rather than an accident, and so
that wiring it up later is a small change instead of a reconstruction.

## Why it is not enforced

A `dependency-review` job ran on pull requests until it was removed. It was
added alongside a config file that had been sitting in the tree, unwired, since
long before — and having now run for a while with nobody reading the allowlist
it enforces, it was carrying more risk than it removed. Two things it was doing
that the rest of CI does not:

- the **licence** half, which is what this file is about, and which had never
  been checked against a real dependency;
- a **vulnerability** half, on `pull_request` only. That one is not lost: the
  `ci` job runs `npm audit --audit-level=high` on every push to `main`
  (`ci.yml`), which is the same policy applied to the whole tree rather than to
  a diff.

So removing the job leaves no coverage gap. It leaves this policy unenforced,
which is a choice, and this paragraph is the choice's justification.

## The policy

**Deny:** `GPL-3.0-only`, `AGPL-3.0-only`.

A photo editor that runs in a browser and is built and distributed by its users
cannot carry a copyleft dependency, or the project inherits the obligation to
release under the same terms. This is the one part of the list that was never
optional and is not a matter of taste.

**Allow:** `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `CC0-1.0`,
`Unlicense`, `WTFPL`, `Zlib`, `MPL-2.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`.

The permissive half is uncontroversial. The three entries worth naming are:

- **`WTFPL`** — "Do What The Fuck You Want To Public License". Permissive by
  text, but it is not on any SPDX allowlist that a corporate legal review will
  accept, so it is friction at exactly the moment it is least welcome.
- **`CC-BY-SA-4.0`** and **`CC-BY-4.0`** — these are content licences. A
  dependency's _code_ being CC-BY-SA would make it copyleft in a way that is
  close to the GPL case the deny list exists to prevent. They are on the list
  because they were never read, not because anyone decided they were right.
- **`MPL-2.0`** — file-level copyleft, weak-copyleft in practice, and widely
  deployed. This one is a reasonable keep.

**Fail on severity:** `high`.

## The known gap

Nothing in the current tree has ever been checked against the allowlist, so it
is unverified: it is a list written once, never applied, and never reviewed
against a real dependency set. If a dependency's licence is not on the allow
list, nothing rejects it. There is no step that would notice.

`npm audit` covers the _vulnerability_ half of the policy and does run, on
every push. It says nothing about licences.

## If this is ever wired up

`github/dependency-review-action` is the mechanism, and it is PR-only by
design: it diffs a pull request's dependency tree against its base, so on a
push to `main` there has nothing to compare against and the job is a no-op. The
list above is a transcription of the config file that was removed, so the
allow/deny lists have one home and can be pasted straight back.

Two things to fix at that point, not before:

1. Drop `WTFPL`, `CC-BY-4.0` and `CC-BY-SA-4.0` unless a specific dependency
   forces one of them. An allowlist is a list of decisions that were made, and
   three of these were never made.
2. Decide whether the check is a gate or an advisory. It was `continue-on-error`
   in spirit — a PR comment on failure — for as long as it ran, and calling
   that a gate is the mistake that made it feel load-bearing when it was not.
