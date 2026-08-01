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

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# `latest` is a REDIRECT, and resolving it twice is not the same as resolving it
# once: a release cut between the binary fetch and the checksums fetch would
# have us verify one release's asset against another release's digests. Rare,
# silent, and it yields a WRONG VERDICT rather than an error -- so pin the tag up
# front and build both URLs from it.
#
# The digest for a given filename really does move between tags: at v0.4.0-rc1
# tan-x86_64-pc-windows-msvc.exe is f159c1dc..., at v0.4.0 it is a80fb5da..., same
# asset name. Anything that caches or hardcodes a digest is wrong by construction.
# Resolved through the API's `tag_name` rather than by inspecting the
# /releases/latest redirect, which install.sh uses. Not gratuitous divergence --
# each host gets the mechanism that is actually robust on it:
#
#   * POSIX sh has curl's `-w '%{url_effective}'`, which reports the final URL
#     in one flag and no JSON parser (jq is not guaranteed on a fresh host).
#   * PowerShell has no stable equivalent. Reading a 3xx's Location differs
#     between 5.1 and 7, and under this script's own `Set-StrictMode -Version
#     Latest` a missing `$_.Exception.Response` property THROWS rather than
#     yielding $null -- so the defensive form is the one that breaks. The API's
#     `tag_name` is one documented field that behaves identically on both.
#
# Both endpoints exclude prereleases the same way, so the two scripts resolve
# `latest` to the same tag. That matters right now: v0.4.0 is marked prerelease,
# so `latest` is NOT the highest version number.
if ($Version -eq "latest") {
	Write-Host "install.ps1: resolving the latest release tag..."
	$tag = $null
	try {
		$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" `
			-UseBasicParsing -Headers @{ "User-Agent" = "tan-install.ps1" }
		$tag = $rel.tag_name
	} catch {
		# Swallowed on purpose: every failure here lands on the same refusal
		# below. An unauthenticated API rate limit (60/hr per IP) is the
		# realistic one, and it must not be able to produce a WRONG tag --
		# only no tag.
		$tag = $null
	}
	if ($tag) {
		$Version = $tag
		Write-Host "install.ps1: latest is $Version."
	} else {
		Write-Error "install.ps1: could not resolve which release 'latest' points at. Refusing to install -- without a tag there is no checksums.txt to verify against. Retry, or pass an explicit -Version vX.Y.Z."
		exit 1
	}
}
$url = "https://github.com/$repo/releases/download/$Version/$asset"
$sumsUrl = "https://github.com/$repo/releases/download/$Version/checksums.txt"

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$dest = Join-Path $Dir "tan.exe"

