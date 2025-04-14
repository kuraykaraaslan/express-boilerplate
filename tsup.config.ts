import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'index.ts',
    '!node_modules/**',
    '!public/**',
    './**/*.ts',
  ],
  format: ['cjs'],
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  bundle: false, // Klasör yapısını korumak için
});
