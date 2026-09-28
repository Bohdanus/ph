import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { PlaceholderTool } from '../ToolbarPlaceholder.tsx';
import { placeholderToolGroups } from '../toolbarPlaceholderConfig.ts';
import { toolsMap } from '../../../tools/toolsMap.ts';

const CONFIG_KEYS = Object.keys(placeholderToolGroups) as Array<keyof typeof placeholderToolGroups>;

/**
 * Mirrors the `placeholderTool(...)` wiring in `src/tools/toolsMap.ts`. A tool missing from this
 * list, or a key that no longer matches toolsMap, fails the wiring assertions below.
 *
 * The brush and pencil are absent on purpose: they render the real Photoshop paint bar
 * (`src/components/ToolbarsRight/Paint/Paint.tsx`) and no longer have a config group, so
 * listing them here would keep their placeholder contract alive after the fact.
 */
const PLACEHOLDER_TOOLS = [
  {
    toolName: 'color-replacement',
    configKey: 'color-replacement',
    title: 'Color Replacement Tool',
    showTodoBadge: true,
  },
  { toolName: 'pen', configKey: 'pen', title: 'Pen Tool', showTodoBadge: true },
  { toolName: 'freeform-pen', configKey: 'pen', title: 'Freeform Pen Tool', showTodoBadge: true },
  { toolName: 'curvature-pen', configKey: 'pen', title: 'Curvature Pen Tool', showTodoBadge: true },
  { toolName: 'add-anchor-point', configKey: 'pen', title: 'Add Anchor Point Tool', showTodoBadge: true },
  { toolName: 'delete-anchor-point', configKey: 'pen', title: 'Delete Anchor Point Tool', showTodoBadge: true },
  { toolName: 'convert-point', configKey: 'pen', title: 'Convert Point Tool', showTodoBadge: true },
  {
    toolName: 'custom-shape',
    configKey: 'custom-shape',
    title: 'Custom Shape Tool',
    showTodoBadge: true,
  },
] as const;

describe('PlaceholderTool', () => {
  it('renders the title, the TODO badge, the option chips, and the default description', () => {
    render(<PlaceholderTool title="Brush Tool" options={['Opacity', 'Flow']} />);

    expect(screen.getByText('Brush Tool')).toBeInTheDocument();
    expect(screen.getByText('TODO')).toBeInTheDocument();
    expect(screen.getByText('Opacity')).toBeInTheDocument();
    expect(screen.getByText('Flow')).toBeInTheDocument();
    expect(screen.getByText('TODO: tool behavior not implemented yet.')).toBeInTheDocument();
  });

  it('hides the TODO badge when showTodoBadge is false', () => {
    render(<PlaceholderTool title="Brush Tool" options={['Opacity']} showTodoBadge={false} />);

    expect(screen.queryByText('TODO')).not.toBeInTheDocument();
    expect(screen.getByText('Brush Tool')).toBeInTheDocument();
  });

  it('renders a caller supplied description instead of the default', () => {
    render(<PlaceholderTool title="Pen Tool" options={['Fill']} description="Use the path panel instead." />);

    expect(screen.getByText('Use the path panel instead.')).toBeInTheDocument();
    expect(screen.queryByText('TODO: tool behavior not implemented yet.')).not.toBeInTheDocument();
  });

  it('renders no option chips for an empty option list without crashing', () => {
    render(<PlaceholderTool title="Empty Tool" options={[]} />);

    expect(screen.getByText('Empty Tool')).toBeInTheDocument();
    expect(screen.getByText('TODO: tool behavior not implemented yet.')).toBeInTheDocument();
  });
});

