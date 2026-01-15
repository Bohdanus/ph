import React, { useMemo, useEffect } from 'react';
import { throttle } from 'lodash-es';
import { THROTTLE_TIME } from '../../../constants';

import UndoButton from '../../Common/UndoButton.tsx';

interface BlurToolbarProps {
  args: { radius?: number };
  onChange: (args: { radius: number }) => void;
}

const Blur: React.FC<BlurToolbarProps> = ({ args, onChange }) => {
  const throttledOnChange = useMemo(() => throttle(onChange, THROTTLE_TIME), [onChange]);

  useEffect(() => {
    return () => {
      throttledOnChange.cancel();
    };
  }, [throttledOnChange]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ radius: Number(event.target.value) });
  };
  const { radius } = args;
  const hasDefaultValues = radius === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label htmlFor="blur-slider" className="text-sm font-medium text-gray-700">
          Blur Radius
        </label>
        <input
          id="blur-slider"
          type="range"
          min="0"
          max="100"
          value={radius}
          onChange={handleChange}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200"
        />
        <span className="text-sm text-gray-600">
          Radius: <b className="text-gray-900">{radius}px</b>
        </span>
      </div>

      <UndoButton disabled={hasDefaultValues} text="Undo Blur" />
    </div>
  );
};

export default Blur;
