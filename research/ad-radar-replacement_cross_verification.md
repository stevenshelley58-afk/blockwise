# Ad Radar Replacement: Cross-Verification & Insights

**Date:** 2026-07-25
**Sources:** Dimension 1 (Meta API), Dimension 2 (Steel/Scraping), Dimension 3 (Architecture)

---

## Confidence Tiers

### High Confidence

| Finding | Supporting Evidence | Confidence |
|---------|-------------------|------------|
| The official Meta Ad Library API does **not** return Australian commercial real estate ads | Verified by GitHub issue #50 on facebookresearch/Ad-Library-API-Script-Repository, confirmed by multiple 2026 technical guides, and already known by Blockwise (API treated as "validation only") | **High** |
| Apify at $25/month is the cheapest viable option for Meta Ad Library scraping at Blockwise's scale | Cost analysis from Dimension 2 shows self-hosted TCO of $1,300-3,600/mo vs Apify $25/mo | **High** |
| Kimi WebBridge cannot run on a VPS for unattended batch scraping | Kimi WebBridge is a local Chrome/Edge extension requiring a desktop browser and user session | **High** |
| Blockwise's Steel deployment (2GB RAM) is under-resourced for Meta scraping at current batch sizes | 2GB supports ~3-5 concurrent Chromium sessions; build mode batch size is 40 with max active 200 | **High** |
| Meta Ad Library is one of the hardest scraping targets on the web | Obfuscated React DOM, behavioral ML detection, CAPTCHA walls, IP reputation scoring confirmed by multiple sources | **High** |
| The official API is free and has ~200 calls/hour rate limit | Multiple sources confirm; no per-call fees | **High** |
| Self-hosted scraping without residential proxies fails within hours for Meta Ad Library | Confirmed by hyperfx.ai, proxyhat.com, metapi.io | **High** |

### Medium Confidence

| Finding | Supporting Evidence | Confidence |
|---------|-------------------|------------|
| Third-party APIs (Metapi, BigSpy) may offer cheaper alternatives to Apify | Pricing data exists but coverage quality for AU real estate specifically is unverified | **Medium** |
| Kimi Code agent swarms could augment coverage gap analysis and manual validation | Theoretical based on Kimi capabilities; no production precedent at Blockwise | **Medium** |
| Steel Cloud Pro ($499/mo) could handle Meta scraping with proxy add-ons | Pricing confirmed but actual reliability for Meta Ad Library specifically unverified | **Medium** |
| The `puppeteer-extra-plugin-stealth` deprecation (Feb 2025) means current stealth approaches are brittle | Confirmed by scrapewise.ai; but new alternatives (Camoufox, Nodriver) exist | **Medium** |

### Conflict Zone

| Conflict | Dimension 1 Position | Dimension 3 Position | Resolution |
|----------|----------------------|---------------------|------------|
| **Can the official Meta API replace Apify?** | API does not return AU commercial real estate ads. It's a dead end for this use case. | Recommended making the API the PRIMARY source with Steel as fallback. | **Dimension 1 is correct.** The API is structurally incapable of returning the data Blockwise needs. The architecture recommendation in Dimension 3 is based on a false premise that the API covers AU real estate. |
| **Is eliminating Apify economically viable?** | Self-hosted scraping costs $1,300-3,600/mo TCO. Apify is $25/mo. | Removing Apify saves ~$25/mo (~3% of total cost). | **Dimension 2 is correct.** The cost analysis in Dimension 3 understates the true cost of replacing Apify by ignoring proxy, stealth, and engineering costs. |
| **Can Kimi WebBridge replace Apify/Steel for daily refresh?** | WebBridge is local desktop browser extension, not headless VPS. | Suggested WebBridge as fallback augmentation for challenge solving. | **Both are partially correct.** WebBridge cannot replace batch scraping but could augment validation tasks. |

---

## Key Insight: The Architecture Recommendation is Fundamentally Flawed

The Dimension 3 agent recommended this stack:

```
PRIMARY: Meta Official API → FALLBACK 1: Steel Browser → FALLBACK 2: Local Chromium
```

This is **wrong** because:

1. **The official API returns ZERO results for Australian real estate ads.** The API scope is: political ads (global), EU ads (last 12 months), US special-category ads. Australian commercial real estate ads are none of these. The API was designed for US housing discrimination transparency (HUD settlement), not global real estate monitoring.

2. **Steel Browser without proxies + stealth is immediately blocked by Meta.** The current `SKIP_FINGERPRINT_INJECTION: true` means Steel is running plain Chromium. Meta blocks datacenter IPs within hours. The 2GB RAM limit supports only 3-5 concurrent sessions vs. the batch size of 40.

3. **Local Chromium has the same problems as Steel** — it's just a single browser instance without proxy rotation or stealth. It would be blocked faster than Steel because it has no session management at all.

**The honest stack without Apify is:**

