# Temporary public preview of PesaFlow for testers:
#   https://<random>.trycloudflare.com  ->  production build on http://localhost:3001
#
#   powershell -ExecutionPolicy Bypass -File scripts\preview.ps1          # public link
#   powershell -ExecutionPolicy Bypass -File scripts\preview.ps1 -Local   # no tunnel (http://localhost:3001)
#
# Payments and messages stay in mock mode (no real money, reset codes printed here).
# The link works only while this window is open. Press Ctrl+C to take it down.
param([switch]$Local, [int]$Port = 3001)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot)
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
Refresh-Path

$tunnel = $null
if ($Local) {
  $url = "http://localhost:$Port"
} else {
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "Installing cloudflared (Cloudflare's tunnel tool)..."
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared didn't install. Close this window, open a new one and try again." }
  }
  $log = Join-Path $env:TEMP "pesaflow-tunnel.log"
  Remove-Item $log -ErrorAction SilentlyContinue
  Write-Host "Opening the tunnel..."
  $tunnel = Start-Process cloudflared -ArgumentList "tunnel", "--url", "http://localhost:$Port" -RedirectStandardError $log -NoNewWindow -PassThru
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) { $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
  }
  if (-not $url) { Stop-Process $tunnel -ErrorAction SilentlyContinue; throw "No tunnel link after 60 seconds. See $log" }
}

try {
  Write-Host "Building the app (about a minute)..."
  npm run build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Build failed. Run 'npm run build' to see why." }
  # The standalone server needs the static files next to it.
  Copy-Item .next\static .next\standalone\.next\static -Recurse -Force
  if (Test-Path public) { Copy-Item public .next\standalone\public -Recurse -Force }

  # Settings from .env (the standalone server doesn't read it from the project folder).
  foreach ($line in Get-Content .env) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $name = $Matches[1]; $value = $Matches[2].Trim()
      if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") { $value = $Matches[1] } else { $value = ($value -replace '\s+#.*$', '').Trim() }
      Set-Item "env:$name" $value
    }
  }
  $env:PUBLIC_URL = $url
  $env:PORT = "$Port"
  $env:HOSTNAME = "127.0.0.1"
  $env:NODE_ENV = "production"
  $env:MPESA_ENV = "mock"; $env:PADDLE_ENV = "mock"; $env:FLW_ENV = "mock"; $env:NOTIFY_ENV = "mock"

  Write-Host ""
  Write-Host "  PesaFlow preview: $url" -ForegroundColor Green
  Write-Host "  Share this link with testers. Payments are simulated. Ctrl+C to stop."
  Write-Host ""
  node .next\standalone\server.js
} finally {
  if ($tunnel) { Stop-Process $tunnel -ErrorAction SilentlyContinue }
}
