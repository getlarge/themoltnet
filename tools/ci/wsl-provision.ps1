# Provision a WSL2 distro on a hosted Windows runner and copy the checkout
# into its ext4 filesystem.
#
# `wsl.exe --install` can stall or fail transiently on hosted runners (for
# example `Wsl/InstallDistro/.../CreateVm/ERROR_TIMEOUT`), and it returns a
# non-zero exit code that the calling shell does not check by itself. This
# script bounds each attempt, cleans up partial registrations, retries, and
# fails with the step that broke instead of letting later `wsl.exe` calls
# report `WSL_E_DISTRO_NOT_FOUND`.
#
# Usage: pwsh tools/ci/wsl-provision.ps1 [-Distro Ubuntu-24.04]
param(
  [string]$Distro = 'Ubuntu-24.04',
  [int]$MaxAttempts = 3,
  # A healthy install takes about a minute on windows-2025 runners.
  [int]$InstallTimeoutSeconds = 180,
  [int]$ProbeTimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Without this, wsl.exe writes UTF-16 that PowerShell decodes into
# NUL-separated text, which breaks `--list` parsing and garbles the log.
$env:WSL_UTF8 = '1'

# Runs wsl.exe with a hard timeout. Returns the exit code, or $null when the
# process had to be killed.
function Invoke-Wsl {
  param([string[]]$Arguments, [int]$TimeoutSeconds)

  Write-Host "> wsl.exe $($Arguments -join ' ')"
  $process = Start-Process -FilePath 'wsl.exe' -ArgumentList $Arguments `
    -NoNewWindow -PassThru
  # Caching the handle is required for ExitCode to be populated later.
  $null = $process.Handle
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Write-Warning "wsl.exe $($Arguments[0]) did not finish within $TimeoutSeconds s; killing it."
    try {
      $process.Kill($true)
    } catch [System.InvalidOperationException] {
      # The process exited between the timeout and the kill; nothing to stop.
    }
    $process.WaitForExit()
    return $null
  }
  return $process.ExitCode
}

function Test-DistroRegistered {
  $names = wsl.exe --list --quiet 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $names) { return $false }
  return [bool]($names | ForEach-Object { $_.Trim([char]0, ' ') } |
      Where-Object { $_ -eq $Distro })
}

function Test-DistroReady {
  (Invoke-Wsl -Arguments @('--distribution', $Distro, '--', 'true') `
      -TimeoutSeconds $ProbeTimeoutSeconds) -eq 0
}

$ready = (Test-DistroRegistered) -and (Test-DistroReady)

for ($attempt = 1; -not $ready -and $attempt -le $MaxAttempts; $attempt++) {
  Write-Host "::group::Install $Distro (attempt $attempt/$MaxAttempts)"
  try {
    if ($attempt -gt 1) {
      # Drop a half-registered distro and restart the WSL VM so the next
      # attempt does not inherit the state that just failed.
      $null = Invoke-Wsl -Arguments @('--unregister', $Distro) -TimeoutSeconds $ProbeTimeoutSeconds
      $null = Invoke-Wsl -Arguments @('--shutdown') -TimeoutSeconds $ProbeTimeoutSeconds
    }

    $code = Invoke-Wsl -Arguments @('--install', '--distribution', $Distro, '--no-launch') `
      -TimeoutSeconds $InstallTimeoutSeconds
    if ($null -eq $code) {
      Write-Warning "Install attempt $attempt timed out."
    } elseif ($code -ne 0) {
      Write-Warning "Install attempt $attempt exited with code $code."
    } elseif (-not (Test-DistroReady)) {
      Write-Warning "Install attempt $attempt finished, but $Distro does not start."
    } else {
      $ready = $true
    }
  } finally {
    Write-Host '::endgroup::'
  }

  if (-not $ready -and $attempt -lt $MaxAttempts) {
    $delay = 15 * $attempt
    Write-Host "Retrying in $delay s."
    Start-Sleep -Seconds $delay
  }
}

if (-not $ready) {
  Write-Host "::error title=WSL provisioning failed::$Distro could not be installed after $MaxAttempts attempts."
  exit 1
}

Write-Host "$Distro is ready."

wsl.exe --distribution $Distro -- bash -lc 'rm -rf ~/src/themoltnet && mkdir -p ~/src/themoltnet'
if ($LASTEXITCODE -ne 0) {
  Write-Host "::error title=WSL provisioning failed::Could not prepare ~/src/themoltnet in $Distro."
  exit 1
}

# PowerShell reports only the last command's exit code for a native pipeline,
# so a truncated stream is caught by the extracting tar and by the sentinel
# check below.
tar.exe -cf - --exclude=.git . | wsl.exe --distribution $Distro -- bash -lc 'tar -xf - -C ~/src/themoltnet'
if ($LASTEXITCODE -ne 0) {
  Write-Host "::error title=WSL provisioning failed::Copying the checkout into $Distro failed."
  exit 1
}

wsl.exe --distribution $Distro -- bash -lc 'test -f ~/src/themoltnet/pnpm-lock.yaml'
if ($LASTEXITCODE -ne 0) {
  Write-Host "::error title=WSL provisioning failed::The checkout copy in $Distro is incomplete."
  exit 1
}
