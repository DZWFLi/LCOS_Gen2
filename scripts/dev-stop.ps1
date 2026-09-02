# 停止 LCOS Gen2 dev 环境的服务（按端口杀监听进程树）
# 覆盖: LCOS Core 43130 / Huabu server 3001 / Huabu web (vite) 5173
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/dev-stop.ps1

$ErrorActionPreference = 'Continue'
$ports = 43121, 3001, 5173

foreach ($p in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { Write-Host "port $p : 无监听（已停）"; continue }

  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    if ($procId -eq 0) { continue }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    # 杀进程树（node/pnpm 会派生 watcher 子进程）
    Write-Host "port $p : 终止 $($proc.ProcessName) (pid $procId) 及其子进程"
    taskkill /PID $procId /T /F 2>$null | Out-Null
  }
  Start-Sleep -Milliseconds 400
  if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "port $p : 仍有监听，可能需要手动处理" -ForegroundColor Yellow
  } else {
    Write-Host "port $p : 已停" -ForegroundColor Green
  }
}
Write-Host "done."
