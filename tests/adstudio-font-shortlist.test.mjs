import assert from "node:assert/strict";
import test from "node:test";

import { rankShortlistCandidates } from "../scripts/build/font-corpus/shortlist-candidates.mjs";

function face(weight, { thickness = 5, width = 7 } = {}) {
  return {
    weight,
    italic: false,
    thickness,
    width,
    ttfUrl: "https://example.test/font.ttf",
    woff2Url: "https://example.test/font.woff2",
    lineHeight: 1.2,
  };
}

function family(id, category, options = {}) {
  return {
    family: id,
    id,
    category,
    classifications: options.classifications ?? [],
    popularity: options.popularity ?? 1,
    faces: [face(options.weight ?? 400, options)],
  };
}

test("shortlist reserves measured serif and display coverage against a popularity-heavy sans corpus", () => {
  const sans = Array.from({ length: 60 }, (_, index) => family(`sans-${index}`, "Sans Serif", {
    popularity: index + 1,
    weight: 400,
    thickness: 5,
    width: 7,
  }));
  const families = [
    ...sans,
    family("measured-serif", "Serif", { popularity: 500, weight: 400, thickness: 5, width: 7 }),
    family("measured-display", "Serif", {
      classifications: ["Display"], popularity: 600, weight: 400, thickness: 5, width: 7,
    }),
  ];
  const result = rankShortlistCandidates({ strokeToHeightRatio: 0.055, glyphHeightPx: 100, widthPerChar: 58 }, families, { limit: 12 });
  assert.equal(result.candidates.length, 12);
  assert.ok(result.candidates.some((candidate) => candidate.id === "measured-serif"));
  assert.ok(result.candidates.some((candidate) => candidate.id === "measured-display"));
});

test("shortlist uses available width metadata before popularity when the profile has a width measurement", () => {
  const families = [
    family("popular-narrow", "Serif", { popularity: 1, weight: 400, thickness: 5, width: 4 }),
    family("measured-wide", "Serif", { popularity: 1000, weight: 400, thickness: 5, width: 7 }),
  ];
  const result = rankShortlistCandidates({ strokeToHeightRatio: 0.055, glyphHeightPx: 100, widthPerChar: 58 }, families, { limit: 2 });
  assert.equal(result.targetWidth, 7);
  assert.equal(result.candidates[0].id, "measured-wide");
});

test("shortlist keeps representative handwriting candidates without letting them crowd out text categories", () => {
  const handwriting = Array.from({ length: 30 }, (_, index) => family(`script-${index}`, "Handwriting", {
    popularity: index + 1, weight: 400, thickness: 5, width: 7,
  }));
  const result = rankShortlistCandidates(
    { strokeToHeightRatio: 0.055, glyphHeightPx: 100, widthPerChar: 58 },
    [...handwriting, ...Array.from({ length: 30 }, (_, index) => family(`sans-${index}`, "Sans Serif"))],
    { limit: 20 },
  );
  assert.ok(result.candidates.filter((candidate) => candidate.category === "Handwriting").length <= 2);
  assert.ok(result.candidates.some((candidate) => candidate.category === "Sans Serif"));
});
