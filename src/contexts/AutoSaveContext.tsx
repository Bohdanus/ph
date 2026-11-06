import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useStore } from './StoreContext.tsx';
import { useLayers } from './useLayer.ts';
import { useCurrentTool } from './useCurrentTool.tsx';
import { useApp } from '../hooks/useApp.ts';
import { savePsd, loadPsd } from './psd-utils.ts';
import { loadAutosave, saveAutosave, clearAutosave, isAutosaveAvailable } from './autosave-storage.ts';
import type { AutosaveMetadata } from './autosave-storage.ts';
import { textLayerEditTarget } from './text-layer-edit.ts';
import AutoSaveRecoveryBanner from '../components/AutoSaveRecoveryBanner/AutoSaveRecoveryBanner.tsx';
import { isTextToolArgs } from '../util/typeGuards.ts';
import type { TextToolArgs } from '../tools/text.ts';

const AUTOSAVE_DEBOUNCE_MS = 1000;
const AUTOSAVE_MIN_INTERVAL_MS = 10_000;

function textDraftContentKey(args: TextToolArgs): string {
  const {
    rect: _rect,
    editingLayerId: _editingLayerId,
    placeholderUntouched: _placeholderUntouched,
    ...content
  } = args;
  return JSON.stringify(
    Object.fromEntries(Object.entries(content).sort(([left], [right]) => left.localeCompare(right)))
  );
}

