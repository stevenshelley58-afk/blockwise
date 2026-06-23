import type { OfflineAuthSession } from "../auth/offline-config.ts";

type QueryResult = {
  data: unknown;
  error: null;
  count: number | null;
  status: number;
  statusText: string;
};

type QueryState = {
  table: string;
  single: boolean;
  head: boolean;
};

export function createOfflineSupabaseClient(session: OfflineAuthSession) {
  return {
    auth: {
      async getUser() {
        return { data: { user: session.user }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },
    from(table: string) {
      return createOfflineQuery(session, { table, single: false, head: false });
    },
    schema() {
      return {
        from(table: string) {
          return createOfflineQuery(session, { table, single: false, head: false });
        },
      };
    },
    rpc() {
      return Promise.resolve(emptyResult(null));
    },
  };
}

function createOfflineQuery(session: OfflineAuthSession, state: QueryState) {
  const chain: Record<string, unknown> = {};
  const next = (patch: Partial<QueryState> = {}) => createOfflineQuery(session, { ...state, ...patch });

  for (const method of [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "like",
    "ilike",
    "order",
    "limit",
    "range",
    "contains",
    "or",
    "match",
    "filter",
  ]) {
    chain[method] = () => next();
  }

  chain.select = (_columns?: string, options?: { count?: string; head?: boolean }) =>
    next({ head: Boolean(options?.head) });
  chain.insert = () => next();
  chain.update = () => next();
  chain.upsert = () => next();
  chain.delete = () => next();
  chain.maybeSingle = () => Promise.resolve(emptyResult(resolveSingleRow(session, state.table)));
  chain.single = () => Promise.resolve(emptyResult(resolveSingleRow(session, state.table)));
  chain.then = (onfulfilled: (value: QueryResult) => unknown, onrejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolveResult(session, state)).then(onfulfilled, onrejected);
  chain.catch = (onrejected: (reason: unknown) => unknown) =>
    Promise.resolve(resolveResult(session, state)).catch(onrejected);
  chain.finally = (onfinally: () => void) => Promise.resolve(resolveResult(session, state)).finally(onfinally);

  return chain;
}

function resolveResult(session: OfflineAuthSession, state: QueryState): QueryResult {
  if (state.head) {
    return emptyResult(null, 0);
  }

  const row = resolveSingleRow(session, state.table);
  if (state.single) {
    return emptyResult(row);
  }

  if (state.table === "profiles") {
    return emptyResult([{ id: session.user.id, email: session.user.email, ...session.profile }], 1);
  }

  if (state.table === "workspace_members") {
    return emptyResult([session.membership], 1);
  }

  if (state.table === "workspaces") {
    return emptyResult([session.membership.workspaces], 1);
  }

  return emptyResult([], 0);
}

function resolveSingleRow(session: OfflineAuthSession, table: string): unknown {
  if (table === "profiles") {
    return { id: session.user.id, email: session.user.email, ...session.profile };
  }
  if (table === "workspace_members") {
    return session.membership;
  }
  if (table === "workspaces") {
    return session.membership.workspaces;
  }
  return null;
}

function emptyResult(data: unknown, count: number | null = null): QueryResult {
  return {
    data,
    error: null,
    count,
    status: 200,
    statusText: "OK",
  };
}
