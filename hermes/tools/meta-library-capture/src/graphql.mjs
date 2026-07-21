/**
 * graphql.mjs — GraphQL response interception + ad_library_main extraction.
 *
 * Meta's Ad Library loads results through POSTs to `/api/graphql/`. The real
 * payload shape is
 *   `data.ad_library_main.search_results_connection.edges[].node.collated_results[]`
 * but the traversal is defensive: `ad_library_main` is accepted anywhere in
 * the payload (bounded DFS), edges/nodes/collated_results are walked with
 * optional chaining, and unknown shapes yield zero ads instead of throwing.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { mapCollatedResultNode } from "./map-ad.mjs";

const GRAPHQL_API_MARKER = "/api/graphql/";
const MAX_SEARCH_DEPTH = 10;

/**
 * Find every value stored under an `ad_library_main` key, anywhere reasonable
 * in the payload. Depth-bounded so pathological payloads cannot hang the run.
 */
export function findAdLibraryMain(payload) {
  const found = [];
  const visit = (value, depth) => {
    if (depth > MAX_SEARCH_DEPTH || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (value.ad_library_main && typeof value.ad_library_main === "object") {
      found.push(value.ad_library_main);
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(payload, 0);
  return found;
}

/**
 * @returns {object[]} raw collated-result ad nodes (unmapped).
 */
export function extractAdNodes(payload) {
  const nodes = [];
  for (const main of findAdLibraryMain(payload)) {
    const connection = main.search_results_connection
      ?? Object.values(main).find((value) => value && typeof value === "object" && Array.isArray(value.edges));
    const edges = Array.isArray(connection?.edges) ? connection.edges : [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      if (Array.isArray(node.collated_results)) {
        for (const result of node.collated_results) {
          if (result && typeof result === "object" && !Array.isArray(result)) nodes.push(result);
        }
      } else if (node.ad_archive_id != null || node.adArchiveID != null) {
        nodes.push(node);
      }
    }
  }
  return nodes;
}

/**
 * Extract and map all ads in one GraphQL payload. Nodes without a valid
 * `ad_archive_id` are skipped by the mapper.
 * @returns {object[]} MetaAdLibraryAd[]
 */
export function parseGraphqlAds(payload) {
  const ads = [];
  for (const node of extractAdNodes(payload)) {
    const ad = mapCollatedResultNode(node);
    if (ad) ads.push(ad);
  }
  return ads;
}

/**
 * Run-scoped dedupe by ad_archive_id.
 * @param {object[]} ads MetaAdLibraryAd[]
 */
export function dedupeByArchiveId(ads) {
  const seen = new Set();
  const out = [];
  for (const ad of ads) {
    const id = String(ad?.adArchiveID ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(ad);
  }
  return out;
}

/**
 * Interceptor bound to a Playwright page in `preNavigationHooks` (Crawlee
 * navigates after those hooks, so no early response is missed).
 */
export class GraphqlAdInterceptor {
  /**
   * @param {{ evidenceDir?: string|null, evidenceLimit?: number, log?: (line: string) => void }} options
   */
  constructor({ evidenceDir = null, evidenceLimit = 5, log = null } = {}) {
    this.evidenceDir = evidenceDir;
    this.evidenceLimit = evidenceLimit;
    this.log = log;
    this.graphqlResponses = 0;
    this.adLibraryResponses = 0;
    this.evidenceWritten = 0;
  }

  /**
   * Playwright `page.on('response')` handler. Returns the ads parsed from
   * this response ([] when the response is not an ad-bearing GraphQL POST).
   */
  async handleResponse(response) {
    try {
      const request = response.request();
      if (request.method() !== "POST") return [];
      const url = response.url();
      if (!url.includes(GRAPHQL_API_MARKER)) return [];
      this.graphqlResponses += 1;

      const body = await response.text().catch(() => null);
      if (!body || !body.includes("ad_library_main")) return [];
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return [];
      }
      this.adLibraryResponses += 1;
      await this.#writeEvidence(body);
      return parseGraphqlAds(payload);
    } catch (error) {
      this.log?.(`graphql interception failed: ${error?.message || error}`);
      return [];
    }
  }

  get stats() {
    return {
      graphqlResponses: this.graphqlResponses,
      adLibraryResponses: this.adLibraryResponses,
      evidenceWritten: this.evidenceWritten,
    };
  }

  async #writeEvidence(body) {
    if (!this.evidenceDir || this.evidenceWritten >= this.evidenceLimit) return;
    this.evidenceWritten += 1;
    try {
      await mkdir(this.evidenceDir, { recursive: true });
      await writeFile(join(this.evidenceDir, `graphql-${this.evidenceWritten}.json`), body, "utf8");
    } catch (error) {
      this.log?.(`evidence write failed: ${error?.message || error}`);
    }
  }
}
