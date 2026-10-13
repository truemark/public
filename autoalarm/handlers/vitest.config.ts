import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // Only the TypeScript sources; tsc emits *.test.mjs next to them.
    include: ['src/**/*.test.mts'],
  },
});
