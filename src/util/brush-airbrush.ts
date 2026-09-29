export const AIRBRUSH_INTERVAL_MS = 8.3;
export const AIRBRUSH_MAX_DABS_PER_FRAME = 8;

export type AirbrushEmitterOptions = {
  intervalMs?: number;
  maxDabsPerFrame?: number;
};

export type AirbrushEmitter = {
  accumulate: (dt: number) => number;
  debt: () => number;
  reset: () => void;
};

export const createAirbrushEmitter = (options: AirbrushEmitterOptions = {}): AirbrushEmitter => {
  const { intervalMs = AIRBRUSH_INTERVAL_MS, maxDabsPerFrame = AIRBRUSH_MAX_DABS_PER_FRAME } = options;
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : AIRBRUSH_INTERVAL_MS;
  const cap = Number.isFinite(maxDabsPerFrame) && maxDabsPerFrame > 0 ? Math.floor(maxDabsPerFrame) : 0;

  let debtMs = 0;

  const accumulate = (dt: number): number => {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    debtMs += dt;
    const whole = Math.floor(debtMs / interval);
    if (whole <= 0) return 0;
    debtMs -= whole * interval;
    return Math.min(whole, cap);
  };

  return {
    accumulate,
    debt: () => debtMs,
    reset: () => {
      debtMs = 0;
    },
  };
};
