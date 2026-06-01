# Capability model

Blockwise access control is **capability-based**. Capabilities are derived in
code from `(role, workspaceMode, isOperator)` and are never stored in the
database. This replaces scattered `role === "operator"` checks with a single,
testable source of truth.

Source of truth: `src/lib/auth/capabilities.ts`.

## The three surfaces

| Surface | Identified by | Intent |
| --- | --- | --- |
| Monitor-only client | `workspaceMode = monitor` | Read campaigns, spend, leads, reporting |
| Self-serve client | `workspaceMode = self_serve` | Above + create/edit/submit ads, brand kits |
| Operator | `profiles.is_operator = true` | Everything, across all workspaces |

Roles (`workspace_members.role`): `owner`, `admin`, `member`, `viewer`,
`operator`. Workspace owners/admins additionally retain approve & publish rights
in any mode (see below).

## Capabilities

```
monitor_ads  view_leads  view_spend  view_reports          # read
create_ads  edit_ads  submit_for_approval  manage_brand_kit # authoring
approve_ads  publish_ads                                     # gates
manage_workspace  manage_all_workspaces  run_for_client      # admin
manage_hermes  manage_api_controls  manage_model_controls  view_usage  # operator control planes
```

## Derivation rules

| Context | Capabilities granted |
| --- | --- |
| **Operator** (`isOperator`) | All capabilities, across all workspaces |
| **Any member** (any role, any mode) | `monitor_ads`, `view_leads`, `view_spend`, `view_reports` |
| **Self-serve `owner`/`admin`/`member`** | + `create_ads`, `edit_ads`, `submit_for_approval`, `manage_brand_kit` |
| **`owner`/`admin`** (any mode) | + `approve_ads`, `publish_ads`, `manage_workspace` |

Notes:
- Clients **keep** approve/publish: workspace owners/admins can approve and
  publish their own ads. This is intentional (not operator-only).
- `viewer` is read-only. `member` in a monitor-mode workspace is read-only.
- Operator-only control planes (`manage_hermes`, `manage_api_controls`,
  `manage_model_controls`, `run_for_client`, `manage_all_workspaces`) are never
  granted to clients.

## Enforcement

**Server is the gate. UI hiding is cosmetic.**

| Context | Helper | File |
| --- | --- | --- |
| API route handlers | `requireCapability(cap, { requestedWorkspaceId })` | `src/lib/auth/require-capability.ts` |
| Trigger.dev jobs (bypass RLS) | `assertJobCapability(service, actorProfileId, workspaceId, cap)` | `src/lib/auth/job-capability.ts` |
| Operator-only routes | `requireOperator()` (sources `profiles.is_operator`) | `src/lib/operator/auth.ts` |
| Pages (legacy coarse gate) | `requirePageSurfaceAccess(surface)` | `src/lib/auth/page-guards.ts` |

`requireCapability` reuses `requireWorkspaceAccess` (membership resolution,
operator fallback, 401/403/404) with the universally-readable `monitor` surface,
then enforces the fine-grained capability.

### Legacy surfaces

`canAccessSurface` / `ProductSurface` (`src/lib/auth/access-control.ts`) is the
older coarse gate. It still backs page guards and is being migrated onto
capabilities. `capabilities.ts` exports `SURFACE_CAPABILITY` /
`capabilityForSurface` to bridge the two. New code should use capabilities
directly. Delete the surface gate once no call sites remain.

## Auditing operator actions

Sensitive operator actions are recorded via `recordAudit(client, entry)`
(`src/lib/audit/record-audit.ts`) into `public.audit_logs`:

- `actor_profile_id` — **who** performed the action (the operator). Never null
  for operator-initiated actions.
- `workspace_id` — the **affected** client workspace.
- `metadata` — for run-for-client, `{ onBehalfOf, viaCapability,
  affectedWorkspaceId }`. (`audit_logs.target_id` is uuid-typed, so non-uuid
  context goes in `metadata`.)

Actions that must be audited: `run_for_client`, `publish_ads`, `approve_campaign`,
`change_api_keys`, `change_model_settings`, `start_hermes_job`, `stop_hermes_job`.

## Testing

`tests/capabilities.test.ts` asserts the derivation truth table and verifies the
capability layer stays consistent with the legacy surface gate for the
security-critical (operator-gated) surfaces. Run `npm test`.
