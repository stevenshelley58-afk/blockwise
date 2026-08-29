"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AccessUnavailableActions() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [busyTarget, setBusyTarget] = useState<"signup" | "login" | null>(null);

  async function signOutAndGo(target: "signup" | "login") {
    setBusyTarget(target);
    await supabase.auth.signOut();
    router.replace(target === "signup" ? "/signup" : "/login");
    router.refresh();
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-2.5">
      <button className="button" type="button" onClick={() => void signOutAndGo("signup")} disabled={Boolean(busyTarget)}>
        {busyTarget === "signup" ? "Signing out..." : "Create three ads free"}
      </button>
      <button className="button secondary" type="button" onClick={() => void signOutAndGo("login")} disabled={Boolean(busyTarget)}>
        {busyTarget === "login" ? "Signing out..." : "Use another account"}
      </button>
    </div>
  );
}
