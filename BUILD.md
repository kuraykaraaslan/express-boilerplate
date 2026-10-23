# Express Boilerplate Build and Release Guide

## Build modes

| Mode | Command | Output | Source maps |
|---|---|---|---|
| Readable | `npm run build:readable` | `.build/readable` | Included |
| Obfuscated | `npm run build` or `npm run build:obfuscate` | `.build/obfuscate` | Removed |

The obfuscated build contains compiled JavaScript and runtime dependencies only.
TypeScript files and source maps are not copied into the distribution. Obfuscation
is not encryption: code running on a server or client can still be inspected.

## Local release artefacts

After `npm ci` and `npm run build:obfuscate`:

```bash
RELEASE_VERSION=1.0.6 npm run release:build:deb
RELEASE_VERSION=1.0.6 npm run release:build:rpm
RELEASE_VERSION=1.0.6 npm run release:build:docker
```

Windows builds run on the GitHub Windows runner because they require WiX and the
.NET self-contained launcher:

```powershell
$env:RELEASE_VERSION = "1.0.6"
./scripts/release/build-windows.ps1
```

## GitHub Releases

Pushing a semver tag matching the package version starts
[`.github/workflows/release.yml`](.github/workflows/release.yml):

```bash
git tag v1.0.6
git push origin v1.0.6
```

The workflow publishes:

- `express-boilerplate_<version>_amd64.deb` for Debian/Ubuntu;
- `express-boilerplate_<version>_x86_64.rpm` for Fedora/RHEL;
- `express-boilerplate_<version>_win.exe` for Windows;
- `express-boilerplate_<version>_docker.tar` for Docker imports;
- `SHA256SUMS` for integrity verification.

Change `release.config.json` to rename the product, package, or vendor without
changing the packaging scripts.

## Runtime configuration

Packages install under `/opt/express-boilerplate/<version>` and use
`/etc/express-boilerplate/express-boilerplate.env`. PostgreSQL, Redis, JWT
secrets, and provider credentials must be configured outside the artefact.
