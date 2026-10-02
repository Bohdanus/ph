import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Action, PublicAction, StoreDispatch } from '../StoreContext.tsx';

const srcDir = resolve(import.meta.dirname, '../..');
const forbiddenModules = ['replay-coordinator', 'materialization', 'replay-checkpoints'] as const;

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;

/**
 * The keyword before an import specifier is `from` or `import(` plus the whitespace
 * prettier leaves between them, so the lookback that decides it is bounded. Reading
 * the whole prefix instead makes masking a file quadratic in its length, which a
 * walk over every production module turns into minutes.
 */
const LOOKBEHIND = 512;

type SourceModule = Readonly<{ file: string; source: string }>;

type ForbiddenImport = Readonly<{ file: string; line: number; specifier: string }>;

function blankRange(output: string[], source: string, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
  }
}

function maskCommentsPreservingImportSpecifiers(source: string): string {
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
    const prefix = output
      .slice(Math.max(0, start - LOOKBEHIND), start)
      .join('')
      .replace(/\s+$/, '');
    const preserve = quote !== '`' && /(?:\bfrom|\bimport(?:\s*\()?)\s*$/.test(prefix);
    if (!preserve) blankRange(output, source, start + 1, end);
    index = Math.min(source.length, end + 1);
  }
  return output.join('');
}

function forbiddenImportSpecifiers(source: string): string[] {
  const masked = maskCommentsPreservingImportSpecifiers(source);
  const specifiers: string[] = [];
  for (const match of masked.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1];
    if (forbiddenModules.some((moduleName) => specifier.includes(moduleName))) specifiers.push(specifier);
  }
  return specifiers;
}

function sourceModulesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceModulesUnder(absolute));
    else if (/\.tsx?$/.test(entry.name)) found.push(absolute);
  }
  return found;
}

/**
 * A `__tests__` directory, a directory or file named `test`, a `*.test.*` /
 * `*.stories.*` file and an ambient `*.d.ts` are all test or declaration code: none
 * of them ships, and the first three import the forbidden chain deliberately —
 * `durable-compositor.refusal.test.ts` is the sole importer of `durable-compositor.ts`
 * — so including them would make every future test of this gate a violation of it.
 */
function isProductionModule(absolute: string): boolean {
  const segments = relative(srcDir, absolute).split(sep);
  const file = segments[segments.length - 1] ?? '';
  return (
    !segments.includes('__tests__') &&
    !segments.includes('test') &&
    !/\.test\.tsx?$/.test(file) &&
    !/\.stories\.tsx?$/.test(file) &&
    !file.endsWith('.d.ts')
  );
}

function productionModules(): string[] {
  return sourceModulesUnder(srcDir).filter(isProductionModule).sort();
}

function scanModules(modules: readonly SourceModule[]): ForbiddenImport[] {
  const violations: ForbiddenImport[] = [];
  for (const { file, source } of modules) {
    const masked = maskCommentsPreservingImportSpecifiers(source);
    for (const match of masked.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (!forbiddenModules.some((moduleName) => specifier.includes(moduleName))) continue;
      violations.push({ file, line: masked.slice(0, match.index).split('\n').length, specifier });
    }
  }
  return violations;
}

function forbiddenProductionImports(modules?: readonly SourceModule[]): ForbiddenImport[] {
  const walked =
    modules ??
    productionModules().map((absolute) => ({
      file: relative(srcDir, absolute),
      source: readFileSync(absolute, 'utf8'),
    }));
  return scanModules(walked);
}

const ALL_PUBLIC_ACTIONS: Record<PublicAction['type'], true> = {
  SET_HAS_IMAGE: true,
  SET_HAS_UNSAVED_CHANGES: true,
  SET_FILE_NAME: true,
  SET_ORIGINAL_IMAGE: true,
  SET_SIZE: true,
  SET_TOOL_NAME: true,
  SET_LAYERS: true,
  SET_ACTIVE_LAYER: true,
  ADD_LAYER: true,
  PROMOTE_LAYER_PRESENTATIONS: true,
  REORDER_LAYERS: true,
  BATCH_UPDATES: true,
  COMMIT_DOCUMENT_EDIT: true,
  APPLY_HISTORY_REPLAY: true,
  REPLACE_DOCUMENT: true,
  SET_DURABLE_STATUS: true,
  SET_COLOR: true,
  SET_BACKGROUND_COLOR: true,
  SET_SELECTIONS: true,
  ADD_SELECTION: true,
  COMMIT_SELECTION: true,
  UPDATE_SELECTION: true,
  MOVE_SELECTION: true,
  SET_ACTIVE_SELECTION: true,
  START_SELECTION_DRAFT: true,
  CANCEL_SELECTION_DRAFT: true,
  SET_SELECTION_CLIPBOARD: true,
  MARK_SELECTION_COPIED: true,
  CLEAR_SELECTIONS: true,
};

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;

