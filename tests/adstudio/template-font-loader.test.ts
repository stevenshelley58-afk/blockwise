import test from "node:test";
import assert from "node:assert/strict";
import { ensureTemplateFont, templateFontFamily } from "../../src/components/adstudio/editor/layered-canvas";

test("template font loader preserves identity, resolves declared assets and retries failed loads", async () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const priorFontFace = Object.getOwnPropertyDescriptor(globalThis, "FontFace");
  const added: Array<{ family: string; source: string }> = [];
  const attempts: string[] = [];
  let failNext = false;
  class FakeFontFace {
    constructor(public family: string, public source: string) {}
    async load() {
      attempts.push(this.source);
      if (failNext) { failNext = false; throw new Error("offline"); }
      return this;
    }
  }
  Object.defineProperty(globalThis, "document", { configurable: true, value: { fonts: { add: (face: FakeFontFace) => added.push(face) } } });
  Object.defineProperty(globalThis, "FontFace", { configurable: true, value: FakeFontFace });
  try {
    const font = { file: "type/custom.woff2" };
    const assets = { font: { fileName: font.file, mimeType: "font/woff2" } };
    await ensureTemplateFont("test-a", "saved-ad", assets, font);
    await ensureTemplateFont("test-b", "saved-ad", assets, font);
    assert.equal(added[0].family, templateFontFamily("test-a", font.file));
    assert.notEqual(added[0].family, added[1].family);
    assert.notEqual(templateFontFamily("test-a", "type/custom.woff2"), templateFontFamily("test-a", "other/custom.woff2"));
    assert.match(added[0].source, /templates\/test-a\/assets\/font/);
    await ensureTemplateFont("test-a", "saved-ad", assets, font);
    assert.equal(attempts.length, 2);
    failNext = true;
    await assert.rejects(ensureTemplateFont("test-retry", "saved-ad", assets, font), /could not be loaded/);
    await ensureTemplateFont("test-retry", "saved-ad", assets, font);
    assert.equal(attempts.length, 4);
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument); else Reflect.deleteProperty(globalThis, "document");
    if (priorFontFace) Object.defineProperty(globalThis, "FontFace", priorFontFace); else Reflect.deleteProperty(globalThis, "FontFace");
  }
});
