import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ReplayCoordinator,
  replayTokensEqual,
  yieldToHost,
  type ReplayCoordinatorState,
  type ReplayRevisionToken,
} from '../replay-coordinator.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const baseToken: ReplayRevisionToken = {
  documentId: 'document-1',
  documentRevision: 4,
  durableRevision: 9,
  branchRevision: 2,
  cursor: 3,
  baselineAssetGeneration: 1,
  operationSetRevision: 6,
  sourceGeneration: 5,
};

function tokenWith(overrides: Partial<ReplayRevisionToken>): ReplayRevisionToken {
  return { ...baseToken, ...overrides };
}

/**
 * The live durable document a publication would be applied to. A candidate
 * token is publishable only when every component still matches this snapshot.
 */
const liveDocument = { ...baseToken };
function isStillValid(candidate: ReplayRevisionToken): boolean {
  return replayTokensEqual(candidate, liveDocument);
}

afterEach(() => {
  Object.assign(liveDocument, baseToken);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('replayTokensEqual revision identity', () => {
  it.each([
    { field: 'documentId' as const, patch: { documentId: 'document-2' } },
    { field: 'documentRevision' as const, patch: { documentRevision: 5 } },
    { field: 'branchRevision' as const, patch: { branchRevision: 3 } },
    { field: 'cursor' as const, patch: { cursor: 2 } },
    { field: 'durableRevision' as const, patch: { durableRevision: 10 } },
    { field: 'baselineAssetGeneration' as const, patch: { baselineAssetGeneration: 2 } },
    { field: 'operationSetRevision' as const, patch: { operationSetRevision: 7 } },
    { field: 'sourceGeneration' as const, patch: { sourceGeneration: 6 } },
  ])('rejects a token whose $field no longer matches the live document', ({ patch }) => {
    expect(replayTokensEqual(baseToken, tokenWith(patch))).toBe(false);
    expect(replayTokensEqual(tokenWith(patch), baseToken)).toBe(false);
  });

  it('accepts two structurally equal token snapshots', () => {
    expect(replayTokensEqual(baseToken, { ...baseToken })).toBe(true);
  });

  it('rejects a token whose optional source generation is present on only one side', () => {
    const withoutSourceGeneration: ReplayRevisionToken = { ...baseToken, sourceGeneration: undefined };

    expect(replayTokensEqual(baseToken, withoutSourceGeneration)).toBe(false);
    expect(replayTokensEqual(withoutSourceGeneration, withoutSourceGeneration)).toBe(true);
  });
});

describe('ReplayCoordinator fail-closed publication gate', () => {
  it.each([
    { field: 'document id' as const, patch: { documentId: 'other-document' } },
    { field: 'document revision' as const, patch: { documentRevision: baseToken.documentRevision + 1 } },
    { field: 'branch' as const, patch: { branchRevision: baseToken.branchRevision + 1 } },
    { field: 'cursor' as const, patch: { cursor: baseToken.cursor - 1 } },
    { field: 'durable revision' as const, patch: { durableRevision: baseToken.durableRevision + 1 } },
    {
      field: 'document frame consistency (via operation set revision)',
      patch: { operationSetRevision: baseToken.operationSetRevision + 1 },
    },
  ])('refuses to publish when the live $field changed', async ({ patch }) => {
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();

    const outcome = await coordinator.request({
      token: baseToken,
      materialize: () => Promise.resolve('materialized'),
      publish,
      release,
      isStillValid,
    });

    expect(outcome.state).toBe('published');

    // A matching document published once; only a mismatching live state blocks.
    const stale = new ReplayCoordinator<string>();
    Object.assign(liveDocument, patch);
    const stalePublish = vi.fn();
    const staleRelease = vi.fn();

    const staleOutcome = await stale.request({
      token: baseToken,
      materialize: () => Promise.resolve('materialized'),
      publish: stalePublish,
      release: staleRelease,
      isStillValid,
    });

    expect(staleOutcome.state).toBe('stale');
    expect(stalePublish).not.toHaveBeenCalled();
    expect(staleRelease).toHaveBeenCalledWith('materialized');
  });

  it('stays fail-closed when no validity callback is supplied at all', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();

    const outcome = await coordinator.request({
      token: baseToken,
      materialize: () => Promise.resolve('materialized'),
      publish,
      release,
    });

    // A request id alone only proves ordering, never document freshness.
    expect(outcome.state).toBe('stale');
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('materialized');
  });
});

describe('ReplayCoordinator isCurrent', () => {
  it('reports no current request before one is made and after one settles', async () => {
    const coordinator = new ReplayCoordinator<string>();

    expect(coordinator.currentRequestId).toBe(0);
    expect(coordinator.isCurrent(1, isStillValid)).toBe(false);

    await coordinator.request({
      token: baseToken,
      materialize: () => Promise.resolve('materialized'),
      publish: vi.fn(),
      isStillValid,
    });

    expect(coordinator.currentRequestId).toBe(0);
    expect(coordinator.isCurrent(1, isStillValid)).toBe(false);
  });

  it('reports a pending request as current while its token is still fresh', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const materialization = deferred<string>();
    const states: Array<ReplayCoordinatorState> = [];

    const request = coordinator.request({
      token: baseToken,
      materialize: () => materialization.promise,
      publish: vi.fn(),
      onStateChange: (state) => states.push(state),
      isStillValid,
    });

    expect(coordinator.currentRequestId).toBe(1);
    expect(coordinator.isCurrent(1, isStillValid)).toBe(true);
    // A different request id can never be the current one.
    expect(coordinator.isCurrent(2, isStillValid)).toBe(false);

    materialization.resolve('materialized');
    await request;

    expect(states).toEqual(['requested', 'materializing', 'publishable', 'published']);
  });

  it('reports a pending request as not current without a validity callback', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const materialization = deferred<string>();

    const request = coordinator.request({
      token: baseToken,
      materialize: () => materialization.promise,
      publish: vi.fn(),
    });

    expect(coordinator.isCurrent(1)).toBe(false);

    materialization.resolve('materialized');
    await request;
  });

  it('is a no-op when cancel() is called with no current request', () => {
    const coordinator = new ReplayCoordinator<string>();

    expect(() => coordinator.cancel()).not.toThrow();
    expect(coordinator.currentRequestId).toBe(0);
  });
});

