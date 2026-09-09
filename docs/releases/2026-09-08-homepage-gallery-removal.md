# Homepage gallery removal, 8 September 2026

Historical preview revision `bc3237a6db4b3d85a2fb44b329bf86617f2d863d` removes the template gallery and Examples navigation link at the user's request. Other sections remain unchanged.

Live container/image: `blockwise-homepage-preview-bc3237a6db4b` / `blockwise-homepage-preview:bc3237a6db4b`. Retained rollback: `blockwise-homepage-preview-c1d33bc534f4` and its image. Source and evidence: `/projects/blockwise-homepage-chat-reconciled-20260907`, `work/remove-gallery/`.

NUL check, full test command, typecheck and production build passed. Candidate and public HTML matched. Browser reload verified the compiled revision, absent section and navigation link, and all six remaining sections. Caddy comparison confirmed only the preview route changed; main product health passed. No backend or provider writes occurred.
