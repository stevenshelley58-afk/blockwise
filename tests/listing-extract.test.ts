import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingBrief,
  buildListingSlug,
  extractJsonLd,
  extractOgMeta,
  isAustralianDomain,
  mapJsonLdToListingData,
  mapListingToOnImageCopy,
  type ListingData,
} from "../src/lib/adstudio/listing-extract.ts";
import type { TemplateCopyRequirement } from "../src/components/adstudio/new-ad-dialog-slots.ts";

// ---------------------------------------------------------------------------
// isAustralianDomain
// ---------------------------------------------------------------------------

test("isAustralianDomain accepts .com.au", () => {
  assert.equal(isAustralianDomain("www.realestate.com.au"), true);
  assert.equal(isAustralianDomain("domain.com.au"), true);
});

test("isAustralianDomain accepts .au", () => {
  assert.equal(isAustralianDomain("myagency.au"), true);
});

test("isAustralianDomain accepts .net.au and .org.au", () => {
  assert.equal(isAustralianDomain("foo.net.au"), true);
  assert.equal(isAustralianDomain("bar.org.au"), true);
});

test("isAustralianDomain rejects .com", () => {
  assert.equal(isAustralianDomain("realestate.com"), false);
  assert.equal(isAustralianDomain("zillow.com"), false);
});

test("isAustralianDomain rejects .co.uk", () => {
  assert.equal(isAustralianDomain("rightmove.co.uk"), false);
});

// ---------------------------------------------------------------------------
// extractJsonLd
// ---------------------------------------------------------------------------

test("extractJsonLd parses a single JSON-LD block", () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Residence","name":"Test"}</script></head></html>`;
  const result = extractJsonLd(html);
  assert.equal(result.length, 1);
  assert.equal(result[0]["@type"], "Residence");
  assert.equal(result[0]["name"], "Test");
});

test("extractJsonLd parses multiple blocks", () => {
  const html = `<script type="application/ld+json">{"@type":"WebSite"}</script><script type="application/ld+json">{"@type":"Residence"}</script>`;
  const result = extractJsonLd(html);
  assert.equal(result.length, 2);
});

