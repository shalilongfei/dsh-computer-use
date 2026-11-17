# Start the elevated computer-use broker (admin required).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-broker.ps1 -Stop
#
# Why: on hardened machines only admin-launched processes may inject mouse/keyboard
#      input. DSH runs at medium integrity, so its whole process tree is blocked.
#      The broker stays resident with admin rights and the plugin forwards actions
#      to 127.0.0.1:<port> (every request must carry the token, see SECURITY.md).

param(
  [int]$Port = 45919,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$helper = Join-Path $root 'helper\bin\Release\net9.0-windows\Win32Bridge.exe'
$log = Join-Path $root 'broker.log'
$tokenFile = Join-Path $root 'helper\bin\Release\net9.0-windows\broker.token'

if (-not (Test-Path $helper)) { throw "helper not found: $helper" }

function Get-BrokerToken {
  if (Test-Path $tokenFile) {
    $t = (Get-Content $tokenFile -Raw).Trim()
    if ($t.Length -ge 32) { return $t }
  }
  # 让 helper 生成一个
  $json = & $helper --token | Select-Object -Last 1
  try {
    $obj = $json | ConvertFrom-Json
    if ($obj.success -and $obj.data.token) { return $obj.data.token }
  } catch { }
  return $null
}

function Send-BrokerLine {
  param([int]$P, [string]$Line, [string]$Token)
  try {
    $c = [System.Net.Sockets.TcpClient]::new()
    $c.Connect('127.0.0.1', $P)
    $s = $c.GetStream()
    $w = [System.IO.StreamWriter]::new($s)
    $r = [System.IO.StreamReader]::new($s)
    $w.AutoFlush = $true
    if ($Token) {
      # 在 JSON 对象开头插入 token 字段
      $Line = $Line.Insert(1, '"token":"' + $Token + '",')
    }
    $w.WriteLine($Line)
    $resp = $r.ReadLine()
    $c.Close()
    return $resp
  } catch {
    return $null
  }
}

function Test-BrokerReady {
  param([int]$P, [string]$Token)
  $resp = Send-BrokerLine -P $P -Line '{"action":"ping"}' -Token $Token
  if (-not $resp) { return $null }
  try {
    $obj = $resp | ConvertFrom-Json
    # 端口有响应但鉴权失败 => 令牌失配（通常是 broker 用旧令牌在跑），不算 ready
    if ($obj.success -eq $true) { return $obj }
  } catch { }
  return $null
}

$token = Get-BrokerToken

if ($Stop) {
  $resp = Send-BrokerLine -P $Port -Line '{"action":"quit"}' -Token $token
  if ($resp) { Write-Output ("stopped: " + $resp) } else { Write-Output 'broker is not running.' }
  exit 0
}

$ready = Test-BrokerReady -P $Port -Token $token
if ($ready) {
  Write-Output ("broker already running: " + ($ready | ConvertTo-Json -Compress))
  exit 0
}

# Elevated launch. The helper takes a plain command-line switch, so no JSON quoting issues.
$argList = @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', "& '$helper' --broker $Port *> '$log'")
Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 300
  if (-not $token) { $token = Get-BrokerToken }
  $ready = Test-BrokerReady -P $Port -Token $token
  if ($ready) {
    Write-Output ("broker ready: " + ($ready | ConvertTo-Json -Compress))
    Write-Output ("token file: " + $tokenFile)
    exit 0
  }
}

Write-Output ("broker failed to start; see log: " + $log)
if (Test-Path $log) { Get-Content $log -Raw }
exit 1
