import { mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { releaseConfig } from "./release-config.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const version = process.env.RELEASE_VERSION ?? JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const output = path.join(root, ".build", "release", `${releaseConfig.packageName}_${version}_docker.tar`);
await mkdir(path.dirname(output), { recursive: true });
const image = `${releaseConfig.packageName}:${version}`;
await exec("docker", ["build", "--target", "runner", "--tag", image, root], { cwd: root, maxBuffer: 1024 * 1024 * 20 });
await exec("docker", ["save", "--output", output, image], { cwd: root });
console.log(`[release] created ${output}`);
