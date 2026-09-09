import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = path => readFileSync(path, "utf8");

describe("Ad Studio direct-edit contract", () => {
  it("emits logical targets only for customer-editable creative layers", () => {
    const target = read("src/components/adstudio/editor/editor-target.ts");
    const canvas = read("src/components/adstudio/editor/layered-canvas.tsx");

    assert.match(target, /type: "text" \| "image_slot" \| "logo"/);
    assert.match(target, /layerId: string/);
    assert.match(target, /inputKey: string/);
    assert.match(target, /colourRole\?: ColourRole/);
    assert.match(target, /if \(layer\.type === "text"\)/);
    assert.match(target, /layer\.type === "image_slot" \|\| layer\.type === "logo"/);
    assert.match(target, /return null/);
    assert.match(canvas, /onTargetSelect\?: \(target: EditorLayerTarget\) => void/);
    assert.match(canvas, /if \(onTargetSelectRef\.current\) onTargetSelectRef\.current\(logicalTarget\)/);
    assert.match(canvas, /if \(editorTargetForLayer\(layer\)\) nextTargetIds\.set/);
    assert.doesNotMatch(canvas, /onCropRef|onCropRef\.current/);

    const vectors = canvas.slice(canvas.indexOf('if (layer.type === "vector")'), canvas.indexOf('if (layer.type === "icon")'));
    const icons = canvas.slice(canvas.indexOf('if (layer.type === "icon")'), canvas.indexOf("const src ="));
    assert.doesNotMatch(vectors, /\.\.\.interactive/);
    assert.doesNotMatch(icons, /\.\.\.interactive/);
    assert.match(vectors, /\.\.\.passive/);
    assert.match(icons, /\.\.\.passive/);
  });

  it("changes Fabric selection without rebuilding every creative object", () => {
    const canvas = read("src/components/adstudio/editor/layered-canvas.tsx");
    const renderEffectEnd = canvas.indexOf("useEffect(() => {", canvas.indexOf("const render = async"));
    const renderEffect = canvas.slice(canvas.indexOf("const render = async"), renderEffectEnd);

    assert.match(canvas, /const selectedLayerIdRef = useRef\(selectedLayerId\)/);
    assert.match(canvas, /selectedLayerIdRef\.current = selectedLayerId/);
    assert.match(renderEffect, /\[colours, cropOverrides, existingAdId, imageValues, layout, templateId, ready, textValues\]/);
    assert.doesNotMatch(renderEffect, /ready, selectedLayerId/);
    assert.match(canvas, /\[ready, selectedLayerId\]/);
  });

  it("focuses and visibly selects the matching Content control", () => {
    const inputs = read("src/components/adstudio/editor/inputs-panel.tsx");

    assert.match(inputs, /activeInputKey\?: string \| null/);
    assert.match(inputs, /focusRequest\?: \{ inputKey: string; requestId: string \| number \} \| null/);
    assert.match(inputs, /onFieldFocus\?: \(key: string\) => void/);
    assert.match(inputs, /optionalDetailsRef\.current\.open = true/);
    assert.match(inputs, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
    assert.match(inputs, /target\.scrollIntoView\(\{ behavior: reduceMotion \? "auto" : "smooth", block: "center" \}\)/);
    assert.match(inputs, /target\.focus\(\{ preventScroll: true \}\)/);
    assert.match(inputs, /onFocus=\{\(\) => onFieldFocus\?\.\(input\.key\)\}/);
    assert.match(inputs, /onFocusCapture=\{onFieldFocus\}/);
    assert.ok((inputs.match(/data-active=\{active \|\| undefined\}/g) ?? []).length >= 2);
    assert.match(inputs, /active && "bg-primary\/5 ring-2 ring-primary\/35"/);
    assert.ok((inputs.match(/ref=\{setFocusTarget\}/g) ?? []).length >= 2);
  });

  it("makes each rendered Meta copy field an accessible edit hotspot", () => {
    const preview = read("src/components/adstudio/editor/meta-placement-preview.tsx");

    for (const [field, label] of [
      ["primaryText", "Edit primary text"],
      ["headline", "Edit headline"],
      ["description", "Edit description"],
      ["cta", "Edit call to action"],
    ]) {
      assert.match(preview, new RegExp(`aria-label="${label}"[\\s\\S]*?onClick=\\{\\(\\) => onEditField\\?\\.\\("${field}"\\)\\}`));
    }
    assert.ok((preview.match(/type="button"/g) ?? []).length >= 5);
    assert.match(preview, /focus-visible:ring-2 focus-visible:ring-\[#1877f2\]/);
    assert.match(preview, /active && "ring-2 ring-\[#1877f2\] ring-offset-2"/);
    assert.doesNotMatch(preview, /<span className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-white/);
  });

  it("wires preview hotspots to the matching inspector controls", () => {
    const shell = read("src/components/adstudio/editor/editor-shell.tsx");
    const metaCopy = read("src/components/adstudio/editor/meta-copy-panel.tsx");

    assert.match(shell, /onTargetSelect=\{openInspectorForTarget\}/);
    assert.match(shell, /onEditField=\{field => openInspectorForTarget\(\{ kind: "meta", field \}\)\}/);
    assert.match(shell, /activeInputKey=\{activeTarget\?\.kind === "layer" \? activeTarget\.inputKey : null\}/);
    assert.match(shell, /contentFocusRequest=\{activeTarget\?\.kind === "layer"/);
    assert.match(shell, /activeField=\{activeTarget\?\.kind === "meta" \? activeTarget\.field : null\}/);
    assert.match(shell, /metaFocusRequest=\{activeTarget\?\.kind === "meta"/);
    assert.match(metaCopy, /target\.scrollIntoView/);
    assert.match(metaCopy, /target\.focus\(\{ preventScroll: true \}\)/);
    assert.match(metaCopy, /onFocus=\{onFocus\}/);
  });
});
