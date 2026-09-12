"use client";

/**
 * Work-list toolbar: search, quick filters, scoped filters and export.
 *
 * The toolbar never reports a total it cannot back up. The count it shows is
 * always the count of rows currently matching the active filters.
 */

import { Download, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { leadsCopy } from "./copy.ts";
import { qualityLabel, stageLabel } from "./format.ts";
import { EMPTY_LEAD_FILTERS, LEAD_QUALITY_LABELS, LEAD_STAGES, type LeadFilters } from "./types.ts";

export type WorkListToolbarProps = {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  sources: string[];
  canSeeUnassigned: boolean;
  countLabel: string;
  onExport: () => void;
  disabled?: boolean;
};

const CHIP =
  "relative inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 py-2.5 text-xs font-bold transition-all duration-150 ease-spring before:absolute before:-inset-x-[3px] before:-inset-y-[7px] before:content-[''] active:scale-[0.96] sm:min-h-9 sm:px-[13px] sm:py-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const CHIP_ON = "border-(--ink) bg-(--ink) text-white";
const CHIP_OFF =
  "border-(--line) bg-(--surface) text-muted-foreground hover:border-(--line-heavy) hover:text-foreground";

export function WorkListToolbar({
  filters,
  onChange,
  sources,
  canSeeUnassigned,
  countLabel,
  onExport,
  disabled = false,
}: WorkListToolbarProps) {
  const active =
    filters.search !== "" ||
    filters.stage !== "" ||
    filters.source !== "" ||
    filters.quality !== "" ||
    filters.mine ||
    filters.unassigned ||
    filters.followUpDue;

  function toggle(key: "mine" | "unassigned" | "followUpDue") {
    onChange({ ...filters, [key]: !filters[key] });
  }

  return (
    <div className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-11 w-full items-center gap-2 rounded-[10px] border border-(--line-heavy) bg-(--surface) px-3 transition-[border-color,box-shadow] duration-150 focus-within:border-(--ink) sm:h-9 sm:w-[240px]">
          <Search size={14} aria-hidden className="shrink-0 text-(--faint)" />
          <span className="sr-only">{leadsCopy.filters.search}</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder={leadsCopy.filters.search}
            disabled={disabled}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-(--faint)"
          />
        </label>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={leadsCopy.a11y.filters}>
          <button type="button" aria-pressed={filters.mine} onClick={() => toggle("mine")} className={CHIP + (filters.mine ? " " + CHIP_ON : " " + CHIP_OFF)}>
            {leadsCopy.filters.mine}
          </button>
          {canSeeUnassigned ? (
            <button
              type="button"
              aria-pressed={filters.unassigned}
              onClick={() => toggle("unassigned")}
              className={CHIP + (filters.unassigned ? " " + CHIP_ON : " " + CHIP_OFF)}
            >
              {leadsCopy.filters.unassigned}
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={filters.followUpDue}
            onClick={() => toggle("followUpDue")}
            className={CHIP + (filters.followUpDue ? " " + CHIP_ON : " " + CHIP_OFF)}
          >
            {leadsCopy.filters.followUpDue}
          </button>
        </div>

        <span className="flex-1" />

        <Button type="button" variant="ghost-pill" size="pill" onClick={onExport} disabled={disabled}>
          <Download aria-hidden className="size-[13px]" />
          {leadsCopy.filters.exportCsv}
        </Button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-(--line) pt-2.5">
        <SelectFilter
          label={leadsCopy.filters.stage}
          value={filters.stage}
          placeholder={leadsCopy.filters.anyStage}
          onChange={(value) => onChange({ ...filters, stage: value })}
          options={LEAD_STAGES.map((stage) => ({ value: stage, label: stageLabel(stage) }))}
          disabled={disabled}
        />
        <SelectFilter
          label={leadsCopy.filters.source}
          value={filters.source}
          placeholder={leadsCopy.filters.anySource}
          onChange={(value) => onChange({ ...filters, source: value })}
          options={sources.map((source) => ({ value: source, label: source }))}
          disabled={disabled}
        />
        <SelectFilter
          label={leadsCopy.filters.quality}
          value={filters.quality}
          placeholder={leadsCopy.filters.anyQuality}
          onChange={(value) => onChange({ ...filters, quality: value })}
          options={LEAD_QUALITY_LABELS.map((quality) => ({ value: quality, label: qualityLabel(quality) }))}
          disabled={disabled}
        />

        <span className="flex-1" />

        <span className="text-[12.5px] text-muted-foreground" role="status">
          {countLabel}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_LEAD_FILTERS })}
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[12.5px] font-semibold text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-3.5" />
            {leadsCopy.filters.clear}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SelectFilter({
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-[150px]">
      <Select value={value || "__any__"} onValueChange={(next) => onChange(next === "__any__" ? "" : next)} disabled={disabled}>
        <SelectTrigger className="h-9 w-full text-[12.5px]" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any__">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
