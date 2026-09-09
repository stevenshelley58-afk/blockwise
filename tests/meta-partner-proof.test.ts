import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  createBearerEnforcingFetch,
  createDryRunFetch,
  hashMetaId,
  isProofReceiptCurrent,
  loadDryRunFixture,
  ProofAbortError,
  redactTokenLike,
  runProof,
  type ProofReceipt,
} from "../src/lib/providers/meta-partner-proof.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receiptExamplePath = resolve(repoRoot, "scripts/meta/fixtures/proof-receipt-example.json");

const RECEIPT_KEYS = [
  "commitSha",
  "graphVersion",
  "appId",
  "appMode",
  "accessTier",
  "permissions",
  "externalBusinessAttested",
  "utcStart",
  "utcEnd",
  "hashedMetaObjectIds",
  "probeOutcomes",
  "cleanupReceipts",
  "fixtureHashes",
  "expiresAt",
  "proofExecutor",
  "proofReviewer",
] as const;

/**
 * Step 1B will wire isProofReceiptCurrent into the partner-starts gate: a
 * partner connection may only start while a reviewed proof receipt is current.
 */
describe("meta partner proof receipt", () => {
  test("committed sanitized example satisfies the exact receipt schema", () => {
    const receipt = JSON.parse(readFileSync(receiptExamplePath, "utf8")) as ProofReceipt;

    assert.deepEqual(Object.keys(receipt).sort(), [...RECEIPT_KEYS].sort());
    assert.equal(receipt.externalBusinessAttested, true);
    assert.equal(typeof receipt.commitSha, "string");
    assert.match(receipt.commitSha, /^[0-9a-f]{40}$/);
    assert.match(receipt.graphVersion, /^v\d+\.\d+$/);
    assert.ok(Array.isArray(receipt.permissions) && receipt.permissions.length > 0);
    assert.notEqual(receipt.proofExecutor, receipt.proofReviewer);
    assert.match(receipt.expiresAt, /^\d{4}-\d{2}-\d{2}$/);

    // Every Meta object ID must be a SHA-256 hash — no raw IDs anywhere.
    for (const ids of Object.values(receipt.hashedMetaObjectIds)) {
      for (const id of ids) {
        assert.match(id, /^[0-9a-f]{64}$/);
      }
    }
    for (const probe of receipt.probeOutcomes) {
      assert.ok(["PASS", "FAIL", "SKIP"].includes(probe.status));
    }
    for (const cleanup of receipt.cleanupReceipts) {
      assert.match(cleanup.hashedId, /^[0-9a-f]{64}$/);
      assert.ok(["deleted", "archived", "failed"].includes(cleanup.action));
    }
  });

  test("isProofReceiptCurrent accepts a receipt that has not expired", () => {
    const receipt = { expiresAt: "2026-04-15" };
    assert.equal(isProofReceiptCurrent(receipt, new Date("2026-04-15T00:00:00Z")), true);
    assert.equal(isProofReceiptCurrent(receipt, new Date("2026-04-15T23:59:59.999Z")), true);
  });

  test("isProofReceiptCurrent rejects an expired or malformed receipt", () => {
    const receipt = { expiresAt: "2026-04-15" };
    assert.equal(isProofReceiptCurrent(receipt, new Date("2026-04-16T00:00:00Z")), false);
    assert.equal(isProofReceiptCurrent({ expiresAt: "" }, new Date("2026-01-01T00:00:00Z")), false);
    assert.equal(isProofReceiptCurrent({ expiresAt: "not-a-date" }, new Date("2026-01-01T00:00:00Z")), false);
  });
});

