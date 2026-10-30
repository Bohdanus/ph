import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useStore } from './StoreContext.tsx';
import { useLayers } from './useLayer.ts';
import { useApp } from '../hooks/useApp.ts';
import { savePsd, loadPsd } from './psd-utils.ts';
import { loadAutosave, saveAutosave, clearAutosave, isAutosaveAvailable } from './autosave-storage.ts';
import type { AutosaveMetadata } from './autosave-storage.ts';
import AutoSaveRecoveryBanner from '../components/AutoSaveRecoveryBanner/AutoSaveRecoveryBanner.tsx';

const AUTOSAVE_DEBOUNCE_MS = 1000;
const AUTOSAVE_MIN_INTERVAL_MS = 10_000;

export interface AutoSaveContextType {
  isAutosaveAvailable: boolean;
  pendingAutosave: boolean;
  autosaveMetadata: AutosaveMetadata | null;
  recoverFromAutosave: () => Promise<void>;
  dismissAutosave: () => Promise<void>;
}

const AutoSaveContext = createContext<AutoSaveContextType | undefined>(undefined);

function useVersionedDirtyKey(
  hasImage: boolean,
  hasUnsavedChanges: boolean,
  documentId: string,
  branchRevision: number,
  historyIndex: number
): string {
  return useMemo(
    () => `${hasImage}|${hasUnsavedChanges}|${documentId}|${branchRevision}|${historyIndex}`,
    [hasImage, hasUnsavedChanges, documentId, branchRevision, historyIndex]
  );
}

