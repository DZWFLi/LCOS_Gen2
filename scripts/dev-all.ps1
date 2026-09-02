# LCOS Gen2 一键开发环境（拉齐老 LCOS 的 dev 脚本习惯）
# 同时拉起:
#   1. LCOS Local Core   (port 43130) — build + run, 窗口 "LCOS Core"
#   2. Huabu 全家桶      (server 3001 + web 5173, pnpm dev 编排器) — 窗口 "Huabu"
# 主窗口做端口健康探测, 全部就绪后打印入口 URL。
#
# 用法:  powershell -ExecutionPolicy Bypass -File scripts/dev-all.ps1
#   或:  npm run dev
# 停止:  关闭两个服务窗口, 或运行 scripts/dev-stop.ps1

param(
  # 跳过端口占用预检（默认占用时仅警告并继续）
  [switch]$SkipPortCheck
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

$CORE_PORT = 43121
$HUABU_API_PORT = 3001
$WEB_PORT = 5173
# Web 端默认读 HUABU_CONNECTION_TOKEN ?? 'dev-token'（useLcosCanvasProps）。
# Huabu server 未设该变量时每次启动随机铸币 → 必须两侧对齐。
# Core 同理：LOCAL_CORE_API_TOKEN 未设时随机铸币，前端默认 dev-token 会 401。
$env:HUABU_CONNECTION_TOKEN = 'dev-token'
$env:LOCAL_CORE_API_TOKEN = 'dev-token'

function Test-Port([int]$Port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $Port)
    $c.Close()
    return $true
  } catch { return $false }
}

function Wait-Port([int]$Port, [string]$Label, [int]$TimeoutSec = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  Write-Host "等待 $Label (port $Port)..." -NoNewline
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { Write-Host " OK" -ForegroundColor Green; return $true }
    Start-Sleep -Milliseconds 800
    Write-Host "." -NoNewline
  }
  Write-Host " 超时（看服务窗口里的报错）" -ForegroundColor Red
  return $false
}

# ── 0. 端口预检 ────────────────────────────────────────────────────────────
if (-not $SkipPortCheck) {
  foreach ($p in @($CORE_PORT, $HUABU_API_PORT, $WEB_PORT)) {
    if (Test-Port $p) {
      Write-Host "[warn] port $p 已被占用（可能有上次没停干净的服务）。" -ForegroundColor Yellow
      Write-Host "       先跑 scripts/dev-stop.ps1，或加 -SkipPortCheck 强行继续。" -ForegroundColor Yellow
      exit 1
    }
  }
}

# ── 1. 启动窗口：LCOS Core ────────────────────────────────────────────────
Write-Host "`n== 启动 LCOS Local Core (build + run, :$CORE_PORT) ==" -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory $RepoRoot `
  -WindowStyle Normal `
  -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `
    "`$Host.UI.RawUI.WindowTitle = 'LCOS Core :$CORE_PORT'; Write-Host '== LCOS Local Core ==' -ForegroundColor Cyan; npm run dev:local-core"

# ── 2. 启动窗口：Huabu（shared watch + server + web，pnpm dev 编排器）─────
Write-Host "== 启动 Huabu (server :$HUABU_API_PORT + web :$WEB_PORT) ==" -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory (Join-Path $RepoRoot 'huabu') `
  -WindowStyle Normal `
  -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `
    "`$Host.UI.RawUI.WindowTitle = 'Huabu dev (:3001 / :5173)'; `$env:HUABU_CONNECTION_TOKEN='dev-token'; Write-Host '== Huabu (HUABU_CONNECTION_TOKEN=dev-token) ==' -ForegroundColor Cyan; pnpm dev"

# ── 3. 健康探测 ────────────────────────────────────────────────────────────
Write-Host "`n开始健康探测（Core 首次 build 可能要 1-2 分钟）..."
$okCore = Wait-Port $CORE_PORT 'LCOS Core'
$okApi  = Wait-Port $HUABU_API_PORT 'Huabu server'
$okWeb  = Wait-Port $WEB_PORT 'Huabu web (vite)'

# ── 4. 汇总 ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==================== LCOS Gen2 dev ====================" -ForegroundColor Cyan
if ($okWeb) { Write-Host "  入口       : http://localhost:$WEB_PORT" -ForegroundColor White }
if ($okApi)  { Write-Host "  Huabu API  : http://127.0.0.1:$HUABU_API_PORT (token: dev-token)" }
if ($okCore) { Write-Host "  LCOS Core  : http://127.0.0.1:$CORE_PORT （web 内经 /lcos-core 同源代理）" }
Write-Host "  默认项目   : disposable-mvp-sample（Core .data 自带；PROJECT_ID 可覆盖）"
Write-Host "  停止       : 关闭两个服务窗口，或 scripts/dev-stop.ps1"
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not ($okCore -and $okApi -and $okWeb)) {
  Write-Host "[warn] 有服务没就绪——看对应窗口里的输出。" -ForegroundColor Yellow
  exit 1
}
