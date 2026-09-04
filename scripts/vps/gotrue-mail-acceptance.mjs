#!/usr/bin/env node

/**
 * End-to-end GoTrue email acceptance against a non-local controlled target.
 *
 * Default mode is preflight and never makes a request. Set
 * BLOCKWISE_ACCEPTANCE_APPLY=true and provide the documented target/mailbox
 * values to create a disposable user, read its confirmation over JMAP, follow
 * the link once, and prove the same token is rejected on replay. Values and
 * links are deliberately never printed.
 */

import { validateExternalUrl } from "./external-target.mjs";

class AcceptanceFailure extends Error {}

async function run() {
const truthy = process.env.BLOCKWISE_ACCEPTANCE_APPLY === "true";
const flow = process.env.BLOCKWISE_ACCEPTANCE_FLOW || "signup";
const required = [
  "BLOCKWISE_ACCEPTANCE_AUTH_URL",
  "BLOCKWISE_ACCEPTANCE_SITE_URL",
  "BLOCKWISE_ACCEPTANCE_EMAIL",
  "BLOCKWISE_ACCEPTANCE_JMAP_URL",
  "BLOCKWISE_ACCEPTANCE_MAILBOX_USER",
  "BLOCKWISE_ACCEPTANCE_MAILBOX_PASSWORD",
  ...(flow === "signup" ? ["BLOCKWISE_ACCEPTANCE_PASSWORD"] : []),
];

function fail(message) {
  throw new AcceptanceFailure(message);
}

function externalUrl(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const url = validateExternalUrl(raw);
  if (!url) fail(`${name} must be an external HTTPS URL (localhost, private and managed targets are refused)`);
  return url;
}

const authUrl = externalUrl("BLOCKWISE_ACCEPTANCE_AUTH_URL");
const siteUrl = externalUrl("BLOCKWISE_ACCEPTANCE_SITE_URL");
const jmapUrl = externalUrl("BLOCKWISE_ACCEPTANCE_JMAP_URL");
const missing = required.filter((key) => !process.env[key]?.trim());

if (flow !== "signup" && flow !== "magic_link") fail("BLOCKWISE_ACCEPTANCE_FLOW must be signup or magic_link");
if (missing.length > 0 && truthy) fail(`missing required values: ${missing.join(", ")}`);

if (!truthy) {
  console.log(JSON.stringify({ status: "preflight", flow, apply: false, missing }));
  process.exit();
}

const email = process.env.BLOCKWISE_ACCEPTANCE_EMAIL.trim();
const password = process.env.BLOCKWISE_ACCEPTANCE_PASSWORD;
const mailboxUser = process.env.BLOCKWISE_ACCEPTANCE_MAILBOX_USER;
const mailboxPassword = process.env.BLOCKWISE_ACCEPTANCE_MAILBOX_PASSWORD;
const authBase = authUrl.toString().replace(/\/$/u, "");
const jmapBase = jmapUrl.toString().replace(/\/$/u, "");
const startedAt = new Date();

const requestBody = flow === "signup"
  ? { email, password }
  : { email, create_user: true };
const requestPath = flow === "signup" ? "/signup" : "/otp";
const requestResponse = await fetch(`${authBase}${requestPath}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(requestBody),
});
if (!requestResponse.ok) fail(`GoTrue ${flow} request returned ${requestResponse.status}`);

async function jmap(methodCalls) {
  const sessionResponse = await fetch(`${jmapBase}/.well-known/jmap`, {
    headers: { authorization: `Basic ${Buffer.from(`${mailboxUser}:${mailboxPassword}`).toString("base64")}` },
  });
  if (!sessionResponse.ok) throw new Error(`JMAP session returned ${sessionResponse.status}`);
  const session = await sessionResponse.json();
  const accountId = session.primaryAccounts?.["urn:ietf:params:jmap:mail"];
  const apiUrl = session.apiUrl;
  if (!accountId || typeof apiUrl !== "string") throw new Error("JMAP mail account is unavailable");
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${mailboxUser}:${mailboxPassword}`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(methodCalls.map(([name, args, id]) => [name, { accountId, ...args }, id])),
  });
  if (!response.ok) throw new Error(`JMAP API returned ${response.status}`);
  return { data: await response.json(), accountId };
}

