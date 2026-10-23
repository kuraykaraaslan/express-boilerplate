import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { releaseConfig } from "./release-config.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const version = process.env.RELEASE_VERSION ?? JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const topDir = path.join(root, ".build", "release", "rpm");
const payload = path.join(topDir, "BUILDROOT", `${releaseConfig.packageName}-${version}-1.x86_64`);
const installRoot = path.join(payload, "opt", releaseConfig.packageName, version);
const output = path.join(root, ".build", "release", `${releaseConfig.packageName}_${version}_x86_64.rpm`);

await rm(topDir, { recursive: true, force: true });
await mkdir(installRoot, { recursive: true });
await cp(path.join(root, ".build", "obfuscate"), installRoot, { recursive: true });
await mkdir(path.join(payload, "etc", releaseConfig.packageName), { recursive: true });
await writeFile(path.join(payload, "etc", releaseConfig.packageName, `${releaseConfig.packageName}.env.example`), "NODE_ENV=production\nPORT=3000\nDB_URL=\nREDIS_URL=\nJWT_SECRET=\n");
const systemdDir = path.join(payload, "usr", "lib", "systemd", "system");
await mkdir(systemdDir, { recursive: true });
await writeFile(path.join(systemdDir, `${releaseConfig.packageName}.service`), `[Unit]
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
const specPath = path.join(topDir, `${releaseConfig.packageName}.spec`);
await writeFile(specPath, `Name: ${releaseConfig.packageName}
Version: ${version}
Release: 1%{?dist}
Summary: ${releaseConfig.productName} production API server
License: Proprietary
BuildArch: x86_64

%description
Obfuscated production distribution of the ${releaseConfig.productName} API server.

%install
mkdir -p %{buildroot}
cp -a ${payload}/* %{buildroot}/

%pre
getent group ${releaseConfig.packageName} >/dev/null || groupadd --system ${releaseConfig.packageName}
getent passwd ${releaseConfig.packageName} >/dev/null || useradd --system --gid ${releaseConfig.packageName} --home-dir /var/lib/${releaseConfig.packageName} --no-create-home ${releaseConfig.packageName}

%post
systemctl daemon-reload >/dev/null 2>&1 || :
systemctl enable ${releaseConfig.packageName}.service >/dev/null 2>&1 || :

%preun
if [ "$1" -eq 0 ]; then systemctl stop ${releaseConfig.packageName}.service >/dev/null 2>&1 || :; fi

%files
%config(noreplace) /etc/${releaseConfig.packageName}/${releaseConfig.packageName}.env.example
/opt/${releaseConfig.packageName}/${version}
/usr/lib/systemd/system/${releaseConfig.packageName}.service
`);
await exec("rpmbuild", ["-bb", "--define", `_topdir ${topDir}`, specPath]);
await mkdir(path.dirname(output), { recursive: true });
await cp(path.join(topDir, "RPMS", "x86_64", `${releaseConfig.packageName}-${version}-1.x86_64.rpm`), output);
console.log(`[release] created ${output}`);
