import { MetaMark } from "./MetaMonitorHeader";

export function EmptyMetaState({ issue, connected }: { issue: string | null; connected: boolean }) {
  const title = connected ? "Meta reporting couldn't load" : "Connect Meta to view ad performance";
  const description = connected
    ? (issue ?? "Something went wrong while loading your Meta account. Try refreshing.")
    : (issue ??
      "Once your Meta ad account is connected, spend, leads and ad performance appear here automatically. No sample data is shown for live accounts.");

  return (
    <section className="panel mm-empty" aria-live="polite">
      <div className="mm-empty-mark">
        <MetaMark size={30} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {!connected ? (
        <a className="button" href="/settings">
          Connect Meta
        </a>
      ) : null}
    </section>
  );
}
