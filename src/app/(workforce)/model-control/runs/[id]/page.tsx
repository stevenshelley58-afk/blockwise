import { notFound } from "next/navigation";

import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
};

type JsonRecord = Record<string, unknown>;

type ProviderRunDetailRow = {
  id: string;
  workspace_id: string;
  user_id?: string | null;
  correlation_id?: string | null;
  ai_run_id?: string | null;
  ai_usage_ledger_id?: string | null;
  task_type?: string | null;
  model_profile?: string | null;
  provider_name?: string | null;
  provider_type?: string | null;
  model_name?: string | null;
  prompt_version_id?: string | null;
  input_json?: JsonRecord | null;
  output_json?: JsonRecord | null;
  usage_json?: JsonRecord | null;
  cost_estimate?: number | string | null;
  status?: string | null;
  error_json?: JsonRecord | null;
  created_at?: string | null;
};

type AiRunRow = {
  id: string;
  provider?: string | null;
  model?: string | null;
  task?: string | null;
  output_type?: string | null;
  status?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  image_units?: number | null;
  estimated_cost_cents?: number | null;
  result_summary?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  correlation_id?: string | null;
};

type LedgerRow = {
  id: string;
  provider?: string | null;
  model?: string | null;
  task?: string | null;
  output_type?: string | null;
  result?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  image_units?: number | null;
  estimated_cost_cents?: number | null;
  created_at?: string | null;
  correlation_id?: string | null;
};

type PromptVersionRow = {
  id: string;
  key?: string | null;
  version?: number | null;
  title?: string | null;
  status?: string | null;
  metadata_json?: JsonRecord | null;
  created_at?: string | null;
};

type ProfileRow = {
  id: string;
  email?: string | null;
  full_name?: string | null;
};

type TraceRow = {
  id: string;
  created_at?: string | null;
  [key: string]: unknown;
};

