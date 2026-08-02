## Dimension 1: Meta Ad Library Official API

> Research date: 2026-07-19
> Searches conducted: 18 independent web searches + 1 direct fetch attempt
> Key finding (spoiler): The official API is **not a viable replacement** for Apify scraping of Australian real estate ads.

---

### Key Findings

- The official Meta Ad Library API endpoint is `GET https://graph.facebook.com/v<VERSION>/ads_archive` (current stable version v22.0 as of early 2026; v17.0 and earlier return errors) [^1][^2].
- The API is **free** — no per-call fees, no subscription, no usage charges [^3][^4].
- Rate limits are dynamic, app-and-token-scoped, and approximately **200 calls per hour per app/token** for standard access, with a rolling reset window [^5][^6][^7].
- **Authentication requires**: Meta developer account, a Business-type app, `ads_read` permission (app review required for production/third-party access), Meta Business Verification with official documents, and identity verification. Timeline: 5–10 business days minimum, up to 6–8 weeks total [^8][^9][^10].
- The API returns **structured JSON** with fields including `id`, `page_id`, `page_name`, `ad_creative_bodies`, `ad_creative_link_titles`, `ad_creative_link_descriptions`, `ad_snapshot_url`, `ad_delivery_start_time`, `ad_delivery_stop_time`, `publisher_platforms`, `languages`, and for political/EU ads: `impressions` (ranges), `spend` (ranges), `demographic_distribution`, `region_distribution` [^11][^12][^13].
- **Media is NOT returned as direct download URLs**. The API only provides `ad_snapshot_url` — a token-bearing embed URL to a preview page. Actual image/video extraction requires rendering the snapshot page client-side [^14][^15][^16].
- **Pagination is cursor-based** via `paging.cursors.after` and `paging.next`. The `limit` parameter defaults to 25 and can be raised (commonly cited max 1000, some sources claim 5000). You must loop until the `next` link is absent. Empty pages may still contain a `next` link due to visibility filtering [^17][^18][^19].
- **Historical data is NOT maintained for commercial ads**. Once an ad goes inactive, it disappears from the API. Only political/social-issue ads are archived for 7 years; EU-delivered ads are retained for 1 year after last impression. All other commercial ads vanish immediately [^20][^21][^22].
- **CRITICAL BLOCKER for Australian real estate**: The Ad Library API only returns (a) political and social-issue ads globally, (b) all ad types delivered in the EU/UK in the last 12 months, and (c) US special-category ads (Housing/Employment/Credit). **Commercial ads outside the EU are NOT available via the API** [^23][^24][^25]. Australian real estate ads are commercial non-EU ads → they are **invisible to the API**, even with `ad_type=HOUSING_ADS` and `ad_reached_countries=["AU"]` [^26][^27].
- **API vs Scraping**: The API gives structured, legal, stable data but only for political/EU ads. Scraping gives access to all active ads visible in the UI (including AU real estate), actual media previews, landing page URLs, and impression buckets, but is fragile, against Meta's ToS, requires proxy rotation, and breaks on DOM changes [^28][^29][^30].

---

### API Endpoints & Parameters

**Primary Endpoint**
```
GET https://graph.facebook.com/v<VERSION>/ads_archive
```

Current stable version as of early 2026: **v22.0** (calls to v17.0 and earlier return errors) [^2].

**Required Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `access_token` | string | Yes | App, user, or system user token |
| `ad_reached_countries` | array | Yes | ISO country codes, e.g. `["AU"]` or `["ALL"]` |
| `search_terms` OR `search_page_ids` | string / array | One required | Keyword search (space = AND) or up to 10 Page IDs |

**Key Optional Parameters**

| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `ad_type` | enum | `ALL`, `POLITICAL_AND_ISSUE_ADS`, `HOUSING_ADS`, `EMPLOYMENT_ADS`, `CREDIT_ADS`, `NEWS_ADS` | Filter by ad category [^11][^13] |
| `ad_active_status` | enum | `ACTIVE`, `INACTIVE`, `ALL` | Filter by delivery status |
| `ad_delivery_date_min` | string | `YYYY-MM-DD` | Ads delivered on or after this date [^12][^18] |
| `ad_delivery_date_max` | string | `YYYY-MM-DD` | Ads delivered on or before this date [^12][^18] |
| `media_type` | enum | `ALL`, `IMAGE`, `VIDEO`, `MEME`, `NONE` | Filter by creative format [^11] |
| `publisher_platforms` | array | `FACEBOOK`, `INSTAGRAM`, `AUDIENCE_NETWORK`, `MESSENGER`, `THREADS` | Filter by placement [^12] |
| `languages` | array | ISO codes | Filter by ad language [^11] |
| `fields` | string | Comma-separated field list | Explicit fields to return (API returns nothing by default) [^11][^13] |
| `limit` | int | 1–1000 (default 25) | Results per page [^6][^17] |
| `search_type` | enum | `KEYWORD_UNORDERED`, `KEYWORD_EXACT_PHRASE` | Keyword matching mode [^18] |

