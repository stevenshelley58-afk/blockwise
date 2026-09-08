/**
 * meta-ad-library-parser.mjs — shared, deterministic Meta Ad Library parser.
 *
 * Used by the canonical Ad Radar collector and its behavioral tests
 * and the production collector (supabase-supervisor.mjs runScrapingBeePageCapture).
 *
 * Design rules (Ad Radar v2 review):
 *   - Structured extraction of search_results_connection objects: count,
 *     edges, page_info (has_next_page / end_cursor). Never JSON.parse() the
 *     whole document.
 *   - Handles both plain JSON payloads and escaped-quote variants (payload
 *     embedded in a JS string, where quotes appear as \").
 *   - Outcomes: success | confirmed_absence | partial | challenge | login_wall
 *     | unparseable. Challenge and login walls are ALWAYS failures, never
 *     zero-ad results.
 *   - confirmed_absence requires an exact requested page correlation plus
 *     count === 0, edges === [], page_info.has_next_page === false, and an
 *     empty end_cursor.
 *   - Pagination evidence is surfaced to the caller; callers must never infer
 *     exhaustion from a result count.
 */

const CHALLENGE_PATTERNS = [
  /\/__rd_verify_[^"'\s<]+/iu,
  /\bexecuteChallenge\s*\(/iu,
  /\bchallenge=3\b/iu,
  /ad_library_is_captcha_required\\?"\s*:\s*true/iu,
];

const LOGIN_WALL_PATTERN = /you must log in to continue/iu;

// Matches the connection marker in plain and escaped variants. The object
// body is extracted by brace matching, not by a fragile regex.
const CONNECTION_MARKER = /\\?"search_results_connection\\?"\s*:\s*/giu;

// Fallback ad-id harvest when edges are not JSON-parsable. Accepts escaped
// quotes and snake/camel key variants. IDs are numeric, sometimes with
// internal separators (e.g. "<page_id>_<sequence>").
const AD_ID_FALLBACK_PATTERN =
  /\\?"(?:ad_archive_id|adArchiveID)\\?"\s*:\s*\\?"(\d[\d_]{5,})\\?"/giu;

const AD_ID_VALUE_PATTERN = /^\d[\d_]{5,}$/u;

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&#x27;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractServerRenderedPageContext(text, requestedPageId) {
  const pageIds = new Set();
  const queryPatterns = [
    /(?:view_all_page_id|viewAllPageID)\s*=\s*(?:&quot;|["']?)(\d{5,})/giu,
    /(?:view_all_page_id|viewAllPageID)(?:&quot;|["'])\s*:\s*(?:&quot;|["'])(\d{5,})/giu,
  ];
  for (const pattern of queryPatterns) {
    for (const match of text.matchAll(pattern)) pageIds.add(match[1]);
  }
  if (pageIds.size !== 1 || !pageIds.has(requestedPageId)) return null;

  const anchors = [];
  const anchorPattern =
    /<a\b[^>]*href=["']https?:\/\/(?:www\.)?facebook\.com\/(?!ads(?:[/?#]|$))[^"']*["'][^>]*>([\s\S]{0,1200}?)<\/a>/giu;
  for (const match of text.matchAll(anchorPattern)) {
    const label = decodeHtmlText(match[1]);
    const href = match[0].match(/href=["']([^"']+)["']/iu)?.[1] || null;
    let pagePath = null;
    try {
      pagePath = href ? new URL(href).pathname.replace(/\/+$/u, "").toLowerCase() : null;
    } catch {
      // The href is only context; an invalid URL cannot prove page identity.
    }
    if (label && pagePath && !/^(?:log in|ad library|about|report)$/iu.test(label)) {
      anchors.push({ label, index: match.index, pagePath });
    }
  }
  const page = anchors.find(({ label }) => label.length >= 2) || null;
  return page
    ? { pageName: page.label, pageId: requestedPageId, anchorIndex: page.index, pagePath: page.pagePath }
    : null;
}

function extractServerRenderedCards(text, requestedPageId) {
  const context = extractServerRenderedPageContext(text, requestedPageId);
  if (!context) return null;

  const activeMarkers = [...text.matchAll(/>\s*Active\s*<\/span>/giu)];
  if (!activeMarkers.length) return null;
  // The page anchor is the only owner/page context available in this
  // server-rendered shape. Require it before the cards, alongside the exact
  // view_all_page_id query correlation above; otherwise IDs are unscoped.
  const firstCardIndex = activeMarkers[0].index;
  if (context.anchorIndex > firstCardIndex) return null;
  const cards = [];
  const seen = new Set();
  for (let index = 0; index < activeMarkers.length; index += 1) {
    const start = activeMarkers[index].index;
    const end = activeMarkers[index + 1]?.index ?? text.length;
    const segment = text.slice(start, end);
    const cardLinks = [...segment.matchAll(/<a\b[^>]*href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"']+)["']/giu)];
    const cardHasPageContext = cardLinks.some((match) => {
      try {
        return new URL(match[1]).pathname.replace(/\/+$/u, "").toLowerCase() === context.pagePath;
      } catch {
        return false;
      }
    });
    if (!cardHasPageContext) continue;
    const ids = [...segment.matchAll(/Library ID:\s*(\d{8,})/giu)].map((match) => match[1]);
    if (ids.length !== 1 || seen.has(ids[0])) continue;
    const bodyMatch = segment.match(
      /<div\b[^>]*style=["'][^"']*white-space\s*:\s*pre-wrap[^"']*["'][^>]*>([\s\S]*?)<\/div>/iu,
    );
    const body = decodeHtmlText(bodyMatch?.[1]);
    if (!body) continue;
    seen.add(ids[0]);
    // Server-rendered media URLs live in an opaque card shell. Do not guess
    // ownership or media identity here; the independent media lane can only
    // archive media after a later validated source supplies that linkage.
    cards.push({
      id: ids[0],
      node: {
        library_id: ids[0],
        page_id: context.pageId,
        page_name: context.pageName,
        is_active: true,
        ad_active_status: "active",
        snapshot: { body },
      },
    });
  }
  return cards.length ? cards : null;
}

function softUnescape(text) {
  // One level of JS-string unescaping: \" -> ", \\ -> \. Applied only to the
  // extracted object bodies, never to the whole document.
  return text.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function extractBalancedObject(text, startIndex) {
  // text[startIndex] must be "{". Returns the substring of the balanced JSON
  // object starting at startIndex, honoring string literals and escapes.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
}

function enclosingDataPageId(source, markerIndex) {
  // Meta's streamed result stores ad_library_main and page as siblings in the
  // same data object. Looking only inside ad_library_main misses that exact
  // page correlation and would make a genuine empty response partial. Walk
  // candidate data objects backwards and accept only one that encloses the
  // connection marker and parses to the requested response shape.
  const pattern = /\\?"data\\?"\s*:\s*\{/giu;
  let enclosing = null;
  for (const match of source.matchAll(pattern)) {
    if (match.index >= markerIndex) break;
    const objectStart = source.indexOf("{", match.index + match[0].length - 1);
    if (objectStart < 0) continue;
    const raw = extractBalancedObject(source, objectStart);
    if (!raw || markerIndex > objectStart + raw.length) continue;
    enclosing = raw;
  }
  if (!enclosing) return null;
  try {
    const parsed = JSON.parse(enclosing);
    return numericPageId(parsed?.page?.id);
  } catch {
    return null;
  }
}

function isStrictZeroConnection(connection) {
  const info = connection?.page_info;
  return connection?.count === 0
    && Array.isArray(connection?.edges)
    && connection.edges.length === 0
    && info?.has_next_page === false
    && info?.end_cursor === "";
}

function walkAdIds(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAdIds(item, out);
    return;
  }
  const id = node.ad_archive_id ?? node.adArchiveID;
  if (typeof id === "string" && AD_ID_VALUE_PATTERN.test(id)) out.add(id);
  for (const value of Object.values(node)) walkAdIds(value, out);
}

function numericPageId(value) {
  const text = String(value ?? "").trim();
  return /^\d{5,}$/u.test(text) ? text : null;
}

function pageIdsIn(value, out = new Set(), parentKey = "") {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) pageIdsIn(item, out, parentKey);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:view_all_page_id|page_id|pageId|pageID)$/u.test(key)) {
      const pageId = numericPageId(child);
      if (pageId) out.add(pageId);
    } else if (key === "id" && /page/iu.test(parentKey)) {
      const pageId = numericPageId(child);
      if (pageId) out.add(pageId);
    }
    pageIdsIn(child, out, key);
  }
  return out;
}

function nearbyPageIds(source, start, end) {
  const ids = new Set();
  const nearby = source.slice(
    Math.max(0, start - 256),
    Math.min(source.length, end + 2048),
  );
  const pattern =
    /\\?"(?:view_all_page_id|page_id|pageId|pageID)\\?"\s*:\s*\\?"(\d{5,})\\?"/giu;
  for (const match of nearby.matchAll(pattern)) ids.add(match[1]);
  return ids;
}

function extractConnections(html) {
  const text = String(html || "");
  const connections = [];
  const seen = new Set();
  // Scan both the raw text and a one-level-unescaped copy. Escaped variants
  // (payload embedded in a JS string) only parse after \" -> " unescaping,
  // and brace matching must run over the SAME text the regex matched.
  for (const source of [text, softUnescape(text)]) {
    CONNECTION_MARKER.lastIndex = 0;
    let match;
    while ((match = CONNECTION_MARKER.exec(source)) !== null) {
      const braceIndex = source.indexOf("{", match.index + match[0].length - 1);
      if (braceIndex === -1) continue;
      const raw = extractBalancedObject(source, braceIndex);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const mainPageId = enclosingDataPageId(source, match.index);
          const key = JSON.stringify([parsed, mainPageId]);
          if (!seen.has(key)) {
            seen.add(key);
            connections.push({
              connection: parsed,
              mainPageId,
              pageIds: new Set([
                ...pageIdsIn(parsed),
                ...nearbyPageIds(source, match.index, braceIndex + raw.length),
              ]),
            });
          }
        }
      } catch {
        // unbalanced or invalid body; skip
      }
    }
  }
  return connections;
}

/**
 * @param {string} html raw Ad Library HTML/JSON payload
 * @returns {{
 *   outcome: "success"|"confirmed_absence"|"partial"|"challenge"|"login_wall"|"unparseable",
 *   ads: Array<{id: string, node: object}>,
 *   adIds: string[],
 *   connectionCount: number|null,
 *   pageInfo: {hasNextPage: boolean|null, endCursor: string|null},
 *   warnings: string[],
 * }}
 */
export function classifyMetaAdLibraryPayload(
  html,
  { requestedPageId = null } = {},
) {
  const text = String(html || "");
  const warnings = [];

  const challengeDetected = CHALLENGE_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
  if (challengeDetected) {
    return {
      outcome: "challenge",
      ads: [],
      adIds: [],
      connectionCount: null,
      pageInfo: { hasNextPage: null, endCursor: null },
      warnings,
    };
  }
  const loginWall = LOGIN_WALL_PATTERN.test(text);
  if (loginWall) {
    return {
      outcome: "login_wall",
      ads: [],
      adIds: [],
      connectionCount: null,
      pageInfo: { hasNextPage: null, endCursor: null },
      warnings,
    };
  }

  const connections = extractConnections(text);
  if (connections.length === 0) {
    // Harvest ids even without a parsable connection so partial evidence
    // still reaches the caller.
    const fallbackIds = new Set();
    AD_ID_FALLBACK_PATTERN.lastIndex = 0;
    let fallbackMatch;
    while ((fallbackMatch = AD_ID_FALLBACK_PATTERN.exec(text)) !== null) {
      fallbackIds.add(fallbackMatch[1]);
    }
    if (fallbackIds.size > 0) {
      warnings.push("connection_unparsable_but_ad_ids_found");
      return {
        outcome: "partial",
        ads: [...fallbackIds].map((id) => ({ id, node: null })),
        adIds: [...fallbackIds],
        connectionCount: null,
        pageInfo: { hasNextPage: null, endCursor: null },
        warnings,
      };
    }
    const serverRenderedCards = extractServerRenderedCards(text, numericPageId(requestedPageId));
    if (serverRenderedCards) {
      warnings.push("server_rendered_card_fallback", "pagination_unproven");
      return {
        outcome: "partial",
        ads: serverRenderedCards,
        adIds: serverRenderedCards.map(({ id }) => id),
        connectionCount: null,
        pageInfo: { hasNextPage: null, endCursor: null },
        warnings,
      };
    }
    return {
      outcome: "unparseable",
      ads: [],
      adIds: [],
      connectionCount: null,
      pageInfo: { hasNextPage: null, endCursor: null },
      warnings,
    };
  }

  const requested =
    requestedPageId === null || requestedPageId === undefined
      ? null
      : numericPageId(requestedPageId);
  if (requestedPageId !== null && requestedPageId !== undefined && !requested) {
    warnings.push("requested_page_id_invalid");
    return {
      outcome: "partial",
      ads: [],
      adIds: [],
      connectionCount: null,
      pageInfo: { hasNextPage: null, endCursor: null },
      warnings,
    };
  }
  // Never merge edges/count/page_info from different connections: an HTML shell
  // can contain prefetches for unrelated pages. Select one correlated
  // connection only; no correlation is partial evidence, never success/zero.
  const correlated = requested
    ? connections.filter(({ pageIds, mainPageId }) =>
      pageIds.has(requested) || mainPageId === requested)
    : connections;
  if (correlated.length === 0) {
    warnings.push("requested_page_connection_not_found");
    return {
      outcome: "partial",
      ads: [],
      adIds: [],
      connectionCount: null,
      pageInfo: { hasNextPage: null, endCursor: null },
      warnings,
    };
  }
  const selectedEntry = correlated
    .slice()
    .sort(
      (a, b) =>
        (Array.isArray(b.connection.edges) ? b.connection.edges.length : -1) -
        (Array.isArray(a.connection.edges) ? a.connection.edges.length : -1),
    )[0];
  const selected = selectedEntry.connection;
  const bestEdges = Array.isArray(selected.edges) ? selected.edges : null;
  const maxCount = typeof selected.count === "number" ? selected.count : null;
  const info =
    selected.page_info && typeof selected.page_info === "object"
      ? selected.page_info
      : {};
  const pageInfo = {
    hasNextPage:
      typeof info.has_next_page === "boolean" ? info.has_next_page : null,
    endCursor: typeof info.end_cursor === "string" ? info.end_cursor : null,
  };

  const ads = [];
  const adIds = new Set();
  if (bestEdges) {
    for (const edge of bestEdges) {
      const node = edge?.node ?? edge;
      const ids = new Set();
      walkAdIds(node, ids);
      for (const id of ids) {
        if (!adIds.has(id)) {
          adIds.add(id);
          ads.push({ id, node });
        }
      }
    }
  }

  if (adIds.size === 0 && bestEdges && bestEdges.length > 0) {
    warnings.push("edges_present_but_no_ad_ids_extracted");
  }

  if (adIds.size > 0) {
    return {
      outcome: "success",
      ads,
      adIds: [...adIds],
      connectionCount: maxCount,
      pageInfo,
      warnings,
    };
  }

  // No ads in edges. Absence needs complete structured evidence.
  if (
    selectedEntry.mainPageId === requested
    && isStrictZeroConnection(selected)
  ) {
    return {
      outcome: "confirmed_absence",
      ads: [],
      adIds: [],
      connectionCount: 0,
      pageInfo,
      warnings,
    };
  }
  warnings.push("connection_present_but_unclassified");
  return {
    outcome: "partial",
    ads: [],
    adIds: [],
    connectionCount: maxCount,
    pageInfo,
    warnings,
  };
}

export default classifyMetaAdLibraryPayload;