```
PRIMARY: [Nothing works reliably] → FALLBACK: Apify at $25/mo
```

Or, if we want to eliminate Apify:

```
PRIMARY: Self-hosted Steel + residential proxies + stealth engineering ($1,300-3,600/mo)
```

---

## Cross-Dimension Insights

### Insight 1: Blockwise Already Knows the API Won't Work

From the operator runbook:

> "The official Ad Library API is a validation source first, not the committed primary ingestion source. Keep Hermes page-first public-library capture for resolved advertiser pages until validation shows useful Australian real-estate coverage."

The team has already tested this. The Dimension 3 agent either didn't read this document or ignored it. This is a **critical gap** — the architecture recommendation was produced without awareness of the existing institutional knowledge.

### Insight 2: The Real Cost Optimization Isn't Removing Apify

| Cost Line | Monthly |
|-----------|---------|
| Apify | $25 |
| VPS (Hermes + Steel) | $20-40 |
| Supabase | $25-50 |
| OpenRouter (Classification) | ~$750 |
| **Total** | **~$820-865** |

Apify is **3% of the total cost**. The real cost driver is OpenRouter LLM classification at ~$750/month. Removing Apify saves pocket change. The engineering time to build a replacement would cost more than a year of Apify usage.

### Insight 3: Meta Ad Library Scraping Is an Arms Race You Can't Win Alone

Meta deploys anti-bot updates continuously. The React UI changes CSS selectors every 2-4 weeks. Rate limits tighten without warning. In January 2026, Apify users saw rate limit errors with retry counts hitting 22+ overnight. Apify's value is not just the compute — it's the **team of engineers fighting this arms race for you**. At $25/mo, you're outsourcing anti-bot maintenance to a platform with 2,000+ actors and a community of maintainers.

### Insight 4: Kimi Has Real Value — But Not as a Scraping Engine

Kimi WebBridge and Kimi Code can augment the system in ways that are genuinely valuable:

- **Coverage gap analysis**: Agent swarms to find new agencies not in the database
- **Manual validation**: When the system detects anomalies, use Kimi WebBridge to visually inspect
- **Classification enhancement**: For edge cases that OpenRouter misclassifies
- **Ad creative analysis**: Read competitor ads and suggest creative angles

These are **augmentation** use cases, not **replacement** use cases. They don't replace Apify but they can make the overall system more valuable.

### Insight 5: The "Cheaper Alternative" Space Is a Minefield

| Alternative | Price | AU Real Estate? | API? | Risk |
|-------------|-------|-----------------|------|------|
| Apify | $25/mo | Yes (actors) | Yes | High failure rate, no SLA |
| Metapi | $29/mo | Claimed | Yes | Unverified for AU |
| BigSpy | $9/mo | Limited | No | UI only, no automation |
| AdSpy | $149/mo | Yes | Undocumented | Expensive, limited API |
| SocialPeta | Custom | Enterprise | Enterprise | Overkill for Blockwise |
| Self-hosted Steel | $1,300+/mo | If you build it | You build it | High maintenance |

There is no drop-in replacement that is cheaper AND better. The closest is Metapi at $29/mo, but its AU real estate coverage is unverified.

---

## Synthesis: What the User Actually Asked For vs. What Is Possible

| User Request | Reality | Honest Answer |
|-------------|---------|--------------|
| "Replace Apify with Kimi" | Kimi WebBridge cannot do headless VPS scraping | Kimi cannot replace Apify as a scraping engine |
| "Keep database live and refreshed daily" | The existing system already does this via Steel + Apify fallback | Daily refresh already works; removing Apify would break it |
| "Use Kimi and Kimi Code" | Kimi can augment validation, classification, and gap analysis | Use Kimi for what it's good at, not for scraping |
| "Stop paying Apify" | Apify is $25/mo = 3% of total cost | The savings are negligible; the risk is significant |

---

## Verdict

**Eliminating Apify is not advisable at Blockwise's current scale.** The $25/month cost is negligible compared to the engineering and infrastructure investment required to build a reliable replacement. The official Meta API is structurally incapable of returning Australian real estate ads. Self-hosted scraping requires residential proxies, stealth engineering, and continuous maintenance that would cost 50-140x more than Apify.

**The productive path forward is:**
1. Keep Apify as the primary scraping engine (it's the cheapest viable option)
2. Use Kimi Code/WebBridge for augmentation (validation, gap analysis, classification)
3. Consider upgrading the VPS RAM for Steel to reduce Apify dependency (more primary capture via browser)
4. If growth demands it, evaluate Metapi or AdSpy as Apify alternatives

The research files are saved at:
- `C:\Dev\Blockwise\research\ad-radar-replacement_dim01.md` (Meta API)
- `C:\Dev\Blockwise\research\ad-radar-replacement_dim02.md` (Steel/Scraping)
- `C:\Dev\Blockwise\research\ad-radar-replacement_dim03.md` (Architecture)
