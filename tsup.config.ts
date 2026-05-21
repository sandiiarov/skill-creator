import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/main.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist/cli',
});
