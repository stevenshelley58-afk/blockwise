"use client";

import {
  ArrowRight,
  Check,
  ExternalLink,
  Instagram,
  Megaphone,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  META_PARTNER_STEPS,
  META_PARTNERS_URL,
} from "@/components/meta/partner-steps";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

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
    title: "We are checking your Meta sharing",
    body: "An authorised Blockwise operator is confirming that the Page and ad account reached our Business Portfolio. We email you when it is done.",
  },
  verifying: {
    title: "We are checking your Meta sharing",
    body: "An authorised Blockwise operator is confirming that the Page and ad account reached our Business Portfolio. We email you when it is done.",
  },
  ready_for_manual_publishing: {
    title: "Meta access is ready",
    body: "Blockwise can prepare ads for this ad account and Page. An authorised operator publishes them while direct Meta app access is under review.",
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
}: {
  workspaceId: string;
  canManage: boolean;
  isConnected: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("share");
  const [request, setRequest] = useState<PartnerAccessRequest | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadRequest = useCallback(
    async (announce = false) => {
      try {
        const response = await fetch(
          `/api/integrations/meta/partner-access-request?workspaceId=${encodeURIComponent(workspaceId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          request?: PartnerAccessRequest | null;
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            payload.error || "Your Meta sharing could not be loaded.",
          );
        if (payload.request) {
          setRequest(payload.request);
          setPhase("status");
          if (
            announce &&
            payload.request.status === "ready_for_manual_publishing"
          )
            setMessage({ error: false, text: "Meta access is ready." });
        }
      } catch (error) {
        if (announce)
          setMessage({
            error: true,
            text:
              error instanceof Error
                ? error.message
                : "Your Meta sharing could not be loaded.",
          });
      } finally {
        setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (canManage) void loadRequest();
    else setLoading(false);
  }, [canManage, loadRequest]);

  // An operator verifies the shared assets by hand, so keep the status honest
  // without making the customer reload the page.
  useEffect(() => {
    if (!request || !["requested", "verifying"].includes(request.status))
      return;
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
      if (!response.ok || !payload.request)
        throw new Error(payload.error || "We could not record your sharing.");
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

  if (loading)
    return (
      <Panel>
        <p className="text-[13.5px] text-muted-foreground" aria-live="polite">
          Loading your Meta setup…
        </p>
      </Panel>
    );

  if (!canManage)
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

  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-3">
      {phase === "share" ? (
        <Share
          headingRef={headingRef}
          confirmed={confirmed}
          busy={busy}
          onConfirmedChange={setConfirmed}
          onSubmit={() => void submit()}
        />
      ) : null}
      {phase === "status" && request ? (
        <StatusCard
          request={request}
          headingRef={headingRef}
          canRestart={!isConnected}
          onRefresh={() => void loadRequest(true)}
          onRestart={() => {
            setRequest(null);
            setConfirmed(false);
            setPhase("share");
          }}
        />
      ) : null}
      {message ? (
        <p
          role={message.error ? "alert" : "status"}
          className={
            message.error
              ? "rounded-(--r-card) bg-(--ui-error-soft) px-4 py-3 text-[12.5px] text-(--ui-error)"
              : "text-[12.5px] text-muted-foreground"
          }
        >
          {message.text}
        </p>
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

function Share({
  headingRef,
  confirmed,
  busy,
  onConfirmedChange,
  onSubmit,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  confirmed: boolean;
  busy: boolean;
  onConfirmedChange: (value: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-[17px] font-extrabold outline-none"
          >
            Connect your Meta account
          </h2>          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Four screens in Meta Business Settings. About two minutes.
          </p>
        </div>
        <Button variant="outline" className="min-h-11 self-start" asChild>
          <a href={META_PARTNERS_URL} target="_blank" rel="noopener noreferrer">
            Open Meta Business Settings <ExternalLink />
          </a>
        </Button>
      </div>

      <ol className="mt-4 grid gap-2.5">
        {META_PARTNER_STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-3.5 py-3"
          >
            <div className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--surface) font-display text-[12px] font-extrabold">
                {index + 1}
              </span>
              <div className="min-w-0">
                <strong className="block text-[13.5px]">{step.title}</strong>
                <span className="text-[12.5px] text-muted-foreground">
                  {step.where}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Stuck on a screen, or need the Blockwise Business ID?{" "}
        <a className="underline" href="/help">
          Open the full walkthrough
        </a>
        .
      </p>

      <div className="mt-4 flex items-start gap-3 border-t border-(--line) pt-4">
        <Checkbox
          id="meta-assets-shared"
          className="mt-0.5 size-5"
          checked={confirmed}
          onCheckedChange={(value) => onConfirmedChange(value === true)}
        />
        <Label
          htmlFor="meta-assets-shared"
          className="cursor-pointer text-[13.5px] leading-snug font-normal"
        >
          I have assigned my Page, ad account and permissions to Blockwise in
          Meta.
        </Label>
      </div>

      <Button
        className="mt-3 min-h-11 w-full sm:w-auto"
        disabled={!confirmed || busy}
        onClick={onSubmit}
      >
        {busy ? "Recording…" : "Confirm my sharing"}
        {!busy ? <ArrowRight /> : null}
      </Button>
    </section>
  );
}

function StatusCard({
  request,
  headingRef,
  canRestart,
  onRefresh,
  onRestart,
}: {
  request: PartnerAccessRequest;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  /** True while the workspace has no live Meta connection. */
  canRestart: boolean;
  onRefresh: () => void;
  onRestart: () => void;
}) {
  const copy = STATUS[request.status];
  const waiting = ["requested", "verifying"].includes(request.status);
  // A workspace with no live connection can always restart the sharing check.
  // Without this, a customer who disconnects and comes back lands on an old
  // pending request and the share checklist stays unreachable until an operator
  // happens to change its status.
  const restart =
    canRestart ||
    request.status === "needs_changes" ||
    request.status === "cancelled";
  const shared = [
    request.adAccountId
      ? { key: "ad", label: "Ad account", value: request.adAccountId, icon: <Megaphone size={14} /> }
      : null,
    request.pageId
      ? { key: "page", label: "Facebook Page", value: request.pageId, icon: <strong className="text-[11px]">f</strong> }
      : null,
    request.instagramAccountId
      ? { key: "ig", label: "Instagram", value: request.instagramAccountId, icon: <Instagram size={14} /> }
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
            className="font-display text-[17px] font-extrabold outline-none"
          >
            {copy.title}
          </h2>
          <p
            className="mt-1 text-[13.5px] text-muted-foreground"
            aria-live="polite"
          >
            {copy.body}
          </p>
        </div>
      </div>

      {shared.length > 0 ? (
        <div className="mt-4 grid gap-2 rounded-(--r-card) border border-(--line) px-3.5 py-3">
          {shared.map((asset) => (
            <div
              key={asset.key}
              className="flex items-center justify-between gap-3 text-[12.5px]"
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className="grid size-6 place-items-center rounded-full bg-(--surface-subtle)">
                  {asset.icon}
                </span>
                {asset.label}
              </span>
              <span className="break-all font-mono text-[11.5px] text-muted-foreground">
                {asset.value}
              </span>
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
          <Button variant="outline" className="min-h-11" onClick={onRefresh}>
            <RefreshCw />
            Check now
          </Button>
        ) : null}
        {request.status === "ready_for_manual_publishing" ? (
          <Button className="min-h-11" asChild>
            <a href="/ad-studio">
              Create your first ad <ArrowRight />
            </a>
          </Button>
        ) : null}
        {restart ? (
          <Button className="min-h-11" onClick={onRestart}>
            Confirm my sharing again <ArrowRight />
          </Button>
        ) : null}
        <Button variant="outline" className="min-h-11" asChild>
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
