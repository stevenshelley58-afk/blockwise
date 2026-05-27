import { schedules, task } from "@trigger.dev/sdk/v3";

type ProviderSyncPayload = {
  workspaceId: string;
  provider: "meta" | "google";
};

export const syncProviderReports = schedules.task({
  id: "sync-provider-reports",
  cron: "0 */6 * * *",
  run: async () => {
    return {
      synced: true,
      providers: ["meta", "google"],
      note: "Production implementation should call Blockwise provider adapter APIs with scoped service credentials.",
    };
  },
});

export const syncProviderWorkspace = task({
  id: "sync-provider-workspace",
  run: async (payload: ProviderSyncPayload) => {
    return {
      workspaceId: payload.workspaceId,
      provider: payload.provider,
      status: "queued_for_adapter",
    };
  },
});
