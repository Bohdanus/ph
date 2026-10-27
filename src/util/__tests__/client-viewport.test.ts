import { describe, expect, it } from 'vitest';
import { readClientViewportRect } from '../client-viewport.ts';

function element({
  left = 0,
  top = 0,
  width,
  height,
  clientLeft,
  clientTop,
  clientWidth,
  clientHeight,
  offsetWidth,
  offsetHeight,
}: {
  left?: number;
  top?: number;
  width: number;
  height: number;
  clientLeft?: number;
  clientTop?: number;
  clientWidth?: number;
  clientHeight?: number;
  offsetWidth?: number;
  offsetHeight?: number;
}): HTMLElement {
  return {
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect,
    clientLeft,
    clientTop,
    clientWidth,
    clientHeight,
    offsetWidth,
    offsetHeight,
  } as HTMLElement;
}

describe('readClientViewportRect', () => {
  it('measures inside borders and classic scrollbars', () => {
    expect(
      readClientViewportRect(
        element({
          left: 50,
          top: 100,
          width: 415,
          height: 220,
          clientLeft: 2,
          clientTop: 2,
          clientWidth: 400,
          clientHeight: 200,
          offsetWidth: 415,
          offsetHeight: 220,
        })
      )
    ).toEqual({ x: 52, y: 102, width: 400, height: 200 });
  });

  it('uses clientLeft when an RTL scrollbar occupies the left edge', () => {
    expect(
      readClientViewportRect(
        element({
          left: 20,
          top: 30,
          width: 415,
          height: 220,
          clientLeft: 17,
          clientTop: 2,
          clientWidth: 400,
          clientHeight: 200,
          offsetWidth: 415,
          offsetHeight: 220,
        })
      )
    ).toEqual({ x: 37, y: 32, width: 400, height: 200 });
  });

  it('preserves fractional CSS dimensions after integer CSSOM rounding', () => {
    expect(
      readClientViewportRect(
        element({
          left: 0,
          top: 0,
          width: 400.75,
          height: 200.5,
          clientLeft: 0,
          clientTop: 0,
          clientWidth: 400,
          clientHeight: 200,
          offsetWidth: 401,
          offsetHeight: 201,
        })
      )
    ).toEqual({ x: 0, y: 0, width: 399.75, height: 199.5 });
  });

  it('falls back to the bounding rect for measurement-only refs without client metrics', () => {
    expect(readClientViewportRect(element({ left: 7, top: 9, width: 100.5, height: 50.25 }))).toEqual({
      x: 7,
      y: 9,
      width: 100.5,
      height: 50.25,
    });
  });
});