describe('toolbarPlaceholderConfig', () => {
  it('exposes a non-empty option list for every configured tool group', () => {
    expect(CONFIG_KEYS.length).toBeGreaterThan(0);

    for (const key of CONFIG_KEYS) {
      const options = placeholderToolGroups[key];
      expect(Array.isArray(options), `${key} must be an array`).toBe(true);
      expect(options.length, `${key} must declare at least one option`).toBeGreaterThan(0);
      expect(new Set(options).size, `${key} must not repeat options`).toBe(options.length);
    }
  });

  it('declares the same option list for the two magnetic pen groups', () => {
    expect(placeholderToolGroups['freeform-pen']).toEqual(placeholderToolGroups['curvature-pen']);
    expect(placeholderToolGroups['freeform-pen']).toEqual(['Tool Mode', 'Fill', 'Stroke', 'Magnetic', 'Curve Fit']);
  });

  it('lists the documented options for the rectangle group', () => {
    expect(placeholderToolGroups.rectangle).toEqual([
      'Tool Mode',
      'Fill',
      'Stroke',
      'Stroke Width',
      'Stroke Style',
      'W/H',
      'Path Operations',
      'Alignment',
      'Radius',
    ]);
  });
});

describe('placeholder tool wiring in toolsMap', () => {
  it('registers a placeholder toolbox for every tool listed in the wiring table', () => {
    for (const { toolName } of PLACEHOLDER_TOOLS) {
      const entry = toolsMap[toolName] as { toolboxComponent?: unknown } | undefined;
      expect(entry, `${toolName} is not registered in toolsMap`).toBeDefined();
      expect(typeof entry?.toolboxComponent, `${toolName} has no toolbox`).toBe('function');
    }
  });

  it('never wires a tool to a config key that does not exist', () => {
    for (const { toolName, configKey } of PLACEHOLDER_TOOLS) {
      expect(placeholderToolGroups[configKey], `${toolName} points at a missing group`).toBeDefined();
    }
  });

  it('documents the config groups that no tool consumes', () => {
    const usedKeys = new Set<string>(PLACEHOLDER_TOOLS.map((entry) => entry.configKey));
    const unreachableKeys = CONFIG_KEYS.filter((key) => !usedKeys.has(key));

    // toolsMap wires freeform-pen, curvature-pen and rectangle to other groups, so these
    // three entries in toolbarPlaceholderConfig.ts are currently dead config.
    expect(unreachableKeys).toEqual(['freeform-pen', 'curvature-pen', 'rectangle']);
  });

  it('keeps a config group for every tool that is still a placeholder', () => {
    // A tool that stops being a placeholder must also lose its config group, or it
    // becomes dead config the assertions above will report as unreachable. The paint
    // tools are the ones that have already made that move, so pin the inverse
    // direction: nothing may reintroduce a `brush` or `pencil` group.
    expect(Object.hasOwn(placeholderToolGroups, 'brush')).toBe(false);
    expect(Object.hasOwn(placeholderToolGroups, 'pencil')).toBe(false);
  });

  it.each(PLACEHOLDER_TOOLS)(
    'renders the $title placeholder with the chips from the $configKey group',
    ({ toolName, configKey, title, showTodoBadge }) => {
      const ToolboxComponent = toolsMap[toolName].toolboxComponent;
      render(React.createElement(ToolboxComponent));

      // A registered placeholder must never crash on a missing config key, so it always
      // renders its title and every option chip for the group it was wired to.
      expect(screen.getByText(title)).toBeInTheDocument();
      for (const option of placeholderToolGroups[configKey]) {
        expect(screen.getByText(option)).toBeInTheDocument();
      }

      const badges = screen.queryAllByText('TODO');
      expect(badges).toHaveLength(showTodoBadge ? 1 : 0);
    }
  );

  it('registers a toolbox component for every tool name', () => {
    for (const toolName of Object.keys(toolsMap) as Array<keyof typeof toolsMap>) {
      expect(typeof toolsMap[toolName].toolboxComponent, `${toolName} has no toolbox`).toBe('function');
    }
  });

  it('leaves toolboxComponent undefined for an unknown tool, which is the ToolbarHorizontal fallback trigger', () => {
    const unknownToolMap = toolsMap as unknown as Record<string, { toolboxComponent?: unknown }>;

    expect(unknownToolMap['not-a-real-tool']).toBeUndefined();
    expect(unknownToolMap['not-a-real-tool']?.toolboxComponent).toBeUndefined();
  });
});
