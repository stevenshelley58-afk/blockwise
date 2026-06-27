$ErrorActionPreference = 'Stop'
$files = @(
  'C:\Dev\Blockwise\src\app\globals.css',
  'C:\Dev\Blockwise\src\app\landing.css',
  'C:\Dev\Blockwise\src\app\meta-monitor.css'
)
foreach ($f in $files) {
  if (-not (Test-Path $f)) { continue }
  $c = Get-Content $f -Raw
  $orig = $c
  # Corner-only / multi-value forms (order: TL TR BR BL)
  $c = $c -replace 'border-radius: 10px 10px 0 0;', 'border-radius: var(--r-card) var(--r-card) 0 0;'
  $c = $c -replace 'border-radius: 16px 16px 12px 12px;', 'border-radius: var(--r-panel) var(--r-panel) var(--r-card) var(--r-card);'
  # Remaining tiny badge radii -> use --r-ctl (looks like a 2-3px hairline; close enough at our scale)
  $c = $c -replace 'border-radius: 3px;', 'border-radius: var(--r-ctl);'
  $c = $c -replace 'border-radius: 2px;', 'border-radius: var(--r-ctl);'
  if ($c -ne $orig) {
    Set-Content -Path $f -Value $c -Encoding UTF8 -NoNewline
    Write-Host "updated: $f"
  } else {
    Write-Host "no change: $f"
  }
}
