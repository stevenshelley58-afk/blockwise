import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAgentEnrichment,
  buildAgentQueries,
  buildAgentUpdatePatch,
  buildExistingRosterEnrichment,
  buildExportRow,
  buildFetchedPageEnrichment,
  buildPublicPageFetchTargets,
  candidateFromResult,
  candidateFromFetchedPage,
  classifySocialUrl,
  csvFromRows,
  extractOfficialSiteLinksFromHtml,
  extractRelevantSitePageLinksFromHtml,
  extractSocialLinksFromHtml,
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
  assert.equal(normalizeSocialUrl("https://au.linkedin.com/in/jane-smith-real-estate/"), "https://linkedin.com/in/jane-smith-real-estate");
  assert.equal(normalizeSocialUrl("https://linkedin.com/public-profile/settings"), null);
  assert.equal(normalizeSocialUrl("https://youtube.com/@SellingPerthRealEstate/videos"), "https://youtube.com/@SellingPerthRealEstate");
  assert.equal(normalizeSocialUrl("https://youtube.com/user/REIWAvideochannel"), null);
  assert.equal(normalizeSocialUrl("https://youtube.com/user/googleplay"), null);
  assert.equal(normalizeSocialUrl("https://facebook.com/GooglePlay"), null);
  assert.equal(normalizeSocialUrl("https://youtu.be/PBQmbTewf3A"), null);
  assert.equal(normalizeSocialUrl("https://youtube.com/results?search_query=perth+real+estate"), null);
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

test("existing roster enrichment records current agent evidence without inventing social links", () => {
  const enrichment = buildExistingRosterEnrichment(
    {
      ...agent,
      email: "jane.smith@northstarrealty.com.au",
      phone: "0412345678",
      website_url: "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
    },
    [
      {
        source_url: "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
        sourceKind: "reiwa_profile",
        confidence: 82,
        evidenceText: "Jane Smith Northstar Realty Subiaco jane.smith@northstarrealty.com.au 0412 345 678",
        sourceDocumentId: "11111111-1111-1111-1111-111111111111",
      },
    ],
    "2026-06-22T00:00:00.000Z",
  );

  assert.equal(enrichment.email, "jane.smith@northstarrealty.com.au");
  assert.equal(enrichment.phone, "0412345678");
  assert.equal(enrichment.profile_url, "https://reiwa.com.au/real-estate-agent/jane-smith-12345/");
  assert.equal(enrichment.social_links.facebook, null);
  assert.equal(enrichment.sendability_status, "ready");
  assert.equal(enrichment.skipped_reason, "exa_key_missing_social_discovery_not_run");
  assert.deepEqual(enrichment.source_document_ids, ["11111111-1111-1111-1111-111111111111"]);
});

test("existing roster personalization uses licence-register wording for DEMIRS-only evidence", () => {
  const enrichment = buildExistingRosterEnrichment(
    { ...agent, email: null, phone: null, website_url: null },
    [
      {
        source_url: "https://ols.demirs.wa.gov.au/api/Search/details/1/2/RR/I/GNT",
        sourceKind: "demirs_register",
        confidence: 74,
        evidenceText: "Jane Smith Northstar Realty Subiaco",
        sourceDocumentId: "33333333-3333-3333-3333-333333333333",
      },
    ],
    "2026-06-22T00:00:00.000Z",
  );

  assert.match(enrichment.personalization_hook, /public WA licence register entry/);
  assert.doesNotMatch(enrichment.personalization_hook ?? "", /public agent profile/);
});

test("public page fetch targets use current roster URLs and scope agency context", () => {
  const targets = buildPublicPageFetchTargets(
    {
      ...agent,
      website_url: "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
      metadata: { evidence_url: "https://ols.demirs.wa.gov.au/api/Search/details/1/2/RR/I/GNT" },
      agency: {
        website_url: "https://reiwa.com.au/real-estate-agency/northstar-realty-999/",
      },
    },
    3,
  );

  assert.deepEqual(
    targets.map((target) => [target.label, target.scope]),
    [
      ["agent_website_url", "agent_profile_context"],
      ["agency_context_url", "agency_context"],
    ],
  );
});

