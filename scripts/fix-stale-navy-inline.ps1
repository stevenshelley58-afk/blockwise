$ErrorActionPreference = 'Stop'
$files = @(
  'C:\Dev\Blockwise\src\components\trial-status-pill.tsx',
  'C:\Dev\Blockwise\src\components\adstudio\ad-studio-workbench.tsx',
  'C:\Dev\Blockwise\src\components\adstudio\panels\brand-panel.tsx',
  'C:\Dev\Blockwise\src\app\(customer)\settings\settings-view.tsx'
)
foreach ($f in $files) {
  $c = Get-Content $f -Raw
  $orig = $c
  $c = $c -replace 'rgba\(15,\s?23,\s?41', 'rgba(15,23,42'
  $c = $c -replace 'rgba\(31,\s?58,\s?110', 'rgba(18,62,117'
  if ($c -ne $orig) {
    Set-Content -Path $f -Value $c -Encoding UTF8 -NoNewline
    Write-Host "updated: $f"
  } else { Write-Host "no change: $f" }
}
