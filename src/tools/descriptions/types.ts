/**
 * The contract every per-tool Photoshop description is written against.
 *
 * This file is the load-bearing half of the feature: the eight family modules under
 * `src/tools/descriptions/` are written by independent research passes, and they only
 * interoperate because they all import these types. `index.ts` merges them into a
 * `Record<ToolName, ToolDescription>`, so a family that omits a tool, or that renames a
 * field, is a TypeScript error rather than a silently missing tooltip.
 *
 * Everything here is a *type*, deliberately. The prose is data; where the prose comes from
 * is recorded per tool in `sources`, and a description with an empty `sources` array is a
 * claim with no provenance, which `src/tools/descriptions/__tests__/` fails.
 */

/** How a control in Photoshop's options bar maps onto this application. */
export type ToolControlStatus =
  /** The app renders this control and it does what Photoshop's does. */
  | 'present'
  /** The control exists and is wired, but its behaviour or range diverges from Photoshop's. */
  | 'partial'
  /** The app does not render this control. */
  | 'missing'
  /**
   * The control is declared or displayed, and nothing is wired behind it.
   *
   * Two shapes qualify, and both are the same defect. A control can have state in
   * `src/tools/settings.ts` that persists and drives nothing, or it can be a label on a
   * placeholder chip that no component ever reads. `missing` would be a lie for both: the
   * control is on screen, which is exactly what makes it dangerous — a screenshot shows a
   * complete options bar for a tool that does nothing.
   *
   * This is the status that catches the most common false "the app already has it" claim, so it
   * exists as its own value rather than a `present` with a footnote.
   */
  | 'inert';

export type ToolControl = {
  /**
   * The control's name in Photoshop's options bar, verbatim — `Size`, `Hardness`, `Tolerance`,
   * `Sample Size`, `Mode`, `Feather`, `Anti-alias`, and so on. Not the app's name for it.
   */
  control: string;
  /**
   * What the control does in Photoshop, and Photoshop's default value and range where the
   * control is numeric. One sentence, or two when the default differs from the app's.
   */
  detail: string;
  /** Whether the app renders this control. */
  status: ToolControlStatus;
  /**
   * The app's rendering of the control, as `file:line` into the working tree. Required for
   * every status except `missing`; omit it only when there is genuinely nothing to point at.
   */
  appRef?: string;
};

/** A keyboard shortcut bound outside the tool's own options bar. */
export type ToolShortcut = {
  /** macOS notation, as the app's tooltips and Photoshop's menus both print it: `B`, `Shift+B`, `[`, `]`. */
  keys: string;
  /** What pressing it does while this tool is active. */
  action: string;
};

/** A modifier held while dragging with this tool. */
export type ToolModifier = {
  /** `Shift`, `Alt`, `Alt+Shift`, `Space`, or a two-key combination Photoshop binds. */
  keys: string;
  /** What holding it changes about the drag. */
  action: string;
};

/**
 * How much of the tool the application actually implements.
 *
 * The three values are about **what the tool does to the document**, never about what its
 * options bar looks like. That distinction is load-bearing and it was originally got wrong
 * here: an earlier version of this comment defined `placeholder` as "renders `PlaceholderTool`
 * with a TODO badge", which is a property of the BAR. The Color Replacement Tool renders
 * exactly such a bar and is not a placeholder — it has a live gesture surface, a `raster`
 * commit and a real replayable processor, and a drag commits a visible layer. Filing it as
 * `placeholder` said "this tool does nothing" about a tool that paints.
 *
 * - `placeholder` — selectable, but it commits nothing. No gesture surface, `commit:
 *   'unimplemented'`, an `imageProcessor` that returns `null`. Nothing reaches the document.
 * - `implemented` — the tool's primary gesture behaves as Photoshop's, and nothing the app
 *   renders contradicts Photoshop. Gaps are allowed, and they are recorded per control as
 *   `missing`; a missing control is a capability the app lacks, not a divergence.
 * - `partial` — the app does something Photoshop's tool also does, but **not the same
 *   something**: a wrong default, a wrong algorithm, a control welded to one of its states, a
 *   gesture that does something else. Narrowness is not partiality; getting it wrong is.
 *
 * The `implemented` / `partial` line is the one that has to be written down, because leaving
 * it undefined does not leave the agents neutral — it leaves each of them to invent a bar,
 * and the verdicts diverge. When a tool has no Photoshop counterpart at all, there is no
 * contract to diverge from, and the verdict describes the app's own behaviour instead.
 */
export type ToolImplementationStatus = 'implemented' | 'partial' | 'placeholder';

export type ToolDescription = {
  /**
   * Adobe's name for the tool, verbatim from the Tools panel, e.g. `Lasso Tool`.
   * Several `ToolName`s are `figure` variants of one Photoshop tool (all five shape tools),
   * so this repeats across them while `summary` and `purpose` are tool-specific.
   */
  photoshopName: string;
  /** One sentence, at most ~140 characters. This is what the toolbar tooltip shows. */
  summary: string;
  /**
   * What the tool does and when a user reaches for it, in prose. Two to five sentences. It
   * describes *Photoshop's* tool, not this app's, and diverges from `summary` only in
   * necessary detail. `appNotes` is where the app's divergence goes.
   */
  purpose: string;
  /**
   * Every control Photoshop places in this tool's options bar, in bar order. An empty array
   * is legitimate (the Pen family's path-modification tools share the Pen's bar), and means
   * so only with a one-line reason — see the family's markdown fragment.
   */
  options: readonly ToolControl[];
  /** The modifier keys in effect during a drag. */
  modifiers: readonly ToolModifier[];
  /** Keyboard shortcuts beyond the bare toolbar letter. */
  shortcuts: readonly ToolShortcut[];
  /** How much of the tool the app implements. */
  implementation: ToolImplementationStatus;
  /**
   * `file:line` into the working tree for the app's implementation, at least one entry. A
   * tool the app does not implement still cites where the absence is declared.
   */
  implementationRefs: readonly string[];
  /**
   * How the app's behaviour diverges from Photoshop's, in prose, and why. Empty only when the
   * app matches Photoshop, which is rare and should be justified in the markdown fragment.
   */
  appNotes: string;
  /**
   * URLs that establish the Photoshop claims above. Adobe's own documentation first, then
   * Adobe's developer reference, then a third party. Never a URL that was not opened. A
   * claim that could not be sourced belongs in the family's markdown fragment under
   * `Unverified`, not in this array.
   */
  sources: readonly string[];
};
