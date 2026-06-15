import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { deriveTemplateSampleStyle, sampleCopyForTemplate } from "../src/lib/adstudio/template-samples.ts";

const seed = JSON.parse(readFileSync("ad-template-library/library-seed.json", "utf8")) as {
  templates: Array<Record<string, unknown>>;
};

// Master suburb list incl. nearby suburbs that appear in regionLists.
const ALL_SUBURBS = [
  "Scarborough","Bicton","Maylands","Cottesloe","Victoria Park","Fremantle","Mount Lawley",
  "Subiaco","Bayswater","North Perth","Claremont","Inglewood","Trigg","Joondalup","Midland",
  "Doubleview","Karrinyup","Attadale","Palmyra","East Fremantle","Mosman Park","Peppermint Grove",
  "Swanbourne","East Victoria Park","Burswood","Lathlain","North Fremantle","Beaconsfield",
  "White Gum Valley","Menora","Highgate","Shenton Park","Daglish","Jolimont","Embleton","Morley",
  "Leederville","Nedlands","Mount Claremont","Bedford","North Beach","Edgewater","Connolly",
  "Currambine","Bellevue","Viveash","Woodbridge",
];

test("resolved sample copy never references a suburb outside its persona region", () => {
  for (const template of seed.templates) {
    const style = deriveTemplateSampleStyle(template);
    const copy = sampleCopyForTemplate(template, style);
    const persona = style.persona;
    assert.ok(persona, `no persona for ${String(template.template_key)}`);
    const own = new Set([persona!.suburb, ...persona!.region]);
    const blob = [copy?.headline, copy?.primaryText, copy?.description, copy?.cta].join(" ");
    for (const suburb of ALL_SUBURBS) {
      if (own.has(suburb)) continue;
      assert.ok(
        !new RegExp(`\\b${suburb}\\b`).test(blob),
        `${String(template.template_key)} (persona ${persona!.suburb}) leaks foreign suburb "${suburb}": ${blob}`,
      );
    }
    assert.doesNotMatch(blob, /\{\{[^}]+\}\}/, `${String(template.template_key)} has unresolved tokens`);
  }
});
