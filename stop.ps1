$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskRuntimeFile = Join-Path $taskRoot 'data\runtime.json'
if (-not (Test-Path -LiteralPath $taskRuntimeFile)) { Write-Output '没有找到运行记录，服务可能没有启动。'; exit 0 }
$taskRuntime = Get-Content -LiteralPath $taskRuntimeFile -Raw | ConvertFrom-Json
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskRuntime.pid)"
if (-not $taskProcess) { Write-Output '服务已经停止。'; exit 0 }
# Only stop the process this app recorded, and only if it is still this app's server.
if ($taskProcess.Name -ne 'node.exe' -or $taskProcess.CommandLine -notmatch 'src[\\/]server\.js') { throw '记录的进程不是本应用的服务，没有停止任何进程。' }
Stop-Process -Id $taskRuntime.pid
Write-Output "已停止 QQ群友（PID $($taskRuntime.pid)）。下次双击「启动QQ群友.cmd」即可重新启动。"
