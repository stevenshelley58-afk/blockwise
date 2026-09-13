"use client";

import {
  BarChart3,
  Check,
  Clipboard,
  ExternalLink,
  Facebook,
  Instagram,
  Megaphone,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { GuideShot } from "@/components/meta/guide-shot";
import {
  META_PARTNER_STEPS,
  META_PARTNERS_URL,
  type MetaPartnerStep,
} from "@/components/meta/partner-steps";
import { Button } from "@/components/ui/button";

type RequestStatus =
  | "requested"
  | "verifying"
  | "ready_for_manual_publishing"
  | "needs_changes"
  | "cancelled";

type PartnerAccessRequest = {
  requestId: string;
  adAccountId: string;
  pageId: string;
  instagramAccountId: string | null;
  status: RequestStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type Phase = "share" | "status";

const STATUS: Record<RequestStatus, { title: string; body: string }> = {
  requested: {
    title: "Blockwise is checking your sharing",
    body: "An authorised Blockwise operator is confirming that the Page and ad account reached our Business Portfolio. Return here to see when it is ready.",
  },
  verifying: {
    title: "Blockwise is checking your sharing",
    body: "An authorised Blockwise operator is confirming that the Page and ad account reached our Business Portfolio. Return here to see when it is ready.",
  },
  ready_for_manual_publishing: {
    title: "Ready for manual publishing",
    body: "Blockwise can prepare ads for this ad account and Page. An authorised operator publishes them. Direct Meta publishing is not enabled.",
  },
  needs_changes: {
    title: "One change is needed in Meta",
    body: "Read the note below, update the shared assets in Meta, then confirm again.",
  },
  cancelled: {
    title: "This request was cancelled",
    body: "Start again whenever you are ready.",
  },
};

/**
 * The customer side of Meta partner access.
 *
 * The customer shares assets inside Meta, then confirms it here in one tap.
 * Numeric asset IDs are read from Meta's shared-asset list by the operator who
 * verifies the request, so the customer never copies IDs out of Meta.
 */
export function ConnectMetaGuide({
  workspaceId,
  canManage,
  isConnected,
  businessId,
}: {
  workspaceId: string;
  canManage: boolean;
  isConnected: boolean;
  businessId: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("share");
  const [request, setRequest] = useState<PartnerAccessRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadRequest = useCallback(
    async (announce = false) => {
      setRefreshing(true);
      try {
        const response = await fetch(
          `/api/integrations/meta/partner-access-request?workspaceId=${encodeURIComponent(workspaceId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          request?: PartnerAccessRequest | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.error || "Your Meta sharing could not be loaded.",
          );
        }
        if (payload.request) {
          setRequest(payload.request);
          setPhase("status");
          if (
            announce &&
            payload.request.status === "ready_for_manual_publishing"
          ) {
            setMessage({ error: false, text: "Ready for manual publishing." });
          } else {
            setMessage(null);
          }
        } else {
          setRequest(null);
          setPhase("share");
          if (announce) setMessage(null);
        }
      } catch (error) {
        setMessage({
          error: true,
          text:
            error instanceof Error
              ? error.message
              : "Your Meta sharing could not be loaded.",
        });
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (canManage) void loadRequest();
    else setLoading(false);
  }, [canManage, loadRequest]);

  useEffect(() => {
    if (!request || !["requested", "verifying"].includes(request.status)) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadRequest(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadRequest, request]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [phase]);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/integrations/meta/partner-access-request",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            mutationId: crypto.randomUUID(),
            requestType: "confirmation",
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        request?: PartnerAccessRequest;
        error?: string;
      };
      if (!response.ok || !payload.request) {
        throw new Error(payload.error || "We could not record your sharing.");
      }
      setRequest(payload.request);
      setPhase("status");
    } catch (error) {
      setMessage({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "We could not record your sharing.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Panel>
        <p className="text-[13.5px] text-muted-foreground" aria-live="polite">
          Loading your Meta setup...
        </p>
      </Panel>
    );
  }

  if (!canManage) {
    return (
      <Panel>
        <h2 className="font-display text-[17px] font-extrabold">
          Ask a workspace owner or admin
        </h2>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Only an owner or admin can share the business&apos;s Meta assets with
          Blockwise.
        </p>
      </Panel>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <header className="mb-5">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-[24px] font-extrabold tracking-[-0.03em] outline-none md:text-[29px]"
        >
          Connect Facebook &amp; Instagram
        </h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Share your Meta assets with Blockwise. You choose what we can access.
        </p>
      </header>

      {phase === "share" ? (
        <ol className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
          <li>
            <StepPanel testId="meta-step-1" number="1" title="Open Meta settings">
              <p className="text-[13.5px] leading-5 text-muted-foreground">
                Add Blockwise from Partners in Meta Business Settings. You keep
                control of your assets and can remove access anytime.
              </p>
              <Button
                asChild
                className="mt-4 min-h-11 w-full [--ui-cta:var(--ui-data)]"
                arrow={null}
              >
                <a
                  href={META_PARTNERS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Meta settings
                </a>
              </Button>
              <StepHelp testId="step-help-1" steps={[META_PARTNER_STEPS[0]]} />
            </StepPanel>
          </li>

          <li>
            <StepPanel
              testId="meta-step-2"
              number="2"
              title="Add Blockwise"
            >
              <p className="text-[13.5px] leading-5 text-muted-foreground">
                Use the Business Portfolio ID when Meta asks for a partner.
              </p>
              <BusinessId businessId={businessId} />
              <StepHelp
                testId="step-help-2"
                steps={[META_PARTNER_STEPS[1], META_PARTNER_STEPS[2]]}
              />
            </StepPanel>
          </li>

          <li>
            <StepPanel
              testId="meta-step-3"
              number="3"
              title="Share your assets"
            >
              <p className="text-[13.5px] leading-5 text-muted-foreground">
                Choose Partial access. Leave Full control off.
              </p>
              <div className="mt-3 space-y-2">
                <AssetRow
                  icon={<Facebook aria-hidden="true" />}
                  label="Facebook Page"
                  detail="Required - ads and lead access"
                />
                <AssetRow
                  icon={<Megaphone aria-hidden="true" />}
                  label="Ad account"
                  detail="Required - Manage campaigns + View performance"
                />
                <AssetRow
                  icon={<Instagram aria-hidden="true" />}
                  label="Instagram"
                  detail="Optional"
                />
              </div>
              <StepHelp testId="step-help-3" steps={[META_PARTNER_STEPS[3]]} />
            </StepPanel>
          </li>

          <li>
            <StepPanel
              testId="meta-step-4"
              number="4"
              title="Check your sharing"
            >
              <p className="text-[13.5px] leading-5 text-muted-foreground">
                After you assign the assets in Meta, return here and confirm.
              </p>
              <Button
                className="mt-4 min-h-11 w-full [--ui-cta:var(--ui-data)]"
                disabled={busy || !businessId}
                onClick={() => void submit()}
                arrow={null}
              >
                {busy ? "Checking..." : "I've added Blockwise"}
              </Button>
              <StepHelp
                testId="step-help-4"
                steps={[META_PARTNER_STEPS[3]]}
                caption="Click Assign assets in Meta, then return here and select I've added Blockwise. This screen reports the operator-verified result."
              />
            </StepPanel>
          </li>
        </ol>
      ) : null}

      {phase === "status" && request ? (
        <StatusCard
          request={request}
          headingRef={headingRef}
          canRestart={!isConnected}
          refreshing={refreshing}
          onRefresh={() => void loadRequest(true)}
          onRestart={() => {
            setRequest(null);
            setPhase("share");
            setMessage(null);
          }}
        />
      ) : null}

      {message ? (
        <div
          className={
            message.error
              ? "mt-3 flex flex-wrap items-center gap-3 rounded-(--r-card) bg-(--ui-error-soft) px-4 py-3 text-[12.5px] text-(--ui-error)"
              : "mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground"
          }
          role={message.error ? "alert" : "status"}
        >
          <span className="min-w-0 flex-1">{message.text}</span>
          {message.error ? (
            <Button
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={refreshing}
              onClick={() => void loadRequest(true)}
              arrow={null}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[760px] rounded-(--r-panel) border border-(--line) bg-(--surface) p-4 shadow-card sm:p-5">
      {children}
    </section>
  );
}

function StepPanel({
  testId,
  number,
  title,
  children,
}: {
  testId: string;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="flex h-full flex-col rounded-(--r-card) border border-(--line) bg-(--surface) p-4 shadow-card sm:p-5"
    >
      <span className="grid size-8 place-items-center rounded-full bg-data-soft font-display text-sm font-extrabold text-data">
        {number}
      </span>
      <h2 className="mt-3 font-display text-[18px] font-extrabold leading-tight tracking-[-0.025em]">
        {title}
      </h2>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

function BusinessId({ businessId }: { businessId: string | null }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    if (!businessId) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(businessId);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="mt-3 rounded-(--r-ctl) border border-(--line-heavy) bg-(--surface-subtle) p-3">
      <span className="block text-[11.5px] font-semibold text-muted-foreground">
        Blockwise Business Portfolio ID
      </span>
      <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <code className="min-w-0 max-w-full overflow-x-auto whitespace-nowrap text-[13px] font-bold tracking-[0.02em]">
          {businessId ?? "Unavailable"}
        </code>
        <Button
          variant="outline"
          className="ml-auto min-h-11 shrink-0 px-3"
          aria-label="Copy Business Portfolio ID"
          onClick={() => void copy()}
          disabled={!businessId}
          arrow={null}
        >
          {copyState === "copied" ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
          {copyState === "copied" ? "Copied" : "Copy"}
        </Button>
        <span className="sr-only" aria-live="polite">
          {copyState === "copied" ? "Business Portfolio ID copied" : ""}
        </span>
      </div>
      {!businessId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Business Portfolio ID is unavailable. Contact Blockwise before continuing.
        </p>
      ) : null}
      {copyState === "failed" ? (
        <p className="mt-2 text-xs text-(--ui-error)" role="alert">
          Copy was unavailable. Select the ID and copy it manually.
        </p>
      ) : null}
    </div>
  );
}

function AssetRow({
  icon,
  label,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-(--r-ctl) border border-(--line) bg-(--surface-subtle) px-2.5 py-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-data-soft text-data [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0">
        <strong className="block text-[12.5px]">{label}</strong>
        <span className="block text-[11px] leading-4 text-muted-foreground">
          {detail}
        </span>
      </span>
    </div>
  );
}

function StepHelp({
  testId,
  steps,
  caption,
}: {
  testId: string;
  steps: readonly MetaPartnerStep[];
  caption?: string;
}) {
  return (
    <details data-testid={testId} className="mt-auto pt-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-foreground underline underline-offset-4">
        Show me how
      </summary>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Select image to enlarge.
      </p>
      <div className="mt-3 space-y-4 border-t border-(--line) pt-3">
        {steps.map((step) => {
          const stepCaption =
            caption ??
            (step.title === "Choose assets and permissions"
              ? "Turn on Manage campaigns and View performance. Leave Full control off."
              : step.where);

          return (
            <div key={step.title}>
              <h3 className="text-[13px] font-semibold">{step.title}</h3>
              <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">
                {stepCaption}
              </p>
              <div className="mt-2">
                <GuideShot
                  src={step.image}
                  fullSrc={step.fullImage}
                  width={step.width}
                  height={step.height}
                  fullWidth={step.fullWidth}
                  fullHeight={step.fullHeight}
                  alt={step.alt}
                  title={step.title}
                />
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function StatusCard({
  request,
  headingRef,
  canRestart,
  refreshing,
  onRefresh,
  onRestart,
}: {
  request: PartnerAccessRequest;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  canRestart: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRestart: () => void;
}) {
  const copy = STATUS[request.status];
  const waiting = ["requested", "verifying"].includes(request.status);
  const restart =
    canRestart ||
    request.status === "needs_changes" ||
    request.status === "cancelled";

  const shared = [
    request.adAccountId
      ? { key: "ad", label: "Ad account", icon: <Megaphone size={14} /> }
      : null,
    request.pageId
      ? { key: "page", label: "Facebook Page", icon: <Facebook size={14} /> }
      : null,
    request.instagramAccountId
      ? { key: "ig", label: "Instagram", icon: <Instagram size={14} /> }
      : null,
  ].filter((asset) => asset !== null);

  return (
    <section className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-4 shadow-card sm:p-5">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--surface-subtle)">
          {waiting ? (
            <RefreshCw aria-hidden size={18} />
          ) : (
            <ShieldCheck aria-hidden size={18} />
          )}
        </span>
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-[19px] font-extrabold outline-none"
          >
            {copy.title}
          </h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground" aria-live="polite">
            {copy.body}
          </p>
        </div>
      </div>

      {shared.length > 0 ? (
        <div className="mt-4 grid gap-2 rounded-(--r-card) border border-(--line) px-3.5 py-3">
          {shared.map((asset) => (
            <div key={asset.key} className="flex items-center gap-2 text-[12.5px]">
              <span className="grid size-6 place-items-center rounded-full bg-(--surface-subtle)">
                {asset.icon}
              </span>
              <span className="font-semibold">{asset.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {request.statusReason ? (
        <p className="mt-4 rounded-(--r-card) bg-(--surface-subtle) px-4 py-3 text-[12.5px]">
          <strong className="block">Note from Blockwise</strong>
          <span className="text-muted-foreground">{request.statusReason}</span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {waiting ? (
          <Button
            variant="outline"
            className="min-h-11"
            onClick={onRefresh}
            disabled={refreshing}
            arrow={null}
          >
            Check now
          </Button>
        ) : null}
        {request.status === "ready_for_manual_publishing" ? (
          <Button className="min-h-11" asChild>
            <a href="/ad-studio">Create your first ad</a>
          </Button>
        ) : null}
        {restart ? (
          <Button className="min-h-11" onClick={onRestart} arrow={null}>
            Confirm my sharing again
          </Button>
        ) : null}
        <Button variant="outline" className="min-h-11" asChild arrow={null}>
          <a href="/help">Help</a>
        </Button>
      </div>

      {waiting ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Check aria-hidden size={13} />
          Nothing else is needed from you. This page checks again every 15
          seconds.
        </p>
      ) : null}
    </section>
  );
}
