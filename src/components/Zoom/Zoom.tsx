import React, { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';

const Zoom: React.FC = () => {
  const { originalImage, zoomData, setZoomData } = useContext(ImageContext);

  const handleZoomChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setZoomData({ ...zoomData, zoom: Number(event.target.value) });
  };

  // const handleResetZoom = () => {
  //   setZoom(1);
  // };

  const { zoom } = zoomData;

  return (
    <div className={`mt-4 ${originalImage ? '' : 'opacity-50'}`}>
      <label htmlFor="zoom-slider" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Zoom level
      </label>
      <input
        id="zoom-slider"
        disabled={!originalImage}
        type="range"
        min="0.05"
        max="8"
        step="0.05"
        value={zoom}
        onChange={handleZoomChange}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700 disabled:cursor-not-allowed"
      />
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Zoom: <b className="text-gray-900 dark:text-gray-200">{Math.round(zoom * 100)}%</b>
      </div>
      {/*<button className="mt-3 rounded bg-gray-600 px-2 py-1 text-sm text-white" onClick={handleResetZoom}>*/}
      {/*  Reset Zoom*/}
      {/*</button>*/}
    </div>
  );
};

export default Zoom;
