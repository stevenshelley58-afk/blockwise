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
  # Tokenise border-radius literals (preserve 50%/inherit/99px/9999px pill values)
  $c = [regex]::Replace($c, 'border-radius:\s*4px;', 'border-radius: var(--r-ctl);')
  $c = [regex]::Replace($c, 'border-radius:\s*5px;', 'border-radius: var(--r-ctl);')
  $c = [regex]::Replace($c, 'border-radius:\s*6px;', 'border-radius: var(--r-ctl);')
  $c = [regex]::Replace($c, 'border-radius:\s*7px;', 'border-radius: var(--r-ctl);')
  $c = [regex]::Replace($c, 'border-radius:\s*8px;', 'border-radius: var(--r-ctl);')
  $c = [regex]::Replace($c, 'border-radius:\s*9px;', 'border-radius: var(--r-ctl);')
  $c = [regex]::Replace($c, 'border-radius:\s*10px;', 'border-radius: var(--r-card);')
  $c = [regex]::Replace($c, 'border-radius:\s*11px;', 'border-radius: var(--r-card);')
  $c = [regex]::Replace($c, 'border-radius:\s*12px;', 'border-radius: var(--r-card);')
  $c = [regex]::Replace($c, 'border-radius:\s*13px;', 'border-radius: var(--r-card);')
  $c = [regex]::Replace($c, 'border-radius:\s*14px;', 'border-radius: var(--r-panel);')
  $c = [regex]::Replace($c, 'border-radius:\s*15px;', 'border-radius: var(--r-panel);')
  $c = [regex]::Replace($c, 'border-radius:\s*16px;', 'border-radius: var(--r-panel);')
  $c = [regex]::Replace($c, 'border-radius:\s*18px;', 'border-radius: var(--r-panel);')
  $c = [regex]::Replace($c, 'border-radius:\s*20px;', 'border-radius: var(--r-panel);')
  $c = [regex]::Replace($c, 'border-radius:\s*22px;', 'border-radius: var(--r-panel);')
  $c = [regex]::Replace($c, 'border-radius:\s*24px;', 'border-radius: var(--r-panel);')
  $c = [regex]::Replace($c, 'border-radius:\s*28px;', 'border-radius: var(--r-panel);')
  if ($c -ne $orig) {
    Set-Content -Path $f -Value $c -Encoding UTF8 -NoNewline
    Write-Host "updated: $f"
  } else {
    Write-Host "no change: $f"
  }
}
