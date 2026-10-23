import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { releaseConfig } from "./release-config.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const version = process.env.RELEASE_VERSION ?? JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const buildRoot = path.join(root, ".build", "obfuscate");
const staging = path.join(root, ".build", "release", "deb");
const packageRoot = path.join(staging, "opt", releaseConfig.packageName, version);
const output = path.join(root, ".build", "release", `${releaseConfig.packageName}_${version}_amd64.deb`);

await rm(staging, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });
await cp(buildRoot, packageRoot, { recursive: true });
await mkdir(path.join(staging, "DEBIAN"), { recursive: true });
await mkdir(path.join(staging, "etc", releaseConfig.packageName), { recursive: true });
await mkdir(path.join(staging, "var", "lib", releaseConfig.packageName), { recursive: true });
await mkdir(path.join(staging, "var", "log", releaseConfig.packageName), { recursive: true });
await writeFile(
  path.join(staging, "etc", releaseConfig.packageName, `${releaseConfig.packageName}.env.example`),
  "NODE_ENV=production\nPORT=3000\nDB_URL=\nREDIS_URL=\nJWT_SECRET=\n",
);

await writeFile(path.join(staging, "DEBIAN", "control"), `Package: ${releaseConfig.packageName}
Version: ${version}
Section: web
Priority: optional
Architecture: amd64
Maintainer: ${releaseConfig.vendor}
Description: ${releaseConfig.productName} production API server
Depends: libc6
`);
await writeFile(path.join(staging, "DEBIAN", "postinst"), `#!/bin/sh
set -e
getent group ${releaseConfig.packageName} >/dev/null || groupadd --system ${releaseConfig.packageName}
getent passwd ${releaseConfig.packageName} >/dev/null || useradd --system --gid ${releaseConfig.packageName} --home-dir /var/lib/${releaseConfig.packageName} --no-create-home ${releaseConfig.packageName}
systemctl daemon-reload || true
systemctl enable ${releaseConfig.packageName}.service || true
exit 0
`);
await writeFile(path.join(staging, "DEBIAN", "prerm"), `#!/bin/sh
set -e
systemctl stop ${releaseConfig.packageName}.service || true
exit 0
`);
await exec("chmod", ["755", path.join(staging, "DEBIAN", "postinst"), path.join(staging, "DEBIAN", "prerm")]);
await mkdir(path.join(staging, "lib", "systemd", "system"), { recursive: true });
await writeFile(path.join(staging, "lib", "systemd", "system", `${releaseConfig.packageName}.service`), `[Unit]
Description=${releaseConfig.productName}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/${releaseConfig.packageName}/${version}
EnvironmentFile=-/etc/${releaseConfig.packageName}/${releaseConfig.packageName}.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
User=${releaseConfig.packageName}

[Install]
WantedBy=multi-user.target
`);
await exec("dpkg-deb", ["--build", "--root-owner-group", staging, output]);
console.log(`[release] created ${output}`);
