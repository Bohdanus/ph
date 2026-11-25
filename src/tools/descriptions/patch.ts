import type { ToolDescription } from './types.ts';

export const patchDescriptions: Record<'patch', ToolDescription> = {
  patch: {
    photoshopName: 'Patch Tool',
    summary:
      'Repairs a selection with texture dragged from a donor. This app implements Source only; Destination, Content-Aware, Pattern and Transparent are unavailable.',
    purpose:
      "Photoshop's Patch Tool uses an active selection as the repair target in Source mode, then samples a donor area while the selection is dragged. The donor texture is blended into the target with luminance matching so the repair does not change the target area's overall brightness. Diffusion controls the feather width at the patch boundary (1–7, mapping to a 0–1 feather factor). This app implements a deterministic MVP: an existing active selection, Source mode only, a donor drag, and a replayable raster action. Content-Aware, Destination, Pattern, and Transparent modes are deferred because their synthesis is proprietary or requires architecture not present.",
    options: [
      {
        control: 'Patch',
        detail:
          'Top-level mode dropdown: Normal (Source or Destination sub-modes) or Content-Aware. In Normal mode, Source drags the selection to a donor area; Destination drags a donor area into the selection. Content-Aware synthesizes pixels from the surrounding area. The app renders a disabled dropdown showing only Normal > Source; Destination, Content-Aware, Pattern, and Transparent are not implemented.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Patch/Patch.tsx:15',
      },
      {
        control: 'Transparent',
        detail:
          'Normal mode only. When checked, applies texture with transparency rather than replacing pixels. Use on simple backgrounds (e.g., sky, solid color). The app does not implement this.',
        status: 'missing',
      },
      {
        control: 'Use Pattern',
        detail:
          'Normal mode only. Fills the selection with a pattern preset using a healing-type blend. The app does not implement this.',
        status: 'missing',
      },
      {
        control: 'Diffusion',
        detail:
          'Normal mode only. Controls how smoothly the patch blends at the edge (1–7). Lower values for detail, higher for smooth areas. Photoshop describes it as "how quickly the pasted region adapts to the surrounding image"; exact algorithm unpublished. The app maps this to a feather factor of `diffusion / 7` (0 to 1), applied as a linear falloff from the patch edge inward over 4 pixels: `weight = 1 - feather * min(1, min(distToLeft, distToTop, distToRight, distToBottom) / 4)`.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Patch/Patch.tsx:19',
      },
      {
        control: 'Structure / Color / Adaptation',
        detail:
          'Content-Aware mode only. Structure (1–7) controls how closely the patch adheres to existing image patterns (7 = strong adherence). Color (0–10) controls algorithmic color blending (0 = off, 10 = maximum). Adaptation (Strict / Medium / Loose / Very Loose) controls how loosely the patch adapts to surroundings; default Medium. These are deferred because their synthesis is proprietary.',
        status: 'missing',
      },
      {
        control: 'Sample All Layers',
        detail:
          'Content-Aware mode only. When on, the donor is sampled from merged visible layers rather than the active layer alone, enabling non-destructive work on a new empty layer. The MVP samples and writes the active raster layer only.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt/Option',
        action:
          'Polygonal selection modifiers remain owned by the active selection tool. The Patch tool itself reads no modifier keys; it requires a pre-existing selection.',
      },
    ],
    shortcuts: [
      {
        keys: 'J',
        action:
          "Selects the healing-tool flyout family; this app selects Healing Brush directly and exposes Patch from its flyout. Photoshop's J cycles Spot Healing Brush, Healing Brush, Patch, Red Eye, Remove, and Content-Aware Move.",
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/patch.ts:15',
      'src/components/Main/PatchToolArea.tsx:50',
      'src/components/ToolbarsRight/Patch/Patch.tsx:1',
    ],
    appNotes:
      "The tool requires an active selection (`activeSelectionId` with `isActive: true`) and a non-bedrock active layer. The active selection is preserved when switching among selection-aware tools and safe non-destructive tools; pixel-editing tools that do not clip to selections clear it before editing. The processor stores rectangle and donor coordinates directly in the tool args so replay does not depend on live selection state. The gesture: pointer-down on the selection starts a drag; pointer-move previews the donor texture via `tempUpdateLayer` (live preview, no history); pointer-up commits via `updateLayerByTool` (one history entry). The donor point is computed as `selection.pos + (currentPointer - dragStart)`. The app uses `selection.pos` as a rectangular target; non-rectangular contours and feathered selection coverage do not clip the repair, so use a rectangular selection for an exact target. Luminance correction matches the donor's luminance to the target before blending (`correction = targetLuminance - donorLuminance`), keeping the repaired patch from changing the target area's overall brightness. The feather factor is `diffusion / 7` (0 at diffusion=0, 1 at diffusion=7), applied as a linear falloff from the patch edge inward over 4 pixels. The blend uses `blendPixel` with the corrected donor color and the computed weight. The tool is disabled (cursor-not-allowed) when no valid selection or layer exists. No keyboard shortcut selects Patch directly; it is reached via the healing flyout from Healing Brush (J). Source mode only; Destination mode dropdown is rendered but disabled. Content-Aware, Pattern, and Transparent modes are absent. Sample All Layers is absent. The app has no Info panel readout for the patch.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/patch-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/repair-a-selected-area-with-the-patch-tool.html',
      'https://helpx.adobe.com/photoshop/using/content-aware-patch-move.html',
    ],
  },
};
