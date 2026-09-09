import { NextResponse } from "next/server";

import {
  reserveWorkspaceCredits,
  type WorkspaceCreditReservation,
  WorkspaceCreditError,
} from "../credits/workspace-credits.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AdStudioGenerationCreditReservation = WorkspaceCreditReservation & {
  isTrialWorkspace: boolean;
};

export function hasConfirmedEmail(user: {
  email?: string | null;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
} | null): boolean {
  return Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
}

export async function reserveAdStudioGenerationCredits(input: {
  supabase: SupabaseServerClient;
  workspaceId: string;
  actorProfileId: string;
  mutationKey: string;
  serviceSupabase?: SupabaseServiceClient;
}): Promise<
  | { ok: true; reservation: AdStudioGenerationCreditReservation }
  | { ok: false; response: NextResponse }
> {
  const {
    data: { user },
    error: userError,
  } = await input.supabase.auth.getUser();

  if (userError || !user || user.id !== input.actorProfileId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }),
    };
  }
  if (!hasConfirmedEmail(user)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Email confirmation is required before generation." },
        { status: 403 },
      ),
    };
  }

  let serviceSupabase = input.serviceSupabase;
  try {
    serviceSupabase ??= createSupabaseServiceClient();
    const reservation = await reserveWorkspaceCredits({
      workspaceId: input.workspaceId,
      actorProfileId: input.actorProfileId,
      credits: 1,
      mutationKey: input.mutationKey,
      purpose: "adstudio.feed_story_pack",
      metadata: { billableFullAdRenders: 1, outputFormats: ["4:5", "9:16"] },
      serviceSupabase,
    });

    return {
      ok: true,
      reservation: {
        ...reservation,
        isTrialWorkspace: reservation.entitlementType === "trial",
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceCreditError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: error.message, code: error.reason },
          { status: 402 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: error instanceof Error ? error.message : "Render credits could not be reserved." },
        { status: 500 },
      ),
    };
  }
}
