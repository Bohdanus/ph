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
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog.tsx';
import { useStore } from './StoreContext.tsx';
import { hasDiscardableWork } from '../util/document-dirty.ts';

/**
 * Which replacement the user is about to perform. The prompt's copy is the message the
 * six native `window.confirm()` calls already used, moved here verbatim: the decision
 * being asked of the user has not changed, only the widget it is asked with.
 */
export type DiscardReason = 'new-document' | 'open-document';

interface DiscardPrompt {
  title: string;
  message: string;
  confirmLabel: string;
}

const DISCARD_PROMPTS: Record<DiscardReason, DiscardPrompt> = {
  'new-document': {
    title: 'New Image',
    message: 'Discard unsaved changes and start a new image?',
    confirmLabel: 'Discard',
  },
  'open-document': {
    title: 'Open Image',
    message: 'Discard unsaved changes and open another file?',
    confirmLabel: 'Discard',
  },
};

export interface UnsavedChangesContextType {
  /**
   * Whether replacing the document right now would destroy work. A FUNCTION, not a value:
   * two of the three inputs are refs that change without a render, so a boolean captured
   * at render would be stale for exactly the cases — a live tool drag, a half-pulled
   * slider — that it exists to catch.
   */
  isDocumentDirty: () => boolean;
  /**
   * Resolves `true` when it is safe to replace the document, `false` when the user
   * declined. Resolves `true` immediately when there is nothing to lose, so a caller
   * needs no dirty check of its own and cannot forget the "no document" case.
   */
  confirmDiscard: (reason: DiscardReason) => Promise<boolean>;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | undefined>(undefined);

/**
 * Owns the app's one definition of "this document has work in it" and the two places it
 * is acted on: the unload guard, and the prompt in front of a document replacement.
 *
 * It exists because both answers were previously assembled at each call site. Five call
 * sites across three components each spelled out
 * `hasUnsavedChanges || hasPendingText(currentArgs.current)`, which is a predicate that has
 * to be extended in five places the next time an editor gains a way to hold work — and,
 * having been missed once already, a way it still does: a live tool transaction.
 */
export const UnsavedChangesProvider = ({ children }: PropsWithChildren) => {
  const [{ currentArgs, hasImage, hasUnsavedChanges, previewLayers }] = useStore();
  const [prompt, setPrompt] = useState<DiscardReason | null>(null);
  const resolverRef = useRef<((answer: boolean) => void) | null>(null);

  // Both refs are read HERE rather than captured into the callback's dependency list,
  // because a tool mid-drag writes `previewLayers` and `currentArgs` without dispatching
  // anything: nothing re-renders, so a captured value would still read empty for the whole
  // gesture. The two store booleans have no such ref, so they come from this render — the
  // store cannot change without re-rendering its own consumer.
  const isDocumentDirty = useCallback(
    () =>
      hasDiscardableWork({
        hasImage,
        hasUnsavedChanges,
        currentArgs: currentArgs.current,
        pendingPreviewCount: Object.keys(previewLayers.current).length,
      }),
    [currentArgs, hasImage, hasUnsavedChanges, previewLayers]
  );

  // Tab close, reload, back/forward, and following a link away. The browser supplies the
  // dialog and its own copy — the text is not ours to choose and Chrome, Safari and
  // Firefox each word it differently — so the only thing this handler can do is decide
  // whether to set `returnValue` at all, which is what makes the prompt appear.
  //
  // The listener is re-registered whenever the dirty signals change rather than once
  // against a ref, because the ref bought nothing: it lagged the render it was syncing
  // from, and it made a store that changed without re-rendering read as clean. The store
  // dispatches on discrete events and never per pointer-move, so re-attaching is not a
  // per-frame cost.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDocumentDirty()) return;
      event.preventDefault();
      // The empty string, not a message: it is a legacy no-op flag that every engine
      // still requires, and any text a browser does show is its own, not this string's.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDocumentDirty]);

  // Answering in one place, and answering exactly once: the resolver is nulled as it is
  // called, so a backdrop click that also lands on the panel's own teardown cannot
  // resolve the promise a second time.
  const answer = useCallback((value: boolean) => {
    setPrompt(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  const confirmDiscard = useCallback(
    (reason: DiscardReason) => {
      if (!isDocumentDirty()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setPrompt(reason);
      });
    },
    [isDocumentDirty]
  );

  const value = useMemo(() => ({ isDocumentDirty, confirmDiscard }), [isDocumentDirty, confirmDiscard]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      {prompt && (
        <ConfirmDialog {...DISCARD_PROMPTS[prompt]} onConfirm={() => answer(true)} onCancel={() => answer(false)} />
      )}
    </UnsavedChangesContext.Provider>
  );
};

export const useUnsavedChanges = (): UnsavedChangesContextType => {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  }
  return ctx;
};
