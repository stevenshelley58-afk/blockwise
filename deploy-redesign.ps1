<#
  deploy-redesign.ps1
  ---------------------------------------------------------------------------
  Ships the navy-minimalist UI redesign to production SAFELY, without using
  the corrupted git tree in C:\Dev\Blockwise.

  What it does:
    1. Clones a FRESH copy of current production (origin/main) into
       C:\Dev\blockwise-clean  (your existing folder is left untouched).
       If it already exists, it is reset hard to origin/main.
    2. Copies the 5 changed redesign files from C:\Dev\Blockwise into it.
    3. Runs `npm install` + `npm run build` to verify the build BEFORE pushing.
       (Skip with  -SkipBuild  if you'd rather rely on Vercel's build gate.)
    4. Commits and pushes to main  ->  Vercel deploys to blockwise.sale.

  Run it from a normal PowerShell window (where your GitHub login works):
       cd C:\Dev\Blockwise
       ./deploy-redesign.ps1
       # or, to skip the local build check:
       ./deploy-redesign.ps1 -SkipBuild
#>

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/stevenshelley58-afk/blockwise.git"
$source  = "C:\Dev\Blockwise"        # your existing folder (files are correct here)
$clone   = "C:\Dev\blockwise-clean"  # fresh, clean checkout

# The redesign changes (full-file copies; self-contained, no other deps).
$files = @(
  "src\app\layout.tsx",
  "src\app\globals.css",
  "src\components\app-shell.tsx",
  "src\components\blockwise-logo.tsx",
  "src\components\sidebar-theme-toggle.tsx"
)

Write-Host "==> 1/5  Fresh clone of current production (origin/main)" -ForegroundColor Cyan
if (Test-Path $clone) {
  Write-Host "    $clone exists - resetting hard to origin/main."
  git -C $clone fetch origin main
  git -C $clone checkout main
  git -C $clone reset --hard origin/main
  git -C $clone clean -fd
} else {
  git clone $repoUrl $clone
}

Write-Host "==> 2/5  Copying the changed files in" -ForegroundColor Cyan
foreach ($f in $files) {
  $src = Join-Path $source $f
  $dst = Join-Path $clone  $f
  if (-not (Test-Path $src)) { throw "Missing source file: $src" }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item $src $dst -Force
  Write-Host "    + $f"
}

# Bring env across so the build has what it needs (not committed).
$envSrc = Join-Path $source ".env.local"
if (Test-Path $envSrc) {
  Copy-Item $envSrc (Join-Path $clone ".env.local") -Force
  Write-Host "    + .env.local (for build only, not committed)"
}

Push-Location $clone
try {
  if (-not $SkipBuild) {
    Write-Host "==> 3/5  Verifying build (npm install + npm run build)" -ForegroundColor Cyan
    npm install
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed - NOT pushing. Fix the errors above, then re-run." }
    Write-Host "    Build OK." -ForegroundColor Green
  } else {
    Write-Host "==> 3/5  Skipping local build (relying on Vercel's build gate)" -ForegroundColor Yellow
  }

  Write-Host "==> 4/5  Commit" -ForegroundColor Cyan
  git add -- $files
  git commit -m "feat(ui): navy minimalist redesign - load Inter, real Blockwise logo, dark/light sidebar toggle, refreshed token + component system"

  Write-Host "==> 5/5  Push to main (triggers Vercel production deploy)" -ForegroundColor Cyan
  git push origin main
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Done. Watch the deploy at https://vercel.com/steven-shelleys-projects/blockwise" -ForegroundColor Green
Write-Host "Live at https://blockwise.sale once the deploy turns Ready." -ForegroundColor Green
