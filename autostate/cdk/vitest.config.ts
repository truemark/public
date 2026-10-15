import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // Only the TypeScript sources; tsc emits *.test.js next to them.
    include: ['lib/**/*.test.ts'],
  },
});
