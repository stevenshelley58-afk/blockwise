import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

type AgentSourceRow = {
  enabled?: unknown;
  state?: unknown;
  type?: unknown;
};

let enabledCensusSourceStatesCache: Set<string> | null = null;
const requireJson = createRequire(import.meta.url);

export function hasEnabledCensusSourceForState(state: string | null | undefined): boolean {
  const code = String(state || "WA").trim().toUpperCase();
  return enabledCensusSourceStates().has(code);
}

function enabledCensusSourceStates(): Set<string> {
  if (enabledCensusSourceStatesCache) return enabledCensusSourceStatesCache;

  const enabledAgentRosterStates = readAgentSources()
    .flatMap((source) => {
      if (source.enabled === false || source.type !== "agent_roster" || typeof source.state !== "string") return [];
      const state = source.state.trim().toUpperCase();
      return state ? [state] : [];
    });
  const customTemplateStates = sourceUrlTemplates().length > 0 ? targetStates() : [];

  enabledCensusSourceStatesCache = new Set([...enabledAgentRosterStates, ...customTemplateStates]);
  return enabledCensusSourceStatesCache;
}

function readAgentSources(): AgentSourceRow[] {
  if (process.env.HERMES_AGENT_SOURCES_PATH) {
    try {
      const parsed = JSON.parse(readFileSync(process.env.HERMES_AGENT_SOURCES_PATH, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { sources?: unknown }).sources)) {
        return (parsed as { sources: AgentSourceRow[] }).sources;
      }
    } catch {
      // Fall back to the bundled source roster.
    }
  }

  try {
    const parsed = requireJson("../../../hermes/data/agent-sources.json") as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { sources?: unknown }).sources)) {
      return (parsed as { sources: AgentSourceRow[] }).sources;
    }
  } catch {
    return [{ id: "reiwa_agent_finder", state: "WA", enabled: true, type: "agent_roster" } as AgentSourceRow];
  }

  return [{ id: "reiwa_agent_finder", state: "WA", enabled: true, type: "agent_roster" } as AgentSourceRow];
}

function sourceUrlTemplates(): string[] {
  return uniqueCsv(process.env.HERMES_CENSUS_SOURCE_URL_TEMPLATES);
}

function targetStates(): string[] {
  return uniqueCsv(process.env.HERMES_RESEARCH_TARGET_STATES).map((state) => state.toUpperCase());
}

function uniqueCsv(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((part) => part.trim()).filter(Boolean))];
}
