#!/usr/bin/env node
// Bundles client/*.ts into public/js/*.js (IIFE) with esbuild; tsconfig paths resolve @kuraykaraaslan-labs/* and the next shims.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
await build({
  entryPoints: { 'kui-api': path.join(root, 'client/api.ts') },
  outdir: path.join(root, 'public/js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': 'undefined' },
  logLevel: 'info',
});
