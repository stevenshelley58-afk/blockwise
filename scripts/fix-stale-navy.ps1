$ErrorActionPreference = 'Stop'
$files = @(
  'C:\Dev\Blockwise\src\components\adstudio\styles.ts',
  'C:\Dev\Blockwise\src\components\adstudio\brand-studio.tsx',
  'C:\Dev\Blockwise\src\components\operator\research-console-styles.ts'
)
foreach ($f in $files) {
  $c = Get-Content $f -Raw
  $orig = $c
  # Old navy (31,58,110) -> brand navy (18,62,117)
  $c = $c -replace 'rgba\(31,\s?58,\s?110', 'rgba(18,62,117'
  # Slate-900 typo (15,23,41) -> brand ink rgb (15,23,42)
  $c = $c -replace 'rgba\(15,\s?23,\s?41', 'rgba(15,23,42'
  if ($c -ne $orig) {
    Set-Content -Path $f -Value $c -Encoding UTF8 -NoNewline
    Write-Host "updated: $f"
  } else { Write-Host "no change: $f" }
}
