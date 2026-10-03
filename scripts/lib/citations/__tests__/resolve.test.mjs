import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  clearIndex,
  locateTarget,
  resolveCitation,
  resolveHeadingAtLine,
  resolveSymbolAtLine,
  citationsIn,
  CITATION_EXTENSION_SOURCE,
} from '../resolve.mjs';

/**
 * The resolver's own tests, and the reason they build a throwaway repository rather than reading
 * this one.
 *
 * Every assertion below is about a position in a file the test itself wrote, which is the only way
 * to pin the mapping between a line and a name without that line moving the next time a source file
 * gains an import. A test written against `src/` would need editing every time the tree moves, and
 * would fail for the same reason a line-number citation does — which would be a poor advertisement
 * for the tool that exists to end those.
 *
 * `clearIndex` is exported for the same reason it exists in the resolver: the basename index is
 * cached, and a test that writes a file whose basename the previous test used would resolve to the
 * wrong one and pass for the wrong reason.
 */
const scaffold = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'citation-resolver-'));
  mkdirSync(join(root, 'src', 'tools'), { recursive: true });
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  clearIndex();
  return root;
};

const FIXTURE = {
  'src/tools/draw.ts': [
    'export const DEFAULT_ALPHA = 90;',
    '',
    'export function buildStroke(points: number[]) {',
    '  return points.map((p) => p * DEFAULT_ALPHA);',
    '}',
    '',
    'export const clampOpacity = (value: number) => (',
    '  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0',
    ');',
  ].join('\n'),
  'src/components/Panel.tsx': ['export function PanelToolbar() {', '  return <div className="panel" />;', '}'].join(
    '\n'
  ),
  'src/reducer.ts': [
    'export function reduce(state: string, action: string) {',
    '  switch (action) {',
    "    case 'rename-layer':",
    '      return state;',
    "    case 'rasterize-layer':",
    '      return state;',
    '    default:',
    '      return state;',
    '  }',
    '}',
  ].join('\n'),
  'src/notes.test.ts': [
    "import { describe, it, expect } from 'vitest';",
    '',
    "describe('the tool bar', () => {",
    "  it('renders one button per tool', () => {",
    '    expect(true).toBe(true);',
    '  });',
    '',
    "  it.skip('renders a tooltip for every tool', () => {",
    '    expect(true).toBe(true);',
    '  });',
    '});',
  ].join('\n'),
};

describe('resolveSymbolAtLine', () => {
  it('names the declaration a line sits inside', () => {
    const root = scaffold(FIXTURE);
    const target = join(root, 'src/tools/draw.ts');
    expect(resolveSymbolAtLine(target, 3).name).toBe('buildStroke');
    expect(resolveSymbolAtLine(target, 8).name).toBe('clampOpacity');
    expect(resolveSymbolAtLine(target, 1).name).toBe('DEFAULT_ALPHA');
  });

  it('names the component a JSX line belongs to', () => {
    // The line is the `return`, which is inside the function body and not inside any expression a
    // reader would call a unit. The component is still the honest answer, and it is what the
    // document was naming when it wrote a line number.
    const root = scaffold(FIXTURE);
    expect(resolveSymbolAtLine(join(root, 'src/components/Panel.tsx'), 2).name).toBe('PanelToolbar');
  });

  it('cites a switch arm by the value it dispatches on', () => {
    // A reducer with one subject and many arms has many identities, and a sentence that cited a
    // line inside `case 'rename-layer'` is about the rename.
    const root = scaffold(FIXTURE);
    expect(resolveSymbolAtLine(join(root, 'src/reducer.ts'), 4)).toMatchObject({
      kind: 'switch-arm',
      name: "'rename-layer'",
    });
  });

  it('cites a test by its case title, through `it.skip`', () => {
    // Every case in a suite is inside one `describe`, so a resolver that stopped at the `describe`
    // would make every citation in the file say the same thing. The `.skip` form is here because
    // it is a member expression and a naive unwrap misses it.
    const root = scaffold(FIXTURE);
    const target = join(root, 'src/notes.test.ts');
    expect(resolveSymbolAtLine(target, 4)).toMatchObject({
      kind: 'test-title',
      name: 'renders one button per tool',
    });
    expect(resolveSymbolAtLine(target, 8)).toMatchObject({
      kind: 'test-title',
      name: 'renders a tooltip for every tool',
    });
  });

  it('falls back to the nearest declaration, and says how far away it was', () => {
    // The drift the migration is measuring: a citation that lands on a comment or a blank line has
    // no enclosing declaration, and the author's intent is the declaration it drifted off. The
    // distance is reported because "near the declaration" and "is the declaration" are different
    // answers and a reviewer needs to be able to tell them apart.
    const root = scaffold({
      'src/drift.ts': ['export const keep = 1;', '', '', '/**', ' * A comment.', ' */', 'const after = 2;'].join('\n'),
    });
    const resolved = resolveSymbolAtLine(join(root, 'src/drift.ts'), 5);
    expect(resolved.kind).toBe('nearest');
    expect(resolved.name).toBe('after');
    expect(resolved.distance).toBe(2);
  });

  it('reports a file that does not exist rather than inventing a name', () => {
    expect(resolveSymbolAtLine('/definitely/not/here.ts', 1).kind).toBe('missing-file');
  });
});

