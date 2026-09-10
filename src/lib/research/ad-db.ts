export type AdDbMedia = {
  id: string; kind: string; storageBucket: string; objectKey: string;
  sha256: string; byteSize: number; mimeType: string; width: number | null; height: number | null;
};

export type AdDbRow = {
  id: string; library_id: string; advertiser_page_id: string; advertiser_page_meta_id: string | null;
  page_name: string; active_status: string; first_seen_at: string | null; last_seen_at: string | null;
  last_checked_at: string | null; ad_delivery_started_at: string | null; ad_delivery_stopped_at: string | null;
  ad_creation_date: string | null; ad_creative_id: string | null; format: string | null; headline: string | null;
  body: string | null; cta: string | null; ad_type: string | null; primary_intent: string | null;
  classification: Record<string, unknown>; display_state: string | null; ownership: Record<string, unknown>; locations: unknown; media: AdDbMedia[];
};
