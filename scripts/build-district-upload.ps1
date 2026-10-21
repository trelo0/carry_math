$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
Set-Location $root

Write-Host '>> npm run build'
npm run build

$standalone = Join-Path $root '.next\standalone'
if (-not (Test-Path (Join-Path $standalone 'server.js'))) {
  throw 'Missing .next/standalone/server.js'
}

Write-Host '>> copy static, public, env'
Copy-Item -Recurse -Force (Join-Path $root '.next\static') (Join-Path $standalone '.next\static')
Copy-Item -Recurse -Force (Join-Path $root 'public') (Join-Path $standalone 'public')
Copy-Item -Force (Join-Path $root '.env.production') (Join-Path $standalone '.env.production')
Copy-Item -Force (Join-Path $PSScriptRoot 'host-start.js') (Join-Path $standalone 'start.js')

Write-Host '>> Linux sharp for server'
& (Join-Path $PSScriptRoot 'add-linux-sharp.ps1') -StandaloneRoot $standalone

$zipOut = Join-Path $root 'district-upload-linux.zip'
Remove-Item $zipOut -Force -ErrorAction SilentlyContinue
Push-Location $standalone
Write-Host ">> zip -> $zipOut"
tar -a -c -f $zipOut server.js start.js package.json .env.production .next node_modules public
Pop-Location

$fi = Get-Item $zipOut
Write-Host "OK: $($fi.FullName) MB=$([math]::Round($fi.Length/1MB, 1))"
