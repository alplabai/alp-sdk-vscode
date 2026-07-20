# SPDX-License-Identifier: Apache-2.0
#
# tan installer for Windows. Downloads the prebuilt tan.exe for this platform
# from GitHub Releases and installs it. By DEFAULT it installs under
# %LOCALAPPDATA%\Programs\tan and updates the USER Path, so NO admin is needed.
# Pass -System to install under %ProgramFiles% and update the MACHINE Path
# (that requires an elevated / "Run as administrator" PowerShell).
#
#   irm https://raw.githubusercontent.com/alplabai/tan-cli/main/install.ps1 | iex
#   .\install.ps1 [-Version vX.Y.Z] [-Dir <path>] [-System]
[CmdletBinding()]
param(
	[string]$Version = "latest",
	[string]$Dir = "",
	[switch]$System
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repo = "alplabai/tan-cli"

# host arch -> rust target arch part
$archRaw = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $archRaw = $env:PROCESSOR_ARCHITEW6432 }
switch ($archRaw) {
	"AMD64" { $archPart = "x86_64" }
	"ARM64" { $archPart = "aarch64" }
	default { throw "install.ps1: unsupported architecture '$archRaw'" }
}
$asset = "tan-$archPart-pc-windows-msvc.exe"

# install dir + PATH scope: user-local (no admin) by default, machine with -System (admin)
if ($System) {
	$scope = "Machine"
	if (-not $Dir) { $Dir = Join-Path $env:ProgramFiles "tan" }
} else {
	$scope = "User"
	if (-not $Dir) { $Dir = Join-Path $env:LOCALAPPDATA "Programs\tan" }
}

if ($Version -eq "latest") {
	$url = "https://github.com/$repo/releases/latest/download/$asset"
} else {
	$url = "https://github.com/$repo/releases/download/$Version/$asset"
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$dest = Join-Path $Dir "tan.exe"
Write-Host "install.ps1: downloading tan ($archPart, $Version)…"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

# Add $Dir to the chosen PATH scope if absent. Machine scope requires admin;
# SetEnvironmentVariable throws a clear permission error if not elevated.
$curPath = [Environment]::GetEnvironmentVariable("Path", $scope)
if (-not ($curPath -split ';' | Where-Object { $_ -eq $Dir })) {
	$newPath = if ([string]::IsNullOrEmpty($curPath)) { $Dir } else { "$curPath;$Dir" }
	[Environment]::SetEnvironmentVariable("Path", $newPath, $scope)
	Write-Host "install.ps1: added $Dir to the $scope Path — restart the terminal for it to take effect."
}

Write-Host "install.ps1: installed tan -> $dest"
& $dest --version
