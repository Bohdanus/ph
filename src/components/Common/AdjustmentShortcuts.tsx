import { useStore } from '../../contexts/StoreContext.tsx';
import { useInvertLayer } from '../../hooks/useInvertLayer.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';

/**
 * `mod+I`: `Image ▸ Adjustments ▸ Invert`, which is Adobe's binding for the pixel command.
 * Inverting the selection is `Shift+mod+I` (Select ▸ Inverse), so `shift: false` keeps that
 * chord away from this handler. The bare `I` registrations in `AppKeyboardShortcuts` declare
 * `mod: false`, so the two never compete.
 *
 * `preventDefault` claims the chord from the browser (Page Info in Firefox, italic in an
 * editable host). The provider skips editable targets, so `mod+I` inside a text field still
 * reaches the field.
 */
export const AdjustmentShortcuts = () => {
  const [{ hasImage }] = useStore();
  const { invertActiveLayer } = useInvertLayer();

  useKeyDownShortcut({
    key: 'i',
    mod: true,
    shift: false,
    alt: false,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: () => void invertActiveLayer(),
  });

  return null;
};
