import type { SvgIconFactory, ToolIconName } from './types';

import { BlurIcon } from './icons/BlurIcon';
import { BrushToolIcon } from './icons/BrushToolIcon';
import { BurnIcon } from './icons/BurnIcon';
import { CloneStampIcon } from './icons/CloneStampIcon';
import { ColorIcon } from './icons/ColorIcon';
import { ColorReplacementIcon } from './icons/ColorReplacementIcon';
import { CropIcon } from './icons/CropIcon';
import { DodgeIcon } from './icons/DodgeIcon';
import { DrawIcon } from './icons/DrawIcon';
import { EllipseShapeIcon } from './icons/EllipseShapeIcon';
import { EllipticalSelectionIcon } from './icons/EllipticalSelectionIcon';
import { EraserIcon } from './icons/EraserIcon';
import { EyedropperIcon } from './icons/EyedropperIcon';
import { ColorSamplerIcon } from './icons/ColorSamplerIcon';
import { RulerIcon } from './icons/RulerIcon';
import { FeatherMagneticLassoIcon } from './icons/FeatherMagneticLassoIcon';
import { FreeformPenIcon } from './icons/FreeformPenIcon';
import { FreehandLassoIcon } from './icons/FreehandLassoIcon';
import { GradientIcon } from './icons/GradientIcon';
import { LevelsIcon } from './icons/LevelsIcon';
import { LineShapeIcon } from './icons/LineShapeIcon';
import { MagicEraserIcon } from './icons/MagicEraserIcon';
import { MagicWandIcon } from './icons/MagicWandIcon';
import { MoveIcon } from './icons/MoveIcon';
import { PaintBucketIcon } from './icons/PaintBucketIcon';
import { PenToolIcon } from './icons/PenToolIcon';
import { PolygonalLassoIcon } from './icons/PolygonalLassoIcon';
import { QuickSelectionIcon } from './icons/QuickSelectionIcon';
import { RectangularSelectionIcon } from './icons/RectangularSelectionIcon';
import { RectangleShapeIcon } from './icons/RectangleShapeIcon';
import { ShapeIcon } from './icons/ShapeIcon';
import { StarIcon } from './icons/StarIcon';
import { SharpenIcon } from './icons/SharpenIcon';
import { SingleColumnMarqueeIcon } from './icons/SingleColumnMarqueeIcon';
import { SingleRowMarqueeIcon } from './icons/SingleRowMarqueeIcon';
import { SmudgeIcon } from './icons/SmudgeIcon';
import { SpongeIcon } from './icons/SpongeIcon';
import { TextIcon } from './icons/TextIcon';
import { TransformIcon } from './icons/TransformIcon';

export const toolIcons: Record<ToolIconName, SvgIconFactory> & Record<'shape-star', SvgIconFactory> = {
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
  'shape-star': StarIcon,
  text: TextIcon,
  'freehand-lasso': FreehandLassoIcon,
  'polygonal-lasso': PolygonalLassoIcon,
  'feather-magnetic-lasso': FeatherMagneticLassoIcon,
  'magic-wand': MagicWandIcon,
  'rectangular-selection': RectangularSelectionIcon,
  'elliptical-selection': EllipticalSelectionIcon,
  'single-row-marquee': SingleRowMarqueeIcon,
  'single-column-marquee': SingleColumnMarqueeIcon,
  'quick-selection': QuickSelectionIcon,
  'clone-stamp': CloneStampIcon,
  gradient: GradientIcon,
  sharpen: SharpenIcon,
  smudge: SmudgeIcon,
  dodge: DodgeIcon,
  burn: BurnIcon,
  sponge: SpongeIcon,
  brush: BrushToolIcon,
  pencil: BrushToolIcon,
  'color-replacement': ColorReplacementIcon,
  // Four distinct icons, not a shared BrushToolIcon as `brush`/`pencil` do: those two are the same
  // physical tool at two hardnesses, while an eraser drawn as a brush would be a lie.
  eraser: EraserIcon,
  'magic-eraser': MagicEraserIcon,
  'paint-bucket': PaintBucketIcon,
  eyedropper: EyedropperIcon,
  'color-sampler': ColorSamplerIcon,
  ruler: RulerIcon,
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
