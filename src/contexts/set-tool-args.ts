import { createContext, useContext } from 'react';
import type { CurrentToolContextState } from './useCurrentTool.tsx';

export const SetToolArgsContext = createContext<CurrentToolContextState['setToolArgs'] | null>(null);

export const useSetToolArgs = (): CurrentToolContextState['setToolArgs'] | null => useContext(SetToolArgsContext);
