"use client";

// V2EditorStage (Track A, §7): mounts MetaFrame → EditorRoot for a v2
// creative. Fetches the repo-versioned template doc, autosaves instance
// mutations through /doc (server re-render + CAS revision). The MetaFrame
// chrome shows the ad exactly as Meta would, with live copy bindings driven
// by the instance's text values.

import { useCallback, useEffect, useRef, useState } from "react";

import type { AdStudioBrandKit } from "@/lib/adstudio";
import { labelForMetaCta } from "@/lib/adstudio/meta-cta.ts";
import type { AdDocInstance, AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc";

import { MetaFrame } from "../meta-frame/meta-frame";
import { EditorRoot } from "./editor-root";

export function V2EditorStage({
  creativeId,
  instance,
  activeRevisionId,
  brandKit,
  brandPalette,
  onSaved,
}: {
  creativeId: string;
  instance: AdDocInstance;
  activeRevisionId: string | null;
  brandKit: AdStudioBrandKit;
  brandPalette: string[];
  onSaved?: (saved: { instance: AdDocInstance; activeRevisionId: string }) => void;
}) {
  const [template, setTemplate] = useState<AdTemplateDocV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderPaths, setRenderPaths] = useState(instance.renders ?? {});
  const revisionIdRef = useRef<string | null>(activeRevisionId);
  const onSavedRef = useRef(onSaved);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    revisionIdRef.current = activeRevisionId;
  }, [activeRevisionId]);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/adstudio/templates-v2/${instance.templateId}?hash=${encodeURIComponent(instance.templateHash)}&creativeId=${encodeURIComponent(creativeId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error((await response.json().catch(() => ({}))).error ?? "Template unavailable.");
        }
        return (await response.json()) as AdTemplateDocV2;
      })
      .then((loaded) => {
        if (!cancelled) setTemplate(loaded);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Template unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [creativeId, instance.templateHash, instance.templateId]);

  const saveInstance = useCallback((next: AdDocInstance) => {
    const save = saveQueueRef.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/adstudio/creatives/${creativeId}/doc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutationId: crypto.randomUUID(),
          expectedRevisionId: revisionIdRef.current,
          instance: next,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        revisionId?: string;
        renders?: { feed?: string; story?: string };
        error?: string;
      };
      if (!response.ok || !payload.revisionId) throw new Error(payload.error ?? "Save failed.");
      revisionIdRef.current = payload.revisionId;
      const savedInstance: AdDocInstance = {
        ...next,
        renders: { ...next.renders, ...payload.renders },
      };
      setRenderPaths(savedInstance.renders ?? {});
      onSavedRef.current?.({ instance: savedInstance, activeRevisionId: payload.revisionId });
    });
    saveQueueRef.current = save.catch(() => undefined);
    return save;
  }, [creativeId]);

  if (error) return <p className="p-4 text-sm text-[var(--danger,#e5484d)]">{error}</p>;
  if (!template) return <p className="p-4 text-sm text-[var(--muted,#8a94a3)]">Loading template…</p>;

  // Live copy bindings: declared text inputs in order drive the chrome copy;
  // the CTA comes from the template's publish block (real enum label).
  const textValues = template.inputs.text.map((input) => instance.values.text[input.key] ?? input.sample);
  const copy = {
    primaryText: textValues[0] ?? template.publish.copy.primaryText[0] ?? "",
    headline: textValues[1] ?? template.publish.copy.headlines[0] ?? "",
    description: template.publish.copy.descriptions[0] ?? "",
    cta: labelForMetaCta(template.publish.cta ?? "LEARN_MORE"),
  };

  return (
    <MetaFrame
      brandKit={brandKit}
      copy={copy}
      placement={instance.format === "9:16" ? "ig-story" : "fb-feed-mobile"}
    >
      <EditorRoot
        template={template}
        instance={instance}
        brandPalette={brandPalette}
        renderSrcByFormat={{
          ...(renderPaths.feed ? { "4:5": `/api/adstudio/media?path=${encodeURIComponent(renderPaths.feed)}` } : {}),
          ...(renderPaths.story ? { "9:16": `/api/adstudio/media?path=${encodeURIComponent(renderPaths.story)}` } : {}),
        }}
        onSave={saveInstance}
      />
    </MetaFrame>
  );
}
