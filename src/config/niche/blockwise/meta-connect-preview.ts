export type MetaConnectPreviewState = "setup" | "missing" | "waiting" | "connected";

export const META_CONNECT_PREVIEW = {
  metaSettingsUrl: "https://business.facebook.com/settings/partners",
  helpUrl: "https://www.facebook.com/business/help/1717412048538897",
  states: [
    { value: "setup", label: "Setup" },
    { value: "missing", label: "Missing access" },
    { value: "waiting", label: "Waiting for approval" },
    { value: "connected", label: "Connected" },
  ] as const satisfies ReadonlyArray<{ value: MetaConnectPreviewState; label: string }>,
  exampleAssets: [
    { label: "Facebook Page", name: "Harbour & Home" },
    { label: "Ad account", name: "Harbour & Home leads" },
  ] as const,
} as const;
