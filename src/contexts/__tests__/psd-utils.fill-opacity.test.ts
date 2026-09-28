import { describe, expect, it, vi } from 'vitest';
import type { Layer as PsdLayer } from 'ag-psd';

import { loadPsd } from '../psd-utils.ts';

/**
 * `ag-psd` declares `fillOpacity` on its `Layer` type but neither reads nor writes it (no
 * reference anywhere in `ag-psd/dist/psd.js`), so a real `writePsd` -> `readPsd` round-trip
 * always drops the field. The fill-opacity approximation in `psd-utils.ts:121-127` is therefore
 * unreachable through the real codec, and this file drives it with a stubbed reader instead.
 *
 * `loadPsd` imports `ag-psd` dynamically, so a module mock here is the only way in. The mock is
 * scoped to this file on purpose: the sibling `psd-utils.test.ts` depends on the genuine codec
 * end to end and must keep it.
 */
const readPsdMock = vi.hoisted(() => vi.fn());

vi.mock('ag-psd', async (importActual) => {
  const actual = await importActual<typeof import('ag-psd')>();
  return { ...actual, readPsd: readPsdMock };
});

// `warn` inside `visit` prefixes the message with the layer name (psd-utils.ts:87), so the
// message is matched as a substring rather than as a whole array element.
const FILL_OPACITY_WARNING = 'Fill opacity is approximated as layer opacity; appearance may differ.';

/**
 * `loadPsd` validates the 26-byte PSD signature before it ever reaches `readPsd`
 * (psd-utils.ts:61-63), so the buffer handed to the stub has to look like a real header.
 */
function psdHeader(): ArrayBuffer {
  const buffer = new ArrayBuffer(26);
  const view = new DataView(buffer);
  view.setUint32(0, 0x38425053); // '8BPS'
  view.setUint16(4, 1); // version 1
  view.setUint32(14, 3); // height
  view.setUint16(16, 3); // depth
  view.setUint32(18, 4); // width
  view.setUint16(22, 8); // bits per channel
  view.setUint16(24, 3); // color mode: RGB
  return buffer;
}

const stubPsd = (children: PsdLayer[]) => {
  readPsdMock.mockReturnValue({ width: 4, height: 3, children });
  return psdHeader();
};

describe('loadPsd fill-opacity approximation', () => {
  it('warns and folds a non-unity fill opacity into the layer opacity', async () => {
    const result = await loadPsd(stubPsd([{ name: 'HalfFill', opacity: 1, fillOpacity: 0.5 } as PsdLayer]));

    expect(result.warnings.join(' ')).toContain(FILL_OPACITY_WARNING);
    // The warning alone would still pass if the arithmetic were wrong, so the resulting opacity
    // is asserted too: inheritedOpacity(1) * source.opacity(1) * source.fillOpacity(0.5).
    expect(Object.values(result.layers)[0].opacity).toBeCloseTo(0.5, 2);
  });

  it('multiplies the fill opacity into an already-fractional layer opacity', async () => {
    const result = await loadPsd(stubPsd([{ name: 'Quarter', opacity: 0.5, fillOpacity: 0.5 } as PsdLayer]));

    expect(result.warnings.join(' ')).toContain(FILL_OPACITY_WARNING);
    // 0.5 * 0.5 = 0.25, so a reader cannot tell a half-opacity layer from a half-fill one.
    expect(Object.values(result.layers)[0].opacity).toBeCloseTo(0.25, 2);
  });

  it('stays quiet for a unity fill opacity', async () => {
    const result = await loadPsd(stubPsd([{ name: 'Full', opacity: 0.8, fillOpacity: 1 } as PsdLayer]));

    expect(result.warnings.join(' ')).not.toContain(FILL_OPACITY_WARNING);
    expect(Object.values(result.layers)[0].opacity).toBeCloseTo(0.8, 2);
  });

  it('stays quiet when the field is absent', async () => {
    const result = await loadPsd(stubPsd([{ name: 'Plain', opacity: 0.6 } as PsdLayer]));

    expect(result.warnings.join(' ')).not.toContain(FILL_OPACITY_WARNING);
    expect(Object.values(result.layers)[0].opacity).toBeCloseTo(0.6, 2);
  });

  it('multiplies the fill opacity through a group into its children', async () => {
    const result = await loadPsd(
      stubPsd([
        {
          name: 'Group',
          opacity: 0.5,
          fillOpacity: 0.5,
          children: [{ name: 'Child', opacity: 1, fillOpacity: 0.5 } as PsdLayer],
        } as PsdLayer,
      ])
    );

    // Groups are flattened, so the factors have to compose rather than overwrite: the child
    // inherits 0.5 * 0.5 = 0.25 from the group before its own 0.5 is applied.
    expect(Object.values(result.layers).map((layer) => Number(layer.opacity?.toFixed(4)))).toEqual([0.125]);
  });
});
