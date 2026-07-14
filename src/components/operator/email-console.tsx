"use client";

import { AlertCircle, CheckCircle2, Inbox, Loader2, Mail, Paperclip, RefreshCw, Reply, Send, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";

import type { OperatorEmailContact, OperatorEmailDetail, OperatorEmailSummary } from "@/lib/operator/email-service";

type EmailConsoleProps = {
  mailbox: string;
  replyAddress: string;
  initialMessages: OperatorEmailSummary[];
  initialError?: string | null;
  contacts: OperatorEmailContact[];
  contactsError?: string | null;
};

type ComposeState = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
};

type SendState = "idle" | "sending" | "sent" | "error";

const emptyCompose: ComposeState = {
  to: "",
  subject: "",
  text: "",
  replyTo: null,
};

export function EmailConsole({
  mailbox,
  replyAddress,
  initialMessages,
  initialError = null,
  contacts,
  contactsError = null,
}: EmailConsoleProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [selectedId, setSelectedId] = useState(initialMessages[0]?.id ?? "");
  const [selectedMessage, setSelectedMessage] = useState<OperatorEmailDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [recipientMenuOpen, setRecipientMenuOpen] = useState(false);
  const [activeContactIndex, setActiveContactIndex] = useState(0);

  const selectedSummary = useMemo(() => messages.find((message) => message.id === selectedId) ?? null, [messages, selectedId]);
  const filteredContacts = useMemo(() => filterContacts(contacts, compose.to), [contacts, compose.to]);

  useEffect(() => {
    setActiveContactIndex(0);
  }, [compose.to]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedMessage(null);
      return;
    }

    let cancelled = false;
    setIsLoadingMessage(true);
    setError(null);

    fetch(`/api/operator/email/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || "Unable to load email.");
        return json as { message: OperatorEmailDetail };
      })
      .then((json) => {
        if (!cancelled) setSelectedMessage(json.message);
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setSelectedMessage(null);
          setError(fetchError instanceof Error ? fetchError.message : "Unable to load email.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMessage(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function refreshMessages() {
    setIsLoadingList(true);
    setError(null);
    try {
      const response = await fetch("/api/operator/email?limit=100", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Unable to refresh email.");
      const nextMessages = (json.messages ?? []) as OperatorEmailSummary[];
      setMessages(nextMessages);
      if (!nextMessages.some((message) => message.id === selectedId)) {
        setSelectedId(nextMessages[0]?.id ?? "");
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh email.");
    } finally {
      setIsLoadingList(false);
    }
  }

  function startNewMessage() {
    setCompose(emptyCompose);
    setSendState("idle");
    setComposeOpen(true);
  }

  function chooseContact(contact: OperatorEmailContact) {
    setCompose((current) => ({ ...current, to: replaceCurrentRecipient(current.to, contact.email) }));
    setRecipientMenuOpen(false);
  }

  function handleRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!recipientMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setRecipientMenuOpen(true);
      event.preventDefault();
      return;
    }
    if (!recipientMenuOpen || filteredContacts.length === 0) return;
    if (event.key === "ArrowDown") {
      setActiveContactIndex((current) => (current + 1) % filteredContacts.length);
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      setActiveContactIndex((current) => (current - 1 + filteredContacts.length) % filteredContacts.length);
      event.preventDefault();
    } else if (event.key === "Enter") {
      chooseContact(filteredContacts[activeContactIndex] ?? filteredContacts[0]);
      event.preventDefault();
    } else if (event.key === "Escape") {
      setRecipientMenuOpen(false);
      event.preventDefault();
    }
  }

  function startReply() {
    if (!selectedMessage && !selectedSummary) return;
    const message = selectedMessage ?? selectedSummary;
    const to = selectedMessage?.replyTo[0] || message?.from || "";
    setCompose({
      to,
      subject: replySubject(message?.subject),
      text: quotedReplyText(selectedMessage),
      replyTo: replyAddress,
    });
    setSendState("idle");
    setComposeOpen(true);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendState("sending");
    setError(null);

    try {
      const response = await fetch("/api/operator/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compose),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Unable to send email.");
      setSendState("sent");
      setCompose(emptyCompose);
      setComposeOpen(false);
      await refreshMessages();
    } catch (sendError) {
      setSendState("error");
      setError(sendError instanceof Error ? sendError.message : "Unable to send email.");
    }
  }

  return (
    <section className="operator-email-shell" aria-label="Operator mailbox">
      <div className="operator-email-toolbar">
        <div className="operator-email-account">
          <span className="operator-email-account-icon">
            <Mail aria-hidden size={18} />
          </span>
          <div>
            <strong>{mailbox}</strong>
            <span>Resend receiving and outbound mail</span>
          </div>
        </div>
        <div className="operator-email-actions">
          <button className="button secondary compact" type="button" onClick={() => void refreshMessages()} disabled={isLoadingList}>
            {isLoadingList ? <Loader2 aria-hidden className="spin" size={16} /> : <RefreshCw aria-hidden size={16} />}
            Refresh
          </button>
          <button className="button compact" type="button" onClick={startNewMessage}>
            <Send aria-hidden size={16} />
            Compose
          </button>
        </div>
      </div>

      {error ? (
        <div className="operator-email-notice rose" role="alert">
          <AlertCircle aria-hidden size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="operator-email-grid">
        <aside className="operator-email-list" aria-label="Inbox messages">
          <div className="operator-email-list-head">
            <div>
              <strong>Inbox</strong>
              <span>{messages.length} recent message{messages.length === 1 ? "" : "s"}</span>
            </div>
            <Inbox aria-hidden size={18} />
          </div>

          {messages.length === 0 ? (
            <div className="operator-email-empty">
              <Inbox aria-hidden size={22} />
              <strong>No received mail</strong>
              <span>Messages sent to {mailbox} will appear here.</span>
            </div>
          ) : null}

          {messages.map((message) => {
            const active = message.id === selectedId;
            return (
              <button
                className={active ? "operator-email-row active" : "operator-email-row"}
                type="button"
                key={message.id}
                onClick={() => setSelectedId(message.id)}
                aria-current={active ? "true" : undefined}
              >
                <span className="operator-email-row-top">
                  <strong>{message.from}</strong>
                  <time dateTime={message.createdAt}>{formatMailTime(message.createdAt)}</time>
                </span>
                <span className="operator-email-row-subject">{message.subject}</span>
                <span className="operator-email-row-meta">
                  {message.attachments.length > 0 ? (
                    <span>
                      <Paperclip aria-hidden size={13} />
                      {message.attachments.length}
                    </span>
                  ) : (
                    "Received"
                  )}
                </span>
              </button>
            );
          })}
        </aside>

        <article className="operator-email-reader" aria-label="Selected email">
          {isLoadingMessage ? (
            <div className="operator-email-state">
              <Loader2 aria-hidden className="spin" size={26} />
              <span>Loading message</span>
            </div>
          ) : selectedMessage ? (
            <>
              <header className="operator-email-reader-head">
                <div>
                  <p className="operator-email-from">{selectedMessage.from}</p>
                  <h2>{selectedMessage.subject}</h2>
                  <p>
                    To {selectedMessage.to.join(", ")} · {formatMailDate(selectedMessage.createdAt)}
                  </p>
                </div>
                <button className="button secondary compact" type="button" onClick={startReply}>
                  <Reply aria-hidden size={16} />
                  Reply
                </button>
              </header>

              {selectedMessage.attachments.length > 0 ? (
                <div className="operator-email-attachments" aria-label="Attachments">
                  {selectedMessage.attachments.map((attachment, index) => (
                    <span key={attachment.id ?? `${attachment.filename}-${index}`}>
                      <Paperclip aria-hidden size={14} />
                      {attachment.filename || "Attachment"}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="operator-email-body">
                {selectedMessage.text ? (
                  <pre>{selectedMessage.text}</pre>
                ) : selectedMessage.html ? (
                  <iframe title="Email HTML body" sandbox="" srcDoc={selectedMessage.html} />
                ) : (
                  <p className="operator-email-muted">This message has no readable body.</p>
                )}
              </div>
            </>
          ) : (
            <div className="operator-email-state">
              <Mail aria-hidden size={28} />
              <span>Select a message to read it.</span>
            </div>
          )}
        </article>
      </div>

      {composeOpen ? (
        <div className="operator-email-compose" role="dialog" aria-modal="true" aria-label="Compose email">
          <form onSubmit={(event) => void sendMessage(event)}>
            <header>
              <div>
                <strong>Send from {replyAddress}</strong>
                <span>Replies return to the operator mailbox.</span>
              </div>
              <button className="icon-button" type="button" onClick={() => setComposeOpen(false)} aria-label="Close compose">
                <X aria-hidden size={18} />
              </button>
            </header>

            <div className="operator-email-recipient-field">
              <label htmlFor="operator-email-to">To</label>
              <div
                className="operator-email-recipient-control"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setRecipientMenuOpen(false);
                }}
              >
                <input
                  id="operator-email-to"
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={recipientMenuOpen}
                  aria-controls="operator-email-contacts"
                  aria-activedescendant={
                    recipientMenuOpen && filteredContacts[activeContactIndex]
                      ? `operator-email-contact-${filteredContacts[activeContactIndex].id}`
                      : undefined
                  }
                  value={compose.to}
                  onChange={(event) => {
                    setCompose((current) => ({ ...current, to: event.target.value }));
                    setRecipientMenuOpen(true);
                  }}
                  onClick={() => setRecipientMenuOpen(true)}
                  onFocus={() => setRecipientMenuOpen(true)}
                  onKeyDown={handleRecipientKeyDown}
                  placeholder="Choose a user or enter an email"
                  autoComplete="off"
                  required
                />
                {recipientMenuOpen ? (
                  <div className="operator-email-contact-menu" id="operator-email-contacts" role="listbox">
                    {contactsError ? <p className="operator-email-contact-state">{contactsError}</p> : null}
                    {!contactsError && filteredContacts.length === 0 ? (
                      <p className="operator-email-contact-state">
                        {contacts.length === 0 ? "No users with email addresses found." : "No matching users."}
                      </p>
                    ) : null}
                    {filteredContacts.map((contact, index) => (
                      <button
                        className={index === activeContactIndex ? "operator-email-contact active" : "operator-email-contact"}
                        id={`operator-email-contact-${contact.id}`}
                        key={contact.id}
                        type="button"
                        role="option"
                        aria-selected={index === activeContactIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseContact(contact)}
                      >
                        <span className="operator-email-contact-avatar" aria-hidden>
                          {contactInitials(contact.name)}
                        </span>
                        <span>
                          <strong>{contact.name}</strong>
                          <small>{contact.email}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <label>
              <span>Subject</span>
              <input
                type="text"
                value={compose.subject}
                onChange={(event) => setCompose((current) => ({ ...current, subject: event.target.value }))}
                required
              />
            </label>
            <label>
              <span>Message</span>
              <textarea
                value={compose.text}
                onChange={(event) => setCompose((current) => ({ ...current, text: event.target.value }))}
                rows={10}
                required
              />
            </label>

            <footer>
              <span className={sendState === "sent" ? "operator-email-send-state sent" : "operator-email-send-state"}>
                {sendState === "sent" ? (
                  <>
                    <CheckCircle2 aria-hidden size={16} />
                    Sent
                  </>
                ) : sendState === "error" ? (
                  "Send failed"
                ) : null}
              </span>
              <button className="button" type="submit" disabled={sendState === "sending"}>
                {sendState === "sending" ? <Loader2 aria-hidden className="spin" size={16} /> : <Send aria-hidden size={16} />}
                Send
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function currentRecipientQuery(value: string): string {
  return value.split(/[,;\n]/).at(-1)?.trim().toLocaleLowerCase() ?? "";
}

function filterContacts(contacts: OperatorEmailContact[], value: string): OperatorEmailContact[] {
  const query = currentRecipientQuery(value);
  if (!query) return contacts;
  return contacts.filter(
    (contact) => contact.name.toLocaleLowerCase().includes(query) || contact.email.toLocaleLowerCase().includes(query),
  );
}

function replaceCurrentRecipient(value: string, email: string): string {
  const boundary = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"), value.lastIndexOf("\n"));
  const prefix = boundary >= 0 ? `${value.slice(0, boundary + 1).trimEnd()} ` : "";
  return `${prefix}${email}`;
}

function contactInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

function quotedReplyText(message: OperatorEmailDetail | null): string {
  if (!message) return "";
  const text = message.text?.trim();
  const quote = text
    ? text
        .split("\n")
        .slice(0, 40)
        .map((line) => `> ${line}`)
        .join("\n")
    : "";

  return `\n\nOn ${formatMailDate(message.createdAt)}, ${message.from} wrote:\n${quote}`;
}

function replySubject(subject: string | null | undefined): string {
  const clean = (subject ?? "").trim();
  if (!clean) return "Re:";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

function formatMailTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMailDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
