import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import type { ToolName } from './tool-types.ts';
import { getHighlightedToolsForStep } from '../components/Common/FirstUseTour.tsx';

/**
 * First-use tour state, shared between the tour overlay and the sidebar so the
 * sidebar can highlight the tile the tour currently points at.
 *
 * The tour calls `setCurrentStepIndex` to report progress; the sidebar reads
 * `highlightedTools` to apply a pulsing ring to the right tile.
 */
type FirstUseContextValue = {
  /** The current step index, or null when no tour is active. */
  currentStepIndex: number | null;
  /** The tools the current step points at, for tile pulsing. */
  highlightedTools: ToolName[];
  /** Set the active step, or null to deactivate. */
  setCurrentStepIndex: Dispatch<SetStateAction<number | null>>;
};

const FirstUseContext = createContext<FirstUseContextValue | undefined>(undefined);

export const useFirstUseContext = (): FirstUseContextValue => {
  const context = useContext(FirstUseContext);
  if (context === undefined) {
    return {
      currentStepIndex: null,
      highlightedTools: [],
      setCurrentStepIndex: () => {},
    };
  }
  return context;
};

export const FirstUseProvider = ({ children }: { children: ReactNode }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);

  const value = useMemo(
    () => ({
      currentStepIndex,
      highlightedTools: currentStepIndex !== null ? getHighlightedToolsForStep(currentStepIndex) : [],
      setCurrentStepIndex,
    }),
    [currentStepIndex]
  );

  return <FirstUseContext.Provider value={value}>{children}</FirstUseContext.Provider>;
};
