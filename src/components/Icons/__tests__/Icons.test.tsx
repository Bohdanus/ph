import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DragHandleIcon } from '../DragHandleIcon.tsx';
import { EyeIcon } from '../EyeIcon.tsx';
import { TrashIcon } from '../TrashIcon.tsx';

function svgOf(container: HTMLElement) {
  return container.querySelector('svg') as SVGSVGElement;
}

describe('EyeIcon', () => {
  it('hides itself from assistive technology because the parent button carries the label', () => {
    const { container } = render(<EyeIcon open />);
    expect(svgOf(container)).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[role]')).toBeNull();
  });

  it('renders a two-path open eye and no strike-through path', () => {
    const { container } = render(<EyeIcon open />);
    const svg = svgOf(container);

    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.querySelector('path')?.getAttribute('d')).toContain('M2.3 12s3.3-7 9.7-7');
    expect(svg.innerHTML).not.toContain('M3 3l18 18');
  });

  it('renders a three-path closed eye including the diagonal strike', () => {
    const { container } = render(<EyeIcon open={false} />);
    const svg = svgOf(container);

    expect(svg.querySelectorAll('path')).toHaveLength(3);
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M3 3l18 18');
    expect(svg.querySelector('path')?.getAttribute('stroke-linecap')).toBe('round');
  });

  it('distinguishes the two variants so the visibility state is visible in the DOM', () => {
    const { container: open } = render(<EyeIcon open />);
    const { container: closed } = render(<EyeIcon open={false} />);

    expect(svgOf(open).innerHTML).not.toBe(svgOf(closed).innerHTML);
  });
});

describe('TrashIcon', () => {
  it('hides itself from assistive technology', () => {
    const { container } = render(<TrashIcon />);
    expect(svgOf(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a pointer-styled enabled trash glyph', () => {
    const { container } = render(<TrashIcon />);
    const svg = svgOf(container);

    expect(svg).toHaveStyle({ cursor: 'pointer' });
    expect(svg.style.opacity).toBe('');
    expect(svg.querySelectorAll('path')).toHaveLength(4);
  });

  it('renders a dimmed not-allowed glyph when disabled', () => {
    const { container } = render(<TrashIcon disabled />);
    const svg = svgOf(container);

    expect(svg).toHaveStyle({ cursor: 'not-allowed', opacity: '0.1' });
  });
});

describe('DragHandleIcon', () => {
  it('hides itself from assistive technology', () => {
    const { container } = render(<DragHandleIcon />);
    expect(svgOf(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a grab cursor for the draggable state', () => {
    const { container } = render(<DragHandleIcon />);
    const svg = svgOf(container);

    expect(svg).toHaveStyle({ cursor: 'grab' });
    expect(svg.style.opacity).toBe('');
    expect(svg.querySelectorAll('path')).toHaveLength(3);
  });

  it('renders a not-allowed dimmed glyph while the handle is being dragged', () => {
    const { container } = render(<DragHandleIcon disabled />);
    const svg = svgOf(container);

    expect(svg).toHaveStyle({ cursor: 'not-allowed', opacity: '0.1' });
  });

  it('is not exposed to the accessibility tree as a labelled graphic', () => {
    render(<DragHandleIcon />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
