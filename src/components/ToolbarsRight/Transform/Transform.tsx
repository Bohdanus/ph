import React, { useContext } from 'react';
import './Transform.scss';
// import UndoButton from '../../Common/UndoButton.tsx';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import type { TransformToolType } from '../../../tools/transform.ts';

interface TransformToolbarProps {
  args: TransformToolType;
  onChange: (args: TransformToolType) => void;
}

const Transform: React.FC<TransformToolbarProps> = ({ args, onChange }) => {
  const { crop, setCrop, size, startEmptyTool } = useContext(ImageContext);

  const { rotate, mirrorH, mirrorV } = args;

  function compensateCropCorners({ rotate: newRotate, mirrorV: newMirrorV, mirrorH: newMirrorH }: TransformToolType) {
    if (!crop) return;

    const prevWidth = size.width;
    const prevHeight = size.height;

    const angle = ((newRotate - rotate) * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(angle));
    const absSin = Math.abs(Math.sin(angle));

    // image expands if rotated
    const newWidth = Math.round(prevWidth * absCos + prevHeight * absSin);
    const newHeight = Math.round(prevWidth * absSin + prevHeight * absCos);

    const scaleX = newWidth / prevWidth;
    const scaleY = newHeight / prevHeight;

    // compensate resize after rotation corners
    let { x, y, width, height } = crop;

    x *= scaleX;
    y *= scaleY;
    width *= scaleX;
    height *= scaleY;

    if (mirrorH !== newMirrorH) {
      x = width - x;
    }
    if (mirrorV !== newMirrorV) {
      y = height - y;
    }

    setCrop({ x, y, width, height });
  }

  const handleOnChange = (newArgs: TransformToolType) => {
    compensateCropCorners(newArgs);
    onChange(newArgs);
  };

  const handleRotateLeft = () => {
    let newRotate = rotate - 90;
    if (newRotate < 0) newRotate += 360;
    handleOnChange({ rotate: newRotate, mirrorH, mirrorV });
  };

  const handleRotateRight = () => {
    let newRotate = rotate + 90;
    if (newRotate >= 360) newRotate -= 360;
    handleOnChange({ rotate: newRotate, mirrorH, mirrorV });
  };

  const handleRotateSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newRotate = Number(event.target.value);
    handleOnChange({ rotate: newRotate, mirrorH, mirrorV });
  };

  const toggleMirrorH = () => {
    handleOnChange({ rotate, mirrorH: !mirrorH, mirrorV });
  };

  const toggleMirrorV = () => {
    handleOnChange({ rotate, mirrorH, mirrorV: !mirrorV });
  };

  // todo add some stratching and free transform
  // const hasDefaultTransform = isEqual(args, defaultSettings.transform);

  return (
    <div className="transform-toolbar">
      <div className="button-group">
        <label>Rotate</label>
        <div className="buttons">
          <button onClick={handleRotateLeft} title="Rotate Left">
            ↺
          </button>
          <button onClick={handleRotateRight} title="Rotate Right">
            ↻
          </button>
        </div>
      </div>

      <div className="slider-group">
        <label htmlFor="rotate-slider">Rotate Degree</label>
        <input
          id="rotate-slider"
          type="range"
          min={-90}
          max={90}
          value={rotate}
          onChange={handleRotateSliderChange}
          className="transform-slider"
        />
        <span>
          <b>{rotate}°</b>
        </span>
        <span
          style={{ cursor: 'pointer', color: '#007bff' }}
          onClick={() => handleOnChange({ rotate: 0, mirrorH, mirrorV })}
        >
          Reset
        </span>
      </div>

      <div className="button-group">
        <label>Mirror</label>
        <div className="buttons">
          <button className={mirrorH ? 'active' : ''} onClick={toggleMirrorH} title="Mirror Horizontal">
            ↔
          </button>
          <button className={mirrorV ? 'active' : ''} onClick={toggleMirrorV} title="Mirror Vertical">
            ↕
          </button>
        </div>
      </div>

      {/*<UndoButton disabled={hasDefaultTransform} text="Reset" />*/}
      <hr />

      <button
        className="btn btn-primary w-100 mt-3"
        disabled={!crop || crop.width === 0 || crop.height === 0}
        onClick={() => startEmptyTool('transform') /* this will apply current setting as a history item */}
      >
        Apply Crop
      </button>

      <button className="btn btn-outline-secondary w-100 mt-2" disabled={!crop} onClick={() => setCrop(null)}>
        Clear Crop
      </button>
    </div>
  );
};

export default Transform;
