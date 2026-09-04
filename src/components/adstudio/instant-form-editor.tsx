"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { z } from "zod";

import { validateInstantForm, type ValidationIssue } from "@/lib/adstudio/instant-form-generator";
import {
  ACTION_TYPES,
  CONTACT_FIELD_TYPES,
  instantFormSchema,
  type ActionType,
  type ContactFieldType,
  type InstantForm,
} from "@/lib/adstudio/instant-form-types";

// ---------------------------------------------------------------------------
// Instant Form editor — draft preview/edit + pin (Save).
//
// Mounted in the Publish flow. Fetches the latest pinned draft on load;
// "Generate draft" asks the server for a fresh draft derived from the ad's
// saved copy, the workspace brand details, and the template. The customer
// edits every field in place; Save (PUT) pins it as the next draft revision.
// Drafts with error-severity validation issues cannot be pinned — warnings
// (e.g. missing optional fields) are allowed through.
// ---------------------------------------------------------------------------

const ADDABLE_FIELDS = CONTACT_FIELD_TYPES.filter(t => t !== "country" && t !== "street_address");

const FIELD_LABELS: Record<ContactFieldType, string> = {
  email: "Email",
  full_name: "Full name",
  phone: "Phone",
  postcode: "Postcode",
  street_address: "Street address",
  city: "City",
  state: "State",
  country: "Country",
};

const ACTION_LABELS: Record<ActionType, string> = {
  visit_website: "Visit website",
  call_now: "Call now",
  download: "Download",
  none: "None",
};

export interface InstantFormEditorProps {
  adId: string;
  workspaceId: string;
  /** Reports the exact form revision that publish will bind to. */
  onPinStateChange?: (state: {
    pinned: boolean;
    revision: number | null;
    form: InstantForm | null;
  }) => void;
}

type Status = "loading" | "idle" | "generating" | "saving";

