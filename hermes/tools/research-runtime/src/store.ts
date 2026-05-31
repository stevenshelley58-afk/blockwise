import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ResearchQueueSnapshot } from "./queue.ts";

export class JsonFileQueueStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ResearchQueueSnapshot> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as ResearchQueueSnapshot;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.jobs)) {
        throw new Error(`Unsupported research queue snapshot at ${this.path}`);
      }
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, jobs: [] };
      }
      throw err;
    }
  }

  async save(snapshot: ResearchQueueSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmpPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.path);
  }
}
