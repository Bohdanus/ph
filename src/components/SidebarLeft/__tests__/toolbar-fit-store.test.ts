import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolbarFitStore, planFor } from '../toolbar-fit-store.ts';
import type { ToolbarFitStore } from '../toolbar-fit-store.ts';
import type { ToolbarRowMetrics, ToolbarSlot } from '../toolbar-overflow.ts';

/**
 * The store's two jobs, neither of which the component can be asked about in jsdom.
 *
 * The rail's fit has one external input — the height of the slot the tiles live in — and two
 * requirements that are invisible in the rendered DOM: it must publish a plan whenever the
 * plan changes, and it must NOT publish when the plan has not. The second is the throttle. A
 * `ResizeObserver` reports every frame of a window drag, the tile count is a step function
 * of the height, and a store that published every measurement would re-render sixteen tiles
 * about five hundred times to draw the same twenty rows. Both are properties of the store's
 * publishing, so they are tested here rather than through a render count.
 *
 * The geometry is stubbed rather than laid out: `getBoundingClientRect` is 0 for every box
 * in jsdom, so a real measurement reads "unmeasurable" and the planner correctly shows
 * everything — which is why these tests have to drive the store through a real measurement
 * before their claims mean anything, and why every one of them asserts a COUNT rather than
 * the absence of an error.
 */

const TILE = 44;
const GAP = 6;
/** `pt-1.5` inside a section list — 6px of padding that sits BELOW the list's border-box top. */
const SEPARATOR_PADDING = 6;
/** `border-t` — 1px, also inside the box, which is the whole point of the harness below. */
const SEPARATOR_BORDER = 1;
/**
 * What a section boundary costs the planner, on top of the grid's row gap:
 * `mt-1.5 border-t pt-1.5` is 6 + 1 + 6 = 13, and 13 − 6 leaves 7.
 */
const SEPARATOR = SEPARATOR_PADDING + SEPARATOR_BORDER;

/** One group per row. `sectionIndexes` places the section boundaries, which is the separator. */
const rows = (count: number, sectionIndexes?: number[]): ToolbarSlot[] =>
  Array.from({ length: count }, (_unused, index) => ({
    keys: [`s0-${index}`],
    sectionIndex: sectionIndexes?.[index] ?? 0,
  }));

/** A section index per row, for `count` rows in `perSection` equal sections. */
const sectionsOf = (count: number, perSection: number): number[] =>
  Array.from({ length: count }, (_unused, index) => Math.floor(index / perSection));

const rect = (height: number, top: number) =>
  ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 56,
    bottom: top + height,
    width: 56,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * Render the section lists the rail's tools box holds, and re-render them when the test
 * changes what is on the rail.
 *
 * Each list records its own tile count in `data-tiles` and its first tile's offset in
 * `data-test-top`, because those two are exactly the geometry `readRowMetrics` reads: the
 * tile's height, and the distance from the previous list's bottom to this one's first tile,
 * less the row gap.
 *
 * **THE LIST'S OWN BOX TOP IS NOT ITS FIRST TILE'S TOP, and the harness has to say so.** The
 * separator's `pt-1.5` and `border-t` are inside the list's border box, so a list that opens a
 * section starts `pt + border` = 7px ABOVE its first tile. Giving both the same `top` — which is
 * what a first draft of this file did — makes the border-box bug invisible here: measuring to the
 * list instead of the tile then produces the right answer by accident, and a mutation that
 * reintroduced the very defect these tests exist for passed all five of them. The browser caught
 * it (`e2e/toolbar-fit.spec.ts` reports `over=1.0`); this file has to be able to as well.
 */
const renderSections = (tools: HTMLElement, counts: number[]): void => {
  tools.replaceChildren();
  let bottom = 0;
  for (const count of counts) {
    const list = tools.ownerDocument.createElement('ul');
    list.dataset.tiles = String(count);
    for (let index = 0; index < count; index += 1) {
      const tile = list.ownerDocument.createElement('button');
      tile.setAttribute('data-toolbar-tile', '');
      // The FIRST tile of a list carries the list's own content-box top, because that is the box
      // the separator is measured to — the distance from the previous list's bottom to this
      // one's first tile, less the row gap.
      if (index === 0) {
        // A section that is not the first costs the separator's margin, padding and border on
        // top of the row gap; the first costs nothing above itself.
        const breaks = bottom > 0 ? SEPARATOR + GAP : 0;
        list.dataset.testTop = String(bottom + breaks - SEPARATOR_PADDING - SEPARATOR_BORDER);
        tile.dataset.testTop = String(bottom + breaks);
      }
      list.append(tile);
    }
    const contentHeight = count === 0 ? 0 : count * TILE + Math.max(0, count - 1) * GAP;
    const top = count === 0 ? bottom : Number(list.dataset.testTop);
    // The list's border box reaches 7px further UP than its content when it opens a section.
    list.dataset.borderTop = String(top - (count === 0 ? 0 : SEPARATOR_PADDING + SEPARATOR_BORDER));
    bottom = top + contentHeight;
    tools.append(list);
  }
};

