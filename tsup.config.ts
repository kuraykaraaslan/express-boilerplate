import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['cjs', 'esm'],
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  tsconfig: './tsconfig.json',
  esbuildOptions(options) {
    options.alias = {
      '@': './',
    };
  },
});
