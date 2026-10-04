import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Action, PublicAction, StoreDispatch } from '../StoreContext.tsx';

const srcDir = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(srcDir, '..');
const forbiddenModules = ['replay-budget', 'replay-coordinator', 'replay-checkpoints'] as const;
const materializationModule = 'materialization';

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;

/**
 * The keyword before an import specifier is `from` or `import(` plus the whitespace
 * prettier leaves between them, so the lookback that decides it is bounded. Reading
 * the whole prefix instead makes masking a file quadratic in its length, which a
 * walk over every production module turns into minutes.
 */
const LOOKBEHIND = 512;

/**
 * The forbidden set is matched on the specifier's BASENAME, not by substring.
 *
 * A substring test cannot tell `./materialization.ts` from a sibling that merely
 * shares the stem — `./materialization-utils.ts`, `./my-materialization.ts` — so it
 * reports a violation in a file that imports nothing forbidden. Widening the walk
 * from one file to every production module multiplies the blast radius of that
 * false positive by the size of `src/`, so the comparison is against the exact
 * basename with or without its extension.
 */
function isForbiddenSpecifier(specifier: string): boolean {
  const tail = specifier.split('/').pop() ?? '';
  const stem = tail.replace(/\.[cm]?[jt]sx?$/, '');
  return (forbiddenModules as readonly string[]).includes(stem);
}

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
    if (isForbiddenSpecifier(specifier)) specifiers.push(specifier);
  }
  return specifiers;
}

function sourceModulesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    // `isFile()` is load-bearing rather than defensive: a DIRECTORY named `foo.ts`
    // takes the `else` branch on the extension test and `readFileSync` throws EISDIR,
    // which fails the run as an error instead of as a clean skip.
    if (entry.isDirectory()) found.push(...sourceModulesUnder(absolute));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(absolute);
  }
  return found;
}

/**
 * A `__tests__` directory, a directory or file named `test`, a `*.test.*` /
 * `*.spec.*` / `*.stories.*` file and an ambient `*.d.ts` are all test or declaration
 * code: none of them ships, and the first three import the forbidden chain
 * deliberately — `durable-compositor.refusal.test.ts` is the sole importer of
 * `durable-compositor.ts` — so including them would make every future test of this
 * gate a violation of it. `*.spec.*` is excluded to match the census convention at
 * `history-writer-census.test.ts:227`, which uses `/\.(?:test|spec)\.tsx?$/`; the two
 * lists must not drift apart, because a `.spec.ts` outside `__tests__` would otherwise
 * be classified differently by the two.
 */
function isProductionModule(repoRelativePath: string): boolean {
  const segments = repoRelativePath.split('/');
  const file = segments[segments.length - 1] ?? '';
  return (
    !segments.includes('__tests__') &&
    !segments.includes('test') &&
    !/\.(?:test|spec)\.tsx?$/.test(file) &&
    !/\.stories\.tsx?$/.test(file) &&
    !file.endsWith('.d.ts')
  );
}

/**
 * Every tracked production module, as repo-relative POSIX paths.
 *
 * `src/` is not the whole of it: `tsconfig.app.json:43` puts `toolbar-mapping.ts` in
 * the app's `include` beside `src`, and four components import it
 * (`DesktopHeader.tsx:12`, `SidebarLeft.tsx:16`, `MobileToolSheet.tsx:7`,
 * `mobile-tools.ts:1`). A walk rooted only at `src/` therefore cannot see a forbidden
 * import in a file that is as much production source as any of them, and the gate would
 * report `src/` while implying the repository.
 */
function trackedProductionModules(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', 'src', 'toolbar-mapping.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return listed
    .split('\0')
    .filter((path) => path.length > 0 && /\.tsx?$/.test(path))
    .filter(isProductionModule)
    .sort();
}

