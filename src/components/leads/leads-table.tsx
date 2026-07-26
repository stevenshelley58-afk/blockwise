"use client";

/*
 * Leads registry (Premium v2 mockup): toolbar (search, quality filter chips,
 * CSV export), sortable TanStack table on desktop, app-like card list on
 * mobile, numbered pager. Copy is config-driven; the server page hands down
 * plain serialisable rows.
 */

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Search,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import { ButtonArrow } from "@/components/shadcn-dashboard/button/button-01";
import { LeadQualitySelect } from "@/app/(customer)/leads/lead-quality-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { niche } from "@/config/niche";

export type LeadListItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  suburb: string;
  source: string;
  attribution: string;
  quality: "valid" | "invalid" | "high_intent" | "unlabelled";
  createdAt: string;
  duplicateCandidate: boolean;
  delivery: string;
};

type Facet = "all" | "high" | "dup";

type TableLead = LeadListItem & { workspaceId: string; canEditQuality: boolean };

const PAGE_SIZE = 8;

function LeadStatusBadge({ duplicate, compact = false }: { duplicate: boolean; compact?: boolean }) {
  const copy = niche.copy.leads.status;
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${
        duplicate ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
      }`}
    >
      {duplicate ? (compact ? "Duplicate?" : copy.possibleDuplicate) : copy.newLead}
    </span>
  );
}

function SourceAd({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-[7px] text-[12.5px] text-muted-foreground">
      <i aria-hidden className="size-[7px] shrink-0 rounded-full bg-data" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function sourceAdLabel(row: LeadListItem): string {
  return row.attribution || row.source;
}

const columns: ColumnDef<TableLead>[] = [
  {
    id: "lead",
    header: niche.copy.leads.columns.lead,
    accessorFn: (row) => `${row.name} ${row.email} ${row.phone}`,
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold">{row.original.name}</p>
        <p className="truncate text-xs leading-[1.4] text-muted-foreground">
          {row.original.email || row.original.phone || "—"}
        </p>
      </div>
    ),
  },
  {
    id: "suburb",
    header: niche.copy.leads.columns.suburb,
    accessorKey: "suburb",
    cell: ({ getValue }) => <span className="text-[12.5px] text-muted-foreground">{getValue<string>()}</span>,
  },
  {
    id: "sourceAd",
    header: niche.copy.leads.columns.sourceAd,
    accessorFn: (row) => sourceAdLabel(row),
    cell: ({ row }) => <SourceAd label={sourceAdLabel(row.original)} />,
  },
  {
    id: "quality",
    header: niche.copy.leads.columns.quality,
    accessorKey: "quality",
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <LeadQualitySelect
        leadId={row.original.id}
        workspaceId={row.original.workspaceId}
        value={row.original.quality}
        disabled={!row.original.canEditQuality}
      />
    ),
  },
  {
    id: "status",
    header: niche.copy.leads.columns.status,
    accessorKey: "duplicateCandidate",
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) => <LeadStatusBadge duplicate={row.original.duplicateCandidate} />,
  },
];

function pageWindow(current: number, count: number): number[] {
  if (count <= 5) return Array.from({ length: count }, (_, index) => index);
  const start = Math.max(0, Math.min(current - 2, count - 5));
  return [start, start + 1, start + 2, start + 3, start + 4];
}

export function LeadsTable({
  rows,
  workspaceId,
  canEditQuality,
}: {
  rows: LeadListItem[];
  workspaceId: string;
  canEditQuality: boolean;
}) {
  const copy = niche.copy.leads;

  const tableRows = useMemo<TableLead[]>(
    () => rows.map((row) => ({ ...row, workspaceId, canEditQuality })),
    [rows, workspaceId, canEditQuality],
  );

  const [facet, setFacet] = useState<Facet>("all");
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const facetRows = useMemo(() => {
    if (facet === "high") return tableRows.filter((row) => row.quality === "high_intent");
    if (facet === "dup") return tableRows.filter((row) => row.duplicateCandidate);
    return tableRows;
  }, [tableRows, facet]);

  const table = useReactTable({
    data: facetRows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: true,
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const filteredRows = table.getFilteredRowModel().rows.map((row) => row.original);
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  function exportCsv() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const header = ["Name", "Email", "Phone", "Suburb", "Source ad", "Quality", "Status", "Delivery", "Captured at"];
    const lines = filteredRows.map((row) =>
      [
        row.name,
        row.email,
        row.phone,
        row.suburb,
        sourceAdLabel(row),
        row.quality,
        row.duplicateCandidate ? copy.status.possibleDuplicate : copy.status.newLead,
        row.delivery,
        row.createdAt,
      ]
        .map(escape)
        .join(","),
    );
    const blob = new Blob([[header.map(escape).join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-(--r-panel) border border-dashed border-border bg-card px-6 py-16 text-center shadow-card">
        <div>
          <p className="text-sm font-bold">{copy.empty.title}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.empty.body}</p>
        </div>
        <ButtonArrow href="/ad-studio" className="h-11 text-[13px]">
          {niche.copy.home.states.needsFirstAd.ctaLabel}
        </ButtonArrow>
      </div>
    );
  }

  const chips: Array<{ value: Facet; label: string }> = [
    { value: "all", label: copy.filters.all },
    { value: "high", label: copy.filters.highIntent },
    { value: "dup", label: copy.filters.duplicates },
  ];

  return (
    <section
      aria-label={copy.title}
      className="rounded-(--r-panel) bg-card shadow-card transition-shadow duration-200 hover:shadow-float"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-(--line) px-[18px] py-4">
        <label className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-(--line-heavy) bg-(--surface) px-3 transition-[border-color,box-shadow] duration-150 focus-within:border-(--ink) focus-within:shadow-[0_0_0_3px_rgba(22,24,29,0.12)] sm:w-[220px]">
          <Search size={14} aria-hidden className="shrink-0 text-(--faint)" />
          <input
            type="text"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={copy.searchPlaceholder}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-(--faint)"
          />
        </label>

        <div className="flex gap-1.5" role="group" aria-label="Lead filters">
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={facet === chip.value}
              onClick={() => setFacet(chip.value)}
              className={`cursor-pointer rounded-full border px-[13px] py-[7px] text-xs font-bold transition-all duration-[180ms] active:scale-[0.96] ${
                facet === chip.value
                  ? "border-(--ink) bg-(--ink) text-white"
                  : "border-(--line) bg-(--surface) text-muted-foreground hover:border-(--line-heavy) hover:text-foreground"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <span className="flex-1" />

        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card"
        >
          <Download size={13} aria-hidden />
          {copy.exportCsv}
        </button>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-(--line) hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const column = header.column;
                  const canSort = column.getCanSort();
                  const sorted = column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className="px-[18px] py-[11px] font-mono text-[9.5px] font-medium tracking-[0.12em] whitespace-nowrap text-(--faint) uppercase"
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={column.getToggleSortingHandler()}
                          className="inline-flex cursor-pointer items-center gap-1 uppercase transition-colors duration-150 hover:text-foreground"
                        >
                          {flexRender(column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp size={9} aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown size={9} aria-hidden />
                          ) : (
                            <ChevronsUpDown size={9} aria-hidden className="opacity-70" />
                          )}
                        </button>
                      ) : (
                        flexRender(column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="px-[18px] py-10 text-center text-[12.5px] text-muted-foreground"
                >
                  {copy.noMatches}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="border-b border-(--line) transition-colors duration-[120ms] hover:bg-(--surface-subtle)">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-[18px] py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="grid gap-2.5 p-4 md:hidden">
        {table.getRowModel().rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-[12.5px] text-muted-foreground">{copy.noMatches}</p>
        ) : (
          table.getRowModel().rows.map((row) => {
            const lead = row.original;
            return (
              <div key={row.id} className="rounded-(--r-card) border border-(--line) bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold">{lead.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {lead.suburb} · {lead.email || lead.phone || "—"}
                    </p>
                  </div>
                  <LeadStatusBadge duplicate={lead.duplicateCandidate} compact />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <SourceAd label={sourceAdLabel(lead)} />
                  <LeadQualitySelect
                    leadId={lead.id}
                    workspaceId={workspaceId}
                    value={lead.quality}
                    disabled={!canEditQuality}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer: count + pager */}
      <div className="flex items-center justify-between gap-3 border-t border-(--line) px-[18px] py-[13px]">
        <span className="text-[12.5px] text-muted-foreground">
          {copy.showing(table.getRowModel().rows.length, filteredRows.length)}
        </span>
        {pageCount > 1 && (
          <nav className="flex gap-[5px]" aria-label="Pagination">
            <button
              type="button"
              aria-label="Previous page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              className="grid size-[30px] cursor-pointer place-items-center rounded-lg border border-(--line) bg-(--surface) text-muted-foreground transition-all duration-150 hover:border-(--line-heavy) hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:border-(--line) disabled:hover:text-muted-foreground"
            >
              <ChevronLeft size={13} aria-hidden />
            </button>
            {pageWindow(pageIndex, pageCount).map((index) => (
              <button
                key={index}
                type="button"
                aria-label={`Page ${index + 1}`}
                aria-current={index === pageIndex ? "page" : undefined}
                onClick={() => table.setPageIndex(index)}
                className={`grid size-[30px] cursor-pointer place-items-center rounded-lg border text-xs font-bold transition-all duration-150 ${
                  index === pageIndex
                    ? "border-(--ink) bg-(--ink) text-white"
                    : "border-(--line) bg-(--surface) text-muted-foreground hover:border-(--line-heavy) hover:text-foreground"
                }`}
              >
                {index + 1}
              </button>
            ))}
            <button
              type="button"
              aria-label="Next page"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              className="grid size-[30px] cursor-pointer place-items-center rounded-lg border border-(--line) bg-(--surface) text-muted-foreground transition-all duration-150 hover:border-(--line-heavy) hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:border-(--line) disabled:hover:text-muted-foreground"
            >
              <ChevronRight size={13} aria-hidden />
            </button>
          </nav>
        )}
      </div>

    </section>
  );
}
