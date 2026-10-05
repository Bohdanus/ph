import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Action, PublicAction, StoreDispatch } from '../StoreContext.tsx';

const srcDir = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(srcDir, '..');
const forbiddenModules = ['replay-budget', 'replay-coordinator', 'replay-checkpoints'] as const;
const materializationModule = 'materialization';

/**
 * Two of the three forbidden modules were deleted as dead code — they had no importer
 * outside `__tests__` — so the names survive here for the opposite reason to the one they
 * were added with. A gate that dropped them with the files would forbid nothing, and a
 * later reintroduction of a module that once existed would be unreported. The forbidden
 * set is therefore a RETIREMENT list: it names what must not come back, and
 * `it('keeps the deleted coordination modules deleted')` is what makes the retirement
 * verifiable rather than assumed.
 */
const deletedModules = ['replay-coordinator', 'replay-checkpoints'] as const;

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;

/**
 * The keyword before an import specifier is `from` or `import(` plus the whitespace
 * prettier leaves between them, so the lookback that decides it is bounded. Reading
 * the whole prefix instead makes masking a file quadratic in its length, which a
 * walk over every production module turns into minutes.
 */
const LOOKBEHIND = 512;

/**
 * A `/` here opens a regex literal rather than dividing. The trigger set is the
 * characters that can precede one — `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`,
 * `;`, and `>` for an arrow body — and division never follows any of them, because it
 * follows an identifier, `)` or a number.
 */
