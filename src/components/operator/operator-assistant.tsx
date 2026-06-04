"use client";

import { Bot, Lock, MessageSquare, Send, Sparkles, X } from "lucide-react";
import { FormEvent, useState } from "react";

export type OperatorAssistantCoverageRow = {
  postcode: string;
  state: string;
  score: number;
  activeAds: number;
  advertiserPages: number;
  health: string;
};

type OperatorAssistantResponse = {
  answer: string;
  rows: OperatorAssistantCoverageRow[];
  proposedAction?: {
    scope: "postcode";
    value: string;
    label: string;
  };
};

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; rows: OperatorAssistantCoverageRow[]; proposedAction?: OperatorAssistantResponse["proposedAction"] };

type OperatorAssistantProps = {
  initialRows: OperatorAssistantCoverageRow[];
  initialPostcode: string | null;
  lastUpdated: string;
};

export function OperatorAssistant({ initialRows, initialPostcode, lastUpdated }: OperatorAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text:
        initialRows.length > 0
          ? "Connected to live coverage, work queue, run, and defect data. Lowest-coverage rows are loaded below."
          : "Connected to live research data. No coverage rows are currently available.",
      rows: initialRows,
      proposedAction: initialPostcode
        ? { scope: "postcode", value: initialPostcode, label: `Refresh postcode ${initialPostcode}` }
        : undefined,
    },
  ]);
  const [input, setInput] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = input.trim();
    if (!query) return;

    setError(null);
    setIsPending(true);
    setMessages((current) => [...current, { role: "user", text: query }]);
    setInput("");

    try {
      const response = await fetch("/api/operator/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = (await response.json()) as Partial<OperatorAssistantResponse> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Operator chat failed.");
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: payload.answer ?? "No answer was returned.",
          rows: payload.rows ?? [],
          proposedAction: payload.proposedAction,
        },
      ]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Operator chat failed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <aside className="operator-assistant" id="chat" aria-label="Operator assistant">
      <div className="operator-assistant-header">
        <div>
          <Bot aria-hidden size={18} />
          <strong>Operator Assistant</strong>
          <span>Live</span>
        </div>
        <div className="operator-assistant-tools">
          <Sparkles aria-hidden size={16} />
          <X aria-hidden size={16} />
        </div>
      </div>

      <div className="operator-chat-thread">
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div className="operator-chat-bubble user" key={`${message.role}-${index}`}>
              <p>{message.text}</p>
            </div>
          ) : (
            <div className="operator-chat-bubble assistant" key={`${message.role}-${index}`}>
              <p>{message.text}</p>
              {message.rows.length > 0 ? (
                <CoverageCard rows={message.rows} lastUpdated={lastUpdated} />
              ) : null}
              {message.proposedAction ? <RefreshAction action={message.proposedAction} /> : null}
            </div>
          ),
        )}
        {error ? <p className="operator-chat-error">{error}</p> : null}
      </div>

      <form className="operator-chat-composer" onSubmit={submit}>
        <label htmlFor="operator-chat-input">Ask anything about research ops</label>
        <div>
          <MessageSquare aria-hidden size={16} />
          <input
            id="operator-chat-input"
            name="query"
            placeholder="Ask anything about research ops..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isPending}
          />
          <button type="submit" aria-label="Send message" disabled={isPending || !input.trim()}>
            <Send size={16} />
          </button>
        </div>
        <span>
          <Lock size={12} /> Operator actions require confirmation.
        </span>
      </form>
    </aside>
  );
}

function CoverageCard({ rows, lastUpdated }: { rows: OperatorAssistantCoverageRow[]; lastUpdated: string }) {
  return (
    <div className="operator-chat-card">
      <strong>Coverage rows needing review</strong>
      <span>Last updated: {lastUpdated}</span>
      <table>
        <thead>
          <tr>
            <th>Postcode</th>
            <th>Score</th>
            <th>Ads</th>
            <th>Pages</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.state}-${row.postcode}`}>
              <td>{row.postcode}</td>
              <td className={row.score < 50 ? "danger" : "good"}>{row.score}%</td>
              <td>{row.activeAds}</td>
              <td>{row.advertiserPages}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RefreshAction({ action }: { action: NonNullable<OperatorAssistantResponse["proposedAction"]> }) {
  return (
    <form className="operator-proposed-action" method="post" action="/api/operator/research/refresh-now">
      <input type="hidden" name="scope" value={action.scope} />
      <input type="hidden" name="value" value={action.value} />
      <strong>Proposed action</strong>
      <p>{action.label}</p>
      <span>Uses the live refresh policy endpoint.</span>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>refresh_postcode</dd>
        </div>
        <div>
          <dt>Postcode</dt>
          <dd>{action.value}</dd>
        </div>
      </dl>
      <div>
        <button className="button secondary" type="button">
          Cancel
        </button>
        <button className="button" type="submit">
          Confirm
        </button>
      </div>
    </form>
  );
}
