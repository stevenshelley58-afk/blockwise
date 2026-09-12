"use client";

/**
 * Pipeline board.
 *
 * Stage movement is always the same canonical command. Dragging is only a
 * convenience on top of it; every card also carries a keyboard-reachable
 * "Move to" menu, and a phone gets a list instead of a squeezed board.
 */

import { useState } from "react";
import { GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";

import { leadsCopy } from "./copy.ts";
import { describeDue, nextActionLabel, reasonLabel, type NeedsActionReason } from "./format.ts";
import { StageControl } from "./stage-control.tsx";
import { DeliveryChip, DuplicateChip, QualityChip } from "./states.tsx";
import { LEAD_STAGES, type LeadRow } from "./types.ts";

export type LeadPipelineProps = {
  rows: LeadRow[];
  onOpen: (leadId: string) => void;
  onMove: (lead: LeadRow, stage: string) => void;
  reasonsFor: (row: LeadRow) => NeedsActionReason[];
  readOnly: boolean;
  busyId?: string | null;
  timeZone?: string;
};

export function LeadPipeline({ rows, onOpen, onMove, reasonsFor, readOnly, busyId, timeZone }: LeadPipelineProps) {
  const [asList, setAsList] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground">{leadsCopy.viewHints.pipeline}</p>
        <Button type="button" variant="ghost-pill" size="pill" onClick={() => setAsList((value) => !value)}>
          {asList ? leadsCopy.pipeline.boardAlternative : leadsCopy.pipeline.listAlternative}
        </Button>
      </div>

      {asList ? (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-(--r-card) border border-(--line) bg-(--surface) p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate text-[13.5px] font-bold underline-offset-4 hover:underline">{row.name}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">{nextActionLabel(row)}</span>
                </button>
                <StageControl stage={row.stage} onChange={(stage) => onMove(row, stage)} disabled={readOnly} busy={busyId === row.id} />
              </div>
            </li>
          ))}
          {rows.length === 0 ? <li className="text-[12.5px] text-muted-foreground">{leadsCopy.pipeline.empty}</li> : null}
        </ul>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="flex min-w-max gap-3">
            {LEAD_STAGES.map((stage) => {
              const column = rows.filter((row) => row.stage === stage);
              return (
                <section
                  key={stage}
                  aria-label={stage}
                  onDragOver={(event) => {
                    if (readOnly || !dragging) return;
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (readOnly || !dragging) return;
                    event.preventDefault();
                    const row = rows.find((candidate) => candidate.id === dragging);
                    setDragging(null);
                    if (row && row.stage !== stage) onMove(row, stage);
                  }}
                  className="flex w-[248px] shrink-0 flex-col rounded-(--r-panel) border border-(--line) bg-(--surface-subtle)/40 p-2.5"
                >
                  <header className="flex items-center justify-between gap-2 px-1 pb-2">
                    <p className="font-display text-[13.5px] font-extrabold tracking-[-0.01em]">{stage}</p>
                    <span className="font-mono text-[10px] tracking-[0.1em] text-(--faint)">{column.length}</span>
                  </header>

                  <div className="grid min-h-16 gap-2">
                    {column.map((row) => {
                      const due = row.nextTask ? describeDue(row.nextTask.dueAt) : null;
                      return (
                        <article
                          key={row.id}
                          draggable={!readOnly}
                          onDragStart={() => setDragging(row.id)}
                          onDragEnd={() => setDragging(null)}
                          className="rounded-(--r-card) border border-(--line) bg-(--surface) p-2.5 shadow-card"
                        >
                          <div className="flex items-start gap-1.5">
                            <GripVertical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-(--faint)" />
                            <button
                              type="button"
                              onClick={() => onOpen(row.id)}
                              className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="block truncate text-[13px] font-bold underline-offset-4 hover:underline">{row.name}</span>
                              <span className="block truncate text-[11.5px] text-muted-foreground">{row.propertyContext ?? row.source}</span>
                            </button>
                          </div>

                          {due ? (
                            <p className={"mt-1.5 text-[11px] " + (due.overdue ? "font-bold text-error" : "text-muted-foreground")}>{due.label}</p>
                          ) : null}

                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {reasonsFor(row).slice(0, 2).map((reason) => (
                              <span key={reason} className="rounded-full bg-(--surface-subtle) px-1.5 py-0.5 text-[10px] font-bold text-(--muted)">
                                {reasonLabel(reason)}
                              </span>
                            ))}
                            {row.duplicateWarning ? <DuplicateChip /> : null}
                            <QualityChip quality={row.quality} />
                            <DeliveryChip state={row.crmDeliveryState} />
                          </div>

                          <div className="mt-2">
                            <StageControl
                              stage={row.stage}
                              onChange={(next) => onMove(row, next)}
                              disabled={readOnly}
                              busy={busyId === row.id}
                              compact
                            />
                          </div>
                        </article>
                      );
                    })}
                    {column.length === 0 ? (
                      <p className="px-1 py-3 text-[11.5px] text-(--faint)">{leadsCopy.pipeline.empty}</p>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[12px] text-muted-foreground">{leadsCopy.pipeline.moveTo} uses the menu on each card. Dragging does the same thing.</p>
    </div>
  );
}
