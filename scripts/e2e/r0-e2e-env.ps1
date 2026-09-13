# R0-6 isolated e2e environment (never touches user dev data).
# ASCII-only on purpose: Windows PowerShell 5.1 parses .ps1 as ANSI unless it has a BOM.
#
# Usage (repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
#   powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 status
#   powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 ids
#   powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 down
#   powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 reset
#
# Isolation:
# - ports differ from user dev: Core 43131 / Huabu server 3011 / web 5273 (user dev: 43121/3001/5173)
# - all data under <repo>\.e2e-data\ (gitignored); never apps/local-core/.data or huabu/apps/server/data
# - Core seeds lcos-gen2-dev on an empty DB via ensureRealDevProject(), so the same fixture can be
#   rebuilt from an empty directory; repeated `up` reuses the same DB (idempotent)

param([ValidateSet('up', 'down', 'status', 'reset', 'ids')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DataRoot = Join-Path $RepoRoot '.e2e-data'
$CoreDb = Join-Path $DataRoot 'core\e2e-core.sqlite'
$CoreWs = Join-Path $DataRoot 'core\workspace'
$HuabuData = Join-Path $DataRoot 'huabu'
$HuabuWs = Join-Path $DataRoot 'huabu-workspace'
$LogDir = Join-Path $DataRoot 'logs'

$CORE_PORT = 43131
$API_PORT = 3011
$WEB_PORT = 5273
# Token must match what the web app sends: it reads LCOS_CORE_TOKEN from import.meta.env, and Vite
# only exposes VITE_* to the client, so the client effectively always uses the 'dev-token' default.
# Isolation here is about data/ports, not about the token.
$TOKEN = 'dev-token'

function Test-Port([int]$Port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $Port); $c.Close(); return $true } catch { return $false }
}

function Get-PortOwner([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

function Show-Status {
  Write-Host "== R0-6 isolated e2e env ==" -ForegroundColor Cyan
  Write-Host "  repo        : $RepoRoot"
  Write-Host "  data root   : $DataRoot"
  Write-Host "  core db     : $CoreDb"
  Write-Host "  core ws     : $CoreWs"
  Write-Host "  huabu data  : $HuabuData"
  foreach ($p in @($CORE_PORT, $API_PORT, $WEB_PORT)) {
    $owner = Get-PortOwner $p
    if ($owner) { Write-Host "  port $p : UP (pid $owner)" -ForegroundColor Green } else { Write-Host "  port $p : down" }
  }
  Write-Host "  web url     : http://localhost:$WEB_PORT/projects/lcos-gen2-dev/main"
}

switch ($Action) {
  'up' {
    if (Test-Port $CORE_PORT) {
      Write-Host "[warn] core port $CORE_PORT already up; reusing it" -ForegroundColor Yellow
    } else {
      New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'core'), $CoreWs, $HuabuData, $LogDir | Out-Null
      Write-Host "== start isolated Local Core (:$CORE_PORT) ==" -ForegroundColor Cyan
      $coreCmd = "`$env:LOCAL_CORE_DB_PATH='$CoreDb'; `$env:LOCAL_CORE_DEV_WORKSPACE_ROOT='$CoreWs'; `$env:LOCAL_CORE_TEST_PORT='$CORE_PORT'; `$env:LOCAL_CORE_API_TOKEN='$TOKEN'; `$env:LOCAL_CORE_ALLOWED_ORIGINS='http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT'; npm run dev:local-core"
      Start-Process powershell -WorkingDirectory $RepoRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'core.out.log') `
        -RedirectStandardError (Join-Path $LogDir 'core.err.log') `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $coreCmd
      $deadline = (Get-Date).AddSeconds(180)
      while ((Get-Date) -lt $deadline -and -not (Test-Port $CORE_PORT)) { Start-Sleep -Milliseconds 900 }
      if (-not (Test-Port $CORE_PORT)) { throw "isolated Core did not listen on $CORE_PORT within 180s; see $LogDir\core.err.log" }
      Write-Host "  isolated Core OK" -ForegroundColor Green
    }
    if (Test-Port $WEB_PORT) {
      Write-Host "[warn] web port $WEB_PORT already up; reusing it" -ForegroundColor Yellow
    } else {
      New-Item -ItemType Directory -Force -Path $HuabuData, $HuabuWs, $LogDir | Out-Null
      Write-Host "== start isolated Huabu server (:$API_PORT) + web (:$WEB_PORT) ==" -ForegroundColor Cyan
      # HUABU_WORKSPACE locks the server workspace root at boot (workspace.ts::initWorkspaceFromEnv).
      # Without it an empty HUABU_DATA_DIR sends the app to /setup (first-run wizard) and project
      # routes never mount.
      $huabuCmd = "`$env:HUABU_CONNECTION_TOKEN='$TOKEN'; `$env:HUABU_DATA_DIR='$HuabuData'; `$env:HUABU_WORKSPACE='$HuabuWs'; `$env:SERVER_PORT='$API_PORT'; `$env:WEB_PORT='$WEB_PORT'; `$env:VITE_LCOS_CORE_TARGET='http://127.0.0.1:$CORE_PORT'; pnpm dev"
      Start-Process powershell -WorkingDirectory (Join-Path $RepoRoot 'huabu') -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $LogDir 'huabu.out.log') `
        -RedirectStandardError (Join-Path $LogDir 'huabu.err.log') `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $huabuCmd
      $deadline = (Get-Date).AddSeconds(300)
      while ((Get-Date) -lt $deadline -and -not (Test-Port $WEB_PORT)) { Start-Sleep -Milliseconds 1200 }
      if (-not (Test-Port $WEB_PORT)) { throw "isolated web did not listen on $WEB_PORT within 300s; see $LogDir\huabu.err.log" }
      Write-Host "  isolated web OK" -ForegroundColor Green
    }
    Show-Status
  }
  'down' {
    foreach ($p in @($CORE_PORT, $API_PORT, $WEB_PORT)) {
      $owner = Get-PortOwner $p
      if ($owner) { Write-Host "stopping port $p (pid $owner)"; Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue }
    }
    Write-Host "isolated ports stopped (user dev ports 43121/3001/5173 untouched)" -ForegroundColor Green
  }
  'reset' {
    $resolved = Resolve-Path $DataRoot -ErrorAction SilentlyContinue
    if (-not $resolved) { Write-Host "no $DataRoot; nothing to clean"; break }
    $target = $resolved.Path
    if ($target -ne $DataRoot -or -not $target.EndsWith('.e2e-data') -or -not $target.StartsWith($RepoRoot)) {
      throw "refusing to clean: $target failed absolute-path validation"
    }
    Remove-Item -Recurse -Force $target
    Write-Host "removed $target" -ForegroundColor Green
  }
  'ids' {
    $h = @{ Authorization = "Bearer $TOKEN" }
    $projects = (Invoke-WebRequest -Uri "http://127.0.0.1:$CORE_PORT/projects" -Headers $h -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
    foreach ($pr in $projects.value) {
      Write-Host "project: $($pr.id)  name=$($pr.name)"
      $ws = (Invoke-WebRequest -Uri "http://127.0.0.1:$CORE_PORT/projects/$($pr.id)/workspaces" -Headers $h -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
      foreach ($w in $ws.value) { Write-Host "  workspace=$($w.id) surface=$($w.preferredSurface) canvasId=$($w.canvasId)" }
    }
  }
  default { Show-Status }
}
