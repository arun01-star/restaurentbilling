$ErrorActionPreference = 'Stop'

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'SpiceVilla\mysql'
$pidPath = Join-Path $runtimeRoot 'mysqld.pid'
$mysqlHome = Get-ChildItem -Path $runtimeRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'mysql-*-winx64' -and (Test-Path (Join-Path $_.FullName 'bin\mysqld.exe')) } |
    Sort-Object Name -Descending |
    Select-Object -First 1

if (-not $mysqlHome -or -not (Test-Path $pidPath)) {
    Write-Host 'The portable SpiceVilla MySQL server is not running.'
    exit 0
}

$mysqlProcessId = 0
if (-not [int]::TryParse((Get-Content $pidPath -Raw).Trim(), [ref]$mysqlProcessId)) {
    throw "The MySQL PID file is invalid: $pidPath"
}

$process = Get-Process -Id $mysqlProcessId -ErrorAction SilentlyContinue
if (-not $process) {
    Remove-Item -LiteralPath $pidPath -Force
    Write-Host 'The portable SpiceVilla MySQL server is already stopped.'
    exit 0
}

$expectedPath = (Join-Path $mysqlHome.FullName 'bin\mysqld.exe')
$actualPath = (Get-CimInstance Win32_Process -Filter "ProcessId = $mysqlProcessId").ExecutablePath
if (-not $actualPath -or -not [string]::Equals($actualPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "PID $mysqlProcessId is not the SpiceVilla MySQL server; no process was stopped."
}

Stop-Process -Id $mysqlProcessId
Write-Host 'Portable MySQL stopped. Your database files are preserved.'
