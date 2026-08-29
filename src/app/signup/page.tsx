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
          <p className="eyebrow">Start free</p>
          <h1 id="signup-heading">Create your first three ads</h1>
          <p className="login-copy">
            Enter your email and we&rsquo;ll send a secure sign-in link. No password or card
            required.
          </p>
        </div>
        <SignupForm />
        <p className="auth-alt-link">
          Use an existing password instead? <Link href="/login">Sign in with password</Link>
        </p>
      </section>
    </main>
  );
}
