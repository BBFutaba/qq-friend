param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskNode = (Get-Command node.exe).Source
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'data\connections.json'))) { & $taskNode 'scripts/setup.js' }
$taskHealthy = $false
try { $taskHealth = Invoke-RestMethod 'http://127.0.0.1:4891/healthz' -TimeoutSec 2; $taskHealthy = $taskHealth.ok -and $taskHealth.app -eq 'qq-friend' } catch {}
if (-not $taskHealthy) {
    # Start through WMI so the server is not a child of this shell. A launcher inside a Windows job
    # object (an AI agent's terminal, for example) would otherwise take the server down when it closes.
    $taskCommand = 'cmd.exe /d /c ""{0}" src\server.js 1>data\server.stdout.log 2>data\server.stderr.log"' -f $taskNode
    $taskStartup = New-CimInstance -Namespace root/cimv2 -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $taskResult = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $taskCommand; CurrentDirectory = $taskRoot; ProcessStartupInformation = $taskStartup }
    if ($taskResult.ReturnValue -ne 0) { throw "服务进程创建失败（Win32_Process.Create 返回 $($taskResult.ReturnValue)）" }
    for ($taskTry = 0; $taskTry -lt 30; $taskTry++) { Start-Sleep -Milliseconds 300; try { $taskHealth = Invoke-RestMethod 'http://127.0.0.1:4891/healthz' -TimeoutSec 1; if ($taskHealth.ok) { $taskHealthy = $true; break } } catch {} }
}
if (-not $taskHealthy) { throw '服务未启动，请查看 data/server.stderr.log' }
if ($NoBrowser) { Write-Output "QQ群友 正在运行：http://127.0.0.1:4891（v$($taskHealth.version)）"; exit 0 }
$taskConnections = Get-Content -LiteralPath (Join-Path $taskRoot 'data\connections.json') -Raw | ConvertFrom-Json
Start-Process ('http://127.0.0.1:4891/#' + $taskConnections.adminToken)