describe('ReplayCoordinator abort between materialization and publication', () => {
  it('cancels and releases when the signal aborts between the two validity checks', async () => {
    const controller = new AbortController();
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();
    const states: Array<ReplayCoordinatorState> = [];

    const outcome = await coordinator.request({
      token: baseToken,
      signal: controller.signal,
      materialize: () => Promise.resolve('materialized'),
      publish,
      release,
      onStateChange: (state) => {
        states.push(state);
        // The abort lands in the single gap between the first re-check and the
        // publication re-check.
        if (state === 'publishable') controller.abort();
      },
      isStillValid,
    });

    expect(outcome.state).toBe('cancelled');
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('materialized');
    expect(states).toEqual(['requested', 'materializing', 'publishable', 'cancelled']);
  });

  it('cancels and releases when the live token goes stale between the two checks', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();
    const states: Array<ReplayCoordinatorState> = [];

    const outcome = await coordinator.request({
      token: baseToken,
      materialize: () => Promise.resolve('materialized'),
      publish,
      release,
      onStateChange: (state) => {
        states.push(state);
        // A new durable revision lands between the first check and publication.
        if (state === 'publishable') liveDocument.durableRevision += 1;
      },
      isStillValid,
    });

    expect(outcome.state).toBe('stale');
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('materialized');
    expect(states).toEqual(['requested', 'materializing', 'publishable', 'stale']);
  });

  it('reports cancelled with the failure when materialization rejects after an abort', async () => {
    const controller = new AbortController();
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();
    const failure = new Error('materialization failed after abort');

    const outcome = await coordinator.request({
      token: baseToken,
      signal: controller.signal,
      materialize: () => {
        controller.abort();
        return Promise.reject(failure);
      },
      publish,
      release,
      isStillValid,
    });

    expect(outcome.state).toBe('cancelled');
    expect(outcome.error).toBe(failure);
    expect(publish).not.toHaveBeenCalled();
    // Nothing was materialized, so there is nothing to release.
    expect(release).not.toHaveBeenCalled();
  });
});

describe('yieldToHost', () => {
  it('resolves through requestAnimationFrame when the host provides one', async () => {
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', raf);

    await yieldToHost();

    expect(raf).toHaveBeenCalledOnce();
  });

  it('falls back to a macrotask when the host has no requestAnimationFrame', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: undefined, configurable: true });
    try {
      await expect(yieldToHost()).resolves.toBeUndefined();
    } finally {
      if (original) Object.defineProperty(globalThis, 'requestAnimationFrame', original);
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    }
  });

  it('forwards the host yield helper to the materialize callback', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', raf);
    const seen: Array<() => Promise<void>> = [];

    const outcome = await coordinator.request({
      token: baseToken,
      materialize: async ({ yieldToHost: yield_ }) => {
        seen.push(yield_);
        await yield_();
        return 'materialized';
      },
      publish: vi.fn(),
      isStillValid,
    });

    expect(seen).toHaveLength(1);
    expect(raf).toHaveBeenCalled();
    expect(outcome.state).toBe('published');
  });
});
