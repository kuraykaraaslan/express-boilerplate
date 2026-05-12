import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["cjs"],
  target: "node18",
  dts: false,
  clean: true,
  sourcemap: true,
  outDir: "dist",
  bundle: true,
});
