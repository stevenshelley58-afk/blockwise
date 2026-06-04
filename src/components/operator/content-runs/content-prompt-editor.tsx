"use client";

import { Play, Save } from "lucide-react";
import { useState } from "react";

import { StatusPill } from "@/components/status-pill";
import type { PromptSetRow, PromptTemplateRow } from "@/lib/content-engine";

type ContentPromptEditorProps = {
  promptSets: PromptSetRow[];
  promptTemplates: PromptTemplateRow[];
};

export function ContentPromptEditor({ promptSets, promptTemplates }: ContentPromptEditorProps) {
  const [templates, setTemplates] = useState(promptTemplates);
  const [selectedId, setSelectedId] = useState(promptTemplates[0]?.id ?? "");
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0];
  const [body, setBody] = useState(selected?.template_body ?? "");
  const [message, setMessage] = useState("");
  const grouped = groupBySkill(templates);

  function chooseTemplate(id: string) {
    const next = templates.find((template) => template.id === id);
    setSelectedId(id);
    setBody(next?.template_body ?? "");
    setMessage("");
  }

  async function saveVersion() {
    if (!selected) return;
    setMessage("Saving new version...");
    try {
      const response = await fetch(`/api/operator/content-prompts/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "version", templateBody: body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Prompt save failed.");
      }
      const payload = (await response.json()) as { template: PromptTemplateRow };
      setTemplates((current) => [payload.template, ...current]);
      setSelectedId(payload.template.id);
      setBody(payload.template.template_body);
      setMessage("New draft version saved. Activate it to use it in future runs.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prompt save failed.");
    }
  }

  async function setStatus(status: "active" | "locked" | "archived" | "draft") {
    if (!selected) return;
    setMessage(`Setting ${status}...`);
    try {
      const response = await fetch(`/api/operator/content-prompts/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", status }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Prompt status update failed.");
      }
      setTemplates((current) =>
        current.map((template) => (template.id === selected.id ? { ...template, status } : template)),
      );
      setMessage(status === "active" ? "Prompt activated for future runs." : `Prompt marked ${status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prompt status update failed.");
    }
  }

  async function testPrompt() {
    if (!selected) return;
    setMessage("Testing prompt...");
    try {
      const response = await fetch(`/api/operator/content-prompts/${selected.id}/test`, { method: "POST" });
      const payload = (await response.json()) as { output?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Prompt test failed.");
      setMessage(JSON.stringify(payload.output, null, 2));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prompt test failed.");
    }
  }

  return (
    <div className="content-prompt-layout">
      <aside className="panel content-prompt-list">
        <h2>Prompt Sets</h2>
        {promptSets.map((set) => (
          <article className="item-card content-prompt-set" key={set.id}>
            <h3>{set.name}</h3>
            <p className="item-meta">{set.description}</p>
            <StatusPill tone={set.status === "active" ? "green" : "amber"}>{set.status}</StatusPill>
          </article>
        ))}
        <h2>Templates</h2>
        {Object.entries(grouped).map(([skill, templates]) => (
          <div className="content-prompt-group" key={skill}>
            <strong>{skill.replace(/^blockwise-/u, "")}</strong>
            {templates.map((template) => (
              <button
                className={template.id === selected?.id ? "content-prompt-row active" : "content-prompt-row"}
                type="button"
                key={template.id}
                onClick={() => chooseTemplate(template.id)}
              >
                v{template.version} · {template.status}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <main className="panel content-prompt-editor">
        {selected ? (
          <>
            <div className="row-between">
              <div>
                <h2>{selected.name}</h2>
                <p className="item-meta">{selected.skill_name} · version {selected.version}</p>
              </div>
              <StatusPill tone={selected.status === "active" ? "green" : selected.status === "locked" ? "blue" : "amber"}>
                {selected.status}
              </StatusPill>
            </div>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} spellCheck={false} />
            <div className="actions">
              <button className="button" type="button" onClick={() => void saveVersion()}>
                <Save aria-hidden size={16} />
                Save version
              </button>
              <button className="button secondary" type="button" onClick={() => void testPrompt()}>
                <Play aria-hidden size={16} />
                Test
              </button>
              <button className="button secondary" type="button" onClick={() => void setStatus("active")}>Activate</button>
              <button className="button secondary" type="button" onClick={() => void setStatus("locked")}>Lock</button>
              <button className="button secondary" type="button" onClick={() => void setStatus("draft")}>Draft</button>
            </div>
            {message ? <pre className="content-prompt-message" aria-live="polite">{message}</pre> : null}
          </>
        ) : (
          <p>No prompt templates were found. Run the content engine migration.</p>
        )}
      </main>
    </div>
  );
}

function groupBySkill(templates: PromptTemplateRow[]): Record<string, PromptTemplateRow[]> {
  return templates.reduce<Record<string, PromptTemplateRow[]>>((groups, template) => {
    groups[template.skill_name] = [...(groups[template.skill_name] ?? []), template];
    return groups;
  }, {});
}
