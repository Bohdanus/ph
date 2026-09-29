import {
  planToolbarOverflow,
  type ToolbarOverflowPlan,
  type ToolbarRowMetrics,
  type ToolbarSlot,
} from './toolbar-overflow.ts';

/**
 * The rail's tool grid, measured.
 *
 * This is a store rather than a hook because measuring the grid means reading the DOM, and
 * every shape of that inside a component runs into `react-hooks/refs`: a `.current` read in
 * a `useCallback` body, or a ref handed to a helper, is reported as a render-phase ref
 * access whether or not the callback ever runs during render — and the rule cannot know
 * that a `ResizeObserver` callback or a `useSyncExternalStore` snapshot is not render. The
 * two ways out are to suppress the rule, which this repository does not do, or to keep the
 * DOM reads out of the component's closure entirely. So: the elements arrive through ref
 * callbacks, which is the one place the rule already accepts a write, and everything after
 * that is plain data.
 *
 * The consequence is worth stating, because it is the design's whole value: **the plan is a
 * function of the slot and of nothing else.** Not of the window, not of the rail's own box,
 * not of the grid's row in the shell. A panel the user has dragged off the left edge and
 * resized is an element with a height, and it would be measured by this same code.
 */
export type ToolbarFitStore = {
  /** Handed the slot and the tools box by their ref callbacks. `null` detaches. */
  attach(key: 'slot' | 'tools', element: HTMLElement | null): void;
  subscribe(onStoreChange: () => void): () => void;
  getSnapshot(): number;
  metricsFor(version: number): ToolbarRowMetrics;
};

const UNMEASURED: ToolbarRowMetrics = {
  availableHeight: 0,
  tileHeight: 0,
  rowGap: 0,
  sectionBreakHeight: 0,
};

/**
 * A computed length, or 0.
 *
 * `parseFloat` returns `NaN` for a value it cannot read, and a single `NaN` in `availableHeight`
 * silently disarms the whole rule: every comparison against it is false, so the fit accepts
 * every row and the rail never collapses — with nothing failing, because `NaN <= 0` is also
 * false and so is `naturalHeight <= budget`. 0 is the safe reading in both directions, since a
 * `0` there means "unmeasurable", which the planner already handles by showing everything.
 */
const length = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Read the grid's own geometry.
 *
 * Every number here is measured rather than declared, and that is the point: the tile
 * height, the grid's row gap and the section separator are CSS values a design change can
 * move at any time, and a planner fed a hard-coded `44` and a `6` would quietly disagree
 * with the screen the moment the class strings changed. So the planner is handed what the
 * DOM says, and the only constant left in the pipeline is the 80% budget, which is a policy
 * decision rather than a layout fact.
 */
const readRowMetrics = (slot: HTMLElement | null, tools: HTMLElement | null): ToolbarRowMetrics => {
  if (!slot || !tools) return UNMEASURED;

  // The slot bounds the TOOLS BOX, and the tools box carries its own padding and a border
  // inside that slot. Charging the fit for the full slot while the grid only gets what is
  // left over makes the plan 14px light on every measurement, and a plan that is 14px light
  // is a plan that overflows its own budget by 14px — invisible until a window height lands
  // on the boundary. Measured from computed style rather than subtracted as a constant, so a
  // padding change cannot silently reintroduce the same gap.
  const toolsStyle = getComputedStyle(tools);
  const toolsChrome =
    length(toolsStyle.paddingTop) +
    length(toolsStyle.paddingBottom) +
    length(toolsStyle.borderTopWidth) +
    length(toolsStyle.borderBottomWidth);
  const availableHeight = slot.getBoundingClientRect().height - toolsChrome;
  // The tile is read from the DOM rather than from a constant, so `h-11` can become `h-12`
  // without anything here knowing. Any rendered tile answers, including the three-dots tile,
  // so the measurement survives a collapse that empties every group.
  const tile = tools.querySelector<HTMLElement>('[data-toolbar-tile]');
  if (!tile) return { ...UNMEASURED, availableHeight };

  const tileHeight = tile.getBoundingClientRect().height;
  if (tileHeight <= 0) return { ...UNMEASURED, availableHeight };

  const lists = Array.from(tools.querySelectorAll<HTMLElement>(':scope > ul'));
  const rowGap = lists.length > 0 ? length(getComputedStyle(lists[0]).rowGap) : 0;

  // The section separator is what a section boundary costs ON TOP OF the grid's row gap, and
  // the way to read it is the distance from the previous list's BOTTOM to this section's
  // first TILE — not to this section's own top.
  //
  // `getBoundingClientRect().top` is the BORDER box, and the separator's own `pt-1.5` and
  // `border-t` are INSIDE that box. Measuring to the list's top therefore returns the margin
  // alone, which here is exactly the 6px row gap, so `between` came out 0 and the
  // `between > 0` guard silently discarded the separator entirely. The rail was modelled as
  // 794px and measured 822px: four boundaries, seven pixels each, never accounted for, and
  // nothing failed because the 20% budget hid the shortfall until a window height landed on
  // it. The first TILE's top is outside the padding, so it is the only one of the three that
  // measures what the planner actually charges.
  //
  // The nearest earlier NON-EMPTY list is used rather than the immediately preceding one, so
  // a collapse that empties a whole section cannot make the separator unmeasurable: an empty
  // `<ul>` is zero-height, so the distance to the section after it is unchanged either way.
  let sectionBreakHeight = 0;
  for (let index = 1; index < lists.length; index += 1) {
    const firstTile = lists[index].firstElementChild;
    if (!(firstTile instanceof HTMLElement)) continue;
    let previous = index - 1;
    while (previous >= 0 && lists[previous].childElementCount === 0) previous -= 1;
    if (previous < 0) continue;
    const between = firstTile.getBoundingClientRect().top - lists[previous].getBoundingClientRect().bottom - rowGap;
    if (between > 0) {
      sectionBreakHeight = between;
      break;
    }
  }

  return { availableHeight, tileHeight, rowGap, sectionBreakHeight };
};

