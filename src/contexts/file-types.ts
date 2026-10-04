/**
 * The file I/O request and response shapes, in a type-only leaf.
 *
 * They were declared in `useFile.tsx`, which is the one module in this cycle that
 * also renders its consumers: it imports `SaveDialog` and `NewImageDialog` as
 * VALUES to mount them, so a dialog that reached back for its prop's type closed a
 * cycle between a component and the hook module that owns the provider. The
 * direction that remains is the intended one — anything may call `useFile()`; the
 * provider module is not imported for its shapes.
 *
 * This leaf imports four other type modules, which is what keeps it a leaf in the
 * graph sense: it adds no runtime edge, because every specifier below is
 * `import type`. `StoreContext.boundary-gates.test.ts` asserts that, so a future
 * edit cannot quietly promote one of them to a value import and drag a codec's
 * module graph into the dialogs.
 */
import type { PsdDocument } from './psd-utils.ts';
import type { LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';

export type ImageUploadResponse =
  | { fileName: string; document: PsdDocument }
  | {
      image: HTMLImageElement;
      fileName: string;
    };

export type ImageSaveInput = {
  fileName: string;
  format?: string;
  layers: LayersRecord;
  size: Size;
  documentFrame?: DocumentFrame;
};

export type ImageSaveResponse = {
  fileName: string;
  format: string;
  quality?: number;
};
