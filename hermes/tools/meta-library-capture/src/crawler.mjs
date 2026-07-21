/**
 * crawler.mjs — Crawlee PlaywrightCrawler engine for the Meta Ad Library.
 *
 * Hard requirements (spec Part 1):
 *  - PlaywrightCrawler, maxConcurrency 1, maxRequestRetries 2, session pool ON,
 *    fingerprints ON (Crawlee default via browserPoolOptions.useFingerprints).
 *  - System chromium via launchContext.launchOptions.executablePath from
 *    HERMES_META_BROWSER_EXECUTABLE (default "chromium"). Never downloads browsers.
 *  - ProxyConfiguration from RESIDENTIAL_PROXY_URL or per-input proxyUrl; loud
 *    stderr warning + direct run when unset.
 *  - GraphQL interception registered in preNavigationHooks (page exists, navigation
 *    not yet done). Crawlee does the single navigation — we never call page.goto().
 *  - requestHandler: dismiss cookie consent, then a scroll loop bounded by
 *    resultsLimit / 5 consecutive empty scrolls / 90% of the timeout budget.
 *  - Bot-challenge detection retires the session and retries once on a fresh
 *    session; persistent block → MetaBlockedError surfaces as a FAILED outcome.
 *  - Human pacing: 2–5s random pre-navigation delay.
 *
 * This module never throws to its caller: runMetaCapture always resolves to a
 * structured result the CLI turns into exactly one MetaCaptureOutcome.
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LogLevel,
  PlaywrightCrawler,
  ProxyConfiguration,
  log as crawleeLog,
} from "crawlee";

import { GraphqlAdInterceptor, dedupeByArchiveId } from "./graphql.mjs";

/** Thrown inside requestHandler to force a session rotation + retry. */
export class MetaBlockedError extends Error {
  constructor(signal) {
    super(`blocked:${signal}`);
    this.name = "MetaBlockedError";
    this.signal = signal;
  }
}

const BOT_SIGNALS = [
  "security check",
  "log in to continue",
  "checkpoint",
  "you're temporarily blocked",
  "you are temporarily blocked",
  "this content isn't available right now",
  "we couldn't log you in",
];

const COOKIE_CONSENT_SELECTORS = [
  'div[role="dialog"] [data-cookiebanner="accept_button"]',
  'button[data-testid="cookie-policy-dialog-accept-button"]',
  'button:has-text("Allow all cookies")',
  'button:has-text("Only allow essential cookies")',
  'button:has-text("Accept all")',
  'button:has-text("Accept")',
  '[data-cookiebanner="accept_button"]',
  "#onetrust-accept-btn-handler",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeCount(ads) {
  return dedupeByArchiveId(ads).length;
}

async function dismissCookieConsent(page, logLine) {
  for (const selector of COOKIE_CONSENT_SELECTORS) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        await loc.click({ timeout: 1200 });
        logLine(`dismissed cookie consent via ${selector}`);
        return;
      }
    } catch {
      // Selector not present / not clickable — keep trying the others.
    }
  }
}

async function detectBotChallenge(page) {
  let title = "";
  let bodyText = "";
  try {
    title = (await page.title()) || "";
  } catch {
    title = "";
  }
  try {
    bodyText = ((await page.evaluate(() => document.body?.innerText || "")) || "").slice(0, 4000);
  } catch {
    bodyText = "";
  }
  const haystack = `${title}\n${bodyText}`.toLowerCase();
  return BOT_SIGNALS.find((signal) => haystack.includes(signal)) ?? null;
}

/**
 * Run a single capture against `input`.
 *
 * @param {object} args
 * @param {object} args.input Validated CLI input (url, resultsLimit, timeoutMs, ...).
 * @param {string} args.runId Unique run id (also used for the evidence dir name).
 * @param {(line: string) => void} [args.logLine] stderr logger.
 * @returns {Promise<{
 *   items: object[],
 *   pagesLoaded: number,
 *   scrolls: number,
 *   evidenceDir: string,
 *   blockedSignal: string|null,
 *   timedOut: boolean,
 *   errorMessage: string|null,
 *   graphqlResponses: number,
 *   adLibraryResponses: number,
 * }>}
 */
