import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { downloadBlob, loadDocumentFile, saveImageToDisk } from './image-load-save-utils.ts';
import { renderExportCanvas } from './export-canvas.ts';
import type { PsdDocument } from './psd-utils.ts';
import type { LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import SaveDialog from '../components/SaveDialog/SaveDialog.tsx';
import NewImageDialog from '../components/NewImageDialog/NewImageDialog.tsx';
import type { NewDocumentBlankParams } from './tool-types.ts';
import { stripOutputFileExtension } from '../constants/imageFormats.ts';
import { useOptionalStore } from './StoreContext.tsx';
import { composeDurableDocument } from './durable-compositor.ts';
import { replayDurableAtCursor } from './durable-replay.ts';
import { getAssetRegistry } from './asset-registry.ts';
import { durableExportRecords } from './export-canvas.ts';
import { documentFrameEquals } from './document-frame.ts';

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

export interface FileContextType {
  openNewImageDialog: () => Promise<NewDocumentBlankParams | null>;
  openLoadImageDialog: () => Promise<ImageUploadResponse | null>;
  openSaveImageDialog: (data: ImageSaveInput) => Promise<ImageSaveResponse | null>;
}

const FileContext = createContext<FileContextType | undefined>(undefined);

type FileProviderProps = PropsWithChildren;

// FileProvider is a persistent provider that owns the hidden DOM used for file I/O
export const FileProvider = ({ children }: FileProviderProps) => {
  const storeContext = useOptionalStore();
  const store = storeContext?.[0] ?? null;
  const latestStoreRef = useRef(store);
  useEffect(() => {
    latestStoreRef.current = store;
  }, [store]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [fileInput, setFileInput] = useState<ImageSaveInput | null>(null);

  // Resolver refs allow promise-based API for consumers
  const uploadResolverRef = useRef<((data: ImageUploadResponse | null) => void) | null>(null);
  const newResolverRef = useRef<((data: NewDocumentBlankParams | null) => void) | null>(null);
  const saveResolverRef = useRef<((res: ImageSaveResponse | null) => void) | null>(null);

  useEffect(() => {
    const input = fileInputRef.current;
    const cancel = () => {
      uploadResolverRef.current?.(null);
      uploadResolverRef.current = null;
    };
    input?.addEventListener('cancel', cancel);
    return () => input?.removeEventListener('cancel', cancel);
  }, []);

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      // If there's a resolver waiting, resolve with null (canceled)
      uploadResolverRef.current?.(null);
      uploadResolverRef.current = null;
      return;
    }

    try {
      const data = await loadDocumentFile(file);
      // Resolve any waiting promise
      uploadResolverRef.current?.(data);
      uploadResolverRef.current = null;
    } catch (error) {
      console.error('Failed to load image:', error);
      uploadResolverRef.current?.(null);
      uploadResolverRef.current = null;
    }

    // Reset input so the same file can be selected again if needed
    if (event.target) {
      event.target.value = '';
    }
  };

  const openNewImageDialog = useCallback(() => {
    setShowNewDialog(true);
    return new Promise<NewDocumentBlankParams | null>((resolve) => {
      newResolverRef.current = resolve;
    });
  }, []);

  const openLoadImageDialog = useCallback(() => {
    return new Promise<ImageUploadResponse | null>((resolve) => {
      uploadResolverRef.current = resolve;
      // trigger file picker
      fileInputRef.current?.click();
    });
  }, []);

  const openSaveImageDialog = useCallback((input: ImageSaveInput) => {
    setFileInput(input);
    setShowSaveDialog(true);
    return new Promise<ImageSaveResponse | null>((resolve) => {
      saveResolverRef.current = resolve;
    });
  }, []);

  const value = useMemo(
    () => ({ openNewImageDialog, openLoadImageDialog, openSaveImageDialog }),
    [openNewImageDialog, openLoadImageDialog, openSaveImageDialog]
  );

  async function handleImageSave({ fileName, format, quality }: ImageSaveResponse) {
    let durableComposite: Awaited<ReturnType<typeof composeDurableDocument>> | undefined;
    try {
      const { layers, size, documentFrame } = fileInput!;
      let exportLayers = layers;
      let exportSize = size;
      let exportFrame = documentFrame;
      const current = latestStoreRef.current;
      const frameMatches =
        documentFrame && current?.documentFrame
          ? documentFrameEquals(documentFrame, current.documentFrame)
          : documentFrame === current?.documentFrame;
      if (
        current?.durableStatus === 'current' &&
        current.durableDocument &&
        current.durableDocument.cursor === current.historyIndex &&
        current.durableDocument.documentId === current.documentId &&
        current.durableDocument.documentRevision === current.documentRevision &&
        current.durableDocument.branchRevision === current.branchRevision &&
        layers === current.layers &&
        size.width === current.totalSize.width &&
        size.height === current.totalSize.height &&
        frameMatches
      ) {
        try {
          const replay = replayDurableAtCursor(current.durableDocument, current.durableDocument.cursor);
          durableComposite = await composeDurableDocument(replay, {
            documentId: current.documentId,
            baselineAssetGeneration: getAssetRegistry().getDocumentGeneration(current.documentId),
            operationSetRevision: current.durableDocument.durableRevision,
            assetRegistry: getAssetRegistry(),
          });
          const records = durableExportRecords(replay, durableComposite);
          const latest = latestStoreRef.current;
          if (
            !latest ||
            latest.durableStatus !== 'current' ||
            latest.durableDocument?.durableRevision !== current.durableDocument.durableRevision ||
            latest.historyIndex !== current.historyIndex ||
            latest.documentRevision !== current.documentRevision ||
            latest.branchRevision !== current.branchRevision
          ) {
            durableComposite.release();
            durableComposite = undefined;
          } else {
            exportLayers = records.layers;
            exportSize = records.size;
            exportFrame = records.frame;
          }
        } catch {
          durableComposite?.release();
          durableComposite = undefined;
        }
      }

      if (format === 'psd') {
        const { savePsd } = await import('./psd-utils.ts');
        const buffer = exportFrame
          ? await savePsd(exportLayers, exportSize, exportFrame)
          : await savePsd(exportLayers, exportSize);
        downloadBlob(new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }), fileName, 'psd');
      } else {
        // Rendered here rather than handed in, so the encoded pixels are the DOCUMENT at
        // DOCUMENT resolution whatever the display canvas is doing. See export-canvas.ts.
        await saveImageToDisk(renderExportCanvas(exportLayers, exportSize, exportFrame), fileName, format, quality);
      }
      saveResolverRef.current?.(quality === undefined ? { fileName, format } : { fileName, format, quality });
      saveResolverRef.current = null;
      // The teardown belongs to the success branch, NOT to `finally`. A `finally` runs on
      // every exit, so it conflated "the attempt finished" with "the save worked" and tore
      // the dialog down on a failure exactly as it does on a success: the user lost the
      // chance to change format/quality and retry, and had to redo the whole export.
      // Leaving both calls here is also what makes a retry work at all — `fileInput` stays
      // staged, so the second attempt encodes the same `{ layers, size, documentFrame }`,
      // and the dialog's `key` is derived from `fileInput.fileName`, so an unchanged input
      // means no remount and the user's own `fileName`/`format`/`jpegQuality` edits are
      // still on screen.
      setShowSaveDialog(false);
      setFileInput(null);
    } catch (error) {
      // Preserve the null result for openSaveImageDialog callers, but reject this callback so
      // SaveDialog can show the failure. Clearing the resolver first keeps retries from
      // settling an already-completed promise.
      saveResolverRef.current?.(null);
      saveResolverRef.current = null;
      throw error;
    } finally {
      durableComposite?.release();
    }
  }

  const handleNewImageCreate = (data: NewDocumentBlankParams) => {
    // Resolve the waiting promise (if any) with data or undefined
    newResolverRef.current?.(data);
    newResolverRef.current = null;
    setShowNewDialog(false);
  };

  const handleNewImageClose = () => {
    newResolverRef.current?.(null);
    newResolverRef.current = null;
    setShowNewDialog(false);
  };

  const handleSaveClose = () => {
    saveResolverRef.current?.(null);
    saveResolverRef.current = null;
    setShowSaveDialog(false);
    setFileInput(null);
  };

  return (
    <FileContext.Provider value={value}>
      {children}
      <input
        type="file"
        data-testid="file-open-input"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/*,.psd,.tif,.tiff,.bmp,.gif,.avif,.ico,.svg"
        style={{ display: 'none' }}
      />
      {showNewDialog && <NewImageDialog onClose={handleNewImageClose} onCreate={handleNewImageCreate} />}
      {showSaveDialog && (
        <SaveDialog
          key={stripOutputFileExtension(fileInput?.fileName ?? '')}
          proposedName={`${stripOutputFileExtension(fileInput?.fileName ?? '')} (copy)`}
          onClose={handleSaveClose}
          onSave={handleImageSave}
        />
      )}
    </FileContext.Provider>
  );
};

export const useFile = (): FileContextType => {
  const ctx = useContext(FileContext);
  if (!ctx) {
    throw new Error('useFile must be used within a FileProvider');
  }
  return ctx;
};
