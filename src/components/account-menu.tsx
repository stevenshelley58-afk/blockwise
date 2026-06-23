"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AccountMenuProps = {
  email: string;
  name: string;
  role: string;
};

export function AccountMenu({ email, name, role }: AccountMenuProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    const supabaseSignOut = async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch {
        // Offline auth can run without Supabase browser env.
      }
    };
    await Promise.all([
      supabaseSignOut(),
      fetch("/api/auth/offline-logout", { method: "POST" }).catch(() => null),
    ]);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="account-menu">
      <div className="account-copy">
        <strong>{name}</strong>
        <span>
          {role} - {email}
        </span>
      </div>
      <button className="icon-button" type="button" onClick={signOut} disabled={isSigningOut} aria-label="Log out">
        <LogOut aria-hidden size={18} />
      </button>
    </div>
  );
}