describe('resolveHeadingAtLine', () => {
  it('numbers a section whose heading carries a number', () => {
    expect(resolveHeadingAtLine('## 42. Something\n\nbody\n', 3)).toMatchObject({
      kind: 'numbered-section',
      name: '42',
    });
  });

  it('cites an unnumbered heading by its text', () => {
    expect(resolveHeadingAtLine('## Citations\n\nbody\n', 3)).toMatchObject({ kind: 'heading', name: 'Citations' });
  });

  it('takes the nearest preceding heading, so a citation just under one finds it', () => {
    const text = ['# Top', '', '## First', '', 'body', '', '## Second', '', 'body'].join('\n');
    expect(resolveHeadingAtLine(text, 6).name).toBe('First');
    expect(resolveHeadingAtLine(text, 9).name).toBe('Second');
  });
});

describe('locateTarget', () => {
  it('resolves a bare basename when exactly one tracked file has it', () => {
    // Two thirds of this repository's citations name a file the way a reader names it, and a
    // resolver that only understood full paths would report all of them as broken.
    const root = scaffold(FIXTURE);
    expect(locateTarget(root, 'draw.ts').path).toBe('src/tools/draw.ts');
  });

  it('refuses to guess when two files share the basename', () => {
    const root = scaffold({ ...FIXTURE, 'src/other/draw.ts': 'export const other = 1;' });
    mkdirSync(join(root, 'src', 'other'), { recursive: true });
    writeFileSync(join(root, 'src/other/draw.ts'), 'export const other = 1;');
    clearIndex();
    // A first-match guess would produce a confidently wrong citation, which is the failure the
    // migration exists to remove, so the candidates come back for a human instead.
    expect(locateTarget(root, 'draw.ts').candidates?.length).toBeGreaterThan(1);
  });
});

describe('resolveCitation', () => {
  it('answers an ambiguous basename only when one candidate declares the cited line', () => {
    const root = scaffold({ ...FIXTURE, 'src/other/draw.ts': 'export const other = 1;' });
    mkdirSync(join(root, 'src', 'other'), { recursive: true });
    writeFileSync(join(root, 'src/other/draw.ts'), 'export const other = 1;');
    clearIndex();
    // Line 3 only exists in the real module, so the ambiguity resolves into a fact rather than a
    // question. Line 1 exists in both, so it stays a question.
    expect(resolveCitation(root, 'draw.ts', 3).proposal).toContain('buildStroke');
    expect(resolveCitation(root, 'draw.ts', 1).kind).toBe('ambiguous-file');
  });

  it('proposes `§N` for a numbered markdown section', () => {
    const root = scaffold({ ...FIXTURE, 'HANDOFF.md': '## 7. A finding\n\nbody\n' });
    expect(resolveCitation(root, 'HANDOFF.md', 3).proposal).toBe('`HANDOFF.md` §7');
  });
});

describe('citationsInProbe', () => {
  it('reads a line, a split range and a bare continuation as four citations', () => {
    // The `-`:9` half of `b.ts:2`-`:9` is a position of its own, in the same file, and a sweep that
    // collapsed the pair would resolve the range's END but never its START — reporting a document as
    // half-migrated while its opening half still carried the banned form.
    const found = citationsIn('see `a.ts:1` and `b.ts:2`-`:9` and `:11`');
    expect(found.map((entry) => [entry.target, entry.line])).toEqual([
      ['a.ts', 1],
      ['b.ts', 2],
      ['b.ts', 9],
      ['b.ts', 11],
    ]);
  });

  it('does not read `node:fs` or a URL port as a citation', () => {
    expect(citationsIn("from 'node:fs' and http://localhost:5173/")).toEqual([]);
  });
});

/**
 * The three properties the sweep and the gate have to SHARE, each of which was a divergence.
 *
 * Every other test in this file asserts a resolution. These assert that the thing doing the
 * resolving agrees with the thing judging the result, which is the failure mode that survives a
 * green suite: a resolver that cannot see a citation the gate can see reports its document clean,
 * and the gate's red is the only thing that disagrees.
 */
