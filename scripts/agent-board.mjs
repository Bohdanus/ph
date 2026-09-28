#!/usr/bin/env node
/**
 * The swarm board: live coordination for agents working this repository in
 * parallel, replacing the practice of finding out what another agent is doing by
 * reading a committed Markdown file that was written before they started.
 *
 * WHAT THIS IS NOT
 * -----------------
 * It is not the handoff documents. `HANDOFF.md`, `TEST-FLAKES.md` and
 * `e2e/OPEN_PROBLEMS.md` remain the durable, reviewable record of what is known
 * about this codebase, and the prose in them is still written by hand and still
 * merged through a pull request. This is the part that has to be correct in
 * real time between concurrent agents: who has claimed what, which file two
 * agents are about to edit, what one agent found out that another needs, and
 * what it did find out that nobody claimed because the worktree is gone.
 *
 * WHAT IT BUYS
 * ------------
 * - `board ready` is the answer to "is anybody already on this", without
 *   reading a file that was true when it was written.
 * - `board hold` makes "never two agents on the same file" a refused write
 *   rather than a merge conflict, and it names the holder.
 * - Every command appends to one event log, so the swarm talks through one
 *   ordered, queryable history instead of N diverging documents.
 * - A claim is a lease. An agent that dies stops holding it, and the takeover
 *   is in the log.
 *
 * Everything is one SQLite file under the common git directory, reachable from
 * every worktree, with no daemon. `board watch` polls; it is a reader, and
 * nothing depends on it running.
 *
 * @example node scripts/agent-board.mjs new "reorder drops hasUnsavedChanges" --scope history --files src/util/history-adapter.ts
 * @example node scripts/agent-board.mjs ready
 * @example node scripts/agent-board.mjs claim ph-12 --lease 90m
 * @example node scripts/agent-board.mjs watch --follow
 */

import { pathToFileURL } from 'node:url';
import {
  Board,
  BoardError,
  DEFAULT_LEASE_MS,
  NO_LIMIT,
  parseDuration,
  priorityFromTitle,
  resolveBoardDir,
} from './lib/agent-board/db.mjs';
import { resolveIdentity } from './lib/agent-board/identity.mjs';

const USAGE = `agent board — live coordination for a swarm of agents on one repository

  new <title>            file an issue          --body --scope --priority --files --dep --origin
                           (the title is everything BEFORE the first flag)
  init                   create the board if it is not there yet
  ready                  unblocked, unclaimed work, most urgent first
  list                   the whole board        --status --scope --files --claimed-by --limit
  show <id>              one issue: claim, locks, deps, full thread
  claim <id>             take it, and its files --lease --note --force
  heartbeat <id>         extend your lease      --lease   (alias: hb)
  release <id>           give it back, locks released with it
  hold <path...>         claim a file           --issue --lease --force
  unlock <path...>       release a file         --force
  check <path...>        who holds these files  (exit 1 if any is held)
  comment <id> <text>    say something on an issue
  note <text>            say something to the swarm
  resolve <id>           the work is done       --note
  close <id>             verified by YOU, done
  defer <id>             park it                --reason --until
  reopen <id>            back to open
  dep <id> <depends-on>  record a dependency
  status                 counts, your claims, live locks, expiring leases
  watch                  the event log          --follow --since --kind
  doctor                 release claims from dead worktrees and expired leases  --dry-run
  import                 the handoff documents into the board     --dry-run --file
  export                 dump the board as JSON

  --json                 machine-readable output on every command except help and --version
  --agent <id>           act as somebody else (default: the current git branch)
  --dir <path>           use another board database (default: $(git rev-parse --git-common-dir)/agent-board)

exit codes: 0 ok · 1 usage or error · 2 not found · 3 claimed or not claimable · 4 file held by another agent
            5 the agent that resolved an issue cannot be the one that closes it`;

