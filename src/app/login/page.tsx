import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { HOME_PATH } from "@/lib/auth/home";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Blockwise workspace and pick up where you left off creating and tracking your real estate ads.",
  alternates: { canonical: "/login" },
  openGraph: {
    type: "website",
    title: "Sign in to your Blockwise workspace",
    description: "Enter your email and password to pick up where you left off.",
    url: "/login",
    locale: "en_AU",
  },
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams?: Promise<{ error?: string | string[] }> | { error?: string | string[] };
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await Promise.resolve(searchParams) : {};
  const error = firstParam(params.error);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(HOME_PATH);
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <h1 id="login-heading">Sign in to your workspace</h1>
          <p className="login-copy">Enter your email and password to pick up where you left off.</p>
        </div>
        {error === "confirm_failed" ? (
          <p className="form-error" role="alert">
            That confirmation link is invalid or expired. Use the latest email, or sign in if your account is already confirmed.
          </p>
        ) : null}
        <LoginForm
          showTestProfiles={process.env.NODE_ENV !== "production"}
          testProfilePassword={process.env.NODE_ENV !== "production" ? process.env.BLOCKWISE_DEV_PASSWORD : undefined}
        />
        <p className="auth-alt-link">
          New to Blockwise? <Link href="/signup">Create three ads free</Link>
        </p>
      </section>
    </main>
  );
}
