import { type RefObject, useEffect, useRef } from 'react';
import { renderText, type TextToolArgs } from '../../tools/text.ts';
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
      const newRect = calculateNewRect({ ...args, rect }, toolOverlayRef, totalSize);
      if (!newRect) return;

      const newArgs = { ...args, rect: newRect };
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

    renderText(ctx, { ...currentArgs, rect });
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