Example request for Australian housing ads (will return empty for commercial ads):
```bash
curl -G "https://graph.facebook.com/v22.0/ads_archive" \
  --data-urlencode "access_token=$META_TOKEN" \
  --data-urlencode "search_terms=real estate" \
  --data-urlencode "ad_reached_countries=[\"AU\"]" \
  --data-urlencode "ad_type=HOUSING_ADS" \
  --data-urlencode "ad_active_status=ACTIVE" \
  --data-urlencode "fields=id,page_id,page_name,ad_creative_bodies,ad_snapshot_url,ad_delivery_start_time,publisher_platforms" \
  --data-urlencode "limit=100"
```

---

### Rate Limits & Quotas

Meta does **not publish a fixed rate-limit ceiling** for the Ad Library API. The endpoint enforces dynamic, app-and-token-scoped throttling [^1][^5].

**Observed / cited limits:**
- **~200 calls per hour per app/token** for standard access is the most commonly cited figure across multiple independent sources [^5][^6][^7].
- Quota resets on a **rolling window**, not at a fixed time [^6][^7].
- Higher quotas are granted case-by-case for academic research and approved commercial partners [^6][^7].
- The Ad Library API uses the Graph API Business Use Case (BUC) limit model: `Calls within one hour = 200 × Number of Users` (where users = unique daily active users of the app) [^7]. For a low-DAU app, this effectively caps at ~200/hour.

**Rate-limit tracking headers**
- Meta added clearer `X-App-Usage` headers in 2025 for programmatic tracking [^2].
- Some developers report seeing `object_count_pct` in headers indicating percentage of quota consumed; API calls are blocked when it reaches 100% [^7].
- Error code 4 (app-level limit), Error code 17 (user-level limit), Error code 613 (API rate limit exceeded), and HTTP 429 are the common throttling signals [^7].

**Practical implications:**
- A 50-brand scan with 100 ads each = ~5,000 records = minimum 50 paginated calls at `limit=100`. At 200/hr you can run two such scans per hour [^6].
- Daily polling at scale requires queue management with exponential backoff. A naive script will hit the limit quickly [^6][^28].

---

### Authentication & Token Requirements

**Step-by-step access path:**

1. **Create a Meta Developer account** at `developers.facebook.com` — free and instant, requires an existing Facebook account [^8][^9].
2. **Create a Business-type app** and add the "Ads Library API" product [^8][^10].
3. **Request the `ads_read` permission** via App Review. Meta requires: written use-case description, data-handling explanation, screen recording of the data flow, and confirmation you won't resell the data [^8][^10].
4. **Complete Meta Business Verification** — submit official business documents (government registration, utility bill). Individual developers without a registered business entity will hit a wall here [^8][^9].
5. **Accept Ad Library API terms** and generate a token [^8].
6. **For political/issue ads**: Additional `pages_read_engagement` permission required, with stricter review criteria [^2][^8].

**Token type recommendation:**
- **System user tokens** are strongly recommended for production/server environments. They are non-human entities in Business Manager, do not expire on a fixed schedule (unlike user tokens which expire every ~60 days), and are not tied to any individual's account status [^9][^10].

**Timeline reality:**
- Standard review: **5–10 business days** minimum [^8][^10].
- Total timeline including Business Verification: **6–8 weeks** is realistic [^9].
- Commercial use cases framed as "competitive monitoring" without explicit research/journalism affiliation now face **higher rejection rates** as of 2026 [^2][^8].

---

### Data Fields & Coverage

**Fields returned by the API (all ad types where available):**

