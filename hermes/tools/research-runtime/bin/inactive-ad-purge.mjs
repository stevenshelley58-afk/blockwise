export async function runInactiveAdPurge({
  researchRest,
  intervalHours = 24,
}) {
  const rows = await researchRest("research", "rpc/purge_confirmed_inactive_ads", {
    method: "POST",
    body: JSON.stringify({
      p_interval_hours: intervalHours,
      p_force: false,
    }),
  });
  const result = rows?.[0];
  if (!result) throw new Error("Inactive-ad purge returned no result");

  return {
    skipped: result.skipped === true,
    reason: result.reason ?? null,
    confirmedInactive: Number(result.confirmed_inactive ?? 0),
    activeMissingMedia: Number(result.active_missing_media ?? 0),
    deleted: Number(result.deleted ?? 0),
  };
}
