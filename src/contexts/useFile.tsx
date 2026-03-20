import React, { createContext, useContext, useRef, useState, type PropsWithChildren } from 'react';
import { loadImageFile, saveImageToDisk } from './image-load-save-utils.ts';
import SaveDialog from '../components/SaveDialog/SaveDialog.tsx';
import NewImageDialog from '../components/NewImageDialog/NewImageDialog.tsx';
import type { BlankImageParams } from './tool-types.ts';

export type ImageUploadResponse = {
  image: HTMLImageElement;
  fileName: string;
};

export type ImageSaveInput = {
  canvas: HTMLCanvasElement;
  fileName: string;
  format?: string;
};

export type ImageSaveResponse = {
  fileName: string;
  format: string;
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

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      // If there's a resolver waiting, resolve with null (canceled)
      uploadResolverRef.current?.(null);
      uploadResolverRef.current = null;
      return;
    }

    try {
      const img = await loadImageFile(file);
      const name = file.name;
      // Resolve any waiting promise
      uploadResolverRef.current?.({ image: img, fileName: name });
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

  async function handleImageSave({ fileName, format }: ImageSaveResponse) {
    try {
      const { canvas } = fileInput!;
      await saveImageToDisk(canvas, fileName, format);
      // Resolve the waiting promise with the save info
      saveResolverRef.current?.({ fileName, format });
      saveResolverRef.current = null;
    } catch (e) {
      console.error('Failed to save image:', e);
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
        accept="image/*"
        style={{ display: 'none' }}
      />
      {showNewDialog && <NewImageDialog onClose={handleNewImageClose} onCreate={handleNewImageCreate} />}
      {showSaveDialog && (
        <SaveDialog proposedName={`${fileInput?.fileName} (copy)`} onClose={handleSaveClose} onSave={handleImageSave} />
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
