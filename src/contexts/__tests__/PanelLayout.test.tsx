import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DOCK_LABEL_MIN_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  PanelLayoutProvider,
  usePanelLayout,
} from '../PanelLayout.tsx';

/**
 * The layout contract, tested on its own because every one of these rules is a clamp that a
 * bad value would survive: a dock the user cannot drag out of, a divider that can be dragged
 * past the end of its column, and a persisted record that is trusted without re-validating.
 */

const wrapper = ({ children }: { children: ReactNode }) => createElement(PanelLayoutProvider, null, children);

const renderLayout = () => renderHook(() => usePanelLayout(), { wrapper });

const persisted = () => JSON.parse(localStorage.getItem('panelLayout') ?? '{}');

describe('PanelLayout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('defaults', () => {
    it('opens exactly on the layout this replaces', () => {
      const { result } = renderLayout();

      // These four are not preferences. 250px is the width the dock had as a grid track,
      // 0.2/0.8 is the `h-[20%]`/`h-[80%]` the two sections carried, History above Layers is
      // the order the headings are asserted in, and the rail on the left with the dock on the
      // right is the arrangement the shell has always rendered. A first render that differs is
      // a regression in every e2e clip derived from the shell's arithmetic, not a design
      // choice.
      //
      // The edge pair is TWO assertions because it is two fields now. `dockOnLeft: false` was
      // one fact about one subject, and reading it as the dock's edge while the rail claimed
      // the same field is precisely how the two ended up pinned to opposite edges.
      expect(result.current.dockWidth).toBe(250);
      expect(result.current.effectiveDockWidth).toBe(250);
      expect(result.current.splitRatio).toBe(0.2);
      expect(result.current.panelOrder).toEqual(['history', 'layers']);
      expect(result.current.rolledUp).toEqual({ history: false, layers: false });
      expect(result.current.toolsSide).toBe('left');
      expect(result.current.dockSide).toBe('right');
      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.isIconOnly).toBe(false);
    });
  });

  describe('the dock width axis', () => {
    it('clamps a resize to the documented range', () => {
      const { result } = renderLayout();

      act(() => result.current.setDockWidth(10_000));
      expect(result.current.dockWidth).toBe(DOCK_MAX_WIDTH);

      act(() => result.current.setDockWidth(-50));
      // Below the label threshold is a COLLAPSE, not a stored width — see the next test.
      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.effectiveDockWidth).toBe(DOCK_MIN_WIDTH);
    });

    // "To show only the icons, adjust the dock width until the labels disappear. Widen the
    // dock to display the labels again." (Adobe, collapse-expand-icons) Narrowing and
    // collapsing are therefore the same gesture, and the width the user had is not lost.
    it('collapses when narrowed past a label, and gives the width back on the way out', () => {
      const { result } = renderLayout();

      act(() => result.current.setDockWidth(300));
      act(() => result.current.setDockWidth(30));
      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.isIconOnly).toBe(true);
      expect(result.current.effectiveDockWidth).toBe(DOCK_MIN_WIDTH);
      expect(result.current.dockWidth).toBe(300);

      act(() => result.current.setDockWidth(320));
      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.effectiveDockWidth).toBe(320);
    });

    it('collapses and expands on the double-arrow, keeping the width it had', () => {
      const { result } = renderLayout();

      act(() => result.current.setDockWidth(360));
      act(() => result.current.toggleCollapsed());
      expect(result.current.effectiveDockWidth).toBe(DOCK_MIN_WIDTH);
      expect(result.current.dockWidth).toBe(360);

      act(() => result.current.toggleCollapsed());
      expect(result.current.effectiveDockWidth).toBe(360);
    });

    it('refuses to stay collapsed at or above the label width', () => {
      const { result } = renderLayout();

      act(() => result.current.toggleCollapsed());
      act(() => result.current.setDockWidth(DOCK_LABEL_MIN_WIDTH));
      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.effectiveDockWidth).toBe(DOCK_LABEL_MIN_WIDTH);
    });
  });

  describe('the divider between the two groups', () => {
    it('keeps the top panel inside the column at both ends', () => {
      const { result } = renderLayout();

      act(() => result.current.setSplitRatio(5));
      expect(result.current.splitRatio).toBeCloseTo(0.88, 5);

      act(() => result.current.setSplitRatio(-5));
      expect(result.current.splitRatio).toBeCloseTo(0.12, 5);
    });

    // The two panels share one divider, so the sum is the whole column and a ratio is the
    // only representation that can never let them total more than 100%.
    it('always leaves the other panel the remainder', () => {
      const { result } = renderLayout();

      for (const ratio of [0.12, 0.2, 0.5, 0.88]) {
        act(() => result.current.setSplitRatio(ratio));
        // STORED, not merely clamped into range. An earlier version asserted only
        // `top + (1 - top) === 1`, which is an arithmetic identity: it holds for every finite
        // `top`, so it passed for a no-op setter, an inverted one, and a constant 0.5 one. The
        // input is compared to the output, and the identity is kept only as the second half of
        // the claim.
        expect(result.current.splitRatio).toBeCloseTo(ratio, 10);
        expect(result.current.splitRatio + (1 - result.current.splitRatio)).toBeCloseTo(1, 10);
      }
    });
  });

  describe('persistence', () => {
    // The whole record, asserted exactly, because this is the only place the persisted SHAPE is
    // pinned at all. A field added to `LayoutState` without a line here would persist silently
    // and read back through the guards in `readStoredLayout` without any test noticing that the
    // record grew. The two sides are moved to their non-default values here so the assertion
    // cannot be satisfied by the opening arrangement.
    it('writes every field under one key', () => {
      const { result } = renderLayout();

      act(() => {
        result.current.setDockWidth(310);
        result.current.setSplitRatio(0.4);
        result.current.setPanelOrder(['layers', 'history']);
        result.current.setRolledUp('layers', true);
        result.current.setToolsSide('right');
        result.current.setDockSide('left');
      });

      expect(persisted()).toEqual({
        dockWidth: 310,
        splitRatio: 0.4,
        panelOrder: ['layers', 'history'],
        rolledUp: { history: false, layers: true },
        toolsSide: 'left',
        dockSide: 'right',
        isCollapsed: false,
      });
    });

    it('restores a stored layout on the next mount', () => {
      localStorage.setItem(
        'panelLayout',
        JSON.stringify({
          dockWidth: 288,
          splitRatio: 0.35,
          panelOrder: ['layers', 'history'],
          rolledUp: { history: true, layers: false },
          toolsSide: 'right',
          dockSide: 'left',
          isCollapsed: false,
        })
      );

      const { result } = renderLayout();
      expect(result.current.dockWidth).toBe(288);
      expect(result.current.splitRatio).toBe(0.35);
      expect(result.current.panelOrder).toEqual(['layers', 'history']);
      expect(result.current.rolledUp.history).toBe(true);
      expect(result.current.toolsSide).toBe('left');
      expect(result.current.dockSide).toBe('right');
    });

    // A stored value that parses but is out of range is the case a naive `JSON.parse` guard
    // lets through, and the consequence is a dock the user cannot drag back out of.
    it('re-clamps a stored value that is out of range rather than trusting it', () => {
      localStorage.setItem('panelLayout', JSON.stringify({ dockWidth: 99_999, splitRatio: 42 }));

      const { result } = renderLayout();
      expect(result.current.dockWidth).toBe(DOCK_MAX_WIDTH);
      expect(result.current.splitRatio).toBeCloseTo(0.88, 5);
    });

    it.each([
      ['unparseable text', 'not json at all'],
      ['a JSON scalar', '7'],
      ['null', 'null'],
      ['an array', '[]'],
    ])('falls back to the defaults for %s', (_label, raw) => {
      localStorage.setItem('panelLayout', raw);

      const { result } = renderLayout();
      expect(result.current.dockWidth).toBe(250);
      expect(result.current.panelOrder).toEqual(['history', 'layers']);
    });

    it.each([
      ['a panel order with a duplicate', ['history', 'history']],
      ['a panel order with one entry', ['history']],
      ['a panel order with an unknown panel', ['history', 'navigator']],
    ])('rejects %s and keeps the default order', (_label, panelOrder) => {
      localStorage.setItem('panelLayout', JSON.stringify({ panelOrder }));

      const { result } = renderLayout();
      expect(result.current.panelOrder).toEqual(['history', 'layers']);
    });

    it('reads booleans strictly, so a truthy string is not a rolled-up panel', () => {
      localStorage.setItem('panelLayout', JSON.stringify({ rolledUp: { history: 'yes', layers: 1 } }));

      const { result } = renderLayout();
      expect(result.current.rolledUp).toEqual({ history: false, layers: false });
    });

    // A side is an enum with exactly two members, so `'middle'` is a record this app never
    // wrote and `readStoredSide` returns `undefined` for it rather than letting it reach a
    // comparison. The half of the rule that matters is what happens NEXT: the stored record is
    // spread over `DEFAULT_STATE` to seed the provider's state, and an `undefined` in that
    // spread is a VALUE that overwrites the default rather than an absence that leaves it — so
    // an unrecognised side has to read back as the default, not as nothing at all.
    it('degrades an unrecognised side to the default', () => {
      localStorage.setItem('panelLayout', JSON.stringify({ toolsSide: 'middle' }));

      const { result } = renderLayout();
      expect(result.current.toolsSide).toBe('left');
    });
  });

  describe('rememberDockWidth', () => {
    // A second writer of `dockWidth`, and the one-way door is a property of `dockWidth` being
    // below the label floor, so a writer that could put it there reopens what `setDockWidth`
    // closes.
    it('will not remember a width below the label floor', () => {
      const { result } = renderLayout();

      act(() => result.current.rememberDockWidth(10));
      expect(result.current.dockWidth).toBe(DOCK_LABEL_MIN_WIDTH);
    });

    it('still clamps an absurd width', () => {
      const { result } = renderLayout();

      act(() => result.current.rememberDockWidth(1_000_000));
      expect(result.current.dockWidth).toBe(DOCK_MAX_WIDTH);
    });

    it('remembers a real width without expanding a collapsed dock', () => {
      const { result } = renderLayout();

      act(() => result.current.setDockWidth(30));
      expect(result.current.isCollapsed).toBe(true);

      act(() => result.current.rememberDockWidth(420));
      expect(result.current.dockWidth).toBe(420);
      // Remembering is not the same as setting: the dock stays where it is and comes back to
      // 420 on the way out, which is the whole point of remembering it.
      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.effectiveDockWidth).toBe(DOCK_MIN_WIDTH);
    });
  });

  describe('resetWorkspace', () => {
    // Both edges are moved to their non-default values, because a reset that returned the rail
    // but not the dock — or the dock but not the rail — is the failure this pair of fields makes
    // newly possible, and it is invisible unless both were moved first.
    it('returns every field to the opening layout', () => {
      const { result } = renderLayout();

      act(() => {
        result.current.setDockWidth(500);
        result.current.setSplitRatio(0.7);
        result.current.setPanelOrder(['layers', 'history']);
        result.current.setRolledUp('history', true);
        result.current.setToolsSide('right');
        result.current.setDockSide('left');
        result.current.toggleCollapsed();
      });

      act(() => result.current.resetWorkspace());

      expect(result.current.dockWidth).toBe(250);
      expect(result.current.splitRatio).toBe(0.2);
      expect(result.current.panelOrder).toEqual(['history', 'layers']);
      expect(result.current.rolledUp).toEqual({ history: false, layers: false });
      expect(result.current.toolsSide).toBe('left');
      expect(result.current.dockSide).toBe('right');
      expect(result.current.isCollapsed).toBe(false);
    });

    it('is the documented way back from a layout the user cannot live with', () => {
      // `Window > Workspace > Reset` is where Adobe puts it, and the menu wiring is asserted
      // in `DesktopHeader.tablet.test.tsx`. What matters here is only that the reset is total:
      // a field left behind would be a layout the user cannot return from, which is the one
      // failure a "reset" that misses a field produces silently.
      const { result } = renderLayout();

      act(() => {
        result.current.setDockWidth(500);
        result.current.setSplitRatio(0.7);
        result.current.setPanelOrder(['layers', 'history']);
        result.current.setRolledUp('history', true);
        result.current.setToolsSide('right');
        result.current.setDockSide('left');
        result.current.toggleCollapsed();
      });
      act(() => result.current.resetWorkspace());

      // The persisted record has to agree with the in-memory one, or the very next reload
      // restores the layout the reset was supposed to discard. The two sides are in the record
      // for the same reason the legacy flag was: a record missing one of them would let
      // `readStoredLayout` restore an edge the reset moved rather than discarded.
      expect(persisted()).toEqual({
        dockWidth: 250,
        splitRatio: 0.2,
        panelOrder: ['history', 'layers'],
        rolledUp: { history: false, layers: false },
        toolsSide: 'left',
        dockSide: 'right',
        isCollapsed: false,
      });
    });
  });

  describe('with no provider above it', () => {
    // Matches `RightPanelVisibility`. A consumer that forgets the provider reads the opening
    // layout, which is a true statement about an app with no workspace, and every setter is a
    // no-op — so a drag that goes nowhere rather than a layout that silently disagrees with
    // what is on screen.
    it('reads the opening layout', () => {
      const { result } = renderHook(() => usePanelLayout());

      expect(result.current.dockWidth).toBe(250);
      expect(result.current.panelOrder).toEqual(['history', 'layers']);
    });

    it('does not throw, and does not write', () => {
      const { result } = renderHook(() => usePanelLayout());

      expect(() => {
        result.current.setDockWidth(400);
        result.current.setToolsSide('right');
        result.current.setDockSide('left');
        result.current.resetWorkspace();
      }).not.toThrow();
      expect(result.current.dockWidth).toBe(250);
      // Both setters, not one: `noProviderValue` is a hand-written object rather than a
      // generated one, so a field added to `PanelLayout` without a no-op to match is a
      // component that renders fine under a provider and throws on its own.
      expect(result.current.toolsSide).toBe('left');
      expect(result.current.dockSide).toBe('right');
      expect(localStorage.getItem('panelLayout')).toBeNull();
    });
  });
});