/** A slot and a tools box, wired to a store, with the geometry under the test's control. */
type Harness = {
  store: ToolbarFitStore;
  slot: HTMLElement;
  tools: HTMLElement;
  /** Every published version, in order. */
  published: number[];
  /** How many tiles each section list holds, mutated to change the rail. */
  sections: number[];
  /** Set the slot's height, the way a window drag would. */
  setSlotHeight(height: number): void;
  /** Re-render the section lists, the way a collapse would, and notify. */
  setSections(counts: number[]): void;
  /** Drop the harness's own subscriber, so `listeners.size` can reach zero. */
  silence(): void;
  /** The plan for a row model, derived from the store's CURRENT metrics. */
  fittedThrough(slots: readonly ToolbarSlot[]): number;
  metrics(): ToolbarRowMetrics;
};

const harness = (initialSections: number[], initialSlotHeight: number): Harness => {
  const slot = document.createElement('div');
  slot.setAttribute('data-testid', 'left-toolbar-slot');
  const tools = document.createElement('div');
  slot.append(tools);
  document.body.append(slot);

  const sections = [...initialSections];
  let slotHeight = initialSlotHeight;
  renderSections(tools, sections);

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName === 'UL') {
      const count = Number((this as HTMLElement).dataset.tiles ?? 0);
      // The list's BORDER box, which for a section that opens a boundary reaches further up
      // than its content: `pt-1.5` and `border-t` are inside it.
      const top = Number((this as HTMLElement).dataset.borderTop ?? 0);
      const contentHeight = count === 0 ? 0 : count * TILE + Math.max(0, count - 1) * GAP;
      return rect(
        contentHeight +
          (top < Number((this as HTMLElement).dataset.testTop ?? 0) ? SEPARATOR_PADDING + SEPARATOR_BORDER : 0),
        top
      );
    }
    if (this.hasAttribute('data-toolbar-tile')) {
      return rect(TILE, Number((this as HTMLElement).dataset.testTop ?? 0));
    }
    if (this.getAttribute('data-testid') === 'left-toolbar-slot') return rect(slotHeight, 0);
    return rect(0, 0);
  });
  const style = vi.spyOn(window, 'getComputedStyle');
  const original = style.getMockImplementation();
  style.mockImplementation(((element: Element) => {
    const computed = original ? original(element) : document.createElement('div').style;
    if (element.tagName !== 'UL') return computed as CSSStyleDeclaration;
    // The grid's row gap, read from computed style by `readRowMetrics`.
    return new Proxy(computed, {
      get: (target, property) => (property === 'rowGap' ? `${GAP}px` : Reflect.get(target, property)),
    }) as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle);

  const store = createToolbarFitStore();
  const published: number[] = [];
  const collect = () => {
    published.push(store.getSnapshot());
  };
  const releaseCollector = store.subscribe(collect);
  store.attach('slot', slot);
  store.attach('tools', tools);

  const notify = (): void => {
    for (const observer of [...ManualResizeObserver.instances]) observer.callback();
  };

  return {
    store,
    slot,
    tools,
    published,
    sections,
    setSlotHeight(height) {
      slotHeight = height;
      notify();
    },
    setSections(counts) {
      sections.splice(0, sections.length, ...counts);
      renderSections(tools, counts);
      notify();
    },
    silence: () => {
      releaseCollector();
    },
    fittedThrough: (slots) => planFor(slots, store.metricsFor(store.getSnapshot())).fittedThrough,
    metrics: () => store.metricsFor(store.getSnapshot()),
  };
};

/** A `ResizeObserver` the test fires by hand, because jsdom's polyfill never does. */
class ManualResizeObserver {
  static instances: ManualResizeObserver[] = [];
  readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    ManualResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    ManualResizeObserver.instances = ManualResizeObserver.instances.filter((one) => one !== this);
  }
}

