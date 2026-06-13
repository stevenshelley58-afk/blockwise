import { AccessUnavailableActions } from "./access-unavailable-actions";

export const dynamic = "force-dynamic";

type AccessUnavailablePageProps = {
  searchParams?: Promise<{ reason?: string | string[] }> | { reason?: string | string[] };
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccessUnavailablePage({ searchParams }: AccessUnavailablePageProps) {
  const params = searchParams ? await Promise.resolve(searchParams) : {};
  const reason = firstParam(params.reason);
  const isNoWorkspace = reason === "no_workspace";

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="access-unavailable-heading">
        <div className="login-brand">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </div>
        <div>
          <p className="eyebrow">Workspace access</p>
          <h1 id="access-unavailable-heading">{isNoWorkspace ? "No workspace found" : "Access unavailable"}</h1>
          <p className="login-copy">
            {isNoWorkspace
              ? "This account is signed in, but it is not attached to a Blockwise workspace yet."
              : "Your account does not have access to that workspace area."}
          </p>
        </div>
        <AccessUnavailableActions />
      </section>
    </main>
  );
}
