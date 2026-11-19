param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Get-Content (Join-Path $scriptDir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Expand-Path($value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  return [Environment]::ExpandEnvironmentVariables($value)
}

$sourceRoot = Expand-Path $config.sourceDir
if (!$sourceRoot) { $sourceRoot = $scriptDir }
$sourceExt = Join-Path $sourceRoot 'game-tool-extension'
if (!(Test-Path (Join-Path $sourceExt 'manifest.json'))) {
  $fallback = Join-Path $scriptDir 'game-tool-extension'
  if (Test-Path (Join-Path $fallback 'manifest.json')) { $sourceExt = $fallback } else { Write-Host '[错误] 找不到插件文件'; exit 1 }
}
$localDir = Expand-Path $config.localExtensionDir
if (!$localDir) { $localDir = Join-Path $env:LOCALAPPDATA 'GameToolExtension' }
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
& robocopy $sourceExt $localDir /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Host '[错误] 同步插件失败'; exit 1 }
Write-Host '插件文件已更新到固定目录'
if ($NoLaunch) { exit 0 }

$chrome = Expand-Path $config.chromePath
if (!$chrome) {
  $candidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  )
  foreach ($candidate in $candidates) { if (Test-Path $candidate) { $chrome = $candidate; break } }
}
if (!$chrome) { Write-Host '[错误] 未找到 Chrome'; exit 1 }

$running = Get-Process chrome -ErrorAction SilentlyContinue
if ($running) {
  Write-Host '需要重启 Chrome 才能让插件加载最新文件（Chrome 会恢复上次标签页）。'
  $answer = Read-Host '现在关闭并重新打开 Chrome？(Y/N)'
  if ($answer -notmatch '^[Yy]') { Write-Host '已取消，可稍后手动关闭再打开 Chrome。'; exit 0 }
  Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
Write-Host '正在启动 Chrome...'
Start-Process -FilePath $chrome -ArgumentList @($config.gameUrl)
exit 0
