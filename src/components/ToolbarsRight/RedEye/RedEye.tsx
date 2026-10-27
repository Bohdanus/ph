import type { ChangeEvent } from 'react';

import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import {
  RED_EYE_DARKEN_AMOUNT_MAX,
  RED_EYE_DARKEN_AMOUNT_MIN,
  RED_EYE_PUPIL_SIZE_MAX,
  RED_EYE_PUPIL_SIZE_MIN,
  type RedEyeToolArgs,
} from '../../../tools/redEye.ts';

const FIELD_CLASS = 'flex min-w-36 flex-col gap-1 text-[10px] font-medium text-gray-700 dark:text-gray-300';
const SLIDER_CLASS = 'h-1.5 w-36 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

const RedEye = () => {
  const { toolArgs, patchToolArgs } = useCurrentTool();
  const args = toolArgs as RedEyeToolArgs;

  const setPupilSize = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('red-eye', { pupilSize: Number(event.target.value) });
  };
  const setDarkenAmount = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('red-eye', { darkenAmount: Number(event.target.value) });
  };

  return (
    <div className="flex h-full flex-row items-center gap-4">
      <label className={FIELD_CLASS} htmlFor="red-eye-pupil-size">
        <span className="flex justify-between">
          Pupil Size <output>{args.pupilSize}%</output>
        </span>
        <input
          aria-label="Pupil Size"
          className={SLIDER_CLASS}
          id="red-eye-pupil-size"
          type="range"
          min={RED_EYE_PUPIL_SIZE_MIN}
          max={RED_EYE_PUPIL_SIZE_MAX}
          value={args.pupilSize}
          onChange={setPupilSize}
        />
      </label>
      <label className={FIELD_CLASS} htmlFor="red-eye-darken-amount">
        <span className="flex justify-between">
          Darken Amount <output>{args.darkenAmount}%</output>
        </span>
        <input
          aria-label="Darken Amount"
          className={SLIDER_CLASS}
          id="red-eye-darken-amount"
          type="range"
          min={RED_EYE_DARKEN_AMOUNT_MIN}
          max={RED_EYE_DARKEN_AMOUNT_MAX}
          value={args.darkenAmount}
          onChange={setDarkenAmount}
        />
      </label>
    </div>
  );
};

export default RedEye;
