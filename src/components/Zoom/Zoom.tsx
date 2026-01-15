import React, { useContext } from 'react';
import './Zoom.scss';
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
  const style = originalImage ? {} : { opacity: 0.5 };

  return (
    <div className="zoom-toolbar" style={style}>
      <label htmlFor="zoom-slider">Zoom level</label>
      <input
        id="zoom-slider"
        disabled={!originalImage}
        type="range"
        min="0.1"
        max="8"
        step="0.1"
        value={zoom}
        onChange={handleZoomChange}
        className="zoom-slider"
      />
      <div className="mt-2">
        Zoom: <b>{Math.round(zoom * 100)}%</b>
      </div>
      {/*<button className="btn btn-secondary btn-sm mt-3" onClick={handleResetZoom}>*/}
      {/*  Reset Zoom*/}
      {/*</button>*/}
    </div>
  );
};

export default Zoom;
