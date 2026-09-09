/**
 * Maps raw Meta Graph / worker errors persisted on a publish plan to a
 * sentence a customer can act on. Raw provider text stays available to
 * operators via the plan row and audit logs.
 */
export function friendlyMetaPublishError(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  if (/duplicate question label/i.test(text)) {
    return "Meta rejected the lead form because two questions were identical. That's been fixed on our side — publish again to retry.";
  }
  if (/lead ads until your facebook page accepts|terms of service not accepted/i.test(text)) {
    return "Your Facebook Page hasn't accepted Meta's Lead Ads Terms of Service yet. A Page admin needs to accept them at facebook.com/ads/leadgen/tos, then publish again.";
  }
  if (/bid amount required|bid_amount/i.test(text)) {
    return "Meta rejected the campaign's bid settings. Publish again — the retry uses Meta's automatic bidding.";
  }
  if (/free three-day campaign is currently reserved/i.test(text)) {
    return "A previous publish attempt is still holding your free campaign slot. It's released automatically within a few minutes — try again shortly.";
  }
  if (/provider writes are disabled/i.test(text)) {
    return "Live publishing is currently switched off on the platform. Export your creatives, or try again once publishing opens.";
  }
  if (/access token|session has been invalidated|error validating access token/i.test(text)) {
    return "Meta rejected Blockwise's access to your ad account. Reconnect Meta from Settings → Connections, then publish again.";
  }
  if (/permission|not authorized|unauthori[sz]ed/i.test(text)) {
    return "Blockwise doesn't have permission to manage this ad account or Page on Meta. Check the account share on Meta's side, then publish again.";
  }

  return text;
}
