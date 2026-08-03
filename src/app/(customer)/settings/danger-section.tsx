"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { niche } from "@/config/niche";

import { Feedback, Section, type Msg, type RT, type SB } from "./settings-shared";

export function DangerSection({ supabase, router, workspaceId }: { supabase: SB; router: RT; workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  async function signOutEverywhere() {
    setBusy(true);
    await supabase.auth.signOut({ scope: "global" });
    router.replace("/login");
    router.refresh();
  }

  function requestDeletion() {
    setConfirmDeleteOpen(true);
  }

  async function confirmDeletion() {
    setConfirmDeleteOpen(false);
    setDelBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/account/delete-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setDelBusy(false);
      setMessage(
        res.ok
          ? { tone: "success", text: "Deletion request received. We'll be in touch to confirm." }
          : { tone: "error", text: data.error ?? "Couldn't submit the request." },
      );
    } catch {
      setDelBusy(false);
      setMessage({ tone: "error", text: "Couldn't submit the request." });
    }
  }

  return (
    <Section id="danger" title={niche.copy.settings.sections.danger}>
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-0.5">
          <strong className="text-sm font-medium">Sign out of all devices</strong>
          <span className="text-xs text-muted-foreground">Ends every active session for your account.</span>
        </div>
        <Button variant="outline" type="button" onClick={signOutEverywhere} disabled={busy}>
          {busy ? "Signing out" : "Sign out everywhere"}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-0.5">
          <strong className="text-sm font-medium">Delete account & workspace data</strong>
          <span className="text-xs text-muted-foreground">Submits a deletion request for review.</span>
        </div>
        <Button variant="destructive" type="button" onClick={requestDeletion} disabled={delBusy}>
          {delBusy ? "Submitting" : "Request deletion"}
        </Button>
      </div>
      <Feedback message={message} />

      <Dialog open={confirmDeleteOpen} onOpenChange={(open) => setConfirmDeleteOpen(open)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request workspace deletion?</DialogTitle>
            <DialogDescription>We will verify the request, stop active services, and permanently delete the workspace data within the period stated in our Privacy Policy.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" type="button" onClick={confirmDeletion}>
              Submit deletion request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
