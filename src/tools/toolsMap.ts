import { blur } from './blur';
import { colors } from './colors';
import { levels } from './levels';
import { transform } from './transform';
import { crop } from './crop';
import { draw } from './draw';
import { text } from './text';
import type { ToolArgs } from '../contexts/ImageContext.tsx';
import Colors from '../components/ToolbarsRight/Colors/Colors.tsx';
import Blur from '../components/ToolbarsRight/Blur/Blur.tsx';
import Levels from '../components/ToolbarsRight/Levels/Levels.tsx';
import Transform from '../components/ToolbarsRight/Transform/Transform.tsx';
import Draw from '../components/ToolbarsRight/Draw/Draw.tsx';
import Shapes from '../components/ToolbarsRight/Figures/Shapes.tsx';
import Text from '../components/ToolbarsRight/Text/Text.tsx';
import type { ToolbarRightComponent } from '../components/ToolbarsRight/types.ts';
import Crop from '../components/ToolbarsRight/Crop/Crop.tsx';
import { shape } from './shape.ts';

export type ImageProcParams = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bitmap: ImageBitmap;
};

type ToolsMap = Record<
  string,
  {
    icon: string;
    imageProcessor: (
      param: ImageProcParams
    ) => (args: ToolArgs, callback: (newWidth: number, newHeight: number) => void) => Promise<ImageBitmap>;
    toolboxComponent: ToolbarRightComponent;
  }
>;

export const toolsMap: ToolsMap = {
  blur: {
    icon: 'blur',
    // @ts-expect-error args
    imageProcessor: blur,
    toolboxComponent: Blur,
  },
  colors: {
    icon: 'colors',
    // @ts-expect-error args
    imageProcessor: colors,
    toolboxComponent: Colors,
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
    // @ts-expect-error args
    imageProcessor: crop,
    toolboxComponent: Crop,
  },
  draw: {
    icon: 'draw',
    // @ts-expect-error args
    imageProcessor: draw,
    toolboxComponent: Draw,
  },
  shape: {
    icon: 'shape',
    // @ts-expect-error args
    imageProcessor: shape,
    toolboxComponent: Shapes,
  },
  text: {
    icon: 'text',
    // @ts-expect-error args
    imageProcessor: text,
    toolboxComponent: Text,
  },
};
