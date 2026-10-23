import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { releaseConfig } from "./release-config.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const mode = process.argv[2] ?? "obfuscate";
if (!["readable", "obfuscate"].includes(mode)) {
  throw new Error("Build mode must be readable or obfuscate");
}

const buildRoot = path.join(root, ".build", mode);
const dist = path.join(buildRoot, "dist");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

await rm(buildRoot, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await exec("npx", ["tsc", "--outDir", dist, "--sourceMap", mode === "readable" ? "true" : "false"], {
  cwd: root,
  maxBuffer: 1024 * 1024 * 20,
});
await exec("npx", ["tsc-alias", "-p", path.join(root, "tsconfig.json"), "--outDir", dist], {
  cwd: root,
  maxBuffer: 1024 * 1024 * 20,
});

if (mode === "obfuscate") {
  await exec("npx", [
    "javascript-obfuscator",
    dist,
    "--output",
    dist,
    "--compact",
    "true",
    "--control-flow-flattening",
    "true",
    "--identifier-names-generator",
    "hexadecimal",
    "--source-map",
    "false",
  ], { cwd: root, maxBuffer: 1024 * 1024 * 20 });
}

const runtimePackage = {
  name: packageJson.name,
  version: packageJson.version,
  private: true,
  type: packageJson.type,
  main: "dist/index.js",
  scripts: { start: "node dist/index.js" },
  dependencies: packageJson.dependencies,
  prisma: packageJson.prisma,
};
await writeFile(path.join(buildRoot, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
await cp(path.join(root, "package-lock.json"), path.join(buildRoot, "package-lock.json"));
await cp(path.join(root, "node_modules"), path.join(buildRoot, "node_modules"), { recursive: true });
for (const directory of ["prisma", "public"]) {
  try {
    await cp(path.join(root, directory), path.join(buildRoot, directory), { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await cp(path.join(root, ".env.example"), path.join(buildRoot, ".env.example"));

console.log(`[release] created ${buildRoot} (${releaseConfig.productName}, ${mode})`);
