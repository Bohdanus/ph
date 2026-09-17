import React, { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { downloadBlob, loadDocumentFile, saveImageToDisk } from './image-load-save-utils.ts';
import type { PsdDocument } from './psd-utils.ts';
import type { LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
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
      window.alert(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
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
      const { canvas, layers, size } = fileInput!;
      if (format === 'psd') {
        const { savePsd } = await import('./psd-utils.ts');
        const buffer = await savePsd(layers, size);
        downloadBlob(new Blob([buffer], { type: 'image/vnd.adobe.photoshop' }), fileName, 'psd');
      } else {
        await saveImageToDisk(canvas, fileName, format, quality);
      }
      // Resolve the waiting promise with the save info
      saveResolverRef.current?.(quality === undefined ? { fileName, format } : { fileName, format, quality });
      saveResolverRef.current = null;
    } catch (e) {
      console.error('Failed to save image:', e);
      window.alert(`Failed to save file: ${e instanceof Error ? e.message : String(e)}`);
      saveResolverRef.current?.(null);
      saveResolverRef.current = null;
    } finally {
      setShowSaveDialog(false);
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
    saveResolverRef.current?.(null); // todo: show success or not
    saveResolverRef.current = null;
    setShowSaveDialog(false);
  };

  return (
    <FileContext.Provider value={{ openNewImageDialog, openLoadImageDialog, openSaveImageDialog }}>
      {children}
      <input
        type="file"
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