const sameMetrics = (a: ToolbarRowMetrics, b: ToolbarRowMetrics): boolean =>
  a.availableHeight === b.availableHeight &&
  a.tileHeight === b.tileHeight &&
  a.rowGap === b.rowGap &&
  a.sectionBreakHeight === b.sectionBreakHeight;

export const createToolbarFitStore = (): ToolbarFitStore => {
  const elements: { slot: HTMLElement | null; tools: HTMLElement | null } = { slot: null, tools: null };
  const listeners = new Set<() => void>();
  let observer: ResizeObserver | null = null;

  // Two versions are kept, because that is all `useSyncExternalStore` can ask for: the
  // current one, and the one it rendered with while the store moved underneath it.
  let published = UNMEASURED;
  let version = 0;
  let previousVersion = -1;
  let previous: ToolbarRowMetrics = UNMEASURED;

  const observe = () => {
    observer?.disconnect();
    observer = null;
    if (!elements.slot || !elements.tools || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(publish);
    observer.observe(elements.slot);
    observer.observe(elements.tools);
  };

  function publish() {
    const next = readRowMetrics(elements.slot, elements.tools);
    // Nothing is published for a measurement that reads the same. A window drag fires an
    // observation per frame, and most of those frames do not change the fit.
    if (sameMetrics(next, published)) return;
    previousVersion = version;
    previous = published;
    published = next;
    version += 1;
    for (const listener of listeners) listener();
  }

  return {
    attach(key, element) {
      if (elements[key] === element) return;
      elements[key] = element;
      // The first attachment measures immediately, and it happens in a ref callback during
      // commit — so the rail is fitted before the browser paints rather than showing an
      // overflowing first frame and collapsing on the next one.
      publish();
      observe();
    },
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);
      // A ref callback can run before there is a listener to notify, so the measurement
      // that has not been announced yet is announced here.
      publish();
      if (observer === null) observe();
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0) observer?.disconnect();
      };
    },
    getSnapshot: () => version,
    // A fallback, and honestly one. `useSyncExternalStore` normally asks for the current
    // version or the one it last rendered with, and both are answered exactly; a THIRD,
    // staler version can only come from a render React discarded, and a discarded render
    // produces no output, so returning the current metrics is the safe answer and not a
    // silent lie about the past. It is a fallback rather than an error because the cost of
    // being wrong here is a re-derived plan on the next real measurement, not a wrong commit.
    metricsFor(requested) {
      if (requested === version) return published;
      if (requested === previousVersion) return previous;
      return published;
    },
  };
};

/** The plan for a set of rows at a given measurement, cached by {@link ToolbarFitStore}. */
export const planFor = (slots: readonly ToolbarSlot[], metrics: ToolbarRowMetrics): ToolbarOverflowPlan =>
  planToolbarOverflow(slots, metrics);
