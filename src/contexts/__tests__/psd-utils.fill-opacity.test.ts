import { describe, expect, it, vi } from 'vitest';
import type { Layer as PsdLayer } from 'ag-psd';

import { loadPsd } from '../psd-utils.ts';

/** `loadPsd` imports `ag-psd` dynamically; this file covers nested Fill data not exposed by a
 * minimal 1x1 binary fixture. The sibling `psd-utils.test.ts` keeps genuine codec round-trips. */
const readPsdMock = vi.hoisted(() => vi.fn());

vi.mock('ag-psd', async (importActual) => {
  const actual = await importActual<typeof import('ag-psd')>();
  return { ...actual, readPsd: readPsdMock };
});

// `warn` inside `visit` prefixes the message with the layer name (psd-utils.ts:87), so the
// message is matched as a substring rather than as a whole array element.
const GROUP_FILL_WARNING = 'Group Fill opacity is approximated as layer opacity when the group is flattened';

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

describe('loadPsd Fill opacity', () => {
  it('preserves Fill separately from layer opacity for a leaf layer', async () => {
    const result = await loadPsd(stubPsd([{ name: 'HalfFill', opacity: 1, fillOpacity: 0.5 } as PsdLayer]));

    expect(result.warnings.join(' ')).not.toContain(GROUP_FILL_WARNING);
    expect(Object.values(result.layers)[0]).toMatchObject({ opacity: 1, fillOpacity: 0.5 });
  });

  it('keeps an already-fractional layer opacity independent from Fill', async () => {
    const result = await loadPsd(stubPsd([{ name: 'Quarter', opacity: 0.5, fillOpacity: 0.5 } as PsdLayer]));

    expect(Object.values(result.layers)[0]).toMatchObject({ opacity: 0.5, fillOpacity: 0.5 });
  });

  it('stays quiet for a unity fill opacity', async () => {
    const result = await loadPsd(stubPsd([{ name: 'Full', opacity: 0.8, fillOpacity: 1 } as PsdLayer]));

    expect(Object.values(result.layers)[0]).toMatchObject({ opacity: 0.8, fillOpacity: 1 });
  });

  it('stays quiet when the field is absent', async () => {
    const result = await loadPsd(stubPsd([{ name: 'Plain', opacity: 0.6 } as PsdLayer]));

    expect(Object.values(result.layers)[0]).toMatchObject({ opacity: 0.6, fillOpacity: 1 });
  });

  it('approximates group Fill into inherited opacity while preserving child Fill', async () => {
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

    const child = Object.values(result.layers)[0];
    expect(child).toMatchObject({ opacity: 0.25, fillOpacity: 0.5 });
    expect(result.warnings.join(' ')).toContain(GROUP_FILL_WARNING);
  });
});
