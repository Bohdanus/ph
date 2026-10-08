# Patch Tool Research

Adobe documents the Patch Tool as a selection-based retouch tool. In Normal
Source mode, the selection is the repair target and dragging it over a donor
area supplies texture; Diffusion controls the edge blend. Content-Aware mode,
Destination mode, Pattern, Transparent, Structure, Color, Adaptation and Sample
All Layers are separate behaviours and are not implemented in this deterministic
MVP.

The app preserves the active selection while switching into Patch, copies its
rectangle into the raster args, and records the donor point. This makes the
`raster-processor` replay independent of live selection state while retaining
one undoable action per patch.

Sources:

- <https://helpx.adobe.com/photoshop/using/tool-techniques/patch-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/repair-a-selected-area-with-the-patch-tool.html>
- <https://helpx.adobe.com/photoshop/using/content-aware-patch-move.html>
