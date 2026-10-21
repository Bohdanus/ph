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

/**
 * First-use tour state, shared between the tour overlay and the sidebar so the
 * sidebar can highlight the tile the tour currently points at.
 *
 * The tour reports the tile identity for its active step; the sidebar reads it
 * to apply a pulsing ring without importing the tour component.
 */
type FirstUseContextValue = {
  /** The toolbar tiles the current step points at. */
  highlightedTools: ToolName[];
  /** Set the highlighted tiles, or clear them when the tour closes. */
  setHighlightedTools: Dispatch<SetStateAction<ToolName[]>>;
};

const FirstUseContext = createContext<FirstUseContextValue | undefined>(undefined);

export const useFirstUseContext = (): FirstUseContextValue => {
  const context = useContext(FirstUseContext);
  if (context === undefined) {
    return {
      highlightedTools: [],
      setHighlightedTools: () => {},
    };
  }
  return context;
};

export const FirstUseProvider = ({ children }: { children: ReactNode }) => {
  const [highlightedTools, setHighlightedTools] = useState<ToolName[]>([]);

  const value = useMemo(() => ({ highlightedTools, setHighlightedTools }), [highlightedTools]);

  return <FirstUseContext.Provider value={value}>{children}</FirstUseContext.Provider>;
};
