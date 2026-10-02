import { type RefObject, useEffect, useRef } from 'react';
import { POINT_TYPE_MAX_DRAG_PX, renderText, type TextToolArgs, type TextKind } from '../../tools/text.ts';
import { useRect } from '../../hooks/useRect.ts';
import { calculateNewRect } from '../../util/rect.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RectXY, RectXYSorted } from '../../contexts/general-types.ts';

type TextToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const TextToolArea = ({ className, overlayCtxRef }: TextToolAreaProps) => {
  const [{ containerRef, textareaRef, toolOverlayRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as TextToolArgs;
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  const { rectHandles, pointerHandlers } = useRect({
    imageSize: totalSize,
    initialRect: args.rect,
    containerRef,
    overlayRef: toolOverlayRef,
    onRepaint: redrawText,
    onChangeEnd: (rect: RectXYSorted) => {
      // Adobe distinguishes the two gestures by intent and documents no threshold, so this is the
      // app's own: a press that travelled no more than POINT_TYPE_MAX_DRAG_PX on either axis is a
      // click and places point type, and anything further is a drag and places paragraph type.
      // The click's rect is collapsed to zero width, which is what `adjustFreePoint` already
      // produces for a press with no movement, so the point-type box is grown from the click point
      // by the same code path that always grew it.
      const isClick = rect.x2 - rect.x1 <= POINT_TYPE_MAX_DRAG_PX && rect.y2 - rect.y1 <= POINT_TYPE_MAX_DRAG_PX;
      const kind: TextKind = isClick ? 'point' : 'paragraph';
      const placed: RectXYSorted = isClick ? { ...rect, x1: rect.x1, x2: rect.x1, y1: rect.y1, y2: rect.y1 } : rect;

      const newRect = calculateNewRect({ ...args, rect: placed, kind }, toolOverlayRef, totalSize);
      if (!newRect) return;

      const newArgs = { ...args, rect: newRect, kind };
      setToolArgs(newArgs);

      textareaRef.current?.focus();
    },
  });

  useEffect(() => {
    textareaRef.current?.focus();
  }, [textareaRef, toolArgs.toolName]);

  useEffect(() => {
    if (args.text) {
      rectHandles.redraw();
    }
  }, [args.text, rectHandles.redraw]);

  function redrawText(rect: RectXY) {
    const currentArgs = argsRef.current;
    if (!currentArgs.text) return;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    renderText(ctx, { ...currentArgs, rect }, { overflowIndicator: true });
  }

  // function handleBeforeInput(e: React.FormEvent<HTMLDivElement>) {
  //   const inputEvent = (e as any).nativeEvent as InputEvent;
  //   if (!args.rect) return;
  //
  //   if (inputEvent.inputType === 'insertText' || inputEvent.inputType === 'insertCompositionText') {
  //     // during IME composition, browser will fire composition events instead
  //     if (isComposingRef.current && inputEvent.inputType === 'insertText') return;
  //
  //     if (inputEvent.data) {
  //       textRef.current[posInTextRef.current.y] += inputEvent.data; // todo insert at x
  //       const text = textRef.current.join('\n');
  //       const newArgs = { ...args, text };
  //       updateLastHistoryItem({ args: newArgs });
  //     }
  //     e.preventDefault();
  //   }
  // }

  // function handleCompositionStart(e: CompositionEvent<HTMLDivElement>) {
  //   isComposingRef.current = true;
  // }
  //
  // function handleCompositionEnd(e: CompositionEvent<HTMLDivElement>) {
  //   isComposingRef.current = false;
  // }
  //
  // function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  //   if (!args.rect) return;
  //
  //   // Ignore shortcuts
  //   if (e.ctrlKey || e.metaKey || e.altKey) return;
  //
  //   const text = textRef.current;
  //   const pos = posInTextRef.current;
  //
  //   if (e.key === 'Enter') {
  //     text.splice(pos.y, 0, '');
  //     pos.x = 0;
  //     pos.y += 1;
  //     e.preventDefault();
  //   } else if (e.key === 'Backspace') {
  //     const newString = deleteCharAt(text[pos.y], pos.x);
  //     pos.x = Math.max(0, pos.x - 1);
  //     if (newString === '') {
  //       text.splice(pos.y, 1);
  //       pos.y = Math.max(0, pos.y - 1);
  //       if (text.length === 0) {
  //         textRef.current = [''];
  //       }
  //     } else {
  //       text[pos.y] = newString;
  //     }
  //     e.preventDefault();
  //   } else if (e.key === 'Escape' && confirm('Clear the text?')) {
  //     // Cancel text input
  //     textRef.current = [''];
  //     pos.x = 0;
  //     pos.y = 0;
  //     // } else if (e.key === 'ArrowUp') {
  //     //   pos.y = Math.max(0, pos.y - 1);
  //     // } else if (e.key === 'ArrowDown') {
  //     //   pos.y = Math.min(pos.y + 1, text.length - 1);
  //     // } else if (e.key === 'ArrowLeft') {
  //     //   pos.x = Math.max(0, pos.x - 1);
  //     // } else if (e.key === 'ArrowRight') {
  //     //   pos.x = Math.max(pos.x + 1, charLength(text[pos.y]) - 1);
  //   } else {
  //     // Allow other key combinations (like Ctrl+C, Ctrl+V, etc.)
  //     return;
  //   }

  //   const newText = textRef.current.join('\n');
  //   const newArgs = { ...args, text: newText };
  //   updateLastHistoryItem({ args: newArgs });
  // }

  return <div className={`${className} cursor-text`} {...pointerHandlers} />;
};
