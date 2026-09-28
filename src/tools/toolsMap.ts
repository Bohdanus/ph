import React from 'react';

import Blur from '../components/ToolbarsRight/Blur/Blur.tsx';
import Brush from '../components/ToolbarsRight/Brush/Brush.tsx';
import CloneStamp from '../components/ToolbarsRight/CloneStamp/CloneStamp.tsx';
import Color from '../components/ToolbarsRight/Colors/Color.tsx';
import ColorReplacement from '../components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx';
import Crop from '../components/ToolbarsRight/Crop/Crop.tsx';
import Draw from '../components/ToolbarsRight/Draw/Draw.tsx';
import EllipticalSelection from '../components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx';
import Eraser from '../components/ToolbarsRight/Eraser/Eraser.tsx';
import Eyedropper from '../components/ToolbarsRight/Eyedropper/Eyedropper.tsx';
import Shape from '../components/ToolbarsRight/Figures/Shape.tsx';
import Gradient from '../components/ToolbarsRight/Gradient/Gradient.tsx';
import FeatherMagneticLasso from '../components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx';
import FreehandLasso from '../components/ToolbarsRight/Lasso/FreehandLasso.tsx';
import PolygonalLasso from '../components/ToolbarsRight/Lasso/PolygonalLasso.tsx';
import Levels from '../components/ToolbarsRight/Levels/Levels.tsx';
import MagicEraser from '../components/ToolbarsRight/MagicEraser/MagicEraser.tsx';
import PaintBucket from '../components/ToolbarsRight/MagicEraser/PaintBucket.tsx';
import MagicWand from '../components/ToolbarsRight/MagicWand/MagicWand.tsx';
import Reposition from '../components/ToolbarsRight/Move/Reposition.tsx';
import Pencil from '../components/ToolbarsRight/Pencil/Pencil.tsx';
import QuickSelection from '../components/ToolbarsRight/QuickSelection/QuickSelection.tsx';
import RectangularSelection from '../components/ToolbarsRight/RectangularSelection/RectangularSelection.tsx';
import Sharpen from '../components/ToolbarsRight/Sharpen/Sharpen.tsx';
import Smudge from '../components/ToolbarsRight/Smudge/Smudge.tsx';
import Text from '../components/ToolbarsRight/Text/Text.tsx';
import Tonal from '../components/ToolbarsRight/Tonal/Tonal.tsx';
import { PlaceholderTool } from '../components/ToolbarsRight/ToolbarPlaceholder.tsx';
import { placeholderToolGroups } from '../components/ToolbarsRight/toolbarPlaceholderConfig.ts';
import Transform from '../components/ToolbarsRight/Transform/Transform.tsx';
import type { ToolbarRightComponent } from '../components/ToolbarsRight/types.ts';
import type { ToolName } from '../contexts/tool-types.ts';
import { toolProcessors, type ToolProcessorDefinition } from './toolProcessors.ts';

export type { CreatorToolParams, ProcessorToolParams, ToolResult } from './toolProcessors.ts';

const placeholderTool = (
  title: string,
  key: keyof typeof placeholderToolGroups,
  showTodoBadge = true
): ToolbarRightComponent => {
  return () => React.createElement(PlaceholderTool, { title, options: placeholderToolGroups[key], showTodoBadge });
};

type ToolsMap = Record<
  ToolName,
  Partial<ToolProcessorDefinition> & {
    icon: string;
    toolboxComponent: ToolbarRightComponent;
  }
>;