function walkedProductionModules(): string[] {
  return [
    ...sourceModulesUnder(srcDir).map((absolute) => relative(repoRoot, absolute).split(sep).join('/')),
    'toolbar-mapping.ts',
  ]
    .filter(isProductionModule)
    .filter((path) => {
      try {
        readFileSync(join(repoRoot, path), 'utf8');
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

function scanModules(modules: readonly SourceModule[]): ForbiddenImport[] {
  const violations: ForbiddenImport[] = [];
  for (const { file, source } of modules) {
    const masked = maskCommentsPreservingImportSpecifiers(source);
    for (const match of masked.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (!isForbiddenSpecifier(specifier)) continue;
      violations.push({ file, line: masked.slice(0, match.index).split('\n').length, specifier });
    }
  }
  return violations;
}

function forbiddenProductionImports(modules?: readonly SourceModule[]): ForbiddenImport[] {
  const walked =
    modules ??
    walkedProductionModules().map((path) => ({
      file: path,
      source: readFileSync(join(repoRoot, path), 'utf8'),
    }));
  return scanModules(walked);
}

function materializationProductionImports(modules?: readonly SourceModule[]): ForbiddenImport[] {
  const walked =
    modules ??
    walkedProductionModules().map((path) => ({
      file: path,
      source: readFileSync(join(repoRoot, path), 'utf8'),
    }));
  const imports: ForbiddenImport[] = [];
  for (const { file, source } of walked) {
    const masked = maskCommentsPreservingImportSpecifiers(source);
    for (const match of masked.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      const tail = specifier.split('/').pop() ?? '';
      if (tail.replace(/\.[cm]?[jt]sx?$/, '') !== materializationModule) continue;
      imports.push({ file, line: masked.slice(0, match.index).split('\n').length, specifier });
    }
  }
  return imports;
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

/**
 * The two `InternalAction` types. They are not exported, so the record above
 * cannot reach them, and a census that stopped at the public 29 would pass over
 * exactly the arms nothing in production dispatches.
 */
const INTERNAL_ACTION_TYPES = ['PUBLISH_RUNTIME_PRESENTATION', 'ADOPT_LAYER_BITMAPS'] as const;

/**
 * The reducer's own body, sliced out of the module source.
 *
 * Bounded by the signature and the first column-zero `}` after it, because every
 * brace inside the function is indented and the function's own is not. Reading
 * the whole module instead would sweep the dispatcher's seven `action.type ===`
 * intercepts into the same set, which is a different question and one the
 * dispatcher already answers with a test of its own.
 */
function reducerSource(): string {
  const source = readFileSync(join(srcDir, 'contexts/StoreContext.tsx'), 'utf8');
  const start = source.indexOf('function reducer(state: StoreData, action: StoreAction): StoreData {');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('StoreContext boundary gates', () => {
  it('reports a forbidden module from any module, not only from StoreContext', () => {
    const knownBad = `
      // import { replay } from './replay-coordinator.ts';
      import { materialize } from './materialization.ts';
      export { checkpoint } from './replay-checkpoints.ts';
      import './replay-checkpoints.ts';
      const dynamic = import('./replay-coordinator.ts');
    `;
    expect(forbiddenImportSpecifiers(knownBad)).toEqual([
      './replay-checkpoints.ts',
      './replay-checkpoints.ts',
      './replay-coordinator.ts',
    ]);

    // And the lookalikes the substring test could not tell apart. Both import something
    // real, neither imports anything forbidden, and a stem-sharing gate would report both
    // as violations — which, over a walk of every production module, is a gate that goes
    // red for no reason the moment somebody names a helper after one of these.
    expect(
      forbiddenImportSpecifiers(`
        import { bounds } from './materialization-utils.ts';
        import { mine } from './my-materialization.ts';
        import { checkpoint } from '../replay-checkpoints/index.ts';
      `)
    ).toEqual([]);

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
    ).toEqual([{ file: 'contexts/export-canvas.ts', line: 1, specifier: './replay-coordinator.ts' }]);
  });

  it('scans every production module rather than the one file the boundary used to name', () => {
    const scanned = walkedProductionModules();

    expect(scanned).toContain('toolbar-mapping.ts');
    expect(scanned).toContain('src/contexts/StoreContext.tsx');
    for (const module of [
      'src/contexts/useLayer.ts',
      'src/contexts/useHistory.ts',
      'src/contexts/useSelectionClipboard.ts',
      'src/contexts/layer-renderer.ts',
      'src/contexts/export-canvas.ts',
      'src/contexts/durable-compositor.ts',
      'src/util/selection.ts',
    ]) {
      expect(scanned).toContain(module);
    }

    expect(scanned.some((path) => path.split(sep).includes('__tests__'))).toBe(false);
    expect(scanned.some((path) => path.split(sep).includes('test'))).toBe(false);
    expect(scanned.some((path) => /\.(?:test|spec)\.tsx?$/.test(path))).toBe(false);
    expect(scanned.some((path) => /\.stories\.tsx?$/.test(path))).toBe(false);
    expect(scanned.some((path) => path.endsWith('.d.ts'))).toBe(false);
  });

  it('reads every module git tracks as production, so the walk cannot quietly narrow', () => {
    // The equality IS the coverage assertion. A floor on the walk's length only trips
    // if MOST modules stop being classified as production — at 282 files a reclassification
    // of 82 would still pass — and it says nothing at all about a file that is tracked and
    // present but never reached. Comparing the walked set against `git ls-files` closes
    // both: a module the walk skips fails here, and a file on disk that git does not track
    // (an untracked leftover, a generated module) fails here too, so this cannot pass while
    // reading something CI will never compile.
    //
    // `tsconfig.app.json:43` is the other end of the same question — CI already asserts
    // every tracked `.ts`/`.tsx` is inside some project's `include` — but that asks about
    // TYPE coverage. This asks whether the file is READ by the gate, which is a different
    // question and the one that was blind.
    expect(walkedProductionModules()).toEqual(trackedProductionModules());
  });

  // The forbidden set contains retired coordination and budget modules — `replay-budget`,
  // `replay-coordinator`, and `replay-checkpoints`. `materialization.ts` is intentionally excluded: the durable compositor
  // is its one allowed production boundary. `presentation-evaluator.ts` is imported
  // by production on purpose (`layer-renderer.ts:14`, `useLayer.ts:54`,
  // `materialization.ts:14`), and `durable-replay.ts` is read as a value at
  // `StoreContext.tsx:41`, so adding either would make this red on correct code.
  it('keeps retired replay coordination modules out of production source', () => {
    expect(forbiddenProductionImports()).toEqual([]);
  });

  it('routes production durable materialization only through the compositor boundary', () => {
    expect(materializationProductionImports().map(({ file, specifier }) => ({ file, specifier }))).toEqual([
      { file: 'src/contexts/durable-compositor.ts', specifier: './materialization.ts' },
    ]);
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

  it('names a reducer arm for every action type instead of relying on an untyped default', () => {
    const source = reducerSource();
    const arms = [...source.matchAll(/^ {4}case '([A-Z_]+)':/gm)].map((match) => match[1] as string);

    // The census is over LABELS, not over behaviour, so it is the one assertion
    // that survives an arm being deleted and re-added as a differently-shaped one:
    // a type with no label at all is the defect, whatever the arm does.
    expect([...arms].sort()).toEqual([...Object.keys(ALL_PUBLIC_ACTIONS), ...INTERNAL_ACTION_TYPES].sort());

    // And the census only means something if the switch cannot accept a type it
    // does not name. The `never` guard is what makes an unarmed action a typecheck
    // error; a plain `default: return state` would leave the set above passing while
    // every action added after it silently no-ops. Both halves are asserted
    // because either alone is defeatable: the label set without the guard is
    // satisfied by an untyped default, and the guard without the set would not
    // notice an arm removed by widening the discriminant.
    expect(source).toContain('const _exhaustive: never = action;');
    expect(source).not.toMatch(/default:\s*\n\s*return state;/);
  });
});
