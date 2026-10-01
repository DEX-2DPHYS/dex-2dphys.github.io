# Build the Klein-magnetometer probe (and, once it exists, the plugin DLL).
#   powershell -File test\build.ps1            # build + run the probe
#   powershell -File test\build.ps1 -Quick     # skip the 40 000-trajectory gate
#   powershell -File test\build.ps1 -Install   # also link the DLL and swap it in
# The probe links the physics headers directly, so it needs no DLL and no host.
param([switch]$Install, [switch]$Quick, [switch]$NoRun)
$ErrorActionPreference = 'Stop'

$bundle = Split-Path $PSScriptRoot -Parent
$mingw  = "C:\Users\pbog\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
$gxx    = "$mingw\g++.exe"
$analysis = "C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\Klein magnetometer\analysis"

# No fast-math and no FMA contraction anywhere: the reference engine must take
# the same branches as the JavaScript it is gated against, and the production
# engine must not drift from the reference for compiler reasons.
$common = @('-std=c++17','-O2','-fopenmp','-fno-fast-math','-ffp-contract=off',
            "-I$bundle\src",'-static','-static-libgcc','-static-libstdc++')

$stage = "$env:TEMP\klein-stage"
New-Item -ItemType Directory -Force $stage | Out-Null

Write-Host "linking probe.exe ..."
& $gxx @common -o "$stage\probe.exe" "$bundle\test\probe.cpp"
if ($LASTEXITCODE) { throw "probe link failed" }

if (-not $NoRun) {
    Write-Host "running probe ..."
    $args = @($analysis); if ($Quick) { $args += '--quick' }
    & "$stage\probe.exe" @args
    if ($LASTEXITCODE) { throw "probe FAILED - not installing" }
}

if ($Install -and (Test-Path "$bundle\src\plugin.cpp")) {
    Write-Host "linking klein-magnetometer.dll ..."
    & $gxx -shared @common -o "$stage\klein-magnetometer.dll" "$bundle\src\plugin.cpp"
    if ($LASTEXITCODE) { throw "DLL link failed" }
    $live = "$bundle\klein-magnetometer.dll"
    $old  = "$bundle\klein-magnetometer.old.dll"
    if (Test-Path $old) { Remove-Item $old -Force -ErrorAction SilentlyContinue }
    if (Test-Path $live) { Rename-Item $live $old -Force }   # works while loaded
    Copy-Item "$stage\klein-magnetometer.dll" $live
    Write-Host "installed. Restart dsw.exe to load it; delete the .old.dll next time."
}
