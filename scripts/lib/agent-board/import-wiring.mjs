/**
 * The database half of `swarm import`.
 *
 * The parsing half — turning a hand-maintained handoff document into items with
 * a stable `origin` — is a pure function in `handoff-import.mjs` and is tested
 * against the real documents. This module is the part that touches the board,
 * and it exists separately so the parser stays testable without a database and
 * so the import's decisions are in one readable place.
 *
 * The import is one-way and idempotent, keyed on the document's own numbering:
 * an item's `origin` is `HANDOFF.md#12`, so re-running after the document grew
 * a new item files only what is new and never duplicates, renumbers or
 * re-orders what is already there. The document stays the durable record; the
 * board gains a live, claimable index of the same items.
 */

import { readFileSync } from 'node:fs';
import { BoardError, foldTitle, priorityFromTitle } from './db.mjs';
import { SCOPE_BY_FILE, parseHandoffDoc, planImport } from './handoff-import.mjs';

const DEFAULT_FILES = Object.keys(SCOPE_BY_FILE);

/**
 * Numbered sections in these documents that are not defects and must not become
 * board issues. `HANDOFF.md`'s section 0 is the branch-state preamble an agent
 * reads before the problem list; no parser can tell a numbered section from a
 * numbered defect, and a handful of named origins is more honest than a
 * heuristic that guesses.
 *
 * Matched on TITLE as well as origin, because an origin alone fails open in the
 * worst direction: renumber the preamble from `## 0.` to `## 1.` and a
 * sixty-line section of repository state files itself as a claimable defect,
 * while the real item 1 is filed a second time under a new number. A title
 * survives renumbering, so the pair is what actually holds.
 */
const NOT_ITEMS = [
  { origin: 'HANDOFF.md#0', title: 'branch state' },
  { origin: 'HANDOFF.md#0', title: 'branch' },
];

/**
 * The documents carry their own urgency in the heading — `P0 — the durable
 * replay path has no production caller`, `P2 — an empty CDP capture…` — and
 * every imported item was landing on the board as `normal`.
 *
 * That is not a cosmetic gap. Priority is the column `swarm ready` SORTS on, so
 * a flat priority column means the queue an agent works from is in document
 * order rather than in order of how much damage the item does, and the P0s sit
 * wherever their heading happened to be. The documents' P0..P3 map onto the
 * board's four levels directly; anything unlabelled stays `normal` rather than
 * being promoted or buried on a guess.
 */
