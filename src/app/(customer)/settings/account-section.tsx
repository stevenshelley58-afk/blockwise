"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/status-pill";
import { niche } from "@/config/niche";

import { Feedback, Section, type Msg, type RT, type SB } from "./settings-shared";

export function AccountSection({
  supabase,
  router,
  user,
  profile,
}: {
  supabase: SB;
  router: RT;
  user: { id: string; email: string };
  profile: {
    fullName: string;
    phone: string;
    timezone: string;
    emailVerified: boolean;
  };
}) {
  const [name, setName] = useState(profile.fullName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(profile.phone);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    const { error: metadataError } = error
      ? { error: null }
      : await supabase.auth.updateUser({
          data: {
            phone: phone.trim() || null,
            timezone: timezone.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        });
    let emailMsg = "";
    if (!error && !metadataError && email.trim() && email.trim() !== user.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email: email.trim() });
      emailMsg = emailError ? ` Name saved, but email change failed: ${emailError.message}` : " Check your new inbox to confirm the email change.";
    }
    setBusy(false);
    if (error || metadataError) {
      setMessage({ tone: "error", text: "Couldn't save your account details." });
      return;
    }
    setMessage({ tone: "success", text: `Account updated.${emailMsg}` });
    router.refresh();
  }

  return (
    <Section id="account" title={niche.copy.settings.sections.account}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="grid gap-2">
          <Label htmlFor="account-name">Preferred name</Label>
          <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="account-email">Email</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="min-w-[220px] flex-1" id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            <StatusPill tone={profile.emailVerified ? "green" : "amber"}>
              {profile.emailVerified ? "Verified" : "Verification pending"}
            </StatusPill>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="account-phone">Phone (optional)</Label>
            <Input id="account-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-timezone">Timezone</Label>
            <Input id="account-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Australia/Perth" required />
          </div>
        </div>
        <Feedback message={message} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving" : "Save changes"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function PasswordSection({ supabase }: { supabase: SB }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const [sessionBusy, setSessionBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (pw.length < 8) {
      setMessage({ tone: "error", text: "Use at least 8 characters." });
      return;
    }
    if (pw !== confirm) {
      setMessage({ tone: "error", text: "Passwords don't match." });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }
    setPw("");
    setConfirm("");
    setMessage({ tone: "success", text: "Password updated." });
  }

  async function signOutOtherSessions() {
    setSessionBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setSessionBusy(false);
    setMessage(
      error
        ? { tone: "error", text: "Couldn't sign out the other sessions." }
        : { tone: "success", text: "Other sessions have been signed out." },
    );
  }

  return (
    <Section id="security" title={niche.copy.settings.sections.password}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="grid gap-2">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        <Feedback message={message} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Updating" : "Update password"}
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) pt-4">
        <div>
          <p className="text-[13px] font-semibold">Other signed-in sessions</p>
          <p className="text-xs text-muted-foreground">Keep this device signed in and end sessions elsewhere.</p>
        </div>
        <Button variant="outline" type="button" disabled={sessionBusy} onClick={signOutOtherSessions}>
          {sessionBusy ? "Signing out…" : "Sign out other sessions"}
        </Button>
      </div>
    </Section>
  );
}
