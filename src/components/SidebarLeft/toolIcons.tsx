import type { SvgIconFactory, ToolIconName } from './types';

import { BlurIcon } from './icons/BlurIcon';
import { BrushToolIcon } from './icons/BrushToolIcon';
import { ColorIcon } from './icons/ColorIcon';
import { ColorReplacementIcon } from './icons/ColorReplacementIcon';
import { CropIcon } from './icons/CropIcon';
import { DrawIcon } from './icons/DrawIcon';
import { EllipseShapeIcon } from './icons/EllipseShapeIcon';
import { EraserIcon } from './icons/EraserIcon';
import { EyedropperIcon } from './icons/EyedropperIcon';
import { FeatherMagneticLassoIcon } from './icons/FeatherMagneticLassoIcon';
import { FreeformPenIcon } from './icons/FreeformPenIcon';
import { FreehandLassoIcon } from './icons/FreehandLassoIcon';
import { LevelsIcon } from './icons/LevelsIcon';
import { LineShapeIcon } from './icons/LineShapeIcon';
import { MagicEraserIcon } from './icons/MagicEraserIcon';
import { MagicWandIcon } from './icons/MagicWandIcon';
import { MoveIcon } from './icons/MoveIcon';
import { PaintBucketIcon } from './icons/PaintBucketIcon';
import { PenToolIcon } from './icons/PenToolIcon';
import { PolygonalLassoIcon } from './icons/PolygonalLassoIcon';
import { RectangularSelectionIcon } from './icons/RectangularSelectionIcon';
import { RectangleShapeIcon } from './icons/RectangleShapeIcon';
import { ShapeIcon } from './icons/ShapeIcon';
import { TextIcon } from './icons/TextIcon';
import { TransformIcon } from './icons/TransformIcon';

export const toolIcons: Record<ToolIconName, SvgIconFactory> = {
  reposition: MoveIcon,
  color: ColorIcon,
  blur: BlurIcon,
  levels: LevelsIcon,
  transform: TransformIcon,
  crop: CropIcon,
  draw: DrawIcon,
  shape: ShapeIcon,
  'shape-rectangle': RectangleShapeIcon,
  'shape-oval': EllipseShapeIcon,
  'shape-line': LineShapeIcon,
  'shape-triangle': ShapeIcon,
  'shape-polygon': ShapeIcon,
  text: TextIcon,
  'freehand-lasso': FreehandLassoIcon,
  'polygonal-lasso': PolygonalLassoIcon,
  'feather-magnetic-lasso': FeatherMagneticLassoIcon,
  'magic-wand': MagicWandIcon,
  'rectangular-selection': RectangularSelectionIcon,
  brush: BrushToolIcon,
  pencil: BrushToolIcon,
  'color-replacement': ColorReplacementIcon,
  // Four distinct icons, not a shared BrushToolIcon as `brush`/`pencil` do: those two are the same
  // physical tool at two hardnesses, while an eraser drawn as a brush would be a lie.
  eraser: EraserIcon,
  'magic-eraser': MagicEraserIcon,
  'paint-bucket': PaintBucketIcon,
  eyedropper: EyedropperIcon,
  pen: PenToolIcon,
  'freeform-pen': FreeformPenIcon,
  'curvature-pen': PenToolIcon,
  'add-anchor-point': PenToolIcon,
  'delete-anchor-point': PenToolIcon,
  'convert-point': PenToolIcon,
  rectangle: RectangleShapeIcon,
  ellipse: EllipseShapeIcon,
  triangle: ShapeIcon,
  polygon: ShapeIcon,
  line: LineShapeIcon,
  'custom-shape': ShapeIcon,
};
