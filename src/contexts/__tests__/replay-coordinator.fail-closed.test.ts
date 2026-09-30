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
  // `replayTokensEqual` is TEST-ONLY and deliberately so: it is the `sameToken`
  // helper exported at the bottom of `replay-coordinator.ts`, and a repo-wide
  // search finds no importer outside `src/contexts/__tests__/`. Production never
  // calls it — `isCurrent` delegates the whole freshness question to the
  // caller's `isStillValid` and defaults to `false` without one (pinned by
  // "stays fail-closed when no validity callback is supplied at all" and "reports
  // a pending request as not current without a validity callback" below).
  //
  // So these cases pin the ORACLE the fail-closed gate is measured with, not a
  // rule the coordinator enforces: they are what make `isStillValid` at the top
  // of this file mean "every component still matches the live document". If a
  // coordinator ever grows its own identity check, these cases will not notice —
  // the tests below that measure publication behaviour are the ones that would.
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

  it("publishes the caller's own token object, not the snapshot it validated", async () => {
    // The divergence `request` leaves in place, pinned before a production
    // caller reads the boolean out of `publish`. `request` stores
    // `{ ...input.token }` and hands THAT copy to `isCurrent`, but publishes with
    // the original `input.token` reference — so the token the gate proved fresh
    // and the token a publisher receives are the same values only for as long as
    // the caller leaves its object alone. Mutating it during materialization is
    // what a caller that reuses one token object across requests would do, and
    // the outcome is: the gate still says fresh, the publisher gets the mutation.
    const coordinator = new ReplayCoordinator<string>();
    const materialization = deferred<string>();
    // The request type declares the token `Readonly`; the cast is what makes this
    // a real hazard rather than an impossible state, so the test has to be the
    // one place that builds it.
    const reusedToken = { ...baseToken } as ReplayRevisionToken;
    const publishedToken: Array<ReplayRevisionToken> = [];
    const validated: Array<ReplayRevisionToken> = [];

    const request = coordinator.request({
      token: reusedToken,
      materialize: () => materialization.promise,
      publish: (_result, token) => publishedToken.push(token),
      isStillValid: (candidate) => {
        validated.push(candidate);
        return isStillValid(candidate);
      },
    });

    // The caller reuses its token object and moves the cursor before the
    // materialization lands.
    (reusedToken as { cursor: number }).cursor = baseToken.cursor + 7;

    materialization.resolve('materialized');
    const outcome = await request;

    // The gate validated the pre-mutation snapshot, and `liveDocument` is still
    // the pre-mutation state, so the freshness check legitimately passes.
    expect(validated).toHaveLength(2);
    expect(validated.every((token) => token.cursor === baseToken.cursor)).toBe(true);
    expect(outcome.state).toBe('published');
    // ...and the publisher received the mutated object by reference.
    expect(publishedToken).toHaveLength(1);
    expect(publishedToken[0]).toBe(reusedToken);
    expect(publishedToken[0].cursor).toBe(baseToken.cursor + 7);
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

  it('restores the host requestAnimationFrame after a test that stubbed one', () => {
    // The tripwire for the file-level `afterEach`'s `vi.unstubAllGlobals()`. The
    // two `yieldToHost` tests above `vi.stubGlobal` the global, and `vitest.config.ts`
    // sets `isolate: true` per FILE without `unstubGlobals`, so a stub that
    // survived would make every later test in this file — and every other
    // `vi.fn` expectation on the host — silently run against a mock. A `vi.fn`
    // reaches this assertion only if an earlier test's stub was never unstuck.
    expect(vi.isMockFunction(globalThis.requestAnimationFrame)).toBe(false);
    expect(typeof globalThis.requestAnimationFrame).toBe('function');
  });
});
