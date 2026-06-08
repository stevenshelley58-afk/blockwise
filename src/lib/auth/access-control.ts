export type WorkspaceRole = "owner" | "admin" | "member" | "viewer" | "operator";
export type WorkspaceMode = "monitor" | "self_serve";
export type ProductSurface =
  | "operator"
  | "monitor"
  | "self_serve"
  | "adstudio"
  | "agents"
  | "model_control"
  | "approvals";

export type AccessContext = {
  role: WorkspaceRole;
  workspaceMode: WorkspaceMode;
};

export function canAccessSurface(context: AccessContext, surface: ProductSurface): boolean {
  if (surface === "operator" || surface === "agents" || surface === "model_control") {
    return context.role === "operator";
  }

  if (surface === "approvals") {
    return context.role === "operator" || context.role === "owner" || context.role === "admin";
  }

  if (surface === "monitor") {
    return ["owner", "admin", "member", "viewer", "operator"].includes(context.role);
  }

  if (surface === "self_serve") {
    return context.workspaceMode === "self_serve" && ["owner", "admin", "member", "operator"].includes(context.role);
  }

  if (surface === "adstudio") {
    return context.role === "operator" || (context.workspaceMode === "self_serve" && ["owner", "admin", "member"].includes(context.role));
  }

  return false;
}
