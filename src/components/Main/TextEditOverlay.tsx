import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { domOverlayStyle, resolveTextKind, resolveTextStyle } from '../../tools/text.ts';
import { calculateNewRect } from '../../util/rect.ts';
import { containFit, type ContainDimensions } from '../../util/contain-fit.ts';
import { documentFrameFromSize, documentToCanvasPos } from '../../contexts/document-frame.ts';
import type { Ctx2D } from '../../contexts/general-types.ts';
import { useResizeObserverRAF } from '../../hooks/useResizeObserver.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { isTextToolArgs } from '../../util/typeGuards.ts';
import {
  insertPlainTextAtCaret,
  selectAllIn,
  setTextSelectionOffsets,
  textOffsetAt,
} from '../../util/contenteditable-text.ts';
import { wordBoundaryOffset } from '../../util/string.ts';
import {
  getLayerAffineTransform,
  IDENTITY_AFFINE_TRANSFORM,
  isIdentityAffineTransform,
  multiplyAffineTransforms,
  rotationAffineAroundPoint,
  type AffineTransform,
} from '../../contexts/affine-transform.ts';

/**
 * Photoshop's in-place type editor: a transparent DOM element laid exactly over the type box.
 *
 * **Why an overlay at all.** Clicking inside a text layer to place a caret is not something a
 * `<canvas>` can do. Canvas has no caret, no selection highlight, no character-range hit testing,
 * no IME composition, no clipboard and no native context menu — Adobe's Type tool has all six, and
 * every one of them is a browser primitive. A focusable DOM element over the canvas delegates all
 * of them to the engine that already implements them, and the canvas keeps the one thing only it
 * can do: put the glyphs into the layer.
 *
 * **Why the canvas does not also draw the glyphs while the overlay is up.** Two renderers showing
 * the same string in the same box either agree exactly or show doubled, offset type. They CAN agree
 * exactly — see {@link domOverlayStyle} — but the honest arrangement is that only one of them is
 * visible at a time, so a future divergence is visible as a reflow at commit rather than as
 * permanently doubled ink while typing. The user clicks the glyphs the DOM drew, which is also what
 * makes click-to-place-caret exact by construction rather than by metric agreement.
 *
 * **Why this is a `div[contenteditable]` and not a `<textarea>`.** A textarea's value ignores the
 * element's `white-space` entirely and no author declaration escapes it: MEASURED, headless Chromium
 * 153, `pre-wrap`, `pre-line` and `normal` all rendered the same four lines, `getComputedStyle`
 * reported `pre-line` while the value rendered `pre-wrap`, and the value charges three spaces for a
 * three-space run and `tab-size: 8` for a tab where the canvas charges one space for both. The caret
 * would then land on the DOM's line breaks, which are not the canvas's — wrong by up to a line. A
 * plain `div` under `pre-line` reproduces the canvas rule break-for-break, and
 * `contenteditable="true"` keeps it editable. `contenteditable="plaintext-only"` was measured too
 * and does NOT work: it pins the value to `pre-wrap` internally, so it behaves like a textarea.
 *
 * **What the overlay deliberately does not do.** It does not commit on `blur`. Adobe commits when
 * focus moves to another application and when a panel is clicked, but committing on every blur
 * would end the edit the moment the user reached for the Font Size field, which Adobe lets them do
 * mid-edit. Commit is on: the Commit button, `Ctrl/Cmd+Return`, the keypad `Enter`, `Esc`, a tool
 * switch (through `commitDirtyTool`), and a click elsewhere on the canvas.
 */
