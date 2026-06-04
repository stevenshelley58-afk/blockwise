<#
  deploy-adstudio-ui.ps1
  ---------------------------------------------------------------------------
  Ships the Ad Studio UI cleanup to PRODUCTION (blockwise.sale) SAFELY,
  without using the corrupted git clone in C:\Dev\Blockwise.

  This change:
    - Fix: workspace columns now scroll (added min-height:0)
    - Readiness checklist moved into the Publish tab
    - Variants moved under the main preview (thumbnail strip)
    - Rebuilt the top preview toolbar (one clean row + zoom stepper)
    - Removed the Platform/Creative toggle + redundant Preview button
      (preview always shows the in-feed view)

  What it does:
    1. Clones a FRESH copy of current production (origin/main) into
       C:\Dev\blockwise-clean  (your existing folder is left untouched).
    2. Copies the changed files from C:\Dev\Blockwise into it.
    3. Commits and pushes to main  ->  Vercel deploys to blockwise.sale.

  Run it from a normal PowerShell window (where your GitHub login works):
       cd C:\Dev\Blockwise
       ./deploy-adstudio-ui.ps1
#>

$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/stevenshelley58-afk/blockwise.git"
$source  = "C:\Dev\Blockwise"        # your existing folder (files are correct here)
$clone   = "C:\Dev\blockwise-clean"  # fresh, clean checkout

$files = @(
  "src\components\adstudio\ad-studio-workbench.tsx",
  "e2e\platform.spec.ts"
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
git commit -m "feat(adstudio): scrollable workspace, checklist in Publish, variants under preview, clean toolbar, drop Platform/Creative toggle"

Write-Host "==> 4/4  Push to main (triggers Vercel production deploy)" -ForegroundColor Cyan
git push origin main
Pop-Location

Write-Host ""
Write-Host "Done. Watch the deploy at https://vercel.com/steven-shelleys-projects/blockwise" -ForegroundColor Green
Write-Host "It goes live on https://blockwise.sale once the build passes." -ForegroundColor Green