| Field | Description |
|-------|-------------|
| `id` | Ad archive ID |
| `ad_creation_time` | UTC timestamp when ad was created |
| `ad_creative_bodies` | Array of ad body text strings |
| `ad_creative_link_titles` | Array of link headline strings |
| `ad_creative_link_captions` | Array of link caption strings |
| `ad_creative_link_descriptions` | Array of link description strings |
| `ad_delivery_start_time` | UTC timestamp when delivery began |
| `ad_delivery_stop_time` | UTC timestamp when delivery ended (may be null) |
| `ad_snapshot_url` | URL to preview page showing the ad creative |
| `page_id` | Facebook Page ID of the advertiser |
| `page_name` | Name of the advertiser Page |
| `publisher_platforms` | Array of platforms: `FACEBOOK`, `INSTAGRAM`, `AUDIENCE_NETWORK`, `MESSENGER`, `THREADS` |
| `languages` | Array of ISO language codes |
| `currency` | Spend currency |
| `funding_entity` / `bylines` | "Paid for by" disclaimer (political ads) |
| `impressions` | Object with `lower_bound` and `upper_bound` (political/EU only) |
| `spend` | Object with `lower_bound` and `upper_bound` (political/EU only) |
| `demographic_distribution` | Age/gender breakdown percentages (political/EU only) |
| `region_distribution` | Geographic impression breakdown (political/EU only) |
| `estimated_audience_size` | Audience size range (political ads) |

**EU-only additional fields:** `target_locations`, `target_gender`, `target_ages`, `eu_total_reach`, `age_country_gender_reach_breakdown`, `beneficiary_payers` [^13][^16].

**Fields NOT available via API:**
- Exact spend figures (only ranges for political/EU) [^15]
- Exact impression counts (only ranges for political/EU) [^15]
- Creative media direct download URLs (only `ad_snapshot_url` preview page) [^14][^15]
- Click-through rates, engagement metrics, conversion data [^15]
- Landing page URLs [^15]
- A/B test variant details [^15]
- Detailed targeting parameters (audience, interests, behaviors) outside EU [^15]

---

### AU Real Estate Specifics

**This is the decisive section for Blockwise.**

Australian real estate ads on Meta are **commercial advertisements** placed by real estate agencies, developers, and property platforms. They are not political/social-issue ads. They may be tagged with the **Housing Special Ad Category** in Ads Manager, but this classification is primarily a US compliance mechanism (Fair Housing Act / HUD litigation) [^26][^27].

**The API coverage for `ad_type=HOUSING_ADS` is US-only.** According to a verified 2026 technical guide:

> "The API (`/ads_archive`) is strictly a subset: political and social-issue ads, plus Housing/Employment/Credit special categories in the US, all with seven-year retention." [^26]

> "You can see a Nike commercial ad in the browser UI, query the same `page_id` through the API, and get an empty result set — not a bug, just that the API's `ad_type=ALL` means 'all within the political+issue+special-categories scope.' Commercial ads have no API path on this endpoint." [^26]

**What this means for Blockwise:**
- Setting `ad_type=HOUSING_ADS` with `ad_reached_countries=["AU"]` will almost certainly return **zero results** for Australian real estate ads [^23][^24][^26].
- The API was designed for **US housing discrimination transparency** (HUD settlement), not global real estate ad monitoring [^26][^27].
- Australian real estate ads are visible in the **web UI** at `facebook.com/ads/library`, but **not accessible via the official API** [^23][^24][^25].

---

### Pagination & Large Result Sets

The API uses **cursor-based pagination** — the only method supported for `ads_archive` [^17][^18].

**Mechanism:**
```json
{
  "data": [...],
  "paging": {
    "cursors": { "before": "...", "after": "..." },
    "next": "https://graph.facebook.com/v22.0/ads_archive?after=..."
  }
}
```

**Best practices:**
- Use the `next` URL from the response directly; do not reconstruct URLs [^17].
- Do not store cursors long-term — they invalidate if items are added or deleted [^17].
- Stop paging when the `next` link is absent. Note: a page may be empty but still contain a `next` link due to visibility filtering [^17].
- Maximize `limit` (use 1000 where possible) to minimize total API calls [^17].

**Practical throughput ceiling:**
- At 200 calls/hour and 1000 results per page, you can fetch **200,000 results per hour** in theory.
- In practice, result sets are smaller, and filtering + pagination overhead reduces this.

---

### Media Access

The API does **not** return direct media URLs. It returns an `ad_snapshot_url` field formatted as:
```
https://www.facebook.com/ads/archive/render_ad/?id=<AD_ID>&access_token=<TOKEN>
```

**To get actual creative images/videos:**
1. Follow the `ad_snapshot_url` with a browser or headless client [^14][^15].
2. The snapshot page renders the ad preview with uncompressed images and playable videos [^16].
3. Extract media from the rendered DOM or intercept network requests.

