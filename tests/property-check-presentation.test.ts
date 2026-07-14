import assert from "node:assert/strict";
import test from "node:test";

import { buildPropertySnapshot } from "../src/lib/property-check/presentation.ts";

test("property snapshot exposes only useful planning details from the facts envelope", () => {
  const snapshot = buildPropertySnapshot({
    facts: {
      zone: [
        { code: "Residential", label: "Residential" },
        { code: "Local road", label: "Local road" },
        { code: "Residential", label: "Residential" },
      ],
      parcel: { parcel_id: "1585727", verification_status: "verified" },
      r_code: { code: "R20", label: "Residential Design Code RR20" },
      address: {
        gnaf_pid: "GAWA_161989526",
        lot_area_m2: { unit: "m2", value: 592.4726735 },
      },
    },
    address: "5 BLACK SWAN RISE BEELIAR WA 6164",
    source_coverage: "source_cited",
    client_situation: "general",
    local_government: "City of Cockburn",
    resolution_status: "resolved",
  });

  assert.deepEqual(snapshot, [
    { label: "Zones and reserves", value: "Residential, Local road" },
    { label: "R-code", value: "R20" },
    { label: "Lot area", value: "592.5 m²" },
    { label: "Local government", value: "City of Cockburn" },
  ]);
  assert.equal(JSON.stringify(snapshot).includes("1585727"), false);
  assert.equal(JSON.stringify(snapshot).includes("source_cited"), false);
});

test("property snapshot omits internal metadata when no curated details are available", () => {
  assert.deepEqual(
    buildPropertySnapshot({
      facts: { parcel: { parcel_id: "1585727" } },
      source_coverage: "source_cited",
      resolution_status: "resolved",
    }),
    [],
  );
});
