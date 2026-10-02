import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Action, PublicAction, StoreDispatch } from '../StoreContext.tsx';

const srcDir = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(srcDir, '..');
const forbiddenModules = ['replay-coordinator', 'materialization', 'replay-checkpoints'] as const;

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
      import './replay-checkpoints.ts';
      const dynamic = import('./replay-coordinator.ts');
    `;
    expect(forbiddenImportSpecifiers(knownBad)).toEqual([
      './materialization.ts',
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
    ).toEqual([
      { file: 'contexts/useHistory.ts', line: 1, specifier: './materialization.ts' },
      { file: 'contexts/export-canvas.ts', line: 1, specifier: './replay-coordinator.ts' },
    ]);
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

  // The forbidden set is unchanged and correct — `replay-coordinator`, `materialization`,
  // `replay-checkpoints` — and must stay that way: `presentation-evaluator.ts` is imported
  // by production on purpose (`layer-renderer.ts:14`, `useLayer.ts:54`,
  // `materialization.ts:14`), and `durable-replay.ts` is read as a value at
  // `StoreContext.tsx:41`, so adding either would make this red on correct code.
  it('has no forbidden production import beyond the one §177 tracks', () => {
    // The companion the expected failure cannot be. `it.fails` says only "at least one
    // violation exists", so a SECOND violation added anywhere — including in
    // `toolbar-mapping.ts`, which no earlier version of this gate could read — leaves it
    // green and is therefore invisible. This leg is a plain assertion with no expected
    // failure in it: it passes today because there is exactly one violation, and it turns
    // red the moment there are two, which is the shape that actually needs fixing.
    //
    // It is keyed on file, line and specifier because that is what §177 records, so the
    // entry and the gate cannot disagree about which violation is the known one.
    const trackedInSection177 = ['src/contexts/durable-compositor.ts:4:./materialization.ts'];
    const untracked = forbiddenProductionImports().filter(
      (violation) => !trackedInSection177.includes(`${violation.file}:${violation.line}:${violation.specifier}`)
    );
    expect(untracked).toEqual([]);
  });

  it.fails('does not import retired replay/materialization modules from production source', () => {
    // RED BY ONE HIT, and the hit is a plan contradiction rather than a code defect:
    //
    //   { file: 'contexts/durable-compositor.ts', line: 4, specifier: './materialization.ts' }
    //
    // G0 forbids production source from importing the retired materialization module; G13
    // requires that module to have exactly one production importer. The only way to satisfy
    // G13 is for the durable compositor to exist and be wired, and the compositor's own
    // import is what G0 forbids. No state satisfies both. See `HANDOFF.md` §177 for the
    // operator ruling that has to come first.
    //
    // This is an expected failure rather than a skip, so it is a tripwire: it is GREEN while
    // the contradiction stands and RED the moment `durable-compositor.ts` stops importing
    // `materialization.ts`, which is the moment G0 and G13 stop disagreeing and the gate has
    // to become a plain assertion. That is also what keeps the walk honest — the old gate
    // read one file, passed, and would still pass if the walk were narrowed back to it.
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
