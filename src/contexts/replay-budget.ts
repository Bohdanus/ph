/**
 * Replay budget: measurement and the cooperative runner that enforces it.
 *
 * This module owns the measurement of *active replay work* and nothing else. It has no
 * imports, holds no document state, references no canvas API, and calls no store action, so it
 * cannot rasterize a document or publish one even by accident. The only value that can escape it
 * is the one the caller supplies through `collect()`, and `collect()` is reached on exactly one
 * code path: every requested step ran to completion. Every other exit returns a status the caller
 * must handle, with the partial work left in the caller's own closure.
 *
 * **The budget is a user setting, not a constant.** `maxActiveMs` is therefore required by
 * `defineReplayBudget()` and this module ships no default for it. Every other field defaults to
 * "no limit of this kind" rather than to a number chosen here, so the product's threshold can
 * only enter from the setting the user controls.
 *
 * **Cooperativeness, and its limit.** The runner stops *between* steps: it measures, decides, and
 * refuses to begin the next step. It never interrupts a step that is already running, because a
 * synchronous raster or `await` inside a step has no preemption point this module can reach. A
 * single step that blocks forever is therefore not stoppable by the runner alone — which is why
 * every `ReplayStepHandle` carries the runner's `signal`, and why a caller whose step cannot
 * honour that signal has no bound at all. Yielding does not make a step cancellable; it only makes
 * the *next* decision reachable.
 *
 * **Active time excludes yielded time.** The budget is spent on replay work, not on the host being
 * busy elsewhere, so time spent inside the injected `yieldToHost()` is measured separately and
 * never counted against `maxActiveMs`. A replay that yields a hundred times stays within budget.
 *
 * **Completion wins.** When the last requested step finishes, the run reports `completed` even if
 * it crossed `maxActiveMs` on the way: the work the caller asked for is done, and refusing a
 * finished document would be a lie about cost. The measurement still travels with the outcome, so
 * a caller that wants to prompt on a completed-but-slow run can read it there.
 *
 * This is dormant scaffolding: nothing in production constructs a budget or runs this runner, and
 * no navigation or rendering path may import it while the legacy `HistoryItem[]` timeline stays
 * authoritative. The first durable production surface must choose its own materialization caller,
 * revision token, user setting, and publication policy; this module schedules nothing itself and
 * takes every one of those as an argument.
 */

/** Why a run stopped for cost rather than for cancellation or failure. */
export type ReplayOverBudgetReason = 'active-ms' | 'deadline-ms' | 'step-count';

/**
 * Validated limits. `deadlineMs` is a wall-clock ceiling, `maxActiveMs` a work ceiling: they are
 * separate because a replay can spend its wall clock waiting on the host without spending budget,
 * and a caller usually wants the second without the first.
 */
export type ReplayBudget = Readonly<{
  /** Work allowed before the run reports over-budget. Required: this module holds no default. */
  maxActiveMs: number;
  /** Steps allowed before the run reports over-budget. Defaults to unlimited. */
  maxSteps: number;
  /** Wall-clock ceiling in ms, or `null` for no deadline. Defaults to `null`. */
  deadlineMs: number | null;
  /** Steps between cooperative yields. Defaults to 1 — the cooperative minimum, not a budget. */
  yieldEverySteps: number;
}>;

export type ReplayBudgetInput = Readonly<{
  maxActiveMs?: number;
  maxSteps?: number;
  deadlineMs?: number | null;
  yieldEverySteps?: number;
}>;

/** What the run actually cost. `activeMs` is the figure a budget is spent against. */
export type ReplayMeasurement = Readonly<{
  steps: number;
  activeMs: number;
  wallMs: number;
  yieldedMs: number;
}>;

/** What one step is told about itself. `signal` is the only way to wind a running step down. */
export type ReplayStepHandle = Readonly<{
  index: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  signal: AbortSignal;
}>;

export type ReplayRunRequest<T> = Readonly<{
  budget: ReplayBudget;
  /** How many steps the caller's work decomposes into. Zero is legal and costs nothing. */
  stepCount: number;
  /** Runs exactly one step. Anything the step produces stays in the caller's closure. */
  runStep: (step: ReplayStepHandle) => void | Promise<void>;
  /** Produces the value to hand back. Called at most once, and only on `completed`. */
  collect: () => T;
  /** Called once on every non-`completed` outcome, so partial work can be released. */
  release?: (outcome: ReplayRunOutcome<T>) => void;
  /** Caller cancellation. Aborting it makes the run stop and its `signal` abort. */
  signal?: AbortSignal;
  /**
   * The revision guard, called at every yield point and once more before `collect()`. Returning
   * `false` stops the run as `stale`. It must be backed by live document state, never by the
   * request-time snapshot — a snapshot proves what the document was when the run began, which is
   * exactly the question a run cannot answer about itself.
   */
  isStillValid?: () => boolean;
  /** Injected so measurement is deterministic under test and needs no ambient clock. */
  now?: () => number;
  /** Injected so the caller owns the scheduling policy; this module never yields on its own. */
  yieldToHost?: () => Promise<void>;
}>;

