import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import * as ts from 'typescript';

/**
 * Every module under `e2e/` is reachable from a unit test.
 *
 * WHY REACHABILITY AND COVERAGE ARE SEPARATE GATES
 * ------------------------------------------------
 * This test checks the structural TypeScript import graph on disk; it does not read a
 * coverage artifact. The e2e-unit job runs this gate first, then runs Istanbul coverage
 * with an explicit all-module universe. Reachability catches a source module with no
 * unit-test dependency; Istanbul measures runtime statements and reports an imported
 * but unexecuted module at zero. Neither report is used as the other's input.
 *
 * Coverage runs after this test in CI, so inspecting its artifact here would read
 * nothing on a clean checkout (or stale data on a developer machine). The test instead
 * derives both sides of the module universe from source and tsconfig.
 *
 * WHY TRANSITIVE, NOT DIRECT
 * --------------------------
 * `e2e/helpers/discard-prompt.ts` has no unit test of its own and is nonetheless
 * covered: `e2e/export/helpers.ts` imports it, and `e2e/export/__tests__/helpers.unit.test.ts`
 * imports `e2e/export/helpers.ts`. A gate that counted only the imports written in the
 * unit test files would name `discard-prompt.ts` as an offender and be wrong.
 *
 * WHY THE UNIVERSE IS READ AND NOT WRITTEN
 * ----------------------------------------
 * A literal list of the sixteen is correct the day it is written and silently stops
 * covering every module added afterwards, which is the exact defect this gate exists to
 * catch. The universe is therefore enumerated from the directory, and the enumeration
 * itself is enumerated twice, from two unrelated sources, because a gate whose input
 * comes from one directory read cannot notice that its own input rotted.
 */

/** `<repo>/e2e`, from `e2e/helpers/__tests__/`. */
const E2E_DIR = fileURLToPath(new URL('../../', import.meta.url));
/** `<repo>`, with a trailing separator; every set below is keyed by a slice of it. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** The e2e TypeScript project: an input this gate does not own and did not write. */
const E2E_TSCONFIG = join(REPO_ROOT, 'tsconfig.e2e.json');

/**
 * Directories that hold test code rather than suite code.
 *
 * `__tests__` is where `npm run test:e2e:unit`'s `include` glob points, so everything
 * under it is test support: it exists to be imported BY a unit test, and a unit test
 * that imports it has already satisfied the gate for whatever it imports in turn. The
 * universe is therefore the modules the specs depend on, which is where an untested
 * helper is a defect. `e2e/helpers/__tests__/canvas-helpers.fixtures.ts` is the one
 * such file today and eight unit tests import it, so excluding the directory costs no
 * coverage of anything.
 */
const TEST_SUPPORT_DIRECTORIES = new Set(['__tests__']);

const isSuiteFile = (name: string): boolean => name.endsWith('.spec.ts') || name.endsWith('.test.ts');
const isModuleFile = (name: string): boolean => name.endsWith('.ts') && !isSuiteFile(name);
const isUnitTestFile = (name: string): boolean => name.endsWith('.unit.test.ts');

/** The basename of a repo-relative path. */
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Repo-relative, forward-slashed. One identity for both enumerations to agree on. */
const repoRelative = (absolute: string): string => absolute.split('\\').join('/').slice(REPO_ROOT.length);

/** `left` minus `right`, so a disagreement names what each side thought it had. */
function missingFrom(left: readonly string[], right: readonly string[]): string[] {
  const present = new Set(right);
  return left.filter((entry) => !present.has(entry));
}

/** Every accepted `.ts` file under `directory`, recursion included, repo-relative and sorted. */
function walkTypeScript(directory: string, skipped: ReadonlySet<string>, accept: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skipped.has(entry.name)) continue;
      found.push(...walkTypeScript(absolute, skipped, accept));
    } else if (entry.isFile() && accept(entry.name)) {
      found.push(repoRelative(absolute));
    }
  }
  return found.sort();
}

/**
 * The same question asked of the e2e TypeScript project: which files does
 * `tsconfig.e2e.json` say belong to `e2e/`, according to TypeScript's own glob
 * expansion? A second, independent enumeration, from a file this gate does not own.
 *
 * It earns its place by failing on things the directory walk cannot see. Narrow
 * `tsconfig.e2e.json`'s `include` to `e2e/helpers/**` and `npm run tsc` stops
 * type-checking the fixtures as well — and this gate goes red at the same moment,
 * naming the files that dropped out. The two enumerations share no code path, so
 * neither can be quietly narrowed on its own.
 */
