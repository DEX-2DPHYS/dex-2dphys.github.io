# Build 2dmd.dll + the offline probe on a machine with the WinLibs toolchain.
#   powershell -File test\build-2dmd.ps1            # build DLL + probe, run probe
#   powershell -File test\build-2dmd.ps1 -Install   # then swap the live DLL
# The link runs to a staging file first: a DSW host that has ever opened the
# plugin holds the live DLL, so the swap is rename-old + copy-new, and the host
# must be restarted to load the result (Refresh only rescans UI files).
param([switch]$Install)
$ErrorActionPreference = 'Stop'

$bundle = Split-Path $PSScriptRoot -Parent
$mingw  = "C:\Users\pbog\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
# the twin machine keeps LAMMPS at b\lammps, this one at the versioned name
$lmp = @("C:\Users\pbog\b\lammps-stable_22Jul2025_update5", "C:\Users\pbog\b\lammps") |
       Where-Object { Test-Path "$_\build\liblammps.a" } | Select-Object -First 1
if (-not $lmp) { throw "no liblammps.a found under C:\Users\pbog\b" }

$gxx = "$mingw\g++.exe"
$common = @('-std=c++17','-O3','-fopenmp','-DDMD_LAMMPS',
            "-I$bundle\src","-I$lmp\src","-L$lmp\build",
            '-static','-static-libgcc','-static-libstdc++')
$libs = @('-llammps','-lpsapi','-lws2_32')

$stage = "$env:TEMP\2dmd-stage"
New-Item -ItemType Directory -Force $stage | Out-Null

Write-Host "linking 2dmd.dll ..."
& $gxx -shared @common -o "$stage\2dmd.dll" "$bundle\src\plugin.cpp" "$bundle\src\dl_stub.cpp" @libs
if ($LASTEXITCODE) { throw "DLL link failed" }

Write-Host "linking probe2dmd.exe ..."
& $gxx @common -o "$stage\probe2dmd.exe" "$bundle\test\probe2dmd.cpp" "$bundle\src\plugin.cpp" "$bundle\src\dl_stub.cpp" @libs
if ($LASTEXITCODE) { throw "probe link failed" }

# bundleDir() resolves next to the running module - for the probe exe that is
# the staging folder, so the potentials ride along
Copy-Item "$bundle\potentials" "$stage\potentials" -Recurse -Force

Write-Host "running probe ..."
& "$stage\probe2dmd.exe"
if ($LASTEXITCODE) { throw "probe FAILED - not installing" }

if ($Install) {
    $live = "$bundle\2dmd.dll"
    $old  = "$bundle\2dmd.old.dll"
    if (Test-Path $old) { Remove-Item $old -Force -ErrorAction SilentlyContinue }
    if (Test-Path $live) { Rename-Item $live $old -Force }   # works while loaded
    Copy-Item "$stage\2dmd.dll" $live
    Write-Host "installed. Restart dsw.exe to load it; delete 2dmd.old.dll next time."
}
