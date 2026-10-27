/**
 * Rotate View has no geometry, no pixel operation and no history — for the same reason the Hand
 * does not, and for a sharper one.
 *
 * Adobe's Rotate View "changes the angle at which you view the canvas, but it does not rotate
 * or transform the actual image", so it writes a field of the VIEW and nothing else. That makes
 * it the clearest case in the app of the rule `src/tools/descriptions/eyedropper-draw.notes.md`
 * reaches by deduction from Adobe's history rule: a history state comes from a change to pixels,
 * and this changes none. No processor, no history entry, no durable operation, and no
 * `RotateViewToolArea` claim on the document gesture — claiming that slot would make the tool
 * refuse its own drag for no benefit.
 *
 * The type is therefore the whole of it, exactly as it is for the Hand: what this tool reads and
 * writes lives in `src/hooks/document-view.ts`, and the Rotation Angle field in its options bar is
 * a command over that store rather than a setting on the tool.
 */
export type RotateViewToolArgs = { toolName: 'rotate-view' };
