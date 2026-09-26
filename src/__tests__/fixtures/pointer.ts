import type { PointerEvent } from 'react';

export interface PointerEventOptions {
  type?: string;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  pointerType?: 'mouse' | 'pen' | 'touch';
  target?: EventTarget | null;
  currentTarget?: EventTarget | null;
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  detail?: number;
  view?: Window | null;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  relatedTarget?: EventTarget | null;
  width?: number;
  height?: number;
  pressure?: number;
  tangentialPressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  isPrimary?: boolean;
}

export const createPointerEvent = <T extends Element = HTMLDivElement>(
  overrides: PointerEventOptions = {}
): PointerEvent<T> => {
  const defaultEvent: PointerEvent<T> = {
    button: 0,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    pointerType: 'mouse',
    target: null,
    currentTarget: null,
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: 0,
    view: window,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    relatedTarget: null,
    width: 1,
    height: 1,
    pressure: 0.5,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    isPrimary: true,
    getCoalescedEvents: vi.fn(() => []),
    getPredictedEvents: vi.fn(() => []),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as PointerEvent<T>;

  return { ...defaultEvent, ...overrides } as PointerEvent<T>;
};

export const createPointerDownEvent = <T extends Element = HTMLDivElement>(
  overrides: PointerEventOptions = {}
): PointerEvent<T> =>
  createPointerEvent<T>({
    type: 'pointerdown',
    buttons: 1,
    ...overrides,
  });

export const createPointerMoveEvent = <T extends Element = HTMLDivElement>(
  overrides: PointerEventOptions = {}
): PointerEvent<T> =>
  createPointerEvent<T>({
    type: 'pointermove',
    buttons: 1,
    ...overrides,
  });

export const createPointerUpEvent = <T extends Element = HTMLDivElement>(
  overrides: PointerEventOptions = {}
): PointerEvent<T> =>
  createPointerEvent<T>({
    type: 'pointerup',
    buttons: 0,
    ...overrides,
  });

export const createPointerEnterEvent = <T extends Element = HTMLDivElement>(
  overrides: PointerEventOptions = {}
): PointerEvent<T> =>
  createPointerEvent<T>({
    type: 'pointerenter',
    buttons: 0,
    ...overrides,
  });

export const createPointerLeaveEvent = <T extends Element = HTMLDivElement>(
  overrides: PointerEventOptions = {}
): PointerEvent<T> =>
  createPointerEvent<T>({
    type: 'pointerleave',
    buttons: 0,
    ...overrides,
  });
