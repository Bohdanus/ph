import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { availableTools, toolbarMap } from '../../toolbar-mapping.ts';
import { renderToolDocs, renderTooltips } from '../generate-tool-docs.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const readRepoFile = (path) => readFileSync(resolve(REPO_ROOT, path), 'utf8').replace(/\r\n/g, '\n');

const FAMILIES = [
  'selection',
  'paint',
  'focus',
  'shape',
  'pen',
  'type-crop',
  'transform',
  'eyedropper-draw',
  'view',
  'patch',
];

// Module scope, not inside a `describe`: the dynamic imports need top-level `await`, and
// vitest's `describe` body is synchronous. Each family module exports exactly one record and
// that is its only export, so the first value is the record — which is how `index.ts` reads
// them too.
const entries = await Promise.all(
  FAMILIES.map(async (family) => [family, Object.values(await import(`../../src/tools/descriptions/${family}.ts`))[0]])
);

const descriptions = Object.assign({}, ...entries.map(([, record]) => record));
// Star is a figure variant whose toolbar identity is the registered `shape` tool; it remains in
// the full research record so generated docs can describe the variant without becoming a second
// selectable ToolName.
const registeredDescriptions = Object.fromEntries(Object.entries(descriptions).filter(([name]) => name !== 'star'));

/** `file:line`, the only citation form `implementationRefs` and `appRef` accept. *
 *
 * The check is deliberately on the PATH, not the line. A path that does not exist is a
 * fabricated citation and is worth failing a build over; a line that is off by three is a
 * review finding, not a mechanical one, and a test that fails on it would be a nuisance that
 * trains people to regenerate refs instead of re-deriving them.
 */
const REF_PATTERN = /^(?<path>[^\s:]+):(?<line>\d+)$/;

/**
 * The two checks that need a filesystem, kept out of `src/`.
 *
 * `src/` is the browser program and its TypeScript project declares no Node types, so a test
 * under it that reaches for `node:fs` does not compile — and adding Node types to the app
 * project to accommodate a test would put `fs` in reach of application code. This is the same
 * split `vitest.config.ts` already documents for the e2e helper tests, and the same place the
 * swarm board's own test lives.
 */