**Limitations:**
- Snapshot URLs are **token-bearing** and may expire or fail for removed/removed ads [^14][^31].
- There is no bulk download endpoint. Each creative must be fetched individually [^16].
- The pattern is identical to what the web UI uses: you get a reference, not the asset [^15].

---

### API vs Scraping Comparison

| Dimension | Official API | Scraping (Apify / custom) |
|-----------|-------------|---------------------------|
| **Legal / ToS** | ✅ Sanctioned by Meta | ⚠️ Against Meta's ToS; risks IP bans, legal action [^28][^29] |
| **Data stability** | ✅ Structured JSON, stable schema | ❌ Fragile; DOM changes break scrapers weekly [^28] |
| **AU real estate coverage** | ❌ **None** (commercial non-EU not in API) | ✅ All active ads visible in UI [^23][^24] |
| **Historical data** | ❌ None for commercial ads | ✅ Can be archived if you snapshot regularly [^30] |
| **Media access** | ❌ Only snapshot URLs | ✅ Direct preview rendering, media extractable [^29] |
| **Rate limits** | ~200/hr, predictable | Dynamic IP blocks, CAPTCHAs within hours [^28] |
| **Spend/impression data** | Ranges for political/EU only | None for commercial (same as UI) [^15] |
| **Landing page URLs** | ❌ Not returned | ✅ Visible in UI/rendered ad [^15] |
| **Setup friction** | High (app review, verification) | Low to medium (depends on infrastructure) |
| **Maintenance burden** | Low (annual version bump) | High (continuous anti-bot adaptation) [^28] |

**When the API wins:** Political ad research, EU ad compliance, structured pipelines at low volume, legal safety.
**When scraping wins:** Commercial ad monitoring outside EU, real-time creative extraction, historical archiving, any use case the API structurally excludes.

---

### Cost

The Meta Ad Library API is **genuinely free** [^3][^4][^8].

- No subscription fees.
- No per-call charges.
- No data egress fees.
- No premium tiers.

**The "cost" is friction, not money:**
- Engineering time to build the integration: ~8–14 hours cited for app review submission alone [^8].
- Waiting time for Business Verification + App Review: 5–10 days to 6–8 weeks [^8][^9].
- Ongoing maintenance: API version deprecation annually (~12 month cycle) [^15].

---

### Known Limitations & Gotchas

1. **Commercial ads outside EU are invisible to the API** — this is the single biggest limitation. The API was designed for political transparency and US special-category compliance, not global commercial ad research [^23][^24][^26].

2. **No historical commercial archive** — once an ad stops, it vanishes. You must self-snapshot on a schedule to build history [^20][^21].

3. **App review has tightened for commercial use cases** — "competitive monitoring" without research/journalism affiliation faces higher rejection rates in 2026 [^2][^8].

4. **API version deprecation** — Meta deprecates Graph API versions annually. Pin to a specific version and plan migration ~every 12 months [^2][^15].

5. **Snapshot URL fragility** — `ad_snapshot_url` links can return "This content isn't available right now" for removed or expired ads [^31].

6. **EU political ads frozen** — Meta stopped running new political/social-issue ads in the EU in late 2025. The archive remains but the live feed is historical [^2][^32].

7. **Rate limit math is punishing at scale** — 200 calls/hr × 1000 results/page = 200k ads/hr theoretical max, but if you need to scan many page IDs or date ranges, you exhaust quota fast [^6][^7].

8. **The `ad_type=ALL` trap** — `ALL` does not mean "all ads on Meta." It means "all ads within the API's scope" (political + US special categories). This is the most common source of confusion [^23][^26].

---

### Sources

[^1]: Meta Ads Library (Facebook Ad Library): The Complete 2026 Guide. 2026-05-18. https://adsuploader.com/blog/meta-ads-library

[^2]: Meta Ad Library Free API in 2026: What You Get, What Breaks, and When to Upgrade. 2026-05-16. https://adlibrary.com/posts/meta-ad-library-free-api-2026

[^3]: Is Meta Ad Library Free? What You Get in 2026. 2026-05-16. https://adlibrary.com/posts/is-meta-ad-library-free

[^4]: Meta Ad Library API and Scraping: A Developer's Guide for 2026. 2026-04-25. https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide

[^5]: Meta Ads Library (Facebook Ad Library): le guide complet 2026. 2026-05-18. https://adsuploader.com/fr/blog/meta-ads-library

[^6]: Meta Ad Library API and Scraping: A Developer's Guide for 2026. 2026-04-25. https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide

