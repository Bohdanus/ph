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

  it('documents Photoshop lasso and Quick Selection modifiers separately from app support', () => {
    const polygon = toolDescriptions['polygonal-lasso'];
    const polygonRows = polygon.modifiers.map((modifier) => `${modifier.keys}: ${modifier.action}`);
    expect(polygonRows).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Shift:.*45 degrees/i),
        expect.stringMatching(/Alt:.*drag.*freehand/i),
        expect.stringMatching(/Shift:.*Add to Selection/i),
        expect.stringMatching(/Alt:.*Subtract From Selection/i),
        expect.stringMatching(/Shift\+Alt:.*Intersect With Selection/i),
        expect.stringMatching(/Ctrl\/Command:.*closes.*away from the starting point/i),
      ])
    );
    expect(polygonRows).not.toEqual(expect.arrayContaining([expect.stringMatching(/Alt.*double-click/i)]));
    expect(polygon.summary).toMatch(/double-click.*right-click.*Enter/i);
    expect(polygon.summary).not.toMatch(/Ctrl\/Command|starting point/i);
    expect(polygon.summary).not.toMatch(/Return/i);
    expect(polygon.purpose).toMatch(/Ctrl-clicking on Windows \/ Command-clicking on macOS/i);
    expect(polygon.purpose).not.toMatch(/Enter|Return/i);
    expect(polygon.shortcuts.map((shortcut) => shortcut.keys)).not.toContain('Return');
    expect(polygon.appNotes).toMatch(/modifier keys.*Ctrl\/Command-click closure.*absent/i);

    const magnetic = toolDescriptions['feather-magnetic-lasso'];
    expect(magnetic.modifiers.map((modifier) => `${modifier.keys}: ${modifier.action}`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Alt:.*double-click.*straight segment/i)])
    );

    const quick = toolDescriptions['quick-selection'];
    expect(quick.modifiers.map((modifier) => modifier.keys)).toEqual(['Shift', 'Alt']);
    expect(quick.modifiers.map((modifier) => `${modifier.keys}: ${modifier.action}`)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Shift:.*temporarily adds.*while brushing/i),
        expect.stringMatching(/Alt:.*temporarily subtracts.*while brushing/i),
      ])
    );
    expect(quick.options.map((option) => option.detail).join(' ')).toMatch(/Alt\/Option while brushing to subtract/i);
    expect(quick.appNotes).toMatch(/Temporary Shift\/Alt gestures.*not implemented/i);
    expect(quick.appNotes).toMatch(/bracket-key resizing are not implemented/i);
    expect(quick.options.find((option) => option.control === 'Selection mode')?.detail).toMatch(
      /whether its Options bar also offers Intersect is unresolved across Adobe sources/i
    );
    const quickShortcutKeys = quick.shortcuts.map((shortcut) => shortcut.keys);
    for (const key of ['[', ']', 'Shift+[', 'Shift+]']) {
      expect(quickShortcutKeys).not.toContain(key);
    }
    expect(quick.sources).toEqual(
      expect.arrayContaining([
        'https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html',
        'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/select-area-intersected-by-other-selections.html',
        'https://helpx.adobe.com/lt/photoshop/how-to/add-to-subtract-from-selections.html',
        'https://helpx.adobe.com/content/dam/help/en/photoshop/using/default-keyboard-shortcuts/photoshop-keyboard-shortcuts.pdf?TVGll=wnKKa',
        'https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html',
      ])
    );
    expect(quick.summary, 'the Quick Selection tooltip must not promise an unimplemented modifier gesture').not.toMatch(
      /\bAlt\b/i
    );
  });

  it('documents the fill-region condition for Clear on shape tools', () => {
    for (const name of ['shape', 'rectangle', 'ellipse', 'line', 'triangle', 'polygon', 'custom-shape'] as const) {
      const mode = toolDescriptions[name].options
        .filter((option) => option.control === 'Mode')
        .find((option) => /second of the two controls Adobe names Mode/i.test(option.detail));
      expect(mode?.detail, `${name}: Clear is available only when a fill region is selected`).toMatch(
        /Clear is available when a fill region is selected/i
      );
      expect(mode?.detail, `${name}: Clear requires Lock Transparency to be deselected`).toMatch(
        /Lock Transparency is deselected/i
      );
      expect(toolDescriptions[name].sources).toContain(
        'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html'
      );
    }
  });

  it('records Adobe’s conflicting 32-bit blend-mode lists without assigning them to each tool', () => {
    const blendModeGuide =
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html';
    const hdrSupportGuide =
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/features-that-support-32-bpc-hdr-images.html';

    for (const name of ['brush', 'pencil', 'paint-bucket', 'clone-stamp'] as const) {
      const mode = toolDescriptions[name].options.find((option) => option.control === 'Mode');
      expect(mode?.detail, `${name}: Adobe's overlapping 32-bit scopes and conflicting counts are attributed`).toMatch(
        /blending-mode page lists 11 modes for 32-bit images; its 32-bpc HDR support page lists 15 for 32-bpc HDR images\. Since 32-bpc HDR is a 32-bit scope, the lists overlap, and Adobe does not reconcile their different counts/i
      );
      expect(toolDescriptions[name].sources).toContain(blendModeGuide);
      expect(toolDescriptions[name].sources).toContain(hdrSupportGuide);

      if (name === 'paint-bucket') {
        expect(mode?.detail).toMatch(
          /HDR page marks Paint Bucket unsupported for 32-bpc HDR, so Clear availability for that tool does not apply in that mode/i
        );
        expect(mode?.detail).toMatch(/blending-mode page separately lists Clear for Paint Bucket/i);
      } else {
        expect(mode?.detail, `${name}: Adobe's tool and image-mode qualification is retained`).toMatch(
          /blending-mode page says availability varies by tool and image mode/i
        );
      }
    }

    const sharpenMode = toolDescriptions.sharpen.options.find((option) => option.control === 'Mode');
    expect(sharpenMode?.detail).toMatch(
      /blending-mode page lists 11 modes for 32-bit images; its 32-bpc HDR support page lists 15 for 32-bpc HDR images\. Since 32-bpc HDR is a 32-bit scope, the lists overlap, and Adobe does not reconcile their different counts/i
    );
    expect(sharpenMode?.detail).toMatch(/October 2026 desktop guide lists this control/i);
    expect(sharpenMode?.detail).toMatch(/neither page enumerates Sharpen’s tool-specific blend-mode set/i);
    expect(sharpenMode?.detail).toMatch(/HDR page includes Sharpen among supported tools/i);
    expect(toolDescriptions.sharpen.sources).toContain(blendModeGuide);
    expect(toolDescriptions.sharpen.sources).toContain(hdrSupportGuide);
    expect(toolDescriptions.sharpen.sources).toContain(
      'https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/increase-sharpness-in-selected-image-areas.html'
    );
  });

  it('does not infer a Blur Mode from global blend-mode lists while its control is unconfirmed', () => {
    expect(toolDescriptions.blur.options.find((option) => option.control === 'Mode')).toBeUndefined();
    expect(toolDescriptions.blur.purpose).toMatch(/Blur-specific control remains unconfirmed/i);
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

  describe('implementationRefs integrity', () => {
    it('requires at least one implementationRef for every tool', () => {
      for (const name of toolNames) {
        const { implementationRefs } = toolDescriptions[name];
        expect(implementationRefs.length, `${name}: implementationRefs is empty`).toBeGreaterThan(0);
      }
    });

    it('requires implementationRefs to use file:line format', () => {
      for (const name of toolNames) {
        const { implementationRefs } = toolDescriptions[name];
        for (const ref of implementationRefs) {
          // Format: path/to/file.ts:123 or path/to/file.tsx:45
          expect(ref, `${name}: "${ref}" does not match file:line pattern`).toMatch(/^[^:]+:+\d+$/);
        }
      }
    });
  });

  describe('sources integrity', () => {
    it('requires at least one source URL for every tool', () => {
      for (const name of toolNames) {
        const { sources } = toolDescriptions[name];
        expect(sources.length, `${name}: sources array is empty`).toBeGreaterThan(0);
      }
    });

    it('requires all source URLs to be valid HTTP/HTTPS', () => {
      for (const name of toolNames) {
        const { sources } = toolDescriptions[name];
        for (const source of sources) {
          expect(source, `${name}: "${source}" is not a valid HTTP/HTTPS URL`).toMatch(/^https?:\/\/\S+$/);
        }
      }
    });

    it('prefers Adobe documentation sources', () => {
      const adobeDomains = ['helpx.adobe.com', 'developer.adobe.com', 'adobe.com'];
      for (const name of toolNames) {
        const { sources } = toolDescriptions[name];
        const adobeSources = sources.filter((s) => adobeDomains.some((d) => s.includes(d)));
        expect(adobeSources.length, `${name}: no Adobe documentation source found`).toBeGreaterThan(0);
      }
    });
  });

  describe('family disjointness', () => {
    it('excludes the star shape from toolDescriptions', () => {
      // star is explicitly excluded in index.ts via destructuring
      // star is not a ToolName, so we check the raw object keys
      const allKeys = Object.keys(toolDescriptions) as string[];
      expect(allKeys).not.toContain('star');
    });
  });

  describe('extraTools handling', () => {
    it('ensures color/levels/invert/transform are described but marked as extra tools', () => {
      // These are "extraTools" in toolbar-mapping.ts - they appear in the toolbar but
      // are not standard paint/selection tools. They should have descriptions.
      const extraTools: readonly ToolName[] = ['color', 'levels', 'invert', 'transform'];
      for (const name of extraTools) {
        expect(toolDescriptions[name], `${name}: missing description`).toBeDefined();
        // These tools are partial because they don't have full paint tool implementation
        expect(['implemented', 'partial']).toContain(toolDescriptions[name].implementation);
      }
    });
  });

  it('qualifies the Smudge R shortcut against current and older Adobe sources', () => {
    const smudge = toolDescriptions.smudge;
    const shortcut = smudge.shortcuts.find((item) => item.keys === 'R');

    expect(shortcut?.action).toMatch(
      /current desktop Smudge guide says R cycles through retouching tools.*2023 guide labels Smudge with R.*2019 Photoshop reference lists R for Rotate View.*Keyboard Shortcuts and Menus dialog.*active binding/i
    );
    expect(smudge.sources).toEqual(
      expect.arrayContaining([
        'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf',
        'https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html',
      ])
    );
  });

  describe('modifiers and shortcuts consistency', () => {
    it('ensures modifier keys use standard notation', () => {
      const knownModifierWords = [
        'Shift',
        'Alt',
        'Control',
        'Ctrl',
        'Meta',
        'Space',
        'Enter',
        'Escape',
        'Backspace',
        'Delete',
        'Arrow',
        'Option',
        'Command',
        '⌘',
        'Cmd',
      ];
      for (const name of toolNames) {
        const { modifiers } = toolDescriptions[name];
        for (const modifier of modifiers) {
          // The keys field should be non-empty and contain at least one recognized modifier word
          expect(modifier.keys.trim().length, `${name}: modifier keys is empty`).toBeGreaterThan(0);
          const hasKnownModifier = knownModifierWords.some((word) => modifier.keys.includes(word));
          expect(hasKnownModifier, `${name}: "${modifier.keys}" does not contain any recognized modifier word`).toBe(
            true
          );
        }
      }
    });
  });

  describe('appRef format validation', () => {
    it('requires appRef for non-missing controls and validates format', () => {
      for (const name of toolNames) {
        for (const option of toolDescriptions[name].options) {
          if (option.status !== 'missing') {
            expect(option.appRef, `${name}: control "${option.control}" needs appRef`).toBeDefined();
            if (option.appRef) {
              // Format: path/to/file.ts:123 or path/to/file.tsx:45
              expect(option.appRef, `${name}: "${option.appRef}" does not match file:line pattern`).toMatch(
                /^[^:]+:+\d+$/
              );
              const [filePath] = option.appRef.split(':');
              expect(filePath).toMatch(/\.(ts|tsx)$/);
            }
          }
        }
      }
    });
  });
});
