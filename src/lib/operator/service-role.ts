import { createSupabaseServiceClient } from "@/lib/supabase/service";

export function createOperatorSupabaseServiceClient(): ReturnType<typeof createSupabaseServiceClient> | null {
  try {
    return createSupabaseServiceClient();
  } catch (error) {
    if (isMissingSupabaseServiceRoleError(error)) return null;
    throw error;
  }
}

export function isMissingSupabaseServiceRoleError(error: unknown): boolean {
  return error instanceof Error && error.message === "Supabase service-role environment is missing.";
}
