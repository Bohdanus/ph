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
 * - `swarm ready` is the answer to "is anybody already on this", without
 *   reading a file that was true when it was written.
 * - `swarm hold` makes "never two agents on the same file" a refused write
 *   rather than a merge conflict, and it names the holder.
 * - Every command appends to one event log, so the swarm talks through one
 *   ordered, queryable history instead of N diverging documents.
 * - A claim is a lease. An agent that dies stops holding it, and the takeover
 *   is in the log.
 *
 * Everything is one SQLite file under the common git directory, reachable from
 * every worktree, with no daemon. `swarm watch` polls; it is a reader, and
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
  SCOPES,
  STATUSES,
  isImportedOrigin,
  parseDuration,
  priorityFromTitle,
  priorityRank,
  resolveBoardDir,
} from './lib/agent-board/db.mjs';
import { resolveIdentity } from './lib/agent-board/identity.mjs';

/**
 * How a reader has to spell a command, in ONE place.
 *
 * There is no `swarm` binary: `package.json` has no `bin` entry, so `swarm
 * doctor` — printed by the two commands an agent runs when its leases have gone
 * stale, which are exactly the two where the printed instruction is the whole
 * recovery — exits `command not found`. `npm run swarm --` is the only spelling
 * that runs, and it was hand-typed at six sites that nothing kept in step. A
 * printed command has to be PASTEABLE; an unpasteable one is worse than none,
 * because it looks like help.
 */
const RUN = 'npm run swarm --';

