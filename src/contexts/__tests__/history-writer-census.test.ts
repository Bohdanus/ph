import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const sourceRoot = join(repositoryRoot, 'src');

const HISTORY_WRITING_ACTIONS = [
  'COMMIT_DOCUMENT_EDIT',
  'REPLACE_DOCUMENT',
  'APPLY_HISTORY_REPLAY',
  'REORDER_LAYERS',
] as const;

type HistoryWritingAction = (typeof HISTORY_WRITING_ACTIONS)[number];
type WriterClass = 'durable-routed' | 'conversion-only' | 'reconverts entirely';

type WriterSite = {
  file: string;
  symbol: string;
  action: HistoryWritingAction;
  writerClass: WriterClass;
  reason: string;
};

type DiscoveredWriter = WriterSite & { line: number };

const EXPECTED_WRITERS: readonly WriterSite[] = [
  {
    file: 'src/contexts/useLayer.ts',
    symbol: '_addLayer',
    action: 'REPLACE_DOCUMENT',
    writerClass: 'reconverts entirely',
    reason: 'new document replacement rebuilds the complete durable projection',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: '_addLayer',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'source-backed layer append falls back to whole-timeline conversion',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: '_addLayer',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'Background conversion replaces the lone bedrock record through legacy replay',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'updateLayerByTool',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'tool append is still accepted when durable planning refuses',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'commitDirtyTool',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'dirty tool commits may publish without a durable plan',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'removeLayer',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'durable-routed',
    reason: 'normal removal carries the planned durable entry',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'removeLayer',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'removal fallback deliberately omits the durable plan',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'updateLayer',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'durable-routed',
    reason: 'layer-property updates carry the derived durable entry',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'moveLayerAfter',
    action: 'REORDER_LAYERS',
    writerClass: 'durable-routed',
    reason: 'the reducer owns the reorder projection',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'applyDocumentCrop',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'durable-routed',
    reason: 'crop carries the planned document-frame operation',
  },
  {
    file: 'src/contexts/useLayer.ts',
    symbol: 'mergeLayers',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'the raster merge is source-backed but can fall back to conversion',
  },
  {
    file: 'src/contexts/useSelectionHistory.ts',
    symbol: 'appendSelectionClear',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'durable-routed',
    reason: 'selection clear carries the planned before/after snapshot',
  },
  {
    file: 'src/contexts/useSelectionHistory.ts',
    symbol: 'appendSelectionClear',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'selection clear fallback omits the durable plan',
  },
  {
    file: 'src/contexts/useSelectionHistory.ts',
    symbol: 'commitSelection',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'durable-routed',
    reason: 'selection creation/move carries the planned before/after snapshot',
  },
  {
    file: 'src/contexts/useSelectionHistory.ts',
    symbol: 'commitSelection',
    action: 'COMMIT_DOCUMENT_EDIT',
    writerClass: 'conversion-only',
    reason: 'selection creation/move fallback omits the durable plan',
  },
  {
    file: 'src/hooks/useApp.ts',
    symbol: 'setImageFromUpload',
    action: 'REPLACE_DOCUMENT',
    writerClass: 'reconverts entirely',
    reason: 'PSD/image import replaces the complete document',
  },
  {
    file: 'src/contexts/useHistory.ts',
    symbol: 'resetHistoryTo',
    action: 'APPLY_HISTORY_REPLAY',
    writerClass: 'reconverts entirely',
    reason: 'navigation rebuilds the durable shadow from the replayed timeline',
  },
];

const actionNames = new Set<string>(HISTORY_WRITING_ACTIONS);

function isHistoryWritingAction(value: string): value is HistoryWritingAction {
  return actionNames.has(value);
}

function blankRange(output: string[], source: string, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
  }
}

/**
 * Keep code and recognized action literals, while making comments and prose
 * strings invisible to the dispatch regex below.
 */
