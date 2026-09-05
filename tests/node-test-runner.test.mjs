import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectNodeTestFiles } from "../scripts/test/run-node-tests.mjs";

test("Node test discovery includes nested TypeScript, TSX and MJS tests in stable order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blockwise-node-test-discovery-"));
  try {
    await mkdir(join(directory, "nested", "node_modules"), { recursive: true });
    await Promise.all([
      writeFile(join(directory, "z.test.ts"), ""),
      writeFile(join(directory, "render.test.tsx"), ""),
      writeFile(join(directory, "a.test.mjs"), ""),
      writeFile(join(directory, "nested", "b.test.ts"), ""),
      writeFile(join(directory, "nested", "node_modules", "ignored.test.ts"), ""),
      writeFile(join(directory, "nested", "fixture.ts"), ""),
    ]);

    assert.deepEqual(
      (await collectNodeTestFiles(directory)).map((file) => file.slice(directory.length + 1)),
      ["a.test.mjs", "nested/b.test.ts", "render.test.tsx", "z.test.ts"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
