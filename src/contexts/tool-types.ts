import type { CropToolArgs } from '../tools/crop.ts';
import type { DrawToolArgs, PaintToolArgs } from '../tools/draw.ts';
import type { FigureType, ShapeToolArgs } from '../tools/shape.ts';
import type { TransformToolArgs } from '../tools/transform.ts';
import type { ColorsToolArgs } from '../tools/colors.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { BlurToolArgs } from '../tools/blur.ts';
import type { LevelsToolArgs } from '../tools/levels.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';
import type { LassoToolArgs } from '../tools/polygonSelection.ts';
import type { RectangularSelectionToolArgs } from '../tools/rectangularSelection.ts';
import type { SingleColumnMarqueeToolArgs, SingleRowMarqueeToolArgs } from '../tools/singleRowColumnMarquee.ts';
import type { FeatherMagneticLassoToolArgs } from '../tools/featherMagneticLasso.ts';
import type { MagicWandToolArgs } from '../tools/magicWand.ts';
import type { EraserToolArgs } from '../tools/eraser.ts';
import type { FillToolArgs } from '../tools/fill.ts';
import type { ColorReplacementToolArgs } from '../tools/colorReplacement.ts';
import type { EyedropperToolArgs } from '../tools/eyedropper.ts';
import type { ColorSamplerToolArgs } from '../tools/colorSampler.ts';
import type { EllipticalSelectionToolArgs } from '../tools/ellipticalSelection.ts';
import type { QuickSelectionToolArgs } from '../tools/quickSelection.ts';
import type { GradientToolArgs } from '../tools/gradient.ts';
import type { SharpenToolArgs } from '../tools/sharpen.ts';
import type { SmudgeToolArgs } from '../tools/smudge.ts';
import type { DodgeBurnToolArgs } from '../tools/dodgeBurn.ts';
import type { SpongeToolArgs } from '../tools/sponge.ts';
import type { CloneStampToolArgs } from '../tools/cloneStamp.ts';
import type { RedEyeToolArgs } from '../tools/redEye.ts';

import type { BitmapSource, Pos, Size } from './general-types.ts';

export type ToolArgsByName = {
  reposition: RepositionToolArgs;
  blur: BlurToolArgs;
  color: ColorsToolArgs;
  levels: LevelsToolArgs;
  transform: TransformToolArgs;
  crop: CropToolArgs;
  draw: DrawToolArgs;
  shape: ShapeToolArgs;
  text: TextToolArgs;
  'polygonal-lasso': LassoToolArgs & { toolName: 'polygonal-lasso' };
  'freehand-lasso': LassoToolArgs & { toolName: 'freehand-lasso' };
  'feather-magnetic-lasso': FeatherMagneticLassoToolArgs;
  'magic-wand': MagicWandToolArgs;
  'rectangular-selection': RectangularSelectionToolArgs;
  'single-row-marquee': SingleRowMarqueeToolArgs;
  'single-column-marquee': SingleColumnMarqueeToolArgs;
  'elliptical-selection': EllipticalSelectionToolArgs;
  'quick-selection': QuickSelectionToolArgs;
  gradient: GradientToolArgs;
  sharpen: SharpenToolArgs;
  smudge: SmudgeToolArgs;
  dodge: DodgeBurnToolArgs;
  burn: DodgeBurnToolArgs;
  /**
   * The third member of the `O` toning flyout, and the only one of the three that is a
   * chroma operation: it has a `mode` and a `flow` where the Dodge and the Burn have a
   * `range` and an `exposure`, so it cannot share `DodgeBurnToolArgs` and does not.
   */
  sponge: SpongeToolArgs;
  'clone-stamp': CloneStampToolArgs;
  'red-eye': RedEyeToolArgs;
  brush: PaintToolArgs;
  pencil: PaintToolArgs;
  'color-replacement': ColorReplacementToolArgs;
  eraser: EraserToolArgs;
  'magic-eraser': FillToolArgs;
  'paint-bucket': FillToolArgs;
  eyedropper: EyedropperToolArgs;
  /**
   * The Color Sampler shares the Eyedropper's Sample Size and has no other setting.
   *
   * The samplers themselves are NOT args: they are placed by gesture and read by the options bar, so
   * an arg here would be a setting the user chose, and the only one this tool has is the footprint
   * the Eyedropper already owns. See `PIXEL_FREE_TOOLS` in `toolProcessors.ts` for why the tool has
   * no processor at all.
   */
  'color-sampler': ColorSamplerToolArgs;
  /**
   * The Ruler carries no args beyond its own name. Every number it reports is a property of the
   * gesture the user just made, not a setting they chose, so there is nothing here to persist —
   * see `PIXEL_FREE_TOOLS` in `toolProcessors.ts` for why the tool has no processor at all.
   */
  ruler: { toolName: 'ruler' };
  hand: { toolName: 'hand' };
  zoom: { toolName: 'zoom' };
  'rotate-view': { toolName: 'rotate-view' };
  pen: { toolName: 'pen' };
  'freeform-pen': { toolName: 'freeform-pen' };
  'curvature-pen': { toolName: 'curvature-pen' };
  'add-anchor-point': { toolName: 'add-anchor-point' };
  'delete-anchor-point': { toolName: 'delete-anchor-point' };
  'convert-point': { toolName: 'convert-point' };
  rectangle: Omit<ShapeToolArgs, 'toolName' | 'figure'> & {
    toolName: 'rectangle';
    figure: Extract<FigureType, 'rectangle'>;
  };
  ellipse: Omit<ShapeToolArgs, 'toolName' | 'figure'> & { toolName: 'ellipse'; figure: Extract<FigureType, 'oval'> };
  triangle: Omit<ShapeToolArgs, 'toolName' | 'figure'> & {
    toolName: 'triangle';
    figure: Extract<FigureType, 'triangle'>;
  };
  polygon: Omit<ShapeToolArgs, 'toolName' | 'figure'> & {
    toolName: 'polygon';
    figure: Extract<FigureType, 'polygon'>;
  };
  line: Omit<ShapeToolArgs, 'toolName' | 'figure'> & { toolName: 'line'; figure: Extract<FigureType, 'line'> };
  'custom-shape': { toolName: 'custom-shape' };
};

export type ToolName = keyof ToolArgsByName;

export type ToolArgsFor<TName extends ToolName> = ToolArgsByName[TName];

export type ToolArgs = ToolArgsByName[ToolName];

export type ToolSettings = ToolArgs;

export type ToolPatch<TName extends ToolName> = Partial<Omit<ToolArgsFor<TName>, 'toolName'>>;

export type FullArgs = {
  args: ToolArgs;
  canvas?: HTMLCanvasElement;
  pos: Pos; // honestly, this should be copied from args :/
};

export type NewBedrockSize = {
  size: Size;
  isBedrock: true;
};
export type NewLayerPos = {
  pos: Pos;
  isBedrock?: false;
};
export type NewLayerData = NewBedrockSize | NewLayerPos;

export type BlankImageParams = {
  color: string;
  opacity: number;
} & NewLayerData;

export type NewDocumentBlankParams = {
  color: string;
  opacity: number;
} & NewBedrockSize;

export type FileImageParams = {
  bitmap: BitmapSource;
  name?: string;
} & NewLayerData;
