import Link from "next/link";
import { redirect } from "next/navigation";

import { SignupForm } from "@/components/signup-form";
import {
  formatBillingAmount,
  getBillingOffer,
  isBillingProduct,
  type BillingMarket,
  type BillingProduct,
} from "@/lib/billing/offers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SignupPageProps = {
  searchParams?: Promise<{ offer?: string | string[]; market?: string | string[] }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  }

  const params = searchParams ? await searchParams : {};
  const offer = parseOffer(params.offer);
  const market = parseMarket(params.market);
  const offerSummary = offer && market ? summarizeOffer(offer, market) : null;

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="signup-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <p className="eyebrow">{offer === "managed" ? "Managed service" : "Start free"}</p>
          <h1 id="signup-heading">
            {offer === "managed" ? "Start managed onboarding" : "Create your first three ads"}
          </h1>
          <p className="login-copy">
            Enter your email and we&rsquo;ll send a secure sign-in link. No password or card
            required.
          </p>
          {offerSummary ? <p className="login-copy">{offerSummary}</p> : null}
        </div>
        <SignupForm requestedOffer={offer} requestedMarket={market} />
        <p className="auth-alt-link">
          Use an existing password instead? <Link href="/login">Sign in with password</Link>
        </p>
      </section>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function parseOffer(value: string | string[] | undefined): BillingProduct | null {
  const offer = firstParam(value)?.replace("-", "_");
  return isBillingProduct(offer) ? offer : null;
}

function parseMarket(value: string | string[] | undefined): BillingMarket | null {
  const market = firstParam(value)?.toUpperCase();
  return market === "US" || market === "AU" ? market : null;
}

function summarizeOffer(product: BillingProduct, market: BillingMarket): string {
  const offer = getBillingOffer(market, product);
  const marketName = market === "US" ? "United States" : "Australia";
  if (product === "managed") {
    return `${marketName} · ${formatBillingAmount(offer.recurringAmount, offer.currency)}/month for managed service. Meta ad spend is separate.`;
  }
  return `${marketName} · Three ads free. First paid month ${formatBillingAmount(offer.firstInvoiceAmount, offer.currency)}, then ${formatBillingAmount(offer.recurringAmount, offer.currency)}/month. Meta ad spend is separate.`;
}
