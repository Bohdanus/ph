import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Action, PublicAction, StoreDispatch } from '../StoreContext.tsx';

const storeContextFile = resolve(import.meta.dirname, '../StoreContext.tsx');
const forbiddenModules = ['replay-coordinator', 'materialization', 'replay-checkpoints'] as const;

function blankRange(output: string[], source: string, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
  }
}

function maskCommentsPreservingImportSpecifiers(source: string): string {
  const output = source.split('');
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      blankRange(output, source, start, index);
      continue;
    }
    if (character === '/' && next === '*') {
      const start = index;
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index = Math.min(source.length, index + 2);
      blankRange(output, source, start, index);
      continue;
    }
    if (character !== "'" && character !== '"' && character !== '`') {
      index += 1;
      continue;
    }

    const quote = character;
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === quote) break;
      index += 1;
    }
    const end = index < source.length ? index : source.length;
    const prefix = output.slice(0, start).join('').replace(/\s+$/, '');
    const preserve = quote !== '`' && /(?:\bfrom|\bimport(?:\s*\()?)\s*$/.test(prefix);
    if (!preserve) blankRange(output, source, start + 1, end);
    index = Math.min(source.length, end + 1);
  }
  return output.join('');
}

function forbiddenImportSpecifiers(source: string): string[] {
  const masked = maskCommentsPreservingImportSpecifiers(source);
  const specifiers: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;
  for (const match of masked.matchAll(pattern)) {
    const specifier = match[1];
    if (forbiddenModules.some((moduleName) => specifier.includes(moduleName))) specifiers.push(specifier);
  }
  return specifiers;
}

const ALL_PUBLIC_ACTIONS: Record<PublicAction['type'], true> = {
  SET_HAS_IMAGE: true,
  SET_HAS_UNSAVED_CHANGES: true,
  SET_FILE_NAME: true,
  SET_ORIGINAL_IMAGE: true,
  SET_SIZE: true,
  SET_TOOL_NAME: true,
  SET_LAYERS: true,
  SET_ACTIVE_LAYER: true,
  ADD_LAYER: true,
  PROMOTE_LAYER_PRESENTATIONS: true,
  REORDER_LAYERS: true,
  BATCH_UPDATES: true,
  COMMIT_DOCUMENT_EDIT: true,
  APPLY_HISTORY_REPLAY: true,
  REPLACE_DOCUMENT: true,
  SET_DURABLE_STATUS: true,
  SET_COLOR: true,
  SET_BACKGROUND_COLOR: true,
  SET_SELECTIONS: true,
  ADD_SELECTION: true,
  COMMIT_SELECTION: true,
  UPDATE_SELECTION: true,
  MOVE_SELECTION: true,
  SET_ACTIVE_SELECTION: true,
  START_SELECTION_DRAFT: true,
  CANCEL_SELECTION_DRAFT: true,
  SET_SELECTION_CLIPBOARD: true,
  MARK_SELECTION_COPIED: true,
  CLEAR_SELECTIONS: true,
};

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;

describe('StoreContext boundary gates', () => {
  it('does not import retired replay/materialization modules', () => {
    const source = readFileSync(storeContextFile, 'utf8');
    expect(forbiddenImportSpecifiers(source)).toEqual([]);

    const knownBad = `
      // import { replay } from './replay-coordinator.ts';
      import { materialize } from './materialization.ts';
      export { checkpoint } from './replay-checkpoints.ts';
      import './replay-coordinator-side-effect.ts';
      const dynamic = import('./replay-coordinator.ts');
    `;
    expect(forbiddenImportSpecifiers(knownBad)).toEqual([
      './materialization.ts',
      './replay-checkpoints.ts',
      './replay-coordinator-side-effect.ts',
      './replay-coordinator.ts',
    ]);
  });

  it('keeps the public action union exhaustive and rejects internal actions', () => {
    const actionTypes = Object.keys(ALL_PUBLIC_ACTIONS) as PublicAction['type'][];
    expect(actionTypes).toHaveLength(29);
    expect(new Set(actionTypes).size).toBe(actionTypes.length);
    expect(ALL_PUBLIC_ACTIONS as Record<Action['type'], true>).toEqual(ALL_PUBLIC_ACTIONS);

    const actionUnionMatches: Equal<Action, PublicAction> = true;
    const dispatchUnionMatches: Equal<Parameters<StoreDispatch>[0], PublicAction> = true;
    expect(actionUnionMatches).toBe(true);
    expect(dispatchUnionMatches).toBe(true);

    const typeProbe = (dispatch: StoreDispatch): void => {
      // @ts-expect-error internal presentation publication is not a public store action
      dispatch({ type: 'PUBLISH_RUNTIME_PRESENTATION', payload: { layers: {} } });
      // @ts-expect-error internal bitmap adoption is not a public store action
      dispatch({ type: 'ADOPT_LAYER_BITMAPS', payload: { bitmaps: [] } });
    };
    void typeProbe;
  });
});