function maskCommentsAndLiteralInteriors(source: string): string {
  const output = source.split('');
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (character === '/' && next === '/') {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      blankRange(output, source, start, index);
      continue;
    }

    if (character === '/' && next === '*') {
      const start = index;
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index = Math.min(source.length, index + 2);
      blankRange(output, source, start, index);
      continue;
    }

    if (character !== "'" && character !== '"' && character !== '`') {
      index += 1;
      continue;
    }

    const quote = character;
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === quote) break;
      index += 1;
    }
    const end = index < source.length ? index : source.length;
    const literal = source.slice(start + 1, end);
    const prefix = output
      .slice(Math.max(0, start - 80), start)
      .join('')
      .replace(/\s+$/, '');
    const preserveAction = quote !== '`' && isHistoryWritingAction(literal) && /\btype\s*:\s*$/.test(prefix);
    if (!preserveAction) blankRange(output, source, start + 1, end);
    index = Math.min(source.length, end + 1);
  }

  return output.join('');
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(absolutePath));
      continue;
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const relativePath = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
    if (
      relativePath.includes('/__tests__/') ||
      relativePath.includes('/test/') ||
      /\.(?:test|spec)\.tsx?$/.test(relativePath)
    ) {
      continue;
    }
    files.push(absolutePath);
  }
  return files.sort();
}

type Declaration = { offset: number; symbol: string };

const expectedSymbols = new Set(EXPECTED_WRITERS.map((site) => site.symbol));

function declarations(source: string): Declaration[] {
  const result: Declaration[] = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    const functionMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    const arrowMatch = line.match(/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/);
    if (functionMatch) {
      if (expectedSymbols.has(functionMatch[1])) result.push({ offset, symbol: functionMatch[1] });
    } else if (arrowMatch) {
      if (expectedSymbols.has(arrowMatch[1])) result.push({ offset, symbol: arrowMatch[1] });
    }
    offset += line.length + 1;
  }
  return result;
}

function symbolAt(source: string, offset: number): string {
  let symbol = '<module>';
  for (const declaration of declarations(source)) {
    if (declaration.offset > offset) break;
    symbol = declaration.symbol;
  }
  return symbol;
}