/**
 * A non-`completed` outcome carries no value at all, not an optional one: there is no `result`
 * key to read as `undefined` and mistake for a document.
 */
type ReplayStoppedOutcome<T> =
  | Readonly<{
      status: 'over-budget';
      reason: ReplayOverBudgetReason;
      measurement: ReplayMeasurement;
      /** The step that did not start. A caller that accepts the cost resumes here. */
      nextStep: number;
      /** The limit that was crossed, so a prompt can quote the number it would be overriding. */
      limit: number;
    }>
  | Readonly<{ status: 'aborted'; measurement: ReplayMeasurement; nextStep: number }>
  | Readonly<{ status: 'stale'; measurement: ReplayMeasurement; nextStep: number }>
  | Readonly<{
      status: 'failed';
      measurement: ReplayMeasurement;
      nextStep: number;
      error: unknown;
      superseded?: ReplayStoppedOutcome<T>;
    }>;

export type ReplayRunOutcome<T> =
  Readonly<{ status: 'completed'; measurement: ReplayMeasurement; result: T }> | ReplayStoppedOutcome<T>;

type StopReason =
  | Readonly<{ status: 'aborted' }>
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'over-budget'; reason: ReplayOverBudgetReason; limit: number }>;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isPositiveIntegerOrInfinity(value: number): boolean {
  return value === Number.POSITIVE_INFINITY || (Number.isInteger(value) && value > 0);
}

/**
 * Validates a user-supplied budget. An unusable limit is rejected, never clamped: a clamped
 * replay budget silently spends a different amount of time than the setting asked for, which is
 * the same "hand the user a smaller thing than they chose" failure `assertPixelBudget()` refuses.
 * `maxActiveMs` has no default here on purpose — the product's number belongs to the setting.
 */
export function defineReplayBudget(input: ReplayBudgetInput): ReplayBudget {
  const { maxActiveMs } = input;
  if (typeof maxActiveMs !== 'number' || !isPositiveFinite(maxActiveMs)) {
    throw new TypeError(`A replay budget needs a finite maxActiveMs above zero; received ${maxActiveMs}.`);
  }
  const maxSteps = input.maxSteps ?? Number.POSITIVE_INFINITY;
  if (typeof maxSteps !== 'number' || !isPositiveIntegerOrInfinity(maxSteps)) {
    throw new TypeError(`A replay budget needs a positive integer maxSteps; received ${maxSteps}.`);
  }
  const deadlineMs = input.deadlineMs ?? null;
  if (deadlineMs !== null && !isPositiveFinite(deadlineMs)) {
    throw new TypeError(`A replay budget deadline must be a finite number of ms or null; received ${deadlineMs}.`);
  }
  const yieldEverySteps = input.yieldEverySteps ?? 1;
  if (typeof yieldEverySteps !== 'number' || !Number.isInteger(yieldEverySteps) || yieldEverySteps < 1) {
    throw new TypeError(`A replay budget needs an integer yieldEverySteps of at least 1; received ${yieldEverySteps}.`);
  }
  return Object.freeze({ maxActiveMs, maxSteps, deadlineMs, yieldEverySteps });
}

function defaultNow(): number {
  // `performance.now` is a Web IDL method and throws when called unbound, so it is read for the
  // type check and then called on its receiver. Reaching for `Date.now()` would work in node and
  // fail nothing, but a wall clock can go backwards, and a budget spent on a clock that does is
  // not a measurement.
  const clock = globalThis.performance;
  return typeof clock?.now === 'function' ? clock.now() : Date.now();
}

function defaultYieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    const frameAvailable =
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function' &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    if (!frameAvailable) {
      setTimeout(resolve, 0);
      return;
    }
    let settled = false;
    const fallback = { id: undefined as number | undefined };
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallback.id !== undefined) window.clearTimeout(fallback.id);
      resolve();
    };
    fallback.id = window.setTimeout(finish, 100);
    window.requestAnimationFrame(finish);
  });
}

/**
 * Runs the caller's steps cooperatively under `budget` and reports what it cost.
 *
 * The measurement is active-only, so a caller whose steps yield often is not charged for the
 * host. Nothing here publishes, rasterizes, or mutates document state: the runner cannot reach a
 * document, and the caller's document only exists as its own closure until `collect()` returns it
 * on a `completed` outcome. A caller that receives `over-budget` has partial work to release and a
 * `nextStep` to resume from, and it must prompt before it spends more — this module deliberately
 * offers no path that spends more without that prompt.
 */
