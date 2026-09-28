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
import { SCOPE_BY_FILE } from '../lib/agent-board/handoff-import.mjs';
import { importDocuments, priorityOf } from '../lib/agent-board/import-wiring.mjs';

let dir;
const identity = { agentId: 'importer', kind: 'kilo', worktree: null, branch: 'chore/import' };
const boardFor = () => new Board({ dir, identity }).open();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-board-import-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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
  });

  it('takes no file locks for imported items', async () => {
    writeFileSync(join(dir, 'HANDOFF.md'), ['## 1. Something in a file', '', 'Fix `src/c.ts` now.', ''].join('\n'));
    const board = boardFor();
    await importDocuments({ board, files: ['HANDOFF.md'], cwd: dir });
    expect(board.locksHeldBy('importer')).toHaveLength(0);
  });

  /**
   * The documents state urgency in the heading, and priority is the column
   * `board ready` SORTS on. Every item arriving as `normal` meant the queue an
   * agent works from was in document order, not in order of damage.
   */
  it("reads the document's own P-level into the board's priority", () => {
    expect(priorityOf('P0 — the durable replay path has no production caller')).toBe('critical');
    expect(priorityOf('P1 — a real race in the flyout')).toBe('high');
    expect(priorityOf('P2 — an empty CDP capture')).toBe('normal');
    expect(priorityOf('P3 — a cosmetic edge')).toBe('low');
    // An unlabelled item is left alone rather than promoted or buried.
    expect(priorityOf('Item 12. Something in the adapter')).toBeNull();
    expect(priorityOf('A P0 somewhere in the prose')).toBeNull();
    expect(priorityOf(undefined)).toBeNull();
  });

  it('files a P0 item as critical, so ready puts it first', async () => {
    mkdirSync(join(dir, 'e2e'), { recursive: true });
    writeFileSync(
      join(dir, 'e2e/OPEN-PROBLEMS.md'),
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
    await importDocuments({ board, files: ['e2e/OPEN-PROBLEMS.md'], cwd: dir });
    expect(board.listIssues().map((issue) => issue.priority)).toEqual(['critical', 'normal']);
    expect(board.readyIssues().map((issue) => issue.title)).toEqual(['P0 — the worst thing', 'P2 — the smaller thing']);
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
