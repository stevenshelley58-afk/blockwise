export const AD_RADAR_ACCURACY_SETTING_KEY = "ad_radar_accuracy_audit_latest";
export const AD_RADAR_ACCURACY_SAMPLE_SIZE = 30;
export const AD_RADAR_ACCURACY_WINDOW_DAYS = 7;
export const AD_RADAR_TYPED_WARN_PCT = 70;
export const AD_RADAR_ADVERTISER_WARN_PCT = 90;

const cleanString = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const pct = (count, total) => total <= 0 ? 0 : Number(((count / total) * 100).toFixed(1));

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return Number(value.toFixed(1));
};

const ageHours = (value, current) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, (current.getTime() - timestamp) / 3_600_000);
};

const isTypedClassification = (row) => {
  const adType =
    cleanString(row.ad_type) ??
    cleanString(row.classification?.ad_type) ??
    cleanString(row.classification?.type) ??
    cleanString(row.primary_intent);
  return Boolean(adType && !["other", "unknown", "unclassified"].includes(adType.toLowerCase()));
};

export function summariseAdRadarAccuracyRows(rows, input) {
  const typedClassification = rows.filter(isTypedClassification).length;
  const resolvedAdvertiser = rows.filter((row) => Boolean(row.agent_id || row.agency_id)).length;
  const coverageValues = input.coverageByObservedAdId
    ? rows.map((row) => input.coverageByObservedAdId.get(row.observed_ad_id) === true)
    : null;
  const suburbPostcodeCoverage = coverageValues ? coverageValues.filter(Boolean).length : null;
  const typedClassificationPct = pct(typedClassification, rows.length);
  const resolvedAdvertiserPct = pct(resolvedAdvertiser, rows.length);
  const suburbPostcodeCoveragePct = coverageValues ? pct(suburbPostcodeCoverage ?? 0, rows.length) : null;
  const medianLastSeenAgeHours = median(
    rows.map((row) => ageHours(row.last_seen_at, input.now)).filter((value) => value !== null),
  );

  return {
    version: 1,
    auditedAt: input.now.toISOString(),
    windowDays: AD_RADAR_ACCURACY_WINDOW_DAYS,
    sampleSize: rows.length,
    candidateCount: input.candidateCount ?? rows.length,
    status:
      typedClassificationPct < AD_RADAR_TYPED_WARN_PCT ||
      resolvedAdvertiserPct < AD_RADAR_ADVERTISER_WARN_PCT
        ? "warn"
        : "ok",
    thresholds: {
      typedClassificationPct: AD_RADAR_TYPED_WARN_PCT,
      resolvedAdvertiserPct: AD_RADAR_ADVERTISER_WARN_PCT,
    },
    counts: {
      typedClassification,
      resolvedAdvertiser,
      suburbPostcodeCoverage,
    },
    metrics: {
      typedClassificationPct,
      resolvedAdvertiserPct,
      suburbPostcodeCoveragePct,
      medianLastSeenAgeHours,
    },
    errors: input.errors ?? [],
  };
}

const formatOptionalPct = (value) => value === null ? "unavailable" : `${value.toFixed(1)}%`;
const formatOptionalHours = (value) => value === null ? "unavailable" : `${value.toFixed(1)} hours`;

export function formatAdRadarAccuracyAlert(summary) {
  const subject = `[Blockwise WARN] Ad Radar accuracy ${summary.metrics.typedClassificationPct.toFixed(0)}% typed, ${summary.metrics.resolvedAdvertiserPct.toFixed(0)}% advertiser`;
  const lines = [
    "Ad Radar accuracy needs attention:",
    `  - typed classification: ${summary.metrics.typedClassificationPct.toFixed(1)}% (${summary.counts.typedClassification}/${summary.sampleSize})`,
    `  - resolved advertiser: ${summary.metrics.resolvedAdvertiserPct.toFixed(1)}% (${summary.counts.resolvedAdvertiser}/${summary.sampleSize})`,
    `  - suburb/postcode coverage: ${formatOptionalPct(summary.metrics.suburbPostcodeCoveragePct)}`,
    `  - median last_seen_at age: ${formatOptionalHours(summary.metrics.medianLastSeenAgeHours)}`,
  ];
  if (summary.errors.length > 0) {
    lines.push("", "Audit warnings:", ...summary.errors.map((error) => `  - ${error}`));
  }
  return { subject, text: lines.join("\n") };
}

