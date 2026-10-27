import type { ToolName } from '../../contexts/tool-types.ts';

import type { ToolDescription } from './types.ts';
import { eyedropperDrawDescriptions } from './eyedropper-draw.ts';
import { focusDescriptions } from './focus.ts';
import { paintDescriptions } from './paint.ts';
import { penDescriptions } from './pen.ts';
import { selectionDescriptions } from './selection.ts';
import { shapeDescriptions } from './shape.ts';
import { transformDescriptions } from './transform.ts';
import { typeCropDescriptions } from './type-crop.ts';
import { viewDescriptions } from './view.ts';
import { patchDescriptions } from './patch.ts';

const { star: _starDescription, ...registeredShapeDescriptions } = shapeDescriptions;

export type {
  ToolControl,
  ToolControlStatus,
  ToolDescription,
  ToolImplementationStatus,
  ToolModifier,
  ToolShortcut,
} from './types.ts';

/**
 * Every tool, described.
 *
 * The annotation is the point of the file. The eight family modules above are written by
 * independent research passes against eight tool families, and nothing at runtime would notice
 * if one of them quietly stopped covering its family. This `Record<ToolName, ToolDescription>`
 * does: `ToolName` is `keyof ToolArgsByName`, so dropping a key from a family — or adding one
 * Photoshop has no tool for — is a TypeScript error at the merge, not a tooltip that renders
 * `undefined`.
 *
 * A spread is silent about a key two families both define, so
 * `__tests__/toolDescriptions.test.ts` asserts the families are disjoint from the raw source
 * text as well as at runtime. The compiler covers the missing half; only a test covers the
 * duplicated half.
 */
export const toolDescriptions: Record<ToolName, ToolDescription> = {
  ...selectionDescriptions,
  ...paintDescriptions,
  ...focusDescriptions,
  ...registeredShapeDescriptions,
  ...penDescriptions,
  ...typeCropDescriptions,
  ...transformDescriptions,
  ...eyedropperDrawDescriptions,
  ...viewDescriptions,
  ...patchDescriptions,
};

export const getToolDescription = (name: ToolName): ToolDescription => toolDescriptions[name];

/**
 * The full record is for the tests, the generator and `docs/TOOLS.md` — **not** for the
 * application. It measures 215 kB raw / 58 kB gzipped, and the toolbar only ever reads a
 * one-line summary and a status, so it imports the generated projection in `./tooltips.ts`
 * instead. `descriptionKeyFor` lives there for the same reason and is re-exported here so the
 * generator reaches one definition rather than two.
 */
export { descriptionKeyFor } from './tooltips.ts';
