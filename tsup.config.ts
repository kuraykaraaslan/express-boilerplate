import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts'],
  format: ['cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@prisma/client'],
  noExternal: ['tsconfig-paths'],
  tsconfig: './tsconfig.json',
  esbuildOptions(options) {
    options.resolveExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    options.alias = {
      '@': './',
    };
  },
});
