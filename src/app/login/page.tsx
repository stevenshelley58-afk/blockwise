import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
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
          <p className="login-copy">Use your Blockwise account to access your workspace.</p>
        </div>
        <LoginForm
          showTestProfiles={process.env.NODE_ENV !== "production"}
          testProfilePassword={process.env.NODE_ENV !== "production" ? process.env.BLOCKWISE_DEV_PASSWORD : undefined}
        />
        <p className="auth-alt-link">
          New to Blockwise? <Link href="/signup">Start free trial</Link>
        </p>
      </section>
    </main>
  );
}