describe('the sweep and the gate agree', () => {
  it('reads a citation the gate reads, for every extension the gate knows', () => {
    // The drift this pins had seven extensions on the gate's side and none on the sweep's:
    // `logo.svg:12` was reported by the gate and invisible to the worklist built for it.
    for (const extension of CITATION_EXTENSION_SOURCE.split('|')) {
      const found = citationsIn(`see \`logo.${extension}:12\``);
      expect(found.map((entry) => entry.target)).toContain(`logo.${extension}`);
    }
  });

  it('resolves a citation in a directory that is not a git checkout', () => {
    // `scaffold` writes into a temp directory, so every test above already runs the fallback —
    // which is exactly why it went unasserted: it was exercised on every run and checked by none.
    // Asserting the resolution is what turns "it did not throw" into "it works", and an untracked
    // file is the case only the walk can satisfy.
    const root = scaffold(FIXTURE);
    clearIndex();
    expect(locateTarget(root, 'draw.ts').path).toBe('src/tools/draw.ts');
    expect(resolveCitation(root, 'draw.ts', 3).proposal).toContain('buildStroke');
  });

  it('does not read a fenced quotation as a citation', () => {
    // The fence is the one exemption, and the sweep used to ignore it: a reviewer following the
    // worklist would have been asked to "fix" the quoted `:89` inside a `HANDOFF.md` entry whose
    // subject IS that citation, where the correct action is to change nothing.
    const quoted = '```\nhistory-replay.ts:89 is off by twenty\n```\nand `other.ts:4` too';
    expect(citationsIn(quoted).map((entry) => entry.raw)).toEqual(['`other.ts:4`']);
  });
});

describe('a continuation without an antecedent on its line', () => {
  it('does not bind to a citation from an earlier line', () => {
    // The bug this pins: `lastTarget` outlived the line, so a bare `:NNN` bound to the last FULL
    // citation anywhere above it. Three migration sessions were misled by proposals that named a
    // real symbol in a real file and were answering a different sentence.
    const found = citationsIn('`a.ts:1` is one thing\n\nand `:9` is another, with no file beside it');
    expect(found.map((entry) => [entry.raw, entry.target])).toEqual([
      ['`a.ts:1`', 'a.ts'],
      ['`:9`', undefined],
    ]);
    expect(found[1].unresolvedContinuation).toBe(true);
  });

  it('reports no-antecedent rather than throwing or naming a file that exists', () => {
    // `untracked-file` would be a lie here: the target was never missing, it was never stated.
    const root = scaffold(FIXTURE);
    const resolved = resolveCitation(root, undefined, 9);
    expect(resolved.kind).toBe('no-antecedent');
    expect(resolved.proposal).toBeUndefined();
  });

  it('still binds a continuation that shares its line with its antecedent', () => {
    // The shape the per-line scoping is FOR. `settings.ts:70` and the `:84` beside it are one
    // citation each, and the second is meaningless without the first.
    const found = citationsIn('`settings.ts:70` is rect, `:84` is sortRoundRect');
    expect(found.map((entry) => entry.target)).toEqual(['settings.ts', 'settings.ts']);
    expect(found[1].continuation).toBe(true);
    expect(found[1].unresolvedContinuation).toBe(false);
  });
});

describe('a comma-separated list inside one token', () => {
  it('reads every position, not just the first', () => {
    // The shape two migration sessions found in real documents after the gate had been green for
    // days: one backticked token holding three coordinates. The single-number pattern matched the
    // first and left the rest, so a document could carry `:217,:219-221` indefinitely with neither
    // the sweep nor the gate reporting anything.
    expect(citationsIn('the guards are `:217,:219-221` here').map((e) => [e.line, e.endLine])).toEqual([
      [217, undefined],
      [219, 221],
    ]);
    expect(citationsIn('`x.ts:1,2,3` form').map((e) => [e.target, e.line])).toEqual([
      ['x.ts', 1],
      ['x.ts', 2],
      ['x.ts', 3],
    ]);
  });

  it('keeps a RANGE as one citation', () => {
    // The rule says a range names ONE enclosing unit, so this is a judgement about a span rather than
    // two positions. Expanding it would hand a reviewer two lookups for one claim.
    const found = citationsIn('`x.ts:12-20` is one span');
    expect(found).toHaveLength(1);
    expect([found[0].line, found[0].endLine]).toEqual([12, 20]);
  });

  it('binds a comma continuation list to the file named on its line', () => {
    const found = citationsIn('`u.ts:5` and `:8,:12-14` beside it');
    expect(found.map((e) => [e.target, e.line, e.endLine])).toEqual([
      ['u.ts', 5, undefined],
      ['u.ts', 8, undefined],
      ['u.ts', 12, 14],
    ]);
  });
});
