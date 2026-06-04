"use client";

import { ArrowRight, Building2, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type StartChoiceProps = {
  workspaceId: string;
  onboardingStatus: "not_started" | "fast_path" | "full_setup" | "complete";
};

type Choice = {
  status: "fast_path" | "full_setup";
  href: string;
  title: string;
  description: string;
  action: string;
  icon: typeof WandSparkles;
  primary?: boolean;
};

const choices: Choice[] = [
  {
    status: "fast_path",
    href: "/ad-studio?first=1",
    title: "Create first ad",
    description: "Start with one image and a short brief. No Meta account is needed until you publish.",
    action: "Create first ad",
    icon: WandSparkles,
    primary: true,
  },
  {
    status: "full_setup",
    href: "/onboarding",
    title: "Set up my workspace",
    description: "Confirm your profile, brand, and ad connections before creating ads.",
    action: "Set up my workspace",
    icon: Building2,
  },
];

export function StartChoice({ workspaceId, onboardingStatus }: StartChoiceProps) {
  const router = useRouter();
  const [busyStatus, setBusyStatus] = useState<Choice["status"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: Choice) {
    if (busyStatus) return;

    if (onboardingStatus === "complete") {
      router.push(choice.href);
      return;
    }

    setBusyStatus(choice.status);
    setError(null);

    try {
      const response = await fetch("/api/workspace/onboarding-status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status: choice.status }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save your setup choice.");
      }

      router.push(choice.href);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your setup choice.");
      setBusyStatus(null);
    }
  }

  return (
    <section className="grid cols-2" aria-label="Choose setup path">
      {choices.map((choice) => {
        const Icon = choice.icon;
        const busy = busyStatus === choice.status;

        return (
          <article className="panel" key={choice.status}>
            <div className="stack">
              <Icon aria-hidden color="#123e75" size={24} />
              <div>
                <h2>{choice.title}</h2>
                <p className="item-meta">{choice.description}</p>
              </div>
              <button
                className={`button${choice.primary ? "" : " secondary"}`}
                type="button"
                onClick={() => void choose(choice)}
                disabled={Boolean(busyStatus)}
              >
                {busy ? "Saving" : choice.action}
                <ArrowRight aria-hidden size={16} />
              </button>
            </div>
          </article>
        );
      })}
      {error ? (
        <p className="wizard-status error" role="alert" style={{ gridColumn: "1 / -1" }}>
          {error}
        </p>
      ) : null}
      {onboardingStatus === "complete" ? (
        <p className="wizard-skip-note" style={{ gridColumn: "1 / -1" }}>
          Setup is already complete. Choosing a path will keep your workspace complete.
        </p>
      ) : null}
    </section>
  );
}
