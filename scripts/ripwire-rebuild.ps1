# ripwire 索引重建脚本（LCOS Gen2 施工辅助）
# 用法：pwsh scripts/ripwire-rebuild.ps1 [-RipwireBinary <path>] [-IndexDir <path>]
# 原理：用 --index-out 冷解析仓库并落盘索引，之后日常查询用 --cache 指过去走增量缓存。
# 索引产物一律 gitignore（二进制不入仓）；本脚本 + 清单入仓，任何机器 clone 后可重建。

param(
    [string]$RipwireBinary = "C:\tmp_ripwire_src\build3\ripwire.exe",
    [string]$IndexDir = "C:\tmp_rw_index"
)

if (-not (Test-Path $RipwireBinary)) {
    Write-Host "ripwire 二进制不存在: $RipwireBinary" -ForegroundColor Red
    Write-Host "需先按 LCOS_工具_ripwire_安装SOP與实测_20260915.md（收口目录）编译，或传 -RipwireBinary" -ForegroundColor Yellow
    exit 1
}

$R = $RipwireBinary
$gen2Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$donors = @{
    # 名称 -> 源目录（输入路径，绝对）
    "amicro"    = "C:\Users\1\Desktop\Gen2开发\源码参考_20260903\amicro"
    "morphicons"= "C:\Users\1\Desktop\Gen2开发\源码参考_20260903\morphicons"
    "orbit"     = "C:\Users\1\Desktop\Gen2开发\源码参考_20260903\orbit-css"
    "toolcase"  = "C:\Users\1\Desktop\Gen2开发\源码参考_20260903\toolcase-game-components"
    "reactbits" = "C:\Users\1\Desktop\Gen2开发\源码参考_20260903\react-bits"
    "tapnow"    = "E:\素材_raw_不入GPT\web_逆向_tapnow_lovart_20260904\tapnow_raw"
    "lovart"    = "E:\素材_raw_不入GPT\web_逆向_tapnow_lovart_20260904\lovart_canvas_20260904"
    # 桌面施工正本 + 审计交付（Phase A-D / 00 总索引 / 施工卡）——--recall 专用
    "gen2docs"  = "C:\Users\1\Desktop\Gen2开发"
}

New-Item -ItemType Directory -Force -Path $IndexDir, (Join-Path $IndexDir "donors") | Out-Null

Write-Host "== 重建 Gen2 全仓索引（含 AGENTS.md / docs 施工卡） ==" -ForegroundColor Cyan
Push-Location $gen2Root
& $R . --index-out=(Join-Path $IndexDir "gen2") 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
Pop-Location

Write-Host "== 重建参考源索引（$($donors.Count) 个） ==" -ForegroundColor Cyan
foreach ($k in $donors.Keys) {
    $src = $donors[$k]
    if (-not (Test-Path $src)) {
        Write-Host "  [skip] $k  源目录不存在: $src" -ForegroundColor Yellow
        continue
    }
    Write-Host "  [build] $k  <-  $src" -ForegroundColor DarkCyan
    Push-Location $src
    & $R . --index-out=(Join-Path (Join-Path $IndexDir "donors") $k) 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    Pop-Location
}

Write-Host ""
Write-Host "== 完成。日常查询示例 ==" -ForegroundColor Green
Write-Host "  Gen2:     & $R . --cache=$IndexDir\gen2 --for=`"<任务描述>`"    （在 Gen2 仓根目录）"
Write-Host "  参考源:   & $R . --cache=$IndexDir\donors\<name> --for=`"<任务描述>`"   （在对应源目录）"