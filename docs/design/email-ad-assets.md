# Email ad asset provenance

Prepared 2026-09-08 for the Blockwise email redesign. These are bounded, illustrative sample creatives for email previews. They are not customer ads, campaign results, or proof of market performance.

## Delivered assets

| Email asset | Dimensions | Size | Representative use | Honest alt text |
| --- | ---: | ---: | --- | --- |
| `public/email-assets/sample-seller-appraisal.jpg` | 640 x 1138 px | 62,514 bytes | Fictional Baldivis seller-appraisal campaign | “Illustrative real-estate ad showing a property specialist and the headline ‘What could your home be worth?’ with a free appraisal call to action.” |
| `public/email-assets/sample-buyer-demand.jpg` | 640 x 1138 px | 65,287 bytes | Fictional Rockingham seller campaign using buyer-demand messaging | “Illustrative real-estate ad showing a home above an outstretched hand and the headline ‘Active buyers want homes like yours’ with a buyer-demand call to action.” |

Both files are JPEG derivatives at the email-safe 640px width and remain below 70 KB. They retain the ad's dominant property image, visual treatment, copy, and call to action rather than reducing the preview to a plain property photo.

## Source and transformation

The source creatives are existing approved/sample ad previews in the project:

- `public/adstudio-thumbnails/meta/0bc3d7223f7856c4116c275b42faf9447a13f7abd10f778c6d6c5bff6ba76482-640.webp` supplied the seller-appraisal derivative.
- `public/adstudio-thumbnails/meta/050567bfb9034fb5d5fc3974a13f030e8e82c288eea1f5ddec6b93057a18635b-640.webp` supplied the buyer-demand derivative.

The only transformation was delivery optimization from the existing 640px WebP derivatives to baseline JPEG using the installed FFmpeg utility. No copy, faces, logos, addresses, phone numbers, metrics, or attribution were added.

The location labels in the table are representative email scenarios requested for this redesign. The creatives themselves intentionally retain their sample copy and generic sample branding. Keep “illustrative” or “sample” visible in the surrounding email treatment wherever these assets are shown, and do not present their sample contact details as a real agent or customer record.

## Usage note

Recommended filenames for the renderer are exactly the two paths above. The assets are presentation-only and are not wired into runtime, campaign records, or publishing flows by this package.
