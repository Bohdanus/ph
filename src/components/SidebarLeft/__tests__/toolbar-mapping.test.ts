import { describe, expect, it } from 'vitest';
import { availableTools, extraTools, toolbarMap } from '../../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../../toolbar-mapping.ts';
import { isFigureType, type FigureType } from '../../../tools/shape.ts';
import { toolIcons } from '../toolIcons.tsx';
import type { ToolIconName } from '../types.ts';

const allGroups: readonly (readonly ToolbarTool[])[] = toolbarMap.flat() as readonly (readonly ToolbarTool[])[];
const shapeFlyout = allGroups.find((group) => group.some((tool) => tool.name === 'shape'))!;
const allTools: readonly ToolbarTool[] = allGroups.flat();

/** Every `name` on the rail, from the `name:` fields and never from a label. */
const railNames: readonly string[] = [...new Set(allTools.map((tool) => tool.name))];

/** Every `figure` on the rail, widened to `string` so a `ToolName` can be tested against it. */
const railFigures: readonly string[] = [
  ...new Set(allTools.map((tool) => tool.figure).filter((figure): figure is FigureType => Boolean(figure))),
];

/**
 * The five shape figure aliases, and the only ids in `availableTools` that carry no rail
 * `name`. They are not `extraTools`: the Rectangle, Ellipse, Triangle, Polygon and Line
 * TILES are all in `toolbarMap`, as `figure` values on entries whose `name` is `shape`.
 *
 * Spelled out rather than derived, because it cannot be derived. `toolbarMap` writes the
 * figure as `oval` while the registry calls that tool `ellipse`, so "is this id on the rail,
 * as a name or as a figure" has no rule to apply to it — the mapping between the two
 * vocabularies is data, and data has to be written down. The set is pinned as exactly these
 * five by the assertions below, so a sixth alias cannot join the exception silently.
 */
