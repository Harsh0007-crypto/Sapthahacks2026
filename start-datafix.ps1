<#
.SYNOPSIS
  Starts the DATAFIX AI FastAPI backend (127.0.0.1:8000) and Vite frontend (127.0.0.1:5174).

.DESCRIPTION
  - Launches the FastAPI backend via backend\.venv\Scripts\python.exe (backend\run.py) on 127.0.0.1:8000.
  - Launches the Vite frontend on 127.0.0.1:5174.
  - Verifies both services respond before opening the frontend in the default browser.
  - Detects port conflicts and startup failures cleanly without touching existing databases or files.
  - Press Ctrl+C to stop only the processes started by this script.

.PARAMETER NoBrowser
  Skip automatically opening the browser after startup (useful for automated checks).

.PARAMETER StartupTimeoutSeconds
  Maximum seconds to wait for each service to respond (default: 30).
#>
[CmdletBinding()]
param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5174,
    [switch]$NoBrowser,
    [switch]$CheckOnly,
    [int]$StartupTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir  = Join-Path $ProjectRoot 'backend'
$FrontendDir = Join-Path $ProjectRoot 'frontend'
$VenvPython  = Join-Path $BackendDir '.venv\Scripts\python.exe'
$BackendEntry = Join-Path $BackendDir 'run.py'
$ViteBin     = Join-Path $FrontendDir 'node_modules\vite\bin\vite.js'

$BackendHost = '127.0.0.1'
$FrontendHost = '127.0.0.1'

$BackendUrl  = "http://${BackendHost}:${BackendPort}"
$BackendHealthUrl = "${BackendUrl}/health"
$FrontendUrl = "http://${FrontendHost}:${FrontendPort}"

$RunStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackendOutLog  = Join-Path $env:TEMP "datafix-backend-$RunStamp.out.log"
$BackendErrLog  = Join-Path $env:TEMP "datafix-backend-$RunStamp.err.log"
$FrontendOutLog = Join-Path $env:TEMP "datafix-frontend-$RunStamp.out.log"
$FrontendErrLog = Join-Path $env:TEMP "datafix-frontend-$RunStamp.err.log"

$StartedProcesses = New-Object System.Collections.Generic.List[object]

function Write-Step {
    param([string]$Message)
    Write-Host "[DATAFIX] $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[DATAFIX] $Message" -ForegroundColor Green
}

function Write-WarnMsg {
    param([string]$Message)
    Write-Host "[DATAFIX] $Message" -ForegroundColor Yellow
}

function Write-ErrMsg {
    param([string]$Message)
    Write-Host "[DATAFIX] ERROR: $Message" -ForegroundColor Red
}

function Get-PortOwner {
    param([int]$Port)

    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
            return [pscustomobject]@{
                InUse       = $true
                Pid         = $conn.OwningProcess
                ProcessName = $name
            }
        }
    } catch {
        # Fall back to a direct TCP bind check below
    }

    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
        $listener.Start()
        return [pscustomobject]@{ InUse = $false; Pid = $null; ProcessName = $null }
    } catch [System.Net.Sockets.SocketException] {
        if ($_.Exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AddressAlreadyInUse) {
            return [pscustomobject]@{ InUse = $true; Pid = $null; ProcessName = 'another process' }
        }
        throw "Unable to bind port ${Port} on 127.0.0.1: $($_.Exception.Message)"
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Show-LogTail {
    param(
        [string]$Label,
        [string]$OutLog,
        [string]$ErrLog
    )

    foreach ($pair in @(@('stdout', $OutLog), @('stderr', $ErrLog))) {
        $kind = $pair[0]
        $path = $pair[1]
        if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Length -gt 0)) {
            Write-WarnMsg "--- $Label ($kind) ---"
            Get-Content -LiteralPath $path -Tail 25 | ForEach-Object { Write-Host "  $_" }
        }
    }
}

function Wait-ForHttpReady {
    param(
        [string]$Name,
        [string]$Url,
        [System.Diagnostics.Process]$Process,
        [string]$OutLog,
        [string]$ErrLog,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            Write-ErrMsg "$Name exited prematurely with exit code $($Process.ExitCode)."
            Show-LogTail -Label $Name -OutLog $OutLog -ErrLog $ErrLog
            return $false
        }

        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
                return $true
            }
        } catch {
            # Service still starting
        }

        Start-Sleep -Milliseconds 400
    }

    Write-ErrMsg "$Name did not respond at $Url within ${TimeoutSeconds}s."
    Show-LogTail -Label $Name -OutLog $OutLog -ErrLog $ErrLog
    return $false
}

