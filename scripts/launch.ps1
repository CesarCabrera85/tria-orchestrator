$ErrorActionPreference = 'Stop'
$triaRoot = Split-Path -Parent $PSScriptRoot
$triaData = Join-Path $triaRoot '.tria'
$triaUrl = 'http://127.0.0.1:4310'
try {
    $response = Invoke-WebRequest -Uri "$triaUrl/api/settings" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { Start-Process $triaUrl; exit 0 }
} catch {}
New-Item -ItemType Directory -Force -Path $triaData | Out-Null
$triaNode = (Get-Command node.exe).Source
Start-Process -FilePath $triaNode -ArgumentList @('bin/tria.mjs','start','--data','.tria') -WorkingDirectory $triaRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $triaData 'server.stdout.log') -RedirectStandardError (Join-Path $triaData 'server.stderr.log')
for ($triaAttempt = 0; $triaAttempt -lt 30; $triaAttempt++) {
    try {
        $response = Invoke-WebRequest -Uri "$triaUrl/api/settings" -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200) { Start-Process $triaUrl; exit 0 }
    } catch {}
    Start-Sleep -Milliseconds 300
}
Write-Error 'Tria no ha arrancado. Consulta .tria/server.stderr.log.'