export function InstantFormEditor({ adId, workspaceId, onPinStateChange }: InstantFormEditorProps) {
  const [form, setForm] = useState<InstantForm | null>(null);
  const [pinnedRevision, setPinnedRevision] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // A draft counts as pinned once it has a server revision and the working
  // copy matches it. Report the settled state to the parent so the Publish
  // button can gate on it (silent while the initial load is in flight).
  const pinned = pinnedRevision !== null && !dirty;
  useEffect(() => {
    if (status === "loading") return;
    onPinStateChange?.({ pinned, revision: pinned ? pinnedRevision : null, form });
  }, [form, pinned, pinnedRevision, status, onPinStateChange]);

  const basePath = `/api/adstudio/ads/${encodeURIComponent(adId)}/instant-form?workspaceId=${encodeURIComponent(workspaceId)}`;

  // Live client-side validation — the same rules the server enforces on pin.
  const liveIssues = useMemo<ValidationIssue[]>(() => {
    if (!form) return [];
    const schema = instantFormSchema.safeParse(form);
    const meta = validateInstantForm(form);
    if (!schema.success) {
      return [
        ...meta,
        ...schema.error.issues.map(issue => ({
          field: String(issue.path.join(".")),
          code: "schema",
          message: friendlySchemaMessage(issue),
          severity: "error" as const,
        })),
      ];
    }
    return meta;
  }, [form]);

  const errorIssues = liveIssues.filter(i => i.severity === "error");
  const warningIssues = liveIssues.filter(i => i.severity === "warning");

  const loadDraft = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(basePath);
      const body = (await res.json().catch(() => ({}))) as {
        form?: InstantForm | null;
        revision?: number | null;
        pinned?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Failed to load form (${res.status})`);
      setForm(body.form ?? null);
      setPinnedRevision(body.pinned === false ? null : (body.revision ?? null));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load form");
    } finally {
      setStatus("idle");
    }
  }, [basePath]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  const generate = useCallback(async () => {
    setStatus("generating");
    setError(null);
    try {
      const res = await fetch(basePath, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { form?: InstantForm; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Failed to generate draft (${res.status})`);
      setForm(body.form ?? null);
      setPinnedRevision(null);
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setStatus("idle");
    }
  }, [basePath]);

  const save = useCallback(async () => {
    if (!form || errorIssues.length > 0) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(basePath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        form?: InstantForm;
        revision?: number;
        pinned?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Failed to save draft (${res.status})`);
      setForm(body.form ?? form);
      setPinnedRevision(body.pinned === false ? null : (body.revision ?? null));
      setDirty(body.pinned === false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setStatus("idle");
    }
  }, [basePath, form, errorIssues.length]);

  const update = useCallback((next: InstantForm) => {
    setForm(next);
    setDirty(true);
    setError(null);
  }, []);

  const updateIntro = (patch: Partial<InstantForm["intro"]>) =>
    form && update({ ...form, intro: { ...form.intro, ...patch } });
  const updateThankYou = (patch: Partial<InstantForm["thankYou"]>) =>
    form && update({ ...form, thankYou: { ...form.thankYou, ...patch } });
  const updatePrivacy = (patch: Partial<InstantForm["privacy"]>) =>
    form && update({ ...form, privacy: { ...form.privacy, ...patch } });

  const toggleContactField = (type: ContactFieldType, included: boolean) => {
    if (!form) return;
    if (included) {
      if (form.contactFields.some(f => f.type === type)) return;
      update({ ...form, contactFields: [...form.contactFields, { type, required: true }] });
    } else {
      update({ ...form, contactFields: form.contactFields.filter(f => f.type !== type) });
    }
  };

  const setContactRequired = (type: ContactFieldType, required: boolean) =>
    form &&
    update({
      ...form,
      contactFields: form.contactFields.map(f => (f.type === type ? { ...f, required } : f)),
    });

  const addQuestion = () => {
    if (!form || form.customQuestions.length >= 5) return;
    update({
      ...form,
      customQuestions: [...form.customQuestions, { type: "short_answer" as const, label: "", required: false }],
    });
  };

  const updateQuestionLabel = (index: number, label: string) =>
    form &&
    update({
      ...form,
      customQuestions: form.customQuestions.map((q, i) => (i === index ? { ...q, label } : q)),
    });

  const removeQuestion = (index: number) =>
    form &&
    update({ ...form, customQuestions: form.customQuestions.filter((_, i) => i !== index) });

  if (status === "loading") {
    return (
      <div className="rounded-(--r-card) border border-(--line) bg-(--surface) p-6">
        <p className="text-sm text-muted-foreground">Loading Instant Form...</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="instant-form-heading" className="w-full min-w-0 rounded-(--r-card) border border-(--line) bg-(--surface)">
      {/* Header */}
      <header className="flex flex-wrap items-start gap-3 border-b border-(--line) px-4 py-4 sm:items-center sm:justify-between sm:px-5">
        <div>
          <h3 id="instant-form-heading" className="text-sm font-semibold">Instant Form</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose what customers see after they tap your ad, then save it.
          </p>
        </div>
        {form && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              dirty
                ? "bg-yellow-100 text-yellow-700"
                : "bg-green-100 text-green-700"
            }`}
            role="status"
            aria-live="polite"
          >
            {dirty
              ? "Unsaved draft"
              : pinnedRevision !== null
                ? "Saved"
                : "Draft"}
          </span>
        )}
      </header>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* Validation summary */}
      {(errorIssues.length > 0 || warningIssues.length > 0) && form && (
        <div
          className={`border-b px-5 py-3 ${
            errorIssues.length > 0 ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50"
          }`}
        >
          <h4 className={`text-xs font-semibold uppercase tracking-wider ${errorIssues.length > 0 ? "text-red-800" : "text-yellow-800"}`}>
            {errorIssues.length > 0 ? "Fix before saving" : "Heads up"}
          </h4>
          <ul className="mt-1 space-y-0.5">
            {[...errorIssues, ...warningIssues].map((issue, i) => (
              <li key={i} className={`text-xs ${issue.severity === "error" ? "text-red-700" : "text-yellow-700"}`}>
                • {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!form ? (
        /* Empty state */
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            No form yet. Create a draft from your saved ad, then review every field before publishing.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={status === "generating"}
            className="min-h-11 rounded-(--r-ctl) bg-(--ui-primary) px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {status === "generating" ? "Generating..." : "Generate draft"}
          </button>
        </div>
      ) : (
        <div className="space-y-6 p-4 sm:p-5">
          {/* Name */}
          <Field label="Form name">
            <TextInput label="Form name" value={form.name} onChange={name => update({ ...form, name })} placeholder="e.g. Free home valuation" />
          </Field>

          {/* Intro */}
          <Field label="Intro">
            <div className="space-y-2">
              <TextInput label="Intro headline" value={form.intro.headline} onChange={headline => updateIntro({ headline })} placeholder="Headline" maxLength={60} />
              <TextArea label="Intro message" value={form.intro.body} onChange={body => updateIntro({ body })} placeholder="Intro body" maxLength={500} />
            </div>
          </Field>

          {/* Contact fields */}
          <Field label="Contact fields">
            <div className="space-y-2">
              {CONTACT_FIELD_TYPES.filter(t => t !== "country" && t !== "street_address").map(type => {
                const present = form.contactFields.find(f => f.type === type);
                return (
                  <div
                    key={type}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-(--r-ctl) border border-(--line) bg-(--canvas) px-3 py-2"
                  >
                    <label htmlFor={`contact-${type}`} className="flex min-h-11 flex-1 items-center gap-2.5">
                      <input
                        id={`contact-${type}`}
                        type="checkbox"
                        checked={!!present}
                        onChange={e => toggleContactField(type, e.target.checked)}
                          className="size-4 accent-(--ui-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-primary) focus-visible:ring-offset-2"
                      />
                      <span className="text-sm">{FIELD_LABELS[type]}</span>
                    </label>
                    {present && (
                      <label htmlFor={`contact-${type}-required`} className="flex min-h-11 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          id={`contact-${type}-required`}
                          type="checkbox"
                          checked={present.required}
                          onChange={e => setContactRequired(type, e.target.checked)}
                          className="size-4 accent-(--ui-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-primary) focus-visible:ring-offset-2"
                        />
                        Required
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </Field>

          {/* Custom questions */}
          <Field label={`Custom questions (${form.customQuestions.length}/5)`}>
            <div className="space-y-2">
              {form.customQuestions.map((question, index) => (
                <div key={index} className="flex min-w-0 items-center gap-2">
                  <TextInput
                    label={`Question ${index + 1}`}
                    value={question.label}
                    onChange={label => updateQuestionLabel(index, label)}
                    placeholder={`Question ${index + 1}`}
                    maxLength={200}
                  />
                  <button
                    type="button"
                    onClick={() => removeQuestion(index)}
                    className="min-h-11 shrink-0 rounded-(--r-ctl) px-3 py-2 text-xs text-muted-foreground outline-none hover:bg-(--surface-subtle) hover:text-red-600 focus-visible:ring-2 focus-visible:ring-(--ui-primary)"
                    aria-label={`Remove question ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {form.customQuestions.length < 5 && (
                <button
                  type="button"
                  onClick={addQuestion}
                    className="min-h-11 rounded-(--r-ctl) border border-dashed border-(--line) px-4 py-2 text-sm text-muted-foreground outline-none transition hover:border-(--ui-primary) hover:text-(--ui-primary) focus-visible:ring-2 focus-visible:ring-(--ui-primary)"
                >
                  + Add question
                </button>
              )}
            </div>
          </Field>

          {/* Privacy */}
          <Field label="Privacy policy">
            <div className="space-y-2">
              <TextInput label="Privacy policy URL" value={form.privacy.url} onChange={url => updatePrivacy({ url })} placeholder="https://yoursite.com.au/privacy" />
              <TextInput label="Privacy policy link text" value={form.privacy.linkText} onChange={linkText => updatePrivacy({ linkText })} placeholder="View our privacy policy" maxLength={100} />
            </div>
          </Field>

          {/* Thank-you */}
          <Field label="Thank-you screen">
            <div className="space-y-2">
              <TextInput label="Thank-you title" value={form.thankYou.title} onChange={title => updateThankYou({ title })} placeholder="Thank you!" maxLength={60} />
              <TextArea label="Thank-you message" value={form.thankYou.body} onChange={body => updateThankYou({ body })} placeholder="We've received your details..." maxLength={500} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor="instant-form-action" className="sr-only">Thank-you action</label>
                <select
                  id="instant-form-action"
                  value={form.thankYou.actionType}
                  onChange={e => updateThankYou({ actionType: e.target.value as ActionType })}
                  aria-describedby="instant-form-action-help"
                  className="min-h-11 w-full rounded-(--r-ctl) border border-(--line) bg-(--canvas) px-3 py-2 text-sm outline-none focus:border-(--ui-primary) focus-visible:ring-2 focus-visible:ring-(--ui-primary) sm:w-44"
                >
                  {ACTION_TYPES.map(type => (
                    <option key={type} value={type}>
                      {ACTION_LABELS[type]}
                    </option>
                  ))}
                </select>
                {(form.thankYou.actionType === "visit_website" || form.thankYou.actionType === "download") && (
                  <TextInput
                    label="Thank-you action URL"
                    value={form.thankYou.actionUrl ?? ""}
                    onChange={actionUrl => updateThankYou({ actionUrl })}
                    placeholder="Action URL"
                  />
                )}
              </div>
              <p id="instant-form-action-help" className="text-xs text-muted-foreground">Choose what happens after a customer submits the form.</p>
            </div>
          </Field>

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-3 border-t border-(--line) pt-4">
            <button
              type="button"
              onClick={generate}
              disabled={status === "generating"}
              className="min-h-11 rounded-(--r-ctl) px-4 py-2 text-sm text-muted-foreground transition hover:bg-(--surface-subtle) hover:text-foreground disabled:opacity-50"
            >
              {status === "generating" ? "Generating..." : "Regenerate draft"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={status === "saving" || errorIssues.length > 0 || !dirty}
              className="min-h-11 rounded-(--r-ctl) bg-(--ui-primary) px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {status === "saving" ? "Saving..." : "Save form"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small form primitives — styled to match the AdStudio design tokens.
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h4>
      {children}
    </div>
  );
}

function TextInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      id={id}
      type="text"
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="min-h-11 w-full min-w-0 rounded-(--r-ctl) border border-(--line) bg-(--canvas) px-3 py-2 text-sm text-foreground outline-none transition focus:border-(--ui-primary) focus-visible:ring-2 focus-visible:ring-(--ui-primary) focus-visible:ring-offset-2"
    />
  );
}

function TextArea({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <textarea
      id={id}
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={2}
      className="min-h-11 w-full resize-none rounded-(--r-ctl) border border-(--line) bg-(--canvas) px-3 py-2 text-sm text-foreground outline-none transition focus:border-(--ui-primary) focus-visible:ring-2 focus-visible:ring-(--ui-primary) focus-visible:ring-offset-2"
    />
  );
}

function friendlySchemaMessage(issue: z.ZodIssue): string {
  const path = String(issue.path.join("."));
  if (path.startsWith("customQuestions")) return "Question text is required";
  if (path.startsWith("intro.headline")) return "Headline is required";
  if (path.startsWith("intro.body")) return "Intro body is required";
  if (path.startsWith("privacy.url")) return "Privacy policy URL is required";
  if (path.startsWith("thankYou.title")) return "Thank-you title is required";
  if (path.startsWith("thankYou.body")) return "Thank-you body is required";
  if (path === "name") return "Form name is required";
  if (path === "contactFields") return "At least one contact field is required";
  return issue.message;
}
