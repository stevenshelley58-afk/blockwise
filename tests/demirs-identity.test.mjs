import assert from "node:assert/strict";
import test from "node:test";

import { resolveDemirsIdentity } from "../scripts/research/demirs-identity.mjs";

const agency = (name, licence, entity, extra = {}) => ({
  normalized_name: name,
  licence_number: licence,
  metadata: { demirs_wa_licence_register: { entity_id: entity }, ...extra },
});

test("same licence matches a renamed agency", () => {
  const row = agency("old agency", "RA-1", "E-1");
  const result = resolveDemirsIdentity({ normalized_name: "new agency", licence_number: "RA-1", metadata: { demirs_wa_licence_register: { entity_id: "E-1" } } }, [row]);
  assert.equal(result.status, "matched");
  assert.equal(result.row, row);
});

test("same name with a different licence is ambiguous", () => {
  const result = resolveDemirsIdentity({ normalized_name: "same agency", licence_number: "RA-2", metadata: { demirs_wa_licence_register: { entity_id: "E-2" } } }, [agency("same agency", "RA-1", "E-1")]);
  assert.equal(result.status, "ambiguous");
});

test("multiple stable matches are ambiguous", () => {
  const result = resolveDemirsIdentity({ normalized_name: "agency", licence_number: "RA-1", metadata: { demirs_wa_licence_register: { entity_id: "E-1" } } }, [agency("agency one", "RA-1", "E-1"), agency("agency two", "RA-1", "E-1")]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.reason, "multiple_stable_identity_matches");
});

test("stable identity absent with no same name is missing", () => {
  const result = resolveDemirsIdentity({ normalized_name: "new agency", licence_number: "RA-9", metadata: { demirs_wa_licence_register: { entity_id: "E-9" } } }, []);
  assert.equal(result.status, "missing");
});

test("missing stable identity never name-merges", () => {
  const result = resolveDemirsIdentity({ normalized_name: "same agency" }, [agency("same agency", "RA-1", "E-1")]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.reason, "missing_stable_identity");
});

test("entity match with reused licence is rejected as contradictory", () => {
  const result = resolveDemirsIdentity({ normalized_name: "agency", licence_number: "RA-2", metadata: { demirs_wa_licence_register: { entity_id: "E-1" } } }, [agency("agency", "RA-1", "E-1")]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.reason, "contradictory_stable_identity");
});
