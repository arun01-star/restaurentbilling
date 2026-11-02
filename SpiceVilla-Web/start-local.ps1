$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'SpiceVilla\mysql'
$mysqlHome = Get-ChildItem -Path $runtimeRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'mysql-*-winx64' -and (Test-Path (Join-Path $_.FullName 'bin\mysqld.exe')) } |
    Sort-Object Name -Descending |
    Select-Object -First 1
$mysqlEnv = Join-Path $projectRoot 'backend\.env'

if (-not $mysqlHome) {
    throw "Portable MySQL was not found under $runtimeRoot. Complete MySQL setup before starting SpiceVilla."
}
if (-not (Test-Path $mysqlEnv)) {
    throw 'Database settings are missing. Copy backend\.env.example to backend\.env and configure it first.'
}

$portLine = Get-Content $mysqlEnv | Where-Object { $_ -match '^\s*MYSQL_PORT\s*=' } | Select-Object -First 1
$mysqlPort = 3306
if ($portLine -and $portLine -match '=\s*(\d+)') {
    $mysqlPort = [int]$Matches[1]
}

$serverExe = Join-Path $mysqlHome.FullName 'bin\mysqld.exe'
$dataDir = Join-Path $runtimeRoot 'data'
$configPath = Join-Path $runtimeRoot 'my.ini'
$pidPath = Join-Path $runtimeRoot 'mysqld.pid'
$stdoutPath = Join-Path $runtimeRoot 'mysqld.out.log'
$stderrPath = Join-Path $runtimeRoot 'mysqld.err.log'
$config = @"
[mysqld]
basedir="$($mysqlHome.FullName.Replace('\', '/'))"
datadir="$($dataDir.Replace('\', '/'))"
port=$mysqlPort
bind-address=127.0.0.1
mysqlx=0
pid-file="$($pidPath.Replace('\', '/'))"
"@
Set-Content -Path $configPath -Value $config -Encoding ascii

$tcp = [System.Net.Sockets.TcpClient]::new()
try {
    $connection = $tcp.BeginConnect('127.0.0.1', $mysqlPort, $null, $null)
    if (-not $connection.AsyncWaitHandle.WaitOne(500) -or -not $tcp.Connected) {
        $process = Start-Process -FilePath $serverExe `
            -ArgumentList "--defaults-file=`"$configPath`" --console" `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

        $isReady = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            Start-Sleep -Seconds 1
            if ($process.HasExited) {
                $details = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { 'No server log was produced.' }
                throw "MySQL stopped during startup. $details"
            }
            $tcp = [System.Net.Sockets.TcpClient]::new()
            try {
                $connection = $tcp.BeginConnect('127.0.0.1', $mysqlPort, $null, $null)
                $isReady = $connection.AsyncWaitHandle.WaitOne(300) -and $tcp.Connected
            } finally {
                $tcp.Dispose()
            }
            if ($isReady) { break }
        }
        if (-not $isReady) {
            throw "MySQL did not open port $mysqlPort. Check $stderrPath."
        }
        Write-Host "Portable MySQL started on 127.0.0.1:$mysqlPort."
    } else {
        Write-Host "MySQL is already listening on 127.0.0.1:$mysqlPort."
    }
} finally {
    $tcp.Dispose()
}

Write-Host 'Starting SpiceVilla. Keep this window open; press Ctrl+C to stop the web application.'
Push-Location $projectRoot
try {
    python backend\server.py
} finally {
    Pop-Location
}
