$ErrorActionPreference = "Stop"
$version = if ($env:RELEASE_VERSION) { $env:RELEASE_VERSION } else { (Get-Content package.json | ConvertFrom-Json).version }
$releaseConfig = Get-Content release.config.json | ConvertFrom-Json
$packageName = if ($env:RELEASE_PACKAGE_NAME) { $env:RELEASE_PACKAGE_NAME } else { $releaseConfig.packageName }
$productName = if ($env:RELEASE_PRODUCT_NAME) { $env:RELEASE_PRODUCT_NAME } else { $releaseConfig.productName }
$vendor = if ($env:RELEASE_VENDOR) { $env:RELEASE_VENDOR } else { $releaseConfig.vendor }
$source = Join-Path $PWD ".build\release\windows-payload"
$output = Join-Path $PWD ".build\release\${packageName}_${version}_win.exe"
$msi = Join-Path $PWD ".build\release\${packageName}_${version}.msi"
$launcher = Join-Path $PWD ".build\release\windows-launcher"
if (Test-Path $source) {
  Remove-Item -Recurse -Force $source
}
if (Test-Path $launcher) {
  Remove-Item -Recurse -Force $launcher
}
New-Item -ItemType Directory -Force -Path $source, $launcher, (Split-Path $output) | Out-Null
Copy-Item -Recurse -Force ".build\obfuscate\*" $source
& wix build packaging/windows/main.wxs -d SourceDir=$source -d ProductVersion=$version -d ProductName=$productName -d Manufacturer=$vendor -o $msi
Copy-Item packaging/windows/launcher/* $launcher
Copy-Item $msi (Join-Path $launcher "installer.msi")
& dotnet publish (Join-Path $launcher "InstallerLauncher.csproj") -c Release -r win-x64 --self-contained true -o (Join-Path $launcher "publish")
Copy-Item (Join-Path $launcher "publish\InstallerLauncher.exe") $output
Write-Host "[release] created $output"
