# Starts DATAFIX AI Backend (http://127.0.0.1:8000) and Frontend (http://127.0.0.1:5174)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting DATAFIX AI Backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process -FilePath (Join-Path $root 'backend\.venv\Scripts\python.exe') `
  -ArgumentList 'run.py' `
  -WorkingDirectory (Join-Path $root 'backend')

Write-Host "Waiting for backend health check..." -ForegroundColor Gray
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $res = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 2
    if ($res.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  Write-Error "Backend failed to respond on http://127.0.0.1:8000/health"
  exit 1
}
Write-Host "Backend healthy at http://127.0.0.1:8000/health" -ForegroundColor Green

Write-Host "Starting DATAFIX AI Frontend on http://127.0.0.1:5174 ..." -ForegroundColor Cyan
Set-Location (Join-Path $root 'frontend')
npm run dev
