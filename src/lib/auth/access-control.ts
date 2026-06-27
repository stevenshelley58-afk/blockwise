export type WorkspaceRole = "owner" | "admin" | "member" | "viewer" | "operator";
export type WorkspaceMode = "monitor" | "self_serve";

// "operator" covers the whole operator console (overview, research ops,
// workforce, model control). The old "agents" / "model_control" surfaces had
// identical rules and were collapsed into it.
export type ProductSurface = "operator" | "monitor" | "self_serve" | "adstudio" | "property_check" | "approvals";

export type AccessContext = {
  role: WorkspaceRole;
  workspaceMode: WorkspaceMode;
};

const SURFACE_RULES: Record<ProductSurface, (context: AccessContext) => boolean> = {
  operator: ({ role }) => role === "operator",
  approvals: ({ role }) => role === "operator" || role === "owner" || role === "admin",
  monitor: ({ role }) => ["owner", "admin", "member", "viewer", "operator"].includes(role),
  self_serve: ({ role, workspaceMode }) =>
    workspaceMode === "self_serve" && ["owner", "admin", "member", "operator"].includes(role),
  adstudio: ({ role, workspaceMode }) =>
    role === "operator" || (workspaceMode === "self_serve" && ["owner", "admin", "member"].includes(role)),
  property_check: ({ role, workspaceMode }) =>
    role === "operator" || (workspaceMode === "self_serve" && ["owner", "admin", "member"].includes(role)),
};

export function canAccessSurface(context: AccessContext, surface: ProductSurface): boolean {
  return SURFACE_RULES[surface]?.(context) ?? false;
}

export function canManageProviderConnections(context: AccessContext): boolean {
  return context.role === "operator" || context.role === "owner" || context.role === "admin";
}
