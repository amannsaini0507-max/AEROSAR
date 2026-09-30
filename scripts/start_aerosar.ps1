<#
.SYNOPSIS
    AEROSAR Windows PowerShell Entrypoint
    Wraps node scripts/start_aerosar.js with ExecutionPolicy Bypass.
.DESCRIPTION
    Launches the unified AEROSAR Command Center (Backend + Frontend + Simulator).
    Supports all launcher flags:
        .\scripts\start_aerosar.ps1 -check
        .\scripts\start_aerosar.ps1 -low-power
        .\scripts\start_aerosar.ps1 -force
        .\scripts\start_aerosar.ps1 -no-browser
#>

[CmdletBinding()]
param (
    [switch]$Check,
    [switch]$LowPower,
    [switch]$Force,
    [switch]$NoBrowser
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$LauncherJs = Join-Path $ScriptDir "start_aerosar.js"

$ArgsList = @()
if ($Check) { $ArgsList += "--check" }
if ($LowPower) { $ArgsList += "--low-power" }
if ($Force) { $ArgsList += "--force" }
if ($NoBrowser) { $ArgsList += "--no-browser" }

Write-Host "[AEROSAR] Launching unified runner via Node.js..." -ForegroundColor Cyan
& node $LauncherJs @ArgsList
exit $LASTEXITCODE
