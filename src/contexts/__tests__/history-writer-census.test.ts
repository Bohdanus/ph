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
