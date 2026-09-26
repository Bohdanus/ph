import { describe, expect, it } from 'vitest';
import { availableTools, extraTools, toolbarMap } from '../../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../../toolbar-mapping.ts';
import type { FigureType } from '../../../tools/shape.ts';

const allGroups: readonly (readonly ToolbarTool[])[] = toolbarMap.flat() as readonly (readonly ToolbarTool[])[];
const shapeFlyout = allGroups.find((group) => group.some((tool) => tool.name === 'shape'))!;

describe('toolbar mapping shape contract', () => {
  it('exposes the shape flyout', () => {
    expect(shapeFlyout).toBeDefined();
    expect(shapeFlyout.length).toBeGreaterThan(1);
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

  it('keeps extraTools disjoint from the shape tool', () => {
    expect(extraTools).not.toContain('shape');
  });
});
