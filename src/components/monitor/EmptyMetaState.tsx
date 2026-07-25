import { MetaMark } from "./MetaMonitorHeader";

export function EmptyMetaState({ issue, connected, metaConnectHref }: { issue: string | null; connected: boolean; metaConnectHref?: string }) {
  const line = connected
    ? (issue ?? "Meta reporting couldn't load. Try refreshing.")
    : "Connect Meta to view ad performance.";

  return (
    <section className="panel mm-empty" aria-live="polite">
      <div className="mm-empty-mark">
        <MetaMark size={30} />
      </div>
      <h2>{line}</h2>
      {!connected ? (
        <a className="button" href={metaConnectHref ?? "/settings"}>
          Connect Meta
        </a>
      ) : null}
    </section>
  );
}