function Stop-StartedProcesses {
    if ($StartedProcesses.Count -eq 0) {
        return
    }

    Write-Host ''
    Write-Step 'Stopping DATAFIX processes started by this script...'

    for ($i = $StartedProcesses.Count - 1; $i -ge 0; $i--) {
        $entry = $StartedProcesses[$i]
        $proc = $entry.Process
        $label = $entry.Name

        try {
            if ($proc -and (-not $proc.HasExited)) {
                $targetPid = $proc.Id
                & taskkill.exe /PID $targetPid /T /F 2>$null | Out-Null
                try {
                    $proc.WaitForExit(3000) | Out-Null
                } catch {
                    # Ignore wait timeout after forced termination
                }
                Write-Ok "Stopped $label (PID $targetPid)."
            }
        } catch {
            Write-WarnMsg "Could not cleanly stop $label (PID $($proc.Id)): $($_.Exception.Message)"
        }
    }

    $StartedProcesses.Clear()
}

$exitCode = 0

try {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host '  DATAFIX AI — Local Full-Stack Launcher' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Step "Project root : $ProjectRoot"
    Write-Step "Backend URL  : $BackendUrl"
    Write-Step "Frontend URL : $FrontendUrl"

    # 1. Verify required project files and runtimes (preserving existing DB and files)
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        throw "Backend virtual environment Python not found at '$VenvPython'. Create backend\.venv and install backend\requirements.txt first."
    }
    if (-not (Test-Path -LiteralPath $BackendEntry)) {
        throw "Backend entry script not found at '$BackendEntry'."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir 'package.json'))) {
        throw "Frontend package.json not found in '$FrontendDir'."
    }

    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    }
    if (-not $nodeCmd) {
        throw 'Node.js was not found on PATH. Install Node.js before running DATAFIX frontend.'
    }

    # 2. Detect port conflicts before launching anything
    $backendPortStatus = Get-PortOwner -Port $BackendPort
    if ($backendPortStatus.InUse) {
        $owner = if ($backendPortStatus.Pid) { "$($backendPortStatus.ProcessName) (PID $($backendPortStatus.Pid))" } else { 'another process' }
        throw "Port $BackendPort on $BackendHost is already in use by $owner. Stop it before starting DATAFIX."
    }

    $frontendPortStatus = Get-PortOwner -Port $FrontendPort
    if ($frontendPortStatus.InUse) {
        $owner = if ($frontendPortStatus.Pid) { "$($frontendPortStatus.ProcessName) (PID $($frontendPortStatus.Pid))" } else { 'another process' }
        throw "Port $FrontendPort on $FrontendHost is already in use by $owner. Stop it before starting DATAFIX."
    }

    # 3. Start FastAPI backend using backend\.venv on 127.0.0.1:8000
    Write-Step "Starting FastAPI backend on $BackendUrl..."
    $prevHost = $env:BACKEND_HOST
    $prevPort = $env:BACKEND_PORT
    try {
        $env:BACKEND_HOST = $BackendHost
        $env:BACKEND_PORT = [string]$BackendPort
        $backendProc = Start-Process `
            -FilePath $VenvPython `
            -ArgumentList @('run.py') `
            -WorkingDirectory $BackendDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $BackendOutLog `
            -RedirectStandardError $BackendErrLog `
            -PassThru
    } finally {
        $env:BACKEND_HOST = $prevHost
        $env:BACKEND_PORT = $prevPort
    }

    $StartedProcesses.Add([pscustomobject]@{ Name = 'Backend (FastAPI)'; Process = $backendProc })

    if (-not (Wait-ForHttpReady -Name 'FastAPI backend' -Url $BackendHealthUrl -Process $backendProc -OutLog $BackendOutLog -ErrLog $BackendErrLog -TimeoutSeconds $StartupTimeoutSeconds)) {
        throw 'FastAPI backend failed startup health check.'
    }
    Write-Ok "Backend is healthy at $BackendHealthUrl (PID $($backendProc.Id))."

    # 4. Start Vite frontend on 127.0.0.1:5174
    Write-Step "Starting Vite frontend on $FrontendUrl..."
    $prevApiBase = $env:VITE_API_BASE_URL
    try {
        $env:VITE_API_BASE_URL = $BackendUrl
        if (Test-Path -LiteralPath $ViteBin) {
            $frontendProc = Start-Process `
                -FilePath $nodeCmd.Source `
                -ArgumentList @('node_modules\vite\bin\vite.js', '--host', $FrontendHost, '--port', [string]$FrontendPort, '--strictPort') `
                -WorkingDirectory $FrontendDir `
                -WindowStyle Hidden `
                -RedirectStandardOutput $FrontendOutLog `
                -RedirectStandardError $FrontendErrLog `
                -PassThru
        } else {
            $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if (-not $npmCmd) {
                throw "Neither '$ViteBin' nor npm.cmd was found. Run 'npm install' inside frontend first."
            }
            $frontendProc = Start-Process `
                -FilePath $npmCmd.Source `
                -ArgumentList @('run', 'dev', '--', '--host', $FrontendHost, '--port', [string]$FrontendPort, '--strictPort') `
                -WorkingDirectory $FrontendDir `
                -WindowStyle Hidden `
                -RedirectStandardOutput $FrontendOutLog `
                -RedirectStandardError $FrontendErrLog `
                -PassThru
        }
    } finally {
        $env:VITE_API_BASE_URL = $prevApiBase
    }

    $StartedProcesses.Add([pscustomobject]@{ Name = 'Frontend (Vite)'; Process = $frontendProc })

    if (-not (Wait-ForHttpReady -Name 'Vite frontend' -Url $FrontendUrl -Process $frontendProc -OutLog $FrontendOutLog -ErrLog $FrontendErrLog -TimeoutSeconds $StartupTimeoutSeconds)) {
        throw 'Vite frontend failed startup check.'
    }
    Write-Ok "Frontend is responding at $FrontendUrl (PID $($frontendProc.Id))."

    # Verify Vite -> Backend proxy health as well
    try {
        $proxyResp = Invoke-RestMethod -Uri "${FrontendUrl}/health" -TimeoutSec 3 -ErrorAction Stop
        Write-Ok "Frontend-to-backend proxy verified (status=$($proxyResp.status), db=$($proxyResp.database))."
    } catch {
        Write-WarnMsg "Frontend proxy /health check returned a warning: $($_.Exception.Message)"
    }

    # 5. Open frontend in default browser
    if (-not $NoBrowser) {
        Write-Step "Opening $FrontendUrl in your default browser..."
        Start-Process $FrontendUrl | Out-Null
    }

    Write-Host ''
    Write-Host '------------------------------------------------------------' -ForegroundColor DarkCyan
    Write-Ok "DATAFIX AI is running!"
    Write-Host "  Frontend : $FrontendUrl" -ForegroundColor White
    Write-Host "  Backend  : $BackendUrl  (Docs: ${BackendUrl}/docs)" -ForegroundColor White
    Write-Host "  Logs     : $env:TEMP\datafix-*-$RunStamp.*.log" -ForegroundColor DarkGray
    Write-Host '  Press Ctrl+C to stop both services.' -ForegroundColor Yellow
    Write-Host '------------------------------------------------------------' -ForegroundColor DarkCyan

    if ($CheckOnly) {
        Write-Ok 'Startup verification succeeded (-CheckOnly). Cleaning up started processes...'
    } else {
        # 6. Keep running until Ctrl+C or either child process exits unexpectedly
        while ($true) {
            if ($backendProc.HasExited) {
                Write-ErrMsg "Backend process exited unexpectedly (exit code $($backendProc.ExitCode))."
                Show-LogTail -Label 'FastAPI backend' -OutLog $BackendOutLog -ErrLog $BackendErrLog
                $exitCode = 1
                break
            }
            if ($frontendProc.HasExited) {
                Write-ErrMsg "Frontend process exited unexpectedly (exit code $($frontendProc.ExitCode))."
                Show-LogTail -Label 'Vite frontend' -OutLog $FrontendOutLog -ErrLog $FrontendErrLog
                $exitCode = 1
                break
            }
            Start-Sleep -Milliseconds 500
        }
    }
} catch {
    Write-ErrMsg $_.Exception.Message
    $exitCode = 1
} finally {
    Stop-StartedProcesses
}

exit $exitCode
