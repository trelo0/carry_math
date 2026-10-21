param([string]$StandaloneRoot)
$ErrorActionPreference = 'Stop'

function Install-Packaged($pkg, $destName, $destRoot) {
  $tmp = Join-Path $env:TEMP "sharp-pack-$(Get-Random)"
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  Push-Location $tmp
  cmd /c "npm pack $pkg >nul 2>&1"
  $tgz = Get-ChildItem -Filter '*.tgz' | Select-Object -First 1
  if (-not $tgz) { throw "npm pack failed: $pkg" }
  tar -xf $tgz.FullName
  $dest = Join-Path $destRoot $destName
  New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Move-Item -Force (Join-Path $tmp 'package') $dest
  Pop-Location
  Remove-Item -Recurse -Force $tmp
  Write-Host "  + $destName"
}

$img = Join-Path $StandaloneRoot 'node_modules\@img'
$imgNested = Join-Path $StandaloneRoot 'node_modules\next\node_modules\@img'

Install-Packaged '@img/sharp-linux-x64@0.35.3' 'sharp-linux-x64' $img
Install-Packaged '@img/sharp-libvips-linux-x64@1.3.2' 'sharp-libvips-linux-x64' $img

if (Test-Path $imgNested) {
  Install-Packaged '@img/sharp-linux-x64@0.34.5' 'sharp-linux-x64' $imgNested
  Install-Packaged '@img/sharp-libvips-linux-x64@1.2.4' 'sharp-libvips-linux-x64' $imgNested
}

foreach ($w in @(
  (Join-Path $img 'sharp-win32-x64'),
  (Join-Path $imgNested 'sharp-win32-x64')
)) {
  if (Test-Path $w) { Remove-Item -Recurse -Force $w; Write-Host "  - win32" }
}
