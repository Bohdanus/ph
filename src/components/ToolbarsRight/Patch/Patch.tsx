import React from 'react';

import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import type { PatchToolArgs } from '../../../tools/patch.ts';

const Patch: React.FC = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const args = getToolArgs('patch') as PatchToolArgs | null;

  if (!args) return null;

  return (
    <div className="flex h-full items-center gap-3 text-xs">
      <label htmlFor="patch-mode">Patch</label>
      <select id="patch-mode" value="source" disabled>
        <option value="source">Source</option>
      </select>
      <label htmlFor="patch-diffusion">Diffusion</label>
      <input
        id="patch-diffusion"
        type="range"
        min="1"
        max="7"
        step="1"
        value={args.diffusion}
        onChange={(event) => patchToolArgs('patch', { diffusion: Number(event.target.value) })}
      />
      <span>{args.diffusion}</span>
    </div>
  );
};

export default Patch;
