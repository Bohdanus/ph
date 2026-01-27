import React from 'react';
import type { ToolArgs, UpdateHistoryFn } from '../../contexts/ImageContext.tsx';

export type ToolbarRightComponent = React.FC<{
  args: ToolArgs;
  onChange: ((args: ToolArgs) => void) | ((params: UpdateHistoryFn) => void);
}>;
