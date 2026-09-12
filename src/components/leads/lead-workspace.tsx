"use client";

/**
 * The lead work application.
 *
 * One screen holds four views over the same records: Needs action, All leads,
 * Pipeline and Tasks. Selecting a record opens the context panel beside the
 * list, so search, filters, scroll and selection all survive. Stage changes go
 * through one canonical command and are reverted to the confirmed stage when
 * the CRM rejects them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { browserLeadTransport, createLeadApi, describeLeadError, type LeadApi, type LeadErrorDescription } from "./api.ts";
import { latestActivityLabel } from "./activity-timeline.tsx";
import { ContextPanel } from "./context-panel.tsx";
import { leadsCopy } from "./copy.ts";
import {
  downloadCsv,
  leadsToCsv,
  needsActionReasons,
  sortTasksByDue,
  stageLabel,
  type FormatOptions,
} from "./format.ts";
import { LeadCard, LeadListRow, type LeadActivitySummary } from "./lead-rows.tsx";
import { LeadDetailPanel } from "./lead-detail-panel.tsx";
import { LeadPipeline } from "./lead-pipeline.tsx";
import { LeadTasksView, type LeadTaskEntry } from "./lead-tasks-view.tsx";
import { WorkListToolbar } from "./work-list-toolbar.tsx";
import { DeliveryChip, EmptyState, ErrorCard, ListSkeleton, ReadOnlyBanner } from "./states.tsx";
import {
  EMPTY_LEAD_FILTERS,
  LEAD_STAGES,
  type LeadActivity,
  type LeadFilters,
  type LeadRow,
  type LeadTask,
  type LeadView,
} from "./types.ts";

const VIEWS: LeadView[] = ["action", "all", "pipeline", "tasks"];
const SORTS = ["received", "name", "due", "stage"] as const;
type LeadSort = (typeof SORTS)[number];

const SORT_LABELS: Record<LeadSort, string> = {
  received: "Newest first",
  name: "Name A to Z",
  due: "Follow-up due first",
  stage: "Stage order",
};

const HYDRATION_LIMIT = 25;

export type LeadWorkspaceProps = {
  workspaceId: string;
  canSeeUnassigned: boolean;
  initialLeadId: string | null;
  initialView: LeadView;
  timeZone?: string;
};

type DetailCacheEntry = { tasks: LeadTask[]; activities: LeadActivity[] };

export function LeadWorkspace({ workspaceId, canSeeUnassigned, initialLeadId, initialView, timeZone }: LeadWorkspaceProps) {
  const api = useMemo<LeadApi>(() => createLeadApi({ transport: browserLeadTransport, workspaceId }), [workspaceId]);
  const formatOptions = useMemo<FormatOptions>(() => ({ timeZone }), [timeZone]);

  const [view, setView] = useState<LeadView>(initialView);
  const [sort, setSort] = useState<LeadSort>("received");
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_LEAD_FILTERS);
  const search = useDebouncedValue(filters.search, 250);

  const [rows, setRows] = useState<LeadRow[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<LeadErrorDescription | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [followUpDueCount, setFollowUpDueCount] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(initialLeadId);
  const [detail, setDetail] = useState<{ leadId: string; tasks: LeadTask[]; activities: LeadActivity[] } | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState<LeadErrorDescription | null>(null);

  const [cache, setCache] = useState<Record<string, DetailCacheEntry>>({});
  const cacheRef = useRef<Record<string, DetailCacheEntry>>({});
  const [tasksLoading, setTasksLoading] = useState(false);

  const [readOnly, setReadOnly] = useState(false);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<LeadErrorDescription | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const queryKey = useMemo(
    () => [search, filters.stage, filters.source, filters.quality, filters.mine, filters.unassigned, filters.followUpDue, refreshToken].join("|"),
    [search, filters.stage, filters.source, filters.quality, filters.mine, filters.unassigned, filters.followUpDue, refreshToken],
  );

  useEffect(() => {
    let cancelled = false;
    setListState("loading");
    api
      .list({
        search: search || undefined,
        stage: filters.stage || undefined,
        source: filters.source || undefined,
        quality: filters.quality || undefined,
        mine: filters.mine || undefined,
        unassigned: filters.unassigned || undefined,
        followUpDue: filters.followUpDue || undefined,
        limit: 100,
      })
      .then((response) => {
        if (cancelled) return;
        setRows(response.leads);
        setPendingCount(response.crmPendingCount);
        setFollowUpDueCount(response.followUpDueCount);
        setListError(null);
        setListState("ready");
        setReadOnly(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const description = describeLeadError(cause);
        setListError(description);
        setListState("error");
        if (description.readOnly) setReadOnly(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, queryKey, filters.stage, filters.source, filters.quality, filters.mine, filters.unassigned, filters.followUpDue, search]);

  const visibleRows = useMemo(() => {
    const base = view === "action" ? rows.filter((row) => needsActionReasons(row, { canSeeUnassigned }).length > 0) : rows;
    return sortRows(base, sort);
  }, [rows, view, sort, canSeeUnassigned]);

  const sources = useMemo(() => [...new Set(rows.map((row) => row.source))].sort(), [rows]);

  /** Background hydration fills "last reported activity" and the Tasks view. */
  const hydrationKey = useMemo(() => visibleRows.slice(0, HYDRATION_LIMIT).map((row) => row.id).join("|"), [visibleRows]);

  useEffect(() => {
    let cancelled = false;
    const ids = hydrationKey ? hydrationKey.split("|") : [];
    const queue = ids.filter((id) => !cacheRef.current[id]);
    if (queue.length === 0) return;

    setTasksLoading(true);
    let index = 0;
    const worker = async () => {
      while (index < queue.length) {
        const id = queue[index];
        index += 1;
        try {
          const data = await api.detail(id);
          if (cancelled) return;
          const entry: DetailCacheEntry = { tasks: data.tasks, activities: data.activities };
          cacheRef.current = { ...cacheRef.current, [id]: entry };
          setCache((previous) => ({ ...previous, [id]: entry }));
        } catch {
          // Unknown stays unknown. Nothing is invented to fill the gap.
        }
      }
    };

    void Promise.all([worker(), worker(), worker(), worker()]).finally(() => {
      if (!cancelled) setTasksLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [api, hydrationKey, refreshToken]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailState("idle");
      return;
    }
    let cancelled = false;
    setDetailState("loading");
    api
      .detail(selectedId)
      .then((data) => {
        if (cancelled) return;
        const entry: DetailCacheEntry = { tasks: data.tasks, activities: data.activities };
        cacheRef.current = { ...cacheRef.current, [selectedId]: entry };
        setCache((previous) => ({ ...previous, [selectedId]: entry }));
        setDetail({ leadId: selectedId, tasks: data.tasks, activities: data.activities });
        setDetailError(null);
        setDetailState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setDetailError(describeLeadError(cause));
        setDetailState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedId, refreshToken]);

  /** Keep the URL shareable without re-running the server page. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("lead", selectedId);
    else url.searchParams.delete("lead");
    if (view === "action") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    window.history.replaceState(null, "", url.toString());
  }, [selectedId, view]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  function fail(cause: unknown) {
    const description = describeLeadError(cause);
    setActionError(description);
    if (description.readOnly) setReadOnly(true);
  }

  async function moveStage(lead: LeadRow, stage: string) {
    if (readOnly) return;
    const confirmed = lead.stage;
    setBusyLeadId(lead.id);
    setActionError(null);
    setNotice(null);
    setRows((previous) => previous.map((row) => (row.id === lead.id ? { ...row, stage } : row)));
    try {
      const result = await api.setStage(lead.id, stage, lead.revision);
      setRows((previous) =>
        previous.map((row) => (row.id === lead.id ? { ...row, stage: result.stage ?? stage, revision: result.revision ?? row.revision } : row)),
      );
      setNotice(leadsCopy.pipeline.moved(stageLabel(stage)));
      refresh();
    } catch (cause) {
      setRows((previous) => previous.map((row) => (row.id === lead.id ? { ...row, stage: confirmed } : row)));
      fail(cause);
    } finally {
      setBusyLeadId(null);
    }
  }

  async function completeTask(task: LeadTask) {
    if (readOnly) return;
    setBusyTaskId(task.name);
    try {
      await api.updateTask(task.name, { status: "Done" });
      refresh();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusyTaskId(null);
    }
  }

  async function snoozeTask(task: LeadTask, dueAt: string) {
    if (readOnly) return;
    setBusyTaskId(task.name);
    try {
      await api.updateTask(task.name, { dueAt });
      refresh();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusyTaskId(null);
    }
  }

  const taskEntries = useMemo<LeadTaskEntry[]>(() => {
    const entries: LeadTaskEntry[] = [];
    for (const row of visibleRows) {
      const entry = cacheRef.current[row.id] ?? cache[row.id];
      if (!entry) continue;
      for (const task of sortTasksByDue(entry.tasks)) entries.push({ task, lead: row });
    }
    return entries;
  }, [visibleRows, cache]);

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);

  function activityFor(row: LeadRow): LeadActivitySummary {
    const entry = cache[row.id] ?? cacheRef.current[row.id];
    if (!entry) return { state: "pending" };
    if (entry.activities.length === 0) return { state: "empty", label: leadsCopy.activity.empty };
    return { state: "loaded", label: latestActivityFallback(entry.activities, timeZone) };
  }

  function exportCsv() {
    downloadCsv("leads-" + new Date().toISOString().slice(0, 10) + ".csv", leadsToCsv(visibleRows, formatOptions));
  }

  const count = visibleRows.length;
  const countLabel = leadsCopy.counts.showing(count, count);

  function renderList() {
    if (listState === "loading") return <ListSkeleton />;
    if (listState === "error" && listError) {
      return <ErrorCard title={listError.title} body={listError.body} onRetry={refresh} />;
    }
    if (rows.length === 0) {
      return view === "action" ? (
        <EmptyState title={leadsCopy.states.emptyTitle} body={leadsCopy.states.emptyBody} />
      ) : (
        <EmptyState title={leadsCopy.states.emptyAllTitle} body={leadsCopy.states.emptyAllBody} />
      );
    }
    if (count === 0) {
      return <EmptyState title={leadsCopy.states.noMatchesTitle} body={leadsCopy.states.noMatchesBody} actionLabel={leadsCopy.filters.clear} onAction={() => setFilters({ ...EMPTY_LEAD_FILTERS })} />;
    }

    return (
      <>
        <div className="hidden gap-3 px-4 pb-1 md:grid md:grid-cols-[104px_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
          {[leadsCopy.columns.stage, leadsCopy.columns.enquiry, leadsCopy.columns.owner, leadsCopy.columns.next, leadsCopy.columns.lastActivity].map(
            (heading) => (
              <span key={heading} className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
                {heading}
              </span>
            ),
          )}
        </div>
        <div className="hidden grid gap-2 md:grid">
          {visibleRows.map((row) => (
            <LeadListRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={() => setSelectedId(row.id)}
              reasons={needsActionReasons(row, { canSeeUnassigned })}
              activity={activityFor(row)}
              timeZone={timeZone}
            />
          ))}
        </div>
        <div className="grid gap-2 md:hidden">
          {visibleRows.map((row) => (
            <LeadCard
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={() => setSelectedId(row.id)}
              reasons={needsActionReasons(row, { canSeeUnassigned })}
              activity={activityFor(row)}
              timeZone={timeZone}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <section aria-label={leadsCopy.title} className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">{leadsCopy.title}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{leadsCopy.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 ? <DeliveryChip state="pending" /> : null}
          {followUpDueCount > 0 ? (
            <span className="text-[12.5px] text-muted-foreground">{leadsCopy.counts.followUpDue(followUpDueCount)}</span>
          ) : null}
        </div>
      </header>

      <div className="mt-5 grid gap-3">
        <WorkListToolbarSlot
          filters={filters}
          onChange={setFilters}
          sources={sources}
          canSeeUnassigned={canSeeUnassigned}
          countLabel={countLabel}
          onExport={exportCsv}
          disabled={listState === "loading"}
        />

        <div className="flex flex-wrap items-center gap-2 rounded-(--r-panel) border border-(--line) bg-(--surface) p-1.5">
          <div role="tablist" aria-label={leadsCopy.title} className="flex flex-wrap gap-1.5">
            {VIEWS.map((candidate) => {
              const active = candidate === view;
              return (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="lead-view-panel"
                  id={"lead-view-tab-" + candidate}
                  onClick={() => setView(candidate)}
                  className={
                    "relative inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 py-2.5 text-xs font-bold transition-all duration-150 ease-spring before:absolute before:-inset-x-[3px] before:-inset-y-[7px] before:content-[''] active:scale-[0.96] sm:min-h-9 sm:px-[13px] sm:py-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                    (active ? "border-(--ink) bg-(--ink) text-white" : "border-(--line) bg-(--surface) text-muted-foreground hover:border-(--line-heavy) hover:text-foreground")
                  }
                >
                  {viewLabel(candidate)}
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          <div className="min-w-[160px]">
            <Select value={sort} onValueChange={(value) => setSort(value as LeadSort)}>
              <SelectTrigger className="h-9 w-full text-[12.5px]" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {SORT_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {readOnly ? <ReadOnlyBanner title={leadsCopy.states.crmUnavailableTitle} body={leadsCopy.states.crmUnavailableBody} /> : null}
        {actionError ? <ErrorCard title={actionError.title} body={actionError.body} onRetry={() => setActionError(null)} /> : null}
        {notice ? (
          <p role="status" className="text-[12.5px] font-semibold text-success">
            {notice}
          </p>
        ) : null}

        <div
          id="lead-view-panel"
          role="tabpanel"
          aria-labelledby={"lead-view-tab-" + view}
          className={"grid gap-3 " + (selectedRow ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "")}
        >
          <div className="grid min-w-0 gap-2">
            {view === "pipeline" ? (
              listState === "loading" ? (
                <ListSkeleton rows={3} />
              ) : (
                <LeadPipeline
                  rows={visibleRows}
                  onOpen={setSelectedId}
                  onMove={moveStage}
                  reasonsFor={(row) => needsActionReasons(row, { canSeeUnassigned })}
                  readOnly={readOnly}
                  busyId={busyLeadId}
                  timeZone={timeZone}
                />
              )
            ) : null}

            {view === "tasks" ? (
              <LeadTasksView
                entries={taskEntries}
                loading={tasksLoading}
                partial={visibleRows.length > HYDRATION_LIMIT}
                onOpen={setSelectedId}
                onComplete={completeTask}
                onSnooze={snoozeTask}
                readOnly={readOnly}
                busyId={busyTaskId}
                timeZone={timeZone}
              />
            ) : null}

            {view === "action" || view === "all" ? renderList() : null}
          </div>

          {selectedRow ? (
            <ContextPanel
              open
              onClose={() => setSelectedId(null)}
              label={leadsCopy.a11y.detail}
              title={selectedRow.name}
              subtitle={selectedRow.propertyContext ?? selectedRow.source}
            >
              <LeadDetailPanel
                lead={selectedRow}
                tasks={detail?.leadId === selectedRow.id ? detail.tasks : cache[selectedRow.id]?.tasks ?? []}
                activities={detail?.leadId === selectedRow.id ? detail.activities : cache[selectedRow.id]?.activities ?? []}
                loading={detailState === "loading"}
                error={
                  detailError
                    ? { title: detailError.title, body: detailError.body, onRetry: refresh }
                    : null
                }
                api={api}
                readOnly={readOnly}
                timeZone={timeZone}
                canReassign={canSeeUnassigned}
                onStageChange={(stage) => void moveStage(selectedRow, stage)}
                onChanged={refresh}
              />
            </ContextPanel>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function viewLabel(view: LeadView): string {
  if (view === "action") return leadsCopy.views.action;
  if (view === "all") return leadsCopy.views.all;
  if (view === "pipeline") return leadsCopy.views.pipeline;
  return leadsCopy.views.tasks;
}

function sortRows(rows: LeadRow[], sort: LeadSort): LeadRow[] {
  const copy = [...rows];
  if (sort === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "stage") {
    return copy.sort((a, b) => LEAD_STAGES.indexOf(a.stage as never) - LEAD_STAGES.indexOf(b.stage as never));
  }
  if (sort === "due") {
    return copy.sort((a, b) => {
      const left = Date.parse(a.nextTask?.dueAt ?? "");
      const right = Date.parse(b.nextTask?.dueAt ?? "");
      const leftMs = Number.isFinite(left) ? left : Number.MAX_SAFE_INTEGER;
      const rightMs = Number.isFinite(right) ? right : Number.MAX_SAFE_INTEGER;
      return leftMs - rightMs;
    });
  }
  return copy.sort((a, b) => {
    const left = Date.parse(a.receivedAt ?? "");
    const right = Date.parse(b.receivedAt ?? "");
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Kept separate so the toolbar import stays a single feature primitive. */
function WorkListToolbarSlot(props: {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  sources: string[];
  canSeeUnassigned: boolean;
  countLabel: string;
  onExport: () => void;
  disabled?: boolean;
}) {
  return <WorkListToolbar {...props} />;
}


function latestActivityFallback(activities: LeadActivity[], timeZone?: string): string {
  return latestActivityLabel(activities, timeZone) ?? leadsCopy.activity.empty;
}