export async function runReplayUnderBudget<T>(request: ReplayRunRequest<T>): Promise<ReplayRunOutcome<T>> {
  const { budget } = request;
  const now = request.now ?? defaultNow;
  const yieldToHost = request.yieldToHost ?? defaultYieldToHost;
  const total = request.stepCount;
  if (!Number.isInteger(total) || total < 0) {
    throw new TypeError(`A replay run needs a non-negative integer stepCount; received ${total}.`);
  }

  // The runner owns the controller, so a stop it decides on also aborts a step that is still
  // awaiting. The caller's own signal is linked into it rather than compared separately.
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (request.signal?.aborted) controller.abort();
  request.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const startedAt = now();
  const deadlineMs = budget.deadlineMs;
  const deadlineAt = deadlineMs === null ? null : startedAt + deadlineMs;
  let steps = 0;
  let activeMs = 0;
  let yieldedMs = 0;

  const measurement = (): ReplayMeasurement =>
    Object.freeze({ steps, activeMs, wallMs: Math.max(0, now() - startedAt), yieldedMs });

  // `includeBudget` is false on the completion path: a finished run is not retroactively refused
  // for the cost of finishing, it merely reports the cost.
  const classify = (includeBudget: boolean): StopReason | undefined => {
    if (controller.signal.aborted) return { status: 'aborted' };
    if (request.isStillValid && !request.isStillValid()) return { status: 'stale' };
    if (!includeBudget) return undefined;
    if (deadlineAt !== null && deadlineMs !== null && now() >= deadlineAt) {
      return { status: 'over-budget', reason: 'deadline-ms', limit: deadlineMs };
    }
    if (activeMs >= budget.maxActiveMs) {
      return { status: 'over-budget', reason: 'active-ms', limit: budget.maxActiveMs };
    }
    if (steps >= budget.maxSteps) {
      return { status: 'over-budget', reason: 'step-count', limit: budget.maxSteps };
    }
    return undefined;
  };

  const stop = (reason: StopReason): ReplayRunOutcome<T> => {
    controller.abort();
    const cost = { measurement: measurement(), nextStep: steps };
    return reason.status === 'over-budget'
      ? { status: 'over-budget', reason: reason.reason, limit: reason.limit, ...cost }
      : { status: reason.status, ...cost };
  };

  const complete = (): ReplayRunOutcome<T> => ({
    status: 'completed',
    measurement: measurement(),
    result: request.collect(),
  });

  const drive = async (): Promise<ReplayRunOutcome<T>> => {
    const initial = classify(false);
    if (initial) return stop(initial);
    if (total === 0) return complete();

    for (let index = 0; index < total; index += 1) {
      const stepStart = now();
      try {
        await request.runStep({
          index,
          total,
          isFirst: index === 0,
          isLast: index === total - 1,
          signal: controller.signal,
        });
      } finally {
        // A step that throws still spent its time, so its cost is charged in `finally` rather
        // than lost with the failure. A measurement that under-reports a failed run is the one a
        // caller would trust least.
        activeMs += Math.max(0, now() - stepStart);
      }
      steps = index + 1;

      if (steps === total) {
        const stopped = classify(false);
        return stopped ? stop(stopped) : complete();
      }

      const spent = classify(true);
      if (spent) return stop(spent);

      if (steps % budget.yieldEverySteps === 0) {
        const yieldStart = now();
        await yieldToHost();
        yieldedMs += Math.max(0, now() - yieldStart);
        // Re-decide after the yield: the caller may have aborted us, the document may have moved
        // on, or the deadline may have passed while the host had the thread.
        const afterYield = classify(true);
        if (afterYield) return stop(afterYield);
      }
    }
    // The loop returns from inside on the final step, so this is unreachable; it exists because
    // the type checker cannot see that.
    return complete();
  };

  let outcome: ReplayRunOutcome<T>;
  try {
    outcome = await drive();
  } catch (error) {
    controller.abort();
    outcome = { status: 'failed', measurement: measurement(), nextStep: steps, error };
  } finally {
    request.signal?.removeEventListener('abort', onCallerAbort);
  }
  // One call, on every path that leaves partial work behind. A completed run owns nothing to
  // release, and a run that already released must not release twice.
  if (outcome.status !== 'completed') {
    try {
      request.release?.(outcome);
    } catch (error) {
      outcome = {
        status: 'failed',
        measurement: outcome.measurement,
        nextStep: outcome.nextStep,
        error,
        superseded: outcome,
      };
    }
  }
  return outcome;
}