export const toolsMap: ToolsMap = {
  reposition: { ...toolProcessors.reposition, icon: 'reposition', toolboxComponent: Reposition },
  blur: { ...toolProcessors.blur, icon: 'blur', toolboxComponent: Blur },
  color: { ...toolProcessors.color, icon: 'color', toolboxComponent: Color },
  levels: { ...toolProcessors.levels, icon: 'levels', toolboxComponent: Levels },
  transform: { ...toolProcessors.transform, icon: 'transform', toolboxComponent: Transform },
  crop: { ...toolProcessors.crop, icon: 'crop', toolboxComponent: Crop },
  draw: { ...toolProcessors.draw, icon: 'draw', toolboxComponent: Draw },
  shape: { ...toolProcessors.shape, icon: 'shape', toolboxComponent: Shape },
  text: { ...toolProcessors.text, icon: 'text', toolboxComponent: Text },
  'polygonal-lasso': {
    ...toolProcessors['polygonal-lasso'],
    icon: 'lasso',
    toolboxComponent: PolygonalLasso,
  },
  'freehand-lasso': {
    ...toolProcessors['freehand-lasso'],
    icon: 'lasso',
    toolboxComponent: FreehandLasso,
  },
  'feather-magnetic-lasso': {
    ...toolProcessors['feather-magnetic-lasso'],
    icon: 'lasso',
    toolboxComponent: FeatherMagneticLasso,
  },
  'magic-wand': { ...toolProcessors['magic-wand'], icon: 'magic-wand', toolboxComponent: MagicWand },
  'rectangular-selection': {
    ...toolProcessors['rectangular-selection'],
    icon: 'rectangular-selection',
    toolboxComponent: RectangularSelection,
  },
  'elliptical-selection': {
    ...toolProcessors['elliptical-selection'],
    icon: 'elliptical-selection',
    toolboxComponent: EllipticalSelection,
  },
  'quick-selection': {
    ...toolProcessors['quick-selection'],
    icon: 'quick-selection',
    toolboxComponent: QuickSelection,
  },
  'clone-stamp': { ...toolProcessors['clone-stamp'], icon: 'clone-stamp', toolboxComponent: CloneStamp },
  gradient: { ...toolProcessors.gradient, icon: 'gradient', toolboxComponent: Gradient },
  sharpen: { ...toolProcessors.sharpen, icon: 'sharpen', toolboxComponent: Sharpen },
  smudge: { ...toolProcessors.smudge, icon: 'smudge', toolboxComponent: Smudge },
  // `dodge` and `burn` share ONE panel deliberately: they are the same control set
  // (Preset / Mode / Range / Exposure / Protect Skin Tone) over the same
  // `DodgeBurnToolArgs`, and Photoshop draws them as one flyout tile pair anyway.
  // `Tonal.tsx` reads `useStore().toolName` to decide which it is, so mounting it
  // twice would show the same bar with a hardcoded name.
  dodge: { ...toolProcessors.dodge, icon: 'dodge', toolboxComponent: Tonal },
  burn: { ...toolProcessors.burn, icon: 'burn', toolboxComponent: Tonal },
  brush: {
    ...toolProcessors.brush,
    icon: 'brush',
    toolboxComponent: Brush,
  },
  pencil: {
    ...toolProcessors.pencil,
    icon: 'pencil',
    toolboxComponent: Pencil,
  },
  'color-replacement': {
    ...toolProcessors['color-replacement'],
    icon: 'color-replacement',
    toolboxComponent: ColorReplacement,
  },
  eraser: { ...toolProcessors.eraser, icon: 'eraser', toolboxComponent: Eraser },
  'magic-eraser': { ...toolProcessors['magic-eraser'], icon: 'magic-eraser', toolboxComponent: MagicEraser },
  'paint-bucket': { ...toolProcessors['paint-bucket'], icon: 'paint-bucket', toolboxComponent: PaintBucket },
  // No processor: the eyedropper rasterizes nothing (see `PIXEL_FREE_TOOLS` in toolProcessors.ts),
  // so this entry carries only the icon and the options bar.
  eyedropper: { icon: 'eyedropper', toolboxComponent: Eyedropper },
  pen: { ...toolProcessors.pen, icon: 'pen', toolboxComponent: placeholderTool('Pen Tool', 'pen') },
  'freeform-pen': {
    ...toolProcessors['freeform-pen'],
    icon: 'freeform-pen',
    toolboxComponent: placeholderTool('Freeform Pen Tool', 'pen'),
  },
  'curvature-pen': {
    ...toolProcessors['curvature-pen'],
    icon: 'curvature-pen',
    toolboxComponent: placeholderTool('Curvature Pen Tool', 'pen'),
  },
  'add-anchor-point': {
    ...toolProcessors['add-anchor-point'],
    icon: 'add-anchor-point',
    toolboxComponent: placeholderTool('Add Anchor Point Tool', 'pen'),
  },
  'delete-anchor-point': {
    ...toolProcessors['delete-anchor-point'],
    icon: 'delete-anchor-point',
    toolboxComponent: placeholderTool('Delete Anchor Point Tool', 'pen'),
  },
  'convert-point': {
    ...toolProcessors['convert-point'],
    icon: 'convert-point',
    toolboxComponent: placeholderTool('Convert Point Tool', 'pen'),
  },
  rectangle: { ...toolProcessors.rectangle, icon: 'rectangle', toolboxComponent: Shape },
  ellipse: { ...toolProcessors.ellipse, icon: 'ellipse', toolboxComponent: Shape },
  triangle: { ...toolProcessors.triangle, icon: 'triangle', toolboxComponent: Shape },
  polygon: { ...toolProcessors.polygon, icon: 'polygon', toolboxComponent: Shape },
  line: { ...toolProcessors.line, icon: 'line', toolboxComponent: Shape },
  'custom-shape': {
    ...toolProcessors['custom-shape'],
    icon: 'custom-shape',
    toolboxComponent: placeholderTool('Custom Shape Tool', 'custom-shape'),
  },
};
