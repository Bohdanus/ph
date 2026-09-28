/**
 * The database half of `board import`.
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
import { SCOPE_BY_FILE, parseHandoffDoc, planImport } from './handoff-import.mjs';

const DEFAULT_FILES = Object.keys(SCOPE_BY_FILE);

/**
 * Numbered sections in these documents that are not defects and must not become
 * board issues. `HANDOFF.md`'s section 0 is the branch-state preamble an agent
 * reads before the problem list; no parser can tell a numbered section from a
 * numbered defect, and a handful of named origins is more honest than a heuristic
 * that guesses.
 */
const NOT_ITEMS = new Set(['HANDOFF.md#0']);

export async function importDocuments({ board, files = null, dryRun = false, cwd = process.cwd() } = {}) {
  const targets = files && files.length > 0 ? files : DEFAULT_FILES;
  const read = [];
  for (const file of targets) {
    const text = readFileSync(`${cwd}/${file}`, 'utf8');
    read.push({ file, text, parsed: parseHandoffDoc({ file, text }) });
  }

  const known = new Set(
    board.db
      .prepare('SELECT origin FROM issues WHERE origin IS NOT NULL')
      .all()
      .map((row) => row.origin)
  );
  const plan = planImport(
    read.map((entry) => entry.parsed),
    known
  );

  const created = [];
  const skipped = [...plan.skip];
  const dead = read.flatMap((entry) => (entry.parsed.dead ?? []).map((number) => `${entry.file}#${number}`));
  const notItems = [];
  const fileable = plan.create.filter((item) => {
    if (!NOT_ITEMS.has(item.origin)) return true;
    notItems.push(item.origin);
    return false;
  });

  if (!dryRun) {
    for (const item of fileable) {
      const scope = scopeForOrigin(item.origin);
      const result = board.createIssue({
        title: item.title,
        body: item.body,
        scope,
        origin: item.origin,
        files: item.files ?? [],
        // The files an item names are context, not an intention to edit them
        // now, so the import takes no locks; `board claim --files` is how an
        // agent actually reserves one.
        holdFiles: false,
        data: { source: 'handoff-import' },
      });
      if (result.created) created.push({ id: result.id, origin: item.origin, scope });
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
    dead,
    notItems,
  };
}

function scopeForOrigin(origin) {
  const basename = String(origin).split('#')[0];
  const match = DEFAULT_FILES.find((file) => file.split('/').pop() === basename);
  return (match && SCOPE_BY_FILE[match]) || 'prod';
}