test("extractJsonLd handles @graph arrays", () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"Residence","name":"A"},{"@type":"WebSite"}]}</script>`;
  const result = extractJsonLd(html);
  // Wrapper object + 2 inner @graph items
  assert.equal(result.length, 3);
  assert.equal(result[1]["name"], "A");
  assert.equal(result[2]["@type"], "WebSite");
});

test("extractJsonLd skips malformed JSON", () => {
  const html = `<script type="application/ld+json">{broken json}</script>`;
  const result = extractJsonLd(html);
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// extractOgMeta
// ---------------------------------------------------------------------------

test("extractOgMeta extracts og:image, og:title, og:description", () => {
  const html = `
    <meta property="og:image" content="https://cdn.example.com/photo.jpg" />
    <meta property="og:title" content="18 Tallow Lane, Scarborough" />
    <meta property="og:description" content="Beautiful 3 bed house near the beach." />
  `;
  const result = extractOgMeta(html);
  assert.deepEqual(result.photos, ["https://cdn.example.com/photo.jpg"]);
  assert.equal(result.address, "18 Tallow Lane, Scarborough");
  assert.equal(result.description, "Beautiful 3 bed house near the beach.");
});

test("extractOgMeta returns empty for no meta tags", () => {
  const result = extractOgMeta("<html><body>No meta</body></html>");
  assert.equal(result.photos, undefined);
  assert.equal(result.address, undefined);
});

// ---------------------------------------------------------------------------
// mapJsonLdToListingData
// ---------------------------------------------------------------------------

test("mapJsonLdToListingData maps a Residence schema", () => {
  const jsonLd = [
    {
      "@type": "Residence",
      name: "18 Tallow Lane",
      address: {
        "@type": "PostalAddress",
        streetAddress: "18 Tallow Lane",
        addressLocality: "Scarborough",
        addressRegion: "WA",
        postalCode: "6019",
      },
      numberOfRooms: 3,
      numberOfBathroomsTotal: 2,
      numberOfParkingSpaces: 1,
      description: "A renovated family home steps from the beach.",
      image: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
      offers: { price: "650000", priceCurrency: "AUD" },
      agent: { name: "John Smith", telephone: "0412 345 678" },
    },
  ];
  const result = mapJsonLdToListingData(jsonLd, "https://realestate.com.au/x");
  assert.ok(result);
  assert.equal(result.address, "18 Tallow Lane");
  assert.equal(result.suburb, "Scarborough");
  assert.equal(result.state, "WA");
  assert.equal(result.postcode, "6019");
  assert.equal(result.bedrooms, 3);
  assert.equal(result.bathrooms, 2);
  assert.equal(result.parking, 1);
  assert.equal(result.price, "$650000");
  assert.deepEqual(result.photos, ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"]);
  assert.equal(result.agentName, "John Smith");
  assert.equal(result.agentPhone, "0412 345 678");
});

test("mapJsonLdToListingData returns null for non-listing types", () => {
  const jsonLd = [{ "@type": "WebSite", name: "Example" }];
  const result = mapJsonLdToListingData(jsonLd, "https://example.com");
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// buildListingBrief
// ---------------------------------------------------------------------------

test("buildListingBrief composes a readable brief", () => {
  const data: ListingData = {
    address: "18 Tallow Lane",
    suburb: "Scarborough",
    state: "WA",
    postcode: "6019",
    price: "$650,000",
    bedrooms: 3,
    bathrooms: 2,
    parking: 1,
    propertyType: "House",
    landSize: null,
    description: "",
    features: ["Pool", "Renovated kitchen"],
    photos: [],
    agentName: null,
    agencyName: null,
    agentPhone: null,
    inspectionTimes: ["Saturday 10:30am"],
    sourceUrl: "https://realestate.com.au/x",
  };
  const brief = buildListingBrief(data);
  assert.ok(brief.includes("3 bed"));
  assert.ok(brief.includes("2 bath"));
  assert.ok(brief.includes("1 car"));
  assert.ok(brief.includes("house"));
  assert.ok(brief.includes("18 Tallow Lane"));
  assert.ok(brief.includes("Scarborough"));
  assert.ok(brief.includes("$650,000"));
  assert.ok(brief.includes("Pool"));
  assert.ok(brief.includes("Saturday 10:30am"));
});

// ---------------------------------------------------------------------------
// mapListingToOnImageCopy
// ---------------------------------------------------------------------------

test("mapListingToOnImageCopy matches fields by keyword", () => {
  const data: ListingData = {
    address: "18 Tallow Lane",
    suburb: "Scarborough",
    state: "WA",
    postcode: "6019",
    price: "$650,000",
    bedrooms: 3,
    bathrooms: 2,
    parking: 1,
    propertyType: "House",
    landSize: null,
    description: "",
    features: [],
    photos: [],
    agentName: "John Smith",
    agencyName: null,
    agentPhone: "0412 345 678",
    inspectionTimes: [],
    sourceUrl: "https://realestate.com.au/x",
  };
  const fields: TemplateCopyRequirement[] = [
    { key: "address", label: "Property address", maxLength: 60, required: true, sample: "123 Main St" },
    { key: "price", label: "Price guide", maxLength: 30, required: true, sample: "$500K" },
    { key: "phone", label: "Phone", maxLength: 20, required: false, sample: "0400 000 000" },
    { key: "suburb", label: "Suburb", maxLength: 30, required: false, sample: "Suburb" },
  ];
  const result = mapListingToOnImageCopy(data, fields);
  assert.equal(result["address"], "18 Tallow Lane");
  assert.equal(result["price"], "$650,000");
  assert.equal(result["phone"], "0412 345 678");
  assert.equal(result["suburb"], "Scarborough WA 6019");
});

test("mapListingToOnImageCopy respects maxLength", () => {
  const data: ListingData = {
    address: "A very long address that exceeds the field limit significantly",
    suburb: "",
    state: "",
    postcode: "",
    price: "",
    bedrooms: null,
    bathrooms: null,
    parking: null,
    propertyType: "",
    landSize: null,
    description: "",
    features: [],
    photos: [],
    agentName: null,
    agencyName: null,
    agentPhone: null,
    inspectionTimes: [],
    sourceUrl: "",
  };
  const fields: TemplateCopyRequirement[] = [
    { key: "address", label: "Address", maxLength: 10, required: true, sample: "" },
  ];
  const result = mapListingToOnImageCopy(data, fields);
  assert.ok(result["address"].length <= 10);
});

// ---------------------------------------------------------------------------
// buildListingSlug
// ---------------------------------------------------------------------------

test("buildListingSlug creates a kebab-case slug", () => {
  const data: ListingData = {
    address: "18 Tallow Lane",
    suburb: "Scarborough",
    state: "WA",
    postcode: "6019",
    price: "",
    bedrooms: null,
    bathrooms: null,
    parking: null,
    propertyType: "",
    landSize: null,
    description: "",
    features: [],
    photos: [],
    agentName: null,
    agencyName: null,
    agentPhone: null,
    inspectionTimes: [],
    sourceUrl: "",
  };
  const slug = buildListingSlug(data);
  assert.ok(slug.startsWith("18-tallow-lane-scarborough-"));
  assert.ok(/^\d{8}$/.test(slug.slice(-8)));
});
