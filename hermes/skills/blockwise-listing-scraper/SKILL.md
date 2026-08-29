# blockwise-listing-scraper

Scrape an Australian property listing URL, extract structured data and photos,
upload assets to Supabase storage, and return the result for ad generation.

## Trigger

Invoked by the Vercel API route `POST /api/adstudio/listing-extract` when a
customer pastes a listing URL in the New Ad Dialog.

## Input

```json
{
  "url": "https://www.realestate.com.au/property-house-wa-scarborough-12345678",
  "workspaceId": "uuid"
}
```

## Output

```json
{
  "ok": true,
  "listing": { "address": "...", "suburb": "...", "price": "...", "photos": [...] },
  "brief": "3 bed 2 bath 1 car house at 18 Tallow Lane, Scarborough WA 6019. Price: $650,000.",
  "photos": ["https://supabase.../photo-1.jpg", "..."],
  "folder": "listing-assets/{workspaceId}/{slug}"
}
```

## Process

1. Validate URL (must be `.com.au` or `.au` domain).
2. Static fetch with browser headers (5s timeout).
3. If blocked: Obscura stealth browser render via CDP (20s timeout, residential proxy).
4. Extract data: JSON-LD → OG meta → visible text heuristics.
5. Download up to 5 photos server-side (defeats CDN protection).
6. Upload photos + listing.json to Supabase storage at `listing-assets/{workspaceId}/{slug}/`.
7. Return Supabase public URLs + extracted ListingData.

## Anti-blocking

- Obscura stealth browser with fingerprint injection
- Residential proxy (RESIDENTIAL_PROXY_URL)
- Full browser header set on static fetch
- In-browser photo download (real Referer, cookies, no CORS)
- Retry with backoff (up to 2 retries, 3s/6s delays)

## Constraints

- Only AU domains accepted.
- Max 5 photos per listing.
- 5 MB per photo limit.
- Rate limited: 30 requests/hour global.

## Runtime

Runs as a standalone Node.js HTTP service in the docker-compose research
network (port 8650). Authenticated with `x-api-key` header matching
`HERMES_API_SERVER_KEY`.
