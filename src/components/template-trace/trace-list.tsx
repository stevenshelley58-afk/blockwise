"use client";

import { ChevronRight, Images, Type } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { StatusPill } from "@/components/status-pill";

export type TraceListTemplate = {
  id: string;
  name: string;
  format: string;
  classification: {
    ad_type: string;
    primary_intent: string;
    property_or_agent_focus: string;
  };
  thumbnailSrc: string;
  imageInputCount: number;
  textInputCount: number;
  hasSourceFile: boolean;
};

/**
 * Interactive template table for the operator Template Trace inspector.
 * Every row navigates to the per-template cockpit; the name stays a real
 * link for keyboard / middle-click use, and the chevron makes the
 * affordance obvious.
 */
export function TraceListTable({ templates }: { templates: TraceListTemplate[] }) {
  const router = useRouter();

  return (
    <>
      <style>{`
        .tt-row { cursor: pointer; transition: background-color 120ms ease; }
        .tt-row:hover { background-color: rgba(255,255,255,0.045); }
        .tt-row:hover .tt-open { opacity: 1; transform: translateX(2px); color: var(--accent-strong); }
        .tt-row .tt-open { opacity: 0.35; transition: opacity 120ms ease, transform 120ms ease, color 120ms ease; }
        .tt-rowname { color: var(--accent-strong); text-decoration: none; font-weight: 600; }
        .tt-rowname:hover { text-decoration: underline; }
      `}</style>
      <table className="table responsive-card-table">
        <thead>
          <tr>
            <th>Sample</th>
            <th>Name</th>
            <th>Format</th>
            <th>Intent</th>
            <th>Focus</th>
            <th>Images</th>
            <th>Text</th>
            <th>Source</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr
              key={t.id}
              className="tt-row"
              onClick={() => router.push(`/operator/template-trace/${encodeURIComponent(t.id)}`)}
            >
              <td data-label="Sample">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.thumbnailSrc}
                  alt={t.name}
                  width={48}
                  height={60}
                  style={{ objectFit: "cover", borderRadius: 4, border: "1px solid var(--border-soft, #333)" }}
                />
              </td>
              <td data-label="Name">
                <Link
                  className="tt-rowname"
                  href={`/operator/template-trace/${encodeURIComponent(t.id)}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.name}
                </Link>
                <br />
                <span style={{ fontSize: 11, opacity: 0.6, fontFamily: "monospace" }}>{t.id}</span>
              </td>
              <td data-label="Format">
                <StatusPill tone={t.format === "4:5" ? "blue" : "amber"}>{t.format}</StatusPill>
              </td>
              <td data-label="Intent">{t.classification.primary_intent}</td>
              <td data-label="Focus">{t.classification.property_or_agent_focus}</td>
              <td data-label="Images">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Images size={13} /> {t.imageInputCount}
                </span>
              </td>
              <td data-label="Text">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Type size={13} /> {t.textInputCount}
                </span>
              </td>
              <td data-label="Source">
                {t.hasSourceFile ? (
                  <StatusPill tone="green">On disk</StatusPill>
                ) : (
                  <StatusPill tone="amber">Missing</StatusPill>
                )}
              </td>
              <td data-label="" style={{ width: 32, textAlign: "center" }}>
                <ChevronRight size={16} className="tt-open" aria-hidden />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
