"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DefaultPostcodeForm({
  initialPostcode,
  workspaceId,
  buttonLabel = "Save postcode",
}: {
  initialPostcode: string | null;
  workspaceId: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [postcode, setPostcode] = useState(initialPostcode ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/workspace/default-postcode", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, postcode }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; postcode?: string };
      if (!response.ok || !payload.postcode) {
        setMessage({ tone: "error", text: payload.error ?? "The postcode could not be saved. Try again." });
        return;
      }

      setPostcode(payload.postcode);
      setMessage({ tone: "success", text: "Postcode saved." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "The postcode could not be saved. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-3 sm:grid-cols-[minmax(0,180px)_auto] sm:items-end" onSubmit={save} noValidate>
      <div className="grid gap-2">
        <Label htmlFor={`default-postcode-${workspaceId}`}>Default postcode</Label>
        <Input
          id={`default-postcode-${workspaceId}`}
          value={postcode}
          onChange={(event) => setPostcode(event.target.value.replace(/\D/gu, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={4}
          pattern="[0-9]{4}"
          placeholder="e.g. 6019"
          required
          aria-invalid={message?.tone === "error" || undefined}
          aria-describedby={message ? `default-postcode-message-${workspaceId}` : undefined}
        />
      </div>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving" : buttonLabel}
        </Button>
      </div>
      {message ? (
        <p
          id={`default-postcode-message-${workspaceId}`}
          className={`text-[12.5px] font-bold sm:col-span-2 ${message.tone === "error" ? "text-error" : "text-success"}`}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
