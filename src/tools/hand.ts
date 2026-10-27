/**
 * The Hand tool has no geometry, no pixel operation and no history.
 *
 * It moves the VIEW — a change of vantage point over the document — rather than the document.
 * That is Adobe's own classification: a zoom belongs in the same class as "a panel move or a
 * tool switch", which is why `src/tools/descriptions/eyedropper-draw.notes.md` reaches the
 * same conclusion about a colour sample by deduction from that rule. Nothing here is part of
 * the document, so nothing here belongs in `src/tools/toolProcessors.ts` — the Hand is in
 * `PIXEL_FREE_TOOLS`, exactly as the eyedropper is.
 *
 * The type is therefore the whole of it: the tool has no options of its own. What it reads
 * and writes lives in `src/hooks/document-view.ts`, and its one options-bar control
 * (Fit On Screen) is a command over that store rather than a setting on the tool.
 */
export type HandToolArgs = { toolName: 'hand' };
