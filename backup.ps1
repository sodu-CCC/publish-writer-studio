# Writer Studio - one-click backup
# Backs up the source tree to a folder NEXT TO this repo.
# 排除体积大且可再生成的目录（依赖、测试产物、版本控制）
$ErrorActionPreference = "Stop"

$src  = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path (Split-Path -Parent $src) "writer-studio-backups"
$ts   = Get-Date -Format "yyyyMMdd-HHmmss"
$dst  = Join-Path $root $ts

New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /E /XD node_modules test-results playwright-report .git dist /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null

$n = (Get-ChildItem -LiteralPath $dst -Recurse -File).Count
$mb = [math]::Round(((Get-ChildItem -LiteralPath $dst -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host ""
Write-Host "[OK] backed up $n files ($mb MB)"
Write-Host "     source : $src"
Write-Host "     target : $dst"
Write-Host ""
Write-Host "     (excluded: node_modules / test-results / playwright-report / .git / dist)"
