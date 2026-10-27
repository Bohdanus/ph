import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { PlaceholderTool } from '../ToolbarPlaceholder.tsx';
import { placeholderToolGroups } from '../toolbarPlaceholderConfig.ts';
import { toolsMap } from '../../../tools/toolsMap.ts';
import ToolbarHorizontal from '../../ToolbarHorizontal/ToolbarHorizontal.tsx';

// `ToolbarHorizontal` reads the store, and the real provider does not survive jsdom, so the store
// is stubbed here — the same shape the component's own tests use. The toolsMap is NOT stubbed: the
// point of the fallback test below is the real lookup.
const storeState = vi.hoisted(() => ({ hasImage: true, toolName: 'pen' as string }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

beforeEach(() => {
  storeState.hasImage = true;
  storeState.toolName = 'pen';
});

const CONFIG_KEYS = Object.keys(placeholderToolGroups) as Array<keyof typeof placeholderToolGroups>;

/**
 * Mirrors the `placeholderTool(...)` wiring in `src/tools/toolsMap.ts`. A tool missing from this
 * list, or a key that no longer matches toolsMap, fails the wiring assertions below.
 *
 * The brush and pencil are absent on purpose: they render the real Photoshop paint bar
 * (`src/components/ToolbarsRight/Paint/Paint.tsx`) and no longer have a config group, so
 * listing them here would keep their placeholder contract alive after the fact.
 *
 * Twelve more are absent for the same reason. `eraser`, `smudge`, `sharpen`, `paint-bucket`,
 * `gradient`, `clone-stamp`, `eyedropper`, `elliptical-selection`, `quick-selection`, `dodge`,
 * `burn` and `color-replacement` each render a real options bar, and
 * `toolbarPlaceholderConfig.ts` has already dropped their groups — a config key that survived its
 * tool's panel would be dead config the "no tool consumes" assertion below would report. Their
 * bars are pinned individually in `src/components/ToolbarsRight/<Name>/__tests__/`, and the
 * registry's claim that all twelve still mount a real bar is asserted in
 * `src/tools/__tests__/tool-processors.test.ts`.
 */
const PLACEHOLDER_TOOLS = [
  // `color-replacement` was here and is gone: it has a real options bar now, so there is no
  // placeholder group left for it to be keyed by.
  { toolName: 'pen', configKey: 'pen', title: 'Pen Tool', showTodoBadge: true },
  { toolName: 'freeform-pen', configKey: 'freeform-pen', title: 'Freeform Pen Tool', showTodoBadge: true },
  {
    toolName: 'curvature-pen',
    configKey: 'curvature-pen',
    title: 'Curvature Pen Tool',
    showTodoBadge: true,
  },
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

/**
 * The tools that have left the placeholder roster, pinned in the negative.
 *
 * Each one is a `placeholderTool(title, key)` call away from being a placeholder again, and
 * that call needs a config key — which does not exist. So the two halves hold together: this
 * list says the tool has no group, and the "documents the config groups that no tool consumes"
 * assertion below says a group with no tool is unreachable. Reintroducing a placeholder for any
 * of these therefore has to add a key, and the unreachable list is where that shows up.
 */
const TOOLS_WITH_REAL_OPTIONS_BARS = [
  'eyedropper',
  'elliptical-selection',
  'quick-selection',
  'eraser',
  'clone-stamp',
  'paint-bucket',
  'gradient',
  'sharpen',
  'smudge',
  'dodge',
  'burn',
  'sponge',
  'color-replacement',
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

  it('renders without crashing when title is null', () => {
    render(<PlaceholderTool title={null as unknown as string} options={['Option']} />);

    expect(screen.getByText('Option')).toBeInTheDocument();
  });

  it('renders an empty title span without crashing', () => {
    render(<PlaceholderTool title="" options={['Option']} />);

    expect(screen.getByText('Option')).toBeInTheDocument();
  });

  it('renders an empty description without adding extra text', () => {
    render(<PlaceholderTool title="Tool" options={['Opacity']} description="" />);

    expect(screen.getByText('Tool')).toBeInTheDocument();
    expect(screen.queryByText('TODO: tool behavior not implemented yet.')).not.toBeInTheDocument();
  });

  it('renders option chips with special characters correctly', () => {
    render(<PlaceholderTool title="Tool" options={['<script>', '&amp;', '"quoted"']} />);

    expect(screen.getByText('<script>')).toBeInTheDocument();
    expect(screen.getByText('&amp;')).toBeInTheDocument();
    expect(screen.getByText('"quoted"')).toBeInTheDocument();
  });

  it('renders a whitespace-only title without crashing', () => {
    render(<PlaceholderTool title="   " options={['Option']} />);

    expect(screen.getByText('Option')).toBeInTheDocument();
  });

  // Tripwire: the component does not guard `options.map`, so undefined options
  // crash the render. Once a null-guard is added, flip this to a positive
  // assertion that the component renders gracefully.
  it.fails('does not crash when options is undefined', () => {
    render(<PlaceholderTool title="Tool" options={undefined as unknown as readonly string[]} />);

    expect(screen.getByText('Tool')).toBeInTheDocument();
  });

  // Tripwire: each option is used as its own React key, so duplicates trigger a
  // key-collision warning. Once the component deduplicates, flip this to a
  // positive assertion that no warning is emitted.
  it.fails('deduplicates repeated options without a React key warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<PlaceholderTool title="Tool" options={['Opacity', 'Opacity']} />);

    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key'),
      expect.anything()
    );
    spy.mockRestore();
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

    // `rectangle` is the one group no tool claims: the rail has no `rectangle` tool name, so
    // `rectangle`/`ellipse`/`triangle`/`polygon`/`line` all render the real `Shape` bar and the
    // group survives unused. It is correct for it to be here, and the exact equality is what
    // keeps this a fixed point rather than a growing pile: a group for a tool that has a real
    // bar, or one whose tool stopped being a placeholder, lands here too.
    //
    // The list is derived from the wiring table above, NOT from `toolsMap` — that table's
    // fidelity to the registry is what the `it.each` render case pins. The `freeform-pen` and
    // `curvature-pen` groups were on this list because both `placeholderTool(...)` calls named
    // the `pen` key, which put the standard Pen's seven chips over Magnetic and Curve Fit, the
    // controls those two tools exist for. Pointing each call at its own key is what cleared
    // them, and re-pointing either call back at `pen` fails that render case on the missing
    // `Magnetic` chip — checked by mutation, not argued.
    expect(unreachableKeys).toEqual(['rectangle']);
  });

  it('keeps a config group for every tool that is still a placeholder', () => {
    // A tool that stops being a placeholder must also lose its config group, or it
    // becomes dead config the assertions above will report as unreachable. The paint
    // tools are the ones that have already made that move, so pin the inverse
    // direction: nothing may reintroduce a `brush` or `pencil` group.
    expect(Object.hasOwn(placeholderToolGroups, 'brush')).toBe(false);
    expect(Object.hasOwn(placeholderToolGroups, 'pencil')).toBe(false);
  });

  it('keeps no config group for any tool that has a real options bar', () => {
    // `placeholderTool(title, key)` indexes this record, so a key that had been dropped
    // while the call survived would render `undefined` as the option list rather than
    // crash. The unreachable-key assertion above is the other half of this: a group here
    // with no tool claiming it is reported there.
    for (const toolName of TOOLS_WITH_REAL_OPTIONS_BARS) {
      expect(placeholderToolGroups, toolName).not.toHaveProperty(toolName);
    }
  });

  it('claims no tool for both the placeholder roster and the real options bars', () => {
    const claimed = PLACEHOLDER_TOOLS.map((entry) => entry.toolName);
    const overlap = claimed.filter((toolName) =>
      (TOOLS_WITH_REAL_OPTIONS_BARS as readonly string[]).includes(toolName)
    );

    expect(overlap).toEqual([]);
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

  it('renders the unregistered-tool placeholder for a tool the real toolsMap does not have', () => {
    // The `?.` in ToolbarHorizontal.tsx:14 is only reachable when the registry lookup misses, so
    // the fallback has to be driven through the real map rather than a locally invented key.
    storeState.toolName = 'not-a-real-tool';
    render(<ToolbarHorizontal />);

    // The full fallback string is the whole positive: this branch renders a bare `<span>`
    // (`ToolbarHorizontal.tsx:19`) whose text is `TODO: unregistered tool placeholder`, and
    // Testing Library's string matcher is an exact match after whitespace normalisation, so that
    // query cannot also match the span under a partial `TODO`.
    expect(screen.getByText('TODO: unregistered tool placeholder')).toBeInTheDocument();

    // ...and the negative is the half that is NOT subsumed by it. `queryByText('TODO')` is null on
    // a bare span only because that span's text is the longer string; the moment the fallback also
    // renders a `<PlaceholderTool>`, its badge (`ToolbarPlaceholder.tsx:19`, text `TODO`) matches
    // and the positive above still passes. So this is the assertion that says the fallback renders
    // ONE placeholder and not a competing second one.
    //
    // This is falsifiable, and was checked rather than argued: adding
    // `<PlaceholderTool title="Nope" options={[]} />` to the `!ToolComponent` branch makes exactly
    // this line fail while the positive above keeps passing. It belongs HERE rather than in the
    // sibling test, which renders `pen` — itself a `PlaceholderTool` with `showTodoBadge: true`
    // (`toolsMap.ts:128`), so the same assertion there is red on an unmodified tree and would be
    // asserting against the registered bar's own legitimate badge rather than a fallback.
    expect(screen.queryByText('TODO')).toBeNull();
  });

  it('renders the registered placeholder bar, not the fallback, for a tool in the real toolsMap', () => {
    storeState.toolName = 'pen';
    render(<ToolbarHorizontal />);

    expect(screen.getByText('Pen Tool')).toBeInTheDocument();
    expect(screen.queryByText('TODO: unregistered tool placeholder')).toBeNull();
  });
});
