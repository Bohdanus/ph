import { IconShell } from './IconShell.tsx';
import type { SvgIconFactory } from '../types.ts';

const svgAssets = import.meta.glob('../../../assets/tool-icons/currentColor/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

export const createAssetIcon = (name: string): SvgIconFactory => {
  const assetPath = `../../../assets/tool-icons/currentColor/${name}.svg`;
  const source = svgAssets[assetPath];

  if (source === undefined) throw new Error(`Missing toolbar icon asset: ${name}`);

  const body = source.slice(source.indexOf('>') + 1, source.lastIndexOf('</svg>'));

  return ({ title }) => (
    <IconShell title={title}>
      <g dangerouslySetInnerHTML={{ __html: body }} />
    </IconShell>
  );
};
