"use client";

import { CheckCircle2, Circle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusPill } from "@/components/status-pill";

export type SetupChecklistItem = {
  id: string;
  label: string;
  description: string;
  complete: boolean;
  href: string;
};

const STORAGE_KEY = "blockwise:self-serve-setup-checklist-dismissed";

export function SetupChecklist({ items }: { items: SetupChecklistItem[] }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  }

  function reset() {
    window.localStorage.removeItem(STORAGE_KEY);
    setDismissed(false);
  }

  if (dismissed)
    return (
      <p className="item-meta" style={{ textAlign: "center" }}>
        <button type="button" className="link-button" onClick={reset}>
          Reset checklist
        </button>
      </p>
    );

  const completed = items.filter((item) => item.complete).length;

  return (
    <section className="panel" aria-label="Setup checklist">
      <div className="wizard-connect-row" style={{ alignItems: "flex-start" }}>
        <div>
          <h2>Setup checklist</h2>
          <p className="item-meta">
            {completed} of {items.length} complete. You can create ads before every item is done.
          </p>
        </div>
        <button className="icon-button" type="button" aria-label="Dismiss setup checklist" onClick={dismiss}>
          <X aria-hidden size={16} />
        </button>
      </div>

      <div className="stack" style={{ marginTop: 14 }}>
        {items.map((item) => {
          const Icon = item.complete ? CheckCircle2 : Circle;

          return (
            <div className="wizard-connect-row" key={item.id}>
              <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Icon aria-hidden size={19} color={item.complete ? "#31c46f" : "#94a3b8"} />
                <span>
                  <strong>{item.label}</strong>
                  <span className="item-meta" style={{ display: "block" }}>
                    {item.description}
                  </span>
                </span>
              </span>
              {item.complete ? (
                <StatusPill tone="green">Done</StatusPill>
              ) : (
                <Link className="button secondary" href={item.href}>
                  Open
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
