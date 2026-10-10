# Adobe Layers and History Research

This is the repository's processed summary of Adobe Photoshop documentation fetched and reviewed on
2026-10-09. Adobe is the source of truth for Photoshop behavior; operator requirements in
[`LAYERS-PANEL.md`](LAYERS-PANEL.md) override Adobe only where this clone deliberately chooses a
narrower browser implementation.

## Layers panel

Adobe's [Work with the Layers panel](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/work-with-the-layers-panel.html)
(updated 2026-02-23) describes the panel as the document's visual layer stack. Its concise controls
are:

> "The Layers panel visually represents all layers in your document, allowing you to select, hide,
> reorder, and modify layers without affecting other elements."

The same page documents `Window > Layers`, the eye control beside a layer thumbnail, dragging a layer
up or down to reorder it, renaming by double-clicking the layer name, and creating a layer from the
bottom action icon. This establishes that thumbnails belong to layer rows and that a layer preview is
not a History-panel concern.

Adobe's [Optimize Photoshop performance](https://helpx.adobe.com/photoshop/kb/optimize-photoshop-cc-performance.html)
page explicitly calls them thumbnail previews:

> "Each time you change a document, Photoshop updates all the thumbnails visible in the Layers and
> Channels panels."

It also says Panel Options can choose a smaller thumbnail size or `None`. This repo currently ships
one useful preview size, rendered by `LayerThumbnail`, while retaining the future preference as a
display-only setting rather than document state.

## History panel

Adobe's [History panel settings](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html)
(updated 2026-02-23) defines a different surface:

> "The History panel in Photoshop lets you quickly access recent states of your image during the
> current session. Each change you make, like selecting, painting, or rotating, is recorded
> separately."

Adobe's [Manage image states](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/manage-image-states.html)
page says selecting a state reverts the image to that point and that closing the document clears
history states and snapshots. The History panel therefore remains a chronological text list in this
clone. Snapshot thumbnails are a separate future feature, not a reason to add thumbnails to ordinary
history rows.

## Panel dimensions and docking

Adobe documents panel movement in [Move panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html)
and [Dock or undock panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/dock-undock-panels.html):

> "Drag the panel by its tab to a new location."

and:

> "A dock is a collection of panels grouped together vertically."

Adobe also documents that dragging the bottom edge of a dock can change how much of the workspace
the dock fills. Its [Stack floating panels](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/stack-floating-panels.html)
page states:

> "Double-click a tab to minimize or maximize a panel, group, or stack. Drag any panel edge to resize
> it."

The shared panel engine's divider behavior is described in Adobe's [Dock, Undock, Group and Float
Panels](https://helpx.adobe.com/premiere-elements/using/dock--undock--group-and-float-panels.html)
documentation: dividers expose a resize cursor, and dragging a divider resizes the groups that share
it. Photoshop's own page does not spell out the pixel arithmetic, so this app uses a persisted ratio
with a minimum height for each panel.

## Repository decisions

- Adobe behavior is authoritative for layer thumbnails, History's temporal/session role, and panel
  edge/divider resizing.
- The operator explicitly requires the rail and right dock to stay pinned to the window edges, so the
  clone does not expose Adobe's documented re-docking/floating gestures.
- `HistoryItem[]` remains the production replay authority. Panel dimensions, thumbnail rendering, and
  other display preferences must never enter document history or mark the document dirty.
- A layer thumbnail uses `drawLayerSource` and the layer's existing presentation caches. It does not
  create a second document renderer or add a History thumbnail.
