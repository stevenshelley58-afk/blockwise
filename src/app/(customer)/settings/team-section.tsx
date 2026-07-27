"use client";

import { useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { niche } from "@/config/niche";

import {
  ASSIGNABLE_ROLES,
  Feedback,
  Section,
  selectClass,
  type Member,
  type Msg,
  type RT,
  type SB,
  type WorkspaceInvitation,
} from "./settings-shared";

const thClass = "font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase";

export function TeamSection({
  supabase,
  router,
  workspaceId,
  currentUserId,
  members,
  invitations,
  billingAccessState,
  currentRole,
}: {
  supabase: SB;
  router: RT;
  workspaceId: string;
  currentUserId: string;
  members: Member[];
  invitations: WorkspaceInvitation[];
  billingAccessState: string;
  currentRole: string;
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Msg>(null);
  const namedMemberCount = members.filter((member) => !member.isOperator).length;
  const reservedSeatCount = namedMemberCount + invitations.length;
  const seatsRemaining = Math.max(0, 5 - reservedSeatCount);
  const canInvite = currentRole === "owner" && billingAccessState === "paid" && seatsRemaining > 0;

  async function changeRole(profileId: string, role: string) {
    setRowBusy(profileId);
    setMessage(null);
    const { error } = await supabase.from("workspace_members").update({ role }).eq("workspace_id", workspaceId).eq("profile_id", profileId);
    setRowBusy(null);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't update that member's role." });
      return;
    }
    router.refresh();
  }

  async function remove(profileId: string) {
    setRowBusy(profileId);
    setMessage(null);
    const { error } = await supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("profile_id", profileId);
    setRowBusy(null);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't remove that member." });
      return;
    }
    setMessage({ tone: "success", text: "Member removed." });
    router.refresh();
  }

  async function cancelInvitation(invitationId: string) {
    setRowBusy(invitationId);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/team/invite", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, invitationId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setRowBusy(null);
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error ?? "Couldn't cancel that invitation." });
        return;
      }
      setMessage({ tone: "success", text: data.message ?? "Invitation cancelled." });
      router.refresh();
    } catch {
      setRowBusy(null);
      setMessage({ tone: "error", text: "Couldn't cancel that invitation." });
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setBusy(false);
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error ?? "Couldn't send that invite." });
        return;
      }
      setInviteEmail("");
      setMessage({ tone: "success", text: data.message ?? "Invitation sent." });
      router.refresh();
    } catch {
      setBusy(false);
      setMessage({ tone: "error", text: "Couldn't send that invite." });
    }
  }

  return (
    <Section id="team" title={niche.copy.settings.sections.team}>
      <div className="-mx-5 overflow-x-auto px-5">
        <Table className="min-w-[480px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={thClass}>Member</TableHead>
              <TableHead className={thClass}>Role</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isSelf = m.profileId === currentUserId;
              return (
                <TableRow key={m.profileId}>
                  <TableCell>
                    <div className="text-[13px] font-bold">
                      {m.fullName ?? m.email ?? "Unknown"}
                      {isSelf ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                    {!m.isOperator ? (
                      <div className="mt-1">
                        <StatusPill tone={m.emailVerified ? "green" : "amber"}>
                          {m.emailVerified ? "Email verified" : "Invite pending"}
                        </StatusPill>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {m.isOperator ? (
                      <StatusPill tone="blue">operator</StatusPill>
                    ) : isSelf ? (
                      <StatusPill tone="green">{m.role}</StatusPill>
                    ) : (
                      <select
                        aria-label={`Role for ${m.fullName ?? m.email ?? "this member"}`}
                        className={cn(selectClass, "w-32")}
                        value={m.role}
                        onChange={(e) => changeRole(m.profileId, e.target.value)}
                        disabled={rowBusy === m.profileId}
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!isSelf && !m.isOperator ? (
                      <Button variant="outline" type="button" onClick={() => remove(m.profileId)} disabled={rowBusy === m.profileId}>
                        Remove
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell>
                  <div className="text-[13px] font-bold">{invitation.email}</div>
                  <div className="mt-1">
                    <StatusPill tone="amber">Verification pending</StatusPill>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill tone="blue">{invitation.role}</StatusPill>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => cancelInvitation(invitation.id)}
                    disabled={rowBusy === invitation.id}
                  >
                    {rowBusy === invitation.id ? "Cancelling" : "Cancel"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-bold">Named team seats</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {reservedSeatCount} of 5 reserved · owner plus four invited, email-verified members
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {namedMemberCount} verified · {invitations.length} pending verification
            </p>
          </div>
          <StatusPill tone={seatsRemaining > 0 ? "blue" : "amber"}>
            {seatsRemaining} {seatsRemaining === 1 ? "seat" : "seats"} left
          </StatusPill>
        </div>
      </div>

      {billingAccessState !== "paid" ? (
        <p className="text-[12.5px] font-semibold text-muted-foreground">
          Team invitations unlock when the paid self-serve plan is active. Trial workspaces remain owner-only.
        </p>
      ) : currentRole !== "owner" ? (
        <p className="text-[12.5px] font-semibold text-muted-foreground">
          Only the workspace owner can invite another named member.
        </p>
      ) : seatsRemaining === 0 ? (
        <p className="text-[12.5px] font-semibold text-muted-foreground">
          All five seats are in use or reserved. Cancel a pending invitation or remove a member first.
        </p>
      ) : null}

      <form className="flex flex-wrap items-center gap-2" onSubmit={invite}>
        <Input
          type="email"
          aria-label="Teammate email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="teammate@email.com"
          required
          disabled={!canInvite}
          className="min-w-[220px] flex-1"
        />
        <select aria-label="Invite role" className={cn(selectClass, "w-32")} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} disabled={!canInvite}>
          {ASSIGNABLE_ROLES.filter((role) => role !== "owner").map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy || !canInvite}>
          {busy ? "Inviting" : "Invite"}
        </Button>
      </form>
      <Feedback message={message} />
    </Section>
  );
}