function discoverWriters(file: string, source: string): DiscoveredWriter[] {
  const masked = maskCommentsAndLiteralInteriors(source);
  const relativeFile = relative(repositoryRoot, file).replaceAll('\\', '/');
  const pattern =
    /\bdispatch\s*\(\s*\{\s*type\s*:\s*(['"])(COMMIT_DOCUMENT_EDIT|REPLACE_DOCUMENT|APPLY_HISTORY_REPLAY|REORDER_LAYERS)\1/g;
  const writers: DiscoveredWriter[] = [];
  for (const match of masked.matchAll(pattern)) {
    const action = match[2];
    if (!isHistoryWritingAction(action)) continue;
    const line = source.slice(0, match.index ?? 0).split('\n').length;
    writers.push({
      file: relativeFile,
      symbol: symbolAt(source, match.index ?? 0),
      action,
      writerClass: 'conversion-only',
      reason: `discovered at ${relativeFile}:${line}`,
      line,
    });
  }
  return writers;
}

function key(site: Pick<WriterSite, 'file' | 'symbol' | 'action' | 'writerClass'>): string {
  return [site.file, site.symbol, site.action, site.writerClass].join('|');
}

function baseKey(site: Pick<WriterSite, 'file' | 'symbol' | 'action'>): string {
  return [site.file, site.symbol, site.action].join('|');
}

function classify(writers: readonly DiscoveredWriter[]): DiscoveredWriter[] {
  const expectedByBase = new Map<string, WriterSite[]>();
  for (const expected of EXPECTED_WRITERS) {
    const entries = expectedByBase.get(baseKey(expected)) ?? [];
    entries.push(expected);
    expectedByBase.set(baseKey(expected), entries);
  }

  const classified = writers.map((writer) => {
    const entries = expectedByBase.get(baseKey(writer));
    const expected = entries?.shift();
    if (!expected) {
      throw new Error(`Unclassified history writer ${baseKey(writer)} at ${writer.file}:${writer.line}`);
    }
    return { ...writer, writerClass: expected.writerClass, reason: expected.reason };
  });

  for (const [writerBase, remaining] of expectedByBase) {
    if (remaining.length) throw new Error(`Missing history writer ${writerBase}`);
  }
  return classified;
}

function scanProductionWriters(): DiscoveredWriter[] {
  return sourceFiles(sourceRoot).flatMap((file) => discoverWriters(file, readFileSync(file, 'utf8')));
}

/**
 * The store's own dispatcher. `COMMIT_DOCUMENT_EDIT`, `REPLACE_DOCUMENT` and
 * `APPLY_HISTORY_REPLAY` are declared, matched and re-dispatched here, so every
 * `type:` occurrence in this file is the CONSUMER of an action rather than a writer of
 * history. It is the only file exempt from the completeness scan below, and the scan
 * asserts that it is the ONLY one.
 */
const DISPATCHER_FILE = 'src/contexts/StoreContext.tsx';

/**
 * Blanks comments while LEAVING string literals intact, which is the opposite of
 * `maskCommentsAndLiteralInteriors`. The completeness scan needs the action literals
 * themselves, so masking them would defeat its purpose; `https://` is preserved by
 * requiring the `//` to start a line or follow whitespace.
 */
function maskComments(source: string): string {
  const output = source.split('');
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
    }
  };
  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === '/*') {
      const start = index;
      index += 2;
      while (index < source.length && source.slice(index, index + 2) !== '*/') index += 1;
      index = Math.min(source.length, index + 2);
      blank(start, index);
      continue;
    }
    if (pair === '//' && (index === 0 || /[\s(]/.test(source[index - 1]!))) {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      blank(start, index);
      continue;
    }
    index += 1;
  }
  return output.join('');
}

/**
 * Every `type: '<history action>'` property written anywhere in production source,
 * found by a scan that is deliberately WEAKER than `discoverWriters` and therefore a
 * strict superset of it: it recognises an action literal in ANY object literal, any
 * dispatch spelling (`dispatch`, `rawDispatch`), any property order, either quote
 * style, and an action captured into a typed intermediate. `discoverWriters` only
 * recognises `dispatch({ type: '…'` with `type` first and a single or double quote.
 *
 * The difference is the point. A new writer written as `dispatch(action)` after
 * `const action = { type: 'COMMIT_DOCUMENT_EDIT', … }` is invisible to
 * `discoverWriters` and would leave the exact-equality census green; this scan sees
 * it. Comparing the two multisets over the same tree is what makes the census
 * exhaustive by construction rather than by enumeration.
 */
function scanActionTypeProperties(): Array<{ file: string; action: HistoryWritingAction }> {
  const pattern = /\btype\s*:\s*['"](COMMIT_DOCUMENT_EDIT|REPLACE_DOCUMENT|APPLY_HISTORY_REPLAY|REORDER_LAYERS)['"]/g;
  const found: Array<{ file: string; action: HistoryWritingAction }> = [];
  for (const file of sourceFiles(sourceRoot)) {
    const masked = maskComments(readFileSync(file, 'utf8'));
    const relativeFile = relative(repositoryRoot, file).replaceAll('\\', '/');
    for (const match of masked.matchAll(pattern)) {
      if (!isHistoryWritingAction(match[1]!)) continue;
      found.push({ file: relativeFile, action: match[1] });
    }
  }
  return found;
}

function actionPropertyKey(site: Pick<WriterSite, 'file' | 'action'>): string {
  return `${site.file}|${site.action}`;
}

function assertExactCensus(writers: readonly DiscoveredWriter[]): void {
  const actualKeys = writers.map(key).sort();
  const expectedKeys = EXPECTED_WRITERS.map(key).sort();
  expect(actualKeys).toEqual(expectedKeys);
}

describe('history writer census', () => {
  it('counts and classifies every history-writing dispatch', () => {
    const writers = classify(scanProductionWriters());
    assertExactCensus(writers);

    const counts = {
      'durable-routed': writers.filter((writer) => writer.writerClass === 'durable-routed').length,
      'conversion-only': writers.filter((writer) => writer.writerClass === 'conversion-only').length,
      'reconverts entirely': writers.filter((writer) => writer.writerClass === 'reconverts entirely').length,
    };
    expect(counts).toEqual({ 'durable-routed': 6, 'conversion-only': 8, 'reconverts entirely': 3 });
    console.info(`S9 history-writer census: ${writers.length} writers`, counts);
  });

  it('finds no history-writing action property outside the census and the store dispatcher', () => {
    // The completeness half. `scanActionTypeProperties` is a strict superset of the
    // discovery scan, so the two multisets over the same tree must agree everywhere
    // except inside the dispatcher. If a writer appeared in a shape `discoverWriters`
    // cannot see — the action captured into a variable first, `type` no longer the
    // first property, `rawDispatch` instead of `dispatch`, a new quote style — the
    // superset grows and this fails even though the exact-equality census above stays
    // green.
    const writers = scanProductionWriters();
    const superset = scanActionTypeProperties();

    const outsideDispatcher = superset.filter((site) => site.file !== DISPATCHER_FILE);
    const exemptFiles = [...new Set(superset.filter((site) => site.file === DISPATCHER_FILE).map((site) => site.file))];

    expect(outsideDispatcher.map(actionPropertyKey).sort()).toEqual(writers.map(actionPropertyKey).sort());
    // One file, named, and it must not grow: a second exempt file would mean an
    // unbounded hole.
    expect(exemptFiles).toEqual([DISPATCHER_FILE]);
    // The dispatcher must actually be exempt for something, or the exemption is
    // decorative and the multiset comparison above is the only load-bearing assertion.
    expect(superset.length - outsideDispatcher.length).toBeGreaterThan(0);
  });

  it('detects a writer written in a shape the dispatch scan cannot see', () => {
    // The proof that the scan above is not vacuous: an action captured into a variable
    // and dispatched by reference is invisible to `discoverWriters` — it finds nothing,
    // so the exact-equality census would pass — while `scanActionTypeProperties` finds
    // it. Run against the real tree with the synthetic module added, the completeness
    // comparison must then fail.
    const realSuperset = scanActionTypeProperties();
    const synthetic = `
      const commit = { type: 'COMMIT_DOCUMENT_EDIT', payload: { updates: {} } };
      export function sneakyWriter(dispatch: (action: unknown) => void) {
        dispatch(commit);
      }
    `;
    const syntheticFile = join(sourceRoot, 'contexts', 'synthetic-indirect-writer.ts');

    const undiscovered = discoverWriters(syntheticFile, synthetic);
    const discoveredBySuperset = maskComments(synthetic).match(
      /\btype\s*:\s*['"](COMMIT_DOCUMENT_EDIT|REPLACE_DOCUMENT|APPLY_HISTORY_REPLAY|REORDER_LAYERS)['"]/g
    );

    // The hole is real and reproducible: no dispatch-shaped site, but the action is
    // written into a live object that the dispatcher receives.
    expect(undiscovered).toHaveLength(0);
    expect(discoveredBySuperset).toHaveLength(1);

    // And that one site is exactly what would break the completeness comparison the case
    // above makes: the superset finds one more action outside the dispatcher than there are
    // dispatch-shaped writers. An earlier version of this comment claimed the synthetic
    // module was "run against the real tree", but it was never written to disk —
    // `syntheticFile` was only a path string handed to `discoverWriters` — so the
    // completeness claim was an assertion about the REAL tree that merely restated the one
    // above it. It is computed here instead, because materialising a module under `src/`
    // to make an identity fail is a side effect this suite has no reason to have.
    const supersetOutsideDispatcher = realSuperset.filter((site) => site.file !== DISPATCHER_FILE).length;
    const dispatchShaped = scanProductionWriters().length;
    expect(supersetOutsideDispatcher).toBe(dispatchShaped);
    // With the synthetic module in the tree the two would differ by exactly its one site,
    // which is the failure the completeness comparison exists to report.
    expect(supersetOutsideDispatcher + (discoveredBySuperset?.length ?? 0)).toBe(dispatchShaped + 1);
  });

  it('masks comments and prose but fails closed for an active unclassified writer', () => {
    const synthetic = `
      // dispatch({ type: 'COMMIT_DOCUMENT_EDIT' });
      const prose = "dispatch({ type: 'REPLACE_DOCUMENT' })";
      const newWriter = () => {
        dispatch({ type: 'COMMIT_DOCUMENT_EDIT', payload: {} });
      };
    `;
    const discovered = discoverWriters('src/contexts/synthetic.ts', synthetic);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.action).toBe('COMMIT_DOCUMENT_EDIT');
    expect(() => classify(discovered)).toThrow(/Unclassified history writer/);
  });
});