export const AutoSaveProvider = ({ children }: PropsWithChildren) => {
  const [
    {
      hasImage,
      hasUnsavedChanges,
      fileName,
      totalSize,
      documentFrame,
      documentId,
      documentRevision,
      branchRevision = 0,
      historyIndex,
      toolName,
      color,
      backgroundColor,
      layers,
    },
  ] = useStore();

  const storeRef = useRef({
    hasImage,
    hasUnsavedChanges,
    fileName,
    totalSize,
    documentFrame,
    documentId,
    documentRevision,
    branchRevision,
    historyIndex,
    toolName,
    color,
    backgroundColor,
    layers,
  });

  const { commitDirtyTool } = useLayers();
  const commitDirtyToolRef = useRef(commitDirtyTool);

  const { setImageFromUpload } = useApp();
  const setImageFromUploadRef = useRef(setImageFromUpload);

  const [autosaveMetadata, setAutosaveMetadata] = useState<AutosaveMetadata | null>(null);
  const [pendingAutosave, setPendingAutosave] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedVersionRef = useRef<string | null>(null);
  const lastSaveTimeRef = useRef(0);
  const savingRef = useRef(false);
  const recoveringRef = useRef(false);
  const prevHasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const prevDocumentIdRef = useRef(documentId);
  const performAutosaveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    storeRef.current = {
      hasImage,
      hasUnsavedChanges,
      fileName,
      totalSize,
      documentFrame,
      documentId,
      documentRevision,
      branchRevision,
      historyIndex,
      toolName,
      color,
      backgroundColor,
      layers,
    };
    commitDirtyToolRef.current = commitDirtyTool;
    setImageFromUploadRef.current = setImageFromUpload;
  }, [
    hasImage,
    hasUnsavedChanges,
    fileName,
    totalSize,
    documentFrame,
    documentId,
    documentRevision,
    branchRevision,
    historyIndex,
    toolName,
    color,
    backgroundColor,
    layers,
    commitDirtyTool,
    setImageFromUpload,
  ]);

  useEffect(() => {
    if (!isAutosaveAvailable()) return;
    let cancelled = false;
    loadAutosave()
      .then((record) => {
        if (!cancelled && record) {
          setAutosaveMetadata(record.metadata);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('AutoSave: Failed to check for existing autosave', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirtyKey = useVersionedDirtyKey(hasImage, hasUnsavedChanges, documentId, branchRevision, historyIndex);

  useEffect(() => {
    if (!hasImage) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      prevHasUnsavedChangesRef.current = hasUnsavedChanges;
      prevDocumentIdRef.current = documentId;
      return;
    }

    if (!hasUnsavedChanges) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      lastSavedVersionRef.current = dirtyKey;
      if (!recoveringRef.current) {
        // Only clear the autosave when the document was previously dirty (user
        // just saved) or when the document was replaced (user opened a new one).
        // On the initial mount neither condition holds, so the recovery banner
        // from a crashed previous session is preserved until the user acts on it.
        const wasDirty = prevHasUnsavedChangesRef.current;
        const documentChanged = prevDocumentIdRef.current !== documentId;
        if (wasDirty || documentChanged) {
          clearAutosave().catch(() => {});
          setAutosaveMetadata(null);
        }
      }
      prevHasUnsavedChangesRef.current = hasUnsavedChanges;
      prevDocumentIdRef.current = documentId;
      return;
    }

    prevHasUnsavedChangesRef.current = hasUnsavedChanges;
    prevDocumentIdRef.current = documentId;

    if (dirtyKey === lastSavedVersionRef.current) return;

    // The user is actively editing. Dismiss any stale recovery banner from a
    // previous session — the autosave is about to be overwritten with the
    // current document's data. The setState is placed inside the `schedule`
    // helper (like setPendingAutosave) to avoid a direct synchronous call in the
    // effect body, which `react-hooks/set-state-in-effect` rejects.
    const dismissRecoveryBanner = () => {
      if (autosaveMetadata) {
        setAutosaveMetadata(null);
      }
    };

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    const waitRemaining = AUTOSAVE_MIN_INTERVAL_MS - timeSinceLastSave;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    const schedule = (delay: number) => {
      dismissRecoveryBanner();
      setPendingAutosave(true);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        performAutosaveRef.current?.();
      }, delay);
    };

    if (timeSinceLastSave < AUTOSAVE_MIN_INTERVAL_MS) {
      schedule(waitRemaining + AUTOSAVE_DEBOUNCE_MS);
    } else {
      schedule(AUTOSAVE_DEBOUNCE_MS);
    }
  }, [dirtyKey, hasImage, hasUnsavedChanges, autosaveMetadata, documentId]);

  const performAutosave = useCallback(() => {
    if (savingRef.current || recoveringRef.current) return;
    savingRef.current = true;
    setPendingAutosave(true);

    const currentStore = storeRef.current;
    const committedLayers = commitDirtyToolRef.current(true);
    if (!committedLayers) {
      savingRef.current = false;
      setPendingAutosave(false);
      return;
    }

    savePsd(committedLayers, currentStore.totalSize, currentStore.documentFrame)
      .then((buffer) => {
        const metadata: AutosaveMetadata = {
          fileName: currentStore.fileName,
          documentId: currentStore.documentId,
          documentRevision: currentStore.documentRevision,
          branchRevision: currentStore.branchRevision,
          historyIndex: currentStore.historyIndex,
          toolName: currentStore.toolName,
          color: currentStore.color,
          backgroundColor: currentStore.backgroundColor,
          totalSize: currentStore.totalSize,
          documentFrame: currentStore.documentFrame,
          savedAt: Date.now(),
        };
        return saveAutosave({ metadata, buffer });
      })
      .then(() => {
        lastSaveTimeRef.current = Date.now();
        lastSavedVersionRef.current = dirtyKey;
      })
      .catch((error) => {
        console.error('AutoSave: Failed to serialize or store document', error);
      })
      .finally(() => {
        savingRef.current = false;
        setPendingAutosave(false);
      });
  }, [dirtyKey]);

  useEffect(() => {
    performAutosaveRef.current = performAutosave;
  }, [performAutosave]);

  const recoverFromAutosave = useCallback(async () => {
    if (!autosaveMetadata || recovering) return;

    setRecovering(true);
    recoveringRef.current = true;
    try {
      const record = await loadAutosave();
      if (!record) return;

      const { size, layers: psdLayers, warnings } = await loadPsd(record.buffer);
      await setImageFromUploadRef.current({
        fileName: record.metadata.fileName,
        document: { size, layers: psdLayers, warnings },
      });
      await clearAutosave();
      setAutosaveMetadata(null);
    } catch (error) {
      console.error('AutoSave: Failed to recover document', error);
    } finally {
      recoveringRef.current = false;
      setRecovering(false);
    }
  }, [autosaveMetadata, recovering]);

  const dismissAutosave = useCallback(async () => {
    await clearAutosave();
    setAutosaveMetadata(null);
  }, []);

  const value = useMemo<AutoSaveContextType>(
    () => ({
      isAutosaveAvailable: isAutosaveAvailable(),
      pendingAutosave,
      autosaveMetadata,
      recoverFromAutosave,
      dismissAutosave,
    }),
    [pendingAutosave, autosaveMetadata, recoverFromAutosave, dismissAutosave]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  return (
    <AutoSaveContext.Provider value={value}>
      {children}
      {autosaveMetadata && (
        <AutoSaveRecoveryBanner
          metadata={autosaveMetadata}
          recovering={recovering}
          onRecover={recoverFromAutosave}
          onDismiss={dismissAutosave}
        />
      )}
    </AutoSaveContext.Provider>
  );
};

export const useAutoSave = (): AutoSaveContextType => {
  const ctx = useContext(AutoSaveContext);
  if (!ctx) throw new Error('useAutoSave must be used within AutoSaveProvider');
  return ctx;
};