describe('the toolbar fit store', () => {
  beforeEachSetup();

  it('publishes when the plan changes, and stays silent while the plan does not', () => {
    // THE THROTTLE, as a count rather than as a description. The slot grows one pixel at a
    // time through a hundred frames, which is what a window drag is; a store that published
    // every measurement would notify a hundred times and re-render the rail a hundred times
    // to draw the same rows. A store that publishes only on a plan change notifies once per
    // row boundary, and the count is what a future change to this file has to keep.
    const rail = harness([10], 200);
    const model = rows(10);
    rail.store.setSlots(model);

    expect(rail.fittedThrough(model), 'a 200px slot holds three rows and the tile').toBe(3);
    expect(rail.metrics().availableHeight, 'and it was really measured').toBe(200);
    const baseline = rail.published.length;

    // 100 pixels of drag. A row is 50px, so the count moves at 244 and at 294 and nowhere
    // else — two notifications, exactly, and the exact count is the assertion because a
    // bound would still have passed a store that published on every OTHER frame.
    for (let height = 201; height <= 300; height += 1) rail.setSlotHeight(height);

    const notifications = rail.published.length - baseline;
    expect(notifications, `the drag notified ${notifications} times over 100 pixels of window, and a row is 50px`).toBe(
      2
    );
    expect(rail.fittedThrough(model), 'five rows plus the tile is the most a 300px slot holds').toBe(5);
  });

  it('recalculates the count on every observation, not only on the ones it publishes', () => {
    // The throttle suppresses RENDERS, not measurements, and the difference is the whole
    // claim. A store that stopped measuring between publishes would keep publishing the plan
    // it already had for a window that had grown past it, which is the defect a throttle
    // introduces when it is written at the wrong layer.
    //
    // Note what the store does and does not keep: a measurement whose plan matched the one on
    // screen is NOT retained, so `metricsFor` hands back the metrics the published plan came
    // from rather than the newest reading. That is correct for everything the rail draws — the
    // two plans are identical, which is why nothing was published — and this test is therefore
    // about the COUNT following the slot, not about the metrics.
    const rail = harness([10], 200);
    const model = rows(10);
    rail.store.setSlots(model);

    const countAt = (height: number): number => {
      rail.setSlotHeight(height);
      return rail.fittedThrough(model);
    };

    expect(countAt(200)).toBe(3);
    expect(countAt(240)).toBe(3);
    expect(countAt(193)).toBe(2);
    expect(countAt(290)).toBe(4);
    // And the last step really was published, which is the observable form of "it measured
    // it": a 290px slot and a 200px slot produce different plans, so the metrics behind the
    // final answer are the final reading and not the first.
    expect(rail.metrics().availableHeight).toBe(290);
  });

  it('keeps the section separator it measured when a later layout cannot see one', () => {
    // `HANDOFF.md` §97. The separator is only in the DOM while a section after the first
    // still has a tile in it, so the layout that has collapsed sections 1 through 4 measures
    // zero of it — and a fit that plans with zero where the CSS charges seven accepts a row
    // the grid cannot render. So the last real reading is kept, which makes the plan a
    // function of the slot and of the class string rather than of the previous render.
    const rail = harness([3, 3, 3], 2000);
    const model = rows(9, sectionsOf(9, 3));
    rail.store.setSlots(model);

    expect(rail.metrics().sectionBreakHeight, 'a full grid has a separator to measure').toBe(SEPARATOR);
    expect(rail.metrics().rowGap, 'and a row gap, read from computed style').toBe(GAP);

    // Everything below the first section collapses away: one non-empty `<ul>` is left and the
    // DOM genuinely has no separator in it — the same `between > 0` guard that used to read
    // zero and take the whole plan with it.
    rail.setSections([3]);
    rail.setSlotHeight(250);

    expect(rail.metrics().sectionBreakHeight, 'the separator survives the layout that hides it').toBe(SEPARATOR);
    // And the plan it produces is the one §97 says was false. At 250px the fourth row is the
    // first row of the second section: with the separator it costs 201px and the three-dots
    // tile takes it to 251, which does not fit; without the separator it costs 194px and 244,
    // which does. One row, and a 7px band of window heights that decides it.
    const blind = { ...rail.metrics(), sectionBreakHeight: 0 };
    expect(planFor(model, blind).fittedThrough, 'a fit that cannot see the separator takes one row too many').toBe(4);
    expect(rail.fittedThrough(model), 'and the one that kept it does not').toBe(3);
  });

  it('publishes the fit when the row model arrives after the elements', () => {
    // The mount order is fixed: ref callbacks attach the elements, and only then does the
    // effect hand over the rows. Nothing about the measurement changes when the model does,
    // so a store that compared measurements alone would publish nothing — and the rail would
    // sit on whatever plan its first render derived until something else resized the slot.
    const rail = harness([5], 200);
    const model = rows(5);
    rail.store.setSlots(model);

    expect(rail.fittedThrough(model), 'the model fits the rail').toBe(3);
    expect(rail.published.length, 'and handing it over published').toBeGreaterThan(1);
  });

  it('ignores a row model it already has', () => {
    // `toolbarSlots` is memoised on the rail's layout, so a flyout opening or a colour change
    // re-renders the component with the SAME array. Handing it over again must not publish,
    // or every unrelated re-render would run the planner.
    const rail = harness([5], 200);
    const model = rows(5);
    rail.store.setSlots(model);
    const baseline = rail.published.length;

    rail.store.setSlots(model);

    expect(rail.published.length).toBe(baseline);
  });

  it('refits when the row model changes, which is what crossing the layout breakpoint is', () => {
    // The handover that matters. The one-column rail mints `one-column-N` keys and one row per
    // group; the two-column rail mints `two-column-N` keys and pairs groups into rows. Every row
    // is therefore re-keyed and every row count changes, so a store that only honoured the FIRST
    // model would keep planning one-column rows for the rest of the session — and it would do it
    // silently, because the plan it derived from the wrong model is still a plan.
    const rail = harness([5], 200);
    rail.store.setSlots(rows(5));
    const baseline = rail.published.length;

    // Two columns: one row per PAIR of groups, which is half as many rows for the same tools.
    const paired: ToolbarSlot[] = Array.from({ length: 8 }, (_unused, row) => ({
      keys: [`two-column-${row * 2}`, `two-column-${row * 2 + 1}`],
      sectionIndex: 0,
    }));
    rail.store.setSlots(paired);

    expect(rail.published.length, 'a different row model is a publish').toBeGreaterThan(baseline);
    // Five single rows fit a 200px slot; three paired rows do, and the plan has to be derived
    // from the model that was handed over rather than the one that was first.
    expect(rail.fittedThrough(paired), 'the new model is what the plan comes from').toBe(3);
  });

  it('re-arms the observer after the last subscriber goes away', () => {
    // A DISCONNECTED observer left non-null would make the next `subscribe` skip `observe()`,
    // and the rail would stop refitting on resize with nothing in the console to say so. The
    // guard that re-arms is `observer === null`, so the teardown has to null it as well as
    // disconnect it — and the only way to see that is to go quiet, resize, and come back.
    const rail = harness([10], 200);
    const model = rows(10);
    rail.store.setSlots(model);
    expect(rail.fittedThrough(model), 'three rows and the tile fit a 200px slot').toBe(3);

    rail.silence();
    // While nobody is listening the observer is torn down, so this resize is not seen. It is
    // also not something the store has any obligation to report, which is why the test asserts
    // on what happens AFTER the silence rather than during it. 700 is a height at which all ten
    // rows fit, so the next step has somewhere to go.
    rail.setSlotHeight(700);

    // The subscriber of record for this test — the harness's own is gone, which is the point.
    const notified: number[] = [];
    const subscribe = rail.store.subscribe(() => notified.push(rail.store.getSnapshot()));
    // Subscribing publishes once on its own account, so only what happens after it counts.
    notified.length = 0;
    rail.setSlotHeight(400);

    expect(
      notified.length,
      'a resize after re-subscribing notified nobody, so the observer was left disconnected'
    ).toBeGreaterThan(0);
    expect(rail.fittedThrough(model), 'and the rail refits on it').toBe(7);
    subscribe();
  });
});

/** jsdom's `ResizeObserver` polyfill never fires, so the store is given one it can fire. */
function beforeEachSetup(): void {
  beforeEach(() => {
    ManualResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', ManualResizeObserver);
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}
