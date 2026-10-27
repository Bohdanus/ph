/**
 * The Kilo session database is a live operational database, not an inventory
 * store. Every inventory query must stay inside this bound so a stale worktree
 * cannot turn a safety check into an all-history database scan.
 */
export const MAX_SESSION_DB_WINDOW_HOURS = 72;
export const MAX_SESSION_DB_WINDOW_MS = MAX_SESSION_DB_WINDOW_HOURS * 60 * 60 * 1000;

/** Clamp an audit start time to the database safety window. */
export function boundSessionSinceMs(sinceMs, nowMs) {
  const floor = nowMs - MAX_SESSION_DB_WINDOW_MS;
  return Number.isFinite(sinceMs) ? Math.max(sinceMs, floor) : floor;
}
