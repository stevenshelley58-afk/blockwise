"use client";

import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Instagram,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  ZoomIn,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
type Phase = "intro" | "guide" | "details" | "status";

const META_PARTNERS_URL = "https://business.facebook.com/settings/partners";
const DRAFT_STORAGE_KEY = "blockwise.meta-partner-draft";
const STEPS = [
  {
    title: "Open Partners in Meta Business Settings",
    copy: "In the left menu, choose Users, then Partners.",
    image: "/help/meta/partner-access/01-partners.webp",
    width: 378,
    height: 580,
    alt: "Meta Business Settings with Partners selected under Users",
    tip: "If you cannot see Partners, ask the owner of your Meta Business Portfolio to complete this guide.",
    action: "I found Partners",
  },
  {
    title: "Choose Give a partner access",
    copy: "Select Add, then choose “Give a partner access to your assets”.",
    image: "/help/meta/partner-access/02-give-access-crop.webp",
    fullImage: "/help/meta/partner-access/02-give-access.webp",
    fullWidth: 1831,
    fullHeight: 237,
    width: 541,
    height: 237,
    alt: "Meta Partners screen with Give a partner access to your assets selected",
    tip: "Do not choose “Ask a partner to assign you their assets”.",
    action: "I added Blockwise",
  },
  {
    title: "Enter the Blockwise Business ID",
    copy: "Copy the ID below, paste it into Partner business ID, then select Next.",
    image: "/help/meta/partner-access/03-business-id.webp",
    width: 598,
    height: 306,
    alt: "Meta Add a new partner dialog with the Partner business ID field",
    tip: "This identifies Blockwise. It does not grant access until you choose the assets on the next screen.",
    showId: true,
    action: "I selected the assets",
  },
  {
    title: "Choose assets and permissions",
    copy: "Select your Facebook Page, ad account and, if you use it, your linked Instagram professional account.",
    image: "/help/meta/partner-access/04-assets-and-permissions.webp",
    width: 670,
    height: 520,
    alt: "Meta Assign assets and permissions screen showing ad account partial-access controls",
    tip: "Select Assign assets only when the Page, ad account, permissions, and optional Instagram account are correct.",
    permissions: true,
    action: "I’ve assigned the assets",
  },
] as const;

const STATUS: Record<RequestStatus, { title: string; body: string }> = {
  requested: {
    title: "Your access details were sent",
    body: "A Blockwise operator will check the exact ad account and Page you shared.",
  },
  verifying: {
    title: "Blockwise is checking your assets",
    body: "We are matching the IDs below against the assets shared with the Blockwise Business Portfolio.",
  },
  ready_for_manual_publishing: {
    title: "Partner access is verified",
    body: "Blockwise can now use these assets for operator-assisted publishing while direct Meta app access remains under review.",
  },
  needs_changes: {
    title: "A change is needed in Meta",
    body: "Read the operator note, update the shared assets in Meta, then send the corrected IDs.",
  },
  cancelled: {
    title: "This request was cancelled",
    body: "Follow the guide again when you are ready.",
  },
};