[^7]: Instagram API Rate Limits 2026: 200 Calls/Hour, Error Codes & How to Scale. 2026-06-23. https://www.getphyllo.com/post/instagram-api-rate-limits-explained----and-how-to-scale-beyond-them-2026

[^8]: Meta Ad Library Free API in 2026: What You Get, What Breaks, and When to Upgrade. 2026-05-16. https://adlibrary.com/posts/meta-ad-library-free-api-2026

[^9]: How to Export Meta Ad Library Data in 2026. 2026-05-17. https://adlibrary.com/posts/how-to-export-meta-ad-library-data-2026

[^10]: Meta Ads API Integration: Practitioner Setup Guide 2026. 2026-05-30. https://adlibrary.com/posts/meta-ads-api-integration-guide

[^11]: Meta 广告库API 开发者指南2026. 2026-04-28. https://www.admapix.com/zh/blog/ad-intelligence/meta-ads-library-api-developers

[^12]: Build an Ad Library Query — adlib_build_query • Radlibrary. https://facebookresearch.github.io/Radlibrary/reference/adlib_build_query.html

[^13]: GitHub - Lejo1/facebook_ad_library: Copy of the Ads from Facebook Ad Library API. 2022-01-01. https://github.com/Lejo1/facebook_ad_library

[^14]: Meta Ad Library API: Programmatic Competitor Research Guide. 2026-04-24. https://primores.org/wiki/seo/meta-ad-library-api/

[^15]: Facebook Ad Library API: Complete Guide & Best Alternative (2026). 2026-03-11. https://adlibrary.com/guides/facebook-ad-library-api

[^16]: Ad Library API Codebook. 2019-04-25. https://socialscience.one/sites/g/files/omnuum7541/files/ad_library_api_codebook.pdf

[^17]: Ad Library API Codebook (Pagination). 2019-04-25. https://socialscience.one/sites/g/files/omnuum7541/files/ad_library_api_codebook.pdf

[^18]: How to use the Meta ad library API to scrape ad data? 2025-07-23. https://swipekit.app/articles/meta-ad-library-api

[^19]: How To Use ChatGPT + Meta's Ad Library for Ad Insights & Ideas. 2026-05-11. https://wholewhale.com/resources/how-to-use-chatgpt-metas-ad-library-for-ad-insights-ideas/

[^20]: Meta Ad Library API and Scraping: A Developer's Guide for 2026. 2026-04-25. https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide

[^21]: What Meta Ad Library Doesn't Show You in 2026. 2026-05-17. https://adlibrary.com/posts/what-meta-ad-library-doesnt-show-you-2026

[^22]: Meta Ads Library (Facebook Ad Library): The Complete 2026 Guide. 2026-05-18. https://adsuploader.com/blog/meta-ads-library

[^23]: Meta Ad Library API does not return any ad for some page and also not return same data as it shows on ads library. Issue #50, facebookresearch/Ad-Library-API-Script-Repository. 2025-02-06. https://github.com/facebookresearch/Ad-Library-API-Script-Repository/issues/50

[^24]: Ad Transparency Data in 2026: Every Platform's Library Compared. 2026-06-13. https://adlibrary.com/posts/ad-transparency-data-landscape

[^25]: A Complete Guide to Official Meta Ad Library Documentation. https://jason-jennings.com/a-complete-guide-to-official-meta-ad-library-documentation-transparency-center-ads-library

[^26]: Meta Ads Library API 2026: Graph API v20.0, Impressions, Spend & Python. 2026-06-23. https://www.admapix.com/blog/ad-intelligence/meta-ads-library-api-developers

[^27]: Special Ad Categories: A Guide for Meta Ads. 2025-03-01. https://www.jonloomer.com/special-ad-categories-meta-ads/

[^28]: Meta Ad Library API and Scraping: A Developer's Guide for 2026. 2026-04-25. https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide

[^29]: Metapi vs Apify for Facebook Ads Library Scraping: Honest Comparison [2026]. 2026-02-01. https://metapi.io/compare/apify

[^30]: Meta ad library scraping tools: 8 best for 2026. 2026-05-07. https://adlibrary.com/posts/meta-ad-library-scraping-tools

[^31]: Ads do not show with link provided by "ad_snapshot_url" via Ad Library API. Issue #59, facebookresearch/Ad-Library-API-Script-Repository. 2025-01-21. https://github.com/facebookresearch/Ad-Library-API-Script-Repository/issues/59

[^32]: 2026 Guide to Master Meta Ad Library (ex Facebook Ads Library). 2026-02-21. https://growthfolks.io/advertising/meta-ad-library/
