"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { purgeLocalReadModels } from "@/lib/read-models/browser-store";

type AccountMenuProps = {
  email: string;
  name: string;
  role: string;
};

export function AccountMenu({ email, name, role }: AccountMenuProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    await purgeLocalReadModels();
    await supabase.auth.signOut();
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
      <Button variant="ghost" size="icon-sm" type="button" onClick={signOut} disabled={isSigningOut} aria-label="Log out">
        <LogOut aria-hidden size={18} />
      </Button>
    </div>
  );
}