export function ConnectMetaGuide({
  workspaceId,
  canManage,
  businessId,
}: {
  workspaceId: string;
  canManage: boolean;
  businessId: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [step, setStep] = useState(0);
  const [request, setRequest] = useState<PartnerAccessRequest | null>(null);
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [instagramAccountId, setInstagramAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
            payload.error || "The access request could not be loaded.",
          );
        if (payload.request) {
          setRequest((current) => {
            if (
              announce &&
              current &&
              current.status !== payload.request?.status
            )
              setMessage({
                error: false,
                text: "Your access request was updated.",
              });
            return payload.request ?? null;
          });
          setPhase("status");
        }
      } catch (error) {
        if (announce)
          setMessage({
            error: true,
            text:
              error instanceof Error
                ? error.message
                : "The access request could not be loaded.",
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
  useEffect(() => {
    if (!canManage) return;
    try {
      const raw = sessionStorage.getItem(`${DRAFT_STORAGE_KEY}.${workspaceId}`);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        adAccountId?: string;
        pageId?: string;
        instagramAccountId?: string;
      };
      if (draft.adAccountId) setAdAccountId(draft.adAccountId);
      if (draft.pageId) setPageId(draft.pageId);
      if (draft.instagramAccountId)
        setInstagramAccountId(draft.instagramAccountId);
    } catch {}
  }, [canManage, workspaceId]);
  useEffect(() => {
    if (!canManage) return;
    if (!adAccountId && !pageId && !instagramAccountId) return;
    try {
      sessionStorage.setItem(
        `${DRAFT_STORAGE_KEY}.${workspaceId}`,
        JSON.stringify({ adAccountId, pageId, instagramAccountId }),
      );
    } catch {}
  }, [adAccountId, canManage, instagramAccountId, pageId, workspaceId]);
  useEffect(() => {
    if (!request || !["requested", "verifying"].includes(request.status))
      return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const poll = async () => {
      if (!stopped && !document.hidden) await loadRequest(true);
      if (!stopped) timer = setTimeout(poll, 6000);
    };
    timer = setTimeout(poll, 6000);
    const onVisible = () => {
      if (!document.hidden) void loadRequest(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadRequest, request]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [phase, step]);

  async function copyId() {
    if (!businessId) return;
    await navigator.clipboard.writeText(businessId);
    setCopied(true);
    setMessage({ error: false, text: "Blockwise Business ID copied." });
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
            adAccountId,
            pageId,
            instagramAccountId: instagramAccountId.trim() || null,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        request?: PartnerAccessRequest;
        error?: string;
      };
      if (!response.ok || !payload.request)
        throw new Error(
          payload.error || "The access request could not be sent.",
        );
      setRequest(payload.request);
      setPhase("status");
      setMessage({
        error: false,
        text: "Your partner-access request was sent.",
      });
      try {
        sessionStorage.removeItem(`${DRAFT_STORAGE_KEY}.${workspaceId}`);
      } catch {}
    } catch (error) {
      setMessage({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "The access request could not be sent.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <Panel>
        <p className="text-[13.5px] text-muted-foreground" aria-live="polite">
          Loading your Meta access setup…
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
    <div className="grid gap-4">
      <Progress phase={phase} />
      {phase === "intro" ? (
        <Intro
          headingRef={headingRef}
          onNext={() => {
            setPhase("guide");
            setStep(0);
          }}
        />
      ) : null}
      {phase === "guide" ? (
        <Guide
          step={step}
          businessId={businessId}
          copied={copied}
          headingRef={headingRef}
          onCopy={() => void copyId()}
          onBack={() => (step === 0 ? setPhase("intro") : setStep(step - 1))}
          onNext={() => (step === 3 ? setPhase("details") : setStep(step + 1))}
        />
      ) : null}
      {phase === "details" ? (
        <Details
          headingRef={headingRef}
          values={{ adAccountId, pageId, instagramAccountId }}
          setters={{ setAdAccountId, setPageId, setInstagramAccountId }}
          busy={busy}
          onSubmit={submit}
          onBack={() => {
            setPhase("guide");
            setStep(3);
          }}
        />
      ) : null}
      {phase === "status" && request ? (
        <StatusCard
          request={request}
          headingRef={headingRef}
          onRefresh={() => void loadRequest(true)}
          onRestart={() => {
            setRequest(null);
            setPhase("intro");
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

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[760px] rounded-(--r-panel) border border-(--line) bg-(--surface) p-4 shadow-card sm:p-5">
      {children}
    </section>
  );
}

function Progress({ phase }: { phase: Phase }) {
  const active =
    phase === "intro" ? 0 : phase === "guide" ? 1 : phase === "details" ? 2 : 3;
  return (
    <ol
      className="mx-auto grid w-full max-w-[760px] grid-cols-4 gap-2"
      aria-label="Meta partner-access progress"
    >
      {["Get ready", "Share in Meta", "Send IDs", "Verify"].map(
        (label, index) => (
          <li key={label} aria-current={index === active ? "step" : undefined}>
            <span
              className={`block h-1 rounded-full ${index <= active ? "bg-foreground" : "bg-(--line-heavy)"}`}
            />
            <span className="mt-1.5 block truncate text-[10.5px] font-semibold text-muted-foreground">
              {label}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

function Intro({
  headingRef,
  onNext,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onNext: () => void;
}) {
  return (
    <Panel>
      <p className="font-mono text-[9.5px] tracking-[0.12em] text-(--faint) uppercase">
        About five minutes
      </p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 font-display text-[17px] font-extrabold outline-none"
      >
        Before you start
      </h2>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        You stay signed in to Meta and choose exactly what Blockwise can access.
        We never see your Meta password.
      </p>
      <ul className="mt-4 grid gap-3">
        <Ready title="Meta Business Portfolio admin access">
          You must be able to add a partner and assign assets.
        </Ready>
        <Ready title="Your ad account and Facebook Page">
          Both should be in the same Business Portfolio.
        </Ready>
        <Ready title="Instagram professional account (optional)">
          Share it only if ads should use your Instagram identity.
        </Ready>
      </ul>
      <p className="mt-4 rounded-(--r-card) bg-(--surface-subtle) px-4 py-3 text-[12.5px] text-muted-foreground">
        You can remove Blockwise at any time. Until direct Meta app access is
        approved, an authorised Blockwise operator publishes for you manually.
      </p>
      <Button className="mt-4 min-h-11" onClick={onNext}>
        Show me what to do <ArrowRight />
      </Button>
    </Panel>
  );
}

function Ready({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[13.5px]">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--ui-success-soft) text-(--ui-success)">
        <Check size={14} />
      </span>
      <span>
        <strong className="block">{title}</strong>
        <span className="text-[12.5px] text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

function Guide({
  step,
  businessId,
  copied,
  headingRef,
  onCopy,
  onBack,
  onNext,
}: {
  step: number;
  businessId: string | null;
  copied: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCopy: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const item = STEPS[step];
  return (
    <section className="overflow-hidden rounded-(--r-panel) border border-(--line) bg-(--surface) shadow-card">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[9.5px] tracking-[0.12em] text-(--faint) uppercase">
              Meta step {step + 1} of 4
            </p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 font-display text-[17px] font-extrabold outline-none"
            >
              {item.title}
            </h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              {item.copy}
            </p>
          </div>
          <Button variant="outline" className="min-h-11 self-start" asChild>
            <a
              href={META_PARTNERS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Meta Business Settings <ExternalLink />
            </a>
          </Button>
        </div>
        <p className="mt-2 rounded-(--r-card) bg-(--surface-subtle) px-3.5 py-2.5 text-[12px] text-muted-foreground">
          Meta opens in a separate browser tab. Keep this Blockwise page open so
          you can continue to the next step.
        </p>
        <div className="mt-4 grid items-start gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-4">
          <div className="flex flex-col gap-3">
            {"showId" in item && item.showId ? (
              <div className="flex flex-col gap-3 rounded-(--r-card) border border-(--line-heavy) bg-(--surface-subtle) p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="block text-[11.5px] font-semibold text-muted-foreground">
                    Blockwise Business ID
                  </span>
                  <code className="mt-1 block break-all text-[15.5px] font-bold tracking-[0.04em]">
                    {businessId ?? "Not configured"}
                  </code>
                </div>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={!businessId}
                  onClick={onCopy}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy ID"}
                </Button>
              </div>
            ) : null}
            {"permissions" in item && item.permissions ? (
              <div className="rounded-(--r-card) border border-(--line-heavy) p-3.5 text-[12.5px]">
                <strong>
                  For the ad account, turn on both partial-access permissions:
                </strong>
                <ul className="mt-2 grid gap-1.5 text-muted-foreground">
                  <li>
                    <strong className="text-foreground">
                      Manage campaigns (ads)
                    </strong>{" "}
                    — create and edit ads.
                  </li>
                  <li>
                    <strong className="text-foreground">View performance</strong>{" "}
                    — view reports and results.
                  </li>
                </ul>
                <p className="mt-2 font-semibold text-(--ui-warning)">
                  Leave Full control off.
                </p>
              </div>
            ) : null}
            <p className="text-[12.5px] text-muted-foreground lg:mt-auto lg:pt-3">
              <strong className="text-foreground">Tip:</strong> {item.tip}
            </p>
          </div>
          <div className="overflow-hidden rounded-(--r-card) border border-(--line-heavy) bg-white p-2 sm:p-3">
            <Image
              className="mx-auto h-auto w-auto max-w-full"
              src={item.image}
              width={item.width}
              height={item.height}
              alt={item.alt}
              priority={step === 0}
              sizes="(min-width: 1024px) 620px, 100vw"
            />
            <div className="mt-2 flex justify-center">
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    aria-label={`View full-size Meta step ${step + 1} screenshot`}
                  >
                    <ZoomIn />
                    View full-size screenshot
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[min(1100px,92vw)]">
                  <DialogHeader>
                    <DialogTitle>
                      Step {step + 1}: {item.title} — full-size Meta screenshot
                    </DialogTitle>
                  </DialogHeader>
                  <div className="max-h-[70vh] overflow-auto rounded-(--r-card) border border-(--line-heavy) bg-white p-2">
                    <Image
                      className="mx-auto h-auto w-auto max-w-full"
                      src={"fullImage" in item ? item.fullImage : item.image}
                      width={"fullImage" in item ? item.fullWidth : item.width}
                      height={"fullImage" in item ? item.fullHeight : item.height}
                      alt={item.alt}
                      sizes="(min-width: 1100px) 1050px, 92vw"
                    />
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    Press Escape to close.{" "}
                    <a
                      className="underline"
                      href={item.image}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open the image file in a new tab
                    </a>{" "}
                    if you prefer.
                  </p>
                </DialogContent>
              </Dialog>
            </div>
            <p className="mt-1.5 text-center text-[11.5px] text-muted-foreground">
              Real Meta Business Settings screen. Meta may change labels.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-(--line) pt-4">
          <Button variant="outline" className="min-h-11" onClick={onBack}>
            <ArrowLeft />
            {step === 0 ? "Back to start" : "Previous"}
          </Button>
          <Button className="min-h-11" onClick={onNext}>
            {item.action}
            <ArrowRight />
          </Button>
        </div>
      </div>
    </section>
  );
}

function Details({
  headingRef,
  values,
  setters,
  busy,
  onSubmit,
  onBack,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  values: { adAccountId: string; pageId: string; instagramAccountId: string };
  setters: {
    setAdAccountId: (value: string) => void;
    setPageId: (value: string) => void;
    setInstagramAccountId: (value: string) => void;
  };
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  return (
    <Panel>
      <p className="font-mono text-[9.5px] tracking-[0.12em] text-(--faint) uppercase">
        Final step
      </p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 font-display text-[17px] font-extrabold outline-none"
      >
        Tell us which assets you shared
      </h2>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        These IDs let the operator verify the exact assets. They do not give
        Blockwise access by themselves.
      </p>
      <form className="mt-4 grid gap-3.5" onSubmit={onSubmit}>
        <Field
          id="meta-ad-account-id"
          label="Ad account ID"
          value={values.adAccountId}
          onChange={setters.setAdAccountId}
          placeholder="Example: 123456789012345"
        >
          In Meta Business Settings, open Accounts → Ad accounts.
        </Field>
        <Field
          id="meta-page-id"
          label="Facebook Page ID"
          value={values.pageId}
          onChange={setters.setPageId}
          placeholder="Example: 123456789012345"
        >
          In Meta Business Settings, open Accounts → Pages.
        </Field>
        <Field
          id="meta-instagram-id"
          label="Instagram account ID (optional)"
          value={values.instagramAccountId}
          onChange={setters.setInstagramAccountId}
          placeholder="Leave blank if you do not use Instagram"
          optional
        >
          Only include the professional Instagram account linked to the Page.
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={onBack}
          >
            <ArrowLeft />
            Back
          </Button>
          <Button type="submit" className="min-h-11" disabled={busy}>
            {busy ? "Sending…" : "I’ve assigned the assets"}
            {!busy ? <ArrowRight /> : null}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  optional,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={!optional}
      />
      <p className="text-[11.5px] text-muted-foreground">{children}</p>
    </div>
  );
}

function StatusCard({
  request,
  headingRef,
  onRefresh,
  onRestart,
}: {
  request: PartnerAccessRequest;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRefresh: () => void;
  onRestart: () => void;
}) {
  const copy = STATUS[request.status];
  const restart =
    request.status === "needs_changes" || request.status === "cancelled";
  return (
    <Panel>
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--surface-subtle)">
          <ShieldCheck size={18} />
        </span>
        <div>
          <p className="font-mono text-[9.5px] tracking-[0.12em] text-(--faint) uppercase">
            Partner access
          </p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 font-display text-[17px] font-extrabold outline-none"
          >
            {copy.title}
          </h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {copy.body}
          </p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-(--line) rounded-(--r-card) border border-(--line) px-4">
        <Asset
          icon={<Megaphone size={15} />}
          label="Ad account"
          value={request.adAccountId}
        />
        <Asset
          icon={<strong className="text-[11px]">f</strong>}
          label="Facebook Page"
          value={request.pageId}
        />
        <Asset
          icon={<Instagram size={15} />}
          label="Instagram"
          value={request.instagramAccountId ?? "Not shared"}
        />
      </dl>
      {request.statusReason ? (
        <p className="mt-4 rounded-(--r-card) bg-(--surface-subtle) px-4 py-3 text-[12.5px]">
          <strong className="block">Operator note</strong>
          <span className="text-muted-foreground">{request.statusReason}</span>
        </p>
      ) : null}
      <p className="mt-4 text-[11.5px] text-muted-foreground">
        This is verified partner access for operator-assisted publishing. It is
        not a direct Meta API connection.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {["requested", "verifying"].includes(request.status) ? (
          <Button variant="outline" className="min-h-11" onClick={onRefresh}>
            <RefreshCw />
            Check status
          </Button>
        ) : null}
        {request.status === "ready_for_manual_publishing" ? (
          <Button className="min-h-11" asChild>
            <a href="/ad-studio/ads">
              Continue to Ad Studio <ArrowRight />
            </a>
          </Button>
        ) : null}
        {restart ? (
          <Button className="min-h-11" onClick={onRestart}>
            Follow the guide again <ArrowRight />
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

function Asset({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 py-3 text-[12.5px] sm:grid-cols-[24px_140px_minmax(0,1fr)] sm:items-center">
      <span className="row-span-2 grid size-6 place-items-center rounded-full bg-(--surface-subtle) sm:row-span-1">
        {icon}
      </span>
      <dt className="font-semibold">{label}</dt>
      <dd className="break-all font-mono text-[11.5px] text-muted-foreground sm:text-right">
        {value}
      </dd>
    </div>
  );
}
