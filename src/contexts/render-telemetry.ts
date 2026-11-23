export type LayerRenderOutcome =
  | 'published'
  | 'published-with-skips'
  | 'staging-context-missing'
  | 'required-layer-bitmap-missing'
  | 'composition-failed'
  | 'target-context-missing'
  | 'snapshot-failed'
  | 'target-context-missing-restored'
  | 'publish-failed-restored'
  | 'restore-failed'
  | 'uncaught-error';

export interface LayerRenderTelemetry {
  readonly recordedAtEpochMs: number;
  readonly durationMs: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly backingScale: number;
  readonly visibleLayerCount: number;
  readonly skippedLayerCount: number;
  readonly failedLayerId: string | null;
  readonly outcome: LayerRenderOutcome;
}

export interface LayerRenderTelemetrySummary {
  readonly latest: LayerRenderTelemetry;
  readonly averagePublishedDurationMs: number | null;
  readonly sampleCount: number;
}

const RING_CAPACITY = 32;
const ring: Array<LayerRenderTelemetry | undefined> = new Array(RING_CAPACITY);
let nextWriteIndex = 0;
let recordCount = 0;
const listeners = new Set<() => void>();
const NOTIFICATION_INTERVAL_MS = 250;
let lastNotificationAt = Number.NEGATIVE_INFINITY;
let pendingNotification: ReturnType<typeof setTimeout> | null = null;
let latestSummary: LayerRenderTelemetrySummary | null = null;

function refreshSummary(): void {
  const latestIndex = (nextWriteIndex - 1 + RING_CAPACITY) % RING_CAPACITY;
  const latest = ring[latestIndex];
  if (!latest) return;

  let durationTotal = 0;
  let sampleCount = 0;
  for (let offset = 0; offset < recordCount; offset += 1) {
    const index = (nextWriteIndex - 1 - offset + RING_CAPACITY * 2) % RING_CAPACITY;
    const sample = ring[index];
    if (
      sample &&
      sample.outcome === 'published' &&
      sample.documentWidth === latest.documentWidth &&
      sample.documentHeight === latest.documentHeight &&
      sample.backingScale === latest.backingScale &&
      sample.visibleLayerCount === latest.visibleLayerCount
    ) {
      durationTotal += sample.durationMs;
      sampleCount += 1;
    }
  }

  latestSummary = Object.freeze({
    latest,
    averagePublishedDurationMs: sampleCount > 0 ? durationTotal / sampleCount : null,
    sampleCount,
  });
}

function telemetryClockNow(): number {
  try {
    const now = typeof performance !== 'undefined' ? performance.now : undefined;
    return typeof now === 'function' ? now.call(performance) : Date.now();
  } catch {
    return Date.now();
  }
}

function notifyListeners(): void {
  if (listeners.size === 0 || pendingNotification !== null) return;
  const remaining = NOTIFICATION_INTERVAL_MS - (telemetryClockNow() - lastNotificationAt);
  pendingNotification = setTimeout(
    () => {
      pendingNotification = null;
      publishChange();
    },
    Math.max(0, remaining)
  );
}

function publishChange(): void {
  lastNotificationAt = telemetryClockNow();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A diagnostic subscriber must never affect rendering.
    }
  }
}

/** Keeps bounded, primitive-only diagnostics outside StoreContext and document history. */
export function recordLayerRenderTelemetry(record: LayerRenderTelemetry): void {
  if (!import.meta.env.DEV) return;

  ring[nextWriteIndex] = Object.freeze({
    recordedAtEpochMs: record.recordedAtEpochMs,
    durationMs: record.durationMs,
    documentWidth: record.documentWidth,
    documentHeight: record.documentHeight,
    backingScale: record.backingScale,
    visibleLayerCount: record.visibleLayerCount,
    skippedLayerCount: record.skippedLayerCount,
    failedLayerId: record.failedLayerId,
    outcome: record.outcome,
  });
  nextWriteIndex = (nextWriteIndex + 1) % RING_CAPACITY;
  recordCount = Math.min(recordCount + 1, RING_CAPACITY);
  refreshSummary();
  notifyListeners();
}

export function subscribeToLayerRenderTelemetry(listener: () => void): () => void {
  if (!import.meta.env.DEV) return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pendingNotification !== null) {
      clearTimeout(pendingNotification);
      pendingNotification = null;
    }
  };
}

/** Returns recent timing for the latest frame shape and visible-layer count. */
export function getLayerRenderTelemetrySummary(): LayerRenderTelemetrySummary | null {
  if (!import.meta.env.DEV) return null;
  return latestSummary;
}
