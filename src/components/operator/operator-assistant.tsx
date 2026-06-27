"use client";

import { Bot, Lock, MessageSquare, Send } from "lucide-react";
import { FormEvent, useMemo, useRef, useState } from "react";

export type OperatorAssistantCoverageRow = {
  postcode: string;
  state: string;
  score: number;
  activeAds: number;
  advertiserPages: number;
  health: string;
};

type ProposedAction = {
  kind: "refresh_postcode" | "collect_ads_for_page" | "set_kill_switch";
  params: Record<string, unknown>;
  label: string;
  summary: string;
};

type ChatResponse = {
  answer?: unknown;
  proposedAction?: unknown;
  error?: unknown;
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  proposedAction?: ProposedAction;
  actionResolved?: boolean;
};

type OperatorAssistantProps = {
  initialRows: OperatorAssistantCoverageRow[];
  initialPostcode: string | null;
  lastUpdated: string;
};

const ENDPOINT = "/api/operator/research/chat";

export function OperatorAssistant({ initialRows, initialPostcode, lastUpdated }: OperatorAssistantProps) {
  const greeting = useMemo(() => buildGreeting(initialRows, initialPostcode), [initialRows, initialPostcode]);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", text: greeting }]);
  const [input, setInput] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    requestAnimationFrame(() => {
      if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    });
  }

  function wireHistory(list: ChatMessage[]) {
    return list
      .map((message) => ({ role: message.role, content: message.text }))
      .filter((message) => message.content.trim().length > 0)
      .slice(-20);
  }

  async function send(history: ChatMessage[], confirm?: ProposedAction) {
    setError(null);
    setIsPending(true);
    scrollToEnd();
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: wireHistory(history), confirm }),
      });
      const payload = await readChatPayload(response);
      if (!response.ok) throw new Error(payloadText(payload.error, "Operator assistant failed."));
      const proposedAction = isProposedAction(payload.proposedAction) ? payload.proposedAction : undefined;
      setMessages((current) => [
        ...current,
        { role: "assistant", text: payloadText(payload.answer, "No answer was returned."), proposedAction },
      ]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Operator assistant failed.");
    } finally {
      setIsPending(false);
      scrollToEnd();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = input.trim();
    if (!query || isPending) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", text: query }];
    setMessages(next);
    await send(next);
  }

  async function confirmAction(index: number, action: ProposedAction) {
    if (isPending) return;
    setMessages((current) => current.map((message, idx) => (idx === index ? { ...message, actionResolved: true } : message)));
    const history = messages.map((message, idx) => (idx === index ? { ...message, actionResolved: true } : message));
    await send(history, action);
  }

  function cancelAction(index: number) {
    setMessages((current) => {
      const updated = current.map((message, idx) => (idx === index ? { ...message, actionResolved: true } : message));
      return [...updated, { role: "assistant", text: "Okay — cancelled. Nothing was changed." }];
    });
  }

  return (
    <aside className="operator-assistant" id="chat" aria-label="Operator assistant">
      <div className="operator-assistant-header">
        <div>
          <Bot aria-hidden size={18} />
          <strong>Operator Assistant</strong>
          <span>Live · {lastUpdated}</span>
        </div>
      </div>

      <div className="operator-chat-thread" ref={threadRef}>
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div className="operator-chat-bubble user" key={`u-${index}`}>
              <p>{message.text}</p>
            </div>
          ) : (
            <div className="operator-chat-bubble assistant" key={`a-${index}`}>
              {message.text.split("\n").map((line, lineIndex) => (
                <p key={lineIndex}>{line}</p>
              ))}
              {message.proposedAction && !message.actionResolved ? (
                <ProposedActionCard
                  action={message.proposedAction}
                  disabled={isPending}
                  onConfirm={() => confirmAction(index, message.proposedAction as ProposedAction)}
                  onCancel={() => cancelAction(index)}
                />
              ) : null}
            </div>
          ),
        )}
        {isPending ? <p className="operator-chat-bubble assistant">…</p> : null}
        {error ? <p className="operator-chat-error">{error}</p> : null}
      </div>

      <form className="operator-chat-composer" onSubmit={submit}>
        <label htmlFor="operator-chat-input">Tell Hermes what to do</label>
        <div>
          <MessageSquare aria-hidden size={16} />
          <input
            id="operator-chat-input"
            name="query"
            placeholder="e.g. status? · refresh 6000 · collect ads for Acton · pause scraping"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isPending}
            autoComplete="off"
          />
          <button type="submit" aria-label="Send message" disabled={isPending || !input.trim()}>
            <Send size={16} />
          </button>
        </div>
        <span>
          <Lock size={12} /> Actions ask for confirmation before anything changes.
        </span>
      </form>
    </aside>
  );
}

async function readChatPayload(response: Response): Promise<ChatResponse> {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" ? (payload as ChatResponse) : {};
  } catch {
    return {};
  }
}

function payloadText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function isProposedAction(value: unknown): value is ProposedAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<ProposedAction>;
  return (
    (action.kind === "refresh_postcode" || action.kind === "collect_ads_for_page" || action.kind === "set_kill_switch") &&
    Boolean(action.params && typeof action.params === "object") &&
    typeof action.label === "string" &&
    typeof action.summary === "string"
  );
}

function ProposedActionCard({
  action,
  disabled,
  onConfirm,
  onCancel,
}: {
  action: ProposedAction;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="operator-proposed-action">
      <strong>Proposed action</strong>
      <p>{action.label}</p>
      <span>{action.summary}</span>
      <div>
        <button className="button secondary" type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
        <button className="button" type="button" onClick={onConfirm} disabled={disabled}>
          Confirm
        </button>
      </div>
    </div>
  );
}

function buildGreeting(rows: OperatorAssistantCoverageRow[], postcode: string | null): string {
  if (rows.length === 0) {
    return "Hi — I'm wired into the live Hermes research engine. Ask me how it's running, or tell me to refresh a postcode, collect ads for an agency, or pause scraping.";
  }
  const lowest = rows[0];
  const tail = postcode ? ` The lowest-coverage postcode right now is ${postcode}.` : "";
  return `Hi — I'm connected to the live Hermes engine (coverage, queue, defects, spend).${tail} Ask me anything, or tell me to refresh a postcode, collect ads for an agency, or pause scraping.`;
}