# Download to a TEMP file, never straight to $dest. Writing to the destination
# first and checking afterwards means a mismatched binary has already landed --
# and on Windows it may already be locked, or already on PATH, by the time the
# check fails. Verify, then move.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("tan-" + [Guid]::NewGuid().ToString("N") + ".exe")
$sumsTmp = "$tmp.checksums.txt"
Write-Host "install.ps1: downloading tan ($archPart, $Version)..."
try {
	# The transport error a 404 throws here says only THAT the fetch failed,
	# never why -- and a 404 for an asset that was never published looks
	# identical to a network/proxy outage otherwise. Name the one cause this
	# script can actually know (there is no Windows arm64 asset, ever, from
	# v0.5.0 -- a PyInstaller freeze cannot be cross-compiled, and this release
	# builds on four runners, not six) and point at the source install; guess
	# at nothing else. Mirrors install.sh's equivalent case for linux/arm64.
	try {
		Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
	} catch {
		Write-Host "install.ps1: download failed: $url" -ForegroundColor Red
		if ($archPart -eq "aarch64") {
			Write-Error "install.ps1: there is no prebuilt Windows arm64 asset from v0.5.0 onward. The binary is a frozen build that must be produced on the architecture it runs on, and the release builds no Windows arm64 leg. Install from a checkout instead: git clone https://github.com/$repo && pip install ./tan-cli/python"
		} else {
			Write-Error "install.ps1: if this is a 404 rather than a network failure, check which assets $Version actually publishes: https://github.com/$repo/releases"
		}
		exit 1
	}

	# -----------------------------------------------------------------------
	# Verify what landed against the checksums.txt published in the SAME release.
	#
	# TLS says we talked to github.com. It does not say github.com handed us the
	# bytes we published, and it says nothing about a proxy, a cache, or a
	# truncated write. checksums.txt already exists at every tag, and
	# alp-sdk-vscode already verifies its own managed download against it
	# (alplabai/alp-sdk-vscode#389) and refuses a mismatch. Until this landed the
	# two acquisition paths for the same binary disagreed about whether they
	# check it -- and the unverified one is what the extension's "Install tan CLI
	# (global)" button runs, whose result the extension's resolver then PREFERS
	# over its own verified copy, on every activation, indefinitely.
	#
	# THREE distinct outcomes, three distinct messages, all refusing. Being
	# offline behind a corporate proxy and being handed a tampered binary are not
	# the same situation and must not read the same. (Get-FileHash is built in
	# since PowerShell 4, so the POSIX script's fourth outcome -- no sha256 tool
	# on PATH -- cannot arise here.) Nothing reaches $dest on any of them.
	# -----------------------------------------------------------------------
	Write-Host "install.ps1: verifying against $Version checksums.txt..."
	try {
		Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsTmp -UseBasicParsing
	} catch {
		# Outcome 1: the digests could not be fetched. Says nothing about the
		# binary -- which is why it must not be worded like a mismatch.
		Write-Error "install.ps1: could not fetch $sumsUrl`nRefusing to install -- the binary downloaded, but there is nothing to check it against. This is a fetch failure, NOT evidence the binary is bad. Retry, or check a proxy/firewall."
		exit 1
	}

	$want = $null
	foreach ($line in Get-Content -LiteralPath $sumsTmp) {
		$parts = $line -split '\s+', 2
		if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $asset) { $want = $parts[0].Trim(); break }
	}
	if (-not $want) {
		# Outcome 2: fetched fine, but this asset is not in it. A release that
		# shipped the binary and omitted it from checksums.txt is a release bug,
		# and installing anyway is how it would stay one.
		Write-Error "install.ps1: $asset is not listed in $Version's checksums.txt`nRefusing to install -- the digest file exists but does not cover this asset, so it cannot be verified. Report this against $repo; the release is incomplete."
		exit 1
	}

	$got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
	if ($got -ne $want.ToLower()) {
		# Outcome 3: the one that means something is actually wrong.
		Write-Error "install.ps1: SHA256 MISMATCH for $asset ($Version)`n  expected $want`n  got      $got`nRefusing to install. The downloaded bytes are not the bytes published at $Version -- corruption, a caching proxy, or tampering. Nothing was written to $Dir."
		exit 1
	}
	Write-Host "install.ps1: sha256 OK ($got)"

	Move-Item -LiteralPath $tmp -Destination $dest -Force
} finally {
	Remove-Item -LiteralPath $tmp, $sumsTmp -Force -ErrorAction SilentlyContinue
}

# Add $Dir to the chosen PATH scope if absent. Machine scope requires admin;
# SetEnvironmentVariable throws a clear permission error if not elevated.
$curPath = [Environment]::GetEnvironmentVariable("Path", $scope)
if (-not ($curPath -split ';' | Where-Object { $_ -eq $Dir })) {
	$newPath = if ([string]::IsNullOrEmpty($curPath)) { $Dir } else { "$curPath;$Dir" }
	[Environment]::SetEnvironmentVariable("Path", $newPath, $scope)
	Write-Host "install.ps1: added $Dir to the $scope Path -- restart the terminal for it to take effect."
}

Write-Host "install.ps1: installed tan -> $dest"
& $dest --version
