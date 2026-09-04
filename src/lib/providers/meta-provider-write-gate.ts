type ProviderWriteEnvironment = {
  BLOCKWISE_ENABLE_PROVIDER_WRITES?: string;
  BLOCKWISE_META_PUBLISH_WORKSPACE_ALLOWLIST?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Meta publish/activation writes require both the global kill switch and an
 * explicit workspace canary allowlist. Missing or malformed input fails closed.
 */
export function metaPublishProviderWritesEnabled(
  workspaceId: string,
  env?: ProviderWriteEnvironment,
): boolean {
  const providerWriteEnv = env ?? {
    BLOCKWISE_ENABLE_PROVIDER_WRITES: process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES,
    BLOCKWISE_META_PUBLISH_WORKSPACE_ALLOWLIST: process.env.BLOCKWISE_META_PUBLISH_WORKSPACE_ALLOWLIST,
  };
  const normalizedWorkspaceId = workspaceId.trim().toLowerCase();
  if (providerWriteEnv.BLOCKWISE_ENABLE_PROVIDER_WRITES !== "true" || !UUID_PATTERN.test(normalizedWorkspaceId)) {
    return false;
  }

  const allowedWorkspaceIds = new Set(
    (providerWriteEnv.BLOCKWISE_META_PUBLISH_WORKSPACE_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => UUID_PATTERN.test(value)),
  );
  return allowedWorkspaceIds.has(normalizedWorkspaceId);
}
