# Tool Settings Persistence Inconsistency

## Status: Open

## Priority: Medium-High

## Owner: [Unassigned]

## Summary

The `saveLastSettings` function in `src/util/settings.ts` handles persistence for only ~26 of 29 tool types. Three tools (`blur`, `color`, `levels`) have default settings and argument types defined but are **completely missing** from the persistence logic. This means calling `patchToolArgs` or `setToolArgs` for these tools silently fails to persist changes — the settings are updated in-memory via React state but never saved to `lastSavedSettings`.

This was discovered when the `useCurrentTool.test.tsx` tests for `patchToolArgs` failed because the test used the `levels` tool, which doesn't persist. The test was changed to use `rectangle` to work around the issue, but the underlying problem remains.

## Problem Details

### Architecture Overview

Tool arguments are managed through several layers:

1. **`defaultSettings`** (`src/tools/settings.ts`): Defines the initial/default args for every tool type. All 29 tools have entries here.

2. **`lastSavedSettings`** (`src/tools/settings.ts:201`): A mutable object initialized from `cloneDeep(defaultSettings)`. This serves as the in-memory "last saved" state for each tool and is the source of truth when restoring tool args.

3. **`saveLastSettings`** (`src/util/settings.ts:9`): Called whenever tool args change (via `_setToolArgs` → `saveLastSettings`). This function **serializes and persists** args to `lastSavedSettings`. It contains a long if/else chain that handles each tool type differently (some strip transient fields, some only store `{ toolName }`, some merge with existing).

4. **`CurrentToolContext`** (`src/contexts/useCurrentTool.tsx`):
   - `setToolArgs`: Calls `saveLastSettings(args)` then updates internal React state.
   - `patchToolArgs`: Merges a patch onto either current or saved args, then delegates to `setToolArgs`.
   - `resetToLastSavedArgs`: Reads from `lastSavedSettings` to restore defaults.

### The Gap

Three tools are defined in `defaultSettings` but have **no branch** in `saveLastSettings`:

| Tool Name | Missing Fields                     | Args Type        |
| --------- | ---------------------------------- | ---------------- |
| `blur`    | `radius`                           | `BlurToolArgs`   |
| `color`   | `grayscale`, `sepia`, `saturation` | `ColorsToolArgs` |
| `levels`  | `brightness`, `contrast`           | `LevelsToolArgs` |

When `saveLastSettings` is called with any of these tools, the function reaches the end of the if/else chain without matching any branch, and **`lastSavedSettings[toolName]` is never updated**. The function returns silently — no error, no warning.

### Impact

1. **Lost settings on tool re-selection**: When a user changes `blur` radius, switches to another tool, and then returns to `blur`, the radius resets to default (0) instead of persisting the user's last value.

2. **Broken `patchToolArgs` expectations**: Any code that calls `patchToolArgs('levels', { brightness: 50 })` expecting the value to persist will be surprised when `lastSavedSettings.levels.brightness` remains 0.

3. **Test fragility**: Tests using these tools for persistence will fail silently (the test assertion will fail, but the root cause is unclear from the test alone).

4. **No compile-time safety**: TypeScript does not catch this because `saveLastSettings` accepts `ToolArgs` (a broad union) and the function lacks an exhaustiveness check on the `toolName` field.

### Code Path

```
patchToolArgs('levels', { brightness: 50 })
  → _setToolArgs({ ...base, brightness: 50, toolName: 'levels' })
    → saveLastSettings({ brightness: 50, toolName: 'levels' })
      → none of the if/else branches match 'levels'
      → lastSavedSettings.levels is NOT updated (still { brightness: 0 })
    → setToolState(...)  // React state is updated correctly
```

The internal React state is updated, so `result.current.toolArgs` will reflect the change within the session. But if the component re-mounts or the tool is re-selected after a switch, the stale `lastSavedSettings.levels` is used.

## Proposed Solutions

### Solution A: Add missing tool handlers (Recommended)

Simply add the three missing tools to `saveLastSettings`:

```typescript
// In src/util/settings.ts, before the final closing brace:

} else if (toolName === 'blur') {
  lastSavedSettings.blur = cloneDeep(args);
} else if (toolName === 'color') {
  lastSavedSettings.color = cloneDeep(args);
} else if (toolName === 'levels') {
  lastSavedSettings.levels = cloneDeep(args);
}
```

Each of these tools stores full args without needing to strip transient fields (unlike `draw` which strips `points`, or `crop` which strips `rect`). The simplest save is a deep clone of all args, consistent with how `transform`, `reposition`, and lasso tools are handled.

### Solution B: Use a generic fallback (Alternative)

Replace the if/else chain with a map-based approach that defaults to `cloneDeep(args)` for any tool not explicitly handled:

```typescript
// Define handlers for each tool's special serialization needs
const saveHandlers: Partial<Record<ToolName, (args: ToolArgs) => ToolArgs>> = {
  draw: (args) => ({ ...args, points: [] }),
  text: (args) => omit(args, 'text', 'rect'),
  shape: (args) => omit(args, 'start', 'end'),
  crop: (args) => omit(args, 'rect'),
  'feather-magnetic-lasso': (args) => ({ ...args, points: [] }),
  'rectangular-selection': () => ({ toolName: 'rectangular-selection' }),
  // ... other special cases
};

export function saveLastSettings(args: ToolArgs) {
  const { toolName } = args;
  if (!toolName) throw new Error('Tool name required');

  const handler = saveHandlers[toolName] ?? ((a: ToolArgs) => a);
  lastSavedSettings[toolName] = cloneDeep(handler(args));
}
```

This is more maintainable and automatically handles new tools with simple persistence needs.

### Solution C: Add exhaustiveness check (Defense in depth)

Add a catch-all that warns or throws for unhandled tools:

```typescript
else {
  // Either fall back to generic persistence:
  (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(args);

  // Or warn:
  console.warn(`saveLastSettings: unhandled tool "${toolName}"`);
}
```

This should be combined with Solution A or B to ensure all tools are explicitly handled.

## Recommendation

Implement **Solution A** (add the three missing handlers) as the minimal fix, and consider refactoring to **Solution B** (map-based approach) for long-term maintainability. This resolves the inconsistency without changing behavior for existing tools.

## Related Files

- `src/util/settings.ts` — `saveLastSettings` function (the gap)
- `src/tools/settings.ts` — `defaultSettings` and `lastSavedSettings` definitions
- `src/contexts/useCurrentTool.tsx` — `patchToolArgs` and `setToolArgs` callers
- `src/contexts/__tests__/useCurrentTool.test.tsx` — test file that was affected