function e2eProjectFiles(): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    E2E_TSCONFIG,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(`${E2E_TSCONFIG}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      },
    }
  );
  if (!parsed) throw new Error(`${E2E_TSCONFIG} produced no parsed command line`);
  return parsed.fileNames
    .map(repoRelative)
    .filter((path) => path.startsWith('e2e/'))
    .sort();
}

/**
 * Relative import specifiers in one file, read through TypeScript's parser.
 *
 * A regular expression over the source is the obvious thing here and it is wrong twice
 * over: a doc comment in this repository is full of quoted paths, and a phantom edge
 * created by matching one of them would silently mark an untested module as covered.
 * The AST cannot match either a comment or a string that is not a module specifier.
 */
function relativeImportsOf(repoRelativePath: string): string[] {
  const source = ts.createSourceFile(
    repoRelativePath,
    readFileSync(join(REPO_ROOT, repoRelativePath), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );

  const specifiers: string[] = [];
  const collect = (moduleSpecifier: ts.Expression | undefined): void => {
    if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier) && moduleSpecifier.text.startsWith('.')) {
      specifiers.push(moduleSpecifier.text);
    }
  };

  // Type-only imports and re-exports are structural graph edges and are type-checked.
  // They do not prove runtime execution; the separate Istanbul report measures that.
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      collect(statement.moduleSpecifier);
    }
  }

  // `await import('./x')` is not a statement-level declaration, so it is found by
  // walking. None is written today; the walk is four lines and its absence would be a
  // hole exactly when someone writes the first one.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      collect(node.arguments[0] as ts.Expression | undefined);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return specifiers;
}

/** A relative specifier resolved against the importing file, with the `.ts` extension added. */
function resolveRelativeImport(importer: string, specifier: string): string | null {
  const base = resolve(join(REPO_ROOT, dirname(importer)), specifier);
  // Bundler mode lets an import name the emitted extension; the source is still `.ts`.
  const stem = base.endsWith('.js') ? base.slice(0, -'.js'.length) : base;
  for (const candidate of [stem, `${stem}.ts`, join(stem, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return repoRelative(candidate);
  }
  return null;
}

/** Transitive closure over an explicit edge map. No filesystem, so a graph can be handed to it. */
function closeOverGraph(roots: readonly string[], edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const target of edges.get(current) ?? []) {
      if (!seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/** Every edge out of `roots` and out of whatever they reach, read from disk as it is walked. */
function closeOverDisk(roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const specifier of relativeImportsOf(current)) {
      const target = resolveRelativeImport(current, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

// ENUMERATION ONE: the directory walk. This is the input the gate decides on.
const WALKED_MODULES = walkTypeScript(E2E_DIR, TEST_SUPPORT_DIRECTORIES, isModuleFile);
const WALKED_UNIT_TESTS = walkTypeScript(E2E_DIR, new Set<string>(), isUnitTestFile);

// ENUMERATION TWO: the e2e TypeScript project. Nothing above shares code with this.
const PROJECT_FILES = e2eProjectFiles();
const PROJECT_MODULES = PROJECT_FILES.filter(
  (path) => !path.split('/').includes('__tests__') && isModuleFile(basename(path))
);
const PROJECT_UNIT_TESTS = PROJECT_FILES.filter((path) => isUnitTestFile(basename(path)));

const reachableFromUnitTests = closeOverDisk(WALKED_UNIT_TESTS);
const unreachableModules = WALKED_MODULES.filter((module) => !reachableFromUnitTests.has(module));

/** The modules a unit test file imports in its own source, which is the wrong predicate. */
const importedDirectlyByUnitTests = new Set(
  WALKED_UNIT_TESTS.flatMap((root) =>
    relativeImportsOf(root)
      .map((specifier) => resolveRelativeImport(root, specifier))
      .filter((target): target is string => target !== null)
  )
);

describe('the e2e module universe', () => {
  /**
   * One module from every directory that holds one, so an enumeration that stopped
   * recursing — or that was narrowed to `e2e/helpers/` — is a red test rather than a
   * smaller green one. `fixtures/extended-test.ts` is here for the second reason too:
   * it is the offender OUTSIDE `e2e/helpers/`, and a gate scoped to the helpers
   * directory would not have it in its universe at all.
   */
  const ANCHORS = [
    'e2e/export/helpers.ts',
    'e2e/fixtures/extended-test.ts',
    'e2e/global-setup.ts',
    'e2e/helpers/canvas-helpers.ts',
    'e2e/helpers/selection-ants.ts',
  ];

  it('is not empty and holds a module from every directory that has one', () => {
    // Printed, because a gate over an enumerated universe is worth nothing if nobody
    // can tell `16 modules` from `1 module` in the output. On green this is the line
    // that says what was enumerated; on red the worklist names what was missing.
    console.info(
      `helper-coverage: enumerated ${WALKED_MODULES.length} modules under e2e/ and ` +
        `${WALKED_UNIT_TESTS.length} unit tests; ${unreachableModules.length} unreachable`
    );
    expect(WALKED_MODULES.length).toBeGreaterThan(ANCHORS.length);
    for (const anchor of ANCHORS) {
      expect(WALKED_MODULES, `${anchor} is missing from the enumerated universe`).toContain(anchor);
    }
  });

  it('agrees with the e2e TypeScript project', () => {
    expect(
      missingFrom(WALKED_MODULES, PROJECT_MODULES),
      'the directory walk found modules the e2e tsconfig does not compile'
    ).toEqual([]);
    expect(
      missingFrom(PROJECT_MODULES, WALKED_MODULES),
      'the e2e tsconfig compiles modules the directory walk did not find'
    ).toEqual([]);
  });

  it('reads no coverage artifact, because the tests run before the coverage step', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const self = ts.createSourceFile('helper-coverage.unit.test.ts', source, ts.ScriptTarget.Latest, true);
    const literals: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) literals.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(self);

    // Import specifiers are string literals too, so this covers both ways in: reading
    // the report would need its path as a literal. A comment saying so is not one,
    // which is why this is an AST walk and not a search over the file text.
    //
    // The pattern is the ARTIFACT, not the word: `vitest.e2e.config.ts` writes every
    // report under `./coverage-e2e`, so a path to any of them names that directory.
    // Prose about coverage reports is allowed in this file; a path to one is not.
    expect(
      literals.filter((text) => /coverage-e2e|coverage\//.test(text)),
      'this gate must decide from the module graph, never from a coverage artifact'
    ).toEqual([]);
  });
});

describe('the unit-test roots', () => {
  const ANCHORS = ['e2e/export/__tests__/helpers.unit.test.ts', 'e2e/helpers/__tests__/screenshot-scale.unit.test.ts'];

  it('is not empty and holds a test from every test directory', () => {
    expect(WALKED_UNIT_TESTS.length).toBeGreaterThan(ANCHORS.length);
    for (const anchor of ANCHORS) {
      expect(WALKED_UNIT_TESTS, `${anchor} is missing from the enumerated unit tests`).toContain(anchor);
    }
  });

  it('agrees with the unit tests the e2e TypeScript project compiles', () => {
    expect(missingFrom(WALKED_UNIT_TESTS, PROJECT_UNIT_TESTS)).toEqual([]);
    expect(missingFrom(PROJECT_UNIT_TESTS, WALKED_UNIT_TESTS)).toEqual([]);
  });

  it('is the glob npm run test:e2e:unit collects, so a root that runs is a root that counts', () => {
    // `include` is `e2e/**/__tests__/**/*.unit.test.ts`, and it is what the `e2e-unit`
    // job runs. A file outside that glob is a unit test that never runs, so counting it
    // as a root would let a module pass the gate on the strength of a test CI ignores.
    expect(WALKED_UNIT_TESTS.every((path) => /(^|\/)__tests__\/[^/]+\.unit\.test\.ts$/.test(path))).toBe(true);
  });
});

describe('the reachability walk', () => {
  it('follows a chain of relative imports rather than only the direct ones', () => {
    // The graph is built here, so this case cannot rot with the tree. It is the whole
    // reason `closeOverGraph` takes an edge map instead of touching the disk: the one
    // property that makes a reachability gate correct is that it is transitive, and a
    // test of that property taken from the live tree is a test of whatever happens to
    // be transitive today.
    const edges = new Map([
      ['root', ['middle']],
      ['middle', ['leaf']],
      ['untouched', []],
    ]);

    const reached = closeOverGraph(['root'], edges);
    expect([...reached].sort()).toEqual(['leaf', 'middle', 'root']);
    // The direct predicate would have stopped at `middle`.
    expect(edges.get('root')).toEqual(['middle']);
    expect(reached.has('untouched')).toBe(false);
  });

  it('reaches a module that only a transitive import reaches', () => {
    // `discard-prompt.ts` is that module: `e2e/export/helpers.ts` imports it, and
    // `e2e/export/__tests__/helpers.unit.test.ts` imports `e2e/export/helpers.ts`.
    // Nothing imports `discard-prompt.ts` from a unit test file directly, so a
    // direct-import gate would report it and be wrong.
    //
    // TRIPWIRE. This asserts that the live graph still exercises the transitive path.
    // The moment every module has a unit test of its own the assertion fails, and the
    // honest response is to say so rather than to delete it: it means the live tree no
    // longer demonstrates the property the case above exists to prove.
    const reachedOnlyTransitively = WALKED_MODULES.filter(
      (module) => reachableFromUnitTests.has(module) && !importedDirectlyByUnitTests.has(module)
    );
    expect(reachedOnlyTransitively.length, 'no module is reached only transitively any more').toBeGreaterThan(0);
    expect(reachedOnlyTransitively).toContain('e2e/helpers/discard-prompt.ts');
  });
});

describe('every e2e module is reachable from a unit test', () => {
  it('names every module no unit test can reach', () => {
    expect(
      unreachableModules,
      [
        `${unreachableModules.length} of ${WALKED_MODULES.length} modules under e2e/ are not reachable`,
        'from any *.unit.test.ts. This is the worklist:',
        ...unreachableModules.map((module) => `  - ${module}`),
        '',
        'A module passes this gate by being IMPORTED, transitively, from a unit test.',
        'Coverage is measured in a separate later CI step; this graph gate does not read',
        'its report and remains independent of coverage-provider configuration.',
      ].join('\n')
    ).toEqual([]);
  });
});
