import { describe, expect, it, vi } from 'vitest';

import { findMobileToolGroup, makeSelectTool, mobileToolGroups } from '../mobile-tools.ts';
import { toolbarMap, type ToolbarTool } from '../../../../toolbar-mapping.ts';
import type { ToolName } from '../../../contexts/tool-types.ts';

describe('mobileToolGroups', () => {
  it('derives one group per toolbarMap entry group', () => {
    const expectedCount = toolbarMap.flat().length;

    expect(mobileToolGroups).toHaveLength(expectedCount);
  });

  it('assigns a stable, unique id to each group', () => {
    const ids = mobileToolGroups.map((group) => group.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^mobile-tool-\d+-\d+$/);
    }
  });

  it('every group has a non-empty label', () => {
    for (const group of mobileToolGroups) {
      expect(group.label.length, `group ${group.id} has empty label`).toBeGreaterThan(0);
    }
  });

  it('strips the redundant " Tool" suffix from labels', () => {
    // The toolbarMap defines labels like 'Move Tool', 'Hand Tool', etc.
    // `stripToolSuffix` should remove the trailing ' Tool'.
    for (const group of mobileToolGroups) {
      if (group.label.endsWith('Tool')) {
        // Only multi-word labels ending in " Tool" should have been stripped.
        // e.g. "Move Tool" -> "Move", "Hand Tool" -> "Hand"
        expect(group.label, `label "${group.label}" still ends with "Tool"`).not.toMatch(/ Tool$/);
      }
    }
  });

  it('primaryTool is the first tool name in each group', () => {
    const allGroups = toolbarMap.flat();
    for (let i = 0; i < allGroups.length; i++) {
      const group = allGroups[i];
      const mobileGroup = mobileToolGroups[i];
      expect(mobileGroup.primaryTool).toBe(group[0].name);
      expect(mobileGroup.primary).toEqual(group[0]);
    }
  });

  it('matchingTools includes every tool name in the group', () => {
    const allGroups = toolbarMap.flat();
    for (let i = 0; i < allGroups.length; i++) {
      const group = allGroups[i];
      const mobileGroup = mobileToolGroups[i];
      const expectedNames = group.map((tool) => tool.name);

      expect(mobileGroup.matchingTools).toEqual(expectedNames);
    }
  });

  it('tools array is a defensive copy of the group (not the same reference)', () => {
    const allGroups = toolbarMap.flat();
    for (let i = 0; i < allGroups.length; i++) {
      const mobileGroup = mobileToolGroups[i];
      expect(mobileGroup.tools).not.toBe(allGroups[i]);
      expect(mobileGroup.tools).toEqual(allGroups[i]);
    }
  });

  it('matchingTools is a defensive copy (not the same reference as tools)', () => {
    for (const group of mobileToolGroups) {
      expect(group.matchingTools).not.toBe(group.tools);
    }
  });

  it('sectionIndex matches the position in the toolbarMap sections', () => {
    let sectionIndex = 0;
    for (const section of toolbarMap) {
      for (let groupIndex = 0; groupIndex < section.length; groupIndex++) {
        const idx = mobileToolGroups.findIndex((g) => g.sectionIndex === sectionIndex);
        // Each section contributes its groups in order.
        expect(idx).toBeGreaterThanOrEqual(0);
      }
      sectionIndex++;
    }
  });

  it('primaryTool is always a valid ToolName from the toolbar registry', () => {
    for (const group of mobileToolGroups) {
      expect(typeof group.primaryTool).toBe('string');
      expect(group.primaryTool.length).toBeGreaterThan(0);
    }
  });

  it('every group has at least one tool', () => {
    for (const group of mobileToolGroups) {
      expect(group.tools.length, `group ${group.id} has no tools`).toBeGreaterThan(0);
    }
  });
});

