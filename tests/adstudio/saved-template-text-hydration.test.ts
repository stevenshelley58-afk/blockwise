import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

import { hydrateSavedEditorTextValues } from "../../src/lib/adstudio/editor-text-values.ts";

it("hydrates omitted saved values from template copy while keeping stored defaults compact", () => {
  const hydrated = hydrateSavedEditorTextValues(
    [
      { key: "kicker", placeholder: "NEW TO MARKET" },
      { key: "headline", placeholder: "JUST LISTED" },
      { key: "brand", placeholder: "YOUR BRAND" },
    ],
    { headline: "  Open Saturday  " },
    { brand: "AUTHORED BRAND" },
  );

  assert.deepEqual(hydrated, {
    kicker: "NEW TO MARKET",
    headline: "  Open Saturday  ",
    brand: "AUTHORED BRAND",
  });

  const stateSource = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
  assert.match(
    stateSource,
    /textValues: hydrateSavedEditorTextValues\([\s\S]*?editorTextInputs\(pack\),[\s\S]*?initialDocument\.sharedTextValues,[\s\S]*?base\.textValues/,
  );
  assert.match(
    stateSource,
    /trimmed\.length > 0 && trimmed !== \(placeholders\.get\(key\) \?\? ""\)\.trim\(\)/,
  );
});