export const TextEditOverlay = () => {
  const [{ containerRef, toolOverlayRef, totalSize, documentFrame, toolName, layers }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const { commitDirtyTool } = useLayers();

  const hostRef = useRef<HTMLDivElement>(null);
  const caretOffsetRef = useRef<number | null>(null);

  /**
   * The measuring context, in STATE rather than read from the ref during render.
   *
   * `domOverlayStyle` needs a context to read the font's own ascent and descent off, and the only
   * one there is the live tool overlay. Reading `toolOverlayRef.current` in the render body is the
   * React Compiler's `react-hooks/refs` error — a ref is not render state, and a render that depends
   * on one will not update when it changes. So the context is published into state by the same
   * layout effect that measures the fit, which is the frame in which the canvas is guaranteed to be
   * attached.
   */
  const [measureCtx, setMeasureCtx] = useState<Ctx2D | null>(null);
  useLayoutEffect(() => {
    setMeasureCtx(toolOverlayRef.current?.getContext('2d') ?? null);
  }, [toolOverlayRef]);
  /**
   * Edit mode is DERIVED, and there is no flag anywhere to set.
   *
   * A text tool argument with a box is exactly what "the user is typing into a type layer" means.
   * The string may be empty while the caret remains active, so the box is the edit-mode signal.
   */
  const args = toolName === 'text' && isTextToolArgs(toolArgs) ? toolArgs : null;
  // A draft remains editable after the user deletes every character. The rectangle, not the
  // current string length, is the durable signal that an editor is open.
  const editing = Boolean(args?.rect);

  /**
   * The workspace's contain fit, as state rather than a ref, because the overlay's position IS its
   * style: `useContainScale` publishes a ref because painters read it inside a per-frame loop, and
   * this is not that — a resized workspace has to move the overlay, and a ref cannot schedule the
   * render that moves it.
   *
   * `containFit` is measured against `totalSize`, the DOCUMENT, which is what the workspace canvas
   * is sized in and what the browser letterboxes with `object-contain`. Its `offsetX`/`offsetY` are
   * the letterbox gaps inside the canvas element, and `getLocalCoords` subtracts exactly these two
   * numbers before dividing by `scale`, so the inverse mapping here is the same arithmetic read the
   * other way round.
   */
  const [fit, setFit] = useState<ContainDimensions | null>(null);
  const measure = useCallback(
    (observed?: { width: number; height: number }) => {
      const rect = observed ?? containerRef.current?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height || !totalSize.width || !totalSize.height) return;
      const next = containFit({ width: rect.width, height: rect.height }, totalSize);
      // Compare before publishing, because `containFit` returns a NEW object every call and this
      // runs from a layout effect whose deps include `totalSize`. Publishing unconditionally would
      // re-render on every measurement; if `totalSize` ever arrived as a fresh identity per render —
      // which is exactly what an inline literal in a `useStore` mock does — that re-render would
      // change the dep, re-run the effect, and spin. Four numbers is the whole state.
      setFit((previous) =>
        previous &&
        previous.scale === next.scale &&
        previous.offsetX === next.offsetX &&
        previous.offsetY === next.offsetY
          ? previous
          : next
      );
    },
    [containerRef, totalSize]
  );

  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useResizeObserverRAF(containerRef, (rect) => measure({ width: rect.width, height: rect.height }));

  /**
   * Publish a new string, and re-measure the box it needs.
   *
   * `calculateNewRect` is the same call the options bar's every style control routes through, and
   * for the same reason: the box is the canvas's grow-to-fit box for point type and the user's
   * dragged box for paragraph type, and only this function knows which line breaks each produces.
   * A box left at its previous size would clip the ink the user just typed.
   */
  const publish = useCallback(
    (next: string) => {
      if (!args) return;
      const nextArgs = {
        ...args,
        text: next,
        rect: calculateNewRect({ ...args, text: next }, toolOverlayRef, totalSize),
      };
      if (args.placeholderUntouched) nextArgs.placeholderUntouched = false;
      setToolArgs(nextArgs);
    },
    [args, setToolArgs, toolOverlayRef, totalSize]
  );

  const readCaretOffset = useCallback((host: HTMLElement): number | null => {
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !host.contains(selection.anchorNode))
      return null;
    const before = document.createRange();
    before.selectNodeContents(host);
    before.setEnd(selection.anchorNode!, selection.anchorOffset);
    return before.toString().length;
  }, []);

  const restoreCaretOffset = useCallback((host: HTMLElement, offset: number) => {
    const node = host.firstChild;
    // A CHARACTER offset addresses a text node. Against an element it would be a child index, so
    // `<span>ab</span>` at offset 1 would land after `ab` in tree order — offset 2, not 1.
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const caret = document.createRange();
    caret.setStart(node, Math.min(node.textContent?.length ?? 0, offset));
    caret.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caret);
  }, []);

  /**
   * Keep the element and the model in step, and treat DISAGREEMENT as a new entry.
   *
   * Every keystroke publishes `host.textContent` into the model, so after this component's own
   * effects the element and `args.text` are equal by construction. Disagreement therefore means the
   * model moved without this element — and the only thing that does that is a new placement, because
   * `TextToolArea` commits the open draft and publishes the next box in the SAME batched render, so
   * a naive edit-session flag would never go false and the element would not be unmounted between them. A "have I
   * entered yet" flag gets that wrong: it is already set, so the second box came up unseeded, unfocused
   * and unselected, and typing into it did nothing.
   *
   * So the test is the element's own text against the model's, and seeding is the RESPONSE to a
   * mismatch. That also covers an undo and any future path that re-seeds a draft.
   *
   * The seed is unconditional — this is the only way into edit mode today: the Type tool places a
   * box, the box arrives holding {@link PLACEHOLDER_TEXT}, and Photoshop's "pre-selected so typing
   * replaces it" is a statement about that arrival. Selecting on every entry rather than only on a
   * placeholder entry is also what Adobe does when a type layer is entered from its `T` thumbnail, so
   * the two entries will not want different code.
   *
   * The write is guarded on inequality for a second reason: it runs on EVERY `args.text` change,
   * including the ones this component itself publishes, and rewriting `textContent` moves the caret
   * to the end — which would make typing impossible from the second character onward.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!editing || !host) return;
    const seed = args?.text ?? '';
    if (host.textContent === seed) return;
    host.textContent = seed;
    caretOffsetRef.current = null;
    host.focus();
    selectAllIn(host);
  }, [args?.text, editing]);

  /**
   * Take the caret back when it falls off the world, and only then.
   *
   * The editor is the app's only input while a draft is open, and a `mousedown` on a non-focusable
   * element — `useRect`'s `absolute inset-0` surface, which is a plain `div` — moves focus to
   * `document.body`. From there `useKeyboardEvents`' `isEditableTarget` guard stops covering the
   * document, so the NEXT LETTER runs the single-character tool shortcuts: MEASURED, headless, a
   * draft with text open, one corner drag, then typing `Beta`, gave a committed layer and a switched
   * tool. The user is typing and gets a tool change, with nothing on screen to explain it.
   *
   * **`document.body` and nothing else.** Focus that moved to the options bar, to a panel or to
   * another surface is the user doing something deliberate, and Adobe lets the type edit continue
   * across all of them, so taking the focus back from those would be the bug rather than the fix.
   * A body is not a destination anybody aimed at.
   */
  useEffect(() => {
    if (!editing) return;
    const reclaim = () => {
      const host = hostRef.current;
      if (host && document.activeElement === document.body) host.focus();
    };
    document.addEventListener('focusin', reclaim);
    return () => document.removeEventListener('focusin', reclaim);
  }, [editing]);

  /**
   * Keep the caret offset honest, because `handleInput` TRUSTS it.
   *
   * The cached offset exists to repair Chromium's caret canonicalisation after a hard break, and it
   * is only ever correct for a caret the user positioned with the KEYBOARD. A mouse click inside the
   * box, a double-click word select and a drag selection all move the caret without firing a single
   * key event, so a cache written by `handleKeyUp` keeps the offset from the previous keystroke and
   * `handleInput` then rewrites the element from a position the user never chose: typing `X` after
   * clicking between `c` and `d` in `abcdef` appended it instead, and typing over a double-click
   * selection brought the selected characters BACK. The element is the authority on where a
   * character went; the cache is a repair, and a repair must never be the thing that decides.
   *
   * `selectionchange` is the one event that covers every caret move — click, word select, drag,
   * drop, and the keyboard paths already handled — and it is dispatched as its own task, so it lands
   * before the `input` of the keystroke that follows it. `readCaretOffset` returns `null` for a
   * non-collapsed selection, so a mouse selection leaves the cache null and the reconcile branch is
   * skipped, which is the behaviour Shift+arrow already had.
   */
  useEffect(() => {
    if (!editing) return;
    const sync = () => {
      const host = hostRef.current;
      if (host) caretOffsetRef.current = readCaretOffset(host);
    };
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, [editing, readCaretOffset]);

  /**
   * Adopt whatever the browser put in the element, flattened.
   *
   * The element is `contenteditable="true"` and this handler is the only thing standing between the
   * user and a second source of truth, so it does two jobs: it publishes the text, and it DISCARDS
   * markup. An IME is the ordinary reason a text node becomes a `<span>`; rewriting `textContent`
   * throws the markup away and costs the caret, which is the right trade for a rare event against the
   * wrong one for a common one.
   */
  const handleInput = useCallback(
    (event: FormEvent<HTMLDivElement>) => {
      if ((event.nativeEvent as InputEvent).isComposing) return;
      const host = hostRef.current;
      if (!host) return;
      const input = event.nativeEvent as InputEvent;
      const previous = args?.text ?? '';
      const expectedOffset = caretOffsetRef.current;
      if (input.inputType === 'insertText' && input.data && expectedOffset !== null) {
        const expected = `${previous.slice(0, expectedOffset)}${input.data}${previous.slice(expectedOffset)}`;
        if (expected !== host.textContent) {
          host.textContent = expected;
          restoreCaretOffset(host, expectedOffset + input.data.length);
          publish(expected);
          caretOffsetRef.current = expectedOffset + input.data.length;
          return;
        }
      }
      if (host.children.length > 0) {
        const caret = readCaretOffset(host);
        const flat = host.textContent ?? '';
        host.textContent = flat;
        publish(flat);
        // Rewriting `textContent` throws the caret to the end of the string, so reading it AFTER the
        // write would cache the position the user did not ask for and every later keystroke would
        // land there. MEASURED consequence: a styled drop into the middle of a draft moved the caret
        // to the end for the rest of the session.
        if (caret !== null) restoreCaretOffset(host, caret);
        caretOffsetRef.current = readCaretOffset(host);
        return;
      }
      publish(host.textContent ?? '');
      caretOffsetRef.current = readCaretOffset(host);
    },
    [args?.text, publish, readCaretOffset, restoreCaretOffset]
  );

  /**
   * Paste as plain text.
   *
   * `text/plain` is the whole of the contract. A type layer here has ONE font, ONE size and ONE
   * colour for every character — mixed inline formatting is explicitly out of scope
   * (`TEXT_TOOL_REQUIREMENTS.md` §2) — so honouring the clipboard's rich flavour would produce ink
   * the layer cannot represent and would then be silently flattened on the next input anyway.
   */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const plain = event.clipboardData.getData('text/plain');
      if (!plain) return;
      publish(insertPlainTextAtCaret(event.currentTarget, plain));
      // A keyboard paste is repaired by the `Ctrl/Cmd+V` keyup; a paste from the native context menu
      // fires no key event at all, so without this the next typed character reconciles against the
      // offset from before the paste.
      caretOffsetRef.current = readCaretOffset(event.currentTarget);
    },
    [publish, readCaretOffset]
  );

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.detail < 5) return;
    event.preventDefault();
    selectAllIn(event.currentTarget);
    caretOffsetRef.current = null;
  }, []);

  /**
   * Enter breaks the line; the other three commit.
   *
   * **The split is Adobe's and it is not a preference.** "To begin a new line, press Enter (Windows)
   * or Return (Mac OS)" and, in the same list, "Press Ctrl+Enter (Windows) or Command+Return (Mac
   * OS)" and "Press the Enter key on the numeric keypad"
   * (https://helpx.adobe.com/photoshop/using/creating-type.html). The keypad `Enter` has no
   * modifier and reports `code: 'NumpadEnter'`, which is the only thing that distinguishes it from
   * the main `Enter` that inserts a break.
   *
   * `Esc` COMMITS, which is Adobe's shipped default and not the historical folklore: "Note that the
   * Esc key is set to commit text by default. You can change this to cancel the changes by going to
   * Edit > Preferences > Type … Then uncheck Use Esc key to commit text"
   * (https://helpx.adobe.com/photoshop/using/editing-text.html). There is no preferences store here,
   * so the default is the behaviour.
   *
   * `isComposing` is checked first and NOTHING happens during composition: the IME owns every key
   * for the length of the composition, and committing out from under it would drop the candidate the
   * user was still choosing.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing) return;
      const extendsOneWord =
        event.shiftKey &&
        event.metaKey !== event.ctrlKey &&
        !event.altKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
      if (extendsOneWord) {
        const host = event.currentTarget;
        const selection = window.getSelection();
        if (!selection || !host.contains(selection.anchorNode) || !host.contains(selection.focusNode)) return;
        const anchorOffset = textOffsetAt(host, selection.anchorNode, selection.anchorOffset);
        const focusOffset = textOffsetAt(host, selection.focusNode, selection.focusOffset);
        if (anchorOffset === null || focusOffset === null) return;

        event.preventDefault();
        const nextFocus = wordBoundaryOffset(
          host.textContent ?? '',
          focusOffset,
          event.key === 'ArrowRight' ? 'forward' : 'backward'
        );
        if (nextFocus !== null && setTextSelectionOffsets(host, anchorOffset, nextFocus)) {
          caretOffsetRef.current = null;
        }
        return;
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.nativeEvent.code === 'NumpadEnter') {
          event.preventDefault();
          commitDirtyTool();
          return;
        }
        event.preventDefault();
        const before = caretOffsetRef.current ?? readCaretOffset(event.currentTarget);
        // A non-collapsed selection means there is no cached offset to restore, and restoring one
        // would clobber the very selection the break is meant to replace.
        if (before !== null) restoreCaretOffset(event.currentTarget, before);
        publish(insertPlainTextAtCaret(event.currentTarget, '\n'));
        // READ the post-insert caret rather than asserting it. With a selection over `cd` in
        // `abcdef` the break lands at 2 and the caret at 3, while `before + 1` from a null cache
        // would have claimed 1 and put the next character in the middle of the word.
        caretOffsetRef.current = readCaretOffset(event.currentTarget);
        return;
      }
      if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || event.key === 'Escape') {
        event.preventDefault();
        commitDirtyTool();
      }
    },
    [commitDirtyTool, publish, readCaretOffset, restoreCaretOffset]
  );

  const handleKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Mid-composition the model still holds the pre-composition string while the element holds the
      // candidate, so a cached offset measured here would be measured against text the next `input`
      // reconciles against something else. `handleKeyDown` already refuses during composition; the
      // two handlers must agree about it.
      if (event.nativeEvent.isComposing) return;
      caretOffsetRef.current = readCaretOffset(event.currentTarget);
    },
    [readCaretOffset]
  );

  if (!editing) return null;

  // `editing` is a boolean stored in a variable, so the narrowing `isTextToolArgs` performed above
  // has to be re-established before reading the draft rectangle.
  if (!args?.rect) return null;
  const rect = args.rect;
  const style = resolveTextStyle(args);
  const scale = fit?.scale ?? 1;

  const editLayerId = args.editingLayerId;
  const editLayer = editLayerId ? layers[editLayerId] : undefined;
  const layerAffine = editLayer ? getLayerAffineTransform(editLayer) : IDENTITY_AFFINE_TRANSFORM;
  const hasNonIdentityAffine = !isIdentityAffineTransform(layerAffine);
  const hasAngle = args.angle !== undefined && args.angle !== 0;
  const editLayerCanvasPos = editLayer
    ? documentToCanvasPos(editLayer.pos, documentFrame ?? documentFrameFromSize(totalSize))
    : null;
  const localTextRect = editLayerCanvasPos
    ? {
        x1: rect.x1 - editLayerCanvasPos.x,
        y1: rect.y1 - editLayerCanvasPos.y,
        x2: rect.x2 - editLayerCanvasPos.x,
        y2: rect.y2 - editLayerCanvasPos.y,
      }
    : rect;

  // Compose the layer affine with the text's own angle into a single CSS matrix.
  // On canvas, `renderText` applies the angle around the rect centre, then
  // `drawEvaluatedPresentation` applies the layer affine on top. In CSS, the
  // rightmost function runs first, so angle (inner) is composed under the affine.
  // The affine acts in layer-local pixels; the element lives in CSS pixels scaled
  // by `fit.scale`, so its translation is converted after adjusting for the
  // element's current local origin.
  // The linear part (a,b,c,d) is dimensionless and needs no scaling.
  // `transformOrigin: '0 0'` keeps the matrix relative to the current text box.
  let transformStr: string | undefined;
  if (hasNonIdentityAffine) {
    let matrix: AffineTransform = layerAffine;
    if (hasAngle && args.angle !== undefined) {
      const centerX = (localTextRect.x1 + localTextRect.x2) / 2;
      const centerY = (localTextRect.y1 + localTextRect.y2) / 2;
      const angleRad = (args.angle * Math.PI) / 180;
      const angleMatrix = rotationAffineAroundPoint(angleRad, { x: centerX, y: centerY });
      matrix = multiplyAffineTransforms(layerAffine, angleMatrix);
    }
    const originX = localTextRect.x1;
    const originY = localTextRect.y1;
    const textBoxMatrix = {
      ...matrix,
      e: matrix.a * originX + matrix.c * originY + matrix.e - originX,
      f: matrix.b * originX + matrix.d * originY + matrix.f - originY,
    };
    transformStr = `matrix(${textBoxMatrix.a},${textBoxMatrix.b},${textBoxMatrix.c},${textBoxMatrix.d},${textBoxMatrix.e * scale},${textBoxMatrix.f * scale})`;
  } else if (hasAngle && args.angle !== undefined) {
    transformStr = `rotate(${args.angle}deg)`;
  }

  return (
    <div
      ref={hostRef}
      id="text-edit-overlay"
      data-testid="text-edit-overlay"
      data-text-kind={resolveTextKind(args)}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Type layer text"
      spellCheck={false}
      onInput={handleInput}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onClick={handleClick}
      style={{
        pointerEvents: 'auto',
        position: 'absolute',
        left: `${(fit?.offsetX ?? 0) + rect.x1 * scale}px`,
        top: `${(fit?.offsetY ?? 0) + rect.y1 * scale}px`,
        width: `${(rect.x2 - rect.x1) * scale}px`,
        height: `${(rect.y2 - rect.y1) * scale}px`,
        transform: transformStr,
        transformOrigin: hasNonIdentityAffine ? '0 0' : 'center center',
        boxSizing: 'border-box',
        margin: 0,
        border: 'none',
        outline: 'none',
        boxShadow: 'none',
        background: 'transparent',
        // Visible, not hidden, and the asymmetry is the point: a box has to CONTAIN its ink, and a
        // box whose leading is under the font's own ascent puts the first line's ink above its own
        // top edge. Clipping it would show less type than Photoshop shows, and the paragraph box is
        // allowed to overflow in Adobe anyway — that is what the overflow icon reports.
        overflow: 'visible',
        ...domOverlayStyle(measureCtx, style, scale),
      }}
    />
  );
};
