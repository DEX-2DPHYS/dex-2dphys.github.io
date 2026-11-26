# Build the Windows programs (installer + portable .exe) locally, the same way the release workflow does.
# Dependencies and the build live outside Dropbox (%LOCALAPPDATA%\dtu-science-writer-build); only the finished
# .exe files are copied to dist\.   Usage: powershell -File tools\build-exe.ps1
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$build = Join-Path $env:LOCALAPPDATA 'dtu-science-writer-build'
$stage = Join-Path $build 'stage'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

node (Join-Path $src 'tools\build.js')
if ($LASTEXITCODE -ne 0) { throw 'bundle build failed' }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
foreach ($d in 'main', 'renderer', 'assets', 'vendor') { Copy-Item (Join-Path $src $d) (Join-Path $stage $d) -Recurse }
New-Item -ItemType Directory (Join-Path $stage 'vendor-bin') | Out-Null
Copy-Item (Join-Path $build 'bin\typst.exe') (Join-Path $stage 'vendor-bin\typst.exe')

$pkg = Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json
$pkg | Add-Member -NotePropertyName devDependencies -NotePropertyValue @{ electron = '45.4.1' } -Force
$pkg.build | Add-Member -NotePropertyName directories -NotePropertyValue @{ output = (Join-Path $build 'dist') } -Force
# without a BOM (electron-builder rejects one)
[IO.File]::WriteAllText((Join-Path $stage 'package.json'), ($pkg | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
if (-not (Test-Path (Join-Path $stage 'node_modules'))) { New-Item -ItemType Junction -Path (Join-Path $stage 'node_modules') -Target (Join-Path $build 'node_modules') | Out-Null }
if (Test-Path (Join-Path $build 'dist')) { Get-ChildItem (Join-Path $build 'dist') -Filter *.exe | Remove-Item -Force }

Set-Location $stage
& (Join-Path $build 'node_modules\.bin\electron-builder.cmd') --win portable nsis --x64 --publish never | Out-Host

$dist = Join-Path $src 'dist'
New-Item -ItemType Directory $dist -Force | Out-Null
Get-ChildItem (Join-Path $build 'dist') -Filter *.exe | ForEach-Object { Copy-Item $_.FullName $dist -Force; "copied $($_.Name) ($([math]::Round($_.Length / 1MB)) MB)" }