const sampleRows = (rows, sampleSize) => {
  if (rows.length <= sampleSize) return [...rows];
  return [...rows]
    .map((row) => ({ row, rank: Math.random() }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, sampleSize)
    .map((entry) => entry.row);
};

async function sendAlertEmail(message, env, fetchImpl) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.ALERT_EMAIL_FROM || env.DEMO_NOTIFY_FROM;
  const to = env.ALERT_EMAIL_TO || env.DEMO_NOTIFY_TO || env.BLOCKWISE_OWNER_ALERT_EMAIL;
  if (!apiKey || !from || !to) return false;
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text }),
  });
  if (!response.ok) throw new Error(`accuracy alert email failed ${response.status}`);
  return true;
}

export async function runAdRadarAccuracyAudit({
  researchRest,
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  sampleSize = AD_RADAR_ACCURACY_SAMPLE_SIZE,
  intervalHours = 168,
}) {
  const current = new Date(now());
  const settings = await researchRest(
    "research",
    `runtime_settings?select=setting_value&setting_key=eq.${AD_RADAR_ACCURACY_SETTING_KEY}&limit=1`,
  );
  const lastAuditedAt = Date.parse(settings?.[0]?.setting_value?.auditedAt || "");
  if (Number.isFinite(lastAuditedAt) && current.getTime() - lastAuditedAt < intervalHours * 3_600_000) {
    return { skipped: true, reason: "not_due" };
  }

  const since = new Date(current.getTime() - AD_RADAR_ACCURACY_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await researchRest(
    "research",
    `v_customer_agent_ad_history?select=observed_ad_id,agent_id,agency_id,ad_type,primary_intent,classification,last_seen_at&last_seen_at=gte.${encodeURIComponent(since)}&order=last_seen_at.desc.nullslast&limit=${Math.max(sampleSize * 10, sampleSize)}`,
  );
  const sampledRows = sampleRows(rows || [], sampleSize);
  const ids = [...new Set(sampledRows.map((row) => row.observed_ad_id).filter(Boolean))];
  const coverageByObservedAdId = new Map(ids.map((id) => [id, false]));
  const errors = [];

  if (ids.length > 0) {
    try {
      const matches = await researchRest(
        "research",
        `ad_area_matches?select=observed_ad_id,postcode,suburb&observed_ad_id=in.(${ids.map((id) => `"${String(id).replaceAll("\"", "")}"`).join(",")})`,
      );
      for (const row of matches || []) {
        if (row.observed_ad_id && cleanString(row.postcode) && cleanString(row.suburb)) {
          coverageByObservedAdId.set(row.observed_ad_id, true);
        }
      }
    } catch (error) {
      errors.push(`suburb/postcode coverage query failed: ${error.message}`);
    }
  }

  const summary = summariseAdRadarAccuracyRows(sampledRows, {
    now: current,
    candidateCount: rows?.length || 0,
    coverageByObservedAdId,
    errors,
  });
  await researchRest("research", "runtime_settings?on_conflict=setting_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      setting_key: AD_RADAR_ACCURACY_SETTING_KEY,
      setting_value: summary,
      description: "Latest weekly Ad Radar accuracy audit summary.",
      updated_by: "hermes-ad-radar-accuracy-audit",
    }),
  });

  const alerted = summary.status === "warn"
    ? await sendAlertEmail(formatAdRadarAccuracyAlert(summary), env, fetchImpl)
    : false;
  return { skipped: false, summary, stored: true, alerted };
}