const USAGE = `swarm — live coordination for a swarm of agents on one repository

  NOT KILO'S board_read
  Kilo ships a built-in tool called board_read, and it is a different thing
  entirely: it carries messages between one session and the task children it
  spawned, so outside a fan-out it reports "no messages" truthfully and knows
  nothing about this repository. This tool was renamed FROM 'board' because that
  name is what made the two indistinguishable — a session asked it what the
  agents were doing, was told the board was empty, and was holding 196 events.
  It is now \`npm run swarm\`, and there is no 'board' script left to confuse.

  live state: ${RUN} status      what is ready: ${RUN} ready
  the log:    ${RUN} watch --follow

  new <title>            file an issue          --body --scope --priority --files --dep --origin
                           (the title is everything BEFORE the first flag)
  init                   create the board if it is not there yet
  ready                  unblocked, unclaimed work, most urgent first   --live --limit
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
                         bare: the LAST 200 MATCHING events, ascending, under a '#' line
                          that says which window this is — drop it with grep -v '^#'
                         --since <n>: every event after n, read to the END (not one page);
                          n must be a whole number, and a '#' line says so if there are none
                         --follow: the WHOLE log from the start, then each new event as it
                          lands, as lines; --json is not available and lines are the output
  health                 is this board being USED, or only carried?
  doctor                 release claims from dead worktrees and expired leases  --dry-run
  import                 the handoff documents into the board     --dry-run --file
  export                 dump the board as JSON

  --json                 machine-readable output on every command except help and --version,
                         and \`watch --follow\`, which is an unbounded stream: it prints one
                         line per event instead, and says so above
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
    if (token === '-h' || token === '-?') {
      /**
       * `-h`, not `--h`.
       *
       * The parser only recognised `--`, so a single-dash `-h` fell through to
       * `positional` and BECAME THE COMMAND: `swarm -h` hit the unknown-command
       * branch and answered the request for help with `unknown command: -h` and
       * a usage dump, which is the opposite of help. `flags.h` in the dispatch
       * below reads the field this writes, so `--h` keeps working unchanged.
       */
      flags.help = true;
      i += 1;
      continue;
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

/**
 * A filter value out of a closed set, or an error naming the set.
 *
 * The WRITE paths already do this: `new --priority urgent` and `--lease soon`
 * are refused with the allowed values (`db.mjs`, `unknown priority` /
 * `not a duration`). The READ paths did not, and that asymmetry is the defect:
 * `list --status opne` built a status set containing no real status, matched no
 * row, printed an empty table and exited 0 — textually identical to a board
 * with nothing on it, which is the one answer a reader cannot act on. The sets
 * are IMPORTED from the library rather than copied, so a set that changes there
 * cannot go stale here.
 *
 * The valueless flag is refused too, and that is not a hypothetical:
 * `--status` on its own used to be the empty set, which SQLite accepts as
 * "matches nothing" (`status IN ()`), so it produced the same empty table and
 * the same exit 0.
 */
const filterValues = (name, value, allowed) => {
  if (value === true || (typeof value === 'string' && value.trim() === '')) {
    throw new BoardError(`--${name} needs a value, one of: ${allowed.join(', ')}`, { code: 1 });
  }
  const values = list(value);
  for (const entry of values) {
    if (!allowed.includes(entry)) {
      throw new BoardError(`--${name}: ${entry} is not one of: ${allowed.join(', ')}`, { code: 1 });
    }
  }
  if (values.length === 0) {
    throw new BoardError(`--${name} needs a value, one of: ${allowed.join(', ')}`, { code: 1 });
  }
  return values;
};

/**
 * A row count, or an error.
 *
 * `Number('abc')` is `NaN` and `[].slice(0, NaN)` is `[]`, so `--limit abc` was
 * not a typo that printed a warning — it was a command reporting an empty board
 * because the reader had asked for nothing. A NEGATIVE count is worse than a
 * wrong one: it slices from the end, so `--limit -1` answers "the last row" to a
 * question about the first. Digits only, for the same reason `parseDuration`
 * refuses `soon`: a flag that cannot be understood must be refused, not guessed.
 */
const rowLimit = (name, value, fallback) => {
  if (value === undefined || value === null || value === false) return fallback;
  if (!/^\d+$/.test(String(value).trim())) {
    throw new BoardError(`--${name} needs a whole number of rows, got: ${String(value)}`, { code: 1 });
  }
  return Number(String(value).trim());
};

/**
 * A `--kind` filter is checked for SHAPE, not against a vocabulary.
 *
 * The event kinds are `addEvent` call sites spread across `db.mjs` and
 * `handoff-import.mjs` with no registry to import, and a list copied here goes
 * stale the next time one is added. A stale list REFUSES a kind that exists,
 * which is the worse of the two errors: the reader typed something real and was
 * told it does not exist. What is refused is the two shapes that cannot be a
 * kind at all — the valueless flag and an empty value.
 */
const eventKind = (value) => {
  if (value === undefined || value === null || value === false) return null;
  if (value === true || String(value).trim() === '') {
    throw new BoardError('--kind needs a value, for example: --kind lock.hold', { code: 1 });
  }
  return String(value);
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
 * The `#` line a bare `watch` prints above its window, ALWAYS.
 *
 * It is unconditional on purpose. It used to print only when the window was
 * truncated, and both suppressed cases are the failure this command exists to
 * stop: a `--kind` that matches nothing printed nothing at all and exited 0, so
 * a reader concluded the event was not there, and a board short enough to fit
 * in one page printed no header either, which made the documentation's "and it
 * says so on a `#` line" untrue on exactly the boards nobody thinks to test.
 *
 * It carries the three facts a reader cannot get from the lines: how much of the
 * matching set is on screen, how much is not, and the command that reads the
 * rest. `matched` is the count from the query, never arithmetic on the buffer,
 * so the header cannot claim a completeness the read did not have.
 *
 * One function, not four call sites: the wording is asserted character for
 * character by a test, and a second spelling would be a second thing to drift.
 */
function windowHeader({ shown, matched, kind, lastSeq }) {
  const scope = `event(s)${kind ? ` of kind ${kind}` : ''}`;
  const recovery = `swarm watch --since 0${kind ? ` --kind ${kind}` : ''}`;
  const head = (count) => `# showing the last ${count} of ${matched} ${scope};`;
  if (matched === 0) {
    // A filter that matches nothing is the one case where "the log is empty"
    // would be a lie, so the log's real size is in the sentence.
    return kind
      ? `${head(shown)} nothing matched — the log has ${lastSeq} event(s): ${recovery}\n`
      : `${head(shown)} the log is empty: ${recovery}\n`;
  }
  const omitted = matched - shown;
  return omitted > 0
    ? `${head(shown)} the other ${omitted} are not shown, read them: ${recovery}\n`
    : `${head(shown)} nothing is hidden: ${recovery}\n`;
}

