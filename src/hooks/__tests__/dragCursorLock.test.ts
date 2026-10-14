import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveDragCursorCount, lockDragCursor, unlockDragCursor } from '../dragCursorLock';

/**
 * `dragCursorLock` is a reference count over two `document.body` mutations, and
 * `useDockDrag.test.ts` already asserts its effects through a real gesture: the
 * class appears on press, survives a nested second gesture, and is gone on the
 * last release. Those assertions cannot see the COUNT, because every DOM effect
 * is idempotent — `classList.add` twice reads the same as once.
 *
 * So this suite covers only the four things the count is load-bearing for and
 * that no DOM assertion can reach. Each is named for the mutation it kills.
 */
describe('dragCursorLock', () => {
  // The counter is module-level, which is the point of the module and its one
  // hazard: a case that leaves a lock behind would gate every later assertion in
  // this file. It is drained through the public API rather than a reset export,
  // because adding one for the tests would be the only way to make a broken
  // counter look correct.
  beforeEach(() => {
    document.body.className = '';
    document.body.style.userSelect = '';
  });

  afterEach(() => {
    for (let held = liveDragCursorCount(); held > 0; held -= 1) unlockDragCursor();
    // A drain cannot climb: `unlockDragCursor` floors at zero, so a count that went
    // negative stays negative and the loop above never runs. Asserting here reports the
    // leak against the case that caused it — `afterEach` runs immediately after that case
    // — instead of letting it gate the next one silently.
    expect(liveDragCursorCount()).toBe(0);
    document.body.className = '';
    document.body.style.userSelect = '';
  });

  it('reports no holder before anything locks, and none after everything unlocks', () => {
    expect(liveDragCursorCount()).toBe(0);

    lockDragCursor();
    expect(liveDragCursorCount()).toBe(1);

    unlockDragCursor();
    expect(liveDragCursorCount()).toBe(0);
    expect(document.body).not.toHaveClass('cursor-grabbing');
    expect(document.body.style.userSelect).toBe('');
  });

  it('counts a second lock even though the class is already there, so the two gestures are separable', () => {
    // The count, not the class, is what decides who releases: the DOM effects are
    // idempotent, so a second lock and a first lock are indistinguishable from
    // outside. Pinning the increment is what makes `unlockDragCursor`'s
    // `if (liveLocks > 0)` guard mean "someone still holds it" rather than a guess.
    //
    // What this does NOT claim: that `lockDragCursor` skips re-applying what is already
    // applied. That guard has no observable effect on the DOM — `classList.add` on a
    // present value and `setProperty` on a set value read the same before and after — so
    // no assertion here distinguishes it and none should. It IS distinguishable, but only
    // by counting calls (`vi.spyOn(document.body.classList, 'add')` sees one call with the
    // guard and two without), and pinning that would pin the DOM API this module happens
    // to use rather than the lock's behaviour: an equivalent implementation that assigned
    // `className` or used `toggle` would go red for a change nobody could observe.
    lockDragCursor();
    lockDragCursor();

    expect(liveDragCursorCount()).toBe(2);
    expect(document.body).toHaveClass('cursor-grabbing');

    unlockDragCursor();
    expect(document.body).toHaveClass('cursor-grabbing');
    expect(document.body.style.userSelect).toBe('none');
  });

  it('does not let an over-release take the lock away from a gesture that is still live', () => {
    // A release with nothing held is the shape an abort route produces when the
    // gesture never started. Without the floor at zero the count goes negative,
    // and the next real gesture's own release then finds nothing left to hold —
    // snapping the cursor back mid-drag for a layer reorder under a dock gesture.
    unlockDragCursor();
    unlockDragCursor();

    lockDragCursor();
    lockDragCursor();
    unlockDragCursor();

    expect(liveDragCursorCount()).toBe(1);
    expect(document.body).toHaveClass('cursor-grabbing');
    expect(document.body.style.userSelect).toBe('none');

    unlockDragCursor();
    expect(document.body).not.toHaveClass('cursor-grabbing');
    expect(document.body.style.userSelect).toBe('');
  });

  it('counts a third lock, so a depth the two-lock cases never reach cannot go wrong', () => {
    // The count, not the class, decides who releases: three concurrent gestures owe three
    // releases. Nothing above reaches depth three, and that is the hole — moving
    // `if (liveLocks > 1) return;` ABOVE the increment leaves every other case in this
    // file green, because the class is applied at the first lock and never removed early,
    // so every DOM assertion here still passes.
    //
    // The count assertion immediately below the three locks is the load-bearing line: it
    // is the only one that reads 2 where 3 is expected. The DOM lines after each release
    // are there because "the count went down" and "the user still sees a grabbing cursor"
    // are different claims, and only the first is what this module guarantees.
    lockDragCursor();
    lockDragCursor();
    lockDragCursor();

    expect(liveDragCursorCount()).toBe(3);
    expect(document.body).toHaveClass('cursor-grabbing');
    expect(document.body.style.userSelect).toBe('none');

    unlockDragCursor();
    expect(liveDragCursorCount()).toBe(2);
    expect(document.body).toHaveClass('cursor-grabbing');
    expect(document.body.style.userSelect).toBe('none');

    unlockDragCursor();
    expect(liveDragCursorCount()).toBe(1);
    expect(document.body).toHaveClass('cursor-grabbing');

    unlockDragCursor();
    expect(liveDragCursorCount()).toBe(0);
    expect(document.body).not.toHaveClass('cursor-grabbing');
    expect(document.body.style.userSelect).toBe('');
  });
});
