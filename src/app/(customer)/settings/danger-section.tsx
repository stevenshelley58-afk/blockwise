"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function DangerSection({
  supabase,
  router,
  workspaceId,
  workspaceName,
}: {
  supabase: SB;
  router: RT;
  workspaceId: string;
  workspaceName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  async function signOutEverywhere() {
    setBusy(true);
    await supabase.auth.signOut({ scope: "global" });
    router.replace("/login");
    router.refresh();
  }

  function requestDeletion() {
    setConfirmName("");
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
          ? { tone: "success", text: "Deletion request received. We will be in touch to confirm." }
          : { tone: "error", text: data.error ?? "Could not submit the request." }
      );
    } catch {
      setDelBusy(false);
      setMessage({ tone: "error", text: "Could not submit the request." });
    }
  }

  const canDelete = confirmName.trim() === workspaceName.trim() && workspaceName.trim().length > 0;

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
          <strong className="text-sm font-medium text-error">Delete account and workspace data</strong>
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
            <DialogDescription>
              We will verify the request, stop active services, and permanently delete the workspace data within the period stated in our Privacy Policy.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <label htmlFor="confirm-delete-name" className="text-sm font-medium">
              Type your workspace name to confirm
            </label>
            <Input
              id="confirm-delete-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={workspaceName}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" type="button" onClick={confirmDeletion} disabled={!canDelete}>
              Submit deletion request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
