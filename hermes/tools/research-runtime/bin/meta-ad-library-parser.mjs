/**
 * meta-ad-library-parser.mjs — shared, deterministic Meta Ad Library parser.
 *
 * Used by BOTH the ScrapingBee pilot (scripts/research/scrapingbee-pilot.mjs)
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
 *   - confirmed_absence requires structured evidence: count === 0, edges ===
 *     [], and page_info.has_next_page === false.
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
const AD_ID_FALLBACK_PATTERN = /\\?"(?:ad_archive_id|adArchiveID)\\?"\s*:\s*\\?"(\d[\d_]{5,})\\?"/giu;

const AD_ID_VALUE_PATTERN = /^\d[\d_]{5,}$/u;

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
          const key = JSON.stringify(parsed);
          if (!seen.has(key)) {
            seen.add(key);
            connections.push(parsed);
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
export function classifyMetaAdLibraryPayload(html) {
  const text = String(html || "");
  const warnings = [];

  const challengeDetected = CHALLENGE_PATTERNS.some((pattern) => pattern.test(text));
  if (challengeDetected) {
    return { outcome: "challenge", ads: [], adIds: [], connectionCount: null, pageInfo: { hasNextPage: null, endCursor: null }, warnings };
  }
  const loginWall = LOGIN_WALL_PATTERN.test(text);
  if (loginWall) {
    return { outcome: "login_wall", ads: [], adIds: [], connectionCount: null, pageInfo: { hasNextPage: null, endCursor: null }, warnings };
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
    return { outcome: "unparseable", ads: [], adIds: [], connectionCount: null, pageInfo: { hasNextPage: null, endCursor: null }, warnings };
  }

  // Merge connection objects: the richest edges win; counts and page_info are
  // taken from objects that carry them (field order in the payload varies).
  let bestEdges = null;
  let maxCount = null;
  let pageInfo = { hasNextPage: null, endCursor: null };
  for (const connection of connections) {
    const count = typeof connection.count === "number" ? connection.count : null;
    if (count !== null && (maxCount === null || count > maxCount)) maxCount = count;
    const edges = Array.isArray(connection.edges) ? connection.edges : null;
    if (edges && (!bestEdges || edges.length > bestEdges.length)) bestEdges = edges;
    const info = connection.page_info && typeof connection.page_info === "object" ? connection.page_info : null;
    if (info) {
      if (typeof info.has_next_page === "boolean") pageInfo.hasNextPage = info.has_next_page;
      if (typeof info.end_cursor === "string" && !pageInfo.endCursor) pageInfo.endCursor = info.end_cursor;
    }
  }

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
    return { outcome: "success", ads, adIds: [...adIds], connectionCount: maxCount, pageInfo, warnings };
  }

  // No ads in edges. Absence needs complete structured evidence.
  const emptyEdges = bestEdges !== null && bestEdges.length === 0;
  if (maxCount === 0 && emptyEdges && pageInfo.hasNextPage === false) {
    return { outcome: "confirmed_absence", ads: [], adIds: [], connectionCount: 0, pageInfo, warnings };
  }
  warnings.push("connection_present_but_unclassified");
  return { outcome: "partial", ads: [], adIds: [], connectionCount: maxCount, pageInfo, warnings };
}

export default classifyMetaAdLibraryPayload;
