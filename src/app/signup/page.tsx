import Link from "next/link";
import { redirect } from "next/navigation";

import { SignupForm } from "@/components/signup-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="signup-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <p className="eyebrow">Free trial</p>
          <h1 id="signup-heading">Start your free trial</h1>
          <p className="login-copy">Create your first listing ad before connecting Meta. No card required.</p>
        </div>
        <SignupForm />
        <p className="auth-alt-link">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
