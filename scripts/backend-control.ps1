param(
    [ValidateSet('status', 'start', 'stop')][string]$Action = 'status',
    [ValidateRange(1024, 65535)][int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$backendRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$entryPath = Join-Path $backendRoot 'dist\src\main.js'
$legacyLauncher = Join-Path (Split-Path $backendRoot -Parent) 'laptop-server.cjs'
$runtimeRoot = Join-Path $backendRoot '.runtime'

function Get-BackendListener {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Test-OwnedProcess([int]$ProcessId) {
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (!$candidate -or $candidate.Name -ne 'node.exe') { return $false }
    $knownEntry = '(?i)(?:^|[\s"])(?:' + [regex]::Escape($entryPath) + '|' + [regex]::Escape($legacyLauncher) + ')(?=["\s]|$)'
    return [bool]($candidate.CommandLine -match $knownEntry)
}

function Test-BackendHealth {
    try {
        $reply = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
        return ($reply.status -eq 'ok' -and $reply.service -eq 'quan-ly-chi-tieu')
    } catch { return $false }
}

$listener = Get-BackendListener
if ($Action -eq 'status') {
    [pscustomobject]@{
        Port = $Port
        Listening = [bool]$listener
        OwnedByProject = [bool]($listener -and (Test-OwnedProcess $listener.OwningProcess))
        Healthy = Test-BackendHealth
    } | ConvertTo-Json
    exit 0
}

if ($listener -and !(Test-OwnedProcess $listener.OwningProcess)) {
    throw "Port $Port belongs to a process this script cannot verify. No process was changed."
}

if ($Action -eq 'stop') {
    if (!$listener) { Write-Host "Backend is already stopped on port $Port."; exit 0 }
    Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
    Write-Host 'Backend stopped. Database and tunnel were left running.'
    exit 0
}

if ($listener) {
    if (!(Test-BackendHealth)) { throw 'Backend is running but unhealthy. Inspect logs before stopping it.' }
    Write-Host "Backend is already healthy on port $Port. No restart performed."
    exit 0
}
if (!(Test-Path -LiteralPath $entryPath)) { throw 'Backend build is missing. Run npm run build in backend first.' }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$previousPort = $env:PORT
try {
    $env:PORT = [string]$Port
    $started = Start-Process -FilePath $nodePath -ArgumentList @('--enable-source-maps', ('"' + $entryPath + '"')) -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'backend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'backend.err.log')
} finally { $env:PORT = $previousPort }
for ($attempt = 0; $attempt -lt 24; $attempt++) {
    if ($started.HasExited) { throw "Backend exited. Inspect $runtimeRoot\backend.err.log" }
    if (Test-BackendHealth) {
        Write-Host "Backend ready at http://127.0.0.1:$Port. No APK was built."
        exit 0
    }
    Start-Sleep -Milliseconds 500
}
throw "Backend did not become healthy yet. Inspect $runtimeRoot. It was not automatically restarted."
