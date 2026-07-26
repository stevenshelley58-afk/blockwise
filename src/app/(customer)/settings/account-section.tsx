"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { niche } from "@/config/niche";

import { Feedback, Section, type Msg, type RT, type SB } from "./settings-shared";

export function AccountSection({
  supabase,
  router,
  user,
  fullName,
}: {
  supabase: SB;
  router: RT;
  user: { id: string; email: string };
  fullName: string;
}) {
  const [name, setName] = useState(fullName);
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), updated_at: new Date().toISOString() }).eq("id", user.id);
    let emailMsg = "";
    if (!error && email.trim() && email.trim() !== user.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email: email.trim() });
      emailMsg = emailError ? ` Name saved, but email change failed: ${emailError.message}` : " Check your new inbox to confirm the email change.";
    }
    setBusy(false);
    if (error) {
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
          <Label htmlFor="account-name">Full name</Label>
          <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
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
    </Section>
  );
}
