import type { Layer, LayersRecord } from '@/contexts/layer-types.ts';
import type { ImageLayerSource, ToolLayerSource } from '@/contexts/layer-types.ts';

export const createMockLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order: 0,
  isBedrock: false,
  pos: { x: 0, y: 0, width: 100, height: 100 },
  presentationBounds: null,
  bitmap: null,
  tmpCanvas: null,
  operations: [],
  source: undefined,
  ...overrides,
});

export const createMockLayers = (count: number, baseId = 'layer'): LayersRecord => {
  const layers: LayersRecord = {};
  const names = [
    'Background',
    'Layer 2',
    'Top Layer',
    'Layer 4',
    'Layer 5',
    'Layer 6',
    'Layer 7',
    'Layer 8',
    'Layer 9',
    'Layer 10',
  ];
  for (let i = 0; i < count; i++) {
    const id = `${baseId}-${i + 1}`;
    layers[id] = createMockLayer({
      id,
      name: names[i] || `${baseId} ${i + 1}`,
      order: i,
    });
  }
  return layers;
};

export const createMockLayerRecord = (layers: Layer[]): LayersRecord => {
  const record: LayersRecord = {};
  for (const layer of layers) {
    record[layer.id] = layer;
  }
  return record;
};

export const createBedrockLayer = (overrides: Partial<Layer> = {}): Layer =>
  createMockLayer({
    id: 'bedrock',
    name: 'Background',
    isBedrock: true,
    order: 0,
    ...overrides,
  });

export const createToolLayer = (toolName: string, overrides: Partial<Layer> = {}): Layer =>
  createMockLayer({
    id: `tool-${toolName}`,
    name: `${toolName} layer`,
    source: { kind: 'tool', args: { toolName } } as ToolLayerSource,
    tmpCanvas: new OffscreenCanvas(100, 100),
    ...overrides,
  });

export const createImageLayer = (bitmap: ImageBitmap, overrides: Partial<Layer> = {}): Layer =>
  createMockLayer({
    id: 'image-layer',
    name: 'Image layer',
    bitmap,
    source: {
      kind: 'image',
      bitmap,
      isBedrock: true,
      size: { width: bitmap.width, height: bitmap.height },
    } as ImageLayerSource,
    ...overrides,
  });