export default async function ModelRunDetailPage({ params }: PageProps) {
  const { id } = await Promise.resolve(params);
  const { supabase, access } = await requirePageSurfaceAccess("model_control");
  const { data: providerRun, error: providerRunError } = await supabase
    .from("adstudio_provider_runs")
    .select(
      "id,workspace_id,user_id,correlation_id,ai_run_id,ai_usage_ledger_id,task_type,model_profile,provider_name,provider_type,model_name,prompt_version_id,input_json,output_json,usage_json,cost_estimate,status,error_json,created_at",
    )
    .eq("workspace_id", access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (providerRunError || !providerRun) {
    notFound();
  }

  const run = providerRun as ProviderRunDetailRow;
  const correlationId = run.correlation_id ?? readString(run.input_json, "correlation_id");
  const promptVersionIds = extractPromptVersionIds(run);
  const [
    aiRunResult,
    ledgerResult,
    profileResult,
    promptVersionsResult,
    auditResult,
    approvalResult,
    artifactResult,
    leadAttributionResult,
    leadDeliveryResult,
    leadExportResult,
  ] = await Promise.all([
    run.ai_run_id
      ? supabase
          .from("ai_runs")
          .select(
            "id,provider,model,task,output_type,status,input_tokens,output_tokens,image_units,estimated_cost_cents,result_summary,error_message,created_at,completed_at,correlation_id",
          )
          .eq("workspace_id", access.workspaceId)
          .eq("id", run.ai_run_id)
          .maybeSingle()
      : emptySingle(),
    run.ai_usage_ledger_id
      ? supabase
          .from("ai_usage_ledger")
          .select(
            "id,provider,model,task,output_type,result,input_tokens,output_tokens,image_units,estimated_cost_cents,created_at,correlation_id",
          )
          .eq("workspace_id", access.workspaceId)
          .eq("id", run.ai_usage_ledger_id)
          .maybeSingle()
      : emptySingle(),
    run.user_id ? supabase.from("profiles").select("id,email,full_name").eq("id", run.user_id).maybeSingle() : emptySingle(),
    promptVersionIds.length
      ? supabase
          .from("prompt_versions")
          .select("id,key,version,title,status,metadata_json,created_at")
          .in("id", promptVersionIds)
      : emptyList(),
    correlationId
      ? supabase
          .from("audit_logs")
          .select("id,action,target_type,target_id,metadata,created_at")
          .eq("workspace_id", access.workspaceId)
          .eq("correlation_id", correlationId)
          .order("created_at", { ascending: false })
      : emptyList(),
    correlationId
      ? supabase
          .from("approval_requests")
          .select("id,target_type,target_id,status,risk_summary,created_at")
          .eq("workspace_id", access.workspaceId)
          .eq("correlation_id", correlationId)
          .order("created_at", { ascending: false })
      : emptyList(),
    correlationId
      ? supabase
          .from("agent_artifacts")
          .select("id,agent_run_id,artifact_type,storage_path,content,created_at")
          .eq("workspace_id", access.workspaceId)
          .eq("correlation_id", correlationId)
          .order("created_at", { ascending: false })
      : emptyList(),
    correlationId
      ? supabase
          .from("lead_source_attribution")
          .select("id,lead_id,provider,source,meta_publish_plan_id,adstudio_campaign_id,approval_request_id,created_at")
          .eq("workspace_id", access.workspaceId)
          .eq("correlation_id", correlationId)
          .order("created_at", { ascending: false })
      : emptyList(),
    correlationId
      ? supabase
          .from("lead_delivery_attempts")
          .select("id,lead_id,provider,destination_type,destination_label,status,approval_request_id,request_json,response_json,created_at")
          .eq("workspace_id", access.workspaceId)
          .eq("correlation_id", correlationId)
          .order("created_at", { ascending: false })
      : emptyList(),
    correlationId
      ? supabase
          .from("lead_export_audits")
          .select("id,exported_by,approval_request_id,row_count,destination,created_at")
          .eq("workspace_id", access.workspaceId)
          .eq("correlation_id", correlationId)
          .order("created_at", { ascending: false })
      : emptyList(),
  ]);

  const aiRun = aiRunResult.data as AiRunRow | null;
  const ledger = ledgerResult.data as LedgerRow | null;
  const profile = profileResult.data as ProfileRow | null;
  const promptVersions = (promptVersionsResult.data ?? []) as PromptVersionRow[];
  const auditRows = (auditResult.data ?? []) as TraceRow[];
  const approvalRows = (approvalResult.data ?? []) as TraceRow[];
  const artifactRows = (artifactResult.data ?? []) as TraceRow[];
  const leadAttributions = (leadAttributionResult.data ?? []) as TraceRow[];
  const leadDeliveries = (leadDeliveryResult.data ?? []) as TraceRow[];
  const leadExports = (leadExportResult.data ?? []) as TraceRow[];
  const warnings = [
    aiRunResult.error?.message,
    ledgerResult.error?.message,
    profileResult.error?.message,
    promptVersionsResult.error?.message,
    auditResult.error?.message,
    approvalResult.error?.message,
    artifactResult.error?.message,
    leadAttributionResult.error?.message,
    leadDeliveryResult.error?.message,
    leadExportResult.error?.message,
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <main className="content">
      <PageHeading
        eyebrow="AI run trace"
        title={run.task_type ?? readString(run.input_json, "task_type") ?? "Provider run"}
        description="Review the prompt, model, provider, tokens, cost, approval state, artifacts, lead results, and provider response for this run."
      />

      {warnings.length ? (
        <section className="panel">
          <h2>Trace Warnings</h2>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Run</h2>
            <p className="item-meta">{run.id}</p>
          </div>
          <StatusPill tone={run.status === "completed" ? "green" : "rose"}>{run.status ?? "unknown"}</StatusPill>
        </div>
        <div className="grid cols-3">
          <DetailCard label="Trace" value={correlationId ?? "-"} />
          <DetailCard label="User" value={profileDisplayName(profile, run.user_id)} />
          <DetailCard label="Created" value={formatDate(run.created_at)} />
          <DetailCard label="Task" value={run.task_type ?? readString(run.input_json, "task_type") ?? "-"} />
          <DetailCard label="Profile" value={run.model_profile ?? readString(run.input_json, "model_profile") ?? "-"} />
          <DetailCard label="Cost" value={formatUsd(run.cost_estimate)} />
        </div>
      </section>

      <section className="panel">
        <h2>Model And Provider</h2>
        <div className="grid cols-3">
          <DetailCard label="Provider" value={run.provider_name ?? aiRun?.provider ?? ledger?.provider ?? "-"} />
          <DetailCard label="Provider type" value={run.provider_type ?? "-"} />
          <DetailCard label="Model" value={run.model_name ?? aiRun?.model ?? ledger?.model ?? "-"} />
          <DetailCard label="AI run" value={aiRun?.id ?? "-"} />
          <DetailCard label="Ledger row" value={ledger?.id ?? "-"} />
          <DetailCard label="Result" value={aiRun?.result_summary ?? ledger?.result ?? "-"} />
        </div>
      </section>

      <section className="panel">
        <h2>Tokens And Cost</h2>
        <div className="grid cols-4">
          <DetailCard label="Input tokens" value={String(aiRun?.input_tokens ?? ledger?.input_tokens ?? readNumber(run.usage_json, "inputTokens") ?? 0)} />
          <DetailCard label="Output tokens" value={String(aiRun?.output_tokens ?? ledger?.output_tokens ?? readNumber(run.usage_json, "outputTokens") ?? 0)} />
          <DetailCard label="Image units" value={String(aiRun?.image_units ?? ledger?.image_units ?? readNumber(run.usage_json, "imageUnits") ?? 0)} />
          <DetailCard label="Ledger cost" value={formatCents(ledger?.estimated_cost_cents ?? aiRun?.estimated_cost_cents ?? null)} />
        </div>
      </section>

      <section className="panel">
        <h2>Prompt</h2>
        <div className="grid cols-2">
          <div>
            <h3>Prompt versions</h3>
            <div className="table-wrap">
              <table className="table responsive-card-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Section</th>
                  </tr>
                </thead>
                <tbody>
                  {promptVersions.map((version) => (
                    <tr key={version.id}>
                      <td data-label="Key">{version.key ?? "-"}</td>
                      <td data-label="Version">{version.version ?? "-"}</td>
                      <td data-label="Status">{version.status ?? "-"}</td>
                      <td data-label="Section">{readString(version.metadata_json, "section_type") ?? "-"}</td>
                    </tr>
                  ))}
                  {!promptVersions.length ? (
                    <tr>
                      <td colSpan={4}>{summarizeInlinePromptVersions(run.input_json)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3>Prompt diagnostics</h3>
            <pre className="prompt-preview tall">{JSON.stringify(run.input_json ?? {}, null, 2)}</pre>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Artifacts And Approvals</h2>
        <div className="grid cols-2">
          <TraceTable
            title="Artifacts"
            emptyLabel="No artifacts were attached to this trace."
            rows={artifactRows}
            columns={[
              ["artifact_type", "Type"],
              ["storage_path", "Path"],
              ["created_at", "Created"],
            ]}
          />
          <TraceTable
            title="Approvals"
            emptyLabel="No approval rows were attached to this trace."
            rows={approvalRows}
            columns={[
              ["target_type", "Target"],
              ["status", "Status"],
              ["created_at", "Created"],
            ]}
          />
        </div>
      </section>

      <section className="panel">
        <h2>Lead Result Trace</h2>
        <div className="grid cols-3">
          <TraceTable
            title="Attribution"
            emptyLabel="No lead attribution rows."
            rows={leadAttributions}
            columns={[
              ["lead_id", "Lead"],
              ["provider", "Provider"],
              ["created_at", "Created"],
            ]}
          />
          <TraceTable
            title="Delivery"
            emptyLabel="No lead delivery rows."
            rows={leadDeliveries}
            columns={[
              ["lead_id", "Lead"],
              ["status", "Status"],
              ["created_at", "Created"],
            ]}
          />
          <TraceTable
            title="Exports"
            emptyLabel="No lead export rows."
            rows={leadExports}
            columns={[
              ["destination", "Destination"],
              ["row_count", "Rows"],
              ["created_at", "Created"],
            ]}
          />
        </div>
      </section>

      <section className="panel">
        <h2>Provider Response</h2>
        <div className="grid cols-2">
          <div>
            <h3>Output</h3>
            <pre className="prompt-preview tall">{JSON.stringify(run.output_json ?? {}, null, 2)}</pre>
          </div>
          <div>
            <h3>Error</h3>
            <pre className="prompt-preview tall">{JSON.stringify(run.error_json ?? {}, null, 2)}</pre>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Audit Log</h2>
        <TraceTable
          title="Audit events"
          emptyLabel="No audit rows were attached to this trace."
          rows={auditRows}
          columns={[
            ["action", "Action"],
            ["target_type", "Target"],
            ["created_at", "Created"],
          ]}
        />
      </section>
    </main>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="item-card">
      <h3>{value}</h3>
      <p className="item-meta">{label}</p>
    </article>
  );
}

function TraceTable({
  title,
  emptyLabel,
  rows,
  columns,
}: {
  title: string;
  emptyLabel: string;
  rows: TraceRow[];
  columns: Array<[keyof TraceRow & string, string]>;
}) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="table responsive-card-table">
          <thead>
            <tr>
              {columns.map(([, label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map(([key, label]) => (
                  <td data-label={label} key={key}>{formatCell(row[key])}</td>
                ))}
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={columns.length}>{emptyLabel}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function emptySingle() {
  return Promise.resolve({ data: null, error: null });
}

function emptyList() {
  return Promise.resolve({ data: [], error: null });
}

function extractPromptVersionIds(run: ProviderRunDetailRow): string[] {
  const ids = new Set<string>();

  if (run.prompt_version_id) {
    ids.add(run.prompt_version_id);
  }

  const versions = run.input_json?.prompt_versions;
  if (Array.isArray(versions)) {
    for (const version of versions) {
      if (!version || typeof version !== "object") continue;
      const id = (version as JsonRecord).id;
      if (typeof id === "string") {
        ids.add(id);
      }
    }
  }

  return [...ids];
}

function summarizeInlinePromptVersions(input: JsonRecord | null | undefined): string {
  const versions = input?.prompt_versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    return "No prompt version metadata was recorded.";
  }

  return versions
    .map((version) => {
      if (!version || typeof version !== "object") return "";
      const row = version as JsonRecord;
      return `${row.key ?? "prompt"}@${row.version ?? "fallback"}`;
    })
    .filter(Boolean)
    .join(", ");
}

function readString(record: JsonRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value ? value : null;
}

function readNumber(record: JsonRecord | null | undefined, key: string): number | null {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function profileDisplayName(profile: ProfileRow | null, userId: string | null | undefined): string {
  const fullName = profile?.full_name?.trim();

  if (fullName) return fullName;
  if (profile?.email) return profile.email;

  return userId ? "Unknown user" : "System";
}

function formatUsd(value: number | string | null | undefined): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(amount) ? `$${amount!.toFixed(4)}` : "-";
}

function formatCents(value: number | null | undefined): string {
  return typeof value === "number" ? `$${(value / 100).toFixed(2)}` : "-";
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatCell(value: unknown): string {
  if (typeof value === "string") {
    return value.includes("T") && value.endsWith("Z") ? formatDate(value) : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "-";
  }

  return JSON.stringify(value);
}
