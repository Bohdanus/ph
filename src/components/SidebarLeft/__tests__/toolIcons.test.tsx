import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import toolIconsSource from '../toolIcons.tsx?raw';
import { toolIcons } from '../toolIcons.tsx';
import type { ToolIconName } from '../types';
import { toolbarMap } from '../../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../../toolbar-mapping.ts';

const allGroups = toolbarMap.flat() as readonly (readonly ToolbarTool[])[];
const allTools: readonly ToolbarTool[] = allGroups.flat();

/**
 * Eager glob of every icon module on disk. The key set is the real directory
 * listing, so a re-introduced icon file shows up here and fails the assertions
 * below.
 */
const iconModules = import.meta.glob('../icons/*.tsx', { eager: true });

/**
 * Hard-coded copy of the narrowed `ToolIconName` union. The imported type cannot be
 * enumerated at runtime, so a re-introduced (or dangling) icon name has to be added
 * here explicitly before the assertions below start failing.
 */
const toolIconNames = [
  'reposition',
  'rectangular-selection',
  'elliptical-selection',
  'single-row-marquee',
  'single-column-marquee',
  'freehand-lasso',
  'polygonal-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'quick-selection',
  'eyedropper',
  'color-sampler',
  'ruler',
  'eraser',
  'clone-stamp',
  'paint-bucket',
  'gradient',
  'sharpen',
  'smudge',
  'dodge',
  'burn',
  'sponge',
  'crop',
  'draw',
  'shape',
  'shape-rectangle',
  'shape-oval',
  'shape-line',
  'shape-triangle',
  'shape-polygon',
  'text',
  'color',
  'blur',
  'levels',
  'transform',
  'brush',
  'pencil',
  'color-replacement',
  'magic-eraser',
  'pen',
  'freeform-pen',
  'curvature-pen',
  'add-anchor-point',
  'delete-anchor-point',
  'convert-point',
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'line',
  'custom-shape',
] as const satisfies readonly ToolIconName[];

const shapeFigures = allTools.flatMap((tool) => (tool.figure ? [tool.figure] : []));

/** Widen the record so a name the union no longer allows can still be probed. */
const iconsByName = toolIcons as Record<string, unknown>;

const iconNameForFigure = (figure: string) => `shape-${figure}` as ToolIconName;

describe('toolIcons shape figure entries', () => {
  it('provides an icon for every figure of the narrowed union', () => {
    for (const figure of ['rectangle', 'oval', 'line', 'triangle', 'polygon'] as const) {
      const iconName = iconNameForFigure(figure);

      expect(Object.hasOwn(toolIcons, iconName)).toBe(true);
      expect(toolIcons[iconName]).toBeTypeOf('function');
    }
  });

  it('no longer provides a dedicated circle or square icon', () => {
    expect(Object.hasOwn(iconsByName, 'shape-square')).toBe(false);
    expect(Object.hasOwn(iconsByName, 'shape-circle')).toBe(false);
  });

  it('resolves an icon for every figure reachable from the toolbar mapping', () => {
    expect(shapeFigures.length).toBeGreaterThan(0);

    for (const figure of shapeFigures) {
      const iconName = iconNameForFigure(figure);

      expect(Object.hasOwn(toolIcons, iconName)).toBe(true);
      expect(toolIcons[iconName]).toBeTypeOf('function');
    }
  });

  it('resolves an icon for the tool name of every mapping entry', () => {
    for (const tool of allTools) {
      expect(iconsByName[tool.name]).toBeTypeOf('function');
    }
  });
});

describe('toolIcons and ToolIconName stay in sync', () => {
  it('exposes exactly one factory per ToolIconName', () => {
    expect(Object.keys(toolIcons).sort()).toEqual([...toolIconNames].sort());
  });

  it('resolves every declared icon name to a factory', () => {
    for (const name of toolIconNames) {
      expect(toolIcons[name as ToolIconName]).toBeTypeOf('function');
    }
  });

  it('leaves no dangling or missing entries after the circle and square deletion', () => {
    const declared = new Set<string>(toolIconNames);
    const implemented = new Set(Object.keys(toolIcons));

    expect([...implemented].filter((name) => !declared.has(name))).toEqual([]);
    expect([...declared].filter((name) => !implemented.has(name))).toEqual([]);
  });

  it('has no icon name referencing a legacy circle or square figure', () => {
    const legacyPattern = /circle|square/i;

    for (const name of Object.keys(toolIcons)) {
      expect(name).not.toMatch(legacyPattern);
    }
  });
});

describe('tool icon factories', () => {
  it('renders an accessible svg for every icon name', () => {
    for (const name of toolIconNames) {
      const { container, unmount } = render(toolIcons[name as ToolIconName]({ title: `${name} icon` }));
      const svg = container.querySelector('svg');

      expect(svg).toBeTruthy();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('viewBox', '0 0 32 32');
      expect(svg?.querySelector('title')?.textContent).toBe(`${name} icon`);
      expect(svg?.childElementCount ?? 0).toBeGreaterThan(0);
      unmount();
    }
  });

  it('renders a distinct drawing for the rectangle, oval and line shape icons', () => {
    const drawings = (['shape-rectangle', 'shape-oval', 'shape-line'] as const).map((name) => {
      const { container, unmount } = render(toolIcons[name]({ title: name }));
      const drawing = container.querySelector('svg')?.innerHTML ?? '';
      unmount();
      return drawing;
    });

    expect(new Set(drawings).size).toBe(3);
    expect(drawings.some((drawing) => drawing.includes('<rect'))).toBe(true);
    expect(drawings.some((drawing) => drawing.includes('<ellipse'))).toBe(true);
    expect(drawings.every((drawing) => drawing.includes('path'))).toBe(false);
  });
});

describe('deleted circle and square icon modules', () => {
  it('sees the icon directory on disk, so the deletion checks are not vacuous', () => {
    expect(Object.keys(iconModules).length).toBeGreaterThan(10);
    expect(Object.keys(iconModules)).toContain('../icons/ShapeIcon.tsx');
  });

  it.each(['CircleShapeIcon', 'SquareShapeIcon'])('no longer ships %s.tsx on disk', (moduleName) => {
    expect(Object.keys(iconModules)).not.toContain(`../icons/${moduleName}.tsx`);
  });

  it('does not import the deleted icon modules in toolIcons.tsx', () => {
    expect(toolIconsSource).not.toContain('CircleShapeIcon');
    expect(toolIconsSource).not.toContain('SquareShapeIcon');
    expect(toolIconsSource).not.toMatch(/shape-(square|circle)/);
  });

  it('only imports icon modules that still exist on disk', () => {
    const importedModules = [...toolIconsSource.matchAll(/from '\.\/icons\/([A-Za-z0-9_]+)'/g)].map(
      (match) => `${match[1]}.tsx`
    );

    expect(importedModules.length).toBeGreaterThan(0);
    for (const moduleName of importedModules) {
      expect(Object.keys(iconModules)).toContain(`../icons/${moduleName}`);
    }
  });

  it('leaves no orphaned circle or square icon module behind the deletion', () => {
    const orphans = Object.keys(iconModules).filter((modulePath) => /circle|square/i.test(modulePath));

    expect(orphans).toEqual([]);
  });
});
