# Backstop for the court-record checks.
#
# GitHub's scheduler delivers this repo's scheduled runs late and drops
# many of them (see CLAUDE.md, SCHEDULING). This script is a second,
# independent trigger: a Windows scheduled task runs it every 30 minutes
# on weekdays, and it dispatches the "Update court data and deploy"
# workflow ONLY when the site's own heartbeat says the last check is
# overdue. When GitHub is keeping up, it does nothing.
#
# It never contacts the court system itself; it only asks GitHub to run
# the existing workflow. Needs the GitHub CLI signed in as a user with
# write access, and only works while this machine is on and logged in.
#
#   Register:  see CLAUDE.md ("backstop task")
#   Dry run:   powershell -File tools\backstop-check.ps1 -DryRun
#   Log:       %LOCALAPPDATA%\wpr-court-tracker\backstop.log

param(
  [switch]$DryRun,       # print the decision; dispatch nothing, log nothing
  [switch]$IgnoreHours   # testing only: evaluate as if inside the weekday window
)

$ErrorActionPreference = 'Stop'
$Site = 'https://rowanflynnpilot.github.io/wpr-court-tracker'
$Repo = 'RowanFlynnPilot/wpr-court-tracker'
$Workflow = 'Update court data and deploy'
$OverdueMinutes = 110     # two-hour spacing on a 30-minute tick; the workflow's own gate is 105
$MinGapMinutes = 100      # never dispatch twice inside this window

$StateDir = Join-Path $env:LOCALAPPDATA 'wpr-court-tracker'
$LogPath = Join-Path $StateDir 'backstop.log'
$StampPath = Join-Path $StateDir 'last-dispatch.txt'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message"
  if ($DryRun) { Write-Output "[dry run] $line"; return }
  Add-Content -Path $LogPath -Value $line -Encoding utf8
  # Keep the log small: last 400 lines.
  $all = Get-Content -Path $LogPath
  if ($all.Count -gt 500) { $all | Select-Object -Last 400 | Set-Content -Path $LogPath -Encoding utf8 }
}

try {
  # Central time, whatever this machine's clock zone is.
  $central = [TimeZoneInfo]::FindSystemTimeZoneById('Central Standard Time')
  $now = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $central)
  $weekday = $now.DayOfWeek -notin 'Saturday', 'Sunday'
  # Through 6:10 p.m. so the task's last tick (6:05) can make the day's sixth check.
  $minuteOfDay = $now.Hour * 60 + $now.Minute
  if (-not $IgnoreHours -and (-not $weekday -or $minuteOfDay -lt 480 -or $minuteOfDay -gt 1090)) {
    Write-Log "skip: outside weekdays 8 a.m.-6:10 p.m. Central ($($now.ToString('ddd HH:mm')))"
    exit 0
  }

  $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

  # Our own last dispatch: a hard floor, even if the heartbeat is unreadable.
  if (Test-Path $StampPath) {
    $mine = [int64](Get-Content $StampPath -TotalCount 1)
    $sinceMine = [math]::Floor(($epoch - $mine) / 60)
    if ($sinceMine -lt $MinGapMinutes) {
      Write-Log "skip: this backstop dispatched $sinceMine min ago"
      exit 0
    }
  }

  $age = $null
  try {
    $beat = Invoke-RestMethod -Uri "$Site/heartbeat.json?t=$epoch" -TimeoutSec 20
    $age = [math]::Floor(($epoch - [int64]$beat.attemptedAtEpoch) / 60)
  } catch {
    Write-Log "heartbeat unreadable ($($_.Exception.Message)); treating the check as overdue"
  }

  if ($null -ne $age -and $age -lt $OverdueMinutes) {
    Write-Log "skip: last check was $age min ago - GitHub's schedule is keeping up"
    exit 0
  }

  $why = if ($null -ne $age) { "last check was $age min ago" } else { 'no heartbeat' }
  if ($DryRun) {
    Write-Log "WOULD dispatch '$Workflow' ($why)"
    exit 0
  }

  $gh = (Get-Command gh -ErrorAction Stop).Source
  & $gh workflow run $Workflow --repo $Repo | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "gh workflow run exited $LASTEXITCODE" }
  Set-Content -Path $StampPath -Value $epoch -Encoding ascii
  Write-Log "DISPATCHED '$Workflow' ($why)"
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  exit 1
}
