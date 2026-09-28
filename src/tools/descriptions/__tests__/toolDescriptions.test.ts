import { describe, expect, it } from 'vitest';

import type { ToolName } from '../../../contexts/tool-types.ts';
import { availableTools, toolbarMap } from '../../../../toolbar-mapping.ts';
import type { ToolControlStatus, ToolDescription } from '../types.ts';
import { toolDescriptions } from '../index.ts';

const CONTROL_STATUSES: readonly ToolControlStatus[] = ['present', 'partial', 'missing', 'inert'];

const toolNames = Object.keys(toolDescriptions) as ToolName[];

/**
 * The data half of the contract, with no filesystem behind it.
 *
 * Everything that reads a file — resolving every `file:line` citation against the tree, and
 * proving `docs/TOOLS.md` matches what the generator produces — lives in
 * `scripts/__tests__/tool-descriptions.test.mjs`. `src/` is the browser program: it has no
 * `node:fs`, so a test that needs one does not belong here, and splitting at that line is the
 * same split `vitest.config.ts` already makes for the e2e helpers.
 */
describe('toolDescriptions', () => {
  it('describes every registered tool, and nothing that is not one', () => {
    // `toolbar-mapping.ts` is a second, hand-maintained enumeration that has drifted from
    // `ToolArgsByName` before, so the record is checked against both.
    expect(new Set(toolNames)).toEqual(new Set(availableTools));
  });

  it('describes every tool the toolbar can select', () => {
    const selectable = toolbarMap.flat(2).map((tool) => tool.name);
    const missing = [...new Set(selectable)].filter((name) => !(name in toolDescriptions));
    expect(missing, `tools reachable from the toolbar with no description: ${missing.join(', ')}`).toEqual([]);
  });

  it('assigns every tool a Photoshop name, a summary and a purpose', () => {
    for (const name of toolNames) {
      const { photoshopName, summary, purpose } = toolDescriptions[name];

      expect(photoshopName.trim().length, `${name}: photoshopName`).toBeGreaterThan(0);

      expect(summary.trim().length, `${name}: summary`).toBeGreaterThan(0);
      // A summary longer than this wraps a tooltip onto four lines, which is a defect rather
      // than a style preference.
      expect(summary.length, `${name}: summary is ${summary.length} characters`).toBeLessThanOrEqual(160);

      // The brief asks for thorough, and this is the only mechanical reading of "thorough"
      // available: a purpose under this length is a restatement of the summary.
      expect(purpose.length, `${name}: purpose is only ${purpose.length} characters`).toBeGreaterThanOrEqual(120);
    }
  });

  it('gives every tool at least one cited source, and every source is a URL', () => {
    for (const name of toolNames) {
      const { sources } = toolDescriptions[name];
      expect(sources.length, `${name}: no source, so every Photoshop claim about it is a rumour`).toBeGreaterThan(0);

      for (const source of sources) {
        // `http` is allowed and some of these are only ever `http`: the Photoshop CS3 tips
        // PDF, the CS-era help mirrors and the archived Chinese financial PDF are cited
        // because they are the only place a claim is written down at all. Requiring `https`
        // would push an agent to drop a real source rather than upgrade a URL that has no
        // `https` version to point at.
        expect(source, `${name}: "${source}"`).toMatch(/^https?:\/\/\S+$/);
        // A space in a URL is the shape a citation takes when it was assembled from a search
        // result rather than opened, and helpx.adobe.com answers webfetch with 403 on
        // essentially every path, so this is a live risk here rather than a hypothetical one.
        expect(source.split('#')[0], `${name}: "${source}"`).not.toMatch(/\s/);
      }
    }
  });

  it('gives every tool an implementation verdict and a note saying how it diverges', () => {
    for (const name of toolNames) {
      const { implementation, appNotes } = toolDescriptions[name];
      expect(['implemented', 'partial', 'placeholder'], `${name}: ${implementation}`).toContain(implementation);
      expect(appNotes.trim().length, `${name}: appNotes is empty, so no divergence is recorded`).toBeGreaterThan(0);
    }
  });

  it('describes every control with a real status and a reference wherever one exists', () => {
    for (const name of toolNames) {
      for (const option of toolDescriptions[name].options) {
        expect(option.control.trim().length, `${name}: a control with no name`).toBeGreaterThan(0);
        expect(option.detail.trim().length, `${name}: control "${option.control}" has no detail`).toBeGreaterThan(0);
        expect(CONTROL_STATUSES, `${name}: control "${option.control}" is "${option.status}"`).toContain(option.status);

        if (option.status !== 'missing') {
          // The definition of `inert` is that a control is declared or displayed with nothing
          // wired behind it, so it is always something to point at.
          expect(
            option.appRef,
            `${name}: control "${option.control}" is "${option.status}" with no appRef`
          ).toBeDefined();
        }
      }
    }
  });

  it('records at least one modifier or shortcut for the tools where Photoshop binds one', () => {
    // A tool with neither is legitimate — the path-modification tools inherit the Pen's
    // bindings rather than adding their own — so this pins the tools that must say something.
    const mustBind: readonly ToolName[] = [
      'brush',
      'pencil',
      'eraser',
      'clone-stamp',
      'magic-wand',
      'crop',
      'reposition',
      'gradient',
    ];
    for (const name of mustBind) {
      const { modifiers, shortcuts } = toolDescriptions[name];
      expect(
        modifiers.length + shortcuts.length,
        `${name}: no modifiers and no shortcuts, so its bindings are undocumented`
      ).toBeGreaterThan(0);
    }
  });

  it('resolves a shape figure to its own description rather than the generic one', () => {
    // The five shape tiles all carry the name `shape` in `toolbarMap`, so a lookup on the
    // name alone would put the generic Shape Tool's summary under the Rectangle Tool.
    const rectangle = toolDescriptions.rectangle;
    expect(rectangle.summary).not.toBe(toolDescriptions.shape.summary);
  });

  it('keeps the descriptions a lookup can reach', () => {
    // The record is indexed by `ToolName`, and every lookup goes through it. A `undefined`
    // here is the exact failure the `Record` annotation cannot see: a family that stopped
    // covering its tool, or a figure mapping pointing at a key nothing owns.
    for (const name of toolNames) {
      const description: ToolDescription | undefined = toolDescriptions[name];
      expect(description, `${name}`).toBeDefined();
    }
  });
});
