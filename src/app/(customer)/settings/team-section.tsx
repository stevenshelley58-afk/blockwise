"use client";

import { useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { logCaught } from "@/lib/log";

import { Feedback, Section, type Member, type Msg, type RT, type SB } from "./settings-shared";

const ASSIGNABLE_ROLES = ["owner", "admin", "member", "viewer"];

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
      const data = (await res.json().catch(logCaught("settings: team invite response parse failed", {}))) as { error?: string; message?: string };
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
    <Section id="team" title="Team members" description="People with access to this workspace.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.profileId === currentUserId;
              return (
                <tr key={m.profileId}>
                  <td>
                    <strong>{m.fullName ?? m.email ?? "Unknown"}</strong>
                    {isSelf ? <span className="item-meta"> (you)</span> : null}
                    <div className="item-meta">{m.email}</div>
                  </td>
                  <td>
                    {m.isOperator ? (
                      <StatusPill tone="blue">operator</StatusPill>
                    ) : isSelf ? (
                      <StatusPill tone="green">{m.role}</StatusPill>
                    ) : (
                      <select
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
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!isSelf && !m.isOperator ? (
                      <button className="button secondary" type="button" onClick={() => remove(m.profileId)} disabled={rowBusy === m.profileId}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form className="wizard-connect-row" onSubmit={invite} style={{ flexWrap: "wrap", gap: 10 }}>
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="teammate@email.com"
          required
          style={{ flex: "1 1 220px" }}
        />
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Inviting" : "Invite"}
        </button>
      </form>
      <Feedback message={message} />
    </Section>
  );
}
