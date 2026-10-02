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
