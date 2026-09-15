# Email design reference (15 September 2026)

Static renders of the approved email design, moved here from `/root/emailtest` and
`/srv/frank/previews/emailtest-20260915` on the VPS so they live with the code.
They are the visual target for porting into `src/lib/email-design/renderer.ts`.
Nothing in this folder is sent by the product.

- `demo-welcome.html`  Welcome to Blockwise (hero image, quiet-card)
- `demo-trial.html`    Trial ends on a date (chart, detail card)
- `demo-budget.html`   Budget alert for a campaign (image, detail card)
- `dark-mode-chart-test.html`  The final light/dark experiment: chart image carries no text, labels live in HTML rows, `prefers-color-scheme` plus `[data-ogsc]` for Outlook

Images: `demo-hero.jpg`, `daily-line-v4.png` (final chart), `light.png` / `dark.jpg` / `control.png` (the fetch experiment).
`weekly-line.png` and `sample-seller-appraisal.jpg` referenced by the trial and budget demos were never written to the preview host; those two images need remaking.

Dark mode rules to carry into the renderer: body/background, `.card`, `.detail-card`,
`.summary-metrics`, `.ink`, `.muted`, `.mark`, `.rule`, `.action`, `.letter-action`,
each under both `@media (prefers-color-scheme: dark)` and `[data-ogsc]`.
