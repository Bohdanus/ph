import React, { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { downloadBlob, loadDocumentFile, saveImageToDisk } from './image-load-save-utils.ts';
import type { PsdDocument } from './psd-utils.ts';
import type { LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import SaveDialog from '../components/SaveDialog/SaveDialog.tsx';
import NewImageDialog from '../components/NewImageDialog/NewImageDialog.tsx';
import type { BlankImageParams } from './tool-types.ts';
import { stripOutputFileExtension } from '../constants/imageFormats.ts';

export type ImageUploadResponse =
  | { fileName: string; document: PsdDocument }
  | {
      image: HTMLImageElement;
      fileName: string;
    };

export type ImageSaveInput = {
  canvas: HTMLCanvasElement;
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
  openNewImageDialog: () => Promise<BlankImageParams | null>;
  openLoadImageDialog: () => Promise<ImageUploadResponse | null>;
  openSaveImageDialog: (data: ImageSaveInput) => Promise<ImageSaveResponse | null>;
}

const FileContext = createContext<FileContextType | undefined>(undefined);

type FileProviderProps = PropsWithChildren;

// FileProvider is a persistent provider that owns the hidden DOM used for file I/O
export const FileProvider = ({ children }: FileProviderProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [fileInput, setFileInput] = useState<ImageSaveInput | null>(null);

  // Resolver refs allow promise-based API for consumers
  const uploadResolverRef = useRef<((data: ImageUploadResponse | null) => void) | null>(null);
  const newResolverRef = useRef<((data: BlankImageParams | null) => void) | null>(null);
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

  const openNewImageDialog = () => {
    setShowNewDialog(true);
    return new Promise<BlankImageParams | null>((resolve) => {
      newResolverRef.current = resolve;
    });
  };

  const openLoadImageDialog = () => {
    return new Promise<ImageUploadResponse | null>((resolve) => {
      uploadResolverRef.current = resolve;
      // trigger file picker
      fileInputRef.current?.click();
    });
  };

  const openSaveImageDialog = (input: ImageSaveInput) => {
    setFileInput(input);
    setShowSaveDialog(true);
    return new Promise<ImageSaveResponse | null>((resolve) => {
      saveResolverRef.current = resolve;
    });
  };

  async function handleImageSave({ fileName, format, quality }: ImageSaveResponse) {
    try {
      const { canvas, layers, size, documentFrame } = fileInput!;
      if (format === 'psd') {
        const { savePsd } = await import('./psd-utils.ts');
        const buffer = documentFrame ? await savePsd(layers, size, documentFrame) : await savePsd(layers, size);
        downloadBlob(new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }), fileName, 'psd');
      } else {
        await saveImageToDisk(canvas, fileName, format, quality);
      }
      saveResolverRef.current?.(quality === undefined ? { fileName, format } : { fileName, format, quality });
      saveResolverRef.current = null;
      // The teardown belongs to the success branch, NOT to `finally`. A `finally` runs on
      // every exit, so it conflated "the attempt finished" with "the save worked" and tore
      // the dialog down on a failure exactly as it does on a success: the user lost the
      // chance to change format/quality and retry, and had to redo the whole export.
      // Leaving both calls here is also what makes a retry work at all — `fileInput` stays
      // staged, so the second attempt encodes the same `{ canvas, layers, size,
      // documentFrame }`, and the dialog's `key` is derived from `fileInput.fileName`, so
      // an unchanged input means no remount and the user's own `fileName`/`format`/
      // `jpegQuality` edits are still on screen.
      setShowSaveDialog(false);
      setFileInput(null);
    } catch (e) {
      console.error('Failed to save image:', e);
      // `null` is the in-band failure signal every caller already guards with
      // `if (data)`, so it still resolves, and it still resolves the promise exactly once
      // because it is the first and only caller of a resolver that is nulled immediately
      // after. The dialog, the staged input and the dialog's own controls all stay put, so
      // the retry re-enters this `try` with `fileInput` intact and the now-nulled
      // `saveResolverRef` makes the second resolution a no-op rather than a stale resolve.
      saveResolverRef.current?.(null);
      saveResolverRef.current = null;
    }
  }

  const handleNewImageCreate = (data: BlankImageParams) => {
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
    <FileContext.Provider value={{ openNewImageDialog, openLoadImageDialog, openSaveImageDialog }}>
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
