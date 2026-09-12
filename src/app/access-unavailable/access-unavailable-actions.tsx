"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
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
      <Button type="button" onClick={() => void signOutAndGo("signup")} disabled={Boolean(busyTarget)}>
        {busyTarget === "signup" ? "Signing out..." : "Create three ads free"}
      </Button>
      <Button variant="outline" type="button" onClick={() => void signOutAndGo("login")} disabled={Boolean(busyTarget)}>
        {busyTarget === "login" ? "Signing out..." : "Use another account"}
      </Button>
    </div>
  );
}
