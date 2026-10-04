import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetRulerMeasurementForTest,
  setRulerMeasurement,
  useRulerMeasurement,
} from '../../../../tools/ruler-measurement-store.ts';
import Ruler from '../Ruler.tsx';

const h = vi.hoisted(() => ({ toolName: 'ruler' as string }));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: (name: string) => (name === h.toolName ? { toolName: 'ruler' } : null),
  }),
}));

/** A second reader of the same store, so a test can assert the bar's clicks reached it. */
const Probe = () => {
  const measurement = useRulerMeasurement();
  return <output data-testid="probe">{measurement ? 'measured' : 'none'}</output>;
};

const renderBar = () =>
  render(
    <>
      <Ruler />
      <Probe />
    </>
  );

const readout = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

/** Publishes a line the way the canvas gesture does: outside the component, inside `act`. */
const line = (start: { x: number; y: number }, end: { x: number; y: number }) => {
  act(() => setRulerMeasurement({ start, end }));
};

describe('the Ruler options bar', () => {
  beforeEach(() => {
    resetRulerMeasurementForTest();
    h.toolName = 'ruler';
  });

  afterEach(() => {
    resetRulerMeasurementForTest();
  });

  it('renders nothing for any tool but its own', () => {
    h.toolName = 'text';
    const { container } = renderBar();

    expect(container.querySelector('[data-testid="ruler-clear"]')).toBeNull();
  });

  it('shows every readout empty before anything is measured', () => {
    const { container } = renderBar();

    for (const id of ['ruler-x', 'ruler-y', 'ruler-w', 'ruler-h', 'ruler-a', 'ruler-d1', 'ruler-d2']) {
      expect(readout(container, id)).toBe('');
    }
  });

  it('reports X, Y, W, H, A and D1 for the line the canvas published', () => {
    const { container } = renderBar();
    line({ x: 10, y: 20 }, { x: 40, y: 60 });

    expect(readout(container, 'ruler-x')).toBe('10 px');
    expect(readout(container, 'ruler-y')).toBe('20 px');
    expect(readout(container, 'ruler-w')).toBe('30 px');
    expect(readout(container, 'ruler-h')).toBe('40 px');
    // The 3-4-5 triangle, and y growing downward.
    expect(readout(container, 'ruler-a')).toBe('53.1°');
    expect(readout(container, 'ruler-d1')).toBe('50 px');
  });

  it('leaves D2 empty rather than reporting a second leg of zero', () => {
    const { container } = renderBar();
    line({ x: 0, y: 0 }, { x: 100, y: 0 });

    expect(readout(container, 'ruler-d2')).toBe('');
  });

  it('reports D2 and re-reads A between the legs once a protractor exists', () => {
    const { container } = renderBar();
    act(() => setRulerMeasurement({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, legEnd: { x: 100, y: 100 } }));

    expect(readout(container, 'ruler-d2')).toBe('100 px');
    expect(readout(container, 'ruler-a')).toBe('90°');
  });

  it('clears the measuring line, which is Adobe Clear in the options bar', () => {
    const { container } = renderBar();
    line({ x: 0, y: 0 }, { x: 100, y: 100 });

    fireEvent.click(container.querySelector('[data-testid="ruler-clear"]') as HTMLButtonElement);

    expect(readout(container, 'ruler-d1')).toBe('');
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('none');
  });

  it('greys Clear while there is no line to clear', () => {
    const { container } = renderBar();

    expect(container.querySelector('[data-testid="ruler-clear"]')).toBeDisabled();

    line({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(container.querySelector('[data-testid="ruler-clear"]')).not.toBeDisabled();
  });
});
