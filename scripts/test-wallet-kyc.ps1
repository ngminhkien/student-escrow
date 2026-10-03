param([string]$BaseUrl = 'http://localhost:5180')
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'dotnet.ps1') run --project tests/StudentEscrow.ApiSmoke --no-build --no-restore -- $BaseUrl
exit $LASTEXITCODE
