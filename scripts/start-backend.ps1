param([switch] $NoBuild, [switch] $Blockchain)

$ErrorActionPreference = 'Stop'
if ($Blockchain) { $env:Blockchain__Enabled = 'true' }
$arguments = @('run', '--project', 'backend/StudentEscrow.API', '--launch-profile', 'http')
if ($NoBuild) {
    $arguments += '--no-build'
}
& (Join-Path $PSScriptRoot 'dotnet.ps1') @arguments
exit $LASTEXITCODE
