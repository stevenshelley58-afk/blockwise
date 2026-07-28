"use client";

export const READ_MODEL_DB_NAME = "bw-read-models-v1";
export const READ_MODEL_SCHEMA_VERSION = 1 as const;
export const READ_MODEL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STORE_NAME = "read-models";
const IDENTITY_KEY = "bw-read-models-identity-v1";

export type ReadModelSurface =
  | "home"
  | `performance:${string}`
  | "adstudio:bootstrap"
  | "adstudio:library";

export type LocalReadModelEnvelope<T> = {
  schemaVersion: typeof READ_MODEL_SCHEMA_VERSION;
  userId: string;
  workspaceId: string;
  surface: ReadModelSurface;
  etag: string;
  fetchedAt: string;
  data: T;
};

type StoredEnvelope<T> = LocalReadModelEnvelope<T> & { key: string };

export async function syncReadModelIdentity(identity: {
  userId: string;
  workspaceId: string;
}): Promise<void> {
  if (!supportsReadModels()) return;
  const next = `${identity.userId}:${identity.workspaceId}`;
  const previous = safeIdentityRead();

  if (previous && previous !== next) {
    await deleteReadModelDatabase();
  }
  safeIdentityWrite(next);
}

export async function readLocalReadModel<T>(identity: {
  userId: string;
  workspaceId: string;
  surface: ReadModelSurface;
}): Promise<LocalReadModelEnvelope<T> | null> {
  if (!supportsReadModels()) return null;
  await syncReadModelIdentity(identity);
  const db = await openReadModelDatabase();
  let stored: StoredEnvelope<T> | undefined;
  try {
    stored = await requestResult<StoredEnvelope<T> | undefined>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(envelopeKey(identity)),
    );
  } finally {
    db.close();
  }

  if (!stored) return null;
  if (
    stored.schemaVersion !== READ_MODEL_SCHEMA_VERSION ||
    stored.userId !== identity.userId ||
    stored.workspaceId !== identity.workspaceId ||
    stored.surface !== identity.surface ||
    Date.now() - Date.parse(stored.fetchedAt) > READ_MODEL_MAX_AGE_MS
  ) {
    const staleDb = await openReadModelDatabase();
    try {
      await deleteEnvelope(staleDb, stored.key);
    } finally {
      staleDb.close();
    }
    return null;
  }

  const { key: _key, ...envelope } = stored;
  return envelope;
}

export async function writeLocalReadModel<T>(envelope: LocalReadModelEnvelope<T>): Promise<void> {
  if (!supportsReadModels()) return;
  await syncReadModelIdentity(envelope);
  const db = await openReadModelDatabase();
  try {
    await requestResult(
      db
        .transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put({ ...envelope, key: envelopeKey(envelope) } satisfies StoredEnvelope<T>),
    );
  } finally {
    db.close();
  }
}

export async function purgeLocalReadModels(): Promise<void> {
  if (!supportsReadModels()) return;
  safeIdentityRemove();
  await deleteReadModelDatabase();
}

function envelopeKey(identity: {
  userId: string;
  workspaceId: string;
  surface: ReadModelSurface;
}): string {
  return `${READ_MODEL_SCHEMA_VERSION}:${identity.userId}:${identity.workspaceId}:${identity.surface}`;
}

function supportsReadModels(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function safeIdentityRead(): string | null {
  try {
    return window.localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
}

function safeIdentityWrite(value: string): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, value);
  } catch {
    // IndexedDB remains identity-scoped even when localStorage is unavailable.
  }
}

function safeIdentityRemove(): void {
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // Database deletion below is the authoritative purge.
  }
}

function openReadModelDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(READ_MODEL_DB_NAME, READ_MODEL_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("fetchedAt", "fetchedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Read-model storage could not be opened."));
  });
}

function deleteReadModelDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = window.indexedDB.deleteDatabase(READ_MODEL_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function deleteEnvelope(db: IDBDatabase, key: string): Promise<void> {
  return requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key)).then(
    () => undefined,
  );
}

function requestResult<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Read-model storage request failed."));
  });
}
