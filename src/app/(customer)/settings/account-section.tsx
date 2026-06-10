"use client";

import { useState, type FormEvent } from "react";

import { Feedback, Section, type Msg, type RT, type SB } from "./settings-shared";

export function AccountSection({ supabase, router, user, fullName }: { supabase: SB; router: RT; user: { id: string; email: string }; fullName: string }) {
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
    <Section id="account" title="Account" description="Your name and sign-in email.">
      <form className="stack" onSubmit={save}>
        <label className="wizard-field">
          <span className="wizard-label">Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <Feedback message={message} />
        <div className="wizard-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving" : "Save changes"}
          </button>
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
    <Section id="security" title="Password" description="Change the password for this account.">
      <form className="stack" onSubmit={save}>
        <label className="wizard-field">
          <span className="wizard-label">New password</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Confirm new password</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        <Feedback message={message} />
        <div className="wizard-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Updating" : "Update password"}
          </button>
        </div>
      </form>
    </Section>
  );
}
