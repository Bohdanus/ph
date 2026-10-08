import type { ToolDescription } from './types.ts';

export const patchDescriptions: Record<'patch', ToolDescription> = {
  patch: {
    photoshopName: 'Patch Tool',
    summary: 'Moves an active selection over a donor area and blends the donor texture into the selected target.',
    purpose:
      'Photoshop’s Patch Tool uses a selection as the repair target in Source mode, then samples a donor area while the selection is dragged. This deterministic MVP supports an existing active selection, Source mode, a donor drag, and a replayable raster action. Content-Aware, Destination, Pattern and Transparent modes are deferred.',
    options: [
      {
        control: 'Patch',
        detail: 'Source mode is implemented; Destination mode is deferred.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Patch/Patch.tsx:1',
      },
      {
        control: 'Diffusion',
        detail: 'Controls the deterministic edge feather approximation from 1 to 7.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Patch/Patch.tsx:1',
      },
      {
        control: 'Structure / Color / Adaptation',
        detail: 'Content-Aware controls are deferred because their synthesis is proprietary.',
        status: 'missing',
      },
      {
        control: 'Sample All Layers',
        detail: 'The MVP samples and writes the active raster layer only.',
        status: 'missing',
      },
    ],
    modifiers: [
      { keys: 'Alt/Option', action: 'Polygonal selection modifiers remain owned by the active selection tool.' },
    ],
    shortcuts: [
      {
        keys: 'J',
        action:
          'Selects the healing-tool flyout family; this app selects Healing Brush directly and exposes Patch from its flyout.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/patch.ts:1',
      'src/components/Main/PatchToolArea.tsx:1',
      'src/components/ToolbarsRight/Patch/Patch.tsx:1',
    ],
    appNotes:
      'The selected target rectangle is preserved when switching into Patch and is cleared normally when leaving the tool. The processor stores rectangle and donor coordinates directly so replay does not depend on live selection state.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/patch-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/repair-a-selected-area-with-the-patch-tool.html',
      'https://helpx.adobe.com/photoshop/using/content-aware-patch-move.html',
    ],
  },
};
