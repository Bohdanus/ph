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

  it('does not tell the reader to press a key these selection tools do not read', () => {
    // A tripwire for named claims, not a general property — nothing in `src/` can decide whether a
    // row is implemented, since that needs the gesture the row describes. What can be checked is
    // that the removed rows and the prose that shipped them stay gone, in EVERY surface a reader
    // sees them: the tooltip summary, the `modifiers` table, and the `options` control detail.
    //
    // `PolygonClickToolArea`, which draws the freehand and the polygonal lasso alike, registers
    // Escape, Enter, Backspace and Delete and reads no `shiftKey`, `altKey`, `metaKey` or
    // `ctrlKey` anywhere in the file. `QuickSelectionToolArea` and the quick-selection options bar
    // read no modifier key either. The app's only `Space` keydown that matters to a tool is the
    // Shape tool's mid-drag pan (`ShapeToolArea.tsx:52`), which pans the shape being drawn
    // rather than switching to the Hand tool. A user who read any of these rows and tried it got
    // nothing.
    const lassoNames: readonly ToolName[] = ['freehand-lasso', 'polygonal-lasso'];
    const rows = lassoNames.flatMap((name) =>
      toolDescriptions[name].modifiers.map((modifier) => `${modifier.keys}: ${modifier.action}`)
    );
    const unImplemented = /45°|freehand segment|straight segment rather than a magnetic one|Hand tool/;

    expect(
      rows.filter((row) => unImplemented.test(row)),
      'a lasso modifier row promises a gesture its tool area never reads'
    ).toEqual([]);

    // The quick-selection surface is three shapes, and an earlier pass fixed only the first: the
    // summary said "Alt-drag to subtract" while the same entry's `modifiers` and `options` prose
    // still described an Alt gesture, so the fix had to be made three times or not at all.
    const quick = toolDescriptions['quick-selection'];
    expect(quick.summary, 'the quick-selection tooltip names Alt, which is never read').not.toMatch(/\bAlt\b/);
    expect(
      quick.modifiers.map((modifier) => `${modifier.keys}: ${modifier.action}`),
      'a quick-selection modifier row promises a gesture neither its bar nor its tool area reads'
    ).toEqual([]);
    // Matched on the ASSERTION of a binding, not on the bare word `Alt` — the corrected row says
    // "binds no Alt/Option modifier", which is the truth and must not trip this.
    expect(
      quick.options
        .map((option) => option.detail)
        .filter((detail) => /holding (?:Alt|Option)\b|with Alt held/i.test(detail)),
      'a quick-selection control row describes a modifier gesture the app does not bind'
    ).toEqual([]);
  });

  it("keeps the crop record's Adobe-scoped fields Adobe's and its app-scoped fields app's", () => {
    // This record has been edited wrong in both directions, and each mistake was invisible to a
    // green suite, so the two directions are pinned together here.
    //
    // WRONG TOWARD THE APP: the `Enter / Return` shortcut row read "the same as the Done button".
    // `shortcuts[]` is an app record — its sibling rows say "Unbound in the app" — and the crop
    // panel renders `Apply` and `Clear`, so that sentence told the reader to press a button this
    // app has no name for.
    //
    // WRONG TOWARD ADOBE: the `options[]` row's `control` was rewritten to 'Apply / Clear'. The
    // field is defined as "The control's name in Photoshop's options bar, verbatim … Not the app's
    // name for it", `detail` is "What the control does in Photoshop", and
    // `scripts/generate-tool-docs.mjs` renders the pair under the header `| Control | Photoshop |
    // In this app |`. So the rewrite put an app name in the Photoshop column, pushed app prose
    // under "Photoshop", and deleted a sentence that was entirely Adobe-scoped and entirely TRUE.
    // It also orphaned the pair: `purpose` still commits with "the Done button or a double-click
    // inside the box", correctly scoped to Photoshop, so the page described the same control twice
    // in two different scopes with no way to tell them apart.
    //
    // Where the app's naming belongs is `appNotes`, which is this record's home for divergence, and
    // it is where it now reads. `purpose` keeps Adobe's names because Adobe really does bind them.
    //
    // Not vacuous: each of the three assertions below fails on a state this file has actually
    // carried, and each prints the offending value rather than a boolean.
    expect(
      toolDescriptions.crop.options.map((option) => option.control),
      'the crop record no longer names the commit pair the way Adobe names it'
    ).toContain('Done / Cancel');

    // ONLY the surfaces a reader takes as a claim about this app: `summary` reaches the user
    // through `tooltips.ts` and `ToolTooltip.tsx`, and `modifiers`/`shortcuts` rows describe what
    // pressing does while this tool is active. `options[].detail` and `purpose` are Adobe's, and
    // `appNotes` is the divergence record — a mention in any of those three is correct, and
    // banning them would be banning the fix.
    const claimsAboutThisApp = [
      toolDescriptions.crop.summary,
      ...toolDescriptions.crop.modifiers.map((modifier) => modifier.action),
      ...toolDescriptions.crop.shortcuts.map((shortcut) => shortcut.action),
    ];

    expect(
      claimsAboutThisApp.filter((text) => /\bDone \/ Cancel\b|\bDone button\b/.test(text)),
      'a surface read as a claim about this app names a commit control the crop panel does not render'
    ).toEqual([]);
    expect(
      claimsAboutThisApp.filter((text) => /double-?click/i.test(text)),
      'a surface read as a claim about this app promises a double-click commit the crop path has no handler for'
    ).toEqual([]);
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
