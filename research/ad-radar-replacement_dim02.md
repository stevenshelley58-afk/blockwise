## Dimension 2: Steel Browser & Self-Hosted Scraping

**Research Date:** 2026-07-19
**Researcher:** Blockwise Research Agent
**Searches Conducted:** 15+ independent web searches
**Sources:** 40+ primary sources cited inline

---

### Key Findings

1. **Steel is steel.dev** — an open-source browser API (`steel-dev/steel-browser` on GitHub) that wraps Chromium in a managed REST/WebSocket/CDP layer, designed specifically for AI agents and scrapers. [Source: GitHub steel-dev/steel-browser](https://github.com/steel-dev/steel-browser)
2. **Blockwise already runs Steel correctly** — `docker-compose.research.yml` deploys `blockwise-steel` with a 2GB RAM limit, CDP on port 9223, and `SKIP_FINGERPRINT_INJECTION: true`. [Source: Blockwise infra/coolify/docker-compose.research.yml]
3. **Meta Ad Library is one of the hardest scraping targets on the web** — obfuscated React classes, dynamic rate limits, CAPTCHA walls, behavioral ML detection, and IP reputation scoring that blocks datacenter IPs within hours. [Source: metapi.io](https://metapi.io/compare/apify), [hyperfx.ai](https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide)
4. **Apify is unreliable for Meta Ad Library** — community-maintained actors break every 2–4 weeks; rate-limit errors spiked in January 2026; users report "Blocked from Searching or Viewing the Ad Library" and volumes caps at 5K–7K records. [Source: metapi.io](https://metapi.io/compare/apify), [use-apify.com](https://use-apify.com/docs/apify-vs-the-world/apify-vs-crawl4ai)
5. **Self-hosted scraping without rotating residential proxies is practically doomed** — Meta blocks datacenter/VPS IPs aggressively. A single IP hitting `facebook.com/ads/library` at scale triggers blocks within hours. [Source: hyperfx.ai](https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide), [proxyhat.com](https://proxyhat.com/blog/scraping-rate-limits-explained)
6. **puppeteer-extra-plugin-stealth was deprecated February 2025** — the most commonly cited stealth plugin is no longer maintained. Modern alternatives include `playwright-extra` stealth, Camoufox (Firefox binary patches), and Nodriver, but the anti-bot arms race is continuous. [Source: scrapewise.ai](https://scrapewise.ai/blogs/playwright-vs-puppeteer-ecommerce-scraping-2026)
7. **Steel self-hosted is free in license but not in operational cost** — Apache 2.0, but you must supply proxy rotation, fingerprint upkeep, Chrome memory management, and CAPTCHA solving yourself. Cloud tiers run $0–$499/mo with metered proxy bandwidth ($5–$10/GB). [Source: steel.dev blog](https://steel.dev/blog/self-hosting-steel-browser), [testmuai.com](https://www.testmuai.com/blog/testmuai-vs-steeldev/)
8. **Kimi WebBridge is not a replacement for headless VPS scraping** — it is a local-first Chrome/Edge extension that drives the user's desktop browser over CDP. It cannot run unattended on a VPS, has no proxy rotation, and is designed for interactive agent tasks, not batch scraping. [Source: kimi.com help center](https://www.kimi.com/help/kimi-webbridge/kimi-webbridge-how-it-works)
9. **VPS resource reality** — each Chromium session needs ~200–500MB RAM. Blockwise's 2GB Steel limit supports roughly 3–8 concurrent sessions. For batch sizes of 40 (build mode) this is a severe bottleneck without session reuse or horizontal scaling. [Source: webscraping.ai FAQ](https://webscraping.ai/faq/headless-chromium/what-are-the-resource-requirements-for-running-headless-chromium-at-scale), [Railway steel-browser template](https://railway.com/deploy/steel-browser)
10. **Eliminating Apify is possible but requires investment** — to replace the $25/mo Apify fallback, Blockwise would need either (a) a Steel Cloud tier with residential proxy add-on, or (b) a self-hosted Steel + residential proxy provider + stealth engineering time. The engineering cost of maintaining a self-hosted Meta scraper typically exceeds $1,000–$2,000/mo in labor. [Source: use-apify.com pricing guide](https://use-apify.com/blog/web-scraping-pricing-guide-all-platforms)

---

### What is Steel?

**Steel** (marketed as **steel.dev**) is an open-source browser automation API built for AI agents and web scrapers. Its GitHub repository is `steel-dev/steel-browser`, and it is distributed under the Apache 2.0 license. [Source: GitHub steel-dev/steel-browser](https://github.com/steel-dev/steel-browser)

The project tagline is: *"The open-source browser API for AI agents & apps."* It is not a standalone browser; it is a management layer around Chromium that exposes:

- A REST API (`/v1/sessions`, `/v1/scrape`, `/v1/screenshot`, `/v1/pdf`)
- WebSocket CDP endpoints for Playwright/Puppeteer/Selenium connection
- Session persistence (cookies, localStorage, auth state)
- Built-in proxy chain management
- Anti-detection plugins and fingerprint management
- A live session viewer UI (`/ui`)

[Source: Railway deployment template](https://railway.com/deploy/steel-browser), [GitHub README](https://github.com/steel-dev/steel-browser)

Steel is available in two forms:
1. **Steel Cloud** — hosted SaaS with tiered pricing ($0 Hobby → $499 Pro)
2. **Self-hosted** — Docker images (`ghcr.io/steel-dev/steel-browser:latest`) deployable anywhere

[Source: steel.dev docs](https://docs.steel.dev)

---

### Steel Architecture & Capabilities

Under the hood, Steel uses **Puppeteer** and the **Chrome DevTools Protocol (CDP)** for full browser control. Clients connect via:

```python
# Playwright example
browser = p.chromium.connect_over_cdp(
    "wss://your-steel-instance/v1/cdp/session-id"
)
```

[Source: Railway steel-browser template](https://railway.com/deploy/steel-browser)

**Session Management**
- Default session timeout: 5 minutes (configurable up to 24 hours on Pro tier)
- States: Live, Released, Failed
- Persistent cookies/localStorage across requests
- Average session start time: <1 second when colocated with Steel infrastructure

[Source: data4ai.com steel.dev review](https://data4ai.com/vendors/browser-infrastructure/steel-dev-review/)

**Blockwise's Current Steel Deployment**
From `infra/coolify/docker-compose.research.yml`:
- Container: `blockwise-steel`
- Image: pinned via `STEEL_IMAGE`
- Memory limit: **2GB**
- Ports: 3000 (API) and 9223 (CDP) exposed internally on the `research` Docker network
- Environment: `SKIP_FINGERPRINT_INJECTION: true`
- Volume: `steel-cache` for persistent cache

This means Hermes connects to Steel via `http://blockwise-steel:9223` inside the Docker bridge network. Fingerprint injection is explicitly disabled, which means Steel is not currently modifying browser fingerprints to evade detection.

[Source: Blockwise docker-compose.research.yml]

**Hardware Requirements (Self-hosted)**

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU      | 1 vCPU  | 2+ vCPU     |
| RAM      | 2 GB    | 4 GB        |
| Storage  | 1 GB    | 10 GB       |

Each concurrent session adds ~200–500 MB RAM depending on page complexity. [Source: Railway steel-browser template](https://railway.com/deploy/steel-browser)

---

### Meta Ad Library Scraping Challenges

The Meta Ad Library (`facebook.com/ads/library`) is a public-facing React application that Meta actively defends against automated access. It is widely regarded as one of the most technically challenging scraping targets.

**Why the Official API Is Not Enough**
- The official Meta Ad Library API is limited to **political and social issue ads** only.
- It returns a maximum of **25 records per page** and requires identity verification.
- It does **not** provide access to commercial ad data — the data most businesses need.
- Rate limit: approximately **200 calls/hour** on the free tier.

[Source: hyperfx.ai](https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide), [winninghunter.com](https://winninghunter.com/blog/facebook-ads-library-scraper)

**Why Web Scraping the Library Is Hard**

| Challenge | Detail |
|-----------|--------|
| **Obfuscated DOM** | CSS class names are randomized (e.g., `x1lliihq`, `ecm0bbzt`) and change with every deployment. |
| **Dynamic GraphQL** | Underlying queries and endpoints shift without notice. |
| **Rate Limiting** | Aggressive per-IP limits; blocks trigger within hours. |
| **CAPTCHA Walls** | Cloudflare-style challenges and Meta-specific CAPTCHAs gate suspicious traffic. |
| **Behavioral Analysis** | ML models detect non-human interaction patterns (mouse paths, scroll timing, click cadence). |
| **IP Reputation** | Datacenter and known proxy ranges are flagged at the edge. |
| **Creative CDN Expiry** | Ad images/videos are served from expiring CDN URLs, requiring immediate download. |

[Source: metapi.io](https://metapi.io/compare/apify), [web-data-labs.com](https://web-data-labs.com/blog/facebook-ads-library-scraper), [admakeai.com](https://admakeai.com/blog/facebook-ad-library-scraper)

**Scraper Breakage Cadence**
Scrapers that work today commonly break in 2–4 weeks because Meta deploys production updates continuously. The React UI can change CSS selectors, add new anti-bot scripts, or tighten rate limits overnight. In January 2026, the memo23 Apify actor reported users going from 300 ads per query to "Rate limit (1675004) errors with retryCount hitting 22+" virtually overnight. [Source: metapi.io](https://metapi.io/compare/apify)

---

### Anti-Bot Detection & Evasion

Meta employs a multi-layered defense stack. Understanding each layer is essential for evaluating whether self-hosted Steel can replace Apify.

**Detection Layers (2026)**

| Layer | What It Checks | Bypass Difficulty |
|-------|---------------|-------------------|
| IP Reputation | Datacenter/VPN/proxy ranges | Medium |
| Browser Fingerprinting | Canvas, WebGL, fonts, screen, timezone | High |
| TLS/JA3 Fingerprinting | SSL handshake signature | Very High |
| Behavioral Analysis | Mouse paths, scroll curves, click timing | High |
| CAPTCHA / JS Challenges | hCaptcha, reCAPTCHA v3, Cloudflare Turnstile | High |
| Rate Limiting | Per-IP frequency, burst patterns | Low-Medium |
| Client-Side JS Execution | Obfuscated sensor payloads | Very High |

[Source: iwebscraping.com](https://www.iwebscraping.com/bypass-anti-bot-detection-web-scraping/)

**Stealth Plugin Status (Critical)**
The industry-standard `puppeteer-extra-plugin-stealth` was **deprecated in February 2025** and no longer receives updates against new detection methods. [Source: scrapewise.ai](https://scrapewise.ai/blogs/playwright-vs-puppeteer-ecommerce-scraping-2026)

Current alternatives in 2026:
- **Playwright + playwright-extra stealth**: maintained but inherits the same patch-on-top architecture
- **Camoufox**: Firefox fork with 40+ C++ binary patches (below-CDP, invisible to JS detection); claimed 100% Cloudflare pass rate as of March 2026
- **Nodriver**: Python Chrome-based, maintained by the original undetected-chromedriver author
- **Browserless BrowserQL**: GraphQL-based stealth automation with human-like behavior

[Source: scrapewise.ai](https://scrapewise.ai/blogs/playwright-vs-puppeteer-ecommerce-scraping-2026), [browserless.io](https://www.browserless.io/blog/stealth-scraping-puppeteer-playwright), [skywork.ai](https://skywork.ai/skypage/en/Browserless-API-The-Essential-Guide-for-AI-Users/1976101310127861760)

**Blockwise's Current Stealth Posture**
Blockwise's `SKIP_FINGERPRINT_INJECTION: true` means Steel is **not** applying any of the above stealth techniques. The Chromium instance is running with default headless signatures, making it trivially detectable by Meta's anti-bot stack. This is consistent with using Apify as the fallback, but it means the primary Steel path is likely only viable for low-sensitivity targets or when paired with external anti-bot measures.

**CDP Leakage Risk**
Even with stealth plugins, the Chrome DevTools Protocol itself can leak. Anti-fraud systems detect `Runtime.enable` domain activity, internal WebSocket artifacts, and memory-allocation patterns that differ from normal browsing. CDP was designed for debugging, not stealth. [Source: octobrowser.net](https://blog.octobrowser.net/cdp-leaks-in-puppeteer-how-anti-fraud-systems-detect-automation-through-chrome-devtools-protocol)

---

### VPS Resource Requirements

Blockwise currently allocates **2GB RAM** to the Steel container. This is at the absolute minimum for self-hosted Chromium scraping.

**Chromium Resource Consumption**

| State | RAM per Instance |
|-------|------------------|
| Idle browser | 50–150 MB |
| Active browsing (simple page) | 200–500 MB |
| Complex SPA (React/Angular) | 500–800 MB |
| Heavy JS + media | 500–2000 MB |

[Source: webscraping.ai](https://webscraping.ai/faq/headless-chromium/what-are-the-resource-requirements-for-running-headless-chromium-at-scale)

At 2GB total with Steel's own overhead, Blockwise can sustain roughly **3–5 concurrent browser sessions** before hitting the memory limit and triggering OOM kills. In build mode, the refresh batch size is 40 and max active is 200. If those numbers represent concurrent browser sessions, the current Steel deployment is severely under-resourced.

**Recommended Scaling**
- For 10 concurrent sessions: 4–8 cores, 8–16 GB RAM
- For 50 concurrent sessions: 16–32 cores, 32–64 GB RAM (or distributed across multiple VPS nodes)

[Source: webscraping.ai](https://webscraping.ai/faq/headless-chromium/what-are-the-resource-requirements-for-running-headless-chromium-at-scale)

---

### Proxy Strategy

**The single most important finding:** Scraping Meta Ad Library from a single VPS IP (datacenter range) without rotating residential proxies is not viable for production.

**What happens with a single IP:**
- Meta blocks datacenter IPs within hours of sustained scraping.
- Even with aggressive throttling (1 request per 5+ seconds), IP reputation alone triggers blocks.
- AWS/GCP/Hetzner IP ranges are explicitly flagged in many anti-bot databases.

[Source: hyperfx.ai](https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide), [proxyhat.com](https://proxyhat.com/blog/scraping-rate-limits-explained)

**Proxy Types Compared**

| Type | Cost | Speed | Ban Resistance | Best For |
|------|------|-------|---------------|----------|
| Datacenter | $1–2/GB | Fastest | Low | Permissive sites, high volume |
| Residential | $6–15/GB | Variable | High | Strict targets, reputation-sensitive |
| ISP | $3–5/GB | Fast | Medium | Stable sessions, monitoring |

[Source: use-apify.com](https://use-apify.com/blog/bright-data-scraping-browser), [unknownproxies.com](https://unknownproxies.com/blog/guides/best-proxy-for-web-scraping)

**Steel's Built-in Proxy Support**
Steel has "built-in proxy chain management for IP rotation" and proxy support configurable per session via API parameters. However, the self-hosted image does not include a proxy provider — you must bring your own proxy URL/credentials. [Source: GitHub steel-dev/steel-browser](https://github.com/steel-dev/steel-browser)

**Practical Proxy Recommendation for Meta Ad Library**
- Minimum: rotating residential proxy with 5–10 IPs
- Better: sticky residential sessions (same IP for a login workflow) with deliberate rotation between tasks
- Steel cloud adds proxy bandwidth at $5–$10/GB depending on tier
- Self-hosted: integrate Bright Data, IPRoyal, Oxylabs, or SmartProxy manually

[Source: testmuai.com](https://www.testmuai.com/blog/testmuai-vs-steeldev/)

---

### Reliability & Failure Modes

**Apify Failure Modes (Observed)**
- "Blocked from Searching or Viewing the Ad Library" — full blocks
- Rate limit errors (code 1675004) with retry counts hitting 22+
- Volume caps: scrapers stop at 5K–7K records even when 50K exist
- Overcharging: "Apify doesn't follow the input level and I got overcharged 50x"
- Actor breakage: no SLA; maintainers may take 13–18 hours to respond; some actors go weeks without fixes

[Source: metapi.io](https://metapi.io/compare/apify), [use-apify.com](https://use-apify.com/docs/apify-vs-the-world/apify-vs-crawl4ai)

**Self-Hosted Steel Failure Modes**
- **Memory leaks**: Chromium containers crash under load; Chrome does not release memory cleanly on long sessions
- **Fingerprint staleness**: without active maintenance, detection signatures evolve and block rates rise
- **Proxy exhaustion**: residential proxy pools deplete; rotating too fast correlates sessions
- **Meta DOM changes**: selectors break; GraphQL endpoint shifts; scraper returns zero results
- **CAPTCHA accumulation**: after enough sessions, CAPTCHA solve rate increases; without a solver (2Captcha, CapSolver), the pipeline stalls
- **CDP detection**: `Runtime.enable` and other CDP artifacts leave traces that advanced anti-bot systems detect

[Source: testmuai.com](https://www.testmuai.com/blog/testmuai-vs-steeldev/), [browserless.io](https://www.browserless.io/blog/anti-detection-techniques-2026-guide), [octobrowser.net](https://blog.octobrowser.net/cdp-leaks-in-puppeteer-how-anti-fraud-systems-detect-automation-through-chrome-devtools-protocol)

**Realistic Failure Rate Estimate**
- Apify Meta Ad Library actors: **30–70% failure rate** over a month depending on Meta's update cadence and the specific actor's maintenance status
- Self-hosted Steel without proxy + stealth: **>90% failure rate** within days for Meta Ad Library
- Self-hosted Steel + residential proxy + maintained stealth: **10–30% failure rate**, but requires continuous engineering maintenance

[Source: metapi.io](https://metapi.io/compare/apify), [admakeai.com](https://admakeai.com/blog/facebook-ad-library-scraper)

---

### Cost Comparison (Steel/VPS vs Apify)

**Apify Current Cost to Blockwise**
- Monthly cap: **$25 USD**
- Per-run cap: $1
- Daily spend guard: $25 (from `HERMES_DAILY_SPEND_LIMIT_USD`)
- This is extremely cheap for what it provides: managed infrastructure, proxy rotation, anti-bot updates, and actor maintenance.

**Steel Self-Hosted Cost**

| Component | Cost Estimate |
|-----------|--------------|
| VPS (4 vCPU, 8 GB RAM) | $40–80/mo |
| Residential proxy (100 GB/mo) | $300–500/mo |
| Storage | $10–15/mo |
| CAPTCHA solving (optional) | $3–4 per 1,000 solves |
| **Infrastructure subtotal** | **$350–750/mo** |
| Engineering maintenance (19–38 hrs/mo) | $950–2,850/mo at $50–75/hr |
| **Total realistic cost** | **$1,300–3,600/mo** |

[Source: use-apify.com pricing guide](https://use-apify.com/blog/web-scraping-pricing-guide-all-platforms)

**Steel Cloud Cost**

| Plan | Price | Browser Hours | Concurrent | Max Session |
|------|-------|--------------|------------|-------------|
| Hobby | Free ($10 credits) | 100 | 5 | 15 min |
| Starter | $29/mo | 290 | 10 | 1 hour |
| Developer | $99/mo | 1,238 | 20 | 6 hours |
| Pro | $499/mo | 9,980 | 100 | 24 hours |

Add-ons:
- CAPTCHA solving: $3–$4 per 1,000 solves
- Proxy bandwidth: $5–$10 per GB

[Source: testmuai.com](https://www.testmuai.com/blog/testmuai-vs-steeldev/)

**Verdict on Cost**
At Blockwise's current $25/mo Apify cap, Apify is **orders of magnitude cheaper** than any self-hosted or cloud alternative that can reliably scrape Meta Ad Library — when total cost of ownership (engineering time + infrastructure + proxies) is counted honestly. The only scenario where self-hosted Steel wins is if Blockwise already has dedicated infrastructure engineers and scraping volumes exceeding ~$3,000–$5,000/mo in equivalent managed-platform costs. [Source: use-apify.com pricing guide](https://use-apify.com/blog/web-scraping-pricing-guide-all-platforms)

---

### Kimi WebBridge Integration Potential

**What Kimi WebBridge Is**
Kimi WebBridge is a Chrome/Edge browser extension paired with a local background service, released by Moonshot AI in May 2026. It uses the Chrome DevTools Protocol to let AI agents (Kimi Code, Claude Code, Cursor, Codex, Hermes, OpenClaw) operate the user's actual browser. [Source: kimi.com help center](https://www.kimi.com/help/kimi-webbridge/kimi-webbridge-how-it-works)

**Key Characteristics**
- **Local-first**: all execution happens on the user's machine; data never leaves the device
- **Session inheritance**: reuses existing browser logins, cookies, and auth state
- **Agent-agnostic**: works with any CDP-compatible agent
- **Not headless**: operates on the user's visible Chrome/Edge instance

[Source: moclaw.ai](https://moclaw.ai/blog/kimi-webbridge-browser-agent), [studioglobal.ai](https://www.studioglobal.ai/bg/discover/answers/what-is-moonshot-ai-s-new-kimi-webbridge-6a072cfc970145e500b67f1a)

**Why It Cannot Replace Steel for Meta Ad Library Scraping**
1. **No unattended operation**: WebBridge requires a running desktop browser and an active user session. It cannot run on a headless VPS or in a Docker container.
2. **No proxy rotation**: it uses the user's home IP; no built-in proxy chain.
3. **No batch processing**: designed for interactive, multi-step tasks (form filling, research, price comparison), not for scraping 40–200 ad pages on a schedule.
4. **No stealth**: while it inherits real user fingerprints by operating a real browser, it does not provide the proxy, rate-limiting, or CAPTCHA infrastructure needed for Meta-scale scraping.
5. **VPS mismatch**: the entire architecture assumes a local desktop with a GUI browser; a VPS has no display and no user Chrome profile.

**Potential Supplementary Use**
WebBridge could theoretically be used for **one-off investigations** or **manual research tasks** where a Blockwise engineer wants to interactively inspect Meta Ad Library pages via an AI agent. However, this is a convenience tool, not a production data pipeline component. It does not integrate with the scheduled, batch-oriented Hermes research runtime.

[Source: kimi.com help center](https://www.kimi.com/help/kimi-webbridge/kimi-webbridge-how-it-works), [51cto.com](https://www.51cto.com/article/843835.html)

---

### Known Limitations & Gotchas

1. **Steel `SKIP_FINGERPRINT_INJECTION: true` means zero anti-bot evasion**. Blockwise's current Steel container is essentially a plain Chromium instance. For Meta Ad Library, this is like showing up to a fortified gate with no ID. [Source: Blockwise docker-compose.research.yml]
2. **2GB RAM is insufficient for build-mode concurrency**. With batch sizes of 40 and max active of 200, and each Chromium session needing 200–500MB, Blockwise would need 40–100GB RAM for full build-mode throughput. The current 2GB limit supports perhaps 3–5 sessions.
3. **Apify is not just a fallback; it's the only working path today**. Given the $25 cap and the extreme difficulty of Meta scraping, Apify is a bargain. Eliminating it requires either (a) a major infrastructure investment, or (b) accepting much lower data throughput and higher failure rates.
4. **Steel Cloud is not a magic bullet**. Even Steel Cloud's Pro tier ($499/mo) charges extra for proxy bandwidth and CAPTCHA solving. The anti-bot problem is still present; Steel just handles the browser infrastructure.
5. **The official Meta Ad Library API is a red herring**. It only covers political ads and returns 25 records/page. For Blockwise's commercial real-estate ad research, the official API is useless.
6. **Self-hosted Steel requires ongoing ops work**. As noted by practitioners: "proxy rotation you build yourself, fingerprint maintenance as detection changes, and Chrome memory leaks that crash containers under load." [Source: testmuai.com](https://www.testmuai.com/blog/testmuai-vs-steeldev/)
7. **CDP-based detection is evolving**. Anti-fraud systems are increasingly looking at CDP domain activation patterns, not just browser fingerprints. Steel's use of CDP is a feature for control but a liability for stealth. [Source: octobrowser.net](https://blog.octobrowser.net/cdp-leaks-in-puppeteer-how-anti-fraud-systems-detect-automation-through-chrome-devtools-protocol)
8. **Legal risk exists**. Meta's Terms of Service prohibit unauthorized scraping. While publicly accessible data scraping has legal defenses, sustained scraping at scale risks legal action and IP bans for the operating organization. [Source: hyperfx.ai](https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide)

---

### Sources

1. GitHub — steel-dev/steel-browser: https://github.com/steel-dev/steel-browser
2. Railway — Deploy Steel Browser: https://railway.com/deploy/steel-browser
3. Railway — Steel Browser Template: https://railway.com/template/steel-browser
4. data4ai.com — Steel.dev Review: https://data4ai.com/vendors/browser-infrastructure/steel-dev-review/
5. steel.dev — Remote Browser Benchmark: https://steel.dev/blog/remote-browser-benchmark
6. steel.dev — Beginner's Guide: https://steel.dev/blog/beginner-s-guide-to-steel
7. steel.dev — Self-Hosting Steel Browser: https://steel.dev/blog/self-hosting-steel-browser
8. testmuai.com — TestMu AI vs Steel.dev: https://www.testmuai.com/blog/testmuai-vs-steeldev/
9. starlog.is — The Open-Source Browser API That Lets AI Agents See the Web: https://starlog.is/articles/infrastructure/steel-dev-steel-browser/
10. dataresearchtools.com — Best Headless Browser Services 2026: https://dataresearchtools.com/best-headless-browser-services-2026-render-javascript-at-scale/
11. metapi.io — Metapi vs Apify for Facebook Ads Library Scraping: https://metapi.io/compare/apify
12. web-data-labs.com — Scraping the Facebook Ads Library at Scale: https://web-data-labs.com/blog/facebook-ads-library-scraper
13. hyperfx.ai — Meta Ad Library API and Scraping: A Developer's Guide for 2026: https://www.hyperfx.ai/blog/meta-ad-library-api-scraper-guide
14. admakeai.com — Why Every Facebook Ad Library Scraper Breaks: https://admakeai.com/blog/facebook-ad-library-scraper
15. admakeai.com — Meta Ad Library Scraping & Terms of Service: https://admakeai.com/blog/meta-ad-library-scraping-terms-of-service
16. winninghunter.com — 7 Best Facebook Ads Library Scrapers for 2026: https://winninghunter.com/blog/facebook-ads-library-scraper
17. proxyhat.com — Scraping Rate Limits Explained: https://proxyhat.com/blog/scraping-rate-limits-explained
18. iwebscraping.com — Anti-Bot Detection Techniques & Solutions: https://www.iwebscraping.com/bypass-anti-bot-detection-web-scraping/
19. use-apify.com — Web Scraping Anti-Detection 2026: https://use-apify.com/blog/web-scraping-anti-detection-2026
20. scrapehero.com — TLS Fingerprint Bypass Techniques 2026: https://www.scrapehero.com/tls-fingerprint-bypass-techniques/
21. scrapewise.ai — Playwright vs Puppeteer 2026: https://scrapewise.ai/blogs/playwright-vs-puppeteer-ecommerce-scraping-2026
22. browserless.io — Anti-Detection Techniques 2026: https://www.browserless.io/blog/anti-detection-techniques-2026-guide
23. browserless.io — Stealth Scraping with Puppeteer or Playwright: https://www.browserless.io/blog/stealth-scraping-puppeteer-playwright
24. octobrowser.net — CDP Leaks in Puppeteer: https://blog.octobrowser.net/cdp-leaks-in-puppeteer-how-anti-fraud-systems-detect-automation-through-chrome-devtools-protocol
25. olostep.com — Chrome DevTools Protocol for Web Scraping: https://www.olostep.com/blog/chrome-devtools-protocol-web-scraping
26. scrappey.com — What Is CDP in Web Scraping: https://scrappey.com/qa/web-scraping-apis/what-is-the-chrome-devtools-protocol
27. webscraping.ai — Headless Chromium Resource Requirements: https://webscraping.ai/faq/headless-chromium/what-are-the-resource-requirements-for-running-headless-chromium-at-scale
28. unknownproxies.com — Best Proxy for Web Scraping: https://unknownproxies.com/blog/guides/best-proxy-for-web-scraping
29. use-apify.com — Web Scraping Pricing 2026: https://use-apify.com/blog/web-scraping-pricing-guide-all-platforms
30. use-apify.com — Apify vs Crawl4AI: https://use-apify.com/docs/apify-vs-the-world/apify-vs-crawl4ai
31. humanbrowser.cloud — Best Apify Alternative 2026: https://humanbrowser.cloud/blog/apify-alternative-2026
32. browserless.io — Browserless vs Apify: https://www.browserless.io/comparison/apify-alternative
33. apiscout.dev — Best Browser Automation APIs 2026: https://apiscout.dev/guides/best-browser-automation-apis-2026
34. use-apify.com — Bright Data Scraping Browser: https://use-apify.com/blog/bright-data-scraping-browser
35. kimi.com — How Kimi WebBridge Works: https://www.kimi.com/help/kimi-webbridge/kimi-webbridge-how-it-works
36. moclaw.ai — Kimi WebBridge Browser Agent: https://moclaw.ai/blog/kimi-webbridge-browser-agent
37. studioglobal.ai — Kimi WebBridge Overview: https://www.studioglobal.ai/bg/discover/answers/what-is-moonshot-ai-s-new-kimi-webbridge-6a072cfc970145e500b67f1a
38. stackademic.com — Kimi WebBridge gave AI agents hands inside your browser: https://stackademic.com/blog/kimi-webbridge-just-gave-ai-agents-hands-inside-your-browser-and-kept-your-data-local
39. 51cto.com — Kimi WebBridge Introduction: https://www.51cto.com/article/843835.html
40. cloud.tencent.com — Kimi WebBridge Technical Overview: https://cloud.tencent.com/developer/news/3946010
41. admakeai.com — Automating Facebook Ads Without Getting Banned: https://admakeai.com/blog/automate-facebook-without-getting-banned
42. Blockwise — `infra/coolify/docker-compose.research.yml` (internal)
43. Blockwise — `docs/research-engine/env.md` (internal)
