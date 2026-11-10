import { describe, expect, it } from 'vitest';

import { setTemporaryHandActive, isTemporaryHandActive } from '../temporary-hand.ts';

describe('temporary-hand', () => {
  beforeEach(() => {
    // Reset to default state before each test
    setTemporaryHandActive(false);
  });

  it('isTemporaryHandActive returns false by default', () => {
    expect(isTemporaryHandActive()).toBe(false);
  });

  it('setTemporaryHandActive sets the state', () => {
    setTemporaryHandActive(true);
    expect(isTemporaryHandActive()).toBe(true);

    setTemporaryHandActive(false);
    expect(isTemporaryHandActive()).toBe(false);
  });

  it('can be toggled multiple times', () => {
    expect(isTemporaryHandActive()).toBe(false);
    setTemporaryHandActive(true);
    expect(isTemporaryHandActive()).toBe(true);
    setTemporaryHandActive(false);
    expect(isTemporaryHandActive()).toBe(false);
    setTemporaryHandActive(true);
    expect(isTemporaryHandActive()).toBe(true);
  });
});
