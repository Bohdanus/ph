import { useContext, useEffect, useState } from 'react';

import './Sidebar.scss';
import { ImageContext, type InteractionMode } from '../../contexts/ImageContext.tsx';
import Zoom from '../Zoom/Zoom.tsx';

const SidebarLeft = () => {
  const { originalImage, startEmptyTool, toolName, interactionMode, setInteractionMode } = useContext(ImageContext);
  const [prevInteractionMode, setPrevInteractionMode] = useState<InteractionMode>(interactionMode);

  useEffect(() => {
    setPrevInteractionMode(interactionMode);
  }, [toolName]);

  const handleColors = () => {
    startEmptyTool('colors');
  };

  const handleBlur = () => {
    startEmptyTool('blur');
  };

  const handleLevels = () => {
    startEmptyTool('levels');
  };

  const handleTransform = () => {
    startEmptyTool('transform');
  };

  const handleDraw = () => {
    startEmptyTool('draw');
  };

  return (
    <aside className="sidebar sidebar-left d-none d-md-block">
      <div className="p-3">
        <h5>Toolbox</h5>
        <ul className="nav flex-column">
          <li className="nav-item">
            <button
              className={`nav-link ${toolName === 'colors' ? 'active' : ''}`}
              disabled={!originalImage}
              onClick={handleColors}
            >
              Colors
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${toolName === 'blur' ? 'active' : ''}`}
              disabled={!originalImage}
              onClick={handleBlur}
            >
              Blur
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${toolName === 'levels' ? 'active' : ''}`}
              disabled={!originalImage}
              onClick={handleLevels}
            >
              Levels
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${toolName === 'transform' || toolName === 'crop' ? 'active' : ''}`}
              disabled={!originalImage}
              onClick={handleTransform}
            >
              Crop & Transform
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link ${toolName === 'draw' ? 'active' : ''}`}
              disabled={!originalImage}
              onClick={handleDraw}
            >
              Draw
            </button>
          </li>
        </ul>

        <hr />
        <Zoom />

        {/*<div className="btn-group w-100 mt-3" role="group">*/}
        {/*  <button*/}
        {/*    type="button"*/}
        {/*    className={`btn btn-sm ${['draw', 'crop', 'transform'].includes(toolName!) ? '' : 'disabled'} ${interactionMode === 'zoom' ? 'btn-primary' : 'btn-outline-primary'}`}*/}
        {/*    onClick={() => {*/}
        {/*      setInteractionMode(interactionMode === 'zoom' ? prevInteractionMode : 'zoom');*/}
        {/*    }}*/}
        {/*  >*/}
        {/*    Toggle Pan Mode*/}
        {/*  </button>*/}
        {/*</div>*/}
      </div>
    </aside>
  );
};

export default SidebarLeft;
