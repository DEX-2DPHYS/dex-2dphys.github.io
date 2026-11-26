# DTU Science Writer - development setup (once per PC). Dependencies live outside Dropbox:
#   %LOCALAPPDATA%\dtu-science-writer-build\node_modules   (Electron, ProseMirror, MathLive, Temml, ...)
#   %LOCALAPPDATA%\dtu-science-writer-build\bin\typst.exe  (pinned Typst version)
# Usage: powershell -File tools\setup.ps1
$ErrorActionPreference = 'Stop'
$TypstVersion = '0.15.1'
$build = Join-Path $env:LOCALAPPDATA 'dtu-science-writer-build'
New-Item -ItemType Directory -Force (Join-Path $build 'bin') | Out-Null

$pkg = @'
{"name":"dtu-science-writer-build","private":true,"dependencies":{
"electron":"45.4.1","electron-builder":"26.18.0","esbuild":"0.28.2",
"prosemirror-model":"1.25.13","prosemirror-state":"1.4.4","prosemirror-view":"1.44.0","prosemirror-commands":"1.7.2","prosemirror-keymap":"1.2.3","prosemirror-history":"1.5.2","prosemirror-inputrules":"1.7.0","prosemirror-schema-list":"1.6.1","prosemirror-dropcursor":"1.8.4","prosemirror-gapcursor":"1.4.1","prosemirror-tables":"1.8.5","prosemirror-transform":"1.12.7",
"mathlive":"0.111.4","temml":"0.14.0","citeproc":"2.4.63","tex2typst":"0.6.2","jszip":"3.10.2"}}
'@
Set-Content -Path (Join-Path $build 'package.json') -Value $pkg -Encoding utf8
Push-Location $build
try {
  npm install --no-audit --no-fund
  if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) { node node_modules\electron\install.js }
} finally { Pop-Location }

$typst = Join-Path $build 'bin\typst.exe'
$have = if (Test-Path $typst) { (& $typst --version) } else { '' }
if ($have -notmatch [regex]::Escape($TypstVersion)) {
  $zip = Join-Path $build 'bin\typst.zip'
  Invoke-WebRequest "https://github.com/typst/typst/releases/download/v$TypstVersion/typst-x86_64-pc-windows-msvc.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath (Join-Path $build 'bin') -Force
  Move-Item -Force (Join-Path $build 'bin\typst-x86_64-pc-windows-msvc\typst.exe') $typst
  Remove-Item -Recurse -Force (Join-Path $build 'bin\typst-x86_64-pc-windows-msvc'), $zip
}
& $typst --version
node (Join-Path $PSScriptRoot 'build.js')