let confirmationUrl;
const deadline = Date.now() + Number(process.env.BLOCKWISE_ACCEPTANCE_TIMEOUT_MS || 120000);
while (!confirmationUrl && Date.now() < deadline) {
  try {
    const result = await jmap([
      ["Mailbox/get", { properties: ["id", "name", "role"] }, "mailboxes"],
    ]);
    const mailboxes = result.data.methodResponses?.find((item) => item[0] === "Mailbox/get")?.[1]?.list || [];
    const inbox = mailboxes.find((mailbox) => mailbox.role === "inbox") || mailboxes.find((mailbox) => mailbox.name === "INBOX");
    if (inbox) {
      const query = await jmap([["Email/query", { filter: { inMailbox: inbox.id }, sort: [{ property: "receivedAt", isAscending: false }], limit: 20 }, "query"]]);
      const ids = query.data.methodResponses?.find((item) => item[0] === "Email/query")?.[1]?.ids || [];
      if (ids.length) {
        const messages = await jmap([["Email/get", {
          ids,
          properties: ["receivedAt", "subject", "from", "to", "textBody", "htmlBody", "bodyValues"],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
        }, "messages"]]);
        const list = messages.data.methodResponses?.find((item) => item[0] === "Email/get")?.[1]?.list || [];
        for (const message of list) {
          if (new Date(message.receivedAt || 0) < startedAt) continue;
          if (!Array.isArray(message.to) || !message.to.some((address) => typeof address?.email === "string" && address.email.trim().toLowerCase() === email.toLowerCase())) continue;
          const from = JSON.stringify(message.from || []).toLowerCase();
          const subject = String(message.subject || "").toLowerCase();
          if (!from.includes("blockwise") && !subject.includes("confirm") && !subject.includes("magic")) continue;
          const body = Object.values(message.bodyValues || {}).map((value) => value.value || "").join("\n");
          const match = body.match(/https:\/\/[^\s<>"']+\/auth\/v1\/verify\?[^\s<>"']+/u);
          if (match) {
            confirmationUrl = match[0].replace(/&amp;/gu, "&").replace(/[),.]+$/u, "");
            break;
          }
        }
      }
    }
  } catch (error) {
    if (Date.now() + 10000 >= deadline) fail(error instanceof Error ? error.message : "mailbox polling failed");
  }
  if (!confirmationUrl) await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!confirmationUrl) fail("confirmation message was not found before timeout");

const first = await fetch(confirmationUrl, { redirect: "manual" });
const location = first.headers.get("location") || "";
let accessToken = "";
try {
  const redirected = new URL(location, siteUrl);
  if (redirected.origin !== siteUrl.origin) throw new Error("confirmation redirect origin mismatch");
  accessToken = new URLSearchParams(redirected.hash.replace(/^#/, "")).get("access_token")
    || redirected.searchParams.get("access_token")
    || "";
} catch {
  // A malformed/untrusted redirect is not a session.
}
let userResponseOk = false;
if (accessToken) {
  const userResponse = await fetch(`${authBase}/user`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  userResponseOk = userResponse.ok;
}
const sessionEstablished = (first.status >= 300 && first.status < 400) && Boolean(accessToken) && userResponseOk;
if (!sessionEstablished) fail(`first verification did not establish a session (${first.status})`);

const replay = await fetch(confirmationUrl, { redirect: "manual" });
let replayToken = "";
try {
  const replayLocation = new URL(replay.headers.get("location") || "", siteUrl);
  replayToken = new URLSearchParams(replayLocation.hash.replace(/^#/, "")).get("access_token")
    || replayLocation.searchParams.get("access_token")
    || "";
} catch {
  // A missing or malformed redirect is a rejected replay.
}
const replayRejected = replay.status >= 400 || !replayToken;
if (!replayRejected) fail(`verification token replay was accepted (${replay.status})`);

console.log(JSON.stringify({ status: "passed", flow, requestAccepted: true, mailReceived: true, sessionEstablished: true, replayRejected: true }));
}

run().catch((error) => {
  if (error instanceof AcceptanceFailure) {
    console.error(`acceptance blocked: ${error.message}`);
    process.exitCode = 78;
    return;
  }
  // Runtime failures terminate without echoing URLs, response bodies,
  // credentials, tokens or provider error objects.
  console.error("acceptance failed: runtime error");
  process.exitCode = 1;
});