const REGEX_LITERAL_PREFIX = /[(,=:[!&|?{;>\n]\s*$/;

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
    if (character === '/' && REGEX_LITERAL_PREFIX.test(output.slice(Math.max(0, index - 8), index).join(''))) {
      // A REGEX literal, not a string: `/["'\\<>]/` would otherwise open a string at the
      // `"` and blank everything after it, disabling this scanner for the rest of the file
      // without saying so. Only a `/` that can BEGIN a regex counts -- division follows an
      // identifier, `)` or a number, none of which are in the trigger set.
      index += 1;
      while (index < source.length && !(source[index] === '/' && source[index - 1] !== '\\')) index += 1;
      index = Math.min(source.length, index + 1);
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
    const preserve =
      quote !== '`' && /(?:\bfrom|\bimport(?:\s*\()?|\bvi\s*\.\s*(?:mock|doMock|unmock)\s*\()\s*$/.test(prefix);
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

/**
 * `vi.mock` takes a SPECIFIER, not a module, so a suite can name a module no `import`
 * statement names. This arm exists for that case — and it was DEAD until this change:
 * it was matched against the MASKED source, whose preserve test recognised only `from`
 * and `import(`, so every `vi.mock('./x.ts')` literal was blanked to spaces before this
 * regex ever saw it. `[^'"]+` then matched the spaces and `resolveSpecifier` returned
 * null, because a run of spaces starts with neither `.` nor `@/`. 0 of 463 call sites
 * resolved.
 *
 * The preserve test above now recognises `vi.mock(`, so 458 of 463 resolve and the
 * imported set and the orphan set are BYTE-IDENTICAL to before. That is the honest
 * result to record: the arm changes no verdict today, and the earlier claim that this
 * was "measured by deleting the arm" was void, because deleting it could not have
 * changed a thing.
 */
const MOCK_SPECIFIER = /\bvi\s*\.\s*(?:mock|doMock|unmock)\s*\(\s*['"]([^'"]+)['"]/g;

const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'] as const;

/**
 * A specifier to the repo-relative path of a module in `walked`, or `null` when it
 * names something outside this walk.
 *
 * The extension search is load-bearing: most specifiers in this tree omit it —
 * `toolIcons.tsx` writes `'./icons/BlurIcon'` for all 37 icon components — so a
 * resolver that compared the raw path called every one of them unimported, and the
 * gate below demanded 37 allow-list entries for live code. That was measured, not
 * assumed: the first run of this guard failed with exactly those 37.
 */
function resolveSpecifier(fromPath: string, rawSpecifier: string, walked: ReadonlySet<string>): string | null {
  // A Vite query (`?raw`, `?url`, `?worker`) is not part of the module's identity: the
  // loader resolves `./x.ts?raw` to `x.ts`. Two live imports take that form, and a
  // resolver that does not strip it reports their targets as unimported — harmless only
  // because both are also imported normally. This tree imports `.ts`/`.tsx` and omits the
  // extension; it never maps a `.js` specifier onto a source module.
  const specifier = rawSpecifier.replace(/\?.*$/, '');
  let base: string | null = null;
  if (specifier.startsWith('.')) {
    base = relative(repoRoot, resolve(repoRoot, dirname(fromPath), specifier))
      .split(sep)
      .join('/');
  } else if (specifier.startsWith('@/')) {
    // `@/*` is the one non-relative alias `tsconfig.app.json` declares. A bare
    // specifier is a package, which by definition lives outside this walk.
    base = `src/${specifier.slice(2)}`;
  }
  if (base === null) return null;
  if (walked.has(base)) return base;
  for (const extension of MODULE_EXTENSIONS) {
    if (walked.has(`${base}${extension}`)) return `${base}${extension}`;
  }
  return null;
}

/**
 * `IMPORT_SPECIFIER` throws the `type` keyword away, so it cannot tell
 * `import type { X } from './y.ts'` from `import { X } from './y.ts'` — and the
 * difference is the whole question here. This captures it: the second group is the
 * specifier, and the first group's presence means the statement began with
 * `import type`. An inline specifier (`import { value, type Shape }`) counts as a
 * VALUE import, because it binds a value too.
 */
const TYPED_IMPORT = /(^|\n)[ \t]*import\s+(type(?=[\s{])\s*)?[^;'"`]*?\bfrom\s+['"]([^'"]+)['"]/g;

type ImportEdge = Readonly<{ file: string; specifier: string; typeOnly: boolean }>;

type ModuleGraph = Readonly<{
  walked: ReadonlySet<string>;
  /** Every module some module names, as a repo-relative path. */
  imported: ReadonlySet<string>;
  /** Everything ONE module names, with the kind of each naming. */
  outEdges: ReadonlyMap<string, readonly Omit<ImportEdge, 'file'>[]>;
}>;

/**
 * ONE pass over `src/`, memoised, because the unimported-module scan and the typed
 * edge index both need every module's imports and masking a file's comments is the
 * expensive half. Sharing the pass took this suite from two full walks to one; run
 * separately they did not fit the per-test timeout at all under a full-suite run.
 *
 * Under `--run` the tree is frozen, so a single scan is exact. Watch mode re-runs the
 * file with this cache intact, which is why every verdict below now reads `walked` from
 * here rather than taking a second filesystem walk that could disagree.
 */
let moduleGraphCache: ModuleGraph | null = null;

function moduleGraph(): ModuleGraph {
  if (moduleGraphCache) return moduleGraphCache;

  const walked = new Set(
    [...sourceModulesUnder(srcDir), join(repoRoot, 'toolbar-mapping.ts')]
      .map((absolute) => relative(repoRoot, absolute).split(sep).join('/'))
      .filter((path) => /\.tsx?$/.test(path))
  );

  const imported = new Set<string>();
  const outEdges = new Map<string, Omit<ImportEdge, 'file'>[]>();

  for (const file of walked) {
    const masked = maskCommentsPreservingImportSpecifiers(readFileSync(join(repoRoot, file), 'utf8'));
    const edges: Omit<ImportEdge, 'file'>[] = [];
    for (const pattern of [IMPORT_SPECIFIER, MOCK_SPECIFIER]) {
      for (const match of masked.matchAll(pattern)) {
        const resolved = resolveSpecifier(file, match[1], walked);
        if (resolved) imported.add(resolved);
      }
    }
    for (const match of masked.matchAll(TYPED_IMPORT)) {
      edges.push({ specifier: match[3], typeOnly: match[2] !== undefined });
    }
    outEdges.set(file, edges);
  }

  moduleGraphCache = { walked, imported, outEdges };
  return moduleGraphCache;
}

/** Every module that names `target`, with the kind of each naming. */
function importEdges(target: string): ImportEdge[] {
  const { walked, outEdges } = moduleGraph();
  const edges: ImportEdge[] = [];
  for (const [file, out] of outEdges) {
    for (const edge of out) {
      if (resolveSpecifier(file, edge.specifier, walked) === target) edges.push({ file, ...edge });
    }
  }
  return edges;
}

const FILE_IO_LEAF = 'src/contexts/file-types.ts';
const FILE_IO_PROVIDER = 'src/contexts/useFile.tsx';

/**
 * A production module NO MODULE IN THE REPOSITORY names.
 *
 * That is the rule this implements, and it is deliberately narrower than "dead code".
 * Thirteen production modules have no production importer but at least one test
 * importer, and four of those are dead by any reading — but a stricter "no production
 * importer" rule has to allow-list `src/contexts/replay-budget.ts`, which
 * `keeps retired replay coordination modules out of production source` below FORBIDS
 * an importer for. A rule that fights the neighbouring rule is not a rule, so the four
 * are a `HANDOFF.md` entry instead, where each needs a delete-or-mount decision no
 * regex can make.
 *
 * Every entry carries its reason, because an unexplained entry is the
 * unfalsifiable flag `scripts/__tests__/agents-citations.test.mjs` is written
 * against.
 */
const ALLOWED_UNIMPORTED_MODULES = new Map<string, string>([
  [
    'src/main.tsx',
    'the HTML entry point. `index.html` and `e2e/global-setup.ts` name it as the string literal `/src/main.tsx`, which no import statement can express',
  ],
]);

function unimportedProductionModules(): string[] {
  // Read from the SAME snapshot the imported set came from, so one verdict cannot be
  // assembled from two walks. The `isProductionModule` filter stays: `moduleGraph().walked`
  // carries every module including tests, and without the filter this reports all ~330 of
  // them. `walkedProductionModules()` is left alone because the git-equality case needs
  // its live filesystem read.
  const { walked, imported } = moduleGraph();
  return [...walked].filter((path) => isProductionModule(path) && !imported.has(path));
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
  // `replay-coordinator`, and `replay-checkpoints`. The last two no longer exist as files;
  // they are kept in the set so the gate still reports a reintroduction, which is what the
  // synthetic specifiers in `it('reports a forbidden module from any module…')` exercise.
  // `materialization.ts` is intentionally excluded: the durable compositor is its one allowed
  // production boundary. `presentation-evaluator.ts` is imported by production on purpose
  // (`layer-renderer.ts` and `useLayer.ts` — `operationsRetainedAfterBake()`, and
  // `materialization.ts` — `evaluatePresentation()`), and `durable-replay.ts` is read as a
  // value by `StoreContext.tsx` — `replayDurableAtCursor()`, so adding either would make this
  // red on correct code.
  it('keeps retired replay coordination modules out of production source', () => {
    expect(forbiddenProductionImports()).toEqual([]);
  });

  // The gate above is blind to the deletion itself: a forbidden-basename match never asks
  // whether the module exists, so the set would pass unchanged with both files restored and
  // only their importers added. This is the leg that fails in that case, and it is the one
  // that makes the two entries in `deletedModules` mean "retired" rather than merely
  // "unimported". Reading git rather than the filesystem is what makes it exact — an
  // untracked leftover on disk is caught by the walk-equality case above, not here.
  it('keeps the deleted coordination modules deleted', () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files', '-z', '--', 'src'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\0')
        .filter((path) => path.length > 0)
    );
    const resurrected = [...deletedModules]
      .map((module) => `src/contexts/${module}.ts`)
      .filter((path) => tracked.has(path));
    expect(resurrected).toEqual([]);
  });

  it('routes production durable materialization only through the compositor boundary', () => {
    expect(materializationProductionImports().map(({ file, specifier }) => ({ file, specifier }))).toEqual([
      { file: 'src/contexts/durable-compositor.ts', specifier: './materialization.ts' },
    ]);
  });

  // A module nothing names is still typechecked — `tsconfig.app.json` includes `src`
  // outright, so it is a root of the program whatever imports it — but nothing the
  // compiler prints ever says it is unreachable, no test loads it, and no entry point
  // names it. Five accumulated in this repository at once —
  // a fully commented `text.ts` and `ImageContext.tsx`, a two-constant barrel, a
  // six-export fixture nothing imported, and that fixture's own barrel, which nothing
  // imported either. The guard is what stops the sixth PRODUCTION orphan; it cannot see
  // the two that lived under `src/__tests__/fixtures/`, because `isProductionModule`
  // excludes `__tests__`.
  //
  // The scan is warmed once here rather than inside the first case: it reads and
  // comment-masks every module under `src/`, suites included, which costs several
  // seconds and does not fit the per-test timeout. It runs in `beforeAll` so the cost
  // is paid once and the assertions below stay ordinary.
  beforeAll(() => {
    // Two full passes over `src/`: one for the unimported-module scan and one for
    // the typed-edge index the cycle cases read. Both mask comments per file, which
    // costs several seconds and does not fit the per-test timeout — and the cycle
    // cases only pass when `beforeAll` has already paid it.
    moduleGraph();
  }, 60_000);

  it('finds the importers of a module the scan could otherwise miss', () => {
    // The positive control the negative case needs. A resolver that resolved nothing
    // would report every module as unimported, and `unimportedProductionModules` would
    // then be an allow-list that happens to be short. Asserting known importers first
    // means a broken scan fails here, where the message can say what it found, rather
    // than in the next case behind a list of paths nobody can interpret.
    const imported = moduleGraph().imported;

    expect(imported.has('src/contexts/StoreContext.tsx')).toBe(true);
    expect(imported.has('src/hooks/useRect.ts')).toBe(true);
    // Named through a specifier with no extension, which is how all 37 rail icons are
    // reached — the case a naive resolver reports as 37 orphans.
    expect(imported.has('src/components/SidebarLeft/icons/BlurIcon.tsx')).toBe(true);
  });

  it('keeps reading imports after a regex literal, which looks like a string opener', () => {
    // `/["'\\<>]/` contains a quote, so before the regex-literal skip this mask opened a
    // string there and blanked the rest of the file — which silently switches the
    // unimported-module scan off from that point on. `src/components/ToolbarsRight/
    // __tests__/buttonStyles.test.ts` has that exact literal, so this is not
    // hypothetical: the failure is invisible in the verdict, it just makes the verdict
    // mean less than it appears to.
    const masked = maskCommentsPreservingImportSpecifiers(
      ["const quoted = value.replace(/[\"'\\<>]/g, '');", "import { secondImport } from './second.ts';"].join('\n')
    );

    expect(masked).toContain("'./second.ts'");
  });

  it('reports a production module nothing imports, rather than leaving it to rot undeleted', () => {
    const orphans = unimportedProductionModules().filter((path) => !ALLOWED_UNIMPORTED_MODULES.has(path));

    expect(orphans).toEqual([]);
  });

  it('holds no allow-list entry for a module that now has an importer', () => {
    const imported = moduleGraph().imported;
    const stale = [...ALLOWED_UNIMPORTED_MODULES.keys()].filter((path) => imported.has(path));

    expect(stale).toEqual([]);
  });

  it('holds no allow-list entry for a module that no longer exists', () => {
    // The stale-entry case above cannot fail on a DELETED entry, so deleting a module
    // leaves a permanent exemption: recreate the path and the guard would wave it
    // through without ever asking why it is exempt.
    const gone = [...ALLOWED_UNIMPORTED_MODULES.keys()].filter((path) => !moduleGraph().walked.has(path));

    expect(gone).toEqual([]);
  });

  it('holds a reason on every allow-list entry, because an unexplained one is unfalsifiable', () => {
    const unexplained = [...ALLOWED_UNIMPORTED_MODULES].filter(([, reason]) => !reason.trim()).map(([path]) => path);

    expect(unexplained).toEqual([]);
  });

  it('takes the file I/O shapes from a leaf, so no component imports back into the provider module', () => {
    // `useFile.tsx` renders the dialogs it owns, so it is the one context module a
    // component must not reach back into for a type: that closes a cycle between the
    // provider and the dialog it mounts. Calling `useFile()` is the intended
    // direction and stays legal, which is why this names the TYPE-only edges rather
    // than every edge.
    //
    // The property is STATEMENT-shaped: no import STATEMENT naming the provider may be
    // type-only. `useFile.test.tsx` binds `type FileContextType` alongside two values in
    // one statement, and that is not a violation — a statement binding a value is erased
    // at runtime anyway. It is also not expressible more finely than that, because
    // `TYPED_IMPORT` discards the binding list.
    //
    // KNOWN LIMIT: `export … from` is invisible here. A barrel re-exporting `useFile`
    // would be a genuine runtime edge that `IMPORT_SPECIFIER` counts as an importer but
    // this case cannot see. None exists today; the leaf case above pins against both
    // patterns instead, which closes the same hole for the one module whose out-edges
    // are the property being claimed.
    const typeOnly = importEdges(FILE_IO_PROVIDER).filter((edge) => edge.typeOnly);

    expect(typeOnly.map(({ file, specifier }) => ({ file, specifier }))).toEqual([]);
  });

  it('finds the modules that call the file-IO hook, so a resolver that resolves nothing cannot pass', () => {
    // The positive half of the case above: a type-only edge into the provider is
    // invisible if the resolver resolves nothing, so the negative case would pass on a
    // broken scan. Naming importers is what proves the scan sees them.
    //
    // It is deliberately NOT an exact list. Calling `useFile()` from a component is the
    // intended direction, so an eighth caller must not turn this red — only a resolver
    // that finds nobody should. The named paths are the known importers, not the
    // permitted ones.
    const valueEdges = importEdges(FILE_IO_PROVIDER).filter((edge) => !edge.typeOnly);
    const importers = [...new Set(valueEdges.map(({ file }) => file))];

    expect(valueEdges.length).toBeGreaterThan(0);
    expect(importers).toEqual(
      expect.arrayContaining(['src/App.tsx', 'src/components/Main/Main.tsx', 'src/contexts/__tests__/useFile.test.tsx'])
    );
  });

  it('keeps the file I/O leaf free of value imports, so a shape cannot smuggle a runtime edge back', () => {
    // The leaf's four edges are all `import type`, which is what makes it add
    // nothing at runtime. Promoting one to a value import would pull a codec's
    // module graph into every dialog that names a shape, so the out-edges are
    // pinned as an exact list with their kinds rather than counted.
    const { outEdges } = moduleGraph();
    // The UNION of both patterns, deduped by specifier: `IMPORT_SPECIFIER` alone misses
    // nothing but cannot say whether an edge is type-only, and `TYPED_IMPORT` alone is
    // blind to a bare `import './x.css'` and to any `export … from` — a real runtime edge.
    // Every `import type` matches BOTH, so without the dedupe the array doubles.
    const bySpecifier = new Map<string, boolean>();
    for (const edge of outEdges.get(FILE_IO_LEAF) ?? []) bySpecifier.set(edge.specifier, edge.typeOnly);
    const edges = [...bySpecifier.entries()].map(([specifier, typeOnly]) => ({ specifier, typeOnly }));

    expect(edges.sort((left, right) => left.specifier.localeCompare(right.specifier))).toEqual([
      { specifier: './document-frame.ts', typeOnly: true },
      { specifier: './general-types.ts', typeOnly: true },
      { specifier: './layer-types.ts', typeOnly: true },
      { specifier: './psd-utils.ts', typeOnly: true },
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
