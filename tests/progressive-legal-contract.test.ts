import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatBillingAmount,
  getBillingOffer,
} from "../src/lib/billing/offers.ts";

const terms = readFileSync("src/app/(legal)/terms/page.tsx", "utf8");
const privacy = readFileSync("src/app/(legal)/privacy/page.tsx", "utf8");
const deletion = readFileSync("src/app/(legal)/data-deletion/page.tsx", "utf8");

function includesCopy(source: string, copy: string) {
  assert.ok(
    source.replace(/\s+/g, " ").includes(copy),
    `Expected legal source to contain: ${copy}`,
  );
}

test("Terms state the exact self-serve trigger, credit, seat, and Meta-spend rules", () => {
  for (const required of [
    "free creation allowance includes three complete Feed and Story ads before Checkout",
    "seven-day billing trial",
    "first campaign launches or that billing trial ends",
    "100 render credits per billing period",
    "Credits expire at the end of the",
    "do not roll over or transfer",
    "up to five named members",
    "Meta spend is not",
  ]) {
    includesCopy(terms, required);
  }

  assert.match(terms, /getBillingOffer/);
  assert.equal(
    formatBillingAmount(getBillingOffer("US", "self_serve").firstInvoiceAmount, "USD"),
    "US$99",
  );
  assert.equal(
    formatBillingAmount(getBillingOffer("AU", "self_serve").recurringAmount, "AUD"),
    "A$499",
  );
});

test("Terms distinguish managed scope and cancellation from deletion", () => {
  for (const required of [
    "MANAGED_MONTHLY",
    "weekly optimization of up to",
    "four live campaigns",
    "monthly report",
    "Cancellation stops future",
    "Cancelling a subscription does not",
  ]) {
    includesCopy(terms, required);
  }
  const usManaged = getBillingOffer("US", "managed");
  const auManaged = getBillingOffer("AU", "managed");
  assert.equal(formatBillingAmount(usManaged.recurringAmount, usManaged.currency), "US$1,500");
  assert.equal(formatBillingAmount(auManaged.recurringAmount, auManaged.currency), "A$1,500");
});

test("Privacy discloses passwordless, billing, booking, and funnel data without raw-card claims", () => {
  for (const required of [
    "magic-link or one-time-code",
    "Stripe customer, Checkout, subscription, invoice",
    "does not store the full card number",
    "hosted booking identifier",
    "server-confirmed activation and billing milestones",
    "do not store your email address, payment card data, or provider access tokens",
    "Cancelling a subscription does not delete the workspace",
  ]) {
    includesCopy(privacy, required);
  }
});

test("Data Deletion page explains that cancellation is not deletion", () => {
  assert.match(deletion, /Cancelling a paid subscription stops future renewals but does not delete/i);
  assert.match(deletion, /Limited billing, security, audit, or dispute records may still be retained/i);
});
