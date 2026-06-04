export type StatusTone = "green" | "amber" | "rose" | "blue";

export function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}
