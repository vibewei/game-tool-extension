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
$version = $null
try { $version = (Get-Content (Join-Path $localDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
Write-Host ('插件已准备到: ' + $localDir + $(if ($version) { ' （v' + $version + '）' } else { '' }))
Write-Host '接下来在打开的扩展管理页里：'
Write-Host '  1. 打开右上角「开发者模式」'
Write-Host '  2. 点「加载已解压的扩展程序」'
Write-Host '  3. 选择上面这个目录'
if ($NoLaunch) { exit 0 }

$chrome = Expand-Path $config.chromePath
if (!$chrome) {
  $candidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
  )
  foreach ($candidate in $candidates) { if (Test-Path $candidate) { $chrome = $candidate; break } }
}
Start-Process -FilePath 'explorer.exe' -ArgumentList @($localDir)
if ($chrome) {
  Start-Process -FilePath $chrome -ArgumentList @('chrome://extensions')
} else {
  Write-Host '未找到 Chrome，请手动打开 chrome://extensions'
}
exit 0