describe('StoreContext boundary gates', () => {
  it('reports a forbidden module from any module, not only from StoreContext', () => {
    const knownBad = `
      // import { replay } from './replay-coordinator.ts';
      import { materialize } from './materialization.ts';
      export { checkpoint } from './replay-checkpoints.ts';
      import './replay-coordinator-side-effect.ts';
      const dynamic = import('./replay-coordinator.ts');
    `;
    expect(forbiddenImportSpecifiers(knownBad)).toEqual([
      './materialization.ts',
      './replay-checkpoints.ts',
      './replay-coordinator-side-effect.ts',
      './replay-coordinator.ts',
    ]);

    // The walk half, on modules other than StoreContext: this leg goes red if the
    // gate is ever narrowed back to one file, which is what it did before.
    expect(
      scanModules([
        { file: 'contexts/useLayer.ts', source: "import { useStore } from './StoreContext.tsx';\n" },
        { file: 'contexts/useHistory.ts', source: "export { materializeDocument } from './materialization.ts';\n" },
        {
          file: 'contexts/export-canvas.ts',
          source: "const checkpoints = import('./replay-coordinator.ts');\nvoid checkpoints;\n",
        },
      ])
    ).toEqual([
      { file: 'contexts/useHistory.ts', line: 1, specifier: './materialization.ts' },
      { file: 'contexts/export-canvas.ts', line: 1, specifier: './replay-coordinator.ts' },
    ]);
  });

  it('scans every production module rather than the one file the boundary used to name', () => {
    const scanned = productionModules().map((absolute) => relative(srcDir, absolute));

    expect(scanned).toContain('contexts/StoreContext.tsx');
    for (const module of [
      'contexts/useLayer.ts',
      'contexts/useHistory.ts',
      'contexts/useSelectionClipboard.ts',
      'contexts/layer-renderer.ts',
      'contexts/export-canvas.ts',
      'contexts/durable-compositor.ts',
      'util/selection.ts',
    ]) {
      expect(scanned).toContain(module);
    }

    expect(scanned.some((path) => path.split(sep).includes('__tests__'))).toBe(false);
    expect(scanned.some((path) => path.split(sep).includes('test'))).toBe(false);
    expect(scanned.some((path) => /\.test\.tsx?$/.test(path))).toBe(false);
    expect(scanned.some((path) => /\.stories\.tsx?$/.test(path))).toBe(false);
    expect(scanned.some((path) => path.endsWith('.d.ts'))).toBe(false);

    // A floor on the walk rather than a product threshold: it only trips if the
    // majority of production modules stop being classified as production.
    expect(scanned.length).toBeGreaterThan(200);
  });

  it('does not import retired replay/materialization modules from production source', () => {
    expect(forbiddenProductionImports()).toEqual([]);
  });

  it('keeps the public action union exhaustive and rejects internal actions', () => {
    const actionTypes = Object.keys(ALL_PUBLIC_ACTIONS) as PublicAction['type'][];
    expect(actionTypes).toHaveLength(29);
    expect(new Set(actionTypes).size).toBe(actionTypes.length);
    expect(ALL_PUBLIC_ACTIONS as Record<Action['type'], true>).toEqual(ALL_PUBLIC_ACTIONS);

    const actionUnionMatches: Equal<Action, PublicAction> = true;
    const dispatchUnionMatches: Equal<Parameters<StoreDispatch>[0], PublicAction> = true;
    expect(actionUnionMatches).toBe(true);
    expect(dispatchUnionMatches).toBe(true);

    const typeProbe = (dispatch: StoreDispatch): void => {
      // @ts-expect-error internal presentation publication is not a public store action
      dispatch({ type: 'PUBLISH_RUNTIME_PRESENTATION', payload: { layers: {} } });
      // @ts-expect-error internal bitmap adoption is not a public store action
      dispatch({ type: 'ADOPT_LAYER_BITMAPS', payload: { bitmaps: [] } });
    };
    void typeProbe;
  });
});
