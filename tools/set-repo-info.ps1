<#
  set-repo-info.ps1 —— 一次性把文档里的占位符替换成你自己的仓库信息

  为什么要单独放一个文件：
    以前这段脚本是直接抄在《上传步骤》文档里的，一运行就会把"文档里示范用的
    占位符"也一起替换掉，导致说明文字自己被改得看不懂。现在拆成独立脚本，
    文档只写"运行这条命令"，两边互不干扰。

  用法
    # 交互式（会依次问用户名 / 仓库名 / 邮箱）
    powershell -ExecutionPolicy Bypass -File tools/set-repo-info.ps1

    # 一次性给全参数
    powershell -ExecutionPolicy Bypass -File tools/set-repo-info.ps1 `
      -User sodu-CCC -Repo publish-writer-studio -Email me@example.com

    # 只看会改什么，不落盘
    powershell -ExecutionPolicy Bypass -File tools/set-repo-info.ps1 -User x -Repo y -Email z -DryRun

  行为
    · 只处理 *.md（跳过 node_modules / .git / test-results）
    · 跳过带 <!-- set-repo-info:skip --> 标记的文件（教学文档本身）
    · 幂等：已经替换过的再跑一遍不做任何改动
    · 结束后报告结果；若仍有残留占位符，退出码为 1
#>
[CmdletBinding()]
param(
  [string]$User,
  [string]$Repo,
  [string]$Email,
  [string]$OldRepoName,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SKIP_MARK = 'set-repo-info:skip'

function Ask([string]$label, [string]$current) {
  if ($current) { return $current }
  $v = Read-Host $label
  if (-not $v) { throw "必须提供 $label" }
  return $v.Trim()
}

$User  = Ask '你的 GitHub 用户名' $User
$Repo  = Ask '仓库名（GitHub 上那个）' $Repo
$Email = Ask '你的邮箱（写进商店支持信息里）' $Email

# 占位符 -> 真实值。顺序无关，因为是逐条字面替换。
$map = [ordered]@{
  'OWNER'           = $User
  '<你的用户名>'    = $User
  '<用户名>'        = $User
  '<your-username>' = $User
  '<你的邮箱>'      = $Email
  '<your-email>'    = $Email
}

Write-Host ""
Write-Host "仓库根目录 : $ROOT"
Write-Host "用户名     : $User"
Write-Host "仓库名     : $Repo"
Write-Host "邮箱       : $Email"
if ($OldRepoName) { Write-Host "同时把旧仓库名 : $OldRepoName  ->  $Repo" }
if ($DryRun) { Write-Host "模式       : 预演（不写入）" }
Write-Host ""

$files = Get-ChildItem $ROOT -Recurse -File -Filter *.md |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\|\\test-results\\|\\playwright-report\\' }

$changedFiles = 0; $changedHits = 0; $skipped = @()

foreach ($f in $files) {
  $rel = $f.FullName.Substring($ROOT.Length + 1)
  $t = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)

  if ($t.Contains($SKIP_MARK)) { $skipped += $rel; continue }

  $orig = $t
  foreach ($k in $map.Keys) { $t = $t.Replace($k, $map[$k]) }

  # 旧仓库名 -> 新仓库名（比如仓库从 writer-studio 改成了 publish-writer-studio）
  if ($OldRepoName -and $OldRepoName -ne $Repo) {
    $t = $t.Replace("$User/$OldRepoName", "$User/$Repo")
    $t = $t.Replace("$User.github.io/$OldRepoName", "$User.github.io/$Repo")
  }

  if ($t -ne $orig) {
    $n = 0
    foreach ($k in $map.Keys) { $n += ([regex]::Matches($orig, [regex]::Escape($k))).Count }
    if (-not $DryRun) { [System.IO.File]::WriteAllText($f.FullName, $t, (New-Object System.Text.UTF8Encoding($false))) }
    $changedFiles++; $changedHits += $n
    Write-Host ("  {0,-46} 替换 {1} 处" -f $rel, $n)
  }
}

Write-Host ""
if ($changedFiles -eq 0) { Write-Host "没有需要替换的内容（已经是配置好的状态）。" }
else { Write-Host ("{0}{1} 个文件，共 {2} 处。" -f $(if ($DryRun) { '预演：将修改 ' } else { '已修改 ' }), $changedFiles, $changedHits) }
if ($skipped.Count) { Write-Host ("跳过 {0} 个教学文档：{1}" -f $skipped.Count, ($skipped -join ', ')) }

# 收尾体检：还有没有残留占位符
$left = @()
foreach ($f in $files) {
  $t = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
  if ($t.Contains($SKIP_MARK)) { continue }
  $hit = @()
  foreach ($k in $map.Keys) { if ($t.Contains($k)) { $hit += $k } }
  if ($hit.Count) { $left += ($f.FullName.Substring($ROOT.Length + 1) + ' -> ' + ($hit -join ',')) }
}
Write-Host ""
if ($left.Count) {
  Write-Host "⚠️ 仍有残留：" -ForegroundColor Yellow
  $left | ForEach-Object { Write-Host "   $_" }
  exit 1
} else {
  Write-Host "✅ 占位符检查通过。" -ForegroundColor Green
}