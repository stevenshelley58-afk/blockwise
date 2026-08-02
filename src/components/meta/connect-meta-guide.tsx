"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";

type PartnerAccount = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  isActive: boolean;
  businessName: string | null;
  claimed: boolean;
};

type PollResponse = {
  configured?: boolean;
  businessId?: string | null;
  accounts?: PartnerAccount[];
  error?: string;
};

type ClaimResponse = {
  connected?: boolean;
  adAccountId?: string;
  adAccountName?: string;
  error?: string;
};

const POLL_INTERVAL_MS = 6000;

// How long to keep polling before assuming the customer got stuck and offering
// a retry, so the page never spins forever on a silent failure.
const MAX_POLL_MS = 5 * 60 * 1000;

const CHECKLIST = [
  {
    step: "1",
    body: (
      <>
        <b className="font-semibold text-foreground">Add</b> → “Give a partner access to your assets” → paste the
        Business ID above.
      </>
    ),
  },
  {
    step: "2",
    body: (
      <>
        Tick your <b className="font-semibold text-foreground">ad account</b> · turn on{" "}
        <b className="font-semibold text-foreground">Manage campaigns</b> +{" "}
        <b className="font-semibold text-foreground">View performance</b>.
      </>
    ),
  },
  {
    step: "3",
    body: (
      <>
        <b className="font-semibold text-foreground">Save changes</b> — this page updates by itself.
      </>
    ),
  },
];

export function ConnectMetaGuide({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [copied, setCopied] = useState(false);
  const [accounts, setAccounts] = useState<PartnerAccount[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);
  const [pollStalled, setPollStalled] = useState(false);

  const pollStart = useRef<number>(Date.now());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/integrations/meta/partner-accounts?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => ({}))) as PollResponse;

      if (data.businessId) setBusinessId(data.businessId);
      if (typeof data.configured === "boolean") setConfigured(data.configured);
      setLoadError(data.error && !data.accounts?.length ? data.error : null);

      const list = data.accounts ?? [];
      setAccounts(list);

      // A claimable account is one that is visible, not yet claimed, and has
      // at least the performance/campaign access we need to publish.
      const claimable = list.filter((account) => !account.claimed && account.isActive);

      if (claimable.length > 0) {
        clearPoll();
        return;
      }

      if (Date.now() - pollStart.current > MAX_POLL_MS) {
        setPollStalled(true);
        clearPoll();
        return;
      }

      pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
    } catch {
      setLoadError("Couldn't reach Meta right now. We'll keep watching.");
      pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS * 2);
    }
  }, [workspaceId, clearPoll]);

  useEffect(() => {
    if (!canManage) return;
    pollStart.current = Date.now();
    poll();
    return clearPoll;
  }, [poll, clearPoll, canManage]);

  async function copyBusinessId() {
    if (!businessId) return;
    try {
      await navigator.clipboard.writeText(businessId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can fail in non-secure contexts; the ID is still selectable.
    }
  }

  async function claim(account: PartnerAccount) {
    setClaimingId(account.id);
    setClaimError(null);
    try {
      const res = await fetch(`/api/integrations/meta/partner-claim?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          adAccountId: account.id,
          adAccountName: account.name,
          currency: account.currency,
          timezone: account.timezone,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ClaimResponse;
      if (!res.ok || !data.connected) {
        setClaimError(data.error ?? "Couldn't connect that ad account. Try again.");
        setClaimingId(null);
        return;
      }
      setConnectedAccount(data.adAccountName ?? data.adAccountId ?? account.name);
    } catch {
      setClaimError("Couldn't connect that ad account. Try again.");
      setClaimingId(null);
    }
  }

  const claimable = accounts.filter((account) => !account.claimed && account.isActive);

  if (connectedAccount) {
    return (
      <div className="grid gap-4 rounded-(--r-panel) border border-(--line) bg-(--surface) p-6 shadow-card sm:p-8">
        <span className="grid size-12 place-items-center rounded-full bg-success-soft text-success">
          <Check size={22} aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-[19px] font-extrabold tracking-[-0.015em]">Meta connected</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {connectedAccount} is linked to Blockwise. You can now publish ads and see performance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href="/settings#connections">Finish publishing setup</a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/results">View performance</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {/* The one Blockwise surface: hold the Business ID + open Meta */}
      <div className="grid gap-4 rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--accent-tint)">
            <Search size={19} aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
              Paste this ID on the Meta tab
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              We opened Meta&apos;s Partners page in a new tab. Give Blockwise access to your ad account and this
              page picks it up automatically.
            </p>
          </div>
        </div>

        {configured ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--r-card) border border-(--line-heavy) bg-(--surface-subtle) px-4 py-3">
              <div className="grid">
                <span className="font-mono text-[9px] font-medium tracking-[0.13em] text-(--faint) uppercase">
                  Blockwise Business ID
                </span>
                <span className="font-mono text-[18px] font-medium tracking-[0.02em]">
                  {businessId ?? "…"}
                </span>
              </div>
              <Button variant="outline" type="button" onClick={copyBusinessId} disabled={!businessId}>
                {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <ol className="grid gap-2.5">
              {CHECKLIST.map((item) => (
                <li key={item.step} className="flex items-start gap-3 text-[13px] text-muted-foreground">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-(--line) bg-(--surface-subtle) text-[11px] font-bold text-(--faint)">
                    {item.step}
                  </span>
                  <span className="pt-0.5">{item.body}</span>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild>
                <a href="https://business.facebook.com/settings/partners" target="_blank" rel="noreferrer">
                  Open Meta Partners page <ExternalLink size={15} aria-hidden />
                </a>
              </Button>
              <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {pollStalled ? "Still watching — try saving again on Meta." : "Watching for your ad account…"}
              </span>
            </div>

            {loadError ? <p className="text-[12.5px] font-bold text-error">{loadError}</p> : null}
            {pollStalled ? (
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setPollStalled(false);
                  pollStart.current = Date.now();
                  poll();
                }}
              >
                Resume watching
              </Button>
            ) : null}
          </>
        ) : (
          <div className="rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle) px-4 py-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              Meta partner access is being switched on for your workspace. Please check back in a few minutes, or
              contact support if this message stays.
            </p>
          </div>
        )}
      </div>

      {/* Step 04: "This yours?" — the confirm that doubles as attribution */}
      {claimable.length > 0 ? (
        <div className="grid gap-4 rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card sm:p-6">
          <div>
            <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">We can see an ad account</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Confirm it&apos;s yours and we&apos;ll connect it.
            </p>
          </div>
          <div className="grid gap-2.5">
            {claimable.map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-4 py-3"
              >
                <div className="grid">
                  <span className="text-[13.5px] font-bold">{account.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {account.id}
                    {account.businessName ? ` · ${account.businessName}` : ""}
                  </span>
                </div>
                <Button type="button" onClick={() => claim(account)} disabled={claimingId !== null}>
                  {claimingId === account.id ? (
                    <>
                      <Loader2 size={15} className="animate-spin" aria-hidden /> Connecting…
                    </>
                  ) : (
                    "Yes, that's mine — connect it"
                  )}
                </Button>
              </div>
            ))}
          </div>
          {claimError ? <p className="text-[12.5px] font-bold text-error">{claimError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
