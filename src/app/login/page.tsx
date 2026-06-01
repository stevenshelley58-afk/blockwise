import { redirect } from "next/navigation";

import { LoginForm } from "@/ui/login-form";
import { getRedirectForEmail } from "@/modules/auth/test-users";
import { createSupabaseServerClient } from "@/modules/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(getRedirectForEmail(user.email));
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <p className="eyebrow">Client sign in</p>
          <h1 id="login-heading">Access your workspace</h1>
          <p className="login-copy">Use the account issued during onboarding. New clients can request access from the homepage.</p>
        </div>
        <LoginForm
          showTestProfiles={process.env.NODE_ENV !== "production"}
          testProfilePassword={process.env.NODE_ENV !== "production" ? process.env.BLOCKWISE_DEV_PASSWORD : undefined}
        />
      </section>
    </main>
  );
}
