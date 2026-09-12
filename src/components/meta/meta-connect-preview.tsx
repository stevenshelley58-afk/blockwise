"use client";

import {
  BarChart3,
  Check,
  Clipboard,
  ExternalLink,
  Facebook,
  Instagram,
  LoaderCircle,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  META_PARTNER_STEPS,
  type MetaPartnerStep,
} from "@/components/meta/partner-steps";
import {
  META_CONNECT_PREVIEW,
  type MetaConnectPreviewState,
} from "@/config/niche/blockwise/meta-connect-preview";

type ConnectionState = "idle" | "checking" | "missing" | "waiting" | "connected";

/**
 * Code-led composition: the existing customer surface supplies the tokens,
 * pill CTA and Inter/Manrope voice. This preview keeps the task in four compact
 * panels and makes every provider-like result explicitly synthetic.
 */
export function MetaConnectPreview({ businessId }: { businessId: string | null }) {
  const [scenario, setScenario] = useState<MetaConnectPreviewState>("setup");
  const [hydrated, setHydrated] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [checking, setChecking] = useState(false);
  const [continued, setContinued] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [checkMessage, setCheckMessage] = useState("No check has run yet.");
  const timerRef = useRef<number | null>(null);
  const resolveCheckRef = useRef<(() => void) | null>(null);
  const checkRunRef = useRef(0);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setConnectionState(
      scenario === "connected"
        ? "connected"
        : scenario === "waiting"
          ? "waiting"
          : scenario === "missing"
            ? "missing"
            : "idle",
    );
    setContinued(false);
    setChecking(false);
    setCheckMessage("No check has run yet.");

    return () => {
      checkRunRef.current += 1;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      resolveCheckRef.current?.();
      resolveCheckRef.current = null;
    };
  }, [scenario]);

  const status = useMemo(() => {
    if (checking) {
      return {
        label: "Checking",
        title: "Checking connection",
        body: "SIMULATED check. No request is being sent to Meta.",
        tone: "blue" as StatusTone,
      };
    }
    if (connectionState === "connected") {
      return {
        label: "Connected",
        title: "All set",
        body: "We found the example Page and ad account.",
        tone: "green" as StatusTone,
      };
    }
    if (connectionState === "missing") {
      return {
        label: "Missing access",
        title: "One permission needs attention",
        body: "The example check could not find the required access.",
        tone: "amber" as StatusTone,
      };
    }
    if (connectionState === "waiting") {
      return {
        label: "Waiting",
        title: "Waiting for approval",
        body: "A Meta Business Portfolio admin still needs to approve the request.",
        tone: "blue" as StatusTone,
      };
    }
    return {
      label: "Not checked",
      title: "Check connection",
      body: "Add Blockwise and assign the assets, then check here.",
      tone: "blue" as StatusTone,
    };
  }, [checking, connectionState]);

  async function runCheck() {
    const runId = ++checkRunRef.current;
    setChecking(true);
    setContinued(false);
    setCheckMessage("SIMULATED check in progress. No Meta request is running.");

    await new Promise<void>((resolve) => {
      resolveCheckRef.current = resolve;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        resolveCheckRef.current = null;
        resolve();
      }, 700);
    });

    if (runId !== checkRunRef.current) return;

    setChecking(false);
    if (scenario === "setup") {
      setConnectionState("connected");
      setCheckMessage("SIMULATED check complete. Example assets were discovered.");
    } else if (scenario === "missing") {
      setConnectionState("missing");
      setCheckMessage(
        "SIMULATED check complete. Retry after enabling the requested partial access.",
      );
    } else {
      setConnectionState("waiting");
      setCheckMessage(
        "SIMULATED check complete. Still waiting for Meta Business Portfolio approval.",
      );
    }
  }

  async function copyBusinessId() {
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

  const checkLabel =
    connectionState === "missing"
      ? "Retry check"
      : connectionState === "waiting"
        ? "Check again"
        : "I've added Blockwise";

  return (
    <main
      className="tw min-h-screen bg-background text-foreground"
      data-preview-ready={hydrated ? "true" : "false"}
    >
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-[68px] w-full max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
          <a
            href="/meta-connect-preview"
            aria-label="Reset preview"
            className="inline-flex min-h-11 items-center"
          >
            <img
              src="/meta-connect-preview/brand/blockwise-logo.svg"
              alt="Blockwise"
              className="h-7 w-auto"
            />
          </a>
          <div className="flex items-center gap-3 text-right text-[11px] text-muted-foreground sm:text-xs">
            <Badge
              variant="outline"
              className="px-2.5 py-1 text-[11px] font-semibold"
            >
              Preview
            </Badge>
            <span>No accounts will be changed</span>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-6">
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.04em]">
            Connect Facebook &amp; Instagram
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Add Blockwise to your Meta Business Portfolio, then choose the
            assets to share.
          </p>
        </div>

        <details className="mb-6 rounded-(--r-card) border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Preview options
          </summary>
          <div className="mt-3 grid max-w-[240px] gap-1.5">
            <label
              id="preview-state-label"
              htmlFor="preview-state"
              className="text-xs font-semibold text-muted-foreground"
            >
              Preview state
            </label>
            <Select
              value={scenario}
              disabled={!hydrated}
              onValueChange={(value) =>
                setScenario(value as MetaConnectPreviewState)
              }
            >
              <SelectTrigger
                id="preview-state"
                aria-labelledby="preview-state-label"
                className="h-11 w-full rounded-(--r-ctl)"
              >
                <SelectValue placeholder="Choose a state" />
              </SelectTrigger>
              <SelectContent>
                {META_CONNECT_PREVIEW.states.map((item) => (
                  <SelectItem value={item.value} key={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </details>

        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <li>
            <PreviewPanel number="1" eyebrow="Connect Meta" title="Connect your Meta accounts">
              <p className="text-sm leading-5 text-muted-foreground">
                Give Blockwise access to your business assets. You choose what
                we can access and can remove it anytime.
              </p>
              <Button
                asChild
                className="mt-5 h-11 min-h-11 w-full"
                variant="default"
              >
                <a
                  href={META_CONNECT_PREVIEW.metaSettingsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Meta Business Settings
                </a>
              </Button>
            </PreviewPanel>
          </li>

          <li>
            <PreviewPanel number="2" eyebrow="Add Blockwise as a partner" title="Use our Business Portfolio ID">
              <p className="text-sm leading-5 text-muted-foreground">
                Add Blockwise as a partner in Meta Business Settings.
              </p>
              <div className="mt-4 rounded-(--r-ctl) border border-border bg-(--surface-subtle) p-3">
                <span className="block text-xs text-muted-foreground">
                  Blockwise Business Portfolio ID
                </span>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="break-all text-base font-semibold tracking-[0.02em]">
                    {businessId ?? "Unavailable"}
                  </code>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="Copy Business Portfolio ID"
                    onClick={() => void copyBusinessId()}
                    disabled={!businessId || !hydrated}
                    arrow={null}
                  >
                    {copyState === "copied" ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Clipboard aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>
              {copyState === "failed" ? (
                <p className="mt-2 text-xs text-destructive" role="alert">
                  Copy was unavailable. Select the ID and copy it manually.
                </p>
              ) : null}
            </PreviewPanel>
          </li>

          <li>
            <PreviewPanel number="3" eyebrow="Share your assets" title="Share these assets">
              <p className="text-sm leading-5 text-muted-foreground">
                Choose Partial access. Leave Full control off.
              </p>
              <div className="mt-4 space-y-2">
                <AssetRow
                  icon={<Facebook aria-hidden="true" />}
                  label="Facebook Page"
                  detail="Required"
                />
                <AssetRow
                  icon={<BarChart3 aria-hidden="true" />}
                  label="Ad account"
                  detail="Required"
                />
                <AssetRow
                  icon={<Instagram aria-hidden="true" />}
                  label="Instagram account"
                  detail="Optional"
                />
              </div>
            </PreviewPanel>
          </li>

          <li>
            <PreviewPanel number="4" eyebrow="Check connection" title={status.title}>
              <p className="text-sm leading-5 text-muted-foreground">
                {status.body}
              </p>
              {connectionState === "connected" ? (
                <AssetConfirmation
                  hydrated={hydrated}
                  continued={continued}
                  onContinue={() => setContinued(true)}
                />
              ) : (
                <div className="mt-5">
                  <Button
                    type="button"
                    className="h-11 min-h-11 w-full"
                    onClick={() => void runCheck()}
                    disabled={checking || !hydrated}
                  >
                    {checking ? (
                      <LoaderCircle
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : connectionState === "missing" ? (
                      <RefreshCw aria-hidden="true" />
                    ) : (
                      <Shield aria-hidden="true" />
                    )}
                    {checking ? "Checking" : checkLabel}
                  </Button>
                  <p
                    className="mt-3 text-center text-xs text-muted-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {checkMessage}
                  </p>
                </div>
              )}
              {connectionState !== "connected" ? (
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              ) : null}
              {continued ? (
                <div className="mt-4 border-t border-border pt-4">
                  <p
                    className="rounded-(--r-card) bg-success-soft px-3 py-2.5 text-xs leading-5 text-foreground"
                    role="status"
                  >
                    <strong>Next step preview:</strong> your example assets are
                    ready for publishing setup. Nothing was saved.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 h-11 min-h-11"
                    onClick={() => setContinued(false)}
                    arrow={null}
                  >
                    Back to result
                  </Button>
                </div>
              ) : null}
            </PreviewPanel>
          </li>
        </ol>

        <details className="mt-6 rounded-(--r-card) border border-border bg-card">
          <summary className="cursor-pointer px-4 py-4 text-sm font-semibold sm:px-5">
            Need the full walkthrough?
          </summary>
          <div className="grid gap-5 border-t border-border p-4 sm:p-5 lg:grid-cols-2">
            <p className="text-sm leading-5 text-muted-foreground lg:col-span-2">
              These are the real Blockwise help screenshots. Click any image to
              open it full size. They show where to click in Meta, not a live
              account.
            </p>
            {META_PARTNER_STEPS.map((step) => (
              <WalkthroughStep step={step} key={step.title} />
            ))}
          </div>
        </details>
      </div>
    </main>
  );
}

function PreviewPanel({
  number,
  eyebrow,
  title,
  children,
}: {
  number: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-[300px] flex-col rounded-(--r-card) border border-border bg-card p-5 shadow-card">
      <span className="grid size-8 place-items-center rounded-full bg-(--surface-subtle) text-sm font-semibold text-foreground">
        {number}
      </span>
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="mt-2 font-display text-[clamp(1.35rem,2vw,1.8rem)] font-semibold leading-tight tracking-[-0.03em]">
        {title}
      </h2>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </section>
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
    <div className="flex items-center gap-3 rounded-(--r-ctl) border border-border bg-(--surface-subtle) px-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-semibold">{label}</strong>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

function AssetConfirmation({
  hydrated,
  continued,
  onContinue,
}: {
  hydrated: boolean;
  continued: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 text-success">
        <Check size={16} aria-hidden="true" />
        <span className="text-sm font-semibold">Example assets found</span>
      </div>
      <ul className="mt-3 space-y-2">
        {META_CONNECT_PREVIEW.exampleAssets.map((asset) => (
          <li
            key={asset.label}
            className="flex items-center gap-3 rounded-(--r-ctl) border border-border bg-success-soft/40 px-3 py-2.5"
          >
            <span className="min-w-0">
              <strong className="block text-sm font-semibold">
                {asset.name}
              </strong>
              <span className="text-xs text-muted-foreground">
                {asset.label}
              </span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 rounded-(--r-ctl) border border-border bg-(--surface-subtle) px-3 py-2.5">
          <span className="min-w-0">
            <strong className="block text-sm font-semibold">Not selected</strong>
            <span className="text-xs text-muted-foreground">
              Instagram account, optional
            </span>
          </span>
        </li>
      </ul>
      {!continued ? (
        <Button
          type="button"
          className="mt-4 h-11 min-h-11 w-full"
          onClick={onContinue}
          disabled={!hydrated}
        >
          Continue
        </Button>
      ) : null}
    </div>
  );
}

function WalkthroughStep({ step }: { step: MetaPartnerStep }) {
  const image = `/meta-connect-preview${step.image}`;
  const fullImage = `/meta-connect-preview${step.fullImage ?? step.image}`;
  const caption =
    step.title === "Choose assets and permissions"
      ? "Use this image to locate the controls. Turn on Manage campaigns and View performance. Leave Full control off."
      : step.where;

  return (
    <article className="overflow-hidden rounded-(--r-card) border border-border bg-(--surface-subtle)">
      <div className="p-4">
        <h3 className="font-display text-lg font-semibold">{step.title}</h3>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{caption}</p>
      </div>
      <a
        href={fullImage}
        target="_blank"
        rel="noopener noreferrer"
        className="block border-y border-border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={image}
          alt={step.alt}
          width={step.width}
          height={step.height}
          className="mx-auto h-auto max-h-[460px] w-full object-contain"
        />
      </a>
      <div className="space-y-3 p-4 text-sm leading-5">
        <ul className="space-y-1.5 text-muted-foreground">
          {step.detail.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {step.tips.length ? (
          <ul className="space-y-1.5 text-muted-foreground">
            {step.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
