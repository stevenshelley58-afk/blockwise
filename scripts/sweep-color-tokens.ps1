$ErrorActionPreference = 'Stop'
$files = @(
  'C:\Dev\Blockwise\src\app\globals.css',
  'C:\Dev\Blockwise\src\app\landing.css',
  'C:\Dev\Blockwise\src\app\meta-monitor.css'
)
foreach ($f in $files) {
  $c = Get-Content $f -Raw
  $orig = $c

  # 1) Tokenize 'background: #ffffff' and 'background: #fff' and 'background-color: #fff' as var(--surface).
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#ffffff\b', '$1var(--surface)')
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#fff\b', '$1var(--surface)')

  # 2) Tokenize 'background: #f8fafc' / 'background-color: #f8fafc' as var(--bg).
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#f8fafc\b', '$1var(--bg)')

  # 3) Tokenize 'background: #f1f5f9' / 'background-color: #f1f5f9' as var(--surface-subtle).
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#f1f5f9\b', '$1var(--surface-subtle)')

  # 4) Tokenize literal 'color: #131b2e' / 'color: #475569' / 'color: #94a3b8' as their tokens.
  $c = [regex]::Replace($c, '(color:\s*)#131b2e\b', '$1var(--ink)')
  $c = [regex]::Replace($c, '(color:\s*)#475569\b', '$1var(--muted)')
  $c = [regex]::Replace($c, '(color:\s*)#94a3b8\b', '$1var(--faint)')

  # 5) Tokenize border-color literal palette values to the line/border tokens.
  $c = [regex]::Replace($c, '(border(?:-color)?:\s*)#dfe6f0\b', '$1var(--line)')
  $c = [regex]::Replace($c, '(border(?:-color)?:\s*)#cbd5e1\b', '$1var(--line-heavy)')
  $c = [regex]::Replace($c, '(border(?:-color)?:\s*)#edf1f6\b', '$1var(--line-soft)')

  # 6) Tokenize 'background: #123e75' / 'background: #002855' as accent variants.
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#123e75\b', '$1var(--accent)')
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#0d3263\b', '$1var(--accent-strong)')
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#002855\b', '$1var(--accent-press)')

  # 7) Status / soft tokenise. Cover the common ones.
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#ecfdf5\b', '$1var(--green-soft)')
  $c = [regex]::Replace($c, '(color:\s*)#006d38\b', '$1var(--green)')
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#fdf8ee\b', '$1var(--amber-soft, #fdf8ee)')
  $c = [regex]::Replace($c, '(color:\s*)#8a5a00\b', '$1var(--amber)')
  $c = [regex]::Replace($c, '(background(?:-color)?:\s*)#fdf3f2\b', '$1var(--rose-soft)')
  $c = [regex]::Replace($c, '(color:\s*)#ba1a1a\b', '$1var(--rose)')
  $c = [regex]::Replace($c, '(color:\s*)#eef3fb\b', '$1var(--accent-tint)')

  if ($c -ne $orig) {
    Set-Content -Path $f -Value $c -Encoding UTF8 -NoNewline
    Write-Host "updated: $f"
  } else {
    Write-Host "no change: $f"
  }
}
