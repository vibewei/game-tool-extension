param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'config.json'
if (!(Test-Path $configPath)) { Write-Host '[错误] 缺少 config.json'; exit 1 }
$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Expand-Path($value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  return [Environment]::ExpandEnvironmentVariables($value)
}

$sourceRoot = Expand-Path $config.sourceDir
if (!$sourceRoot) { $sourceRoot = $scriptDir }
$sourceExt = Join-Path $sourceRoot 'game-tool-extension'
if (!(Test-Path (Join-Path $sourceExt 'manifest.json'))) {
  $fallback = Join-Path $scriptDir 'game-tool-extension'
  if (Test-Path (Join-Path $fallback 'manifest.json')) {
    $sourceExt = $fallback
    $sourceRoot = $scriptDir
  } else {
    Write-Host "[错误] 找不到插件文件: $sourceExt"
    exit 1
  }
}

$localDir = Expand-Path $config.localExtensionDir
if (!$localDir) { $localDir = Join-Path $env:LOCALAPPDATA 'GameToolExtension' }
New-Item -ItemType Directory -Force -Path $localDir | Out-Null

function Get-ManifestVersion($dir) {
  $file = Join-Path $dir 'manifest.json'
  if (!(Test-Path $file)) { return $null }
  try { return (Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { return $null }
}

$sourceVersion = Get-ManifestVersion $sourceExt
$localVersion = Get-ManifestVersion $localDir
Write-Host ('插件版本：本地 = ' + $(if ($localVersion) { $localVersion } else { '无' }) + '，最新 = ' + $(if ($sourceVersion) { $sourceVersion } else { '未知' }))

if ($sourceVersion -and $sourceVersion -ne $localVersion) {
  Write-Host '正在同步最新插件...'
  & robocopy $sourceExt $localDir /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    Write-Host '[错误] 同步插件文件失败，请检查目录权限'
    exit 1
  }
  Write-Host '同步完成'
} else {
  Write-Host '已是最新版本'
}

if ($NoLaunch) {
  Write-Host '测试模式：不启动浏览器'
  exit 0
}

# 可选：每次启动前从代码仓库检查更新（config.json 里 update.autoCheck = true 时生效）
if ($config.update -and $config.update.autoCheck -and ![string]::IsNullOrWhiteSpace($config.update.versionUrl)) {
  Write-Host '正在从代码仓库检查更新...'
  try {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', (Join-Path $scriptDir 'update.ps1'), '-NoLaunch'
    ) -Wait -NoNewWindow
  } catch {
    Write-Host ('检查更新失败：' + $_.Exception.Message)
  }
}

$profileDir = Expand-Path $config.edgeProfileDir
if (!$profileDir) { $profileDir = Join-Path $env:LOCALAPPDATA 'GameToolEdgeProfile' }
$edge = Expand-Path $config.edgePath
if (!$edge) {
  $candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { $edge = $candidate; break }
  }
}
if (!$edge) {
  Write-Host '[错误] 未找到 Edge，请在 config.json 里填写 edgePath'
  exit 1
}

Write-Host '正在启动游戏助手...'
Start-Process -FilePath $edge -ArgumentList @(
  "--user-data-dir=`"$profileDir`"",
  "--load-extension=`"$localDir`"",
  "--disable-extensions-except=`"$localDir`"",
  $config.gameUrl
)
exit 0