export async function importDocuments({ board, files = null, dryRun = false, cwd = process.cwd() } = {}) {
  const targets = files && files.length > 0 ? files : DEFAULT_FILES;
  const read = [];
  for (const file of targets) {
    let text;
    try {
      text = readFileSync(`${cwd}/${file}`, 'utf8');
    } catch (error) {
      // A missing document is a condition an agent can act on, not a stack
      // trace. A `BoardError` carries the message to the CLI's handler, which
      // prints it and sets the exit code; an ENOENT escaped as a raw exception
      // and dumped a Node call stack at whoever ran the command.
      throw new BoardError(
        `cannot read ${file} from ${cwd}: ${error.code ?? error.message}. ` +
          'The board imports the handoff documents from the repository root — run it from there, ' +
          'or pass --file with a path this board can read.',
        { code: 1 }
      );
    }
    read.push({ file, text, parsed: parseHandoffDoc({ file, text }) });
  }

  const ambiguousRetirements = read.flatMap((entry) =>
    (entry.parsed.ambiguousRetirements ?? []).map((retirement) => ({ file: entry.file, ...retirement }))
  );
  const letterSuffixedHeadings = read.flatMap((entry) =>
    (entry.parsed.letterSuffixedHeadings ?? []).map((heading) => ({ file: entry.file, ...heading }))
  );
  if (letterSuffixedHeadings.length > 0) {
    const details = letterSuffixedHeadings
      .map(({ file, line, level, text }) => `  ${file}:${line} (level ${level}): ${JSON.stringify(text)}`)
      .join('\n');
    throw new BoardError(
      'cannot import handoff documents: numbered headings with letter suffixes have no supported origin; ' +
        'choose a numeric heading or resolve the origin grammar before importing:\n' +
        details,
      { code: 1 }
    );
  }
  if (ambiguousRetirements.length > 0) {
    const details = ambiguousRetirements
      .map(({ file, line, origin, heading }) => `  ${file}:${line} (${origin}): ${JSON.stringify(heading)}`)
      .join('\n');
    throw new BoardError(
      'cannot import handoff documents: numbered headings with retirement status words must use an explicit ' +
        'retirement-list heading, or remove the status word if the entry is live:\n' +
        details,
      { code: 1 }
    );
  }

  // origin → title, not just origin: a bare origin cannot tell a re-run from a
  // document whose item 2 was renumbered upstream and now names a different
  // defect entirely. `createIssue` re-checks the same thing when it is called
  // directly; the planner is where an import decides, and it had no way to.
  const known = new Map(
    board.db
      .prepare('SELECT origin, title FROM issues WHERE origin IS NOT NULL')
      .all()
      .map((row) => [row.origin, row.title])
  );
  const plan = planImport(
    read.map((entry) => entry.parsed),
    known
  );

  const originForNumber = (file, number) => {
    const base = file.split('/').filter(Boolean).pop() || 'unknown.md';
    return `${base}#${number}`;
  };
  const retired = read
    .flatMap((entry) => (entry.parsed.dead ?? []).map((number) => originForNumber(entry.file, number)))
    .flatMap((origin) => {
      const id = board.findIssue(origin)?.id;
      return id ? [{ origin, id }] : [];
    });
  const created = [];
  const skipped = [...plan.skip];
  const drifted = [...(plan.drift ?? [])];
  const dead = read.flatMap((entry) => (entry.parsed.dead ?? []).map((number) => originForNumber(entry.file, number)));
  const duplicates = read.flatMap((entry) =>
    (entry.parsed.duplicateNumbers ?? []).map((number) => originForNumber(entry.file, number))
  );
  const notItems = [];
  const isNotItem = (item) =>
    NOT_ITEMS.some((entry) => entry.origin === item.origin && foldTitle(item.title).includes(foldTitle(entry.title)));
  const fileable = plan.create.filter((item) => {
    if (!isNotItem(item)) return true;
    notItems.push(item.origin);
    return false;
  });

  if (!dryRun) {
    // A drift the planner found is recorded, not just printed: the import
    // classifies a known origin before `createIssue` is ever reached, so the
    // event has to be written from here or the disagreement leaves no trace
    // beyond the one line on somebody's terminal.
    for (const origin of drifted) {
      const item = read.flatMap((entry) => entry.parsed.items).find((candidate) => candidate.origin === origin);
      const filed = board.findIssue(origin);
      if (item && filed) {
        board.transaction(() =>
          board.recordDrift(filed.id, {
            origin,
            boardTitle: filed.title,
            docTitle: item.title,
            agent: board.identity?.agentId,
          })
        );
      }
    }
    for (const item of fileable) {
      const scope = scopeForOrigin(item.origin);
      const result = board.createIssue({
        title: item.title,
        body: item.body,
        scope,
        priority: priorityFromTitle(item.title) ?? 'normal',
        origin: item.origin,
        files: item.files ?? [],
        // The files an item names are context, not an intention to edit them
        // now, so the import takes no locks; `swarm claim --files` is how an
        // agent actually reserves one.
        holdFiles: false,
        data: { source: 'handoff-import' },
      });
      if (result.created) created.push({ id: result.id, origin: item.origin, scope });
      else if (result.drift) drifted.push(item.origin);
      else skipped.push(item.origin);
    }
  } else {
    for (const item of fileable) created.push({ origin: item.origin, scope: scopeForOrigin(item.origin) });
  }

  return {
    dryRun,
    documents: read.map((entry) => ({
      file: entry.file,
      scope: entry.parsed.scope,
      parsed: entry.parsed.items.length,
      dead: (entry.parsed.dead ?? []).length,
    })),
    created,
    skipped,
    drifted,
    dead,
    retired,
    duplicates,
    notItems,
  };
}

function scopeForOrigin(origin) {
  const basename = String(origin).split('#')[0];
  const match = DEFAULT_FILES.find((file) => file.split('/').pop() === basename);
  return (match && SCOPE_BY_FILE[match]) || 'prod';
}
