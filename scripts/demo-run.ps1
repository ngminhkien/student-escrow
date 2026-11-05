# Starts a demo from a brand-new chain: deploys, removes what the old chain made false from SQL, then attests verified KYC on chain.
# Each server opens in its own window. -Restart first stops whatever listens on the demo ports.
param([switch] $Restart, [string] $WindowStyle = 'Normal')

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ports = 8545, 5180, 5173
$dotnet = Join-Path $PSScriptRoot 'dotnet.ps1'
$walletsFile = Join-Path $repo 'blockchain\deployment\local\kyc-wallets.json'

function Get-Listener([int] $port) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 }
function Stop-Port([int] $port) {
    $listener = Get-Listener $port
    if ($listener) { & taskkill.exe /PID $listener.OwningProcess /T /F 2>$null | Out-Null }
}
function Open-Window([string] $title, [string] $directory, [string] $command) {
    $script = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location -LiteralPath '$directory'; $command"
    Start-Process powershell.exe -WindowStyle $WindowStyle -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $script | Out-Null
}
function Wait-Until([string] $what, [int] $seconds, [scriptblock] $ready) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try { if (& $ready) { return } } catch { }
        Start-Sleep -Seconds 1
    }
    throw "$what chưa sẵn sàng sau $seconds giây."
}
function Invoke-Checked([string] $what, [scriptblock] $command) {
    # npm and hardhat write progress to stderr, which Windows PowerShell would turn into a terminating error.
    $ErrorActionPreference = 'Continue'
    & $command 2>&1 | ForEach-Object { Write-Host "$_" }
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0) { throw "$what thất bại (mã $code)." }
}
function Get-NodeBlock {
    $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8545' -Method Post -ContentType 'application/json' -TimeoutSec 2 -Body '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
    [Convert]::ToInt64($reply.result, 16)
}

if ($Restart) { foreach ($port in $ports) { Stop-Port $port } ; Start-Sleep -Seconds 2 }
$busy = @($ports | Where-Object { Get-Listener $_ })
if ($busy.Count) { throw "Cổng $($busy -join ', ') đang bận. Tắt chương trình đó hoặc chạy lại với -Restart." }

# Built first: a compile error must not leave SQL emptied with no API to use it.
Write-Host '[1/5] Build API...'
Invoke-Checked 'Build API' { & $dotnet build backend/StudentEscrow.API -v q }

Write-Host '[2/5] Bật Hardhat node và deploy contract...'
Open-Window 'Hardhat node' "$repo\blockchain" 'npm run node'
try {
    Wait-Until 'Hardhat node' 60 { (Get-NodeBlock) -ge 0 }
    if ((Get-NodeBlock) -ne 0) { throw 'Node không phải chain mới.' }
    Push-Location (Join-Path $repo 'blockchain')
    try { Invoke-Checked 'Deploy' { npm run deploy:local } } finally { Pop-Location }
} catch {
    Stop-Port 8545
    throw
}

Write-Host '[3/5] Sao lưu DB và xóa dữ liệu không còn đúng với chain...'
Invoke-Checked 'Làm sạch DB' { & $dotnet run --project backend/StudentEscrow.API --launch-profile http --no-build -- "--demo-reset=$walletsFile" }

Write-Host '[4/5] Chỉ giữ ETH ở ví #0, xác minh các ví có KYC VERIFIED và đặt Admin làm Arbiter...'
$env:ESCROW_KYC_WALLETS = $walletsFile
Push-Location (Join-Path $repo 'blockchain')
try { Invoke-Checked 'Xác minh ví' { npm run demo:seed } } finally { Pop-Location }

Write-Host '[5/5] Bật API và frontend...'
# The window keeps only its last screen, so the full log also goes to a file.
$apiLog = Join-Path $repo '.artifacts\logs\api.log'
New-Item -ItemType Directory -Force (Split-Path -Parent $apiLog) | Out-Null
Open-Window 'StudentEscrow API' $repo "& '$PSScriptRoot\start-backend.ps1' -NoBuild | Tee-Object -FilePath '$apiLog'"
Wait-Until 'API' 120 { (Invoke-RestMethod -Uri 'http://localhost:5180/api/health/blockchain' -TimeoutSec 2).status -eq 'Ready' }
Open-Window 'StudentEscrow frontend' "$repo\frontend" 'npm run dev'
Wait-Until 'Frontend' 60 { Get-Listener 5173 }

Write-Host ''
Write-Host 'Sẵn sàng: http://localhost:5173'
Write-Host 'Trước khi demo: xóa dữ liệu hoạt động của từng tài khoản trong MetaMask (Settings > Advanced).'