export async function runMetaCapture({ input, runId, logLine = () => {} }) {
  const resultsLimit = Number(input.resultsLimit) || 0;
  const timeoutMs = Number(input.timeoutMs) || 60_000;
  const deadline = Date.now() + timeoutMs;

  const evidenceDir = join(tmpdir(), `meta-capture-${runId}`);
  const interceptor = new GraphqlAdInterceptor({ evidenceDir, log: logLine });

  const runState = {
    ads: [],
    pagesLoaded: 0,
    scrolls: 0,
    blockedSignal: null,
    timedOut: false,
    lastError: null,
  };

  // Proxy: per-input proxyUrl overrides RESIDENTIAL_PROXY_URL.
  const proxyUrl = input.proxyUrl || process.env.RESIDENTIAL_PROXY_URL || "";
  let proxyConfiguration;
  if (proxyUrl) {
    proxyConfiguration = new ProxyConfiguration({ proxyUrls: [proxyUrl] });
    logLine(`proxy: rotating via configured proxy (${String(proxyUrl).replace(/:[^:@/]+@/, ":***@")})`);
  } else {
    logLine(
      "WARN: no RESIDENTIAL_PROXY_URL / input.proxyUrl set — running DIRECT. "
        + "Datacenter IPs are challenged by Meta far more often; expect blocks.",
    );
  }

  const executablePath = process.env.HERMES_META_BROWSER_EXECUTABLE || "chromium";

  // Silence Crawlee's own logger (it writes to stdout by default — we own stdout).
  // Must be set before the crawler is instantiated so child loggers inherit OFF.
  try {
    crawleeLog.setLevel(LogLevel.OFF);
  } catch {
    // Best-effort silence across crawlee builds.
  }

  // Keep Crawlee's runtime storage out of the repo tree.
  const storageDir = join(tmpdir(), `crawlee-storage-${runId}`);
  process.env.CRAWLEE_STORAGE_DIR = storageDir;

  const crawler = new PlaywrightCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: Math.max(30, Math.ceil(timeoutMs / 1000)),
    useSessionPool: true,
    proxyConfiguration,
    launchContext: {
      launchOptions: {
        executablePath,
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      },
    },
    browserPoolOptions: {
      // Crawlee default is true; stated explicitly per spec.
      useFingerprints: true,
    },
    preNavigationHooks: [
      async ({ page }) => {
        // Human pacing: 2–5s random delay before the (Crawlee-driven) navigation.
        await sleep(2000 + Math.random() * 3000);
        // Register GraphQL interception BEFORE navigation so the initial responses
        // are not missed. page.on('response') fires for every response on this page.
        page.on("response", (response) => {
          // Fire-and-forget; parsed ads accumulate into runState.ads.
          void interceptor
            .handleResponse(response)
            .then((ads) => {
              for (const ad of ads) runState.ads.push(ad);
            })
            .catch((error) => logLine(`response hook error: ${error?.message || error}`));
        });
      },
    ],
    requestHandler: async ({ page, session }) => {
      runState.pagesLoaded += 1;

      const signal = await detectBotChallenge(page);
      if (signal) {
        runState.blockedSignal = signal;
        try {
          session?.retire();
        } catch {
          // Session rotation is best-effort; the throw below still triggers a retry.
        }
        logLine(`bot challenge detected: "${signal}" — retiring session and retrying`);
        throw new MetaBlockedError(signal);
      }

      await dismissCookieConsent(page, logLine);

      // Scroll loop.
      let prevCount = dedupeCount(runState.ads);
      let consecutiveEmpty = 0;
      const scrollStart = Date.now();
      const scrollBudgetMs = timeoutMs * 0.9;

      while (true) {
        if (prevCount >= resultsLimit) {
          logLine(`resultsLimit ${resultsLimit} reached (${prevCount} ads)`);
          break;
        }
        if (Date.now() - scrollStart > scrollBudgetMs) {
          runState.timedOut = true;
          logLine("scroll budget (90% of timeout) exhausted");
          break;
        }
        try {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight || 800));
        } catch {
          break; // Page likely navigated/closed mid-scroll.
        }
        runState.scrolls += 1;
        await sleep(1500 + Math.random() * 1500);

        const currentCount = dedupeCount(runState.ads);
        if (currentCount > prevCount) {
          prevCount = currentCount;
          consecutiveEmpty = 0;
        } else {
          consecutiveEmpty += 1;
          if (consecutiveEmpty >= 5) {
            logLine("5 consecutive scrolls with no new ads — stopping");
            break;
          }
        }
      }

      if (Date.now() > deadline) runState.timedOut = true;
    },
    failedRequestHandler: async ({ request }, error) => {
      runState.lastError = error?.message || String(error);
      logLine(`request failed after retries (${request?.retryCount ?? "?"} retries): ${runState.lastError}`);
    },
  });

  try {
    await crawler.run([input.url]);
  } catch (error) {
    runState.lastError = error?.message || String(error);
    logLine(`crawler.run error: ${runState.lastError}`);
  }

  const items = dedupeByArchiveId(runState.ads);
  const stats = interceptor.stats;

  return {
    items,
    pagesLoaded: runState.pagesLoaded,
    scrolls: runState.scrolls,
    evidenceDir,
    blockedSignal: runState.blockedSignal,
    timedOut: runState.timedOut,
    errorMessage: runState.lastError,
    graphqlResponses: stats.graphqlResponses,
    adLibraryResponses: stats.adLibraryResponses,
  };
}

export const _internals = { detectBotChallenge, dismissCookieConsent, sleep, BOT_SIGNALS };
export { randomUUID };
