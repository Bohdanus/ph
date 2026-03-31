import { type RefObject, useEffect } from 'react';
import { renderText, type TextToolArgs } from '../../tools/text.ts';
import { useRect } from '../../hooks/useRect.ts';
import { calculateNewRect } from '../../util/rect.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RectXY, RectXYSorted } from '../../contexts/general-types.ts';

type TextToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const TextToolArea = ({ className, overlayCtxRef }: TextToolAreaProps) => {
  const [{ containerRef, textareaRef, toolOverlayRef, color, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as TextToolArgs;

  // // because dragging should happen outside react state management
  // const textRef = useRef<string[]>(['']);
  // const posInTextRef = useRef<Point>({ x: 0, y: 0 });
  //
  // const isComposingRef = useRef<boolean>(false);
  // // const composingTextRef = useRef<string>('');

  const pointerEvents = useRect({
    imageSize: totalSize,
    initialRect: args.rect,
    containerRef,
    overlayRef: toolOverlayRef,
    onRepaint: redrawText,
    onChangeEnd: (rect: RectXYSorted) => {
      const newRect = calculateNewRect({ ...args, rect }, toolOverlayRef, totalSize)!;

      const newArgs = { ...args, color, rect: newRect };
      setToolArgs(newArgs);

      textareaRef.current!.focus();
    },
  });

  useEffect(() => {
    textareaRef.current!.focus();
  }, []);

  // this redraws avoiding react re-renders, to achieve high FPS
  function redrawText(rect: RectXY) {
    if (!args.text) return;

    const ctx = overlayCtxRef.current!;

    const _args = { ...args, color, rect };

    renderText(ctx, _args);
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

  return <div className={`${className} cursor-text`} {...pointerEvents} />;
};
