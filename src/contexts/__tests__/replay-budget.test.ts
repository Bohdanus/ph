import { describe, expect, it, vi } from 'vitest';

import {
  defineReplayBudget,
  runReplayUnderBudget,
  type ReplayBudgetInput,
  type ReplayRunOutcome,
} from '../replay-budget.ts';

/**
 * A clock the test drives, so every measurement in this file is exact rather than approximate.
 * Nothing in `replay-budget.ts` reads an ambient clock when `now` is supplied, which is what makes
 * these assertions possible at all.
 */
function fakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

/** A yield that costs the host real time, which the budget must not charge for. */
function yieldCosting(clock: ReturnType<typeof fakeClock>, ms: number) {
  return async () => {
    clock.advance(ms);
  };
}

const generous = (overrides: ReplayBudgetInput = {}) => defineReplayBudget({ maxActiveMs: 1_000, ...overrides });

describe('defineReplayBudget', () => {
  it('requires the caller to supply maxActiveMs rather than defaulting the product threshold', () => {
    // docs/HISTORY-MIGRATION.md RQ-3: the budget is a user setting. A default here would be an
    // architecture constant wearing a setting's clothes.
    expect(() => defineReplayBudget({})).toThrow(TypeError);
    expect(() => defineReplayBudget({})).toThrow(/maxActiveMs/);
  });

  it('defaults every optional limit to no limit of that kind', () => {
    expect(defineReplayBudget({ maxActiveMs: 250 })).toEqual({
      maxActiveMs: 250,
      maxSteps: Number.POSITIVE_INFINITY,
      deadlineMs: null,
      yieldEverySteps: 1,
    });
  });

  it('rejects an unusable limit rather than clamping it to something the user did not choose', () => {
    const rejected: ReadonlyArray<ReplayBudgetInput> = [
      { maxActiveMs: 0 },
      { maxActiveMs: -1 },
      { maxActiveMs: Number.NaN },
      { maxActiveMs: Number.POSITIVE_INFINITY },
      { maxActiveMs: 10, maxSteps: 0 },
      { maxActiveMs: 10, maxSteps: 1.5 },
      { maxActiveMs: 10, deadlineMs: 0 },
      { maxActiveMs: 10, deadlineMs: -5 },
      { maxActiveMs: 10, yieldEverySteps: 0 },
      { maxActiveMs: 10, yieldEverySteps: 1.5 },
    ];
    for (const input of rejected) {
      expect(() => defineReplayBudget(input)).toThrow(TypeError);
    }
  });

  it('accepts an unbounded step count, because a step ceiling is a choice and not a floor', () => {
    expect(defineReplayBudget({ maxActiveMs: 10, maxSteps: Number.POSITIVE_INFINITY }).maxSteps).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it('freezes the budget so a caller cannot spend more than the limit it was given', () => {
    const budget = defineReplayBudget({ maxActiveMs: 10 });
    expect(Object.isFrozen(budget)).toBe(true);
  });
});

describe('runReplayUnderBudget', () => {
  it('runs every step and collects the value exactly once when the work fits', async () => {
    const clock = fakeClock();
    const collect = vi.fn(() => 'document');
    const release = vi.fn();
    const runStep = vi.fn(() => {
      clock.advance(2);
    });

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 3,
      runStep,
      collect,
      release,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome.status).toBe('completed');
    expect(outcome).toMatchObject({ result: 'document' });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(runStep).toHaveBeenCalledTimes(3);
    expect(outcome.measurement).toEqual({ steps: 3, activeMs: 6, wallMs: 6, yieldedMs: 0 });
  });

  it('describes each step to the caller by index and position', async () => {
    const clock = fakeClock();
    const handles: unknown[] = [];
    await runReplayUnderBudget({
      budget: generous(),
      stepCount: 2,
      runStep: (step) => {
        handles.push({ ...step, signal: step.signal.aborted });
        clock.advance(1);
      },
      collect: () => null,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(handles).toEqual([
      { index: 0, total: 2, isFirst: true, isLast: false, signal: false },
      { index: 1, total: 2, isFirst: false, isLast: true, signal: false },
    ]);
  });

  it('stops before the step that would cross the active budget, and never collects', async () => {
    const clock = fakeClock();
    const collect = vi.fn();
    const release = vi.fn();
    const runStep = vi.fn(() => {
      clock.advance(6);
    });

    const outcome = await runReplayUnderBudget({
      budget: defineReplayBudget({ maxActiveMs: 10 }),
      stepCount: 5,
      runStep,
      collect,
      release,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome).toEqual({
      status: 'over-budget',
      reason: 'active-ms',
      limit: 10,
      nextStep: 2,
      measurement: { steps: 2, activeMs: 12, wallMs: 12, yieldedMs: 0 },
    });
    // Two steps ran and a third never started: the runner refuses the next step, it does not
    // interrupt the one it is holding.
    expect(runStep).toHaveBeenCalledTimes(2);
    expect(collect).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(outcome);
  });

  it('reports over-budget for the deadline when the wall clock passes, not the work clock', async () => {
    const clock = fakeClock();
    const collect = vi.fn();
    const release = vi.fn();

    const outcome = await runReplayUnderBudget({
      budget: defineReplayBudget({ maxActiveMs: 1_000, deadlineMs: 10 }),
      stepCount: 4,
      runStep: () => {
        clock.advance(1);
      },
      collect,
      release,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 20),
    });

    expect(outcome).toEqual({
      status: 'over-budget',
      reason: 'deadline-ms',
      limit: 10,
      nextStep: 1,
      measurement: { steps: 1, activeMs: 1, wallMs: 21, yieldedMs: 20 },
    });
    expect(collect).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports over-budget for the step count when the step ceiling is reached', async () => {
    const clock = fakeClock();
    const collect = vi.fn();
    const runStep = vi.fn(() => {
      clock.advance(1);
    });

    const outcome = await runReplayUnderBudget({
      budget: defineReplayBudget({ maxActiveMs: 1_000, maxSteps: 2 }),
      stepCount: 5,
      runStep,
      collect,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome).toMatchObject({ status: 'over-budget', reason: 'step-count', limit: 2, nextStep: 2 });
    expect(runStep).toHaveBeenCalledTimes(2);
    expect(collect).not.toHaveBeenCalled();
  });

  it('charges the budget for work only, and not for the time yielded to the host', async () => {
    const clock = fakeClock();
    const collect = vi.fn(() => 'document');

    const outcome = await runReplayUnderBudget({
      budget: defineReplayBudget({ maxActiveMs: 5 }),
      stepCount: 4,
      runStep: () => {
        clock.advance(1);
      },
      collect,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 1_000),
    });

    // Four steps at 1ms each fit a 5ms budget even though the run took three seconds of host time.
    expect(outcome.status).toBe('completed');
    expect(outcome.measurement).toEqual({ steps: 4, activeMs: 4, wallMs: 3_004, yieldedMs: 3_000 });
  });

  it('stops as aborted when the caller signal fires during a step, and never collects', async () => {
    const clock = fakeClock();
    const caller = new AbortController();
    const collect = vi.fn();
    const release = vi.fn();
    const runStep = vi.fn(() => {
      clock.advance(1);
      caller.abort();
    });

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 4,
      runStep,
      collect,
      release,
      signal: caller.signal,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome).toEqual({
      status: 'aborted',
      nextStep: 1,
      measurement: { steps: 1, activeMs: 1, wallMs: 1, yieldedMs: 0 },
    });
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(collect).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('stops as aborted without running a step when the caller signal is already aborted', async () => {
    const clock = fakeClock();
    const caller = new AbortController();
    caller.abort();
    const runStep = vi.fn();
    const collect = vi.fn();
    const yieldToHost = vi.fn(async () => undefined);

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 4,
      runStep,
      collect,
      signal: caller.signal,
      now: clock.now,
      yieldToHost,
    });

    expect(outcome).toMatchObject({ status: 'aborted', nextStep: 0 });
    expect(outcome.measurement.steps).toBe(0);
    expect(runStep).not.toHaveBeenCalled();
    expect(yieldToHost).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  it('picks up an abort that arrives while the host has the thread, after the yield', async () => {
    const clock = fakeClock();
    const caller = new AbortController();
    const runStep = vi.fn(() => {
      clock.advance(1);
    });

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 4,
      runStep,
      collect: () => null,
      signal: caller.signal,
      now: clock.now,
      yieldToHost: async () => {
        clock.advance(1);
        caller.abort();
      },
    });

    expect(outcome).toMatchObject({ status: 'aborted', nextStep: 1 });
    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it('stops as stale when the revision guard fails, and never collects', async () => {
    const clock = fakeClock();
    let valid = true;
    const collect = vi.fn();
    const release = vi.fn();

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 4,
      runStep: () => {
        clock.advance(1);
        valid = false;
      },
      collect,
      release,
      isStillValid: () => valid,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome).toEqual({
      status: 'stale',
      nextStep: 1,
      measurement: { steps: 1, activeMs: 1, wallMs: 1, yieldedMs: 0 },
    });
    expect(collect).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('refuses to hand back a collected value once the revision has moved under it', async () => {
    const clock = fakeClock();
    const collect = vi.fn(() => 'document');
    let checks = 0;

    // Valid for every decision except the final one, which is the check that guards `collect()`.
    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 1,
      runStep: () => {
        clock.advance(1);
      },
      collect,
      isStillValid: () => checks++ === 0,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome).toMatchObject({ status: 'stale', nextStep: 1 });
    expect(collect).not.toHaveBeenCalled();
  });

  it('reports failed with the thrown error and releases once', async () => {
    const clock = fakeClock();
    const failure = new Error('layer refused');
    const collect = vi.fn();
    const release = vi.fn();

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 4,
      runStep: ({ index }) => {
        clock.advance(1);
        if (index === 1) throw failure;
      },
      collect,
      release,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome).toEqual({
      status: 'failed',
      nextStep: 1,
      measurement: { steps: 1, activeMs: 2, wallMs: 2, yieldedMs: 0 },
      error: failure,
    });
    expect(collect).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports failed when collect itself throws, and still hands back no value', async () => {
    const clock = fakeClock();
    const failure = new Error('cannot assemble');

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 2,
      runStep: () => {
        clock.advance(1);
      },
      collect: () => {
        throw failure;
      },
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome).toMatchObject({ status: 'failed', nextStep: 2, error: failure });
    expect('result' in outcome).toBe(false);
  });

  it('completes a zero-step run without running or yielding anything', async () => {
    const clock = fakeClock();
    const runStep = vi.fn();
    const collect = vi.fn(() => 'empty');
    const release = vi.fn();
    const yieldToHost = vi.fn(async () => undefined);

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 0,
      runStep,
      collect,
      release,
      now: clock.now,
      yieldToHost,
    });

    // The empty-history case: nothing ran, nothing was refused, and no prompt is owed.
    expect(outcome).toMatchObject({ status: 'completed', result: 'empty' });
    expect(outcome.measurement).toEqual({ steps: 0, activeMs: 0, wallMs: 0, yieldedMs: 0 });
    expect(runStep).not.toHaveBeenCalled();
    expect(yieldToHost).not.toHaveBeenCalled();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it('completes a run that crosses the budget on its final step, and still reports the cost', async () => {
    const clock = fakeClock();

    const outcome = await runReplayUnderBudget({
      budget: defineReplayBudget({ maxActiveMs: 5 }),
      stepCount: 1,
      runStep: () => {
        clock.advance(10);
      },
      collect: () => 'document',
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    // Refusing a document that is already finished would misreport its cost; the measurement
    // travels with the outcome so a caller can still prompt on a completed-but-slow run.
    expect(outcome).toMatchObject({ status: 'completed', result: 'document' });
    expect(outcome.measurement.activeMs).toBe(10);
  });

  it('aborts the step signal on every stop so a step still awaiting can wind down', async () => {
    const clock = fakeClock();
    const observed: AbortSignal[] = [];
    const collect = () => 'document';

    const budget = defineReplayBudget({ maxActiveMs: 5 });
    const overBudget = await runReplayUnderBudget({
      budget,
      stepCount: 3,
      runStep: (step) => {
        observed.push(step.signal);
        clock.advance(6);
      },
      collect,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });
    expect(overBudget.status).toBe('over-budget');
    expect(observed.at(-1)?.aborted).toBe(true);

    const completedClock = fakeClock();
    const completedSignal = await runReplayUnderBudget({
      budget,
      stepCount: 1,
      runStep: (step) => {
        observed.push(step.signal);
        completedClock.advance(6);
      },
      collect,
      now: completedClock.now,
      yieldToHost: yieldCosting(completedClock, 0),
    });
    expect(completedSignal.status).toBe('completed');
    expect(observed.at(-1)?.aborted).toBe(false);
  });

  it('carries no result key at all on any stop, so partial work cannot read as a document', async () => {
    // Each run gets its own clock: they run concurrently, and a shared one would make the
    // measurements a race.
    const overBudgetClock = fakeClock();
    const failedClock = fakeClock();
    const staleClock = fakeClock();
    const abortedClock = fakeClock();
    const caller = new AbortController();
    caller.abort();

    const stops: ReadonlyArray<Promise<ReplayRunOutcome<string>>> = [
      runReplayUnderBudget({
        budget: defineReplayBudget({ maxActiveMs: 5 }),
        stepCount: 3,
        runStep: () => {
          overBudgetClock.advance(6);
        },
        collect: () => 'document',
        now: overBudgetClock.now,
        yieldToHost: yieldCosting(overBudgetClock, 0),
      }),
      runReplayUnderBudget({
        budget: generous(),
        stepCount: 1,
        runStep: () => {
          failedClock.advance(1);
          throw new Error('refused');
        },
        collect: () => 'document',
        now: failedClock.now,
        yieldToHost: yieldCosting(failedClock, 0),
      }),
      runReplayUnderBudget({
        budget: generous(),
        stepCount: 1,
        runStep: () => undefined,
        collect: () => 'document',
        isStillValid: () => false,
        now: staleClock.now,
        yieldToHost: yieldCosting(staleClock, 0),
      }),
      runReplayUnderBudget({
        budget: generous(),
        stepCount: 1,
        runStep: () => undefined,
        collect: () => 'document',
        signal: caller.signal,
        now: abortedClock.now,
        yieldToHost: yieldCosting(abortedClock, 0),
      }),
    ];

    const outcomes = await Promise.all(stops);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['over-budget', 'failed', 'stale', 'aborted']);
    for (const outcome of outcomes) {
      expect('result' in outcome).toBe(false);
    }
  });

  it('yields between steps and never after the last one', async () => {
    const clock = fakeClock();
    const yieldToHost = vi.fn(async () => {
      clock.advance(1);
    });

    const outcome = await runReplayUnderBudget({
      budget: generous(),
      stepCount: 3,
      runStep: () => {
        clock.advance(1);
      },
      collect: () => 'document',
      now: clock.now,
      yieldToHost,
    });

    expect(outcome.measurement.yieldedMs).toBe(2);
    expect(yieldToHost).toHaveBeenCalledTimes(2);
  });

  it('yields on the configured step interval rather than on every step', async () => {
    const clock = fakeClock();
    const yieldToHost = vi.fn(async () => {
      clock.advance(1);
    });

    const outcome = await runReplayUnderBudget({
      budget: defineReplayBudget({ maxActiveMs: 1_000, yieldEverySteps: 3 }),
      stepCount: 6,
      runStep: () => {
        clock.advance(1);
      },
      collect: () => 'document',
      now: clock.now,
      yieldToHost,
    });

    expect(outcome.status).toBe('completed');
    expect(yieldToHost).toHaveBeenCalledTimes(1);
    expect(outcome.measurement).toEqual({ steps: 6, activeMs: 6, wallMs: 7, yieldedMs: 1 });
  });

  it('detaches the caller signal listener on every exit, including a failed run', async () => {
    const clock = fakeClock();
    const caller = new AbortController();
    const addSpy = vi.spyOn(caller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(caller.signal, 'removeEventListener');

    await runReplayUnderBudget({
      budget: generous(),
      stepCount: 1,
      runStep: () => {
        throw new Error('refused');
      },
      collect: () => 'document',
      signal: caller.signal,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0]?.[0]).toBe('abort');
  });

  it('reports the same measurement twice for the same run, proving no ambient clock leaks in', async () => {
    const runOnce = async () => {
      const clock = fakeClock(5_000);
      return runReplayUnderBudget({
        budget: generous(),
        stepCount: 3,
        runStep: () => {
          clock.advance(2);
        },
        collect: () => 'document',
        now: clock.now,
        yieldToHost: yieldCosting(clock, 7),
      });
    };

    const first = await runOnce();
    const second = await runOnce();
    expect(first.measurement).toEqual(second.measurement);
    expect(first).toEqual(second);
  });

  it('rejects a step count it cannot schedule rather than running a partial range', async () => {
    const clock = fakeClock();
    for (const stepCount of [-1, 1.5, Number.NaN]) {
      await expect(
        runReplayUnderBudget({
          budget: generous(),
          stepCount,
          runStep: () => undefined,
          collect: () => 'document',
          now: clock.now,
          yieldToHost: yieldCosting(clock, 0),
        })
      ).rejects.toThrow(TypeError);
    }
  });

  it('runs without a supplied clock or scheduler, so it works in a bare node context', async () => {
    const outcome = await runReplayUnderBudget({
      budget: generous({ maxSteps: 2 }),
      stepCount: 2,
      runStep: () => undefined,
      collect: () => 'document',
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.measurement.steps).toBe(2);
    expect(outcome.measurement.activeMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a failed cleanup when release throws without losing the stopped outcome', async () => {
    const clock = fakeClock();
    const release = vi.fn(() => {
      throw new Error('release failed');
    });
    const outcome = await runReplayUnderBudget({
      budget: generous({ maxActiveMs: 10 }),
      stepCount: 2,
      runStep: () => clock.advance(11),
      collect: () => 'document',
      release,
      now: clock.now,
      yieldToHost: yieldCosting(clock, 0),
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.error).toEqual(new Error('release failed'));
    expect(outcome.superseded).toMatchObject({ status: 'over-budget', reason: 'active-ms', limit: 10 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('uses a timer instead of a suspended frame in a hidden tab', async () => {
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const outcome = await runReplayUnderBudget({
        budget: generous({ maxSteps: 2 }),
        stepCount: 2,
        runStep: () => undefined,
        collect: () => 'document',
      });

      expect(outcome.status).toBe('completed');
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    } finally {
      requestAnimationFrame.mockRestore();
      visibility.mockRestore();
    }
  });

  it('uses the frame scheduler while the tab is visible', async () => {
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      const outcome = await runReplayUnderBudget({
        budget: generous({ maxSteps: 2 }),
        stepCount: 2,
        runStep: () => undefined,
        collect: () => 'document',
      });

      expect(outcome.status).toBe('completed');
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    } finally {
      requestAnimationFrame.mockRestore();
      visibility.mockRestore();
    }
  });
});
