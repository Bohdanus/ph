import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SidebarRight from '../SidebarRight.tsx';

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      hasImage: true,
      toolName: 'draw',
      history: [],
      historyIndex: 0,
      layers: {},
      activeLayerId: null,
    },
  ],
}));

describe('SidebarRight', () => {
  it('renders with image and tool active', () => {
    const { container } = render(<SidebarRight />);
    expect(container).toBeTruthy();
  });
});