/** Flags that take a value. Everything else is a boolean switch. */
const VALUE_FLAGS = new Set([
  'agent',
  'body',
  'claimed-by',
  'dep',
  'dir',
  'files',
  'from',
  'issue',
  'kind',
  'lease',
  'limit',
  'note',
  'origin',
  'priority',
  'reason',
  'scope',
  'since',
  'status',
  'title',
  'until',
  'file',
]);

/**
 * Flags that take a LIST, and therefore swallow every following token that is
 * not itself a flag.
 *
 * `--files a.ts b.ts` was the form AGENTS.md documented, and it did not work:
 * the parser took `a.ts` as the value and left `b.ts` as a positional, so it
 * became part of the issue TITLE on `new` and was silently ignored on `claim`.
 * A documented example that does not do what it says is worse than a missing
 * one, so the parser learned the documented form instead of the doc being
 * quietly changed. A comma-separated value still works, and repeating the flag
 * still works.
 */
const LIST_FLAGS = new Set(['files', 'dep', 'file']);

/**
 * A dependency-free argument parser, because an agent's first command in a
 * fresh context is often `--help` and a tool that cannot be run without a
 * working `node_modules` is a tool that will not be run. Unknown flags are kept
 * as `true` rather than rejected, so a newer flag on an older checkout degrades
 * into a command that still works.
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  /** The positional arguments that appeared BETWEEN the command and the first flag after it. */
  const leading = [];
  let seenFlag = false;
  let seenCommand = false;
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      // A GLOBAL flag before the command does not end the leading run: the help
      // lists --json, --agent and --dir as global, `board --json new "title"` is
      // a normal way to type it, and latching on the first `--` token anywhere
      // emptied the title of every such command.
      if (seenCommand) seenFlag = true;
      const eq = token.indexOf('=');
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const key = name.replace(/-/g, '_');
      let value = eq === -1 ? undefined : token.slice(eq + 1);
      if (value === undefined) {
        const next = argv[i + 1];
        if (VALUE_FLAGS.has(name) && next !== undefined && !next.startsWith('--')) {
          if (LIST_FLAGS.has(name)) {
            // A list flag is greedy: every following bare token belongs to it.
            const values = [];
            while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
              values.push(argv[i + 1]);
              i += 1;
            }
            value = values.length > 0 ? values : true;
          } else {
            value = next;
            i += 1;
          }
        } else {
          value = true;
        }
      }
      if (key in flags) {
        flags[key] = Array.isArray(flags[key]) ? [...flags[key], value] : [flags[key], value];
      } else {
        flags[key] = value;
      }
    } else {
      positional.push(token);
      if (!seenFlag) leading.push(token);
      // The first bare token is the COMMAND; everything after it, up to the first
      // flag, is what `new`/`note`/`comment` read their text from.
      if (!seenCommand) seenCommand = true;
    }
    i += 1;
  }
  return { flags, positional, leading };
}

/**
 * Turns a flag into a list. An absent flag is an empty list and never the
 * string "undefined": `--files` and `--dep` are optional, and a caller that
 * passes nothing must not end up asking the board to hold a file called
 * `undefined` or to depend on an issue called `undefined`.
 */
const list = (value) => {
  if (value === undefined || value === null || value === true || value === false) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((entry) => typeof entry === 'string')
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
};

