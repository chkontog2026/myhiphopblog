$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

py -3 -m unittest -v
if ($LASTEXITCODE -ne 0) { throw "Tests failed" }

$buildStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workPath = Join-Path $projectRoot ("build-" + $buildStamp)
$specPath = Join-Path $projectRoot ("spec-" + $buildStamp)
New-Item -ItemType Directory -Force -Path $specPath | Out-Null

py -3 -m PyInstaller --noconfirm --onefile --windowed --name "Greek MP3 Metadata" --collect-all mutagen --workpath $workPath --specpath $specPath app.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

Write-Host "Built: $projectRoot\dist\Greek MP3 Metadata.exe"
