import { describe, expect, it } from 'vitest';

import { isNativeChatId } from '../lib/native-chat-id.mjs';

describe('isNativeChatId', () => {
  it.each([
    'ses_0123456789ABCDEF0123456789',
    '01234567-89ab-4def-8123-456789abcdef',
    'copilotcli:/01234567-89ab-4def-8123-456789abcdef',
  ])('accepts native session identifiers: %s', (value) => {
    expect(isNativeChatId(value)).toBe(true);
  });

  it.each([
    '2026-11-24T04:30:00Z',
    'ses_short',
    '01234567-89ab-cdef-8123-456789abcdef',
    'copilotcli:/not-a-uuid',
    '01234567-89ab-4def-8123-456789abcdef\nChat: injected',
    'ses_0123456789ABCDEF0123456789\n',
    '',
    null,
  ])('rejects non-native session identifiers: %s', (value) => {
    expect(isNativeChatId(value)).toBe(false);
  });
});
