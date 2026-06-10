import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["owner", "admin", "member", "viewer"];

type InviteBody = { workspaceId?: string; email?: string; role?: string };
type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as InviteBody;
  const email = (body.email ?? "").trim().toLowerCase();
  const role = (body.role ?? "member").trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }

  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? null);

  if (!guard.ok) return guard.response;
  const { access } = guard;
  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Only an owner or admin can invite members." }, { status: 403 });
  }

  const service = createSupabaseServiceClient();

  let userId: string;
  let isNew = false;
  const existing = await findUserByEmail(service, email);
  if (existing) {
    userId = existing;
  } else {
    const { data, error } = await service.auth.admin.inviteUserByEmail(email);
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? "Couldn't create the invite." }, { status: 500 });
    }
    userId = data.user.id;
    isNew = true;
  }

  const { error: profileError } = await service.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: memberError } = await service
    .from("workspace_members")
    .upsert({ workspace_id: access.workspaceId, profile_id: userId, role }, { onConflict: "workspace_id,profile_id" });
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: isNew
      ? `An invite email has been sent to ${email}.`
      : `${email} was added to the workspace.`,
  });
}

async function findUserByEmail(service: ServiceClient, email: string): Promise<string | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data) {
      return null;
    }
    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (match) {
      return match.id;
    }
    if (data.users.length < 100) {
      return null;
    }
    page += 1;
  }
}
