import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type TouchSliderProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  /** The visible track height already used by this control on a fine pointer. */
  trackHeight?: 4 | 6;
};

/**
 * A native range input that gets a touch-sized hit box on tablets without changing
 * each caller's existing fine-pointer sizing or visual track.
 *
 * The range input remains the interactive element so keyboard behavior, labels,
 * value constraints, and native change/input events keep their existing semantics.
 */
export const TouchSlider = forwardRef<HTMLInputElement, TouchSliderProps>(
  ({ trackHeight = 6, className, ...inputProps }, ref) => (
    <input
      {...inputProps}
      ref={ref}
      type="range"
      className={`toolbar-touch-slider toolbar-touch-slider--${trackHeight}px ${className ?? ''}`.trim()}
    />
  )
);

TouchSlider.displayName = 'TouchSlider';
