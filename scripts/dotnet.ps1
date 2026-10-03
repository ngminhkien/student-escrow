$Arguments = @($args)
$ErrorActionPreference = 'Stop'
$codeRoot = Split-Path -Parent $PSScriptRoot
$sdkExecutable = Join-Path $env:USERPROFILE '.dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $sdkExecutable)) {
    $sdkExecutable = (Get-Command dotnet -ErrorAction Stop).Source
}
$env:DOTNET_ROOT = Split-Path -Parent $sdkExecutable
$env:PATH = $env:DOTNET_ROOT + [IO.Path]::PathSeparator + $env:PATH
$env:DOTNET_CLI_HOME = Join-Path $codeRoot '.runtime'
$env:NUGET_PACKAGES = Join-Path $codeRoot '.runtime\packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
Push-Location $codeRoot
try {
    & $sdkExecutable @Arguments
    $commandExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $commandExitCode
