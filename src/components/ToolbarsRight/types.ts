import React from 'react';
import type { ToolArgs } from '../../contexts/ImageContext.tsx';

export type ToolbarRightComponent = React.FC<{
  onChange: (args: ToolArgs) => void;
}>;

export type ResizeCb = (width: number, height: number) => void;
