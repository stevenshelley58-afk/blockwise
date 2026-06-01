import type { ProductSurface, WorkspaceMode, WorkspaceRole } from "./access-control.ts";

/**
 * Fine-grained, capability-based access model for Blockwise.
 *
 * The app exposes three permission surfaces:
 *   1. Monitor-only client  — view campaigns, spend, leads, reporting
 *   2. Self-serve client    — monitor + create/edit/submit ads, manage brand kit
 *                             (owners/admins may also approve & publish)
 *   3. Operator             — everything, across all workspaces, plus Hermes /
 *                             API / model controls and run-for-client
 *
 * Capabilities are DERIVED in code from (role, workspaceMode, isOperator); they
 * are not stored in the database. Surfaces ({@link ProductSurface}) are the
 * legacy coarse gate and are being migrated onto capabilities.
 */
export type Capability =
  // Monitor surface (read-only)
  | "monitor_ads"
  | "view_leads"
  | "view_spend"
  | "view_reports"
  // Self-serve authoring
  | "create_ads"
  | "edit_ads"
  | "submit_for_approval"
  | "manage_brand_kit"
  // Approval / publishing gates
  | "approve_ads"
  | "publish_ads"
  // Workspace administration
  | "manage_workspace"
  | "manage_all_workspaces"
  | "run_for_client"
  // Operator control planes
  | "manage_hermes"
  | "manage_api_controls"
  | "manage_model_controls"
  | "view_usage";

export type CapabilityContext = {
  role: WorkspaceRole;
  workspaceMode: WorkspaceMode;
  isOperator: boolean;
};

const MONITOR_CAPABILITIES: readonly Capability[] = [
  "monitor_ads",
  "view_leads",
  "view_spend",
  "view_reports",
];

const SELF_SERVE_AUTHORING: readonly Capability[] = [
  "create_ads",
  "edit_ads",
  "submit_for_approval",
  "manage_brand_kit",
];

// Owners/admins of a workspace retain approval, publishing, and workspace admin
// rights (clients keep approve/publish — this is intentional, not operator-only).
const WORKSPACE_ADMIN_CAPABILITIES: readonly Capability[] = [
  "approve_ads",
  "publish_ads",
  "manage_workspace",
];

const ALL_CAPABILITIES: readonly Capability[] = [
  ...MONITOR_CAPABILITIES,
  ...SELF_SERVE_AUTHORING,
  ...WORKSPACE_ADMIN_CAPABILITIES,
  "manage_all_workspaces",
  "run_for_client",
  "manage_hermes",
  "manage_api_controls",
  "manage_model_controls",
  "view_usage",
];

function isOperatorContext(context: CapabilityContext): boolean {
  return context.isOperator || context.role === "operator";
}

/**
 * Derive the full capability set for a workspace membership context.
 */
export function deriveCapabilities(context: CapabilityContext): ReadonlySet<Capability> {
  // Operators can do everything, across every workspace.
  if (isOperatorContext(context)) {
    return new Set(ALL_CAPABILITIES);
  }

  const capabilities = new Set<Capability>(MONITOR_CAPABILITIES);

  // Self-serve workspaces unlock ad authoring for owner/admin/member.
  if (
    context.workspaceMode === "self_serve" &&
    (context.role === "owner" || context.role === "admin" || context.role === "member")
  ) {
    for (const capability of SELF_SERVE_AUTHORING) {
      capabilities.add(capability);
    }
  }

  // Owners and admins keep approval, publishing, and workspace administration in
  // any workspace mode (preserves the legacy `approvals` surface behaviour).
  if (context.role === "owner" || context.role === "admin") {
    for (const capability of WORKSPACE_ADMIN_CAPABILITIES) {
      capabilities.add(capability);
    }
  }

  return capabilities;
}

export function hasCapability(context: CapabilityContext, capability: Capability): boolean {
  return deriveCapabilities(context).has(capability);
}

/**
 * Representative capability for each legacy {@link ProductSurface}. Used to bridge
 * surface-based call sites onto the capability model during migration.
 */
export const SURFACE_CAPABILITY: Record<ProductSurface, Capability> = {
  operator: "manage_all_workspaces",
  monitor: "monitor_ads",
  self_serve: "create_ads",
  adstudio: "create_ads",
  agents: "manage_hermes",
  model_control: "manage_model_controls",
  approvals: "approve_ads",
};

export function capabilityForSurface(surface: ProductSurface): Capability {
  return SURFACE_CAPABILITY[surface];
}
