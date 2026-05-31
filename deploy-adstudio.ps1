<#
  deploy-adstudio.ps1
  ---------------------------------------------------------------------------
  Ships the AdStudio live-data + publish-readiness changes to production
  SAFELY, without using the corrupted clone in C:\Dev\Blockwise.

  What it does:
    1. Clones a FRESH copy of current production (origin/main) into
       C:\Dev\blockwise-clean  (your existing folder is left untouched).
    2. Copies the 4 changed AdStudio files from C:\Dev\Blockwise into it.
    3. Commits and pushes to main  ->  Vercel deploys to blockwise.sale.

  Run it from a normal PowerShell window (where your GitHub login works):
       cd C:\Dev\Blockwise
       ./deploy-adstudio.ps1
#>

$ErrorActionPreference = "Stop"

$repoUrl   = "https://github.com/stevenshelley58-afk/blockwise.git"
$source    = "C:\Dev\Blockwise"        # your existing folder (files are correct here)
$clone     = "C:\Dev\blockwise-clean"  # fresh, clean checkout

$files = @(
  "src\app\(customer)\ad-studio\page.tsx",
  "src\lib\adstudio\persistence.ts",
  "src\lib\adstudio\load-live-bundle.ts",
  "src\app\api\adstudio\publish-readiness\route.ts",
  "src\app\api\integrations\meta\callback\route.ts",
  "src\app\api\integrations\google\callback\route.ts"
)

Write-Host "==> 1/4  Fresh clone of current production" -ForegroundColor Cyan
if (Test-Path $clone) {
  Write-Host "    $clone already exists - pulling latest instead of re-cloning."
  git -C $clone checkout main
  git -C $clone pull origin main
} else {
  git clone $repoUrl $clone
}

Write-Host "==> 2/4  Copying the changed files in" -ForegroundColor Cyan
foreach ($f in $files) {
  $src = Join-Path $source $f
  $dst = Join-Path $clone  $f
  if (-not (Test-Path $src)) { throw "Missing source file: $src" }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item $src $dst -Force
  Write-Host "    + $f"
}

Write-Host "==> 3/4  Commit" -ForegroundColor Cyan
Push-Location $clone
git add -- $files
git commit -m "feat(adstudio+monitor): live workspace data, publish-readiness, auto-sync provider reporting on connect"

Write-Host "==> 4/4  Push to main (triggers Vercel production deploy)" -ForegroundColor Cyan
git push origin main
Pop-Location

Write-Host ""
Write-Host "Done. Watch the deploy at https://vercel.com/steven-shelleys-projects/blockwise" -ForegroundColor Green
Write-Host "Going forward, work out of C:\Dev\blockwise-clean (your old folder's git is corrupted)." -ForegroundColor Yellow
