import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { createFloodFillMask, type FloodFillOptions } from '../floodFill.ts';

type ThreadCpuUsage = { user: number; system: number };

const readThreadCpuUsage = (previous?: ThreadCpuUsage): ThreadCpuUsage =>
  (process as typeof process & { threadCpuUsage: (previous?: ThreadCpuUsage) => ThreadCpuUsage }).threadCpuUsage(
    previous
  );

function createImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let i = 0; i < width * height; i++) {
    imageData.data[i * 4] = fill[0];
    imageData.data[i * 4 + 1] = fill[1];
    imageData.data[i * 4 + 2] = fill[2];
    imageData.data[i * 4 + 3] = fill[3];
  }

  return imageData;
}

describe('flood-fill scaling', () => {
  /**
   * Current-thread CPU milliseconds for one or more fills, with the image built BEFORE timing
   * starts, so the number measures the fill and not the `Uint8ClampedArray` allocation. Results
   * are checked after timing so assertion work does not distort the measurement.
   */
  const timeFill = (size: number, options: FloodFillOptions, repetitions = 1): number => {
    const imageData = createImageData(size, size, [12, 34, 56, 255]);
    const selectedPixelCounts = new Array<number | undefined>(repetitions);

    const cpuStartedAt = readThreadCpuUsage();
    for (let i = 0; i < repetitions; i++) {
      selectedPixelCounts[i] = createFloodFillMask(
        imageData,
        { x: size / 2, y: size / 2 },
        { tolerance: 0, ...options }
      )?.selectedPixelCount;
    }
    const cpuTime = readThreadCpuUsage(cpuStartedAt);
    const elapsedCpuMs = (cpuTime.user + cpuTime.system) / 1_000;

    for (const selectedPixelCount of selectedPixelCounts) {
      expect(selectedPixelCount).toBe(size * size);
    }

    return elapsedCpuMs;
  };

  const SCALE_CASES: Array<[string, FloodFillOptions]> = [
    ['the 4-connected flood', {}],
    ['the global scan', { contiguous: false }],
  ];

  it.each(SCALE_CASES)(
    'scales with pixel count, not with pixel count squared, for %s',
    (_label, options) => {
      // The dimensions scale by 2.5, so pixel count scales by 6.25. Linear work should stay
      // near 6.25x while a quadratic regression grows near 39.06x. The 24x ceiling leaves room
      // for non-ideal linear scaling while rejecting a quadratic regression. Current-thread CPU
      // time excludes time this worker is descheduled by unrelated busy worktrees.
      //
      // Batch the small size until it measures at least 16ms CPU, then use the same repeat count
      // at both sizes. This keeps timer resolution from masking a quadratic ratio on fast runners.
      // The dedicated one-worker spec keeps this thread isolated from the parallel unit suite.
      const SMALL = 900;
      const BIG = 2250;
      const TARGET_SMALL_CPU_MS = 16;
      const MAX_REPETITIONS = 64;
      const LIMIT = 24;
      const SAMPLES = 5;

      // Warm-up, excluded from the samples: the first call pays for the JIT and worklist
      // setup, and a cold small run would make the ratio look worse than the algorithm is.
      timeFill(256, options);
      timeFill(256, options);

      let repetitions = 1;
      let calibrationMs = timeFill(SMALL, options, repetitions);
      while (calibrationMs < TARGET_SMALL_CPU_MS && repetitions < MAX_REPETITIONS) {
        repetitions = Math.min(MAX_REPETITIONS, repetitions * 2);
        calibrationMs = timeFill(SMALL, options, repetitions);
      }
      expect(calibrationMs, `Small-size calibration should reach ${TARGET_SMALL_CPU_MS}ms CPU`).toBeGreaterThanOrEqual(
        TARGET_SMALL_CPU_MS
      );

      // Interleave sizes to spread time-varying load across both. The median of paired ratios
      // keeps one JIT or GC spike from deciding the result. Both sizes use the same repetition count.
      const small: number[] = [];
      const large: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        small.push(timeFill(SMALL, options, repetitions));
        large.push(timeFill(BIG, options, repetitions));
      }

      const ratios = small.map((smallMs, index) => large[index]! / smallMs);
      const sortedRatios = [...ratios].sort((left, right) => left - right);
      const medianRatio = sortedRatios[Math.floor(SAMPLES / 2)]!;
      const formatSamples = (samples: number[]) => samples.map((sample) => sample.toFixed(2)).join(', ');
      const summary =
        `Median paired CPU scaling ratio for ${_label}: ${medianRatio.toFixed(2)}x (limit ${LIMIT}x); ` +
        `${repetitions} fills per size sample; paired ratios [${formatSamples(ratios)}]x; ` +
        `${SMALL}x${SMALL} batch samples [${formatSamples(small)}] ms CPU; ` +
        `${BIG}x${BIG} batch samples [${formatSamples(large)}] ms CPU`;

      expect(medianRatio, summary).toBeLessThan(LIMIT);
      console.log(summary);
      // The 60-second wall-clock timeout is only an execution allowance; pass/fail uses the
      // current thread's CPU-time scaling ratio above.
    },
    60_000
  );
});
