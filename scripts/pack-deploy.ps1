# Next.js standalone deploy zip (same layout as district-upload-linux.zip).
# Usage: npm run build; .\scripts\pack-deploy.ps1
param(
  [switch]$IncludeEnvProduction
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$standalone = Join-Path $root '.next\standalone'
if (-not (Test-Path (Join-Path $standalone 'server.js'))) {
  throw "Missing $standalone. Run npm run build first."
}

$stage = Join-Path $root '.deploy-pack'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item -Recurse -Force (Join-Path $standalone '.next') (Join-Path $stage '.next')
Copy-Item -Recurse -Force (Join-Path $standalone 'node_modules') (Join-Path $stage 'node_modules')
Copy-Item -Recurse -Force (Join-Path $standalone 'public') (Join-Path $stage 'public')
Copy-Item -Force (Join-Path $standalone 'server.js') (Join-Path $stage 'server.js')
Copy-Item -Force (Join-Path $standalone 'package.json') (Join-Path $stage 'package.json')
Copy-Item -Force (Join-Path $PSScriptRoot 'deploy-start.js') (Join-Path $stage 'start.js')

$staticSrc = Join-Path $root '.next\static'
$staticDst = Join-Path $stage '.next\static'
if (Test-Path $staticSrc) {
  if (Test-Path $staticDst) { Remove-Item -Recurse -Force $staticDst }
  Copy-Item -Recurse -Force $staticSrc $staticDst
}

$envFile = Join-Path $standalone '.env.production'
if ($IncludeEnvProduction -and (Test-Path $envFile)) {
  Copy-Item -Force $envFile (Join-Path $stage '.env.production')
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$zip = Join-Path $root "online-math-deploy-$stamp.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }

Push-Location $stage
try {
  & tar -a -c -f $zip *
} finally {
  Pop-Location
}

Remove-Item -Recurse -Force $stage

Get-Item $zip | Select-Object FullName, @{ N = 'SizeMB'; E = { [math]::Round($_.Length / 1MB, 2) } }
