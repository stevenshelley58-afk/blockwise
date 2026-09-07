// Fictional review content. Never import this module into a sending integration.
import examples from "./catalog-examples.json" with { type: "json" };
import { buildTemplate, requiredVariables, type TemplateValues } from "./catalog.ts";
import type { EmailColorMode } from "./renderer.ts";
export function exampleVariables(id: string): TemplateValues {
  const data = examples as TemplateValues;
  return structuredClone(Object.fromEntries(requiredVariables(id).map(key => [key, data[key]])));
}
export function renderExample(id: string, colorMode: EmailColorMode = "system") {
  return buildTemplate(id, exampleVariables(id), { mode: "preview", colorMode });
}
