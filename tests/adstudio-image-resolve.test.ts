import assert from "node:assert/strict";
import test from "node:test";

import { resolveAdStudioImageForModel } from "../src/lib/adstudio/resolve-image-for-model.ts";

test("Ad Studio rasterizes SVG brand assets before provider upload", async () => {
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='black'/></svg>").toString("base64");
  const resolved = await resolveAdStudioImageForModel({} as never, "workspace_test", svg);
  assert.match(resolved ?? "", /^data:image\/png;base64,/u);
});
