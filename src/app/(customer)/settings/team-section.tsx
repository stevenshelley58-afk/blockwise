"use client";

import { useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { niche } from "@/config/niche";

import { ASSIGNABLE_ROLES, Feedback, Section, selectClass, type Member, type Msg, type RT, type SB } from "./settings-shared";

const thClass = "font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase";

export function TeamSection({
  supabase,
  router,
  workspaceId,
  currentUserId,
  members,
}: {
  supabase: SB;
  router: RT;
  workspaceId: string;
  currentUserId: string;
  members: Member[];
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Msg>(null);

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
          </TableBody>
        </Table>
      </div>

      <form className="flex flex-wrap items-center gap-2" onSubmit={invite}>
        <Input
          type="email"
          aria-label="Teammate email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="teammate@email.com"
          required
          className="min-w-[220px] flex-1"
        />
        <select aria-label="Invite role" className={cn(selectClass, "w-32")} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy}>
          {busy ? "Inviting" : "Invite"}
        </Button>
      </form>
      <Feedback message={message} />
    </Section>
  );
}