function columns(rows, headers) {
  if (rows.length === 0) return '';
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index] ?? '').length))
  );
  const line = (cells) =>
    cells
      .map((cell, index) => String(cell ?? '').padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

function ago(iso, at = Date.now()) {
  const delta = at - Date.parse(iso);
  if (!Number.isFinite(delta)) return '';
  if (delta < 90_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 5_400_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 172_800_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

/**
 * A title, clipped to a column, MARKED as clipped.
 *
 * `slice(0, 70)` with no ellipsis produced a row that read as a finished
 * sentence — `reorder-layers is the next append-boundary writer, and it is now
 * unb` — and an agent working from a truncated title cannot tell that it is
 * looking at half of one.
 */
function truncate(text, width) {
  const value = String(text);
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

function remaining(iso, at = Date.now()) {
  const delta = Date.parse(iso) - at;
  if (!Number.isFinite(delta) || delta <= 0) return 'expired';
  if (delta < 90_000) return `${Math.round(delta / 1000)}s left`;
  return `${Math.round(delta / 60_000)}m left`;
}

function eventLine(event) {
  const target = [event.issue_id, event.path].filter(Boolean).join(' ');
  return [
    String(event.seq).padStart(5),
    event.ts,
    event.agent_id,
    event.kind.padEnd(14),
    target.padEnd(18),
    (event.message ?? '').replace(/\s+/g, ' '),
  ]
    .filter((part, index) => index < 4 || part !== '')
    .join('  ');
}

/**
 * Runs one command. Exported, and given its streams, so the tests drive the
 * real CLI surface in-process instead of asserting against a reimplementation
 * of it; `main` is the thin wrapper that binds it to the terminal.
 */
export async function run(
  argv,
  { cwd = process.cwd(), env = process.env, out = process.stdout, err = process.stderr } = {}
) {
  const { flags, positional, leading } = parseArgs(argv);
  // `leading` is every bare token before the first flag, which includes the
  // command name. The title of `new` is the rest of that run.
  const leadingArgs = leading.slice(1);
  const command = positional[0] ?? (flags.help || flags.h ? 'help' : 'status');
  const args = positional.slice(1);

  if (flags.version) {
    out.write('agent-board 1.0.0\n');
    return 0;
  }
  if (command === 'help' || flags.help || flags.h) {
    out.write(`${USAGE}\n`);
    return 0;
  }

  const identity = resolveIdentity({ agent: typeof flags.agent === 'string' ? flags.agent : null, cwd, env });
  const board = new Board({ dir: flags.dir ? String(flags.dir) : resolveBoardDir({ cwd, env }), identity });
  const json = Boolean(flags.json);
  const emit = (payload, text) => {
    if (json) {
      out.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    // `null` means "this command's output IS the payload`: board export has
    // no human form, and printing an empty line for it is not one.
    if (text === null) {
      out.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    out.write(`${text}\n`);
  };

  try {
    board.open();
    board.touchAgent();

    switch (command) {
      case 'init': {
        emit({ dir: board.dir, path: board.path, created: true }, `board at ${board.path}`);
        return 0;
      }

      case 'new': {
        // Everything BEFORE the first flag is the title. Otherwise a flag this
        // script does not know about donates its value to it: `--verified-by bob`
        // filed an issue called "clean title bob", which is reachable by copying
        // any command line that once worked.
        const title = (typeof flags.title === 'string' ? flags.title : leadingArgs.join(' ')).trim();
        if (!title) throw new BoardError('new needs a title', { code: 1 });
        const result = board.createIssue({
          title,
          body: flags.body ? String(flags.body) : '',
          scope: flags.scope ? String(flags.scope) : 'prod',
          // A title that states its own P-level gets that level, on both filing
          // paths. Two commands reading the same title differently is one defect
          // with two urgencies depending on how it was filed.
          priority: flags.priority ? String(flags.priority) : (priorityFromTitle(title) ?? 'normal'),
          origin: flags.origin ? String(flags.origin) : null,
          files: list(flags.files),
          deps: list(flags.dep),
        });
        if (!result.created) {
          emit({ ...result, created: false }, `${result.id} already exists (origin ${flags.origin})`);
          return 0;
        }
        if (result.conflicts?.length) {
          err.write(
            `warning: ${result.conflicts
              .map((conflict) => `${conflict.path} is held by ${conflict.holder.agent_id}`)
              .join('; ')}\n`
          );
        }
        emit(
          { ...result, conflicts: result.conflicts ?? [] },
          `${result.id} filed${result.conflicts?.length ? ' (with lock conflicts above)' : ''}`
        );
        return 0;
      }

      case 'list': {
        const issues = board.listIssues({
          status: flags.status ? list(flags.status) : null,
          scope: flags.scope ? list(flags.scope) : null,
          files: flags.files ? list(flags.files) : null,
          claimedBy: typeof flags.claimed_by === 'string' ? flags.claimed_by : null,
          limit: flags.limit ? Number(flags.limit) : NO_LIMIT,
        });
        const rows = issues.map((issue) => [
          issue.id,
          issue.status,
          issue.priority,
          issue.scope,
          board.liveClaimOrNull(issue.id)?.agent_id ?? '-',
          truncate(issue.title, 70),
        ]);
        emit({ issues }, columns(rows, ['ID', 'STATUS', 'PRIORITY', 'SCOPE', 'CLAIMED BY', 'TITLE']));
        return 0;
      }

      case 'ready': {
        const issues = board.readyIssues({ limit: flags.limit ? Number(flags.limit) : 50 });
        // The FILES column is the whole point of the table: an issue nobody has
        // claimed can still be one whose files another agent is already in, and
        // an agent that has to find that out by trying is an agent that just
        // lost a file lock race for nothing. It reports the files the issue is
        // ABOUT, not the locks it happens to hold — an imported item holds none,
        // and a column that only ever said `-` told the reader nothing.
        const foreignLocks = board.liveLocks().filter((lock) => lock.agent_id !== identity.agentId);
        const detail = new Map();
        const rows = issues.map((issue) => {
          const named = board.issueFiles(issue.id);
          const held = foreignLocks.filter((lock) => named.includes(lock.path));
          detail.set(issue.id, {
            files: named,
            held: held.map((lock) => ({ path: lock.path, agent_id: lock.agent_id })),
          });
          return [
            issue.id,
            issue.priority,
            issue.scope,
            issue.origin ?? '-',
            held.length
              ? // The contended paths, by name: a count says something is busy
                // and a name says which one, and the name is the part an agent
                // has to act on.
                `${held.length}/${named.length} held: ${held
                  .map((lock) => `${lock.path} by ${lock.agent_id}`)
                  .join(', ')}`
              : named.length
                ? `${named.length} free`
                : '-',
            truncate(issue.title, 70),
          ];
        });
        emit(
          { issues: issues.map((issue) => ({ ...issue, ...detail.get(issue.id) })) },
          issues.length === 0
            ? 'nothing ready: everything open is claimed, blocked, or closed'
            : columns(rows, ['ID', 'PRIORITY', 'SCOPE', 'ORIGIN', 'FILES', 'TITLE'])
        );
        return 0;
      }

      case 'show': {
        const id = args[0];
        if (!id) throw new BoardError('show needs an issue id', { code: 1 });
        const issue = board.getIssue(id);
        const claim = board.liveClaimOrNull(id);
        const locks = board.locksFor(id);
        const deps = board.deps(id);
        const dependents = board.dependents(id);
        const thread = board.events({ since: 0, limit: 1000, issue: id });
        emit(
          {
            issue,
            claim,
            locks,
            deps: deps.map((dep) => dep.depends_on),
            dependents: dependents.map((dep) => dep.issue_id),
            events: thread,
          },
          [
            `${issue.id} [${issue.status}] ${issue.title}`,
            `  scope ${issue.scope} · priority ${issue.priority}${issue.origin ? ` · origin ${issue.origin}` : ''}`,
            `  filed by ${issue.created_by} ${ago(issue.created_at)}`,
            issue.resolver ? `  resolved by ${issue.resolver}` : null,
            issue.verified_by ? `  verified by ${issue.verified_by} ${ago(issue.verified_at)}` : null,
            claim
              ? `  claimed by ${claim.agent_id} (${claim.branch ?? 'no branch'}) · ${remaining(claim.lease_until)}`
              : '  not claimed',
            locks.length
              ? `  files: ${locks.map((lock) => `${lock.path}${lock.agent_id === identity.agentId ? '' : ` (${lock.agent_id})`}`).join(', ')}`
              : '  files: none locked',
            deps.length ? `  depends on: ${deps.map((dep) => dep.depends_on).join(', ')}` : null,
            dependents.length ? `  blocks: ${dependents.map((dep) => dep.issue_id).join(', ')}` : null,
            '',
            ...thread.map(eventLine),
          ]
            .filter((line) => line !== null)
            .join('\n')
        );
        return 0;
      }

      case 'claim': {
        const id = args[0];
        if (!id) throw new BoardError('claim needs an issue id', { code: 1 });
        const leaseMs = parseDuration(flags.lease, DEFAULT_LEASE_MS);
        const force = Boolean(flags.force);
        // The file locks are taken FIRST, so a claim can never be left standing
        // on a file this agent was not allowed to have: if the locks are
        // refused the claim never happens, and if the claim is then refused the
        // locks this command just took are given back.
        const taken = flags.files ? board.holdFiles(list(flags.files), { issueId: id, leaseMs, force }) : null;
        try {
          const result = board.claimIssue(id, {
            leaseMs,
            note: flags.note ? String(flags.note) : null,
            force,
          });
          emit(
            { ...result, files: taken?.held ?? [] },
            `${result.id} ${result.renewed ? 'lease extended' : 'claimed'} by ${result.agent} · ${remaining(result.lease_until)}${taken ? ` · files ${taken.held.join(', ')}` : ''}`
          );
          return 0;
        } catch (error) {
          /**
           * Give back `acquired`, never `held`, and never with `force`.
           *
           * `held` includes locks this agent already had before the command,
           * because holding a file you already hold is not a conflict — so
           * releasing `held` freed a file the agent had been working in since
           * before the command ran, on a command that only ever FAILED. `force`
           * made it worse by releasing other agents' rows on the same path.
           * `acquired` is what this invocation took, and nothing else.
           */
          if (taken?.acquired.length) board.releaseFiles(taken.acquired);
          throw error;
        }
      }

      case 'heartbeat':
      case 'hb': {
        const id = args[0];
        if (!id) throw new BoardError('heartbeat needs an issue id', { code: 1 });
        const result = board.heartbeat(id, { leaseMs: parseDuration(flags.lease, DEFAULT_LEASE_MS) });
        emit(result, `${id} lease extended · ${remaining(result.lease_until)}`);
        return 0;
      }

      case 'release': {
        const id = args[0];
        if (!id) throw new BoardError('release needs an issue id', { code: 1 });
        const result = board.releaseClaim(id, {
          force: Boolean(flags.force),
          reason: flags.reason ? String(flags.reason) : null,
        });
        emit(result, result.released ? `${id} released, its file locks with it` : `${id}: ${result.reason}`);
        return 0;
      }

      case 'hold': {
        const paths = args.length > 0 ? args : list(flags.files);
        const result = board.holdFiles(paths, {
          issueId: typeof flags.issue === 'string' ? flags.issue : null,
          leaseMs: parseDuration(flags.lease, DEFAULT_LEASE_MS),
          force: Boolean(flags.force),
        });
        emit(result, `held ${result.held.join(', ')} for ${result.agent}`);
        return 0;
      }

      case 'unlock': {
        const paths = args.length > 0 ? args : list(flags.files);
        const result = board.releaseFiles(paths, { force: Boolean(flags.force) });
        emit(result, result.released.length ? `released ${result.released.join(', ')}` : 'nothing held by you there');
        return 0;
      }

      case 'check': {
        const paths = args.length > 0 ? args : list(flags.files);
        if (paths.length === 0) {
          // It used to print `free: ` and exit 0 — the exit code the table
          // reserves for a FREE FILE, for a command that checked nothing.
          throw new BoardError('check needs at least one path', { code: 1 });
        }
        const report = paths.map((path) => board.checkPath(path));
        const busy = report.filter((entry) => !entry.free);
        emit(
          { report },
          busy.length
            ? busy
                .map((entry) =>
                  entry.nothing
                    ? 'nothing to check'
                    : entry.outside
                      ? `${entry.path} is not inside this repository`
                      : `${entry.path} held by ${entry.holders.map((h) => h.agent_id).join(', ')}`
                )
                .join('\n')
            : // The NORMALISED paths, not the ones typed: the free line quoted a
              // /tmp/… spelling while the JSON beside it carried /private/tmp/…,
              // and the two answers disagreed about the same file.
              `free: ${report.map((entry) => entry.path).join(', ')}`
        );
        return busy.length === 0 ? 0 : 1;
      }

      case 'comment': {
        const id = leadingArgs[0];
        const message = leadingArgs.slice(1).join(' ').trim();
        if (!id || !message) throw new BoardError('comment needs an id and a message', { code: 1 });
        board.comment(id, message);
        emit({ id, message }, `commented on ${id}`);
        return 0;
      }

      case 'note': {
        const message = leadingArgs.join(' ').trim();
        if (!message) throw new BoardError('note needs a message', { code: 1 });
        board.note(message);
        emit({ message }, 'noted');
        return 0;
      }

      case 'resolve': {
        const id = args[0];
        if (!id) throw new BoardError('resolve needs an issue id', { code: 1 });
        board.resolveIssue(id, { note: flags.note ? String(flags.note) : null, force: Boolean(flags.force) });
        emit({ id, status: 'resolved' }, `${id} resolved — somebody else's close still needed`);
        return 0;
      }

      case 'close': {
        const id = args[0];
        if (!id) throw new BoardError('close needs an issue id', { code: 1 });
        // The verifier is the identity running the command, and there is no flag
        // to name somebody else. A `--verified-by` string is a name the actor
        // supplies about a person who is not in the room: it made the whole
        // resolve/close separation one flag wide, since an agent could resolve
        // an issue and then close it by claiming a reviewer verified it. A
        // reviewer who wants to close it runs `board close` as themselves, and
        // the log records who actually did.
        const result = board.closeIssue(id, {
          note: flags.note ? String(flags.note) : null,
        });
        emit(result, `${id} closed, verified by ${result.verified_by}`);
        return 0;
      }

      case 'defer': {
        const id = args[0];
        if (!id) throw new BoardError('defer needs an issue id', { code: 1 });
        board.deferIssue(id, {
          reason: flags.reason ? String(flags.reason) : 'no reason given',
          until: flags.until ? String(flags.until) : null,
        });
        emit({ id, status: 'deferred' }, `${id} deferred`);
        return 0;
      }

      case 'reopen': {
        const id = args[0];
        if (!id) throw new BoardError('reopen needs an issue id', { code: 1 });
        board.reopenIssue(id, { reason: flags.reason ? String(flags.reason) : null, force: Boolean(flags.force) });
        emit({ id, status: 'open' }, `${id} reopened`);
        return 0;
      }

      case 'dep': {
        const [id, dependsOn] = args;
        if (!id || !dependsOn) throw new BoardError('dep needs an issue id and the issue it waits on', { code: 1 });
        board.addDep(id, dependsOn);
        emit({ id, depends_on: dependsOn }, `${id} now waits on ${dependsOn}`);
        return 0;
      }

      case 'status': {
        const report = board.status();
        emit(
          report,
          [
            `${Object.entries(report.counts)
              .filter(([, count]) => count > 0)
              .map(([status, count]) => `${count} ${status}`)
              .join(' · ')}`,
            `${report.ready} ready · ${report.blocked} blocked · ${report.agents} agents seen`,
            report.expiredClaims > 0
              ? `${report.expiredClaims} expired claim(s) still recorded — run: board doctor`
              : null,
            '',
            report.myClaims.length
              ? `you hold: ${report.myClaims
                  .map((claim) => `${claim.issue_id} (${remaining(claim.lease_until)})`)
                  .join(', ')}`
              : 'you hold no claims',
            report.myLocks.length
              ? `your files: ${report.myLocks.map((lock) => lock.path).join(', ')}`
              : 'you hold no file locks',
            report.expiringSoon.length
              ? `expiring soon: ${report.expiringSoon
                  .map((claim) => `${claim.issue_id} (${claim.agent_id}, ${remaining(claim.lease_until)})`)
                  .join(', ')}`
              : null,
            '',
            ...report.locks.map((lock) => `  ${lock.path} — ${lock.agent_id} · ${remaining(lock.expires_at)}`),
            '',
            `last event #${report.lastSeq} — board watch --since ${report.lastSeq}`,
          ]
            .filter((line) => line !== null)
            .join('\n')
        );
        return 0;
      }

      case 'watch': {
        // `cursor` MOVES. It did not, and a `watch --follow` re-read the same
        // 200 events on every poll for as long as it ran: the three events of a
        // test board were printed about seventy times a second, and on a board
        // with more than 200 events it would print the first 200 forever and
        // never show anything new — which is the opposite of tailing a log.
        let cursor = flags.since ? Number(flags.since) : 0;
        for (;;) {
          const events = board.events({
            since: cursor,
            limit: 200,
            kind: flags.kind ? String(flags.kind) : null,
          });
          for (const event of events) {
            out.write(`${eventLine(event)}\n`);
          }
          if (events.length > 0) cursor = Number(events.at(-1).seq);
          if (!flags.follow) break;
          // A full page means there is probably more waiting, so go straight
          // back; an empty one means the swarm is quiet, so do not spin on it.
          await new Promise((resolve) => setTimeout(resolve, events.length > 0 ? 50 : 1500));
        }
        return 0;
      }

      case 'doctor': {
        const findings = board.doctor({ dryRun: Boolean(flags.dry_run) });
        emit(
          { findings },
          findings.length === 0
            ? 'nothing stale: every claim and lock is live'
            : [
                `${flags.dry_run ? 'would release' : 'released'} ${findings.length} stale holding(s):`,
                ...findings.map(
                  (finding) =>
                    `  ${finding.kind} ${finding.issue ?? finding.path} — ${finding.agent}${
                      finding.worktree ? ` (${finding.worktree} is gone)` : ''
                    }`
                ),
              ].join('\n')
        );
        return 0;
      }

      case 'import': {
        const { importDocuments } = await import('./lib/agent-board/import-wiring.mjs');
        const result = await importDocuments({
          board,
          files: list(flags.file),
          dryRun: Boolean(flags.dry_run),
        });
        emit(
          result,
          [
            `${result.created.length} filed`,
            result.skipped.length ? `${result.skipped.length} already on the board` : null,
            result.drifted.length
              ? `${result.drifted.length} DRIFTED — the document's item under that number is a different defect (board show <id>)`
              : null,
            result.dead.length ? `${result.dead.length} skipped as already closed in their document` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        );
        return 0;
      }

      case 'export': {
        const issues = board.listIssues({ limit: Number.MAX_SAFE_INTEGER });
        // ALWAYS JSON, with or without the flag: the help says this command
        // dumps the board as JSON, and a bare `board export` used to print a
        // single newline, which is not a dump of anything.
        emit(
          {
            dir: board.dir,
            issues,
            events: board.events({ since: 0, limit: Number.MAX_SAFE_INTEGER }),
            claims: board.db.prepare('SELECT * FROM claims').all(),
            locks: board.db.prepare('SELECT * FROM file_locks').all(),
            agents: board.agents(),
          },
          // Without the flag this used to print a single newline. The help says
          // this command dumps the board as JSON, so it dumps JSON: the payload
          // IS the output, and a human who wants prose has `--json` off the
          // critical path rather than having to know that.
          json ? undefined : null
        );
        return 0;
      }

      default:
        err.write(`unknown command: ${command}\n\n${USAGE}\n`);
        return 1;
    }
  } catch (error) {
    if (error instanceof BoardError) {
      err.write(`board: ${error.message}\n`);
      return error.code;
    }
    err.write(`board: ${error?.stack ?? error}\n`);
    return 1;
  } finally {
    board.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  process.exitCode = await run(argv);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