test("public page social extraction normalizes social URLs and filters non-profile links", () => {
  const links = extractSocialLinksFromHtml(
    `
      <a href="https://www.facebook.com/hiveresidential.au?ref=page_internal">Facebook</a>
      <a href="https://www.instagram.com/hiveresidential_au/">Instagram</a>
      <a href="https://linkedin.com/company/hive-residential">LinkedIn</a>
      <a href="https://facebook.com/reiwa">REIWA Facebook</a>
      <a href="https://linkedin.com/company/reiwa">REIWA LinkedIn</a>
      <a href="https://youtube.com/user/REIWAvideochannel">REIWA YouTube</a>
      <a href="https://instagram.com/p/abc123">Post</a>
    `,
    "https://reiwa.com.au/real-estate-agency/hive-residential-pty-ltd-160554-0/",
  );

  assert.deepEqual(links, [
    { platform: "facebook", url: "https://facebook.com/hiveresidential.au" },
    { platform: "instagram", url: "https://instagram.com/hiveresidential_au" },
    { platform: "linkedin", url: "https://linkedin.com/company/hive-residential" },
  ]);
});

test("official site discovery keeps outbound agency sites and relevant team pages", () => {
  const official = extractOfficialSiteLinksFromHtml(
    `
      <a href="https://www.google.com/maps/place/test">Map</a>
      <a href="https://www.facebook.com/northstarrealty">Facebook</a>
      <a href="https://www.facebook.com.au/northstarrealty">Typo Facebook</a>
      <a href="http://www.twitter.com.au/northstarrealty">Typo X</a>
      <a href="https://play.google.com/about/giftcards">Google Play</a>
      <a href="https://www.9now.com.au">9Now</a>
      <a href="https://ajitabey">Broken profile handle</a>
      <a href="https://www.belleproperty/cottesloe">Broken agency link</a>
      <a href="https://northstarrealty.com.au">Website</a>
      <a href="https://reiwa.com.au/the-wa-market/">REIWA</a>
    `,
    "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
  );
  assert.deepEqual(official.map((link) => link.url), ["https://northstarrealty.com.au"]);

  const relevant = extractRelevantSitePageLinksFromHtml(
    `
      <a href="/team/jane-smith">Jane Smith</a>
      <a href="/properties/for-sale">Properties</a>
      <a href="/about/team">Our team</a>
    `,
    "https://northstarrealty.com.au",
    agent,
    3,
  );
  assert.deepEqual(relevant.map((link) => link.url), [
    "https://northstarrealty.com.au/team/jane-smith",
    "https://northstarrealty.com.au/about/team",
  ]);
});

test("official site discovery keeps legitimate non-au real estate domains", () => {
  const official = extractOfficialSiteLinksFromHtml(
    `
      <a href="https://yuliia.manko">Broken handle</a>
      <a href="https://tonymullen.realestate">View website</a>
    `,
    "https://reiwa.com.au/real-estate-agent/tony-mullen-12345/",
  );

  assert.deepEqual(official.map((link) => link.url), ["https://tonymullen.realestate"]);
});

