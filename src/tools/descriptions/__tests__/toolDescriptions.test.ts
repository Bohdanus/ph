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
    expect(polygon.summary).toMatch(/close by clicking the start, double-clicking, or Ctrl\/Command-clicking/i);
    expect(polygon.summary).toMatch(/This app lacks Ctrl\/Command-click closure/i);
    expect(polygon.summary).not.toMatch(/right-click|Enter|Return/i);
    expect(polygon.purpose).toMatch(/Ctrl-clicking on Windows \/ Command-clicking on macOS/i);
    expect(polygon.purpose).not.toMatch(/Enter|Return/i);
    expect(polygon.purpose).not.toMatch(/right-click/i);
    expect(polygonRows).not.toEqual(expect.arrayContaining([expect.stringMatching(/Ctrl\/Command:.*right-click/i)]));
    expect(polygon.shortcuts.map((shortcut) => shortcut.keys)).not.toContain('Return');
    expect(polygon.appNotes).toMatch(/In this app,.*double-click, right-click, or Enter\/Return/i);
    expect(polygon.appNotes).toMatch(/modifier keys.*Ctrl\/Command-click closure.*absent/i);

    const smudge = toolDescriptions.smudge;
    expect(smudge.modifiers.map((modifier) => `${modifier.keys}: ${modifier.action}`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Alt:.*temporarily reverses the Finger Painting setting/i)])
    );
    expect(smudge.appNotes).toMatch(/This app does not bind Alt\/Option to Finger Painting/i);
    expect(smudge.sources).toContain(
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/smudge-image-areas.html'
    );

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
    expect(quick.options.map((option) => option.detail).join(' ')).toMatch(
      /temporary Shift-add and Alt\/Option-subtract while brushing.*app implements both gestures/i
    );
    expect(quick.appNotes).toMatch(/Holding Shift temporarily adds.*Holding Alt\/Option temporarily subtracts/i);
    expect(quick.appNotes).toMatch(
      /The app has no Intersect mode and does not implement bracket-key resizing or Shift\+Alt intersection/i
    );
    expect(quick.options.find((option) => option.control === 'Selection mode')?.detail).toMatch(
      /current Quick Selection guide lists New, Add to and Subtract from.*general Intersect guide says.*any selection tool.*includes Quick Selection.*selection-combination tutorial explicitly includes Quick Selection.*exact current Options-bar mode list remains unclear.*2019 keyboard reference excludes Quick Selection from the Shift\+Alt\/Option intersect gesture.*app implements both gestures but has no Intersect mode/i
    );
    expect(quick.options.find((option) => option.control === 'Selection mode')?.detail).toMatch(
      /excludes Quick Selection from the Shift\+Alt\/Option intersect gesture/i
    );
    const quickShortcutKeys = quick.shortcuts.map((shortcut) => shortcut.keys);
    expect(quickShortcutKeys).toContain('[');
    expect(quickShortcutKeys).toContain(']');
    // The shortcut list records Photoshop behavior; appNotes records that this app does not yet
    // implement bracket-key resizing. Keep those two claims separate instead of deleting the
    // source behavior to make the app look more complete.
    expect(quickShortcutKeys).toEqual(['W', 'Shift+W', '[', ']']);
    const decreaseBrushShortcut = quick.shortcuts.find((shortcut) => shortcut.keys === '[');
    const increaseBrushShortcut = quick.shortcuts.find((shortcut) => shortcut.keys === ']');
    expect(decreaseBrushShortcut?.action).toMatch(/decreases the Quick Selection brush size/i);
    expect(increaseBrushShortcut?.action).toMatch(/increases the Quick Selection brush size/i);
    expect(decreaseBrushShortcut?.action).toMatch(/Adobe Learn directly demonstrates this key/i);
    expect(increaseBrushShortcut?.action).toMatch(/applying it here is an inference/i);
    expect(quick.sources).toEqual(
      expect.arrayContaining([
        'https://www.adobe.com/learn/photoshop/web/compositing',
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

  it('keeps Color Replacement Tolerance bounds source-qualified', () => {
    const replacement = toolDescriptions['color-replacement'];
    const tolerance = replacement.options.find((option) => option.control === 'Tolerance');

    expect(replacement.purpose).toMatch(
      /Adobe describes Tolerance qualitatively as a percentage.*lower values.*higher values.*does not state numeric bounds/i
    );
    expect(replacement.purpose).not.toMatch(/0(?:–|-)?255/i);
    expect(tolerance?.detail).toMatch(
      /Adobe's archived 2015 reference does not state numeric bounds.*third-party mirrors says 0–255.*not corroborated by Adobe/i
    );
    expect(replacement.appNotes).toMatch(
      /Adobe does not state numeric bounds.*app uses a 0-100 slider.*exact Photoshop parity is unverified/i
    );
    expect(replacement.sources).toContain(
      'https://helpx.adobe.com/archive/en/photoshop/cc/2015/photoshop_reference.pdf'
    );
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

    it('cites Adobe for the temporary Eyedropper modifier on Brush and Pencil', () => {
      const source =
        'https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/choose-a-color-while-painting.html';

      for (const name of ['brush', 'pencil'] as const) {
        expect(toolDescriptions[name].sources).toContain(source);
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

  it('records the conflicting Adobe Smudge R sources without treating either as conclusive', () => {
    const smudge = toolDescriptions.smudge;
    const shortcut = smudge.shortcuts.find((item) => item.keys === 'R');

    expect(shortcut?.action).toMatch(
      /current desktop Smudge guide says R cycles through retouching tools.*2024 Rotate View guide labels Rotate View as R.*2019 shortcut reference also assigns R to Rotate View.*default binding is unresolved.*Keyboard Shortcuts and Menus dialog/i
    );
    expect(smudge.sources).toEqual(
      expect.arrayContaining([
        'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/smudge-image-areas.html',
        'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf',
        'https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html',
        'https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html',
      ])
    );
  });

  it('conditions shared tonal-tool cycling on Photoshop preference and preserves the active Exposure setting', () => {
    const reference = 'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf';

    for (const name of ['dodge', 'burn', 'sponge'] as const) {
      const description = toolDescriptions[name];
      const cycle = description.shortcuts.find((item) => item.keys === 'Shift+O');

      expect(cycle?.action).toMatch(
        /2019 shortcut reference says Shift\+O cycles.*when Use Shift Key for Tool Switch is enabled.*preference disabled, press O repeatedly to cycle/i
      );
      expect(description.sources).toContain(reference);
    }

    for (const name of ['dodge', 'burn'] as const) {
      const digits = toolDescriptions[name].shortcuts.find((item) => item.keys === '0–9');
      expect(digits?.action).toMatch(
        /2019 shortcut reference says number keys 0–9 set Exposure.*With Airbrush enabled, Shift\+number adjusts Exposure/i
      );
      expect(digits?.action).not.toMatch(/Shift\+number to set Opacity/i);
    }
  });

  it('separates Adobe Dodge/Burn Exposure digits from app shortcut support', () => {
    const reference = 'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf';

    for (const name of ['dodge', 'burn'] as const) {
      const description = toolDescriptions[name];
      const exposureShortcut = description.shortcuts.find((item) => item.keys === '0–9');
      const tool = name === 'dodge' ? 'Dodge' : 'Burn';

      expect(exposureShortcut?.action).toMatch(
        /2019 shortcut reference says number keys 0–9 set Exposure.*0 = 100%, 1 = 10%, and two quick digits set an exact percentage.*With Airbrush enabled, Shift\+number adjusts Exposure/i
      );
      expect(exposureShortcut?.action).toContain(`This app does not implement ${tool} Exposure digit shortcuts`);
      expect(description.sources).toContain(reference);
      expect(description.appNotes).toMatch(/does not implement Exposure digit shortcuts for Dodge or Burn/i);
    }
  });

  it('documents current Brush/Pencil digit bindings and their app limits', () => {
    const currentGuide =
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html';
    const reference = 'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf';

    for (const name of ['brush', 'pencil'] as const) {
      const description = toolDescriptions[name];
      const opacity = description.shortcuts.find((item) => item.keys === '0–9');
      const flow = description.shortcuts.find((item) => item.keys === 'Shift+0–9');

      expect(opacity?.action).toMatch(
        /current Photoshop.*bare number keys 0–9 set (Brush|Pencil) Opacity.*two quick digits set an exact percentage.*only 0 and 1/i
      );
      expect(flow?.action).toMatch(
        /Shift\+number sets Flow.*two quick digits set an exact percentage.*does not implement numeric Flow shortcuts/i
      );
      expect(description.sources).toEqual(expect.arrayContaining([currentGuide, reference]));
      expect(description.appNotes).toMatch(/does not implement digits `2`–`9`, two-digit exact Opacity/i);

      if (name === 'brush') {
        expect(flow?.action).toMatch(/2019 generic reference.*Airbrush enabled/i);
        expect(flow?.action).toMatch(/bare numbers set Flow and Shift\+number sets Opacity/i);
      } else {
        expect(flow?.action).toMatch(/limits Airbrush mode to the Brush.*does not apply to Pencil/i);
      }
    }
  });

  it("limits Sponge digit documentation to Adobe's generic Flow reference", () => {
    const sponge = toolDescriptions.sponge;
    const flow = sponge.shortcuts.find((item) => item.keys === 'Shift+0–9');

    expect(flow?.action).toMatch(
      /2019 generic painting\/editing shortcut reference says Shift\+number sets Flow.*historical generic evidence rather than a current Sponge-specific confirmation.*Airbrush.*does not establish whether that exception applies to the Sponge/i
    );
    expect(sponge.shortcuts.filter((item) => /[0-9]/.test(item.keys))).toEqual([flow]);
    expect(sponge.purpose).not.toMatch(/bare digit keys step Flow/i);
    expect(sponge.appNotes).toMatch(
      /2026 Sponge guide documents Flow but no numeric binding.*2019 generic painting\/editing reference assigns Flow to Shift\+number.*no Shift\+number handler sets Flow/i
    );
    expect(sponge.sources).toEqual(
      expect.arrayContaining([
        'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/adjust-color-saturation-in-selected-image-areas.html',
        'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf',
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
