param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'config.json'
if (!(Test-Path $configPath)) { Write-Host '[错误] 缺少 config.json'; exit 1 }
$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Expand-Path($value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  return [Environment]::ExpandEnvironmentVariables($value)
}
function Get-ManifestVersion($dir) {
  $file = Join-Path $dir 'manifest.json'
  if (!(Test-Path $file)) { return $null }
  try { return (Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { return $null }
}
function Compare-Version($a, $b) {
  try { return ([version]$a).CompareTo([version]$b) } catch { if ($a -eq $b) { return 0 } else { return -1 } }
}

# 使用 WebClient 并强制不走系统代理：很多公司/开发机会设置系统代理，导致 localhost/内网地址请求超时
function Get-TextNoProxy($url) {
  $client = New-Object System.Net.WebClient
  try {
    $client.Proxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy()
    return $client.DownloadString($url)
  } finally {
    $client.Dispose()
  }
}

function Download-FileNoProxy($url, $outFile) {
  $client = New-Object System.Net.WebClient
  try {
    $client.Proxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy()
    $client.DownloadFile($url, $outFile)
  } finally {
    $client.Dispose()
  }
}

$localDir = Expand-Path $config.localExtensionDir
if (!$localDir) { $localDir = Join-Path $env:LOCALAPPDATA 'GameToolExtension' }
$currentVersion = Get-ManifestVersion $localDir
$update = $config.update
if (!$update -or [string]::IsNullOrWhiteSpace($update.versionUrl)) {
  Write-Host '未配置代码仓库版本地址：请在 config.json 的 update.versionUrl 填写 version.json 地址。'
  exit 0
}

Write-Host '正在从代码仓库检查更新...'
try {
  $text = [string](Get-TextNoProxy $update.versionUrl)
} catch {
  Write-Host ('检查更新失败：' + $_.Exception.Message)
  exit 1
}

$text = $text.Trim()
$latest = $null
$zipUrl = [string]$update.zipUrl
$pageUrl = [string]$update.pageUrl
try {
  $json = $text | ConvertFrom-Json
  if ($json.version) {
    $latest = [string]$json.version
    if ($json.zipUrl) { $zipUrl = [string]$json.zipUrl }
    if ($json.pageUrl) { $pageUrl = [string]$json.pageUrl }
  }
} catch {
  # 也允许 versionUrl 直接返回纯版本号文本，例如 1.3.4
}
if (!$latest) { $latest = ($text -split '\s+')[0].Trim('"', "'", "`r", "`n") }
if (!$latest) {
  Write-Host '未从代码仓库读取到版本号，请检查 version.json 格式。'
  exit 1
}

Write-Host ('当前版本：' + $(if ($currentVersion) { $currentVersion } else { '未安装' }) + '，仓库最新：' + $latest)
if ($currentVersion -and (Compare-Version $latest $currentVersion) -le 0) {
  Write-Host '已是最新版本'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($zipUrl)) {
  Write-Host ('发现新版本 v' + $latest + '，但没有配置 zip 下载地址。')
  if (![string]::IsNullOrWhiteSpace($pageUrl)) {
    Write-Host '正在打开下载页面...'
    Start-Process $pageUrl
  }
  exit 0
}

Write-Host ('发现新版本 v' + $latest + '，正在下载...')
$temp = Join-Path $env:TEMP ('GameToolUpdate_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
$zipFile = Join-Path $temp 'update.zip'
try {
  Download-FileNoProxy $zipUrl $zipFile
  Expand-Archive -Path $zipFile -DestinationPath $temp -Force
} catch {
  Write-Host ('下载/解压新版本失败：' + $_.Exception.Message)
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

$newExtensionDir = $null
$candidates = @(
  (Join-Path $temp 'game-tool-extension'),
  $temp
)
foreach ($candidate in $candidates) {
  if (Test-Path (Join-Path $candidate 'manifest.json')) { $newExtensionDir = $candidate; break }
}
if (!$newExtensionDir) {
  $manifest = Get-ChildItem -Path $temp -Recurse -Filter 'manifest.json' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($manifest) { $newExtensionDir = $manifest.DirectoryName }
}
if (!$newExtensionDir) {
  Write-Host '下载包中找不到 manifest.json，更新失败。'
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

New-Item -ItemType Directory -Force -Path $localDir | Out-Null
& robocopy $newExtensionDir $localDir /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Host '复制新版本失败（可能浏览器正在占用文件），请关闭浏览器后重试。'
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}
Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue

$newVersion = Get-ManifestVersion $localDir
Write-Host ('更新完成：v' + $newVersion + ' -> ' + $localDir)
if ($NoLaunch) { exit 0 }

Write-Host '请重新双击「启动游戏助手.bat」使用新版；Chrome 用户请双击「更新并重启Chrome.bat」。'
if (![string]::IsNullOrWhiteSpace($pageUrl)) { Write-Host ('版本发布页：' + $pageUrl) }
exit 0
