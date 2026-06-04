// Feature flags for staged rollout.
//
// GOOGLE_ADS_ENABLED parks the Google Ads integration for the Meta-only v1
// launch. When false (the default), Google OAuth connect/callback routes are
// blocked, scheduled and on-demand sync skip Google, and the UI hides Google
// surfaces. No Google code is deleted — flip this to "true" (and restore the
// hidden UI toggles) to bring the integration back.
export const GOOGLE_ADS_ENABLED = process.env.GOOGLE_ADS_ENABLED === "true";
