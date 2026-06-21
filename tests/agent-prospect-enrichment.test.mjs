import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAgentEnrichment,
  buildAgentQueries,
  buildAgentUpdatePatch,
  buildExportRow,
  candidateFromResult,
  classifySocialUrl,
  csvFromRows,
  isAgentProspectCandidate,
  isBlockedEvidence,
  isWrongRegionEvidence,
  normalizeSocialUrl,
} from "../scripts/research/enrich-wa-agent-prospects-with-exa.mjs";

const agent = {
  id: "agent-1",
  full_name: "Jane Smith",
  state: "WA",
  status: "licensed_verified",
  agency_role: "sales",
  agency_name: "Northstar Realty",
  agency_website_url: "https://northstarrealty.com.au",
  primary_suburb: "Subiaco",
  primary_postcode: "6008",
  email: null,
  phone: null,
  website_url: null,
  metadata: {},
  serviceAreas: [{ suburb: "Subiaco", postcode: "6008", state: "WA", match_type: "agent_profile_listing", confidence: 80 }],
};

test("agent prospect selection is WA agent-only and respects missing-only mode", () => {
  assert.equal(isAgentProspectCandidate(agent, { missingOnly: true }), true);
  assert.equal(isAgentProspectCandidate({ ...agent, status: "inactive" }, { missingOnly: false }), false);
  assert.equal(isAgentProspectCandidate({ ...agent, state: "NSW" }, { missingOnly: false }), false);
  assert.equal(
    isAgentProspectCandidate(
      {
        ...agent,
        email: "jane@northstarrealty.com.au",
        phone: "0400000000",
        website_url: "https://northstarrealty.com.au/jane-smith",
        metadata: {
          cold_email_enrichment: {
            v1: { profile_url: "https://reiwa.com.au/real-estate-agent/jane-smith/", social_links: { facebook: "https://facebook.com/janesmith" } },
          },
        },
      },
      { missingOnly: true },
    ),
    false,
  );
});

