const KILO_SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]{26}$/;
const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const CODEX_THREAD_ID_PATTERN = new RegExp(`^${UUID_PATTERN}$`);
const COPILOT_SESSION_URI_PATTERN = new RegExp(`^copilotcli:/${UUID_PATTERN}$`);

export function isNativeChatId(value) {
  if (typeof value !== 'string') return false;
  return (
    matchesEntireString(KILO_SESSION_ID_PATTERN, value) ||
    matchesEntireString(CODEX_THREAD_ID_PATTERN, value) ||
    matchesEntireString(COPILOT_SESSION_URI_PATTERN, value)
  );
}

function matchesEntireString(pattern, value) {
  return pattern.exec(value)?.[0] === value;
}
