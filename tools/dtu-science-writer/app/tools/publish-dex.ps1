# Copy DTU Science Writer into a DEX repository checkout for a release:
#   tools/dtu-science-writer/app             the app source the release workflow builds (mirroring deletions)
#   .github/workflows/dtu-science-writer-release.yml
# The download page (tools/dtu-science-writer/index.html, tool.json, preview image, manifest entry) is made
# once by hand following the DEX card rules, then kept.
# Use a clean worktree of origin/main, never the Dropbox checkout (it may sit on another branch):
#   git -C <dex> worktree add -b dtu-science-writer-<ver> <scratch> origin/main
#   powershell -File tools\publish-dex.ps1 <scratch>
#   then commit, push to main, and: git tag dtu-science-writer-v<version>; git push origin dtu-science-writer-v<version>
param([Parameter(Mandatory = $true)][string]$Dex)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Dex 'tools\manifest.json'))) { throw "not a DEX checkout: $Dex" }

node (Join-Path $src 'tools\build.js')            # renderer/bundle.js must be current: the workflow does not build it
if ($LASTEXITCODE -ne 0) { throw 'bundle build failed' }

$dst = Join-Path $Dex 'tools\dtu-science-writer\app'
New-Item -ItemType Directory $dst -Force | Out-Null
foreach ($d in 'main', 'renderer', 'assets', 'vendor', 'src') {
  robocopy (Join-Path $src $d) (Join-Path $dst $d) /MIR /XF bundle.js.map /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $d ($LASTEXITCODE)" }
}
New-Item -ItemType Directory (Join-Path $dst 'tools') -Force | Out-Null
foreach ($f in 'build.js', 'core-entry.js', 'setup.ps1', 'build-exe.ps1', 'publish-dex.ps1', 'check-symbols.js', 'make-ico.js', 'icon.typ', 'sign-latest.js') { Copy-Item (Join-Path $src "tools\$f") (Join-Path $dst 'tools') -Force }
foreach ($f in 'package.json', 'LICENSE', 'README.md', 'DESIGN.md') { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
$wf = Join-Path $Dex '.github\workflows'
New-Item -ItemType Directory $wf -Force | Out-Null
Copy-Item (Join-Path $src 'tools\dex\dtu-science-writer-release.yml') (Join-Path $wf 'dtu-science-writer-release.yml') -Force
$v = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).version
"copied DTU Science Writer $v to $dst (+ release workflow)"
"next: commit, push to main, then: git tag dtu-science-writer-v$v; git push origin dtu-science-writer-v$v"
$global:LASTEXITCODE = 0
