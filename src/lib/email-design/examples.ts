// Fictional review content. Never import this module into a sending integration.
import examples from "./catalog-examples.json" with { type: "json" };
import notificationExamples from "./notification-examples.json" with { type: "json" };
import { buildTemplate, requiredVariables, type TemplateValues } from "./catalog.ts";
import type { EmailColorMode } from "./renderer.ts";
export const EXAMPLE_STATE_LABELS = { standard: "With activity", quiet: "No new leads", delayed: "Reporting delayed" };
export type ExampleState = keyof typeof EXAMPLE_STATE_LABELS;
const notifications = notificationExamples as Record<string, Partial<Record<ExampleState, TemplateValues>>>;
export function exampleStates(id: string): ExampleState[] {
  return Object.keys(notifications[id] ?? { standard: {} }) as ExampleState[];
}
export function exampleVariables(id: string, state: ExampleState = "standard"): TemplateValues {
  if (!exampleStates(id).includes(state)) throw new Error(`Unknown example state for ${id}: ${state}`);
  const scoped = notifications[id];
  const data = { ...examples, ...scoped?.standard, ...scoped?.[state] } as TemplateValues;
  const base = Object.fromEntries(requiredVariables(id).map(key => [key, data[key]])) as TemplateValues;
  if (state === "standard") {
    if (data.chart !== undefined) base.chart = structuredClone(data.chart) as TemplateValues["chart"];
    if (data.ad_previews !== undefined) base.ad_previews = structuredClone(data.ad_previews) as TemplateValues["ad_previews"];
  } else {
    base.chart = undefined;
    base.ad_previews = undefined;
  }
  return structuredClone(base);
}
export function renderExample(id: string, colorMode: EmailColorMode = "system", state: ExampleState = "standard") {
  return buildTemplate(id, exampleVariables(id, state), { mode: "preview", colorMode });
}