test("query generation uses the existing agent and agency context, including social searches", () => {
  const queries = buildAgentQueries(agent);
  const joined = queries.map((entry) => `${entry.kind}:${entry.query}`).join("\n");

  assert.match(joined, /"Jane Smith"/);
  assert.match(joined, /"Northstar Realty"/);
  assert.match(joined, /site:reiwa\.com\.au\/real-estate-agent\//);
  assert.match(joined, /site:facebook\.com/);
  assert.match(joined, /site:instagram\.com/);
  assert.match(joined, /site:linkedin\.com\/in/);
  assert.match(joined, /site:youtube\.com OR site:tiktok\.com OR site:x\.com/);
});

test("candidate filtering rejects blocked pages, Washington false positives, generic directories, and ambiguous social profiles", () => {
  assert.equal(isBlockedEvidence("realestate.com.au - 403 Error - Permission Denied"), true);
  assert.equal(isWrongRegionEvidence("Jane Smith is a Seattle Washington realtor"), true);

  const generic = candidateFromResult(
    agent,
    { kind: "profile", query: "Jane Smith real estate" },
    {},
    { url: "https://reiwa.com.au/real-estate-agents/subiaco/", title: "Real Estate Agents in Subiaco, WA | REIWA", highlights: ["Jane Smith"] },
    1,
  );
  assert.equal(generic, null);

  const ambiguousSocial = candidateFromResult(
    agent,
    { kind: "social_facebook", query: "Jane Smith site:facebook.com" },
    {},
    { url: "https://facebook.com/jane.smith", title: "Jane Smith", highlights: ["Photos and friends"] },
    1,
  );
  assert.equal(ambiguousSocial, null);
});

test("social URL classification and normalization keep public professional profile URLs", () => {
  assert.equal(classifySocialUrl("https://www.linkedin.com/in/jane-smith-real-estate/"), "linkedin");
  assert.equal(normalizeSocialUrl("https://www.facebook.com/jane.smith.realestate/?ref=page_internal"), "https://facebook.com/jane.smith.realestate");
  assert.equal(normalizeSocialUrl("https://twitter.com/janesmithre"), "https://x.com/janesmithre");
  assert.equal(normalizeSocialUrl("https://instagram.com/p/abc123"), null);
});

test("enrichment extracts source-backed contact, profile, social, service areas, and opener", () => {
  const candidates = [
    {
      source_url: "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
      title: "Jane Smith - Northstar Realty | Real Estate Agent",
      sourceKind: "reiwa_profile",
      socialPlatform: null,
      confidence: 91,
      evidenceText: "Jane Smith - Northstar Realty | Real Estate Agent\nNorthstar Realty\nSubiaco WA 6008\njane.smith@northstarrealty.com.au\n0412 345 678\nAward winning local real estate specialist in Subiaco.",
      sourceDocumentId: "11111111-1111-1111-1111-111111111111",
    },
    {
      source_url: "https://www.facebook.com/jane.smith.realestate/",
      title: "Jane Smith - Northstar Realty",
      sourceKind: "social",
      socialPlatform: "facebook",
      confidence: 78,
      evidenceText: "Jane Smith Northstar Realty real estate agent Subiaco WA",
      sourceDocumentId: "22222222-2222-2222-2222-222222222222",
    },
  ];

  const enrichment = buildAgentEnrichment(agent, candidates, "2026-06-22T00:00:00.000Z");

  assert.equal(enrichment.email, "jane.smith@northstarrealty.com.au");
  assert.equal(enrichment.phone, "0412345678");
  assert.equal(enrichment.profile_url, "https://reiwa.com.au/real-estate-agent/jane-smith-12345/");
  assert.equal(enrichment.social_links.facebook, "https://facebook.com/jane.smith.realestate");
  assert.deepEqual(enrichment.service_areas.map((area) => area.postcode), ["6008"]);
  assert.equal(enrichment.sendability_status, "ready");
  assert.match(enrichment.personalization_hook, /REIWA profile lists you with Northstar Realty around Subiaco/);
  assert.ok(enrichment.segment_tags.includes("has_agent_email"));
  assert.ok(enrichment.segment_tags.includes("has_social"));
});

test("agent updates persist metadata without overwriting existing canonical contact fields", () => {
  const enrichment = buildAgentEnrichment(
    agent,
    [
      {
        source_url: "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
        title: "Jane Smith - Northstar Realty",
        sourceKind: "reiwa_profile",
        socialPlatform: null,
        confidence: 90,
        evidenceText: "Jane Smith Northstar Realty jane.smith@northstarrealty.com.au 0412 345 678",
        sourceDocumentId: "11111111-1111-1111-1111-111111111111",
      },
    ],
    "2026-06-22T00:00:00.000Z",
  );
  const patch = buildAgentUpdatePatch(
    { ...agent, email: "existing@northstarrealty.com.au", phone: "0400000000", website_url: "https://existing.com.au" },
    enrichment,
  );

  assert.equal("email" in patch, false);
  assert.equal("phone" in patch, false);
  assert.equal("website_url" in patch, false);
  assert.equal(patch.metadata.cold_email_enrichment.v1.email, "jane.smith@northstarrealty.com.au");
});

test("export rows are agent-recipient only and include social fields", () => {
  const enrichment = buildAgentEnrichment(
    agent,
    [
      {
        source_url: "https://www.linkedin.com/in/jane-smith-real-estate/",
        title: "Jane Smith - Northstar Realty",
        sourceKind: "social",
        socialPlatform: "linkedin",
        confidence: 82,
        evidenceText: "Jane Smith Northstar Realty real estate agent",
        sourceDocumentId: "22222222-2222-2222-2222-222222222222",
      },
    ],
    "2026-06-22T00:00:00.000Z",
  );
  const row = buildExportRow(agent, enrichment);
  const csv = csvFromRows([row]);

  assert.equal(row.agent_id, "agent-1");
  assert.equal(row.agency_name, "Northstar Realty");
  assert.equal(row.linkedin_url, "https://linkedin.com/in/jane-smith-real-estate");
  assert.equal(Object.hasOwn(row, "agency_id"), false);
  assert.equal(Object.hasOwn(row, "agency_email"), false);
  assert.match(csv.split("\n")[0], /agent_id,full_name,agency_name/);
});

test("research source provider schema includes Exa roster and prospect enrichment sources", () => {
  const schema = readFileSync("src/lib/research/schemas/common.ts", "utf8");
  assert.match(schema, /"exa_roster_search"/);
  assert.match(schema, /"exa_prospect_enrichment"/);
});
