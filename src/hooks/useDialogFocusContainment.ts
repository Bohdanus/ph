import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

/**
 * Focus ownership for a modal dialog panel: the app's whole shortcut layer is one
 * document-level keydown listener whose only suppression test is `isEditableTarget`, which
 * is true for textarea, contenteditable, text-like inputs and select. A button is not
 * text-like, and `<body>` is not either, so a dialog has to own its keyboard — focus must
 * start on a text-like control, no keydown from inside it may reach document, and focus
 * must never end up outside the panel, because a keydown from outside is invisible to the
 * overlay's own React handler and so both Tab and Cmd+Z would escape while the dialog is
 * still up.
 *
 * This module is the single implementation of that. `SaveDialog` and `NewImageDialog`
 * both take their behaviour from it, and it takes SaveDialog's, which is the corrected
 * one: a `<body>`-targeted Escape is dispatched to `onEscape` rather than swallowed, and
 * the Tab wrap only ever lands on a control that accepts focus.
 */
const TEXT_LIKE_FOCUSABLE = 'select, textarea, input[type="number"], input[type="text"], input:not([type])';
const ANY_FOCUSABLE = 'select, input, textarea, button, [tabindex]:not([tabindex="-1"])';

/**
 * Re-queried per keystroke rather than read once at mount: dialogs grow and shrink their
 * controls while they are open (a quality slider appears with the format, a DPI field with
 * the preset), so the wrap points move under a dialog that never re-renders the hook.
 *
 * Filtered to controls that accept focus. A wrap endpoint has to accept it: `focus()` on a
 * disabled control is a no-op in a real browser and in jsdom, so wrapping to one would eat
 * the keystroke AND leave focus where it was — which strands the dialog with no forward or
 * backward route to any of the controls in between.
 */
const enabledFocusables = (panel: HTMLElement) =>
  [...panel.querySelectorAll<HTMLElement>(ANY_FOCUSABLE)].filter((element) => !element.hasAttribute('disabled'));

/**
 * Focus has to land on a real control inside the panel, so every candidate is checked
 * rather than assumed to accept it. The control the user was on comes first — a recovery
 * that always fell to the first focusable would teleport the user to the close button
 * every time the dialog lost focus — but it can itself have become disabled, and so can
 * the head of the walk, so neither is trusted without the containment check below.
 */
const pullFocusIntoPanel = (panel: HTMLElement, lastFocused: HTMLElement | null) => {
  if (lastFocused && panel.contains(lastFocused)) {
    lastFocused.focus();
    if (panel.contains(document.activeElement)) return;
  }
  for (const candidate of enabledFocusables(panel)) {
    candidate.focus();
    if (panel.contains(document.activeElement)) return;
  }
};

export interface DialogFocusContainment {
  /** Attach to the `role="dialog"` element; every containment check is scoped to it. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Attach to the same element's `onKeyDown`; owns Escape and the Tab wrap. */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * @param onEscape Called when Escape is pressed with focus outside the panel. The hook
 * dispatches nothing and closes nothing itself: whether Escape closes the dialog, saves
 * first, or is a no-op is the caller's decision, and a hook that decided it would be wrong
 * in one of the two dialogs that use it — `NewImageDialog` closes on unmount, while
 * `SaveDialog`'s `onSave` resolves and the CALLER closes it.
 */
export function useDialogFocusContainment({ onEscape }: { onEscape: () => void }): DialogFocusContainment {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  // The mount effect runs once, so it cannot close over a live `onEscape` without
  // capturing the first one the parent passed. The ref is synced after every render, in an
  // effect rather than during render, which is the rule: writing a ref during render is a
  // side effect, and a concurrent render that is thrown away would have left the committed
  // one holding a callback from a render that never happened.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Containment, leg 1: a click on the panel's own non-interactive text (a title, a
    // label with no htmlFor) blurs the focused control and leaves focus on <body>. It
    // dispatches focusout with a null relatedTarget and no focusin at all, so it is this
    // arm, not leg 2, that has to catch it.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && panel.contains(next)) return;
      pullFocusIntoPanel(panel, lastFocusedRef.current);
    };
    // Containment, leg 2: anything that focuses an element outside the panel, whether a
    // programmatic focus steal or a browser restoring focus, is a containment failure.
    // This is also what records the control the user was on, so a recovery lands back
    // where they were instead of on the first focusable.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && panel.contains(target)) {
        if (target instanceof HTMLElement) lastFocusedRef.current = target;
        return;
      }
      pullFocusIntoPanel(panel, lastFocusedRef.current);
    };
    // Containment, leg 3: removing the focused control leaves focus on <body> and fires
    // no focus event at all, and a keydown whose target is outside the panel never
    // reaches the overlay's React handler. So the last line is at the document capture
    // phase, above the app's own document and window listeners, which is also where
    // their keydowns have to die for the same reason they die inside the panel.
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Node && panel.contains(target)) return;
      // Every key from outside the panel is still suppressed against the app's own
      // listeners — that is the point of the capture phase — but Escape has to be
      // dispatched from here too, because a keydown whose target is <body> never reaches
      // the React handler, and a dialog that cannot be closed by keyboard is a trap.
      if (event.key === 'Tab') {
        event.stopPropagation();
        event.preventDefault();
        pullFocusIntoPanel(panel, lastFocusedRef.current);
        return;
      }
      event.stopPropagation();
      if (event.key === 'Escape') onEscapeRef.current();
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    panel.addEventListener('focusout', onFocusOut);

    // Taken last, so leg 2 is already watching and the mount focus becomes the
    // recovery target. Two selectors, because the first focusable in document order is
    // the header close button and autofocusing that would re-open the very hole the
    // focus move closes.
    const textLike = panel.querySelector<HTMLElement>(TEXT_LIKE_FOCUSABLE);
    (textLike ?? panel.querySelector<HTMLElement>(ANY_FOCUSABLE))?.focus();

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      panel.removeEventListener('focusout', onFocusOut);
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Safe here because every app-level keydown listener (document in
    // useKeyboardEvents, window in SidebarLeft, ShapeToolArea and Transform) is an
    // ancestor in the bubble phase, and the dialog is their descendant. Stopping here is
    // what makes the buttons inside the dialog safe too, since a button is not a text-like
    // control and would otherwise re-open the shortcut hole. The only other place a
    // keydown is stopped is the document capture arm above, for a target that never
    // reaches this handler.
    event.stopPropagation();
    if (event.key === 'Escape') {
      onEscapeRef.current();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    const focusables = panel ? enabledFocusables(panel) : [];
    if (!panel || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      pullFocusIntoPanel(panel, lastFocusedRef.current);
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }, []);

  return { panelRef, handleKeyDown };
}
