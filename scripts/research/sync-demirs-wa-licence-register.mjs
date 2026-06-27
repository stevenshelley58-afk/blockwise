#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SOURCE = "demirs_wa_licence_register";
const DEFAULT_LICENCE_TYPES = ["RA", "RR"];
const OLS_BASE_URL = "https://ols.demirs.wa.gov.au";
const PAGE_SIZE = 50;
const USER_AGENT = "Blockwise WA licence-register reconciliation";
const HASH_IN_BATCH_SIZE = 75;
const REST_IN_BATCH_SIZE = 100;
const INSERT_BATCH_SIZE = 500;

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\uFEFF/g, "").trim();
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function loadEnv(path) {
  const env = {};
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[clean(line.slice(0, eq))] = clean(value);
  }
  return env;
}

function parseArgs(argv) {
  const args = {
    envFile: process.env.BLOCKWISE_ENV_FILE || ".env.local",
    licenceTypes: DEFAULT_LICENCE_TYPES,
    concurrency: 6,
    pageSize: PAGE_SIZE,
    maxPages: 0,
    details: true,
    detailsConcurrency: 10,
    requestTimeoutMs: 20000,
    progressEvery: 250,
    dryRun: false,
    skipCrawl: false,
    skipQueue: false,
    sourceLimit: 0,
    fromArtifact: null,
    artifactPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--env-file":
        args.envFile = next();
        break;
      case "--licence-types":
        args.licenceTypes = next().split(",").map((item) => clean(item).toUpperCase()).filter(Boolean);
        break;
      case "--concurrency":
        args.concurrency = Number.parseInt(next(), 10);
        break;
      case "--page-size":
        args.pageSize = Number.parseInt(next(), 10);
        break;
      case "--max-pages":
        args.maxPages = Number.parseInt(next(), 10);
        break;
      case "--skip-details":
        args.details = false;
        break;
      case "--details-concurrency":
        args.detailsConcurrency = Number.parseInt(next(), 10);
        break;
      case "--request-timeout-ms":
        args.requestTimeoutMs = Number.parseInt(next(), 10);
        break;
      case "--progress-every":
        args.progressEvery = Number.parseInt(next(), 10);
        break;
      case "--source-limit":
        args.sourceLimit = Number.parseInt(next(), 10);
        break;
      case "--from-artifact":
        args.fromArtifact = next();
        break;
      case "--artifact-path":
        args.artifactPath = next();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--skip-crawl":
        args.skipCrawl = true;
        break;
      case "--skip-queue":
        args.skipQueue = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.licenceTypes.length) throw new Error("--licence-types must contain at least one code");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 12) {
    throw new Error("--concurrency must be 1..12");
  }
  if (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > PAGE_SIZE) {
    throw new Error(`--page-size must be 1..${PAGE_SIZE}; DEMIRS caps reliable pages at ${PAGE_SIZE}`);
  }
  if (!Number.isInteger(args.detailsConcurrency) || args.detailsConcurrency < 1 || args.detailsConcurrency > 20) {
    throw new Error("--details-concurrency must be 1..20");
  }
  if (!Number.isInteger(args.requestTimeoutMs) || args.requestTimeoutMs < 5000 || args.requestTimeoutMs > 120000) {
    throw new Error("--request-timeout-ms must be 5000..120000");
  }
  if (!Number.isInteger(args.progressEvery) || args.progressEvery < 0) {
    throw new Error("--progress-every must be >= 0");
  }
  return args;
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameCase(value) {
  const keepUpper = new Set(["WA", "REIWA", "CBD", "NT", "SA"]);
  return clean(value)
    .toLowerCase()
    .replace(/\b([a-z])([a-z'\u2019-]*)/g, (_, first, rest) => `${first.toUpperCase()}${rest}`)
    .replace(/\bPty\b/g, "Pty")
    .replace(/\bLtd\b/g, "Ltd")
    .replace(/\bWa\b/g, "WA")
    .split(/\s+/)
    .map((part) => (keepUpper.has(part.toUpperCase()) ? part.toUpperCase() : part))
    .join(" ");
}

function personNameFromRegister(value) {
  const raw = clean(value);
  if (!raw) return { fullName: null, givenName: null, familyName: null };
  const [familyRaw, ...givenParts] = raw.split(",");
  if (givenParts.length === 0) {
    const fullName = nameCase(raw);
    return { fullName, givenName: null, familyName: null };
  }
  const family = clean(familyRaw).replace(/^\(NO SURNAME\)$/iu, "");
  const given = clean(givenParts.join(","));
  const fullName = [given, family].filter(Boolean).map(nameCase).join(" ").trim();
  return {
    fullName: fullName || nameCase(raw),
    givenName: given ? nameCase(given) : null,
    familyName: family ? nameCase(family) : null,
  };
}

function firstTradingName(record) {
  const names = Array.isArray(record.tradingNames) ? record.tradingNames : [];
  return clean(names.find((item) => clean(item?.tradingName))?.tradingName || "");
}

function postcodeFromRecord(record) {
  return clean(record.address?.postcode || "");
}

function suburbFromRecord(record) {
  return nameCase(record.address?.town || "");
}

function licenceExternalId(record) {
  return `demirs:${clean(record.actualLicenceTypeCode)}:${clean(record.licenceNumber)}:${clean(record.entityId)}:${clean(record.licenceId)}`;
}

function detailUrl(record) {
  const parts = [
    record.licenceId,
    record.entityId,
    record.actualLicenceTypeCode,
    record.licenceSubTypeCode,
    record.licenceStatus,
  ].map((part) => encodeURIComponent(String(part ?? "")));
  return `${OLS_BASE_URL}/api/Search/details/${parts.join("/")}`;
}

function officialMetadata(record, lookup) {
  const details = record.__details || {};
  return {
    source_system: "demirs_ols",
    official_register: "WA Online Licence Search",
    licence_type: record.actualLicenceTypeCode || null,
    licence_type_description: record.licenceTypeDescription || lookup.get(record.actualLicenceTypeCode)?.displayValue || null,
    licence_subtype: record.licenceSubTypeCode || null,
    licence_subtype_description: record.licenceSubTypeDescription || null,
    licence_status: record.licenceStatus || null,
    licence_number: clean(record.licenceNumber) || null,
    licence_id: clean(record.licenceId) || null,
    entity_id: clean(record.entityId) || null,
    entity_type: record.entityType || null,
    entity_name: record.entityName || null,
    licensee_name: record.licenceeName || null,
    trading_names: Array.isArray(record.tradingNames) ? record.tradingNames.map((item) => item.tradingName).filter(Boolean) : [],
    employed_by: namesFromDetailList(details.employedBy),
    employees_on_register: namesFromDetailList(details.employeesOnRegister),
    persons_in_management: namesFromDetailList(details.personsInManagement),
    supervisors: namesFromDetailList(details.supervisors),
    supervisor_of: namesFromDetailList(details.supervisorOf),
    expiry_date: record.expiryDate || null,
    address: record.address || null,
    postcode: postcodeFromRecord(record) || null,
    suburb: suburbFromRecord(record) || null,
    state: record.address?.state || "WA",
    discovered_by: "scripts/research/sync-demirs-wa-licence-register.mjs",
  };
}

function sourceDocumentFromRecord(record, lookup) {
  const canonical = stableStringify({
    actualLicenceTypeCode: record.actualLicenceTypeCode,
    licenceNumber: record.licenceNumber,
    entityId: record.entityId,
    licenceId: record.licenceId,
    licenceSubTypeCode: record.licenceSubTypeCode,
    licenceStatus: record.licenceStatus,
    entityName: record.entityName,
    licenceeName: record.licenceeName,
    entityType: record.entityType,
    expiryDate: record.expiryDate,
    address: record.address,
    tradingNames: record.tradingNames,
    details: relationshipDetails(record.__details),
  });
  return {
    source: SOURCE,
    source_url: detailUrl(record),
    source_external_id: licenceExternalId(record),
    fetched_at: now(),
    content_hash: hash(canonical),
    mime_type: "application/json",
    byte_size: Buffer.byteLength(canonical, "utf8"),
    metadata: officialMetadata(record, lookup),
  };
}

function namesFromDetailList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => clean(item?.name))
    .filter(Boolean);
}

function firstDetailName(value) {
  return namesFromDetailList(value)[0] || null;
}

function relationshipDetails(details) {
  if (!details || typeof details !== "object") return null;
  return {
    employedBy: namesFromDetailList(details.employedBy),
    employeesOnRegister: namesFromDetailList(details.employeesOnRegister),
    personsInManagement: namesFromDetailList(details.personsInManagement),
    supervisors: namesFromDetailList(details.supervisors),
    supervisorOf: namesFromDetailList(details.supervisorOf),
    employees: namesFromDetailList(details.employees),
  };
}

function subjectFromRecord(record, sourceDocumentId) {
  const licenceType = clean(record.actualLicenceTypeCode).toUpperCase();
  const subtype = clean(record.licenceSubTypeCode).toUpperCase();
  const postcode = postcodeFromRecord(record);
  const suburb = suburbFromRecord(record);
  const tradingName = firstTradingName(record);
  const legalName = clean(record.entityName);
  const details = record.__details || {};
  const relationship = relationshipDetails(details);
  const licenceNumber = clean(record.licenceNumber);
  const sourceUrl = detailUrl(record);
  const evidence = {
    source: SOURCE,
    evidence_url: sourceUrl,
    licence_number: licenceNumber,
    licence_type: licenceType,
    licence_type_description: record.licenceTypeDescription || null,
    licence_subtype: subtype || null,
    licence_status: record.licenceStatus || null,
    expiry_date: record.expiryDate || null,
    entity_id: clean(record.entityId) || null,
    licence_id: clean(record.licenceId) || null,
    register_address: record.address || null,
    trading_names: Array.isArray(record.tradingNames) ? record.tradingNames.map((item) => item.tradingName).filter(Boolean) : [],
    relationships: relationship,
  };

  const isOrganisation = Boolean(legalName) && (["C", "P"].includes(subtype) || /body corporate|company|partnership|firm/iu.test(clean(record.entityType)));
  if (isOrganisation) {
    const name = nameCase(tradingName || legalName);
    return {
      kind: "agency",
      name,
      normalizedName: normalizeName(name),
      tradingName: tradingName ? nameCase(tradingName) : null,
      legalName: legalName ? nameCase(legalName) : null,
      licenceNumber,
      postcode,
      suburb,
      sourceDocumentId,
      sourceUrl,
      evidence,
      metadata: {
        demirs_wa_licence_register: {
          ...evidence,
          legal_entity_name: legalName || null,
          employees_on_register: relationship?.employeesOnRegister || [],
          persons_in_management: relationship?.personsInManagement || [],
        },
      },
    };
  }

  const parsedName = personNameFromRegister(record.licenceeName || record.entityName);
  if (!parsedName.fullName) return null;
  return {
    kind: "agent",
    fullName: parsedName.fullName,
    normalizedName: normalizeName(parsedName.fullName),
    givenName: parsedName.givenName,
    familyName: parsedName.familyName,
    licenceNumber,
    postcode,
    suburb,
    sourceDocumentId,
    sourceUrl,
    agencyHintName: firstDetailName(details.employedBy),
    evidence,
    metadata: {
      demirs_wa_licence_register: evidence,
    },
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, retries = 3, timeoutMs = 20000) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json,text/json,text/plain,*/*",
          "User-Agent": USER_AGENT,
        },
      });
      clearTimeout(timeout);
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
      return text ? JSON.parse(text) : {};
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchLicencePage(licenceType, pageIndex, pageSize, timeoutMs) {
  const params = new URLSearchParams({
    LicenceType: licenceType,
    SearchAll: "true",
    "PagingParameters.PageIndex": String(pageIndex),
    "PagingParameters.PageSize": String(pageSize),
  });
  return fetchJson(`${OLS_BASE_URL}/api/Search/licence/licenceType?${params.toString()}`, 3, timeoutMs);
}

async function fetchLicenceTypes(timeoutMs) {
  const rows = await fetchJson(`${OLS_BASE_URL}/api/Lookup/licencetypes`, 3, timeoutMs);
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.code, row]));
}

async function fetchLicenceDetails(record, timeoutMs) {
  const parts = [
    record.licenceId,
    record.entityId,
    record.actualLicenceTypeCode,
    record.licenceSubTypeCode,
    record.licenceStatus,
  ];
  if (parts.some((part) => part === null || typeof part === "undefined" || clean(part) === "")) return null;
  return fetchJson(detailUrl(record), 2, timeoutMs);
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, run));
  return results;
}

async function crawlDemirs(args) {
  const lookup = await fetchLicenceTypes(args.requestTimeoutMs);
  const recordsByKey = new Map();
  const crawlStats = {
    lookupLicenceTypes: lookup.size,
    licenceTypes: {},
    pagesFetched: 0,
    duplicateRecords: 0,
  };

  for (const licenceType of args.licenceTypes) {
    const first = await fetchLicencePage(licenceType, 0, args.pageSize, args.requestTimeoutMs);
    const totalRecords = Number(first.totalRecords || 0);
    const pageCount = Math.ceil(totalRecords / args.pageSize);
    const effectivePageCount = args.maxPages > 0 ? Math.min(pageCount, args.maxPages) : pageCount;
    crawlStats.pagesFetched += 1;
    crawlStats.licenceTypes[licenceType] = {
      totalRecords,
      pageCount,
      pagesFetched: effectivePageCount,
      firstPageRecords: first.licenceResponseDtos?.length || 0,
    };

    for (const record of first.licenceResponseDtos || []) {
      const key = licenceExternalId(record);
      if (recordsByKey.has(key)) crawlStats.duplicateRecords += 1;
      recordsByKey.set(key, record);
    }

    const pageIndexes = [];
    for (let pageIndex = 1; pageIndex < effectivePageCount; pageIndex += 1) pageIndexes.push(pageIndex);
    const pages = await mapLimit(pageIndexes, args.concurrency, async (pageIndex) => {
      const page = await fetchLicencePage(licenceType, pageIndex, args.pageSize, args.requestTimeoutMs);
      crawlStats.pagesFetched += 1;
      if (args.progressEvery && crawlStats.pagesFetched % Math.max(1, Math.min(args.progressEvery, 25)) === 0) {
        console.error(`[demirs] pages fetched: ${crawlStats.pagesFetched}`);
      }
      return page;
    });
    for (const page of pages) {
      for (const record of page.licenceResponseDtos || []) {
        const key = licenceExternalId(record);
        if (recordsByKey.has(key)) crawlStats.duplicateRecords += 1;
        recordsByKey.set(key, record);
      }
    }
  }

  if (args.details) {
    const records = [...recordsByKey.values()];
    let detailsFetched = 0;
    let detailsFailed = 0;
    await mapLimit(records, args.detailsConcurrency, async (record) => {
      try {
        record.__details = await fetchLicenceDetails(record, args.requestTimeoutMs);
        detailsFetched += 1;
      } catch (error) {
        record.__detailError = error instanceof Error ? error.message : String(error);
        detailsFailed += 1;
      }
      const checked = detailsFetched + detailsFailed;
      if (args.progressEvery && checked % args.progressEvery === 0) {
        console.error(`[demirs] details checked: ${checked}/${records.length} fetched=${detailsFetched} failed=${detailsFailed}`);
      }
    });
    crawlStats.detailsFetched = detailsFetched;
    crawlStats.detailsFailed = detailsFailed;
  }

  return { lookup, records: [...recordsByKey.values()], crawlStats };
}

async function fetchAll(queryFactory, limit = 0) {
  const pageSize = 1000;
  let rows = [];
  for (let from = 0; ; from += pageSize) {
    const rangeEnd = limit > 0 ? Math.min(from + pageSize - 1, limit - 1) : from + pageSize - 1;
    const { data, error } = await queryFactory().range(from, rangeEnd);
    if (error) throw new Error(error.message);
    rows = rows.concat(data ?? []);
    if (!data || data.length < pageSize || (limit > 0 && rows.length >= limit)) break;
  }
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchExistingSourceDocuments(research, docs) {
  const hashes = [...new Set(docs.map((doc) => doc.content_hash))];
  const rows = [];
  for (const batch of chunks(hashes, HASH_IN_BATCH_SIZE)) {
    rows.push(
      ...(await fetchAll(() =>
        research
          .from("source_documents")
          .select("id,source_external_id,content_hash,fetched_at")
          .eq("source", SOURCE)
          .in("content_hash", batch),
      )),
    );
  }
  return rows;
}

async function persistSourceDocuments(research, docs, dryRun) {
  const existing = await fetchExistingSourceDocuments(research, docs);
  const existingHashes = new Set(existing.map((row) => row.content_hash));
  const toInsert = docs.filter((doc) => !existingHashes.has(doc.content_hash));
  if (!dryRun) {
    for (const batch of chunks(toInsert, INSERT_BATCH_SIZE)) {
      const { error } = await research.from("source_documents").insert(batch);
      if (error && !/duplicate key value violates unique constraint|source_documents_content_hash_idx/iu.test(error.message)) {
        throw new Error(error.message);
      }
    }
  }

  const insertedOrExisting = dryRun ? existing : await fetchExistingSourceDocuments(research, docs);
  const byHash = new Map();
  for (const row of insertedOrExisting) {
    const prev = byHash.get(row.content_hash);
    if (!prev || String(row.fetched_at || "") > String(prev.fetched_at || "")) byHash.set(row.content_hash, row);
  }

  return {
    inserted: dryRun ? 0 : toInsert.length,
    skippedExisting: docs.length - toInsert.length,
    byHash,
  };
}

function mergeMetadata(existing, patch) {
  return {
    ...(existing || {}),
    ...patch,
  };
}

async function fetchExistingAgencies(research, agencySubjects) {
  const normalizedNames = [...new Set(agencySubjects.map((item) => item.normalizedName).filter(Boolean))];
  const rows = [];
  for (const batch of chunks(normalizedNames, REST_IN_BATCH_SIZE)) {
    rows.push(
      ...(await fetchAll(() =>
        research
          .from("agencies")
          .select("id,name,normalized_name,state,metadata,licence_number,primary_postcode,primary_suburb,website_url,confidence,status")
          .eq("state", "WA")
          .in("normalized_name", batch),
      )),
    );
  }
  return new Map(rows.map((row) => [row.normalized_name, row]));
}

async function upsertAgencies(research, agencySubjects, dryRun) {
  const byNormalized = new Map();
  for (const subject of agencySubjects) {
    if (!subject.normalizedName) continue;
    const existing = byNormalized.get(subject.normalizedName);
    if (!existing) {
      byNormalized.set(subject.normalizedName, subject);
      continue;
    }
    const existingScore = (existing.licenceNumber ? 2 : 0) + (existing.tradingName ? 1 : 0) + (existing.postcode ? 1 : 0);
    const score = (subject.licenceNumber ? 2 : 0) + (subject.tradingName ? 1 : 0) + (subject.postcode ? 1 : 0);
    if (score > existingScore) byNormalized.set(subject.normalizedName, subject);
  }
  const subjects = [...byNormalized.values()];
  const existing = await fetchExistingAgencies(research, subjects);
  const rows = subjects.map((subject) => {
    const current = existing.get(subject.normalizedName);
    return {
      name: subject.name,
      trading_name: subject.tradingName || null,
      licence_number: current?.licence_number || subject.licenceNumber || null,
      state: "WA",
      primary_postcode: subject.postcode || current?.primary_postcode || null,
      primary_suburb: subject.suburb || current?.primary_suburb || null,
      website_url: current?.website_url || null,
      is_real_estate: true,
      status: "licensed_verified",
      review_status: "ready",
      confidence: Math.max(Number(current?.confidence || 0), 96),
      metadata: mergeMetadata(current?.metadata, subject.metadata),
      last_seen_at: now(),
    };
  });

  let upserted = [];
  if (!dryRun && rows.length) {
    for (const batch of chunks(rows, INSERT_BATCH_SIZE)) {
      const { data, error } = await research
        .from("agencies")
        .upsert(batch, { onConflict: "normalized_name,state" })
        .select("id,normalized_name,name,licence_number,metadata");
      if (error) throw new Error(error.message);
      upserted.push(...(data || []));
    }
  } else {
    upserted = subjects.map((subject) => ({ id: `dry-run-agency:${subject.normalizedName}`, normalized_name: subject.normalizedName, name: subject.name }));
  }

  return {
    rows: upserted,
    matched: subjects.filter((subject) => existing.has(subject.normalizedName)).length,
    inserted: subjects.filter((subject) => !existing.has(subject.normalizedName)).length,
    idBySubjectKey: new Map(upserted.map((row) => [row.normalized_name, row.id])),
  };
}

async function fetchExistingAgents(research, agentSubjects) {
  const licenceNumbers = [...new Set(agentSubjects.map((item) => item.licenceNumber).filter(Boolean))];
  const normalizedNames = [...new Set(agentSubjects.map((item) => item.normalizedName).filter(Boolean))];
  const rows = [];
  for (const batch of chunks(licenceNumbers, REST_IN_BATCH_SIZE)) {
    rows.push(
      ...(await fetchAll(() =>
        research
          .from("agents")
          .select("id,full_name,normalized_name,state,metadata,licence_number,primary_postcode,primary_suburb,website_url,confidence,status,agency_id")
          .eq("state", "WA")
          .in("licence_number", batch),
      )),
    );
  }
  for (const batch of chunks(normalizedNames, REST_IN_BATCH_SIZE)) {
    rows.push(
      ...(await fetchAll(() =>
        research
          .from("agents")
          .select("id,full_name,normalized_name,state,metadata,licence_number,primary_postcode,primary_suburb,website_url,confidence,status,agency_id")
          .eq("state", "WA")
          .in("normalized_name", batch),
      )),
    );
  }
  const byLicence = new Map();
  const byNormalized = new Map();
  for (const row of rows) {
    if (row.licence_number && !byLicence.has(row.licence_number)) byLicence.set(row.licence_number, row);
    if (row.normalized_name && !byNormalized.has(row.normalized_name)) byNormalized.set(row.normalized_name, row);
  }
  return { byLicence, byNormalized };
}

async function upsertAgents(research, agentSubjects, dryRun) {
  const byKey = new Map();
  for (const subject of agentSubjects) {
    const key = subject.licenceNumber ? `licence:${subject.licenceNumber}` : `name:${subject.normalizedName}`;
    if (!byKey.has(key)) byKey.set(key, subject);
  }
  const subjects = [...byKey.values()];
  const existing = await fetchExistingAgents(research, subjects);
  const toUpdate = [];
  const toInsert = [];
  const idBySubjectKey = new Map();

  for (const subject of subjects) {
    const current =
      (subject.licenceNumber ? existing.byLicence.get(subject.licenceNumber) : null) ||
      existing.byNormalized.get(subject.normalizedName);
    if (current) {
      idBySubjectKey.set(subject.licenceNumber || subject.normalizedName, current.id);
      toUpdate.push({
        id: current.id,
        patch: {
          licence_number: current.licence_number || subject.licenceNumber || null,
          primary_postcode: subject.postcode || current.primary_postcode || null,
          primary_suburb: subject.suburb || current.primary_suburb || null,
          agency_id: current.agency_id || subject.agencyId || null,
          status: "licensed_verified",
          review_status: "ready",
          confidence: Math.max(Number(current.confidence || 0), 96),
          metadata: mergeMetadata(current.metadata, subject.metadata),
          last_seen_at: now(),
        },
      });
    } else {
      toInsert.push({
        full_name: subject.fullName,
        given_name: subject.givenName,
        family_name: subject.familyName,
        licence_number: subject.licenceNumber || null,
        agency_id: subject.agencyId || null,
        agency_role: subject.evidence.licence_type_description || null,
        state: "WA",
        primary_postcode: subject.postcode || null,
        primary_suburb: subject.suburb || null,
        website_url: null,
        status: "licensed_verified",
        review_status: "ready",
        confidence: 96,
        metadata: subject.metadata,
        last_seen_at: now(),
      });
    }
  }

  if (!dryRun) {
    for (const item of toUpdate) {
      const { error } = await research.from("agents").update(item.patch).eq("id", item.id);
      if (error) throw new Error(error.message);
    }
    for (const batch of chunks(toInsert, INSERT_BATCH_SIZE)) {
      const { data, error } = await research.from("agents").insert(batch).select("id,licence_number,normalized_name");
      if (error) throw new Error(error.message);
      for (const row of data || []) idBySubjectKey.set(row.licence_number || row.normalized_name, row.id);
    }
  } else {
    for (const subject of toInsert) idBySubjectKey.set(subject.licence_number || subject.normalized_name, `dry-run-agent:${subject.normalized_name}`);
  }

  return {
    matched: toUpdate.length,
    inserted: toInsert.length,
    idBySubjectKey,
  };
}

async function insertMissingServiceAreas(research, serviceAreas, dryRun) {
  const areas = serviceAreas.filter((row) => row.postcode && row.suburb && (row.agent_id || row.agency_id));
  if (!areas.length) return { inserted: 0, matched: 0 };
  if (dryRun) return { inserted: areas.length, matched: 0 };
  const existing = [];
  for (const batch of chunks(areas.filter((row) => row.agent_id).map((row) => row.agent_id), REST_IN_BATCH_SIZE)) {
    if (!batch.length) continue;
    existing.push(...(await fetchAll(() => research.from("agent_service_areas").select("id,agent_id,agency_id,postcode,suburb,state,match_type").in("agent_id", batch))));
  }
  for (const batch of chunks(areas.filter((row) => row.agency_id).map((row) => row.agency_id), REST_IN_BATCH_SIZE)) {
    if (!batch.length) continue;
    existing.push(...(await fetchAll(() => research.from("agent_service_areas").select("id,agent_id,agency_id,postcode,suburb,state,match_type").in("agency_id", batch))));
  }
  const key = (row) => [row.agent_id || "", row.agency_id || "", row.postcode, row.suburb, row.state, row.match_type].join("|");
  const seen = new Set(existing.map(key));
  const unique = new Map();
  for (const row of areas) {
    const areaKey = key(row);
    if (!seen.has(areaKey) && !unique.has(areaKey)) unique.set(areaKey, row);
  }
  const toInsert = [...unique.values()];
  if (!dryRun) {
    for (const batch of chunks(toInsert, INSERT_BATCH_SIZE)) {
      const { error } = await research.from("agent_service_areas").insert(batch);
      if (error) throw new Error(error.message);
    }
  }
  return { inserted: toInsert.length, matched: areas.length - toInsert.length };
}

async function fetchExistingDecisions(research, subjects) {
  const rows = [];
  const agents = subjects.filter((item) => item.kind === "agent").map((item) => item.id);
  const agencies = subjects.filter((item) => item.kind === "agency").map((item) => item.id);
  for (const batch of chunks(agents, REST_IN_BATCH_SIZE)) {
    if (!batch.length) continue;
    rows.push(...(await fetchAll(() => research.from("agent_decisions").select("id,subject_type,subject_id,decision").eq("decision_type", "real_estate_verification").eq("subject_type", "agent").in("subject_id", batch))));
  }
  for (const batch of chunks(agencies, REST_IN_BATCH_SIZE)) {
    if (!batch.length) continue;
    rows.push(...(await fetchAll(() => research.from("agent_decisions").select("id,subject_type,subject_id,decision").eq("decision_type", "real_estate_verification").eq("subject_type", "agency").in("subject_id", batch))));
  }
  const bySubject = new Map();
  for (const row of rows) {
    if (row.decision?.method !== "demirs_licence_register") continue;
    const key = `${row.subject_type}:${row.subject_id}:${row.decision?.licence_number || ""}`;
    if (!bySubject.has(key)) bySubject.set(key, row.id);
  }
  return bySubject;
}

async function ensureDecisions(research, subjects, dryRun) {
  if (dryRun) {
    return {
      inserted: subjects.length,
      matched: 0,
      idBySubject: new Map(
        subjects.map((subject) => [
          `${subject.kind}:${subject.id}:${subject.licenceNumber || ""}`,
          `dry-run-decision:${subject.kind}:${subject.id}`,
        ]),
      ),
    };
  }
  const existing = await fetchExistingDecisions(research, subjects);
  const toInsert = [];
  const idBySubject = new Map(existing);
  for (const subject of subjects) {
    const key = `${subject.kind}:${subject.id}:${subject.licenceNumber || ""}`;
    if (existing.has(key)) continue;
    toInsert.push({
      decision_type: "real_estate_verification",
      subject_type: subject.kind,
      subject_id: subject.id,
      decision: {
        verified: true,
        method: "demirs_licence_register",
        licence_number: subject.licenceNumber || null,
        licence_type: subject.evidence.licence_type || null,
        licence_status: subject.evidence.licence_status || null,
        agency_id: subject.kind === "agent" ? subject.agencyId || null : null,
        postcode: subject.postcode || null,
        suburb: subject.suburb || null,
        location_search_allowed: false,
      },
      rationale: "Verified from the official WA Online Licence Search before any page or ad collection.",
      confidence: 96,
      evidence: {
        urls: [subject.sourceUrl],
        official_register: "WA Online Licence Search",
        licence_number: subject.licenceNumber || null,
        name: subject.kind === "agency" ? subject.name : subject.fullName,
      },
      source_document_ids: [subject.sourceDocumentId],
      hermes_skill: "demirs-wa-licence-register",
      model: "deterministic",
    });
  }
  if (!dryRun) {
    for (const batch of chunks(toInsert, INSERT_BATCH_SIZE)) {
      const { data, error } = await research
        .from("agent_decisions")
        .insert(batch)
        .select("id,subject_type,subject_id,decision");
      if (error) throw new Error(error.message);
      for (const row of data || []) {
        idBySubject.set(`${row.subject_type}:${row.subject_id}:${row.decision?.licence_number || ""}`, row.id);
      }
    }
  } else {
    for (const row of toInsert) {
      idBySubject.set(`${row.subject_type}:${row.subject_id}:${row.decision.licence_number || ""}`, `dry-run-decision:${row.subject_type}:${row.subject_id}`);
    }
  }
  return { inserted: toInsert.length, matched: subjects.length - toInsert.length, idBySubject };
}

async function insertMissingVerifications(research, subjects, dryRun) {
  if (dryRun) return { inserted: subjects.length, matched: 0 };
  const existing = [];
  const agents = subjects.filter((item) => item.kind === "agent").map((item) => item.id);
  const agencies = subjects.filter((item) => item.kind === "agency").map((item) => item.id);
  for (const batch of chunks(agents, REST_IN_BATCH_SIZE)) {
    if (!batch.length) continue;
    existing.push(...(await fetchAll(() => research.from("real_estate_verifications").select("id,subject_type,subject_id,evidence").eq("evidence_type", "licence_register").eq("subject_type", "agent").in("subject_id", batch))));
  }
  for (const batch of chunks(agencies, REST_IN_BATCH_SIZE)) {
    if (!batch.length) continue;
    existing.push(...(await fetchAll(() => research.from("real_estate_verifications").select("id,subject_type,subject_id,evidence").eq("evidence_type", "licence_register").eq("subject_type", "agency").in("subject_id", batch))));
  }
  const seen = new Set(existing.map((row) => `${row.subject_type}:${row.subject_id}:${row.evidence?.licence_number || ""}`));
  const toInsert = subjects
    .filter((subject) => !seen.has(`${subject.kind}:${subject.id}:${subject.licenceNumber || ""}`))
    .map((subject) => ({
      subject_type: subject.kind,
      subject_id: subject.id,
      agent_id: subject.kind === "agent" ? subject.id : null,
      agency_id: subject.kind === "agency" ? subject.id : subject.agencyId || null,
      verification_status: "verified",
      evidence_type: "licence_register",
      evidence_url: subject.sourceUrl,
      evidence: {
        ...subject.evidence,
        name: subject.kind === "agency" ? subject.name : subject.fullName,
      },
      source_document_id: subject.sourceDocumentId,
      verified_by: "demirs-wa-licence-register",
      verified_at: now(),
      confidence: 96,
      notes: "Official WA Online Licence Search verification.",
    }));
  if (!dryRun) {
    for (const batch of chunks(toInsert, INSERT_BATCH_SIZE)) {
      const { error } = await research.from("real_estate_verifications").insert(batch);
      if (error) throw new Error(error.message);
    }
  }
  return { inserted: toInsert.length, matched: subjects.length - toInsert.length };
}

function queueRowForSubject(subject, decisionId) {
  return {
    queue_name: "research",
    job_type: "blockwise-page-resolver",
    dedupe_key: `page-resolver:${subject.kind}:${subject.id}`,
    priority: subject.kind === "agent" ? 18 : 20,
    payload: {
      subjectKind: subject.kind,
      subjectId: subject.id,
      censusDecisionId: decisionId,
      sourceDocumentIds: [subject.sourceDocumentId],
      ...(subject.kind === "agent"
        ? { agentName: subject.fullName, agencyId: subject.agencyId || null, agencyName: subject.agencyName || null }
        : { agencyName: subject.name }),
      forceRevisit: false,
      location_search_allowed: false,
      officialRegister: SOURCE,
      licenceNumber: subject.licenceNumber || null,
      postcode: subject.postcode || null,
      suburb: subject.suburb || null,
    },
    status: "pending",
    max_attempts: 3,
  };
}

async function queuePageResolvers(research, subjects, decisions, dryRun) {
  const rows = subjects
    .map((subject) => {
      const decisionId = decisions.idBySubject.get(`${subject.kind}:${subject.id}:${subject.licenceNumber || ""}`);
      return decisionId ? queueRowForSubject(subject, decisionId) : null;
    })
    .filter(Boolean);
  const dedupeKeys = rows.map((row) => row.dedupe_key);
  if (dryRun) return { inserted: rows.length, recycled: 0, activeSkipped: 0 };
  const existing = [];
  for (const batch of chunks(dedupeKeys, REST_IN_BATCH_SIZE)) {
    existing.push(
      ...(await fetchAll(() =>
        research
          .from("work_queue")
          .select("id,status,dedupe_key")
          .eq("queue_name", "research")
          .in("dedupe_key", batch)
          .in("status", ["pending", "claimed", "failed", "blocked"]),
      )),
    );
  }
  const existingByKey = new Map(existing.map((row) => [row.dedupe_key, row]));
  const active = new Set(existing.filter((row) => row.status === "pending" || row.status === "claimed").map((row) => row.dedupe_key));
  const recyclable = existing.filter((row) => row.status === "failed" || row.status === "blocked");
  const toInsert = rows.filter((row) => !existingByKey.has(row.dedupe_key));
  const rowByKey = new Map(rows.map((row) => [row.dedupe_key, row]));

  if (!dryRun) {
    for (const job of recyclable) {
      const row = rowByKey.get(job.dedupe_key);
      if (!row) continue;
      const { error } = await research
        .from("work_queue")
        .update({
          queue_name: row.queue_name,
          job_type: row.job_type,
          advertiser_page_id: null,
          priority: row.priority,
          payload: row.payload,
          status: "pending",
          available_at: now(),
          claimed_at: null,
          claimed_by: null,
          claim_token: null,
          claim_expires_at: null,
          attempts: 0,
          max_attempts: row.max_attempts,
          last_error: null,
          blocked_reason: null,
          result: {},
          completed_at: null,
        })
        .eq("id", job.id);
      if (error) throw new Error(error.message);
    }
    for (const batch of chunks(toInsert, INSERT_BATCH_SIZE)) {
      const { error } = await research.from("work_queue").insert(batch);
      if (error && !/duplicate key|work_queue_active_dedupe_idx/iu.test(error.message)) throw new Error(error.message);
    }
  }

  return {
    inserted: toInsert.length,
    recycled: recyclable.length,
    activeSkipped: active.size,
  };
}

async function loadSourceDocumentRecords(research, limit) {
  return fetchAll(
    () =>
      research
        .from("source_documents")
        .select("id,source_url,source_external_id,content_hash,metadata")
        .eq("source", SOURCE)
        .order("fetched_at", { ascending: false }),
    limit,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env, ...loadEnv(args.envFile) };
  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  const serviceKey = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SERVICE_ROLE_KEY);
  if (!url || !serviceKey) throw new Error("Missing Supabase service credentials");

  const research = createClient(url, serviceKey, {
    db: { schema: "research" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let lookup = new Map();
  let records = [];
  let crawlStats = null;
  let sourceDocs = [];
  let sourcePersistence = { inserted: 0, skippedExisting: 0, byHash: new Map() };

  if (args.fromArtifact) {
    const artifact = JSON.parse(readFileSync(args.fromArtifact, "utf8"));
    lookup = new Map(artifact.lookup || []);
    records = artifact.records || [];
    crawlStats = artifact.crawlStats || artifact.crawl || null;
    sourceDocs = records.map((record) => sourceDocumentFromRecord(record, lookup));
    sourcePersistence = await persistSourceDocuments(research, sourceDocs, args.dryRun);
  } else if (!args.skipCrawl) {
    const crawled = await crawlDemirs(args);
    lookup = crawled.lookup;
    records = crawled.records;
    crawlStats = crawled.crawlStats;
    sourceDocs = records.map((record) => sourceDocumentFromRecord(record, lookup));
    const artifactPath = args.artifactPath || join("tmp", `demirs-wa-licence-register-${Date.now()}.json`);
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          generated_at: now(),
          licenceTypes: args.licenceTypes,
          crawlStats,
          lookup: [...lookup.entries()],
          records,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.error(`[demirs] crawl artifact written: ${artifactPath}`);
    sourcePersistence = await persistSourceDocuments(research, sourceDocs, args.dryRun);
  } else {
    const rows = await loadSourceDocumentRecords(research, args.sourceLimit);
    sourcePersistence.byHash = new Map(rows.map((row) => [row.content_hash, row]));
    sourceDocs = rows.map((row) => ({
      id: row.id,
      source_external_id: row.source_external_id,
      content_hash: row.content_hash,
      metadata: row.metadata,
    }));
    records = rows.map((row) => ({
      actualLicenceTypeCode: row.metadata?.licence_type,
      licenceTypeDescription: row.metadata?.licence_type_description,
      licenceSubTypeCode: row.metadata?.licence_subtype,
      licenceSubTypeDescription: row.metadata?.licence_subtype_description,
      licenceStatus: row.metadata?.licence_status,
      licenceNumber: row.metadata?.licence_number,
      licenceId: row.metadata?.licence_id,
      entityId: row.metadata?.entity_id,
      entityType: row.metadata?.entity_type,
      entityName: row.metadata?.entity_name,
      licenceeName: row.metadata?.licensee_name,
      expiryDate: row.metadata?.expiry_date,
      address: row.metadata?.address,
      tradingNames: (row.metadata?.trading_names || []).map((tradingName) => ({ tradingName })),
      __details: {
        employedBy: (row.metadata?.employed_by || []).map((name) => ({ name })),
        employeesOnRegister: (row.metadata?.employees_on_register || []).map((name) => ({ name })),
        personsInManagement: (row.metadata?.persons_in_management || []).map((name) => ({ name })),
        supervisors: (row.metadata?.supervisors || []).map((name) => ({ name })),
        supervisorOf: (row.metadata?.supervisor_of || []).map((name) => ({ name })),
      },
    }));
  }

  const sourceDocByHash = sourcePersistence.byHash;
  const subjects = [];
  let skippedMissingSourceDoc = 0;
  let skippedInvalidSubject = 0;
  for (let i = 0; i < records.length; i += 1) {
    const doc = sourceDocs[i]?.content_hash ? sourceDocByHash.get(sourceDocs[i].content_hash) : sourceDocs[i];
    if (!doc?.id && !args.dryRun) {
      skippedMissingSourceDoc += 1;
      continue;
    }
    const subject = subjectFromRecord(records[i], doc?.id || `dry-run-source:${licenceExternalId(records[i])}`);
    if (!subject || !subject.postcode || clean(records[i].address?.state || "WA").toUpperCase() !== "WA") {
      skippedInvalidSubject += 1;
      continue;
    }
    subjects.push(subject);
  }

  const agencySubjects = subjects.filter((subject) => subject.kind === "agency");
  const agentSubjects = subjects.filter((subject) => subject.kind === "agent");
  for (const agent of agentSubjects) {
    const employer = clean(agent.agencyHintName);
    if (!employer) continue;
    const normalizedName = normalizeName(employer);
    if (agencySubjects.some((agency) => agency.normalizedName === normalizedName)) continue;
    agencySubjects.push({
      kind: "agency",
      name: nameCase(employer),
      normalizedName,
      tradingName: null,
      legalName: null,
      licenceNumber: null,
      postcode: agent.postcode,
      suburb: agent.suburb,
      sourceDocumentId: agent.sourceDocumentId,
      sourceUrl: agent.sourceUrl,
      evidence: {
        ...agent.evidence,
        relationship: "employed_by",
        employer_name: employer,
      },
      metadata: {
        demirs_wa_licence_register: {
          source: SOURCE,
          evidence_url: agent.sourceUrl,
          relationship: "employed_by",
          employer_name: employer,
          agent_name: agent.fullName,
          licence_number: agent.licenceNumber || null,
        },
      },
    });
  }
  const agencyResult = await upsertAgencies(research, agencySubjects, args.dryRun);
  for (const agent of agentSubjects) {
    const employer = clean(agent.agencyHintName);
    if (!employer) continue;
    const agencyId = agencyResult.idBySubjectKey.get(normalizeName(employer));
    if (agencyId) {
      agent.agencyId = agencyId;
      agent.agencyName = nameCase(employer);
    }
  }
  const agentResult = await upsertAgents(research, agentSubjects, args.dryRun);

  const resolvedSubjects = [];
  for (const subject of agencySubjects) {
    const id = agencyResult.idBySubjectKey.get(subject.normalizedName);
    if (id) resolvedSubjects.push({ ...subject, id });
  }
  for (const subject of agentSubjects) {
    const id = agentResult.idBySubjectKey.get(subject.licenceNumber || subject.normalizedName);
    if (id) resolvedSubjects.push({ ...subject, id });
  }

  const serviceAreas = resolvedSubjects.map((subject) => ({
    agent_id: subject.kind === "agent" ? subject.id : null,
    agency_id: subject.kind === "agency" ? subject.id : subject.agencyId || null,
    postcode: subject.postcode,
    suburb: subject.suburb || subject.postcode,
    state: "WA",
    match_type: subject.kind === "agent" ? "agent_profile_listing" : "office_postcode",
    confidence: 96,
    evidence: {
      source: SOURCE,
      evidence_url: subject.sourceUrl,
      licence_number: subject.licenceNumber || null,
      licence_type: subject.evidence.licence_type || null,
    },
    source_document_id: subject.sourceDocumentId,
  }));
  const serviceAreaResult = await insertMissingServiceAreas(research, serviceAreas, args.dryRun);
  const verificationResult = await insertMissingVerifications(research, resolvedSubjects, args.dryRun);
  const decisionResult = await ensureDecisions(research, resolvedSubjects, args.dryRun);
  const queueResult = args.skipQueue
    ? { inserted: 0, recycled: 0, activeSkipped: 0, skipped: true }
    : await queuePageResolvers(research, resolvedSubjects, decisionResult, args.dryRun);

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        source: SOURCE,
        licenceTypes: args.licenceTypes,
        fromArtifact: args.fromArtifact,
        crawl: crawlStats,
        sourceDocuments: {
          crawledRecords: records.length,
          inserted: sourcePersistence.inserted,
          skippedExisting: sourcePersistence.skippedExisting,
          skippedMissingSourceDoc,
          skippedInvalidSubject,
        },
        subjects: {
          agencies: agencySubjects.length,
          agents: agentSubjects.length,
          resolved: resolvedSubjects.length,
        },
        agencies: {
          inserted: agencyResult.inserted,
          matched: agencyResult.matched,
        },
        agents: {
          inserted: agentResult.inserted,
          matched: agentResult.matched,
        },
        serviceAreas: serviceAreaResult,
        realEstateVerifications: verificationResult,
        agentDecisions: {
          inserted: decisionResult.inserted,
          matched: decisionResult.matched,
        },
        pageResolvers: queueResult,
      },
      null,
      2,
    ),
  );
}

function printHelp() {
  console.log(`Usage: node scripts/research/sync-demirs-wa-licence-register.mjs [options]

Options:
  --env-file PATH           Env file with Supabase service credentials. Default: .env.local
  --licence-types RA,RR     DEMIRS licence codes. Default: RA,RR
  --concurrency N           Concurrent DEMIRS page requests, 1..12. Default: 6
  --page-size N             DEMIRS page size, max 50. Default: 50
  --max-pages N             Limit pages per licence type for verification runs. 0 = all
  --skip-details            Do not call DEMIRS detail endpoints for relationship links
  --details-concurrency N   Concurrent DEMIRS detail requests, 1..20. Default: 10
  --request-timeout-ms N    Per-request timeout, 5000..120000. Default: 20000
  --progress-every N        Detail progress log interval. 0 = quiet. Default: 250
  --source-limit N          With --skip-crawl, limit existing source docs to reconcile
  --from-artifact PATH      Reconcile a saved DEMIRS crawl artifact instead of crawling
  --artifact-path PATH      Save crawl artifact to a specific path
  --skip-crawl              Reconcile existing DEMIRS source_documents only
  --skip-queue              Do not enqueue page resolver jobs
  --dry-run                 Crawl/read and report planned writes only`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
