import type { Point } from '../contexts/general-types.ts';

export type SmoothingMode = 'pulled-string' | 'stroke-catchup' | 'catchup-on-stroke-end' | 'adjust-for-zoom';

export const SMOOTHING_WINDOW_MIN = 5;
export const SMOOTHING_WINDOW_MAX = 20;
export const STABILIZER_INTERVAL_MS = 8.3;
export const TAU_MIN_MS = 4;
export const TAU_MAX_MS = 150;

export const defaultClock = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

export const smoothingPercentToWindowSize = (percent: number): number => {
  if (!Number.isFinite(percent)) return SMOOTHING_WINDOW_MIN;
  const clamped = Math.min(100, Math.max(0, percent));
  const size = Math.round(SMOOTHING_WINDOW_MIN + (SMOOTHING_WINDOW_MAX - SMOOTHING_WINDOW_MIN) * (clamped / 100));
  return Math.min(SMOOTHING_WINDOW_MAX, Math.max(SMOOTHING_WINDOW_MIN, size));
};

const effectiveWindowSize = (percent: number): number => (percent <= 0 ? 1 : smoothingPercentToWindowSize(percent));

// unverified: the spec says "scale the leash with zoom" but states no law; 1/zoom keeps
// the leash constant in image space.
const zoomScaledWindowSize = (size: number, zoom: number): number => {
  const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(SMOOTHING_WINDOW_MAX, Math.max(1, Math.round(size / factor)));
};

export type StabilizerOptions = {
  smoothingPercent?: number;
  intervalMs?: number;
  mode?: SmoothingMode;
  zoom?: number;
  now?: () => number;
};

export type Stabilizer = {
  push: (sample: Point, t?: number) => void;
  tick: (t?: number) => Point[];
  flush: () => Point[];
  reset: () => void;
  windowSize: () => number;
};

export const createStabilizer = (options: StabilizerOptions = {}): Stabilizer => {
  const {
    smoothingPercent = 0,
    intervalMs = STABILIZER_INTERVAL_MS,
    mode = 'stroke-catchup',
    zoom = 1,
    now = defaultClock,
  } = options;
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : STABILIZER_INTERVAL_MS;
  const size =
    mode === 'adjust-for-zoom'
      ? zoomScaledWindowSize(effectiveWindowSize(smoothingPercent), zoom)
      : effectiveWindowSize(smoothingPercent);

  let buffer: Point[] = [];
  let lastSample: Point | null = null;
  let lastEmit = 0;
  let started = false;

  const reset = () => {
    buffer = [];
    lastSample = null;
    lastEmit = 0;
    started = false;
  };

  const mean = (): Point => {
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumX += buffer[i].x;
      sumY += buffer[i].y;
    }
    const count = buffer.length;
    return { x: sumX / count, y: sumY / count };
  };

  const push = (sample: Point, t: number = now()) => {
    if (!started) {
      lastEmit = t - interval;
      started = true;
    }
    buffer.push({ x: sample.x, y: sample.y });
    if (buffer.length > size) buffer.shift();
    lastSample = { x: sample.x, y: sample.y };
  };

  const tick = (t: number = now()): Point[] => {
    if (buffer.length === 0) return [];
    const elapsed = t - lastEmit;
    if (elapsed < interval) return [];
    lastEmit = t - (elapsed % interval);
    return [mean()];
  };

  const flush = (): Point[] => {
    const last = lastSample;
    if (!last) return [];
    for (let i = 0; i < buffer.length; i++) buffer[i] = { x: last.x, y: last.y };
    const flushed = [mean()];
    reset();
    return flushed;
  };

  return { push, tick, flush, reset, windowSize: () => size };
};

export type ExponentialSmootherOptions = {
  smoothingPercent?: number;
  tauMinMs?: number;
  tauMaxMs?: number;
};

export type ExponentialSmoother = {
  step: (target: Point, dt: number) => Point;
  current: () => Point | null;
  tau: () => number;
  reset: () => void;
};

export const createExponentialSmoother = (options: ExponentialSmootherOptions = {}): ExponentialSmoother => {
  const { smoothingPercent = 0, tauMinMs = TAU_MIN_MS, tauMaxMs = TAU_MAX_MS } = options;
  const tauMin = Number.isFinite(tauMinMs) && tauMinMs > 0 ? tauMinMs : TAU_MIN_MS;
  const tauMax = Number.isFinite(tauMaxMs) && tauMaxMs > 0 ? tauMaxMs : TAU_MAX_MS;
  const percent = clamp01(smoothingPercent / 100);

  let s: Point | null = null;

  const tau = () => tauMin + (tauMax - tauMin) * (1 - percent);

  const step = (target: Point, dt: number): Point => {
    if (!s) {
      s = { x: target.x, y: target.y };
      return { x: s.x, y: s.y };
    }
    if (!(dt > 0)) return { x: s.x, y: s.y };
    const k = 1 - Math.exp(-dt / tau());
    s = { x: s.x + (target.x - s.x) * k, y: s.y + (target.y - s.y) * k };
    return { x: s.x, y: s.y };
  };

  return {
    step,
    current: () => (s ? { x: s.x, y: s.y } : null),
    tau,
    reset: () => {
      s = null;
    },
  };
};

export type CoalescedPointerEventLike = {
  clientX: number;
  clientY: number;
  getCoalescedEvents?: () => ArrayLike<CoalescedPointerEventLike>;
};

export const coalescedPoints = (event: CoalescedPointerEventLike): Point[] => {
  if (typeof event.getCoalescedEvents === 'function') {
    const merged = event.getCoalescedEvents();
    if (merged && merged.length > 0) {
      const points: Point[] = [];
      for (let i = 0; i < merged.length; i++) points.push({ x: merged[i].clientX, y: merged[i].clientY });
      return points;
    }
  }
  return [{ x: event.clientX, y: event.clientY }];
};