test("fetched page enrichment merges scoped social evidence without overwriting existing links", () => {
  const fetched = {
    ...candidateFromFetchedPage(
      agent,
      {
        url: "https://reiwa.com.au/real-estate-agency/hive-residential-pty-ltd-160554-0/",
        label: "agency_context_url",
        scope: "agency_context",
      },
      `
        <title>Hive Residential | REIWA</title>
        <body>Northstar Realty Subiaco WA real estate agent team
          <a href="https://www.facebook.com/hiveresidential.au">Facebook</a>
          <a href="https://www.instagram.com/hiveresidential_au/">Instagram</a>
        </body>
      `,
      "2026-06-22T00:00:00.000Z",
      200,
    ),
    sourceDocumentId: "44444444-4444-4444-4444-444444444444",
  };
  const base = {
    ...buildExistingRosterEnrichment(
      {
        ...agent,
        email: "jane.smith@northstarrealty.com.au",
        phone: "0412345678",
        website_url: "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
      },
      [
        {
          source_url: "https://reiwa.com.au/real-estate-agent/jane-smith-12345/",
          sourceKind: "reiwa_profile",
          confidence: 82,
          evidenceText: "Jane Smith Northstar Realty Subiaco jane.smith@northstarrealty.com.au 0412 345 678",
          sourceDocumentId: "11111111-1111-1111-1111-111111111111",
        },
      ],
      "2026-06-22T00:00:00.000Z",
    ),
    social_links: {
      facebook: "https://facebook.com/jane.smith.realestate",
      instagram: null,
      linkedin: null,
      youtube: "https://youtube.com/user/REIWAvideochannel",
      tiktok: null,
      x: null,
      other: [],
    },
    social_link_scopes: {
      facebook: "agent_profile_context",
      instagram: null,
      linkedin: null,
      youtube: "source_site_footer",
      tiktok: null,
      x: null,
      other: [],
    },
  };

  const enrichment = buildFetchedPageEnrichment(agent, base, [fetched], "2026-06-22T00:00:00.000Z");

  assert.equal(enrichment.email, "jane.smith@northstarrealty.com.au");
  assert.equal(enrichment.social_links.facebook, "https://facebook.com/jane.smith.realestate");
  assert.deepEqual(enrichment.social_links.other, ["https://facebook.com/hiveresidential.au"]);
  assert.equal(enrichment.social_links.instagram, "https://instagram.com/hiveresidential_au");
  assert.equal(enrichment.social_links.youtube, null);
  assert.equal(enrichment.social_link_scopes.instagram, "agency_context");
  assert.deepEqual(enrichment.social_link_scopes.other, [
    { platform: "facebook", url: "https://facebook.com/hiveresidential.au", scope: "agency_context" },
  ]);
  assert.equal(enrichment.social_link_evidence.instagram[0].source_document_id, "44444444-4444-4444-4444-444444444444");
  assert.ok(enrichment.segment_tags.includes("has_social"));
});

test("fetched official agent pages can promote high-confidence missing contact fields", () => {
  const fetched = {
    ...candidateFromFetchedPage(
      agent,
      {
        url: "https://northstarrealty.com.au/team/jane-smith",
        label: "official_agent_page",
        scope: "official_agent_page_context",
      },
      `
        <title>Jane Smith | Northstar Realty</title>
        <body>
          <h1>Jane Smith</h1>
          <p>Jane Smith is a sales representative with Northstar Realty in Subiaco WA.</p>
          <a href="mailto:jane.smith@northstarrealty.com.au">Email Jane</a>
          <a href="mailto:bad%ZZaddress">Malformed email href</a>
          <a href="tel:0412345678">0412 345 678</a>
        </body>
      `,
      "2026-06-22T00:00:00.000Z",
      200,
    ),
    sourceDocumentId: "55555555-5555-5555-5555-555555555555",
  };
  const enrichment = buildFetchedPageEnrichment(
    agent,
    { ...buildExistingRosterEnrichment(agent, [], "2026-06-22T00:00:00.000Z"), email: null, phone: null },
    [fetched],
    "2026-06-22T00:00:00.000Z",
  );

  assert.equal(enrichment.email, "jane.smith@northstarrealty.com.au");
  assert.equal(enrichment.phone, "0412345678");
  assert.equal(enrichment.contact_evidence.email[0].source_document_id, "55555555-5555-5555-5555-555555555555");
  assert.equal(enrichment.sendability_status, "ready");
});

test("fetched generic team pages do not promote non-agent contact fields", () => {
  const fetched = {
    ...candidateFromFetchedPage(
      agent,
      {
        url: "https://northstarrealty.com.au/team",
        label: "official_team_page",
        scope: "official_team_page_context",
      },
      `
        <title>Northstar Realty Team</title>
        <body>
          <h1>Jane Smith</h1>
          <p>Our sales team includes Jane Smith.</p>
          <a href="mailto:reception@northstarrealty.com.au">Email reception</a>
          <a href="tel:0899991111">08 9999 1111</a>
        </body>
      `,
      "2026-06-22T00:00:00.000Z",
      200,
    ),
    sourceDocumentId: "66666666-6666-6666-6666-666666666666",
  };
  const enrichment = buildFetchedPageEnrichment(
    agent,
    { ...buildExistingRosterEnrichment(agent, [], "2026-06-22T00:00:00.000Z"), email: null, phone: null },
    [fetched],
    "2026-06-22T00:00:00.000Z",
  );

  assert.equal(enrichment.email, null);
  assert.equal(enrichment.phone, null);
  assert.equal(enrichment.contact_evidence?.email, undefined);
  assert.equal(enrichment.sendability_status, "missing_email");
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
  assert.match(schema, /"demirs_wa_licence_register"/);
});
