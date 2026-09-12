"use client";

import {
  Check,
  Clipboard,
  ExternalLink,
  Facebook,
  Instagram,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
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
  META_CONNECT_PREVIEW,
  type MetaConnectPreviewState,
} from "@/config/niche/blockwise/meta-connect-preview";

type ConnectionState = "idle" | "checking" | "missing" | "waiting" | "connected";

/**
 * Code-led composition: the existing customer surface supplies the tokens,
 * pill CTA and Inter/Manrope voice. This preview keeps the task in one compact
 * viewport and makes every provider-like result explicitly synthetic.
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
        title: "Checking shared access",
        body: "SIMULATED check in progress. No request is being sent to Meta.",
        tone: "blue" as StatusTone,
      };
    }
    if (connectionState === "connected") {
      return {
        label: "Connected",
        title: "Example access found",
        body: "The preview discovered the example Page and ad account below.",
        tone: "green" as StatusTone,
      };
    }
    if (connectionState === "missing") {
      return {
        label: "Missing access",
        title: "One permission still needs attention",
        body: "The example check could not find the Page and ad account with the required access.",
        tone: "amber" as StatusTone,
      };
    }
    if (connectionState === "waiting") {
      return {
        label: "Waiting",
        title: "Waiting for approval",
        body: "The example share is waiting for a Meta Business Portfolio admin to approve the request.",
        tone: "blue" as StatusTone,
      };
    }
    return {
      label: "Not checked",
      title: "Check your shared access",
      body: "After the Meta step, run the preview check to see the next state.",
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
        : connectionState === "idle"
          ? "I've added Blockwise"
          : "Check my sharing";

  return (
    <main
      className="tw min-h-screen bg-background text-foreground"
      data-preview-ready={hydrated ? "true" : "false"}
    >
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-[68px] w-full max-w-[1120px] items-center justify-between gap-4 px-5 sm:px-8">
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

      <div className="mx-auto w-full max-w-[1120px] px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-[620px]">
            <h1 className="font-display text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.04em]">
              Connect Facebook &amp; Instagram
            </h1>
            <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-muted-foreground">
              Share the assets Blockwise needs for your first lead ad. You stay
              in Meta, and you can remove access at any time.
            </p>
          </div>

          <div className="grid max-w-[220px] gap-1.5">
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
        </div>

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1.06fr)_minmax(350px,.94fr)] lg:items-start lg:gap-12">
          <section aria-labelledby="steps-heading">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2
                id="steps-heading"
                className="font-display text-lg font-semibold tracking-[-0.025em]"
              >
                Three quick steps
              </h2>
              <span className="text-xs text-muted-foreground">
                About two minutes
              </span>
            </div>

            <ol className="border-y border-border">
              <li className="grid gap-3 border-b border-border py-5 sm:grid-cols-[34px_1fr] sm:gap-4">
                <span
                  className="grid size-8 place-items-center rounded-full bg-secondary text-sm font-semibold"
                  aria-hidden="true"
                >
                  1
                </span>
                <div>
                  <h3 className="font-display text-[15px] font-semibold">
                    Open Meta Business Settings
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-5 text-muted-foreground">
                    Open Partners and choose Give a partner access to your
                    assets.
                  </p>
                  <Button
                    asChild
                    variant="outline"
                    className="mt-3 h-11 min-h-11"
                  >
                    <a
                      href={META_CONNECT_PREVIEW.metaSettingsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Meta settings
                    </a>
                  </Button>
                </div>
              </li>

              <li className="grid gap-3 border-b border-border py-5 sm:grid-cols-[34px_1fr] sm:gap-4">
                <span
                  className="grid size-8 place-items-center rounded-full bg-secondary text-sm font-semibold"
                  aria-hidden="true"
                >
                  2
                </span>
                <div>
                  <h3 className="font-display text-[15px] font-semibold">
                    Add the Blockwise Business ID
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-5 text-muted-foreground">
                    Paste this into Meta&apos;s Partner business ID field. The
                    ID grants nothing until you select assets.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 rounded-(--r-card) border border-border bg-secondary/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <code className="break-all text-sm font-semibold tracking-[0.03em]">
                      {businessId ?? "Business ID is unavailable in this preview"}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 min-h-11 shrink-0"
                      onClick={() => void copyBusinessId()}
                      disabled={!businessId || !hydrated}
                      arrow={null}
                    >
                      {copyState === "copied" ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Clipboard aria-hidden="true" />
                      )}
                      {copyState === "copied" ? "Copied" : "Copy ID"}
                    </Button>
                  </div>
                  {copyState === "failed" ? (
                    <p className="mt-2 text-xs text-destructive" role="alert">
                      Copy was unavailable. Select the ID and copy it manually.
                    </p>
                  ) : null}
                </div>
              </li>

              <li className="grid gap-3 py-5 sm:grid-cols-[34px_1fr] sm:gap-4">
                <span
                  className="grid size-8 place-items-center rounded-full bg-secondary text-sm font-semibold"
                  aria-hidden="true"
                >
                  3
                </span>
                <div>
                  <h3 className="font-display text-[15px] font-semibold">
                    Share the right assets
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-5 text-muted-foreground">
                    In Meta&apos;s asset picker, choose Partial access. Leave
                    Full control off, then click Assign assets.
                  </p>
                  <ul className="mt-3 space-y-2 rounded-(--r-card) border border-border bg-secondary/40 p-3 text-[13px] leading-5">
                    <li>
                      <strong>Facebook Page:</strong> Ads and lead access.
                    </li>
                    <li>
                      <strong>Ad account:</strong> Manage campaigns and View
                      performance.
                    </li>
                    <li>
                      <strong>Instagram account:</strong> optional.
                    </li>
                    <li>
                      <strong>Pixel:</strong> optional, for conversion tracking
                      only.
                    </li>
                  </ul>
                </div>
              </li>
            </ol>

            <details className="mt-5 rounded-(--r-card) border border-border bg-card px-4 py-3.5">
              <summary className="cursor-pointer text-sm font-semibold">
                Need the full walkthrough?
              </summary>
              <p className="mt-2 max-w-[64ch] text-[13px] leading-5 text-muted-foreground">
                Open Meta&apos;s official help for the longer partner-access
                walkthrough. This preview shows no Meta screens and makes no
                live account changes.
              </p>
              <a
                href={META_CONNECT_PREVIEW.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4"
              >
                Open Meta Help
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            </details>
          </section>

          <section
            aria-labelledby="check-heading"
            className="rounded-(--r-panel) border border-border bg-card p-5 shadow-card sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="check-heading"
                  className="font-display text-xl font-semibold tracking-[-0.03em]"
                >
                  {status.title}
                </h2>
              </div>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
            <p className="mt-3 text-[13.5px] leading-5 text-muted-foreground">
              {status.body}
            </p>

            {connectionState === "connected" ? (
              <AssetConfirmation
                hydrated={hydrated}
                continued={continued}
                onContinue={() => setContinued(true)}
              />
            ) : null}

            {connectionState !== "connected" || continued ? (
              <div className="mt-5 border-t border-border pt-4">
                {continued ? (
                  <p
                    className="mb-3 rounded-(--r-card) bg-secondary/60 px-3.5 py-3 text-[13px] leading-5 text-foreground"
                    role="status"
                  >
                    <strong>Next step preview:</strong> confirm the example
                    assets, then finish publishing setup. Nothing was saved and
                    no page changed.
                  </p>
                ) : null}
                {!continued ? (
                  <Button
                    type="button"
                    className="h-11 min-h-11 w-full sm:w-auto"
                    onClick={() => void runCheck()}
                    disabled={checking || !hydrated}
                    arrow={null}
                  >
                    {checking ? (
                      <LoaderCircle
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : connectionState === "missing" ? (
                      <RefreshCw aria-hidden="true" />
                    ) : (
                      <ShieldCheck aria-hidden="true" />
                    )}
                    {checking ? "Checking" : checkLabel}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 min-h-11"
                    onClick={() => setContinued(false)}
                    arrow={null}
                  >
                    Back to result
                  </Button>
                )}
                <p
                  className="mt-3 text-xs text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {checkMessage}
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
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
    <div className="mt-5 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm font-semibold">Example assets</h3>
        <Check size={16} className="text-success" aria-hidden="true" />
      </div>
      <ul className="mt-3 divide-y divide-border rounded-(--r-card) border border-border">
        {META_CONNECT_PREVIEW.exampleAssets.map((asset) => (
          <li
            key={asset.label}
            className="flex items-center gap-3 px-3.5 py-3"
          >
            <span className="grid size-8 place-items-center rounded-(--r-ctl) bg-secondary text-muted-foreground">
              {asset.label === "Facebook Page" ? (
                <Facebook size={15} aria-hidden="true" />
              ) : (
                <ShieldCheck size={15} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0">
              <strong className="block text-[13px] font-semibold">
                {asset.name}
              </strong>
              <span className="text-xs text-muted-foreground">
                {asset.label}
              </span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 px-3.5 py-3">
          <span className="grid size-8 place-items-center rounded-(--r-ctl) bg-secondary text-muted-foreground">
            <Instagram size={15} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <strong className="block text-[13px] font-semibold">
              Not selected
            </strong>
            <span className="text-xs text-muted-foreground">
              Instagram identity, optional
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
