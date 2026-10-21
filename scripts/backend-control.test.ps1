$ErrorActionPreference = 'Stop'
$controlScript = Join-Path $PSScriptRoot 'backend-control.ps1'
$syntaxTokens = $null
$syntaxErrors = $null
[Management.Automation.Language.Parser]::ParseFile($controlScript, [ref]$syntaxTokens, [ref]$syntaxErrors) | Out-Null
if ($syntaxErrors.Count) { throw 'Control script contains PowerShell syntax errors.' }

# This test owns a temporary port, never the running application's port.
$testListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$testListener.Start()
try {
    $testPort = $testListener.LocalEndpoint.Port
    foreach ($operation in @('start', 'stop')) {
        $resultFile = [IO.Path]::GetTempFileName()
        try {
            $testProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-File', ('"' + $controlScript + '"'), '-Action', $operation, '-Port', $testPort) -WindowStyle Hidden -PassThru -Wait -RedirectStandardError $resultFile
            if ($testProcess.ExitCode -eq 0) { throw "$operation unexpectedly accepted an unrelated listener." }
            $message = Get-Content -LiteralPath $resultFile -Raw
            if ($message -notmatch 'cannot verify') { throw "Unexpected error during $operation ownership test." }
            if (!$testListener.Server.IsBound) { throw 'Unrelated listener was affected.' }
        } finally { Remove-Item -LiteralPath $resultFile -Force }
    }
    Write-Host 'PASS: start and stop both refuse an unrelated process; temporary listener remains bound.'
} finally { $testListener.Stop() }
