# Navigation — research notes

The research half of `navigation.ts`, kept beside the module it documents for the reason
`docs/TOOLS-RESEARCH-BRIEF.md` states: a file about one module is that module's second half,
and `types.ts` cannot hold prose or a URL list.

**Membership.** One tool, the Hand. The rest of Adobe's navigation-and-measuring band — Zoom,
Rotate View, Frame, Slice, Slice Select, Perspective Crop, Artboard, Ruler, Note, Count — is
absent, and `docs/TOOLS-INVENTORY.md` is where each is catalogued. `HANDOFF.md` §74 names
Color Sampler, Ruler, Note and Count as the next cheapest architectural addition precisely
because they are pixel-free like the Eyedropper and like the Hand, so this module is where
they belong.

**Why it is a family and not a row elsewhere.** Nothing about the Hand resembles the
eyedropper except that both are small. The Hand writes the view store; the eyedropper writes
the foreground colour. They share no source, no options bar and no failure mode, and folding
navigation into `eyedropper-draw.ts` would make that module's name a lie.

## What Adobe's own page establishes, and what it does not

Adobe's Hand tool page was opened and is the only Adobe source behind this tool:

<https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html>

It establishes three things, and they are the three the implementation rests on:

1. **The tool is scoped to the magnified case.** "The Hand tool allows you to move your image
   while you're zoomed in to more than 100% and part of the image is out of view." This is the
   load-bearing sentence in the whole family, and it is why a zoom is what makes panning
   _worthwhile_ here: at Fit on Screen the document is fully visible by definition, so there is
   less reason to move it — though a drag there is fully allowed, and does move it. The scope is
   a statement about usefulness and was for a long while wrongly implemented as a statement about
   permission; see the clamp note below.
2. **Both activations.** "Select the Hand tool (H) from the toolbar **or** press and hold the
   spacebar key to temporarily switch to the Hand tool."
3. **The drag.** "Drag in any direction to move the image around and view different parts of the
   image."

It does **not** enumerate the options bar. `navigation.ts` declares `Fit On Screen` as the one
control because that is what `docs/TOOLS-INVENTORY.md` already recorded as sourced to Adobe's
viewing-images page, and it says so in the control's own `detail` rather than implying the bar
was audited.

## Third-party, and labelled as such

The `Cmd+0` Fit on Screen binding and the double-click-the-tool shortcut are not on the Adobe
page. They come from a CC2017 third-party shortcut sheet:

<https://www.nobledesktop.com/shortcuts/photoshopcc2017/pc>

which lists "Fit on Screen — Double-click on Hand tool or Ctrl-0", "100% View Level (Actual
Pixels) — Double-click on Zoom tool or Ctrl-1" and "Temporarily switch to Hand Tool — Spacebar".
The double-click is corroborated by an Adobe community thread, but a forum post is not Adobe
documentation and is not cited as such. Per the ladder in `docs/DOCUMENTATION.md`, Adobe's
documentation wins, and Adobe's page is silent on both — so these two are third-party
attributions and are recorded as such.

## App-side facts the description depends on

- **No Zoom tool.** The magnification behind the Hand is reached from `Cmd+0`, `Cmd+1`,
  `Cmd++`/`Cmd+-`, a wheel gesture and the Hand's own options bar. `docs/TOOLS-INVENTORY.md`
  records Rotate View, Zoom and the Hand/Zoom flyout separator as one of its four unresolved
  placements, and a flyout entry needs a second tool to open. The tile is therefore a singleton,
  which is the same reasoning `docs/TOOLS-INVENTORY.md` applies to Star: an entry for a tool
  that cannot be selected is worse than an absent tool.
- **`zoom` is a multiplier over the fit, not an absolute scale.** `zoom === 1` IS Fit on
  Screen, and Actual Pixels is `1 / fitScale`. The options-bar readout prints
  `fitScale * zoom * 100`, so a small image at Fit on Screen reads `25%` — which is what
  Photoshop shows and what printing the raw multiplier would get wrong.
- **The pan is NOT clamped, which took a correction to get right.** An earlier version held the
  bitmap's edges inside the container, and this file recorded that as a divergence from Adobe in
  the wrong direction — Adobe lets the image travel onto the pasteboard and out of the window
  entirely. The clamp was this app's own addition, and the reasoning behind it had conflated two
  claims: Adobe scopes the Hand to "zoomed in to more than 100% and part of the image is out of
  view", which says when panning is USEFUL, not that it is REFUSED when it is not. The clamp
  turned a statement about usefulness into a rule about permission, and the visible cost was that
  a drag did nothing at the zoom a user meets first. `view-transform.ts` now says so at the top,
  and `fitToScreen` is a recovery path rather than a convenience.
- **Space is refused mid-gesture.** `useTemporaryHand` reads `isDocumentGestureOpen()` and does
  not arm while a drag that will commit on release is in flight. Adobe moves the in-progress
  marquee in that case; this app pans nothing. The divergence is deliberate and belongs in
  `docs/OVERRIDES.md`, which this repository does not write — it is carried for the operator.

## Unverified

**Not researched at all.** Per `docs/TOOLS-RESEARCH-BRIEF.md`, these belong here rather than
in a description's `sources` array.

- **The rest of Adobe's Hand options bar.** Only `Fit On Screen` is claimed. `Scroll All
Windows` appears in third-party material and was not confirmed against an Adobe page, so it
  is neither declared nor implemented.
- **`ZOOM_LADDER`'s values.** `view-transform.ts` walks Adobe's `Ctrl+plus`/`Ctrl+minus` steps
  from knowledge rather than from an opened page, and is marked UNVERIFIED at the constant.
  They are named constants so that correcting them is a one-line change.
- **`MIN_ZOOM` and `MAX_ZOOM`.** `32` is a multiplier over the fit, chosen because CC2018
  shipped an "increased maximum zoom level" and 3200% is the figure Adobe's own material
  carries; it was not read off an Adobe page. `MIN_ZOOM` is below fit on purpose, so a small
  document can be pulled back to show its pasteboard, and that is a judgement call rather than
  an Adobe-derived value.
- **Flick Panning.** Adobe eases a Hand drag out and coasts; this app's pan stops at the
  pointer. Deliberately out of scope and not implemented.
- **Middle-button and two-finger panning.** Not researched, not implemented.
- **The rail position of the tile.** Adobe puts the Hand/Zoom group last among the tools and
  above the colour swatches, and the tile is placed there. Whether that leaves the divider in
  `SidebarLeft` where it belongs was settled against the current markup rather than against a
  screenshot of a restored default workspace, which is the artefact `docs/TOOLS-INVENTORY.md`
  names as settling its four open placements.
