$ErrorActionPreference = 'Stop'
$f = 'C:\Dev\Blockwise\src\app\globals.css'
$c = Get-Content $f -Raw
$orig = $c

# Tighten the remaining brand hexes to tokens, leaving #fff (text on navy) and
# background: #131b2e (dark-on-dark) untouched.
$c = [regex]::Replace($c, 'color:\s*#123e75', 'color: var(--accent)')
$c = [regex]::Replace($c, 'border-color:\s*#123e75', 'border-color: var(--accent)')
$c = [regex]::Replace($c, 'background:\s*#dfe6f0', 'background: var(--line)')
$c = [regex]::Replace($c, 'color:\s*#002855', 'color: var(--accent-press)')

if ($c -ne $orig) {
  Set-Content -Path $f -Value $c -Encoding UTF8 -NoNewline
  Write-Host "updated"
} else { Write-Host "no change" }
