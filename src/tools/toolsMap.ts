import { blur } from './blur';
import { colors } from './colors';
import { levels } from './levels';
import { transform } from './transform';
import { crop } from './crop';
import { draw } from './draw';
import { text } from './text';
import type { ToolArgs } from '../contexts/ImageContext.tsx';
import { defaultSettings } from './settings.ts';
import Colors from '../components/ToolbarsRight/Colors/Colors.tsx';
import Blur from '../components/ToolbarsRight/Blur/Blur.tsx';
import Levels from '../components/ToolbarsRight/Levels/Levels.tsx';
import Transform from '../components/ToolbarsRight/Transform/Transform.tsx';
import Draw from '../components/ToolbarsRight/Draw/Draw.tsx';
import Text from '../components/ToolbarsRight/Text/Text.tsx';
import type { ToolbarRightComponent } from '../components/ToolbarsRight/types.ts';
import Crop from '../components/ToolbarsRight/Crop/Crop.tsx';

type ToolsMap = Record<
  string,
  {
    saveLastSettings?: boolean;
    icon: string;
    imageProcessor: (
      canvas: HTMLCanvasElement,
      snapshot: ImageBitmap
    ) => (args: ToolArgs, callback: (newWidth: number, newHeight: number) => void) => Promise<ImageBitmap>;
    defaultSettings: ToolArgs;
    toolboxComponent: ToolbarRightComponent;
  }
>;

export const toolsMap: ToolsMap = {
  blur: {
    icon: 'blur',
    // @ts-expect-error args
    imageProcessor: blur,
    defaultSettings: defaultSettings.blur,
    // @ts-expect-error args
    toolboxComponent: Blur,
  },
  colors: {
    icon: 'colors',
    // @ts-expect-error args
    imageProcessor: colors,
    defaultSettings: defaultSettings.colors,
    // @ts-expect-error args
    toolboxComponent: Colors,
  },
  levels: {
    icon: 'levels',
    // @ts-expect-error args
    imageProcessor: levels,
    defaultSettings: defaultSettings.levels,
    // @ts-expect-error args
    toolboxComponent: Levels,
  },
  transform: {
    icon: 'transform',
    // @ts-expect-error args
    imageProcessor: transform,
    defaultSettings: defaultSettings.transform,
    // @ts-expect-error args
    toolboxComponent: Transform,
  },
  crop: {
    icon: 'crop',
    // @ts-expect-error args
    imageProcessor: crop,
    defaultSettings: defaultSettings.crop,
    // @ts-expect-error args
    toolboxComponent: Crop,
  },
  draw: {
    saveLastSettings: true,
    icon: 'draw',
    // @ts-expect-error args
    imageProcessor: draw,
    defaultSettings: defaultSettings.draw,
    toolboxComponent: Draw,
  },
  text: {
    saveLastSettings: true,
    icon: 'text',
    // @ts-expect-error args
    imageProcessor: text,
    defaultSettings: defaultSettings.text,
    // @ts-expect-error args
    toolboxComponent: Text,
  },
};
