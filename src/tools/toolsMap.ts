import { blur } from './blur';
import { colors } from './colors';
import { levels } from './levels';
import { transform } from './transform';
import { crop } from './crop';
import { draw } from './draw';
import { text } from './text';
import { selection } from './selection.ts';
import Color from '../components/ToolbarsRight/Colors/Color.tsx';
import Blur from '../components/ToolbarsRight/Blur/Blur.tsx';
import Levels from '../components/ToolbarsRight/Levels/Levels.tsx';
import Transform from '../components/ToolbarsRight/Transform/Transform.tsx';
import Draw from '../components/ToolbarsRight/Draw/Draw.tsx';
import Shape from '../components/ToolbarsRight/Figures/Shape.tsx';
import Text from '../components/ToolbarsRight/Text/Text.tsx';
import PolygonalLasso from '../components/ToolbarsRight/Lasso/PolygonalLasso.tsx';
import FreehandLasso from '../components/ToolbarsRight/Lasso/FreehandLasso.tsx';
import FeatherMagneticLasso from '../components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx';
import MagicWand from '../components/ToolbarsRight/MagicWand/MagicWand.tsx';
import RectangularSelection from '../components/ToolbarsRight/RectangularSelection/RectangularSelection.tsx';
import type { ToolbarRightComponent } from '../components/ToolbarsRight/types.ts';
import Crop from '../components/ToolbarsRight/Crop/Crop.tsx';
import { shape } from './shape.ts';
import Reposition from '../components/ToolbarsRight/Move/Reposition.tsx';
import type { BitmapSource, Pos, Size } from '../contexts/general-types.ts';
import type { ToolArgs, ToolName } from '../contexts/tool-types.ts';
import { reposition } from './reposition.ts';
import { rectangularSelection } from './rectangularSelection.ts';
import { featherMagneticLasso } from './featherMagneticLasso.ts';
import { magicWand } from './magicWand.ts';

export type ProcessorToolParams = {
  size: Size; // why size??
  bitmap: BitmapSource; // source bitmap that should be processed
};

export type CreatorToolParams = {
  size: Size;
};

export type ToolResult = [BitmapSource, Pos | Size | never];

type ToolsMap = Record<
  ToolName,
  {
    creator?: boolean;
    flattenRequired?: boolean;
    icon: string;
    imageProcessor: (param: ProcessorToolParams | CreatorToolParams) => (args: ToolArgs) => ToolResult;
    toolboxComponent: ToolbarRightComponent;
  }
>;

export const toolsMap: ToolsMap = {
  reposition: {
    icon: 'reposition',
    // @ts-expect-error args
    imageProcessor: reposition,
    toolboxComponent: Reposition,
  },
  blur: {
    icon: 'blur',
    // @ts-expect-error args
    imageProcessor: blur,
    toolboxComponent: Blur,
  },
  color: {
    icon: 'color',
    // @ts-expect-error args
    imageProcessor: colors,
    toolboxComponent: Color,
  },
  levels: {
    icon: 'levels',
    // @ts-expect-error args
    imageProcessor: levels,
    toolboxComponent: Levels,
  },
  transform: {
    icon: 'transform',
    // @ts-expect-error args
    imageProcessor: transform,
    toolboxComponent: Transform,
  },
  crop: {
    icon: 'crop',
    flattenRequired: true,
    // @ts-expect-error args
    imageProcessor: crop,
    toolboxComponent: Crop,
  },
  draw: {
    creator: true,
    icon: 'draw',
    // @ts-expect-error args
    imageProcessor: draw,
    toolboxComponent: Draw,
  },
  shape: {
    creator: true,
    icon: 'shape',
    // @ts-expect-error args
    imageProcessor: shape,
    toolboxComponent: Shape,
  },
  text: {
    creator: true,
    icon: 'text',
    // @ts-expect-error args
    imageProcessor: text,
    toolboxComponent: Text,
  },
  'polygonal-lasso': {
    creator: true,
    icon: 'lasso',
    // @ts-expect-error args
    imageProcessor: selection,
    toolboxComponent: PolygonalLasso,
  },
  'freehand-lasso': {
    creator: true,
    icon: 'lasso',
    // @ts-expect-error args
    imageProcessor: selection,
    toolboxComponent: FreehandLasso,
  },
  'feather-magnetic-lasso': {
    icon: 'lasso',
    // @ts-expect-error args
    imageProcessor: featherMagneticLasso,
    toolboxComponent: FeatherMagneticLasso,
  },
  'magic-wand': {
    icon: 'magic-wand',
    // @ts-expect-error args
    imageProcessor: magicWand,
    toolboxComponent: MagicWand,
  },
  'rectangular-selection': {
    creator: true,
    icon: 'rectangular-selection',
    // @ts-expect-error args
    imageProcessor: rectangularSelection,
    toolboxComponent: RectangularSelection,
  },
  // load: {
  //   creational: true,
  //   icon: 'load',
  // }
};
