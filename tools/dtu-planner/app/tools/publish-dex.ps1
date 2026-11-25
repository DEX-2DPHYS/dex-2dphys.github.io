# Copy the DTU Planner source into a DEX repository checkout (tools/dtu-planner/app), mirroring deletions.
# Use a clean worktree of origin/main, not the Dropbox checkout (that one may sit on another branch):
#   git -C <dex> worktree add -b dtu-planner-<ver> <scratch> origin/main
#   powershell -File tools\publish-dex.ps1 <scratch>
# then commit, push to main, and push the tag dtu-planner-v<version> to start the release build.
param([Parameter(Mandatory = $true)][string]$Dex)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $Dex 'tools\dtu-planner\app'
if (-not (Test-Path (Join-Path $Dex 'tools\manifest.json'))) { throw "not a DEX checkout: $Dex" }
New-Item -ItemType Directory $dst -Force | Out-Null
foreach ($d in 'main', 'renderer', 'shared', 'assets') {
  robocopy (Join-Path $src $d) (Join-Path $dst $d) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $d ($LASTEXITCODE)" }
}
New-Item -ItemType Directory (Join-Path $dst 'tools') -Force | Out-Null
Copy-Item (Join-Path $src 'tools\build-exe.ps1'), (Join-Path $src 'tools\publish-dex.ps1') (Join-Path $dst 'tools') -Force
foreach ($f in 'package.json', 'LICENSE', 'README.md', 'DESIGN.md') { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
$v = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).version
"copied DTU Planner $v to $dst"
"next: commit, push to main, then: git tag dtu-planner-v$v; git push origin dtu-planner-v$v"
$global:LASTEXITCODE = 0