const figureAliases = ['rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const;
const figureAliasSet: ReadonlySet<string> = new Set(figureAliases);

/**
 * Hard-coded copy of the narrowed `FigureType` union plus the expected shape flyout.
 * The imported type cannot be enumerated at runtime, so the contract is spelled out.
 */
const figureTypes = ['line', 'rectangle', 'oval', 'triangle', 'polygon'] as const;
const expectedShapeFlyout = [
  { label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' },
  { label: 'Ellipse Tool', name: 'shape', figure: 'oval' },
  { label: 'Line Tool', name: 'shape', figure: 'line' },
  { label: 'Triangle Tool', name: 'shape', figure: 'triangle' },
  { label: 'Polygon Tool', name: 'shape', figure: 'polygon' },
  { label: 'Custom Shape Tool', name: 'custom-shape' },
] as const;

describe('toolbar mapping shape contract', () => {
  it('exposes the shape flyout', () => {
    // `shapeFlyout` is `find(...)!`, so `toBeDefined()` on it can never fail and asserted
    // nothing. The claim worth making here is the COUNT — six entries, which is the shape
    // flyout's whole surface — and it is a different claim from the exact array asserted in
    // `toolbar mapping shape group contract`, which says which six and in what order.
    expect(shapeFlyout).toHaveLength(6);
  });

  it('has no dedicated Circle or Square tools', () => {
    const labels = shapeFlyout.map((tool) => tool.label);
    expect(labels).not.toContain('Square Tool');
    expect(labels).not.toContain('Circle Tool');
  });

  it('never uses a legacy figure on any toolbar entry', () => {
    const legacyFigures = ['circle', 'square'];
    for (const group of allGroups) {
      for (const tool of group) {
        if (tool.figure) expect(legacyFigures).not.toContain(tool.figure);
      }
    }
  });

  it('lists Rectangle first and Ellipse second so the tile and flyout match', () => {
    expect(shapeFlyout.slice(0, 2)).toEqual([
      { label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' },
      { label: 'Ellipse Tool', name: 'shape', figure: 'oval' },
    ]);
  });

  it('makes Rectangle the default tile for the shape group', () => {
    expect(shapeFlyout[0].label).toBe('Rectangle Tool');
    expect(shapeFlyout[0].name).toBe('shape');
  });

  it('keeps Triangle, Polygon, Line and Custom Shape in the flyout', () => {
    const labels = shapeFlyout.map((tool) => tool.label);
    expect(labels).toContain('Triangle Tool');
    expect(labels).toContain('Polygon Tool');
    expect(labels).toContain('Line Tool');
    expect(labels).toContain('Custom Shape Tool');
  });

  it('orders Rectangle, Ellipse and Line so the flyout matches the Shift+U cycle prefix', () => {
    const figureOrder = shapeFlyout
      .map((tool) => tool.figure)
      .filter((figure): figure is FigureType => Boolean(figure))
      .map((figure) => (figure === 'oval' ? 'ellipse' : figure));

    expect(figureOrder.slice(0, 3)).toEqual(['rectangle', 'ellipse', 'line']);
  });

  it('routes every shape entry through the shared shape tool except custom shape', () => {
    for (const tool of shapeFlyout) {
      expect(['shape', 'custom-shape']).toContain(tool.name);
    }
  });

  it('only declares U as the shape shortcut', () => {
    const shortcuts = shapeFlyout.map((tool) => tool.shortcut).filter(Boolean);
    expect(shortcuts).toEqual(['U']);
  });

  it('keeps the rectangle and ellipse tool-name aliases available', () => {
    expect(availableTools).toContain('rectangle');
    expect(availableTools).toContain('ellipse');
  });

  it('does not list square or circle as tool names', () => {
    expect(availableTools).not.toContain('square');
    expect(availableTools).not.toContain('circle');
  });

  it('lists exactly the registered tools that have no Tools-rail entry', () => {
    // Forward direction: nothing in `extraTools` is a tile. Checked against BOTH `name` and
    // `figure`, because "no entry anywhere in `toolbarMap`" is the promise the export's own
    // comment makes and a `figure` is an entry.
    expect([...extraTools].filter((id) => railNames.includes(id) || railFigures.includes(id))).toEqual([]);

    // Converse direction: an id dropped from the rail without being recorded here is a
    // failure too, and this is the direction that makes the export a pin rather than a
    // description of itself.
    const absentFromRail = [...new Set(availableTools)].filter((name) => !railNames.includes(name));
    expect(
      absentFromRail.filter((name) => !figureAliasSet.has(name)),
      `registered tools with no rail entry that ${extraTools.join(', ')} does not list, ignoring the five shape figure aliases`
    ).toEqual([...extraTools]);
  });

  it('keeps the figure-alias exception to that list at exactly the five shape figures', () => {
    const absentFromRail = [...new Set(availableTools)].filter((name) => !railNames.includes(name));
    const exempt = absentFromRail.filter((name) => figureAliasSet.has(name));

    expect(exempt).toEqual([...figureAliases]);
    // Each exempt id really is a figure of the `shape` flyout, so the exemption is justified
    // by the map rather than by the size of the list. `ellipse` is the one that cannot be
    // matched directly, which is why `figureAliases` is a written list at all.
    const shapeFigures = shapeFlyout
      .map((tool) => tool.figure)
      .filter((figure): figure is FigureType => Boolean(figure));
    for (const alias of figureAliases) {
      expect(shapeFigures, `${alias}: not a figure of the shape flyout, so the exemption is unjustified`).toContain(
        alias === 'ellipse' ? 'oval' : alias
      );
    }
    expect(railNames).toContain('custom-shape');
  });
});

describe('toolbar mapping shape group contract', () => {
  it('lists the shape flyout in the exact expected order and shape', () => {
    expect([...shapeFlyout]).toEqual(expectedShapeFlyout);
  });

  it('declares a shortcut only for the Rectangle entry', () => {
    const withShortcut = shapeFlyout.filter((tool) => Object.hasOwn(tool, 'shortcut'));

    expect(withShortcut.map((tool) => tool.label)).toEqual(['Rectangle Tool']);
    expect(shapeFlyout.filter((tool) => tool.shortcut !== undefined).map((tool) => tool.shortcut)).toEqual(['U']);
  });

  it('mentions circle or square nowhere in the whole mapping', () => {
    const legacyPattern = /circle|square/i;
    const offenders = allTools.filter(
      (tool) => legacyPattern.test(tool.label) || legacyPattern.test(tool.name) || legacyPattern.test(tool.figure ?? '')
    );

    expect(offenders).toEqual([]);
    for (const group of allGroups) {
      for (const tool of group) {
        expect(JSON.stringify(tool)).not.toMatch(legacyPattern);
      }
    }
  });

  it('gives the whole mapping exactly one U shortcut, on the Rectangle figure', () => {
    const uEntries = allTools.filter((tool) => tool.shortcut === 'U');

    expect(uEntries).toHaveLength(1);
    expect(uEntries[0]).toEqual({ label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' });
  });

  it('keeps every shape figure inside the narrowed union and leaves custom shape without one', () => {
    for (const tool of shapeFlyout) {
      if (tool.name === 'custom-shape') {
        expect(Object.hasOwn(tool, 'figure')).toBe(false);
        continue;
      }

      expect(tool.name).toBe('shape');
      expect(figureTypes).toContain(tool.figure);
      expect(isFigureType(tool.figure)).toBe(true);
    }
  });

  it('uses unique labels and unique figures inside the shape group', () => {
    const labels = shapeFlyout.map((tool) => tool.label);
    const figures = shapeFlyout.map((tool) => tool.figure).filter((figure): figure is FigureType => Boolean(figure));

    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(figures).size).toBe(figures.length);
    expect(figures.sort()).toEqual([...figureTypes].sort());
  });

  it('exposes every figure of the narrowed union exactly once in the shape group', () => {
    const figures = shapeFlyout.flatMap((tool) => (tool.figure ? [tool.figure] : []));

    expect([...figures].sort()).toEqual([...figureTypes].sort());
  });
});

describe('toolbar mapping shortcut contract', () => {
  /**
   * No two entries may claim the same key.
   *
   * WHY THIS IS NOT REDUNDANT WITH THE KEYMAP. `SidebarLeft` renders a declared `shortcut` as
   * a `<kbd>` badge on the flyout item and passes the same string to `ToolTooltip`, so a
   * declared shortcut is a promise the user reads. The runtime keymap lives in
   * `AppKeyboardShortcuts.tsx` as inline `useKeyDownShortcut` handlers and cannot be
   * enumerated as data, so nothing in the suite could previously ask "does every badge the
   * rail renders correspond to a key that selects this tool?".
   *
   * This pins the half of that which is a pure function of the mapping: two entries cannot
   * both claim one key. That was violated exactly once — `Draw Tool` declared `B`, the Brush's
   * key, and `b`/`shift+b` both resolve to `selectBrushTool`, so the badge was a falsehood
   * rather than a duplicate. The invariant is deliberately about the CLAIM, not about
   * reachability, so it stays checkable without mounting the app.
   *
   * Not vacuous: the offenders are collected by name and label, so a failure says which two
   * entries collided, and the pre-fix state reports `B` on both Brush and Draw.
   */
  it('never declares the same shortcut on two entries', () => {
    const claimed = new Map<string, string[]>();

    for (const tool of allTools) {
      if (tool.shortcut === undefined) continue;
      const labels = claimed.get(tool.shortcut) ?? [];
      labels.push(tool.label);
      claimed.set(tool.shortcut, labels);
    }

    const collisions = [...claimed.entries()]
      .filter(([, labels]) => labels.length > 1)
      .map(([shortcut, labels]) => `${shortcut}: ${labels.join(' and ')}`);

    expect(collisions).toEqual([]);
  });

  /**
   * The same invariant, stated from the other side: a key is claimed at most once, counted
   * rather than grouped. This is the assertion that would survive a future edit that made
   * `allTools` contain a tool twice, where the grouped form above would report one pair and
   * this one reports the count.
   */
  it('claims each shortcut key at most once across the whole mapping', () => {
    const keys = allTools.map((tool) => tool.shortcut).filter((key): key is string => key !== undefined);

    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * The Draw tool is the entry the collision was found on, and it is the one tool in the
   * mapping that is registered with `ToolArgsByName` and reachable from the rail while having
   * no keyboard binding at all. Pinning that it declares no shortcut keeps the badge off it:
   * a shortcut added here without a matching `useKeyDownShortcut` is the exact defect this
   * describe block exists to prevent, and it is a one-line regression.
   */
  it('gives the Draw tool no shortcut, because no key selects it', () => {
    const draw = allTools.filter((tool) => tool.name === 'draw');

    expect(draw).toHaveLength(1);
    expect(draw[0].label).toBe('Draw Tool');
    expect(draw[0].shortcut).toBeUndefined();
  });
});

describe('toolbar mapping icon contract', () => {
  /**
   * Every mapped tool resolves to a real icon, because `SidebarLeft.getToolIcon` returns the
   * lookup and the rail renders the result as a component. A tool added to the mapping
   * without an icon therefore has no failure of its own: it surfaces as React's "Element
   * type is invalid" render error inside every suite that mocks `toolIcons`, which is a
   * cryptic way to learn that a name is misspelled, once per suite. This file imports the
   * real mapping and the real icon module, so the name can be reported once, here.
   *
   * The key is built the way production builds it — a template literal for a figure
   * (`shape-${figure}`), the bare tool name otherwise. A hand-written union of names cannot
   * express that form, so enumerating names and checking each is a different and weaker
   * test: it would never look at a figure tool.
   *
   * `toolIcons` is typed `Record<ToolIconName, SvgIconFactory>`, which asserts the lookup is
   * total, so the compiler cannot catch a name that is missing at runtime.
   */
  it('resolves every mapped tool to a real icon component', () => {
    const unresolved: string[] = [];

    for (const tool of allTools) {
      const preferredKey = tool.figure ? `shape-${tool.figure}` : tool.name;
      const preferred = toolIcons[preferredKey as ToolIconName];
      if (typeof preferred === 'function') continue;

      // The PREFERRED key is what is checked, and not merely whatever production ends up
      // rendering. A figure with no `shape-` icon of its own falls through to the generic
      // `shape` icon rather than crashing, so a resolution-only assertion would pass on
      // exactly the authoring mistake a figure tool is most likely to carry — verified by
      // mutating this key to a misspelling, which the fall-through swallowed. The
      // fall-through is a tolerance; a tolerance is not a pin. Both shapes are reported by
      // tool name and by the key that was missing.
      const resolved = toolIcons[tool.name];
      unresolved.push(
        typeof resolved === 'function'
          ? `${tool.label} -> no ${preferredKey} icon; renders the generic ${tool.name} icon`
          : `${tool.label} -> neither ${preferredKey} nor ${tool.name} resolves to an icon`
      );
    }

    expect(unresolved).toEqual([]);
  });
});
