import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['cjs'],
  target: 'node18',
  sourcemap: true,
  clean: true,
  dts: true,
  tsconfig: './tsconfig.json',
  outDir: 'dist',
  esbuildOptions(options) {
    options.alias = {
      '@': './',
    };
  },
});
