/**
 * The import's board-facing half: a handoff document becomes issues on the
 * board, once, keyed on the document's own numbering.
 *
 * The parser's own tests live next to it, against the real documents; what is
 * pinned here is the part that writes: that a second run files nothing, that an
 * item the document has already deleted as closed never reaches the board, and
 * that importing does not quietly take a lease on every file it mentions.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board } from '../lib/agent-board/db.mjs';
import { SCOPE_BY_FILE, parseHandoffDoc, planImport } from '../lib/agent-board/handoff-import.mjs';
import { priorityFromTitle } from '../lib/agent-board/db.mjs';
import { importDocuments } from '../lib/agent-board/import-wiring.mjs';

let dir;
const identity = { agentId: 'importer', kind: 'kilo', worktree: null, branch: 'chore/import' };
const openBoards = [];
const boardFor = () => {
  const board = new Board({ dir, identity }).open();
  openBoards.push(board);
  return board;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-board-import-'));
});

afterEach(() => {
  while (openBoards.length > 0) {
    const board = openBoards.pop();
    try {
      board?.close();
    } catch {
      /* best-effort close before directory removal */
    }
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('the import of the handoff documents', () => {
  it("files a document's items once, and nothing on a second run", async () => {
    writeFileSync(
      join(dir, 'HANDOFF.md'),
      [
        '# Handoff',
        '',
        '## 1. First open item',
        '',
        'The file `src/a.ts` needs this.',
        '',
        '## 2. Second open item',
        '',
        'It depends on `src/b.ts`.',
        '',
        '## 3, 4. — deleted',
        '',
        'These two are already fixed.',
        '',
      ].join('\n')
    );
    const first = await importDocuments({
      board: boardFor(),
      files: ['HANDOFF.md'],
      cwd: dir,
    });
    expect(SCOPE_BY_FILE['HANDOFF.md']).toBe('history');
    const second = await importDocuments({
      board: boardFor(),
      files: ['HANDOFF.md'],
      cwd: dir,
    });
    expect(second.created).toHaveLength(0);
    expect(
      boardFor()
        .listIssues()
        .map((issue) => issue.origin)
        .sort()
    ).toEqual(['HANDOFF.md#1', 'HANDOFF.md#2']);
    expect(first.dead).toContain('HANDOFF.md#3');
    expect(first.dead).toContain('HANDOFF.md#4');
    expect(first.retired).toEqual([]);
  });

  it('reports existing board issues whose document entries were retired', async () => {
    writeFileSync(join(dir, 'HANDOFF.md'), ['## 1. A live item', '', 'Body.', ''].join('\n'));
    const board = boardFor();
    await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    const issue = board.listIssues()[0];

    writeFileSync(join(dir, 'HANDOFF.md'), ['### Items 1 — deleted', '', 'Fixed.', ''].join('\n'));
    const result = await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });

    expect(result.dead).toEqual(['HANDOFF.md#1']);
    expect(result.retired).toEqual([{ origin: 'HANDOFF.md#1', id: issue.id }]);
    expect(board.getIssue(issue.id).status).toBe('open');
  });

  it('reports duplicate headings and leaves their ambiguous origin unfiled', async () => {
    writeFileSync(
      join(dir, 'HANDOFF.md'),
      ['## 79. First entry', '', 'First body.', '', '## 79. Second entry', '', 'Second body.'].join('\n')
    );
    const board = boardFor();
    const result = await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });

    expect(result.duplicates).toEqual(['HANDOFF.md#79']);
    expect(result.created).toEqual([]);
    expect(board.listIssues()).toHaveLength(0);
  });

  it('refuses the entire import when a numbered status heading is ambiguous', async () => {
    writeFileSync(
      join(dir, 'HANDOFF.md'),
      [
        '## 1. A valid item',
        '',
        'Body.',
        '',
        '## 31. The dialog-closed assertion is fixed',
        '',
        'It is still open work.',
      ].join('\n')
    );
    const board = boardFor();

    await expect(importDocuments({ board, files: ['HANDOFF.md'], cwd: dir })).rejects.toThrow(
      /HANDOFF\.md:5 \(HANDOFF\.md#31\).*dialog-closed assertion is fixed/
    );
    expect(board.listIssues()).toHaveLength(0);
  });

  it('refuses the entire import when a numbered heading has an unsupported letter suffix', async () => {
    writeFileSync(
      join(dir, 'HANDOFF.md'),
      ['## 15a. An old item — deleted', '', 'It must not become item 15.', ''].join('\n')
    );
    const board = boardFor();

    await expect(importDocuments({ board, files: ['HANDOFF.md'], cwd: dir })).rejects.toThrow(
      /letter suffixes have no supported origin[\s\S]*HANDOFF\.md:1/
    );
    expect(board.listIssues()).toHaveLength(0);
    expect(board.events()).toHaveLength(0);
  });

  it('takes no file locks for imported items', async () => {
    writeFileSync(join(dir, 'HANDOFF.md'), ['## 1. Something in a file', '', 'Fix `src/c.ts` now.', ''].join('\n'));
    const board = boardFor();
    await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    expect(board.locksHeldBy('importer')).toHaveLength(0);
  });

  /**
   * The documents state urgency in the heading, and priority is the column
   * `swarm ready` SORTS on. Every item arriving as `normal` meant the queue an
   * agent works from was in document order, not in order of damage.
   */
  it("reads the document's own P-level into the board's priority", () => {
    expect(priorityFromTitle('P0 — the durable replay path has no production caller')).toBe('critical');
    expect(priorityFromTitle('P1 — a real race in the flyout')).toBe('high');
    expect(priorityFromTitle('P2 — an empty CDP capture')).toBe('normal');
    expect(priorityFromTitle('P3 — a cosmetic edge')).toBe('low');
    // An unlabelled item is left alone rather than promoted or buried.
    expect(priorityFromTitle('Item 12. Something in the adapter')).toBeNull();
    expect(priorityFromTitle('A P0 somewhere in the prose')).toBeNull();
    expect(priorityFromTitle(undefined)).toBeNull();
  });

  it('files a P0 item as critical, so ready puts it first', async () => {
    mkdirSync(join(dir, 'e2e'), { recursive: true });
    writeFileSync(
      join(dir, 'e2e/OPEN_PROBLEMS.md'),
      [
        '## P2 — the smaller thing',
        '',
        'It is in `src/small.ts`.',
        '',
        '## P0 — the worst thing',
        '',
        'It is in `src/urgent.ts`.',
        '',
      ].join('\n')
    );
    const board = boardFor();
    await importDocuments({ board, files: ['e2e/OPEN_PROBLEMS.md'], cwd: dir });
    expect(board.listIssues().map((issue) => issue.priority)).toEqual(['critical', 'normal']);
    expect(board.readyIssues().map((issue) => issue.title)).toEqual(['P0 — the worst thing', 'P2 — the smaller thing']);
  });

  it('matches retired issues from subdirectory documents by their stored basename origin', async () => {
    mkdirSync(join(dir, 'e2e'), { recursive: true });
    writeFileSync(join(dir, 'e2e/OPEN_PROBLEMS.md'), ['## 1. A live problem', '', 'Body.', ''].join('\n'));
    const board = boardFor();
    await importDocuments({ board, files: ['e2e/OPEN_PROBLEMS.md'], cwd: dir });
    const issue = board.listIssues()[0];
    expect(issue.origin).toBe('OPEN_PROBLEMS.md#1');

    writeFileSync(join(dir, 'e2e/OPEN_PROBLEMS.md'), ['### Items 1 — deleted', '', 'Fixed.', ''].join('\n'));
    const result = await importDocuments({ board, files: ['e2e/OPEN_PROBLEMS.md'], cwd: dir });

    expect(result.dead).toEqual(['OPEN_PROBLEMS.md#1']);
    expect(result.retired).toEqual([{ origin: 'OPEN_PROBLEMS.md#1', id: issue.id }]);
  });

  /**
   * HANDOFF.md's section 0 is a PREAMBLE an agent reads before the problem
   * list, and no parser can tell a numbered section from a numbered defect.
   * The exclusion is a named origin, and nothing referenced it: renumbering
   * the preamble would have filed the whole branch-state section as a defect
   * with no test to notice.
   */
  it('excludes the named non-items, and reports which they were', async () => {
    writeFileSync(
      join(dir, 'HANDOFF.md'),
      [
        '## 0. Branch state — read this first',
        '',
        'The worktree is on feat/x.',
        '',
        '## 1. A real defect',
        '',
        'It is in `src/real.ts`.',
        '',
      ].join('\n')
    );
    const board = boardFor();
    const result = await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    expect(result.notItems).toEqual(['HANDOFF.md#0']);
    expect(board.listIssues().map((issue) => issue.origin)).toEqual(['HANDOFF.md#1']);
  });
  /**
   * The drift tests that would have caught a deleted feature.
   *
   * The whole drift mechanism could be deleted from `planImport` and the suite
   * stayed green, because every call site in it passed `[]`, a `Set`, or `null` —
   * never the Map the import actually builds. These call it the way the import
   * does, with the shape the decision depends on.
   */
  it('separates an unchanged item from a renumbered one, given origin to title', () => {
    const same = parseHandoffDoc({ file: 'HANDOFF.md', text: '## 2. Alpha defect\n\nbody\n' });
    const replaced = parseHandoffDoc({
      file: 'HANDOFF.md',
      text: '## 2. A different defect entirely\n\nbody\n',
    });
    const known = new Map([['HANDOFF.md#2', 'Alpha defect']]);
    const unchanged = planImport([same], known);
    expect(unchanged.create).toEqual([]);
    expect(unchanged.skip).toEqual(['HANDOFF.md#2']);
    expect(unchanged.drift).toEqual([]);
    const renumbered = planImport([replaced], known);
    // NOT filed as a new issue: the board already has that origin, and filing it
    // again would duplicate a live defect.
    expect(renumbered.create).toEqual([]);
    expect(renumbered.drift).toEqual(['HANDOFF.md#2']);
  });

  it('reports the drift and records it when the document renumbers an item', async () => {
    writeFileSync(join(dir, 'HANDOFF.md'), ['## 2. Alpha defect', '', 'body', ''].join('\n'));
    const board = boardFor();
    await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    writeFileSync(join(dir, 'HANDOFF.md'), ['## 2. A different defect', '', 'body', ''].join('\n'));
    const second = await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    expect(second.drifted).toEqual(['HANDOFF.md#2']);
    expect(second.created).toEqual([]);
    // Recorded, and NOT auto-corrected: the board's copy of a defect is only
    // replaced by an agent that has read both documents.
    expect(board.events({ kind: 'origin.drift' })).toHaveLength(1);
    expect(board.listIssues()[0].title).toBe('Alpha defect');
  });

  it('does not re-record a drift nobody has acted on', async () => {
    writeFileSync(join(dir, 'HANDOFF.md'), ['## 2. Alpha defect', '', 'body', ''].join('\n'));
    const board = boardFor();
    await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    writeFileSync(join(dir, 'HANDOFF.md'), ['## 2. Reworded defect', '', 'body', ''].join('\n'));
    for (let run = 0; run < 4; run += 1) {
      await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    }
    // An unbounded log entry about a thing nobody is acting on is how a signal
    // stops being read. One disagreement is one event.
    expect(board.events({ kind: 'origin.drift' })).toHaveLength(1);
  });

  it('sees through a cosmetic rewording, which is not a different defect', () => {
    const board = boardFor();
    const first = board.createIssue({ title: 'P0 — the durable path', origin: 'HANDOFF.md#3' });
    // A hyphen for an em-dash, a trailing period, doubled spaces.
    for (const rewrite of ['P0 - the durable path', 'P0 — the durable path.', 'P0 — the  durable   path']) {
      expect(board.createIssue({ title: rewrite, origin: 'HANDOFF.md#3' }).drift, rewrite).toBe(false);
    }
    expect(board.events({ kind: 'origin.drift' })).toHaveLength(0);
    expect(board.getIssue(first.id).title).toBe('P0 — the durable path');
  });
  it('records the files an item is about, so `ready` can show them', async () => {
    writeFileSync(
      join(dir, 'HANDOFF.md'),
      ['## 1. Needs two files', '', 'Touches `src/a.ts` and `src/b.ts`.', ''].join('\n')
    );
    const board = boardFor();
    await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    const { id } = board.listIssues()[0];
    expect(board.issueFiles(id)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
