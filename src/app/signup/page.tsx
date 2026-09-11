import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignupForm } from "@/components/signup-form";
import { HOME_PATH } from "@/lib/auth/home";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start free",
  description: "Create your first three real estate ads with Blockwise. Email only, no password and no card required.",
  alternates: { canonical: "/signup" },
  openGraph: {
    type: "website",
    title: "Create your first three ads",
    description: "Start with your email and build three complete real estate ads before adding a card.",
    url: "/signup",
    locale: "en_AU",
  },
  robots: { index: false, follow: false },
};

const AUDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SignupPageProps = {
  searchParams: Promise<{ auditId?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const query = await searchParams;
  const auditId = typeof query.auditId === "string" && AUDIT_ID.test(query.auditId.trim()) ? query.auditId.trim() : null;

  if (user && auditId) {
    redirect(`/self-serve?auditId=${encodeURIComponent(auditId)}`);
  }

  if (user) {
    redirect(HOME_PATH);
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="signup-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <h1 id="signup-heading">Create your first three ads</h1>
          <p className="login-copy">
            Enter your email and we&rsquo;ll send a secure sign-in link. No password or card
            required.
          </p>
        </div>
        <SignupForm auditId={auditId} />
        <p className="auth-alt-link">
          Use an existing password instead? <Link href="/login">Sign in with password</Link>
        </p>
      </section>
    </main>
  );
}
