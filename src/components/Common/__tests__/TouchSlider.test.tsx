import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TouchSlider } from '../TouchSlider.tsx';

describe('TouchSlider', () => {
  it('forwards native range props, the requested track size, and its input ref', () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();

    render(
      <TouchSlider
        ref={ref}
        id="rotation"
        aria-label="Rotation angle"
        min={-90}
        max={90}
        step={1}
        value={-15}
        onChange={onChange}
        trackHeight={4}
        className="w-20 cursor-pointer"
      />
    );

    const slider = screen.getByRole('slider', { name: 'Rotation angle' });
    expect(slider).toHaveAttribute('id', 'rotation');
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '-90');
    expect(slider).toHaveAttribute('max', '90');
    expect(slider).toHaveAttribute('step', '1');
    expect(slider).toHaveValue('-15');
    expect(slider).toHaveClass('toolbar-touch-slider', 'toolbar-touch-slider--4px', 'w-20', 'cursor-pointer');
    expect(ref.current).toBe(slider);

    fireEvent.change(slider, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: slider, type: 'change' }));
  });

  it('uses the existing six-pixel track size by default', () => {
    render(<TouchSlider aria-label="Size" min={1} max={100} value={12} onChange={() => {}} />);

    expect(screen.getByRole('slider', { name: 'Size' })).toHaveClass('toolbar-touch-slider--6px');
  });
});
