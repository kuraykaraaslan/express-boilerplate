import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const config = JSON.parse(await readFile(path.join(root, "release.config.json"), "utf8"));

export const releaseConfig = {
  productName: process.env.RELEASE_PRODUCT_NAME ?? config.productName,
  packageName: process.env.RELEASE_PACKAGE_NAME ?? config.packageName,
  vendor: process.env.RELEASE_VENDOR ?? config.vendor,
};

for (const [key, value] of Object.entries(releaseConfig)) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value)) {
    throw new Error(`Invalid release config ${key}: ${value}`);
  }
}
