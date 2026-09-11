import Link from "next/link";
import { ExternalLink, LifeBuoy } from "lucide-react";

import { GuideShot } from "@/components/meta/guide-shot";
import { CopyBusinessId } from "@/components/meta/copy-business-id";
import {
  META_PARTNER_STEPS,
  META_PARTNERS_URL,
} from "@/components/meta/partner-steps";
import { Button } from "@/components/ui/button";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getMetaPartnerBusinessId } from "@/lib/providers/meta-partner";

export const dynamic = "force-dynamic";

const SUPPORT_HREF =
  "mailto:hello@blockwise.sale?subject=Blockwise%20support";

export default async function HelpPage() {
  await requirePageSurfaceAccess("self_serve");
  const businessId = getMetaPartnerBusinessId();

  return (
    <main
      className="mx-auto w-full max-w-[760px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16"
      aria-label={niche.copy.help.title}
    >
      <header className="mb-5">
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          {niche.copy.help.title}
        </h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          {niche.copy.help.lead}
        </p>
      </header>

      <div className="grid gap-3">
        <Topic
          title="Share your Meta assets with Blockwise"
          summary="The full walkthrough, with the real Meta screens. Two minutes."
          open
        >
          <p className="text-[13px] text-muted-foreground">
            You stay signed in to Meta and choose exactly what Blockwise can
            reach. Blockwise never sees your Meta password. Until direct Meta
            app access is approved, an authorised Blockwise operator publishes
            your ads for you.
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            You need admin access to your Meta Business Portfolio, and your ad
            account and Facebook Page should sit in that same portfolio.
          </p>

          <div className="mt-4 grid gap-4">
            {META_PARTNER_STEPS.map((step, index) => (
              <section key={step.title} className="grid gap-2">
                <h3 className="font-display text-[14.5px] font-extrabold">
                  {index + 1}. {step.title}
                </h3>
                {step.detail.map((line) => (
                  <p key={line} className="text-[13px] text-muted-foreground">
                    {line}
                  </p>
                ))}
                {index === 2 ? (
                  <CopyBusinessId businessId={businessId} />
                ) : null}
                <GuideShot
                  src={step.image}
                  fullSrc={step.fullImage}
                  width={step.width}
                  height={step.height}
                  fullWidth={step.fullWidth}
                  fullHeight={step.fullHeight}
                  alt={step.alt}
                  title={`Step ${index + 1}: ${step.title}`}
                />
                {step.tips.map((tip) => (
                  <p
                    key={tip}
                    className="rounded-(--r-card) bg-(--surface-subtle) px-3.5 py-2.5 text-[12.5px] text-muted-foreground"
                  >
                    {tip}
                  </p>
                ))}
              </section>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="min-h-11" asChild>
              <a
                href={META_PARTNERS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Meta Business Settings <ExternalLink />
              </a>
            </Button>
            <Button variant="outline" className="min-h-11" asChild>
              <Link href="/connect-meta">Tell us you have shared</Link>
            </Button>
          </div>
        </Topic>

        <Topic
          title="Set up your Brand Pack"
          summary="Scan your website once, then check the logo, colours and details."
        >
          <p className="text-[13px] text-muted-foreground">
            Open Brand Pack, enter your website, and Blockwise reads your logo,
            colours and business details into a draft pack. Review each field
            before you approve it: approved details are what every later ad
            uses.
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            If the scan cannot read your site, add the business name and primary
            colour by hand. The rest can be edited later without rescanning.
          </p>
          <Button variant="outline" className="mt-3 min-h-11" asChild>
            <Link href="/ad-studio/brand">Open Brand Pack</Link>
          </Button>
        </Topic>

        <Topic
          title="Create your first ad"
          summary="Pick a template, add the listing, check Feed and Story."
        >
          <p className="text-[13px] text-muted-foreground">
            Choose a template pack, add your listing photos and text, then edit
            in Ad Studio. Save the revision when the Feed and Story previews
            look right. Publishing stays gated until Meta access is verified, so
            nothing goes live by accident.
          </p>
          <Button variant="outline" className="mt-3 min-h-11" asChild>
            <Link href="/ad-studio">Open Ad Studio</Link>
          </Button>
        </Topic>

        <Topic
          title="Leads, reporting and billing"
          summary="Where leads land, what the numbers mean, and what you pay."
        >
          <p className="text-[13px] text-muted-foreground">
            Leads captured by your ads appear under Leads. Performance shows
            what Meta reports for the connected ad account. If reporting is
            unavailable, it says so instead of showing zero.
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            The plan price covers Blockwise only. Meta ad spend is charged by
            Meta, separately, to your own ad account.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" asChild>
              <Link href="/leads">Open Leads</Link>
            </Button>
            <Button variant="outline" className="min-h-11" asChild>
              <Link href="/settings#billing">Billing and plan</Link>
            </Button>
          </div>
        </Topic>
      </div>

      <section className="mt-5 flex flex-wrap items-center gap-3 rounded-(--r-panel) border border-(--line) bg-(--surface) p-4 shadow-card">
        <LifeBuoy aria-hidden className="text-muted-foreground" size={20} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[14.5px] font-extrabold">
            Still stuck?
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            Email us the step you are on and we will walk you through it.
          </p>
        </div>
        <Button className="min-h-11" asChild>
          <a href={SUPPORT_HREF}>Contact support</a>
        </Button>
      </section>
    </main>
  );
}

function Topic({
  title,
  summary,
  open,
  children,
}: {
  title: string;
  summary: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      className="group rounded-(--r-panel) border border-(--line) bg-(--surface) shadow-card"
    >
      <summary className="cursor-pointer list-none px-4 py-3.5 md:px-5">
        <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em]">
          {title}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{summary}</p>
      </summary>
      <div className="border-t border-(--line) px-4 py-4 md:px-5">
        {children}
      </div>
    </details>
  );
}
