import assert from "node:assert/strict";
import test from "node:test";

import { ResearchSupervisor } from "../../hermes/tools/research-runtime/src/supervisor.ts";
import { CONTENT_RUN_QUEUE_PRIORITY, queueContentRun } from "../../src/lib/content-engine/queue.ts";

test("queueContentRun writes a Hermes research work_queue job instead of Trigger work", async () => {
  const supabase = createFakeSupabase();

  const queued = await queueContentRun({
    supabase: supabase as never,
    workspaceId: "workspace-1",
    runId: "run-1",
    fromStep: "blockwise-blog-writer",
  });

  assert.equal(queued.status, "pending");
  const job = supabase.table("work_queue")[0];
  assert.equal(job.id, queued.id);
  assert.equal(job.queue_name, "research");
  assert.equal(job.job_type, "blockwise-content-run-orchestrator");
  assert.equal(job.dedupe_key, "content-run:workspace-1:run-1");
  assert.equal(job.priority, CONTENT_RUN_QUEUE_PRIORITY);
  assert.ok(job.priority < 5, "interactive content must outrank research maintenance jobs");
  assert.equal(job.payload.contentRunId, "run-1");
  assert.equal(job.payload.fromStep, "blockwise-blog-writer");
});

test("ResearchSupervisor gives interactive content work the same front-of-queue priority", () => {
  const job = new ResearchSupervisor().planContentRun({
    workspaceId: "workspace-1",
    contentRunId: "run-1",
  });

  assert.equal(job.priority, CONTENT_RUN_QUEUE_PRIORITY);
  assert.ok(job.priority < 5, "interactive content must outrank research maintenance jobs");
});

function createFakeSupabase() {
  const tables: Record<string, Array<Record<string, any>>> = {
    work_queue: [],
  };

  return {
    table(name: string) {
      return tables[name];
    },
    schema() {
      return {
        from(name: string) {
          return new FakeQuery(tables, name);
        },
      };
    },
  };
}

class FakeQuery implements PromiseLike<{ data: any; error: null }> {
  private filters: Array<{ column: string; value: any; op: "eq" | "in" }> = [];
  private operation: "select" | "insert" | "update" = "select";
  private payload: any;
  private limitValue: number | null = null;
  private singleMode = false;
  private readonly tables: Record<string, Array<Record<string, any>>>;
  private readonly tableName: string;

  constructor(tables: Record<string, Array<Record<string, any>>>, tableName: string) {
    this.tables = tables;
    this.tableName = tableName;
  }

  select() {
    return this;
  }

  insert(value: any) {
    this.operation = "insert";
    this.payload = value;
    return this;
  }

  update(value: any) {
    this.operation = "update";
    this.payload = value;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, value, op: "eq" });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ column, value, op: "in" });
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.singleMode = true;
    return this.execute();
  }

  then<TResult1 = { data: any; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const table = this.tables[this.tableName] ?? (this.tables[this.tableName] = []);

    if (this.operation === "insert") {
      const inserted = { id: `${this.tableName}-${table.length + 1}`, ...this.payload };
      table.push(inserted);
      return this.finish([inserted]);
    }

    if (this.operation === "update") {
      const rows = this.filtered(table);
      for (const row of rows) Object.assign(row, this.payload);
      return this.finish(rows);
    }

    return this.finish(this.filtered(table));
  }

  private filtered(rows: Array<Record<string, any>>) {
    const filtered = rows.filter((row) =>
      this.filters.every((filter) => {
        if (filter.op === "in") return filter.value.includes(row[filter.column]);
        return row[filter.column] === filter.value;
      }),
    );
    return this.limitValue === null ? filtered : filtered.slice(0, this.limitValue);
  }

  private finish(rows: Array<Record<string, any>>) {
    return { data: this.singleMode ? rows[0] ?? null : rows, error: null };
  }
}
