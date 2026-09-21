import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    maxWorkers: 2,
    isolate: true,
    cache: { enabled: true },
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/contexts/__tests__/psd-utils.test.ts', 'src/hooks/__tests__/useApp.psd.test.ts'],
  },
});