describe("meta partner proof redaction", () => {
  test("removes token-like strings from nested output objects", () => {
    const token = "EAAG_super_secret_system_user_token_value_0123456789";
    const output = {
      authorization: `Bearer ${token}`,
      url: `https://graph.facebook.com/v23.0/me?access_token=${token}&fields=id`,
      nested: {
        list: [token, { page_token: "EAAG_page_token_abcdef0123456789abcdef" }],
        clean: "untouched value",
      },
    };

    const redacted = redactTokenLike(output, [token]) as typeof output;

    assert.equal(JSON.stringify(redacted).includes(token), false);
    assert.equal(redacted.authorization.includes(token), false);
    assert.equal(redacted.url.includes(token), false);
    assert.equal(redacted.url.includes("access_token="), false);
    assert.equal(JSON.stringify(redacted.nested.list).includes("EAAG_page_token"), false);
    assert.equal(redacted.nested.clean, "untouched value");
    // The input object is never mutated.
    assert.equal(output.nested.clean, "untouched value");
  });

  test("hashMetaId never returns the raw ID", () => {
    const hashed = hashMetaId("act_990222000000333");
    assert.match(hashed, /^[0-9a-f]{64}$/);
    assert.equal(hashed.includes("990222000000333"), false);
    assert.equal(hashed, hashMetaId("act_990222000000333"));
    assert.equal(hashMetaId(""), "");
  });
});

describe("meta partner proof bearer enforcement", () => {
  test("moves access_token query parameters into the Bearer header", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const inner = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: input.toString(),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const wrapped = createBearerEnforcingFetch(inner);

    await wrapped("https://graph.facebook.com/v23.0/me/adaccounts?access_token=EAAG_secret_token_0123456789&fields=id", { method: "GET" });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].url.includes("access_token="), false);
    assert.equal(seen[0].authorization, "Bearer EAAG_secret_token_0123456789");
  });
});

describe("meta partner proof dry-run", () => {
  test("external-business enforcement aborts on a Blockwise-owned ad account", async () => {
    const fixture = loadDryRunFixture(resolve(repoRoot, "scripts/meta/fixtures/proof-dry-run.json"));
    const ownedFixture = {
      ...fixture,
      routes: {
        ...fixture.routes,
        "GET /me/adaccounts": {
          data: [{
            id: "act_990222000000333",
            account_id: "990222000000333",
            name: "Blockwise-owned account",
            currency: "AUD",
            timezone_name: "Australia/Perth",
            account_status: 1,
            business: { id: fixture.scenario.blockwiseBusinessId },
          }],
          paging: {},
        },
      },
    };

    await assert.rejects(
      runProof({
        dryRun: true,
        fullPath: false,
        accessToken: "dry-run-token-not-a-real-credential",
        externalBusinessId: fixture.scenario.externalBusinessId,
        adAccountId: fixture.scenario.adAccountId,
        pageId: fixture.scenario.pageId,
        blockwiseBusinessId: fixture.scenario.blockwiseBusinessId,
        appToken: null,
        appId: fixture.scenario.appId,
        accessTier: "full_access",
        appMode: "live",
        permissions: ["ads_read"],
        proofExecutor: "executor",
        proofReviewer: "reviewer",
        outputDir: "/tmp/unused",
        destinationUrl: "https://example.com/proof-destination",
        privacyPolicyUrl: "https://example.com/privacy",
        fetchImpl: createDryRunFetch(ownedFixture),
        writeArtifacts: false,
      }),
      (error: unknown) => error instanceof ProofAbortError && /Blockwise's own Business Portfolio/.test(error.message),
    );
  });

  test("spawning the CLI with --dry-run exits 0 and writes the receipt offline", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "meta-partner-proof-"));
    try {
      const result = spawnSync(process.execPath, [
        "scripts/meta/verify-partner-external.mjs",
        "--dry-run",
        "--full-path",
        "--proof-executor", "operator-a",
        "--proof-reviewer", "operator-b",
        "--access-tier", "full_access",
        "--app-mode", "live",
        "--permissions", "ads_read,ads_management,business_management,leads_retrieval,pages_manage_ads,pages_show_list,pages_read_engagement",
        "--output-dir", outputDir,
      ], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });

      assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
      const receiptPath = join(outputDir, "receipt.json");
      assert.ok(existsSync(receiptPath), "receipt.json was not written");
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as ProofReceipt;
      assert.deepEqual(Object.keys(receipt).sort(), [...RECEIPT_KEYS].sort());
      assert.equal(receipt.externalBusinessAttested, true);
      for (const name of ["ad-account-read.json", "page-token-resolution.json", "instagram-discovery.json", "campaign-create-read.json", "lead-retrieve.json", "insights.json"]) {
        assert.ok(existsSync(join(outputDir, name)), `${name} was not written`);
      }
      // No raw fixture IDs may leak into the receipt.
      assert.equal(readFileSync(receiptPath, "utf8").includes("990222000000333"), false);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