describe('tool description citations', () => {
  it('covers every registered tool', () => {
    expect(new Set(Object.keys(registeredDescriptions))).toEqual(new Set(availableTools));
  });

  it('cites at least one real file for every tool, and every citation resolves', () => {
    const broken = [];

    for (const [name, description] of Object.entries(descriptions)) {
      const refs = [
        ...description.implementationRefs,
        ...description.options.map((option) => option.appRef).filter((ref) => ref !== undefined),
      ];
      if (refs.length === 0) broken.push(`${name}: implementationRefs is empty`);

      for (const ref of refs) {
        const match = REF_PATTERN.exec(ref);
        if (match === null) {
          broken.push(`${name}: "${ref}" is not in file:line form`);
          continue;
        }
        const { path, line } = match.groups;
        const lines = readRepoFile(path).split('\n');
        if (Number(line) > lines.length) broken.push(`${name}: "${ref}" points past the end of ${path}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('keeps the text toolbar citations attached to the controls they describe', () => {
    const expected = new Map([
      ['Font family', /FontSelect/],
      ['Size', /data-testid="font-size-input"/],
      ['Text color', /id="text-color"/],
      ['Align Text Left / Center Text / Align Text Right', /id="align-select"/],
      ['Commit / Cancel', /Commit/],
    ]);
    const text = descriptions.text;
    const mismatches = [];

    for (const option of text.options) {
      const pattern = expected.get(option.control);
      if (!pattern || option.appRef === undefined) continue;
      const match = /^(?<path>[^:]+):(?<line>\d+)$/.exec(option.appRef);
      if (!match) {
        mismatches.push(`${option.control}: malformed appRef ${option.appRef}`);
        continue;
      }
      const source = readRepoFile(match.groups.path).split('\n')[Number(match.groups.line) - 1] ?? '';
      if (!pattern.test(source)) mismatches.push(`${option.control}: ${option.appRef} does not contain ${pattern}`);
    }

    expect(mismatches).toEqual([]);
  });

  // A duplicated key is invisible to `index.ts`: the later spread silently wins, and the losing
  // family's research is lost with no error anywhere. The compiler proves the families are
  // complete; only this can prove they do not overlap.
  //
  // Checked on the imported records rather than by pattern-matching the source text. A source
  // regex has to guess at the indentation prettier chose, and prettier's choice depends on how
  // long the record's key union is — a family that inlines a long union gets its keys pushed to
  // four spaces and a two-space pattern silently reports that family as empty. Comparing the
  // records that actually load has no such dependency.
  it('gives every family a non-empty, disjoint set of keys', () => {
    const seen = new Map();
    const duplicates = [];
    const empty = [];

    for (const [family, record] of entries) {
      const keys = Object.keys(record);
      if (keys.length === 0) {
        empty.push(family);
        continue;
      }
      for (const key of keys) {
        const owner = seen.get(key);
        if (owner !== undefined) duplicates.push(`${key} in ${family} and ${owner}`);
        else seen.set(key, family);
      }
    }

    expect(empty, `family modules with no tools: ${empty.join(', ')}`).toEqual([]);
    expect(duplicates).toEqual([]);
    expect([...seen.keys()].filter((name) => name !== 'star').sort()).toEqual([...availableTools].sort());
  });
});

describe('the generated files', () => {
  // Byte equality, not "mentions every tool". The weaker assertion passes on a page that
  // dropped every control status and every source, and it is exactly those two that a hand
  // edit loses first — a generated file nobody can notice is stale is worse than no file.
  it('writes docs/TOOLS.md exactly as the generator produces it', async () => {
    expect(readRepoFile('docs/TOOLS.md')).toBe(await renderToolDocs());
  }, 15_000);

  it('writes the shipped tooltip projection exactly as the generator produces it', async () => {
    // This is the file the browser imports, and it is generated from the full record precisely
    // so that the record is edited in one place. If it is hand-edited and the test is relaxed,
    // the two halves start disagreeing and the tooltip describes a different tool from the doc.
    const { format, resolveConfig } = await import('prettier');
    const path = resolve(REPO_ROOT, 'src/tools/descriptions/tooltips.ts');
    const expected = await format(await renderTooltips(), {
      ...(await resolveConfig(path)),
      filepath: path,
    });
    expect(readRepoFile('src/tools/descriptions/tooltips.ts')).toBe(expected);
  });

  it('projects description values and the toolbar-declared shortcut into tooltips', async () => {
    const { descriptionKeyFor, toolTooltips } = await import('../../src/tools/descriptions/tooltips.ts');
    const toolbarShortcuts = new Map();
    for (const section of toolbarMap) {
      for (const group of section) {
        for (const entry of group) {
          toolbarShortcuts.set(descriptionKeyFor(entry.name, entry.figure), entry.shortcut);
        }
      }
    }
    const drifted = [];

    for (const [key, tool] of Object.entries(registeredDescriptions)) {
      const projection = toolTooltips[key];
      if (projection === undefined) {
        drifted.push(`${key}: in the record but not in the projection`);
        continue;
      }
      if (projection.summary !== tool.summary) drifted.push(`${key}: summary differs`);
      if (projection.implementation !== tool.implementation) drifted.push(`${key}: implementation differs`);
      if (projection.shortcut !== toolbarShortcuts.get(key)) drifted.push(`${key}: toolbar shortcut differs`);
    }

    expect(drifted).toEqual([]);
    expect(Object.keys(toolTooltips).sort()).toEqual(Object.keys(registeredDescriptions).sort());
  });

  it('does not project family-cycle keys or command shortcuts as a tool-tile shortcut', async () => {
    const { toolTooltips } = await import('../../src/tools/descriptions/tooltips.ts');

    for (const key of [
      'pencil',
      'color-replacement',
      'patch',
      'gradient',
      'sponge',
      'smudge',
      'rotate-view',
      'transform',
    ]) {
      expect(toolTooltips[key].shortcut, key).toBeUndefined();
    }
  });

  it('documents every tool', () => {
    const doc = readRepoFile('docs/TOOLS.md');
    const missing = availableTools.filter((name) => !doc.includes(`\`${name}\``));
    expect(missing, `tools absent from docs/TOOLS.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents the Star Tool and the generic Shape Tool group under distinct headings', () => {
    const doc = readRepoFile('docs/TOOLS.md');
    const headings = [...doc.matchAll(/^### (.+)$/gm)].map(([, heading]) => heading);

    expect(headings.filter((heading) => heading === 'Star Tool')).toHaveLength(1);
    expect(
      headings.filter((heading) => heading === 'Shape Tool (the Tools panel group; no entry by that name)')
    ).toHaveLength(1);
  });
});