function sameTextRect(left: TextToolArgs['rect'], right: TextToolArgs['rect']): boolean {
  if (!left || !right) return left === right;
  return left.x1 === right.x1 && left.y1 === right.y1 && left.x2 === right.x2 && left.y2 === right.y2;
}

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
  historyIndex: number,
  textDraftKey: string
): string {
  return useMemo(
    () => `${hasImage}|${hasUnsavedChanges}|${documentId}|${branchRevision}|${historyIndex}|${textDraftKey}`,
    [hasImage, hasUnsavedChanges, documentId, branchRevision, historyIndex, textDraftKey]
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
  const { toolArgs } = useCurrentTool();
  // Text drafts live outside StoreContext, so include changed content in the autosave version directly.
  let textDraftKey = '';
  if (toolName === 'text' && isTextToolArgs(toolArgs) && toolArgs.rect) {
    if (!toolArgs.editingLayerId) {
      if (toolArgs.text && toolArgs.placeholderUntouched !== true) textDraftKey = JSON.stringify(toolArgs);
    } else {
      const activeLayer = layers[toolArgs.editingLayerId];
      const originalArgs =
        activeLayer?.source?.kind === 'tool' && isTextToolArgs(activeLayer.source.args)
          ? activeLayer.source.args
          : null;
      const originalEditorRect = activeLayer ? textLayerEditTarget(activeLayer, documentFrame)?.args.rect : undefined;
      if (
        originalArgs &&
        (textDraftContentKey(toolArgs) !== textDraftContentKey(originalArgs) ||
          (originalEditorRect && !sameTextRect(toolArgs.rect, originalEditorRect)))
      ) {
        textDraftKey = JSON.stringify(toolArgs);
      }
    }
  }
  const hasUnsavedWork = hasUnsavedChanges || textDraftKey !== '';

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

  const { getLayersForAutosave } = useLayers();
  const getLayersForAutosaveRef = useRef(getLayersForAutosave);

  const { setImageFromUpload } = useApp();
  const setImageFromUploadRef = useRef(setImageFromUpload);

  const [autosaveMetadata, setAutosaveMetadata] = useState<AutosaveMetadata | null>(null);
  const [pendingAutosave, setPendingAutosave] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedVersionRef = useRef<string | null>(null);
  const storedVersionRef = useRef<string | null>(null);
  const lastSaveTimeRef = useRef(0);
  const savingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const recoveringRef = useRef(false);
  const prevHadUnsavedWorkRef = useRef(hasUnsavedWork);
  const prevDocumentIdRef = useRef(documentId);
  const performAutosaveRef = useRef<(() => void) | null>(null);
  const storageOperationsRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveGenerationRef = useRef(0);

  const enqueueStorageOperation = useCallback((operation: () => Promise<void>) => {
    const queuedOperation = storageOperationsRef.current.then(operation, operation);
    storageOperationsRef.current = queuedOperation.then(
      () => undefined,
      () => undefined
    );
    return queuedOperation;
  }, []);

  const clearStoredAutosave = useCallback(() => {
    autosaveGenerationRef.current += 1;
    storedVersionRef.current = null;
    return enqueueStorageOperation(async () => {
      await clearAutosave();
      storedVersionRef.current = null;
    });
  }, [enqueueStorageOperation]);

  useLayoutEffect(() => {
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
    getLayersForAutosaveRef.current = getLayersForAutosave;
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
    getLayersForAutosave,
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

  const dirtyKey = useVersionedDirtyKey(
    hasImage,
    hasUnsavedChanges,
    documentId,
    branchRevision,
    historyIndex,
    textDraftKey
  );
  const dirtyKeyRef = useRef(dirtyKey);
  const hasUnsavedWorkRef = useRef(hasUnsavedWork);
  useLayoutEffect(() => {
    dirtyKeyRef.current = dirtyKey;
    hasUnsavedWorkRef.current = hasUnsavedWork;
  }, [dirtyKey, hasUnsavedWork]);

  useEffect(() => {
    if (!hasImage) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      prevHadUnsavedWorkRef.current = hasUnsavedWork;
      prevDocumentIdRef.current = documentId;
      return;
    }

    if (!hasUnsavedWork) {
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
        const wasDirty = prevHadUnsavedWorkRef.current;
        const documentChanged = prevDocumentIdRef.current !== documentId;
        if (wasDirty || documentChanged) {
          void clearStoredAutosave().catch((error) => {
            console.error('AutoSave: Failed to clear stored autosave', error);
          });
          setAutosaveMetadata(null);
        }
      }
      prevHadUnsavedWorkRef.current = false;
      prevDocumentIdRef.current = documentId;
      return;
    }

    prevHadUnsavedWorkRef.current = true;
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
  }, [dirtyKey, hasImage, hasUnsavedWork, textDraftKey, autosaveMetadata, documentId, clearStoredAutosave]);

  const performAutosave = useCallback(() => {
    if (recoveringRef.current) return;
    if (!hasUnsavedWorkRef.current) {
      setPendingAutosave(false);
      return;
    }
    if (dirtyKeyRef.current === storedVersionRef.current) {
      setPendingAutosave(false);
      return;
    }
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    savingRef.current = true;
    setPendingAutosave(true);

    const currentDirtyKey = dirtyKeyRef.current;
    const generation = autosaveGenerationRef.current;
    const currentStore = storeRef.current;
    let writeSucceeded = false;
    let autosaveLayers: ReturnType<typeof getLayersForAutosave>;
    try {
      autosaveLayers = getLayersForAutosaveRef.current();
    } catch (error) {
      console.error('AutoSave: Failed to prepare document layers', error);
      savingRef.current = false;
      setPendingAutosave(false);
      return;
    }
    if (!autosaveLayers) {
      savingRef.current = false;
      setPendingAutosave(false);
      return;
    }

    void Promise.resolve()
      .then(() => savePsd(autosaveLayers, currentStore.totalSize, currentStore.documentFrame))
      .then(async (buffer) => {
        if (
          generation !== autosaveGenerationRef.current ||
          currentDirtyKey !== dirtyKeyRef.current ||
          !hasUnsavedWorkRef.current
        ) {
          return;
        }
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
        await enqueueStorageOperation(async () => {
          if (
            generation !== autosaveGenerationRef.current ||
            currentDirtyKey !== dirtyKeyRef.current ||
            !hasUnsavedWorkRef.current
          ) {
            return;
          }
          await saveAutosave({ metadata, buffer });
          if (generation === autosaveGenerationRef.current) {
            storedVersionRef.current = currentDirtyKey;
          }
          writeSucceeded = true;
        });
        if (
          generation === autosaveGenerationRef.current &&
          currentDirtyKey === dirtyKeyRef.current &&
          hasUnsavedWorkRef.current
        ) {
          lastSaveTimeRef.current = Date.now();
          lastSavedVersionRef.current = currentDirtyKey;
        }
      })
      .catch((error) => {
        console.error('AutoSave: Failed to serialize or store document', error);
      })
      .finally(() => {
        savingRef.current = false;
        setPendingAutosave(false);
        const shouldSaveAgain = saveAgainRef.current;
        saveAgainRef.current = false;
        if (
          hasUnsavedWorkRef.current &&
          dirtyKeyRef.current !== storedVersionRef.current &&
          (shouldSaveAgain || writeSucceeded)
        ) {
          performAutosaveRef.current?.();
        }
      });
  }, [enqueueStorageOperation]);

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
      await clearStoredAutosave();
      setAutosaveMetadata(null);
    } catch (error) {
      console.error('AutoSave: Failed to recover document', error);
    } finally {
      recoveringRef.current = false;
      setRecovering(false);
    }
  }, [autosaveMetadata, recovering, clearStoredAutosave]);

  const dismissAutosave = useCallback(async () => {
    await clearStoredAutosave();
    setAutosaveMetadata(null);
  }, [clearStoredAutosave]);

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
