/**
 * The import's board-facing half: a handoff document becomes issues on the
 * board, once, keyed on the document's own numbering.
 *
 * The parser's own tests live next to it, against the real documents; what is
 * pinned here is the part that writes: that a second run files nothing, that an
 * item the document has already deleted as closed never reaches the board, and
 * that importing does not quietly take a lease on every file it mentions.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board } from '../lib/agent-board/db.mjs';
import { SCOPE_BY_FILE } from '../lib/agent-board/handoff-import.mjs';
import { importDocuments } from '../lib/agent-board/import-wiring.mjs';

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
});
