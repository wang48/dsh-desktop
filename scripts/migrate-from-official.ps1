#Requires -Version 5.1
<#
从官方原版 DSH 迁移数据到 DSH-Desktop（只复制、不改原版，可重复执行）。

用法（先退出 DSH-Desktop）：
  .\scripts\migrate-from-official.ps1                    # 默认路径
  .\scripts\migrate-from-official.ps1 -SkipCredentials   # 不复制 API 凭据
  .\scripts\migrate-from-official.ps1 -Src "D:\other\dsh-home"

说明：
  - 复制 sessions / settings.yaml / .credentials.yaml / .anonymous-user-id / storages；
  - 合并 workspace.json：按路径把原版工作区里的会话登记进桌面版对应工作区，
    会话才会显示在正确分组下（而不是"未分组"）；
  - 不复制 profiles（其 node_modules 是指向原版安装位置的链接，桌面版会自动重建）。
#>
param(
  [string]$Src = "$env:USERPROFILE\.dsh",
  [string]$Dst = "$env:APPDATA\DSH-Desktop\home",
  [switch]$SkipCredentials
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Src)) {
  Write-Error "未找到官方数据目录：$Src（若设置过 DSH_HOME 环境变量，请用 -Src 指定）"
  exit 1
}
if (-not (Test-Path $Dst)) { New-Item -ItemType Directory -Force -Path $Dst | Out-Null }

function Copy-Contents([string]$From, [string]$To) {
  if (-not (Test-Path $From)) { Write-Host "  跳过（不存在）：$From"; return }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  Copy-Item "$From\*" $To -Recurse -Force
}

Write-Host "== 1/4 复制对话数据 =="
Copy-Contents "$Src\sessions" "$Dst\sessions"

Write-Host "== 2/4 复制设置与凭据 =="
if (Test-Path "$Src\settings.yaml") { Copy-Item "$Src\settings.yaml" "$Dst\settings.yaml" -Force }
if (-not $SkipCredentials -and (Test-Path "$Src\.credentials.yaml")) { Copy-Item "$Src\.credentials.yaml" "$Dst\.credentials.yaml" -Force }
if (Test-Path "$Src\.anonymous-user-id") { Copy-Item "$Src\.anonymous-user-id" "$Dst\.anonymous-user-id" -Force }

Write-Host "== 3/4 复制 UI 状态 =="
Copy-Contents "$Src\storages" "$Dst\storages"

Write-Host "== 4/4 合并工作区与会话分组 =="
function Merge-WorkspaceJson([string]$FromFile, [string]$ToFile) {
  if (-not (Test-Path $FromFile)) { Write-Host "  跳过（原版无 workspace.json）"; return }
  $from = Get-Content $FromFile -Raw | ConvertFrom-Json
  if (Test-Path $ToFile) {
    $to = Get-Content $ToFile -Raw | ConvertFrom-Json
  } else {
    $to = [pscustomobject]@{
      unit   = [pscustomobject]@{ name = 'workspace'; version = 2 }
      global = [pscustomobject]@{ initialized = $true; workspaceIds = @(); archivedSessionIds = @() }
      tables = [pscustomobject]@{ workspaces = [pscustomobject]@{} }
    }
  }

  # 合并归档会话
  $arch = @{}
  foreach ($id in (@($to.global.archivedSessionIds) + @($from.global.archivedSessionIds)) | Where-Object { $_ }) { $arch[$id] = $true }

  # 按 path 匹配工作区，合并会话登记
  foreach ($wsProp in $from.tables.workspaces.PSObject.Properties) {
    $ws = $wsProp.Value
    $path = [string]$ws.path
    $match = $to.tables.workspaces.PSObject.Properties | Where-Object { [string]$_.Value.path -eq $path } | Select-Object -First 1
    if ($null -eq $match) {
      $newId = [guid]::NewGuid().ToString()
      $to.tables.workspaces | Add-Member -NotePropertyName $newId -NotePropertyValue ([pscustomobject]@{
        path = $path; title = $ws.title; sessionIds = @()
        createdAt = $ws.createdAt; updatedAt = $ws.updatedAt
      })
      $to.global.workspaceIds = @($to.global.workspaceIds) + $newId
      $match = $to.tables.workspaces.PSObject.Properties | Where-Object { $_.Name -eq $newId }
    }
    $ids = @{}
    foreach ($sid in (@($match.Value.sessionIds) + @($ws.sessionIds)) | Where-Object { $_ }) { $ids[$sid] = $true }
    $match.Value.sessionIds = @($ids.Keys)
    Write-Host "  工作区 [$path]：合并 $($ws.sessionIds.Count) 个会话"
  }

  $to.global.archivedSessionIds = @($arch.Keys)
  $json = $to | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($ToFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}

Merge-WorkspaceJson "$Src\storages\workspace.json" "$Dst\storages\workspace.json"

Write-Host ""
Write-Host "迁移完成。启动 DSH-Desktop 后，历史会话应出现在对应工作区分组下。"
Write-Host "原版数据未做任何改动。"