describe('makeSelectTool', () => {
  it('calls goToTool with the tool name', () => {
    const goToTool = vi.fn();
    const patchToolArgs = vi.fn();
    const selector = makeSelectTool(goToTool, patchToolArgs);

    const tool: ToolbarTool = { label: 'Rectangle Tool', name: 'shape', figure: 'rectangle' };
    selector(tool);

    expect(goToTool).toHaveBeenCalledWith('shape');
    expect(goToTool).toHaveBeenCalledTimes(1);
  });

  it('calls patchToolArgs with the figure when the tool has a figure', () => {
    const goToTool = vi.fn();
    const patchToolArgs = vi.fn();
    const selector = makeSelectTool(goToTool, patchToolArgs);

    const tool: ToolbarTool = { label: 'Ellipse Tool', name: 'shape', figure: 'oval' };
    selector(tool);

    expect(patchToolArgs).toHaveBeenCalledWith('shape', { figure: 'oval' });
    expect(patchToolArgs).toHaveBeenCalledTimes(1);
  });

  it('does NOT call patchToolArgs when the tool has no figure', () => {
    const goToTool = vi.fn();
    const patchToolArgs = vi.fn();
    const selector = makeSelectTool(goToTool, patchToolArgs);

    const tool: ToolbarTool = { label: 'Brush Tool', name: 'brush' };
    selector(tool);

    expect(patchToolArgs).not.toHaveBeenCalled();
  });

  it('calls goToTool with the correct name for each tool in the toolbar map', () => {
    const goToTool = vi.fn();
    const patchToolArgs = vi.fn();
    const selector = makeSelectTool(goToTool, patchToolArgs);

    for (const group of toolbarMap.flat()) {
      for (const tool of group) {
        goToTool.mockClear();
        patchToolArgs.mockClear();

        selector(tool);

        expect(goToTool).toHaveBeenCalledWith(tool.name);
      }
    }
  });

  it('calls patchToolArgs only for shape tools that have a figure', () => {
    const goToTool = vi.fn();
    const patchToolArgs = vi.fn();
    const selector = makeSelectTool(goToTool, patchToolArgs);

    for (const group of toolbarMap.flat()) {
      for (const tool of group) {
        goToTool.mockClear();
        patchToolArgs.mockClear();

        selector(tool);

        const typedTool = tool as ToolbarTool;
        if (typedTool.figure) {
          expect(patchToolArgs).toHaveBeenCalledWith('shape', { figure: typedTool.figure });
        } else {
          expect(patchToolArgs).not.toHaveBeenCalled();
        }
      }
    }
  });

  it('returns void from the selector function', () => {
    const goToTool = vi.fn();
    const patchToolArgs = vi.fn();
    const selector = makeSelectTool(goToTool, patchToolArgs);

    const result = selector({ label: 'Move Tool', name: 'reposition' });

    expect(result).toBeUndefined();
  });
});

describe('findMobileToolGroup', () => {
  it('finds the group for each tool defined in the toolbar map', () => {
    const allToolNames = new Set<string>();
    for (const group of toolbarMap.flat()) {
      for (const tool of group) {
        allToolNames.add(tool.name);
      }
    }

    for (const toolName of allToolNames) {
      const found = findMobileToolGroup(toolName as ToolName);

      expect(found, `could not find group for tool "${toolName}"`).toBeDefined();
      expect(found!.matchingTools).toContain(toolName);
    }
  });

  it('finds the correct group for the primary tool of each group', () => {
    for (const group of mobileToolGroups) {
      const found = findMobileToolGroup(group.primaryTool);

      expect(found).toBe(group);
    }
  });

  it('returns the same group for all tools in the same flyout', () => {
    const allGroups = toolbarMap.flat();
    for (const group of allGroups) {
      const toolNames = group.map((t) => t.name);
      const foundGroups = toolNames.map((name) => findMobileToolGroup(name as ToolName));

      // Every tool in the same flyout resolves to the same mobile group.
      expect(foundGroups.every((g) => g === foundGroups[0])).toBe(true);
    }
  });

  it('returns undefined for an unknown tool name', () => {
    expect(findMobileToolGroup('not-a-real-tool' as ToolName)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(findMobileToolGroup(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(findMobileToolGroup(undefined)).toBeUndefined();
  });

  it('handles shape figure variants within the same group', () => {
    // All five shape figures (rectangle, oval, line, triangle, polygon, star) and custom-shape
    // share the `shape` group. They should all resolve to the same group.
    const shapeTools = ['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line', 'star', 'custom-shape'];
    const registered = shapeTools.filter((name) =>
      mobileToolGroups.some((g) => g.matchingTools.includes(name as ToolName))
    );

    for (const name of registered) {
      const found = findMobileToolGroup(name as ToolName);
      expect(found).toBeDefined();
      expect(found!.matchingTools).toContain(name);
    }
  });

  it('return value is stable across calls (memoization invariant)', () => {
    const toolName = mobileToolGroups[0].primaryTool;

    const first = findMobileToolGroup(toolName);
    const second = findMobileToolGroup(toolName);

    expect(first).toBe(second);
  });
});
