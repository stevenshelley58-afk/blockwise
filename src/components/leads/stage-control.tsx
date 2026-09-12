"use client";

/**
 * Stage control.
 *
 * Stage movement is a canonical command. The menu is the primary control: it
 * is reachable by keyboard, works on a phone and never depends on dragging.
 * The caller owns optimistic movement and restores the confirmed stage when
 * the command fails.
 */

import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { leadsCopy } from "./copy.ts";
import { stageLabel } from "./format.ts";
import { LEAD_STAGES } from "./types.ts";

export function StageControl({
  stage,
  onChange,
  disabled = false,
  busy = false,
  compact = false,
}: {
  stage: string;
  onChange: (stage: string) => void;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost-pill"
          size="pill"
          disabled={disabled || busy}
          aria-label={leadsCopy.pipeline.moveTo + ": " + stageLabel(stage)}
          className={compact ? "w-full justify-between" : "justify-between"}
        >
          <span className="truncate">{busy ? "Saving…" : stageLabel(stage)}</span>
          <ChevronDown aria-hidden className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{leadsCopy.pipeline.moveTo}</DropdownMenuLabel>
        {LEAD_STAGES.map((candidate) => (
          <DropdownMenuItem
            key={candidate}
            onSelect={() => {
              if (candidate !== stage) onChange(candidate);
            }}
            disabled={disabled || busy}
          >
            <span className="flex-1">{stageLabel(candidate)}</span>
            {candidate === stage ? <Check aria-hidden className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