/**
 * The `#` line for a `--since` read that matched nothing.
 *
 * `--since 999999` on a log of 633 events used to print nothing and exit 0,
 * which is the same lie as the truncated window one layer up: a well-formed
 * number no event has is not an answer. The log's real last sequence number is
 * in the line, so a reader can tell "nothing new" from "past the end".
 */
function emptySinceLine({ since, kind, lastSeq }) {
  const scope = kind ? ` of kind ${kind}` : '';
  return `# no event${scope} after #${since}; ${lastSeq > 0 ? `the log's last event is #${lastSeq}` : 'the log is empty'}\n`;
}

/**
 * The `--json` payload for the two FINITE reads. `watch --follow` has none: it
 * is an unbounded stream of lines, and the help and the test both say so.
 *
 * `matched` means "how many events the filter matched in the range you asked
 * for": on the bare path that is the whole matching set, which is how a caller
 * knows it is looking at a window, and on a `--since` path it is what was read,
 * because that read runs to the end. `truncated` is the bare path's window
 * boundary and is always false for a suffix.
 */
function watchPayload({ mode, since, kind, events, matched = events.length }) {
  return {
    mode,
    since,
    kind,
    events,
    shown: events.length,
    matched,
    truncated: mode === 'tail' && matched > events.length,
    firstSeq: events.length > 0 ? Number(events[0].seq) : null,
    lastSeq: events.length > 0 ? Number(events[events.length - 1].seq) : null,
  };
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
  // Whether a command was NAMED. A bare `npm run board` lands on `status`, and
  // that is the one invocation a confused reader is most likely to have made —
  // it is what gets typed when the tool itself is in question, so it is where
  // the tool has to introduce itself.
  const implicit = positional.length === 0;
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
    // `null` means "this command's output IS the payload`: swarm export has
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
    /**
     * Maintenance nobody has to remember, on every command.
     *
     * This is safe only because it renews BEFORE it sweeps, so the thing it
     * reclaims is always a claim whose worktree is gone. Running `doctor`
     * itself here instead would hand a 45-minute timer the power to strip a
     * lock off an agent in the middle of an edit, and `doctor` had been run
     * zero times in 238 events — not because nobody needed it, but because
     * remembering to run it is exactly the discipline a lease cannot depend on.
     *
     * `doctor` is EXEMPT, and has to be. A sweep before `doctor` would mean the
     * real one had already run, so `doctor --dry-run` — the command whose whole
     * job is to answer "what is stale right now", and the one a loop reads —
     * would report nothing, and the command would be decorative.
     */
    if (command !== 'doctor') board.autoSweep();

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
          status: flags.status ? filterValues('status', flags.status, STATUSES) : null,
          scope: flags.scope ? filterValues('scope', flags.scope, SCOPES) : null,
          files: flags.files ? list(flags.files) : null,
          claimedBy: typeof flags.claimed_by === 'string' ? flags.claimed_by : null,
          limit: rowLimit('limit', flags.limit, NO_LIMIT),
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
        const limit = rowLimit('limit', flags.limit, 50);
        // The whole ready set, not a page of it. The page is taken AFTER the
        // ranking below, because slicing first and ranking second is how a
        // fifty-row queue ends up showing the same fifty rows every time: the
        // cap fell on the import's file order, and the live work at the bottom
        // of the board was never on the page at all.
        const all = board.readyIssues({ limit: NO_LIMIT });
        // The FILES column is the whole point of the table: an issue nobody has
        // claimed can still be one whose files another agent is already in, and
        // an agent that has to find that out by trying is an agent that just
        // lost a file lock race for nothing. It reports the files the issue is
        // ABOUT, not the locks it happens to hold — an imported item holds none,
        // and a column that only ever said `-` told the reader nothing.
        const foreignLocks = board.liveLocks().filter((lock) => lock.agent_id !== identity.agentId);
        const detail = new Map();
        for (const issue of all) {
          const files = board.issueFiles(issue.id);
          const held = foreignLocks.filter((lock) => files.includes(lock.path));
          detail.set(issue.id, {
            files,
            live: !isImportedOrigin(issue.origin),
            held: held.map((lock) => ({ path: lock.path, agent_id: lock.agent_id })),
          });
        }

        /**
         * Priority first, because it is the one signal an agent stated on
         * purpose. After that, two facts this command can compute and the
         * filer never had to:
         *
         * - LIVE before IMPORTED. A `HANDOFF.md#31` row is prose the durable
         *   record already owns; a finding a peer filed an hour ago is the only
         *   thing on this board that exists BECAUSE two agents were working at
         *   once. With fifty-four imported rows sharing one `normal` band, the
         *   old tie-break was file order, so `ready` handed back the import and
         *   buried the swarm.
         * - FREE before CONTENDED. An issue another agent is already inside its
         *   files cannot be started; an agent reading a queue to answer "what do
         *   I pick up" needs the startable ones at the top, not a count of the
         *   busy ones.
         */
        const ranked = [...all].sort((a, b) => {
          const aInfo = detail.get(a.id);
          const bInfo = detail.get(b.id);
          // Priority is compared HERE and not inherited from `listIssues`'s own
          // ordering: a sort that only breaks ties still silently reorders when
          // the query underneath it changes, and this is the list an agent
          // picks its next task from.
          return (
            priorityRank(a.priority) - priorityRank(b.priority) ||
            Number(bInfo.live) - Number(aInfo.live) ||
            Number(aInfo.held.length > 0) - Number(bInfo.held.length > 0) ||
            a.created_at.localeCompare(b.created_at)
          );
        });

        const liveCount = all.filter((issue) => detail.get(issue.id).live).length;
        const startable = all.filter(
          (issue) => detail.get(issue.id).live && detail.get(issue.id).held.length === 0
        ).length;
        // The count, because the table cannot say it. Fifty-six rows in one
        // priority band reads as fifty-six things to do; it is two, and the
        // other fifty-four are a mirror of documents that are already merged.
        const summary = [
          `${liveCount} live · ${all.length - liveCount} imported from the handoff documents`,
          startable > 0
            ? `${startable} startable now — nobody else is in the files`
            : 'none startable now: every live issue is inside a file another agent holds',
        ].join(' · ');

        const preLimit = flags.live ? ranked.filter((issue) => detail.get(issue.id).live) : ranked;
        const chosen = preLimit.slice(0, limit);
        /**
         * WHICH of three different things emptied the table.
         *
         * The guard used to be `chosen.length === 0 && all.length !== 0`, so one
         * message claimed a cause for all three: `--limit 0`, `--limit abc` (a
         * NaN, and `[].slice(0, NaN)` is `[]`) and an ordinary run with no
         * `--live` all printed "--live: nothing ready, because all N ready issues
         * are handoff imports". A tool that volunteers a confident explanation it
         * has not checked is worse than one that says nothing, because the
         * explanation is what the reader acts on.
         */
        const emptyReason = () => {
          // The limit is what emptied it, and `preLimit` is the proof: it is the
          // set the limit took a page of, so a non-empty one means the board had
          // something ready all along.
          if (preLimit.length > 0) {
            return `--limit ${limit} showed none of the ${preLimit.length} ready issue(s): the board is not empty`;
          }
          if (all.length === 0) return 'nothing ready: everything open is claimed, blocked, or closed';
          if (flags.live) {
            return `--live: nothing ready, because all ${all.length} ready issues are handoff imports`;
          }
          // Unreachable while `preLimit` is the whole ranked set: with no
          // `--live` an empty `preLimit` IS an empty `all`, which the line above
          // has already caught. It is here so that a future `preLimit` that
          // filters differently cannot make the import story reach a run that
          // never passed `--live`.
          return 'nothing ready';
        };
        const rows = chosen.map((issue) => {
          const { files: named, held } = detail.get(issue.id);
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
          {
            ...Object.fromEntries([
              ['liveCount', liveCount],
              ['importedCount', all.length - liveCount],
              ['startableCount', startable],
            ]),
            issues: chosen.map((issue) => ({ ...issue, ...detail.get(issue.id) })),
          },
          chosen.length === 0 ? emptyReason() : [columns(rows, ['ID', 'PRIORITY', 'SCOPE', 'ORIGIN', 'FILES', 'TITLE']), '', summary].join('\n')
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
        /**
         * The paths the board REFUSED to touch because another live agent holds
         * them. Read defensively (`?? []`) so this command keeps working against
         * a board that does not report the field yet — and, more to the point,
         * so the two meanings of "released nothing" stay distinguishable instead
         * of collapsing into one success line: you never held these paths, or
         * somebody else holds them and you are not going to get them.
         */
        const blocked = result.blocked ?? [];
        emit(
          { ...result, blocked },
          [
            result.released.length ? `released ${result.released.join(', ')}` : null,
            blocked.length
              ? `not released, held by another agent: ${blocked
                  .map((entry) => `${entry.path} by ${entry.agent_id}`)
                  .join(', ')}`
              : null,
            result.released.length === 0 && blocked.length === 0
              ? 'nothing held by you there: you held none of these paths, and nobody else does either'
              : null,
          ]
            .filter(Boolean)
            .join('\n')
        );
        /**
         * 4, the table's "file held by another agent", whenever anything is
         * still held by somebody else — including the partial case, where this
         * agent got its own paths and did not get the other one, because a
         * caller gating on the code must not read a half-done release as done.
         *
         * Exit 0 here is what `scripts/e2e-run.mjs:404-407` records as having
         * made a dead-holder reclaim look like it worked: it ran, matched no row,
         * and reported success.
         */
        return blocked.length > 0 ? 4 : 0;
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
        const result = board.note(message);
        // The seq comes back because a note you cannot FIND is a note you
        // cannot confirm. This board read its own log from the wrong end for
        // most of a day, and an agent that had this number could have asked
        // `swarm watch --since <seq>` and been answered, instead of grepping a
        // window that did not contain the event and concluding it had failed.
        emit(
          { message, seq: result.seq },
          `noted — event #${result.seq}; read it back: swarm watch --since ${result.seq}`
        );
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
        // reviewer who wants to close it runs `swarm close` as themselves, and
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
            // The path is the identity. Two boards on one machine, one per
            // session and one per repository, and an agent that cannot say
            // which file it just read cannot tell a live board from an empty one.
            implicit
              ? [
                  `swarm — the agents working THIS repository — ${board.path}`,
                  '  (Kilo\'s built-in board_read is a different tool and reads "no messages" by design;',
                  '   it only carries traffic between one session and its subagents.)',
                  '',
                ].join('\n')
              : `swarm — ${board.path}`,
            `${Object.entries(report.counts)
              .filter(([, count]) => count > 0)
              .map(([status, count]) => `${count} ${status}`)
              .join(' · ')}`,
            `${report.ready} ready · ${report.blocked} blocked · ${report.agents} agents seen`,
            report.expiredClaims > 0
              ? `${report.expiredClaims} expired claim(s) still recorded — run: ${RUN} doctor`
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
            `last event #${report.lastSeq} — ${RUN} watch --since ${report.lastSeq}`,
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
        const PAGE = 200;
        // Shape-checked, not vocabulary-checked, like every other read filter:
        // the event kinds are `addEvent` call sites with no registry, so a
        // `--kind` with no value is refused while a real kind is never refused
        // for being new.
        const kind = eventKind(flags.kind);
        // Reading the log from the beginning was ALSO wrong, and it is the half
        // that cost two agents a session. A bare `watch` took `--since 0`, read
        // one page, and stopped: on a log longer than a page it printed a FIXED
        // WINDOW PINNED TO THE START — the first PAGE events, forever, and never
        // one event past it, no matter how many landed since. Every `note`
        // written after that window was simply not in the output. An agent
        // grepping for its own note text got nothing and concluded the note had
        // not landed. It had. (The same report blamed ANSI colour: the output
        // is plain text with no ESC byte anywhere in it, so that is a
        // misdiagnosis and the wrong thing to go looking for. No duration is
        // quoted here on purpose — the shape is the defect, and every number
        // this paragraph could carry has already gone stale once.)
        //
        // So the three invocations mean three different things, which is what a
        // reader expects from a log:
        //
        //   `--follow`   unchanged: everything from the start, then it waits for
        //                 more. A follower wants the story so far, and the spawn
        //                 test that watches for an event written BEFORE it
        //                 started depends on exactly that. It is an unbounded
        //                 stream, so it prints LINES and has no document for
        //                 `--json` to emit — the one documented exception, and
        //                 the help says so.
        //   `--since N`  EVERY event after N, read to the end, because `swarm
        //                 status` and `swarm note` both hand out exactly this
        //                 invocation and a reader who names a sequence number is
        //                 asking for a suffix. The old code stopped after 200
        //                 and silently lost the rest — the other half of the
        //                 same defect. Finite, so `--json` is honoured.
        //   bare         The last PAGE of MATCHING events, ALWAYS under a `#`
        //                 line saying which window that is. Not only when
        //                 something was dropped: silence about the window is the
        //                 same defect one layer up, because a reader who cannot
        //                 see the window is exactly the reader who concludes the
        //                 event they want is not there.
        //
        // `--since` is validated rather than coerced. `Number('abc')` is NaN,
        // and `seq > NaN` is false in SQLite for every row, so an unvalidated
        // flag answered a typo with a silently EMPTY log. A well-formed number
        // past the end of the log is the same lie one layer further up, so it
        // is answered too.
        const rawSince = flags.since === undefined ? null : String(flags.since);
        if (rawSince !== null && !/^\d+$/.test(rawSince)) {
          // A bare `--since` parses to the boolean `true`, so `String(true)`
          // printed "got: true" — a JS value leaked into user-facing text. The
          // empty case gets its own sentence naming what to type instead.
          throw new BoardError(
            rawSince === 'true'
              ? `--since needs a sequence number: --since <n> (for instance --since 0 for the whole log; the log's last event is #${board.lastSeq()})`
              : `--since wants a whole sequence number, 0 or more, got: ${rawSince}`,
            { code: 1 }
          );
        }
        const since = rawSince === null ? null : Number(rawSince);

        if (flags.follow || since !== null) {
          // The stream. The cursor MOVES — it did not, and a `--follow` re-read
          // the same page on every poll for as long as it ran.
          const read = [];
          let cursor = since ?? 0;
          for (;;) {
            const events = board.events({ since: cursor, limit: PAGE, kind });
            // `--json` decides BEFORE the first line is written, not after the
            // loop: emitting the document after the text would print both, and
            // a caller that asked for JSON would have to choose which half of
            // the output to believe. A `--follow` writes lines under `--json`
            // TOO, because that is the documented exception and this loop never
            // ends — suppressing its lines would leave it printing nothing at
            // all, forever.
            if (!json || flags.follow) for (const event of events) out.write(`${eventLine(event)}\n`);
            read.push(...events);
            if (events.length > 0) cursor = Number(events.at(-1).seq);
            if (!flags.follow) {
              // A page shorter than PAGE is the last one. The loop continues on
              // a FULL page, so a deliberate `--since 0` read cannot silently
              // stop at 200 and lose everything after it.
              if (events.length < PAGE) break;
              continue;
            }
            // A full page means there is probably more waiting, so go straight
            // back; an empty one means the swarm is quiet, so do not spin on it.
            await new Promise((resolve) => setTimeout(resolve, events.length > 0 ? 50 : 1500));
          }
          if (json) {
            // `--json` is honoured on this path, which the flag's own help
            // promises: the payload says the read is a SUFFIX and not a window,
            // so a caller cannot mistake `matched: 12` here for a page
            // boundary. `watch --follow` never reaches this — it is a stream
            // and it has already written lines.
            emit(watchPayload({ mode: 'since', since, kind, events: read }), null);
          } else if (read.length === 0) {
            // Nothing after N is the one `--since` outcome with no output of its
            // own, and "printed nothing, exited 0" is the exact reading that
            // made an agent think its note had not landed.
            out.write(emptySinceLine({ since, kind, lastSeq: board.lastSeq() }));
          }
          return 0;
        }

        // The window. `recentEvents` filters in SQL and reverses, so this is one
        // indexed read whatever the log's length — a window is a set of
        // MATCHING events, and the last 200 `note`s can sit anywhere in the log.
        // Reading the whole log forward to collect them, as an earlier attempt
        // here did, is correct but O(log length) for a fixed-size answer, and it
        // justified itself with a claim about backwards queries that was false.
        const { events: window, matched } = board.recentEvents({ limit: PAGE, kind });
        if (json) {
          emit(watchPayload({ mode: 'tail', since: null, kind, events: window, matched }), null);
          return 0;
        }
        // `#` so it is a comment a pipeline can drop, not an event line, and
        // UNCONDITIONAL: the window is the one thing a reader cannot see from
        // the lines below it, so a run that shows nothing has to say why.
        out.write(windowHeader({ shown: window.length, matched, kind, lastSeq: board.lastSeq() }));
        for (const event of window) out.write(`${eventLine(event)}\n`);
        return 0;
      }

      case 'health': {
        const report = board.health();
        const rows = (map) =>
          Object.entries(map)
            .slice(0, 6)
            .map(([kind, n]) => [kind, n]);
        emit(
          report,
          [
            `${report.total} events in the log, in two units that must not be added together:`,
            '',
            `  per COMMAND (one event each) — ${report.activity.perCommandTotal}:`,
            ...(rows(report.activity.perCommand).length
              ? [columns(rows(report.activity.perCommand), ['KIND', 'N'])]
              : ['    (none)']),
            `  per FILE (one event each) — ${report.activity.perFileTotal}:`,
            ...(rows(report.activity.perFile).length
              ? [columns(rows(report.activity.perFile), ['KIND', 'N'])]
              : ['    (none)']),
            '',
            // The lock number comes from the table, not the log, because it is
            // the only one of the three that counts the same thing twice.
            `locks: ${report.locks.taken} taken · ${report.locks.live} still live · ${report.locks.released} released`,
            `claims: ${report.claims.live} live · ${report.claims.expired} expired of ${report.claims.total} unreleased`,
            `sweeps run: ${report.sweeps} (reclaims the board made by itself)`,
            `dependencies recorded: ${report.deps}`,
            `open issues: ${report.issues.live} live · ${report.issues.imported} imported`,
            // Each of these is a measurement, not a nag: the point of the
            // command is that a reader does not have to hand-write the SQL, and
            // a number that is merely printed is one nobody compares.
            report.claims.expired > 0 ? `${report.claims.expired} claim(s) expired — run: ${RUN} doctor` : null,
            report.idleLive.length > 0
              ? `${report.idleLive.length} live finding(s) idle over 6h, needing a home in the handoff docs:`
              : null,
            ...report.idleLive.map((issue) => `  ${issue.id} ${truncate(issue.title, 60)}`),
            // Stated as a question, because it is one. "Unused" has two very
            // different causes — the feature is bad, or the swarm never needs
            // it — and they call for opposite responses, so the number is
            // reported and the reading is left to whoever runs it.
            report.deps === 0
              ? 'note: 0 dependencies recorded. Either they are not needed, or nobody is choosing between issues — this swarm is dispatched, not self-directing.'
              : null,
          ]
            .filter((line) => line !== null)
            .join('\n')
        );
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
              ? `${result.drifted.length} DRIFTED — the document's item under that number is a different defect (${RUN} show <id>)`
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
        // dumps the board as JSON, and a bare `swarm export` used to print a
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
      err.write(`swarm: ${error.message}\n`);
      return error.code;
    }
    err.write(`swarm: ${error?.stack ?? error}\n`);
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
