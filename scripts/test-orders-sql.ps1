param([string] $ConnectionString = 'Server=.\MINHKIEN1;Database=StudentEscrowDb;Integrated Security=True;Encrypt=False;Connect Timeout=5')
$ErrorActionPreference = 'Stop'
$env:STUDENT_ESCROW_SQL_TEST_CONNECTION = $ConnectionString
& (Join-Path $PSScriptRoot 'dotnet.ps1') test StudentEscrow.slnx --no-restore
exit $LASTEXITCODE
