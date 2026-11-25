# Build the shareable Windows programs (portable .exe + installer) for One Todo Tree.
# node_modules and the build live outside Dropbox; only the finished .exe files are copied to dist\.
#   .\build-exe.ps1                  -> your own build (your categories)
#   .\build-exe.ps1 -Flavor generic  -> for colleagues: starts with Topic 1–4 + People (tools\flavors\generic.json)
param([string]$Flavor = '')
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$build = Join-Path $env:LOCALAPPDATA 'one-todo-tree-build'
$stage = Join-Path $build 'stage'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Set-Location $build
if (-not (Test-Path (Join-Path $build 'node_modules\electron-builder'))) { npm install --no-audit --no-fund electron-builder@26.18.0 | Out-Host }

# fresh staging copy of the app (sources only)
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
foreach ($d in 'main', 'renderer', 'shared', 'assets') { Copy-Item (Join-Path $src $d) (Join-Path $stage $d) -Recurse }
$pkg = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
$pkg | Add-Member -NotePropertyName devDependencies -NotePropertyValue @{ electron = '45.4.1' } -Force
$pkg.build | Add-Member -NotePropertyName directories -NotePropertyValue @{ output = (Join-Path $build 'dist') } -Force
if ($Flavor) {
  $flavorFile = Join-Path $PSScriptRoot "flavors\$Flavor.json"
  Copy-Item $flavorFile (Join-Path $stage 'flavor.json')
  $pkg.build.files += 'flavor.json'
  $fl = Get-Content $flavorFile -Raw | ConvertFrom-Json
  if ($fl.productName) {
    # own product (e.g. "DTU Planner"): own name, app id and settings folder, so it never mixes with One Todo Tree
    $pkg.productName = $fl.productName
    $pkg.build.productName = $fl.productName
    $pkg.name = ($fl.productName.ToLower() -replace '[^a-z0-9]+', '-')
    if ($fl.appId) { $pkg.build.appId = $fl.appId }
    $prefix = if ($fl.artifactPrefix) { $fl.artifactPrefix } else { $fl.productName -replace '\s', '' }
    $pkg.build.portable.artifactName = "$prefix-`${version}-portable.exe"
    $pkg.build.nsis.artifactName = "$prefix-`${version}-setup.exe"
  } else {
    $pkg.build.portable.artifactName = "OneTodoTree-`${version}-$Flavor-portable.exe"
    $pkg.build.nsis.artifactName = "OneTodoTree-`${version}-$Flavor-setup.exe"
  }
}
if (Test-Path (Join-Path $build 'dist')) { Get-ChildItem (Join-Path $build 'dist') -Filter *.exe | Remove-Item -Force }
# write without a BOM (Windows PowerShell 5 adds one with -Encoding utf8, and electron-builder then rejects the file)
[IO.File]::WriteAllText((Join-Path $stage 'package.json'), ($pkg | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
# let electron-builder find electron + itself in the build folder
if (-not (Test-Path (Join-Path $stage 'node_modules'))) { New-Item -ItemType Junction -Path (Join-Path $stage 'node_modules') -Target (Join-Path $build 'node_modules') | Out-Null }

Set-Location $stage
& (Join-Path $build 'node_modules\.bin\electron-builder.cmd') --win portable nsis --x64 --publish never | Out-Host

$dist = Join-Path $src 'dist'
New-Item -ItemType Directory $dist -Force | Out-Null
Get-ChildItem (Join-Path $build 'dist') -Filter *.exe | ForEach-Object { Copy-Item $_.FullName $dist -Force; "copied $($_.Name)" }
