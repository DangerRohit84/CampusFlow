# start-adapter.ps1 — launches the OpenCode -> OpenAI adapter
# Auto-detects the running `opencode serve` port (it changes on every restart).

$ErrorActionPreference = "Stop"

# 1. Find an opencode process that is listening on TCP
$ocProcs = Get-Process -Name opencode -ErrorAction SilentlyContinue
if (-not $ocProcs) {
    Write-Host "[start-adapter] No running 'opencode' process found." -ForegroundColor Red
    Write-Host "                 Start one first:  opencode serve" -ForegroundColor Yellow
    exit 1
}

$port = $null
foreach ($p in $ocProcs) {
    $listen = Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue |
              Select-Object -ExpandProperty LocalPort
    if ($listen) { $port = ($listen | Sort-Object)[0]; break }
}

if (-not $port) {
    Write-Host "[start-adapter] opencode is running but not listening yet — wait a few seconds and retry." -ForegroundColor Red
    exit 1
}

Write-Host "[start-adapter] Found opencode serve on port $port"

# 2. Stop any previous adapter instance on 8081
$existing = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[start-adapter] Stopping previous adapter (PID $($existing.OwningProcess))..."
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
    Start-Sleep 1
}

# 3. Launch adapter with correct upstream URL
$env:OPENCODE_URL = "http://127.0.0.1:$port"
$script = Join-Path $PSScriptRoot "opencode-adapter.py"
Write-Host "[start-adapter] Launching adapter at http://localhost:8081/v1 ..." -ForegroundColor Green
python $script
